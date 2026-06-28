/**
 * DeepSeek 流式调用（OpenAI 兼容 SSE 协议）
 *
 * 设计要点：
 * - 放在主进程，原因有二：
 *     1) API key 是 secret，渲染进程不该看到；
 *     2) `node-fetch` 在主进程跑省去 CORS / CSP 问题。
 * - 采用纯回调（onChunk / onEnd / onError）而非 async iterator —— 调用方
 *   只关心副作用，统一通过 IPC 转发给 renderer。
 * - 支持 AbortSignal —— 用户在上一轮还在 streaming 时再次发问，
 *   主进程会先 abort 上一个 controller，避免两条流串到同一气泡。
 * - SSE 行解析按 `\n` 分割，行内 `data:` 前缀去掉；`data: [DONE]` 是 end sentinel。
 *   循环结束后还会 flush 一次 buffer，覆盖「服务端最后一行不带换行」的边界场景。
 * - 内置 60s 总超时：网络 hang（TCP 已建、body 永不返回）时也能向 UI 报 onError，
 *   避免状态机停留在 thinking 无解。
 */

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

const SYSTEM_PROMPT =
  '你是 EchoPet，一只温暖、聪明、爱与人聊天的桌面小宠物。' +
  '回答简短亲切，控制在 60 字以内，不要列条目，像和朋友闲聊一样。'

const DEFAULT_TIMEOUT_MS = 60_000

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onEnd: () => void
  onError: (message: string) => void
}

interface DeepSeekChunk {
  choices?: Array<{ delta?: { content?: string } }>
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

export async function streamDeepSeek(
  userText: string,
  apiKey: string,
  cbs: StreamCallbacks,
  signal: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<void> {
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
      resp = await fetch(DEEPSEEK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userText }
          ]
        }),
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
