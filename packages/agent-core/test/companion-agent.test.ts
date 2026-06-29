import { describe, expect, it } from 'vitest'
import { CompanionAgent } from '../src/companion-agent'
import { DefaultPromptBuilder } from '../src/prompt-builder'
import type {
  ChatCompletionClient,
  ChatCompletionStreamChunk
} from '../src/chat-completion-client'
import type { AgentEvent, AgentRunContext } from '../src/types'

function makeCtx(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    userInput: '你好',
    workingMemory: [],
    userProfileSummary: '',
    recentEpisodicMemories: [],
    personality: { energy: 0, attachment: 0.2, sensitivity: -0.3 },
    growthStage: '初识',
    totalInteractions: 0,
    personaName: '小桃',
    signal: new AbortController().signal,
    ...overrides
  }
}

function mockClient(chunks: ChatCompletionStreamChunk[]): ChatCompletionClient {
  return {
    async *stream() {
      for (const c of chunks) yield c
    }
  }
}

async function collect(gen: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

describe('CompanionAgent —— 流式输出协议', () => {
  it('first text 之前 yield thinking-end，然后逐 chunk yield text，最后 done', async () => {
    const agent = new CompanionAgent({
      client: mockClient([
        { kind: 'text', text: '你好' },
        { kind: 'text', text: '呀～' },
        { kind: 'done' }
      ]),
      promptBuilder: new DefaultPromptBuilder()
    })

    const events = await collect(agent.run(makeCtx()))
    expect(events).toEqual([
      { kind: 'thinking-end' },
      { kind: 'text', text: '你好' },
      { kind: 'text', text: '呀～' },
      { kind: 'done' }
    ])
  })

  it('零 text chunk + done → 仅 done（不发 thinking-end）', async () => {
    const agent = new CompanionAgent({
      client: mockClient([{ kind: 'done' }]),
      promptBuilder: new DefaultPromptBuilder()
    })
    const events = await collect(agent.run(makeCtx()))
    expect(events).toEqual([{ kind: 'done' }])
  })

  it('空 text 不发 text event（thinking-end 已发）', async () => {
    const agent = new CompanionAgent({
      client: mockClient([
        { kind: 'text', text: '' },
        { kind: 'text', text: 'hi' },
        { kind: 'done' }
      ]),
      promptBuilder: new DefaultPromptBuilder()
    })
    const events = await collect(agent.run(makeCtx()))
    expect(events).toEqual([
      { kind: 'thinking-end' },
      { kind: 'text', text: 'hi' },
      { kind: 'done' }
    ])
  })

  it('error chunk → 立即 yield error 并停止', async () => {
    const agent = new CompanionAgent({
      client: mockClient([
        { kind: 'text', text: 'hi' },
        { kind: 'error', error: 'rate-limited' },
        { kind: 'text', text: '不会发出的文本' }
      ]),
      promptBuilder: new DefaultPromptBuilder()
    })
    const events = await collect(agent.run(makeCtx()))
    expect(events).toEqual([
      { kind: 'thinking-end' },
      { kind: 'text', text: 'hi' },
      { kind: 'error', error: 'rate-limited' }
    ])
  })

  it('client 流自然结束但没发 done → CompanionAgent 兜底补 done', async () => {
    const agent = new CompanionAgent({
      client: mockClient([{ kind: 'text', text: 'ok' }]),
      promptBuilder: new DefaultPromptBuilder()
    })
    const events = await collect(agent.run(makeCtx()))
    expect(events).toEqual([
      { kind: 'thinking-end' },
      { kind: 'text', text: 'ok' },
      { kind: 'done' }
    ])
  })

  it('client.stream 抛异常 → yield error', async () => {
    const agent = new CompanionAgent({
      client: {
        async *stream(): AsyncIterable<ChatCompletionStreamChunk> {
          throw new Error('boom')
        }
      },
      promptBuilder: new DefaultPromptBuilder()
    })
    const events = await collect(agent.run(makeCtx()))
    expect(events).toEqual([{ kind: 'error', error: 'boom' }])
  })

  it('把 PromptBuilder 拼好的 messages 传给 client.stream', async () => {
    const calls: Array<Parameters<ChatCompletionClient['stream']>[0]> = []
    const client: ChatCompletionClient = {
      async *stream(opts) {
        calls.push(opts)
        yield { kind: 'done' }
      }
    }
    const agent = new CompanionAgent({
      client,
      promptBuilder: new DefaultPromptBuilder()
    })
    await collect(agent.run(makeCtx({ userInput: '今天的天气怎么样' })))

    expect(calls).toHaveLength(1)
    const arg = calls[0]!
    expect(arg.messages[0]?.role).toBe('system')
    expect(arg.messages[arg.messages.length - 1]).toEqual({
      role: 'user',
      content: '今天的天气怎么样'
    })
    expect(arg.temperature).toBe(1.0) // 默认值
    expect(arg.maxTokens).toBe(256) // 默认值
    expect(arg.signal).toBeInstanceOf(AbortSignal)
  })

  it('自定义 temperature / maxTokens 透传给 client', async () => {
    const calls: Array<Parameters<ChatCompletionClient['stream']>[0]> = []
    const agent = new CompanionAgent({
      client: {
        async *stream(opts) {
          calls.push(opts)
          yield { kind: 'done' }
        }
      },
      promptBuilder: new DefaultPromptBuilder(),
      temperature: 0.7,
      maxTokens: 128
    })
    await collect(agent.run(makeCtx()))
    expect(calls[0]?.temperature).toBe(0.7)
    expect(calls[0]?.maxTokens).toBe(128)
  })

  it('agent.name / agent.family 反映 v2.1 单陪伴 Agent 设定', () => {
    const agent = new CompanionAgent({
      client: mockClient([{ kind: 'done' }]),
      promptBuilder: new DefaultPromptBuilder()
    })
    expect(agent.name).toBe('CompanionAgent')
    expect(agent.family).toBe('companion')
  })
})
