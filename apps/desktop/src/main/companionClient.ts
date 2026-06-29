/**
 * DeepSeek 实现的 ChatCompletionClient
 *
 * 把 `streamDeepSeek` 的 callback API 桥接成 agent-core 约定的 AsyncIterable。
 *
 * 设计要点：
 *   - 内部 AbortController 包外层 signal，generator 提前 break 时也能 abort 底层 fetch，
 *     避免 streamDeepSeek 在后台继续读 SSE → 内存泄漏。
 *   - callback → async iter 用一个简单 Promise queue（不引第三方）。
 *   - 无 key / 网络异常 / 超时 全部走 `kind: 'error'` chunk，不抛异常。
 */

import { streamDeepSeek } from './llm'
import type {
  ChatCompletionClient,
  ChatCompletionStreamChunk
} from '@echopet/agent-core'

export function createDeepSeekClient(getApiKey: () => string | null): ChatCompletionClient {
  return {
    async *stream({ messages, signal, temperature, maxTokens }) {
      const apiKey = getApiKey()
      if (!apiKey) {
        yield { kind: 'error', error: '尚未配置 DeepSeek API Key — 点齿轮配置' }
        return
      }

      const inner = new AbortController()
      const forwardAbort = (): void => inner.abort()
      if (signal.aborted) inner.abort()
      else signal.addEventListener('abort', forwardAbort)

      const queue: ChatCompletionStreamChunk[] = []
      let waiter: ((c: ChatCompletionStreamChunk | null) => void) | null = null
      let finished = false

      const push = (c: ChatCompletionStreamChunk): void => {
        if (waiter) {
          const w = waiter
          waiter = null
          w(c)
        } else {
          queue.push(c)
        }
      }
      const finish = (): void => {
        if (finished) return
        finished = true
        if (waiter) {
          const w = waiter
          waiter = null
          w(null)
        }
      }

      const runPromise = streamDeepSeek(
        messages,
        apiKey,
        {
          onChunk: (text) => push({ kind: 'text', text }),
          onEnd: () => {
            push({ kind: 'done' })
            finish()
          },
          onError: (error) => {
            push({ kind: 'error', error })
            finish()
          }
        },
        inner.signal,
        { temperature, maxTokens }
      ).catch((err: unknown) => {
        // streamDeepSeek 自身约定不会 throw（所有错误走 onError），保留兜底
        const msg = err instanceof Error ? err.message : String(err)
        push({ kind: 'error', error: `LLM 客户端异常：${msg}` })
        finish()
      })

      try {
        while (true) {
          if (queue.length > 0) {
            const c = queue.shift() as ChatCompletionStreamChunk
            yield c
            if (c.kind === 'done' || c.kind === 'error') return
            continue
          }
          if (finished) return
          const next = await new Promise<ChatCompletionStreamChunk | null>((resolve) => {
            waiter = resolve
          })
          if (next === null) return
          yield next
          if (next.kind === 'done' || next.kind === 'error') return
        }
      } finally {
        // 确保 generator 提前退出时 streamDeepSeek 也终止
        inner.abort()
        signal.removeEventListener('abort', forwardAbort)
        await runPromise
      }
    }
  }
}
