import { describe, expect, it } from 'vitest'
import { DefaultPromptBuilder } from '../src/prompt-builder'
import type { ConversationMessage, PromptBuilderInput } from '../src/types'

function makeInput(overrides: Partial<PromptBuilderInput> = {}): PromptBuilderInput {
  return {
    personaName: '小桃',
    userCalling: undefined,
    personality: { energy: 0, attachment: 0.2, sensitivity: -0.3 },
    growthStage: '初识',
    totalInteractions: 0,
    userProfile: {},
    userProfileSummary: '',
    recentEpisodicMemories: [],
    workingMemory: [],
    userInput: '你好',
    ...overrides
  }
}

describe('DefaultPromptBuilder.composeSystemPrompt', () => {
  it('含 persona 名字 + 静态底色 + 内部步骤指令', () => {
    const sys = new DefaultPromptBuilder().composeSystemPrompt(makeInput())
    expect(sys).toContain('「小桃」')
    expect(sys).toContain('温暖、轻倾听')
    expect(sys).toContain('内部步骤')
    expect(sys).toContain('识别 ta 这句话的情绪')
    expect(sys).toContain('「小桃」的口吻')
  })

  it('提供 userCalling 时，称呼写入 prompt', () => {
    const sys = new DefaultPromptBuilder().composeSystemPrompt(
      makeInput({ userCalling: '小桃桃' })
    )
    expect(sys).toContain('称呼主人为「小桃桃」')
  })

  it('userCalling 是空白时不写入', () => {
    const sys = new DefaultPromptBuilder().composeSystemPrompt(
      makeInput({ userCalling: '   ' })
    )
    expect(sys).not.toContain('称呼主人为')
  })

  it('三维向量 → 3 行性格修饰被注入', () => {
    const sys = new DefaultPromptBuilder().composeSystemPrompt(
      makeInput({ personality: { energy: 0.9, attachment: -0.7, sensitivity: 0.8 } })
    )
    expect(sys).toContain('超级活泼好动')
    expect(sys).toContain('独立')
    expect(sys).toContain('高度共情')
  })

  it('成长阶段段含 stage + 描述 + 互动次数', () => {
    const sys = new DefaultPromptBuilder().composeSystemPrompt(
      makeInput({ growthStage: '熟悉', totalInteractions: 47 })
    )
    expect(sys).toContain('成长阶段：熟悉')
    expect(sys).toContain('展现真实性格')
    expect(sys).toContain('互动了 47 次')
  })

  it('userProfileSummary 为空 → 不写入「你对 ta 的了解」段', () => {
    const sys = new DefaultPromptBuilder().composeSystemPrompt(makeInput())
    expect(sys).not.toContain('你对 ta 的了解')
  })

  it('userProfileSummary 有值 → 写入', () => {
    const sys = new DefaultPromptBuilder().composeSystemPrompt(
      makeInput({ userProfileSummary: '主人养了一只叫煤球的猫，做前端工程师' })
    )
    expect(sys).toContain('你对 ta 的了解')
    expect(sys).toContain('煤球')
  })

  it('recentEpisodicMemories 空 → 不写入「最近聊过的事」段', () => {
    const sys = new DefaultPromptBuilder().composeSystemPrompt(makeInput())
    expect(sys).not.toContain('最近聊过的事')
  })

  it('recentEpisodicMemories 多条 → 编号注入', () => {
    const sys = new DefaultPromptBuilder().composeSystemPrompt(
      makeInput({
        recentEpisodicMemories: [
          { id: 'e1', summary: '主人上周修好了客厅那个 bug', ts: 0 },
          { id: 'e2', summary: '主人最近在学 SwiftUI', ts: 0 }
        ]
      })
    )
    expect(sys).toContain('1. 主人上周修好了客厅那个 bug')
    expect(sys).toContain('2. 主人最近在学 SwiftUI')
  })
})

describe('DefaultPromptBuilder.composeMessages', () => {
  it('返回 [system, ...历史轮次, 当前 user]', () => {
    const wm: ConversationMessage[] = [
      { id: 'm1', role: 'user', content: '上次说啥', ts: 0 },
      { id: 'm2', role: 'assistant', content: '说 SwiftUI', ts: 0 }
    ]
    const msgs = new DefaultPromptBuilder().composeMessages(
      makeInput({ workingMemory: wm, userInput: '今天聊点别的吧' })
    )
    expect(msgs).toHaveLength(4)
    expect(msgs[0]?.role).toBe('system')
    expect(msgs[1]).toEqual({ role: 'user', content: '上次说啥' })
    expect(msgs[2]).toEqual({ role: 'assistant', content: '说 SwiftUI' })
    expect(msgs[3]).toEqual({ role: 'user', content: '今天聊点别的吧' })
  })

  it('工作记忆超过 maxWorkingMemoryTurns 时只取尾部 N 条', () => {
    const wm: ConversationMessage[] = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg-${i}`,
      ts: 0
    }))
    const msgs = new DefaultPromptBuilder({ maxWorkingMemoryTurns: 10 }).composeMessages(
      makeInput({ workingMemory: wm })
    )
    // 1 (system) + 10 (recent) + 1 (current user) = 12
    expect(msgs).toHaveLength(12)
    expect(msgs[1]?.content).toBe('msg-15') // 第 25 条减 10 = 15 起
    expect(msgs[10]?.content).toBe('msg-24')
  })

  it('tool 角色的消息携带 toolCallId / name', () => {
    const wm: ConversationMessage[] = [
      { id: 'm1', role: 'tool', content: 'ls 结果', ts: 0, toolCallId: 'call_1', toolName: 'list_directory' }
    ]
    const msgs = new DefaultPromptBuilder().composeMessages(
      makeInput({ workingMemory: wm })
    )
    expect(msgs[1]).toEqual({
      role: 'tool',
      content: 'ls 结果',
      toolCallId: 'call_1',
      name: 'list_directory'
    })
  })
})
