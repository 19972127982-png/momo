/**
 * CompanionAgent —— v2.1 单陪伴 Agent
 *
 * 行为：
 *   1. 用 PromptBuilder 拼好 messages
 *   2. 调 ChatCompletionClient.stream() 拿 SSE 流
 *   3. 第一个 text chunk 之前发 thinking-end（用于状态机 thinking → speaking）
 *   4. 把 stream chunk 转成 AgentEvent yield 出去
 *   5. 流结束 yield done；任何 error 转 error event
 *
 * 不做的事（v2.1 简化）：
 *   - 不调 tool（陪伴族不需要工具调用 —— 路由判到陪伴模式就是这条路径）
 *   - 不主动写记忆 —— 由 chat handler 在 stream 完成后异步落 SQLite
 *   - 不做性格分析 —— D5 在 chat handler 里异步调 personalityEngine.analyzeAndEvolve
 *
 * 工作 Agent（FileAgent / DevAgent / ...）会单独实现 Agent 接口，可能 yield tool-call。
 */

import type {
  Agent,
  AgentEvent,
  AgentRunContext,
  ToolResolution
} from './types'
import type { ChatCompletionClient } from './chat-completion-client'
import type { PromptBuilder } from './types'

export interface CompanionAgentOptions {
  client: ChatCompletionClient
  promptBuilder: PromptBuilder
  /** 默认 1.0 —— DeepSeek 官方建议 chat 场景用 1.3，但我们要更稳定的对话感 */
  temperature?: number
  /** 控制单次回复长度 —— 桌宠回复 60-120 字够用，避免话痨 */
  maxTokens?: number
}

export class CompanionAgent implements Agent {
  readonly name = 'CompanionAgent'
  readonly family = 'companion' as const

  private readonly client: ChatCompletionClient
  private readonly promptBuilder: PromptBuilder
  private readonly temperature: number
  private readonly maxTokens: number

  constructor(opts: CompanionAgentOptions) {
    this.client = opts.client
    this.promptBuilder = opts.promptBuilder
    this.temperature = opts.temperature ?? 1.0
    this.maxTokens = opts.maxTokens ?? 256
  }

  async *run(
    ctx: AgentRunContext
  ): AsyncGenerator<AgentEvent, void, ToolResolution | undefined> {
    const messages = this.promptBuilder.composeMessages({
      personaName: ctx.personaName,
      userCalling: ctx.userCalling,
      personality: ctx.personality,
      growthStage: ctx.growthStage,
      totalInteractions: ctx.totalInteractions,
      userProfile: {},
      userProfileSummary: ctx.userProfileSummary,
      recentEpisodicMemories: ctx.recentEpisodicMemories,
      workingMemory: ctx.workingMemory,
      userInput: ctx.userInput
    })

    let receivedFirstText = false

    try {
      for await (const chunk of this.client.stream({
        messages,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        signal: ctx.signal
      })) {
        if (chunk.kind === 'error') {
          yield { kind: 'error', error: chunk.error }
          return
        }
        if (chunk.kind === 'done') {
          yield { kind: 'done' }
          return
        }
        if (chunk.kind === 'text') {
          if (!receivedFirstText) {
            receivedFirstText = true
            yield { kind: 'thinking-end' }
          }
          if (chunk.text.length > 0) {
            yield { kind: 'text', text: chunk.text }
          }
        }
      }
      // 流自然结束但没收到 'done' chunk —— 兜底
      yield { kind: 'done' }
    } catch (err) {
      // 通常 ChatCompletionClient 不应该 throw（约定走 error chunk），
      // 但仍保留兜底，避免被吞掉
      const msg = err instanceof Error ? err.message : String(err)
      yield { kind: 'error', error: msg }
    }
  }
}
