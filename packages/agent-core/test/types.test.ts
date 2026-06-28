import { describe, expect, it } from 'vitest'
import type {
  Agent,
  AgentEvent,
  AgentRunContext,
  ChatCompletionMessage,
  ConversationMessage,
  EpisodicMemory,
  IntentMode,
  MemoryStore,
  PersonalityState,
  PromptBuilder,
  PromptBuilderInput,
  Router,
  RouterResult,
  ToolResolution,
  UserProfile
} from '../src'

/**
 * 这些测试是「接口契约 + 类型可用性」测试。
 * 真实实现在 apps/desktop/src/main 下，D2-D5 各自实现 + 测试。
 * 这里只验证：
 *   - 接口可以被合理实现（mock 类编译通过）
 *   - discriminated union narrow 工作正常
 *   - AsyncGenerator 双向通信契约 OK
 */

describe('agent-core 接口契约', () => {
  it('AgentEvent discriminated union 可在 switch 内 narrow', () => {
    function describe(ev: AgentEvent): string {
      switch (ev.kind) {
        case 'text':
          return `text:${ev.text}`
        case 'tool-call':
          return `${ev.agentName}:${ev.toolName}`
        case 'thinking-end':
        case 'done':
          return ev.kind
        case 'error':
          return `error:${ev.error}`
      }
    }

    expect(
      describe({
        kind: 'tool-call',
        agentName: 'FileAgent',
        serverId: 'fs',
        toolName: 'list',
        args: { path: '/' },
        argsSummary: 'list /',
        scope: 'read'
      })
    ).toBe('FileAgent:list')

    expect(describe({ kind: 'text', text: 'hi' })).toBe('text:hi')
    expect(describe({ kind: 'thinking-end' })).toBe('thinking-end')
    expect(describe({ kind: 'done' })).toBe('done')
    expect(describe({ kind: 'error', error: 'boom' })).toBe('error:boom')

    // tool-result 不是 AgentEvent 的合法 kind（它存在于 ToolResolution）
    // @ts-expect-error tool-result 不是 AgentEvent
    const _bad: AgentEvent = { kind: 'tool-result', resultSummary: 'x', resultFull: 'x' }
    void _bad
  })

  it('ToolResolution discriminated union ok/error 分支可区分', () => {
    const ok: ToolResolution = { ok: true, resultSummary: '列出 3 个文件', resultFull: '...' }
    const err: ToolResolution = { ok: false, error: 'EPERM' }

    expect(ok.ok && ok.resultSummary).toBe('列出 3 个文件')
    expect(!err.ok && err.error).toBe('EPERM')
  })

  it('Agent AsyncGenerator 双向通信契约（mock CompanionAgent）', async () => {
    const mock: Agent = {
      name: 'MockCompanion',
      family: 'companion',
      async *run(_ctx: AgentRunContext) {
        yield { kind: 'thinking-end' as const }
        yield { kind: 'text' as const, text: '你好' }
        yield { kind: 'text' as const, text: '！' }
        yield { kind: 'done' as const }
      }
    }

    const ctx = makeStubContext()
    const collected: AgentEvent[] = []
    const gen = mock.run(ctx)
    for await (const ev of gen) collected.push(ev)

    expect(collected).toEqual([
      { kind: 'thinking-end' },
      { kind: 'text', text: '你好' },
      { kind: 'text', text: '！' },
      { kind: 'done' }
    ])
  })

  it('Agent ReAct loop —— tool-call 后 next(resolution) 恢复（mock UtilityAgent）', async () => {
    const mock: Agent = {
      name: 'MockFile',
      family: 'utility',
      async *run(_ctx: AgentRunContext) {
        yield { kind: 'thinking-end' as const }
        const resolution = yield {
          kind: 'tool-call' as const,
          agentName: 'FileAgent',
          serverId: 'fs',
          toolName: 'list_directory',
          args: { path: '/Users/lilliechen/Desktop' },
          argsSummary: 'list ~/Desktop',
          scope: 'read' as const
        }
        if (!resolution || !resolution.ok) {
          yield { kind: 'error' as const, error: resolution?.error ?? 'no resolution' }
          return
        }
        yield { kind: 'text' as const, text: `结果: ${resolution.resultSummary}` }
        yield { kind: 'done' as const }
      }
    }

    const gen = mock.run(makeStubContext())
    const events: AgentEvent[] = []

    // 第一次拿到 thinking-end
    let step = await gen.next()
    if (!step.done) events.push(step.value)

    // 第二次拿到 tool-call —— 喂回 resolution
    step = await gen.next()
    if (!step.done) events.push(step.value)
    expect(step.value).toMatchObject({ kind: 'tool-call', toolName: 'list_directory' })

    // 喂回 resolution
    step = await gen.next({ ok: true, resultSummary: '3 个文件', resultFull: 'file1\nfile2\nfile3' })
    if (!step.done) events.push(step.value)
    expect(step.value).toMatchObject({ kind: 'text', text: expect.stringContaining('3 个文件') })

    // done
    step = await gen.next()
    if (!step.done) events.push(step.value)

    // 最后一步 done=true
    step = await gen.next()
    expect(step.done).toBe(true)

    expect(events).toHaveLength(4)
    expect(events[0]?.kind).toBe('thinking-end')
    expect(events[1]?.kind).toBe('tool-call')
    expect(events[2]?.kind).toBe('text')
    expect(events[3]?.kind).toBe('done')
  })

  it('RouterResult mode narrow', () => {
    const companion: RouterResult = { mode: 'companion', confidence: 0.9 }
    const utility: RouterResult = { mode: 'utility', confidence: 0.85, agentName: 'FileAgent', intent: 'file_op' }

    expect(companion.mode).toBe('companion')
    expect(utility.agentName).toBe('FileAgent')

    // mode 类型必须是 IntentMode
    const mode: IntentMode = utility.mode
    expect(mode === 'companion' || mode === 'utility').toBe(true)
  })

  it('Router mock 实现可被调用', async () => {
    const router: Router = {
      async route(input) {
        if (/(?:打开|列|帮我.*文件|整理)/u.test(input)) {
          return { mode: 'utility', confidence: 0.9, agentName: 'FileAgent', intent: 'file_op' }
        }
        return { mode: 'companion', confidence: 0.85 }
      }
    }

    const r1 = await router.route('帮我列一下 Desktop', { workingMemory: [], signal: new AbortController().signal })
    expect(r1.mode).toBe('utility')
    expect(r1.agentName).toBe('FileAgent')

    const r2 = await router.route('今天好累', { workingMemory: [], signal: new AbortController().signal })
    expect(r2.mode).toBe('companion')
  })

  it('MemoryStore mock 实现满足接口', async () => {
    const messages: ConversationMessage[] = []
    let counter = 0

    const store: MemoryStore = {
      async appendMessage(msg) {
        const full: ConversationMessage = { ...msg, id: `m${++counter}` }
        messages.push(full)
        return full
      },
      async recentMessages(n) {
        return messages.slice(-n)
      },
      async upsertEpisodicMemory(m) {
        return { ...m, id: `e${++counter}` }
      },
      async recallEpisodicMemories() {
        return []
      },
      async getUserProfile() {
        return { nickname: 'L' } as UserProfile
      },
      async updateUserProfile(patch) {
        return { nickname: 'L', ...patch } as UserProfile
      },
      async getPersonality() {
        return { energy: 0, attachment: 0.2, sensitivity: -0.3 }
      },
      async updatePersonality() {
        // noop
      },
      async incrementInteractions() {
        return 1
      },
      async getTotalInteractions() {
        return 0
      },
      async appendEvolutionLog() {
        // noop
      }
    }

    const m = await store.appendMessage({ role: 'user', content: 'hi', ts: Date.now() })
    expect(m.id).toBe('m1')

    const recent = await store.recentMessages(10)
    expect(recent).toHaveLength(1)

    const p = await store.getPersonality()
    expect(p).toEqual({ energy: 0, attachment: 0.2, sensitivity: -0.3 })
  })

  it('PromptBuilder mock 实现产出预期 system prompt', () => {
    const builder: PromptBuilder = {
      composeSystemPrompt(input) {
        return `你是「${input.personaName}」。你们互动了 ${input.totalInteractions} 次。`
      },
      composeMessages(input) {
        const msgs: ChatCompletionMessage[] = [
          { role: 'system', content: this.composeSystemPrompt(input) }
        ]
        for (const m of input.workingMemory) {
          msgs.push({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content })
        }
        msgs.push({ role: 'user', content: input.userInput })
        return msgs
      }
    }

    const input: PromptBuilderInput = {
      personaName: '小桃',
      personality: { energy: 0, attachment: 0.2, sensitivity: -0.3 },
      growthStage: '初识',
      totalInteractions: 5,
      userProfile: {},
      userProfileSummary: '',
      recentEpisodicMemories: [],
      workingMemory: [{ id: 'm1', role: 'user', content: '你好', ts: 0 }],
      userInput: '今天好累'
    }

    const sys = builder.composeSystemPrompt(input)
    expect(sys).toContain('小桃')
    expect(sys).toContain('5 次')

    const msgs = builder.composeMessages(input)
    expect(msgs).toHaveLength(3)
    expect(msgs[0]?.role).toBe('system')
    expect(msgs[2]?.role).toBe('user')
    expect(msgs[2]?.content).toBe('今天好累')
  })

  it('PersonalityState 软上限范围合理（仅类型层断言，clamping 在实现里做）', () => {
    const p: PersonalityState = { energy: 1.0, attachment: 1.0, sensitivity: 0.8 }
    expect(p.energy).toBeLessThanOrEqual(1.0)
    expect(p.attachment).toBeLessThanOrEqual(1.0)
    expect(p.sensitivity).toBeLessThanOrEqual(0.8)
  })

  it('EpisodicMemory readonly embedding 数组', () => {
    const m: EpisodicMemory = {
      id: 'e1',
      summary: '用户养了煤球这只猫',
      embedding: [0.1, 0.2, 0.3],
      ts: Date.now()
    }
    expect(m.embedding?.length).toBe(3)
    // readonly 类型守护 —— 试图改写应失败
    // @ts-expect-error readonly array 不允许下标写
    if (m.embedding) m.embedding[0] = 9
  })
})

function makeStubContext(): AgentRunContext {
  return {
    userInput: 'hi',
    workingMemory: [],
    userProfileSummary: '',
    recentEpisodicMemories: [],
    personality: { energy: 0, attachment: 0.2, sensitivity: -0.3 },
    growthStage: '初识',
    totalInteractions: 0,
    personaName: '小桃',
    signal: new AbortController().signal
  }
}
