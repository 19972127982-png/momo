/**
 * LLM Chat Completion 客户端抽象层
 *
 * 设计原因：
 *   1. CompanionAgent 不直接耦合具体 LLM Provider；测试时可以注入 mock client
 *   2. v2 Web 端可以注入「调 Vercel API Routes」实现而非直连 DeepSeek
 *   3. W4-W5 加 evaluator 时可以挂跨家族 Provider（DeepSeek / Claude / OpenAI）
 *
 * 接口约定：
 *   - `stream()` 返回 AsyncIterable，依次 yield text/done/error chunk
 *   - 必须支持 AbortSignal（外层取消时不卡死）
 *   - 不抛异常 —— 所有失败通过 `kind: 'error'` chunk 表达，便于 Agent 统一处理
 */
import type { ChatCompletionMessage } from './types'

export interface ChatCompletionStreamOptions {
  messages: readonly ChatCompletionMessage[]
  /** 0-1，未传走 client 默认（DeepSeek 默认 1.0） */
  temperature?: number
  /** 服务端 max_tokens，未传走 client 默认 */
  maxTokens?: number
  /** 中断信号 —— 客户端必须遵守 */
  signal: AbortSignal
}

export type ChatCompletionStreamChunk =
  | { kind: 'text'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; error: string }

export interface ChatCompletionClient {
  /** 流式生成 —— 调用方 for-await 拿 chunk */
  stream(opts: ChatCompletionStreamOptions): AsyncIterable<ChatCompletionStreamChunk>
}
