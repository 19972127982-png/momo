/**
 * DeepSeek 流式调用（OpenAI 兼容 SSE 协议）
 *
 * 设计要点：
 * - 放在主进程，原因有二：
 *     1) API key 是 secret，渲染进程不该看到；
 *     2) `node-fetch` 在主进程跑省去 CORS / CSP 问题。
 * - 采用纯回调（onChunk / onEnd / onError）而非 async iterator —— 调用方
 *   只关心副作用；上层 `companionClient.ts` 再把它桥接成 ChatCompletionClient 的
 *   AsyncIterable 协议。
 * - 支持 AbortSignal —— 用户在上一轮还在 streaming 时再次发问，
 *   主进程会先 abort 上一个 controller，避免两条流串到同一气泡。
 * - SSE 行解析按 `\n` 分割，行内 `data:` 前缀去掉；`data: [DONE]` 是 end sentinel。
 *   循环结束后还会 flush 一次 buffer，覆盖「服务端最后一行不带换行」的边界场景。
 * - 内置 60s 总超时：网络 hang（TCP 已建、body 永不返回）时也能向 UI 报 onError，
 *   避免状态机停留在 thinking 无解。
 *
 * v2.1 W3 D2 重构：入参从 `userText: string` 改为 `messages: ChatCompletionMessage[]`，
 * 由调用方（companionClient）拼接好 system + 工作记忆 + 当前 user 输入再传入。
 */

import type { ChatCompletionMessage } from '@echopet/agent-core'

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

const DEFAULT_TIMEOUT_MS = 60_000

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onEnd: () => void
  onError: (message: string) => void
}

export interface StreamDeepSeekOptions {
  /** 0-2，未传则交给服务端默认（DeepSeek chat 默认 1.0） */
  temperature?: number
  /** 单次回复 token 上限，未传走服务端默认 */
  maxTokens?: number
  /** 全链路超时（建立连接 + 完整读流），默认 60s */
  timeoutMs?: number
}

interface DeepSeekChunk {
  choices?: Array<{ delta?: { content?: string } }>
}

/** 把内部统一的 message 形状翻译成 DeepSeek（OpenAI 兼容）API 接受的形状 */
function toApiMessage(m: ChatCompletionMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    const out: Record<string, unknown> = {
      role: 'tool',
      content: m.content
    }
    if (m.toolCallId) out.tool_call_id = m.toolCallId
    if (m.name) out.name = m.name
    return out
  }
  return { role: m.role, content: m.content }
}

/** 解析单行 SSE，返回 'done' / 'continue'，触发回调 */
function processLine(line: string, cbs: StreamCallbacks): 'done' | 'continue' {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return 'continue'
  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return 'done'
  try {
    const obj = JSON.parse(payload) as DeepSeekChunk
    const delta = obj.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta.length > 0) {
      cbs.onChunk(delta)
    }
  } catch {
    /* malformed line, skip */
  }
  return 'continue'
}

/**
 * 非流式补全 —— 一次性拿完整回复文本。
 * 用于「不需要打字机效果」的后台 LLM 任务：用户画像抽取（D3）、性格 delta 分析（D5）。
 * 失败（网络 / 超时 / 非 2xx / 空回复）一律抛 Error，调用方自行 swallow。
 */
export async function completeDeepSeek(
  messages: readonly ChatCompletionMessage[],
  apiKey: string,
  signal: AbortSignal,
  options: StreamDeepSeekOptions = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const inner = new AbortController()
  const onOuterAbort = (): void => inner.abort()
  signal.addEventListener('abort', onOuterAbort)
  const timer = setTimeout(() => inner.abort(), timeoutMs)

  try {
    const body: Record<string, unknown> = {
      model: DEEPSEEK_MODEL,
      stream: false,
      messages: messages.map(toApiMessage)
    }
    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens

    const resp = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: inner.signal
    })

    if (!resp.ok) {
      throw new Error(`DeepSeek 返回 ${resp.status}`)
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('DeepSeek 返回空内容')
    }
    return content
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onOuterAbort)
  }
}

export async function streamDeepSeek(
  messages: readonly ChatCompletionMessage[],
  apiKey: string,
  cbs: StreamCallbacks,
  signal: AbortSignal,
  options: StreamDeepSeekOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // 合并 outer signal + 内部 timeout，作为单一 abort 源
  const inner = new AbortController()
  const onOuterAbort = (): void => inner.abort()
  signal.addEventListener('abort', onOuterAbort)

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    inner.abort()
  }, timeoutMs)

  // 给 catch 分支用：true 表示 outer 主动 abort（renderer 已知，要静默），
  // false 表示是 timeout 或网络异常，需要 onError 通知。
  const isOuterAbort = (): boolean => signal.aborted && !timedOut

  try {
    let resp: Response
    try {
      const body: Record<string, unknown> = {
        model: DEEPSEEK_MODEL,
        stream: true,
        messages: messages.map(toApiMessage)
      }
      if (options.temperature !== undefined) body.temperature = options.temperature
      if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens

      resp = await fetch(DEEPSEEK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: inner.signal
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (isOuterAbort()) return
        cbs.onError(timedOut ? `等了 ${Math.round(timeoutMs / 1000)}s 还没收到回复` : '请求中断')
        return
      }
      cbs.onError(`网络异常：${(err as Error).message}`)
      return
    }

    if (!resp.ok || !resp.body) {
      let detail = ''
      try {
        detail = (await resp.text()).slice(0, 160)
      } catch {
        /* ignore */
      }
      cbs.onError(`DeepSeek 返回 ${resp.status}${detail ? ` — ${detail}` : ''}`)
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let reachedDone = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (processLine(line, cbs) === 'done') {
            reachedDone = true
            break
          }
        }
        if (reachedDone) break
      }

      if (reachedDone) {
        // 服务端可能在 [DONE] 之后还挂着连接，主动 cancel 加速释放
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
      } else {
        // 没收到 [DONE] 就 EOF —— flush 残留行（服务端最后一帧可能没换行）
        buffer += decoder.decode()
        const last = buffer.trim()
        if (last) processLine(last, cbs)
      }
      cbs.onEnd()
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (isOuterAbort()) return
        cbs.onError(timedOut ? `等了 ${Math.round(timeoutMs / 1000)}s 还没收完回复` : '请求中断')
        return
      }
      cbs.onError(`流式读取中断：${(err as Error).message}`)
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onOuterAbort)
  }
}
