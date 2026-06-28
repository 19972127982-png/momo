import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createActor, type Snapshot } from 'xstate'
import {
  petMachine,
  MAX_TOOL_STEPS,
  TOOL_TIMEOUT_MS,
  APPROVAL_TIMEOUT_MS
} from '../src/machine'
import type { PendingToolCall, PetState, PetThinkingSubState } from '../src/types'

/** 工具：取顶层 state value，平面化好对比 */
function state(snapshot: Snapshot<unknown>): PetState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (snapshot as any).value
  return (typeof v === 'string' ? v : Object.keys(v)[0]) as PetState
}

/** v2.1 W3 NEW：取 thinking 的 sub-state */
function thinkingSub(snapshot: Snapshot<unknown>): PetThinkingSubState | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (snapshot as any).value
  if (typeof v === 'object' && v !== null && 'thinking' in v) {
    return v.thinking as PetThinkingSubState
  }
  return null
}

const TOOL_CALL: PendingToolCall = {
  agentName: 'FileAgent',
  serverId: 'filesystem',
  toolName: 'list_directory',
  argsSummary: 'list ~/Desktop',
  scope: 'read'
}

describe('petMachine — 核心状态转移', () => {
  it('初始状态是 idle，context 干净（含 v2.1 新字段）', () => {
    const actor = createActor(petMachine).start()
    expect(state(actor.getSnapshot())).toBe('idle')
    expect(actor.getSnapshot().context).toEqual({
      streamText: '',
      lastError: null,
      pendingToolCall: null,
      toolSteps: 0,
      lastToolResult: null
    })
  })

  it('idle + ui.pet-click → listening', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'ui.pet-click' })
    expect(state(actor.getSnapshot())).toBe('listening')
  })

  it('listening + ui.input-blur → idle', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'ui.pet-click' })
    actor.send({ type: 'ui.input-blur' })
    expect(state(actor.getSnapshot())).toBe('idle')
  })

  it('listening + user.send → thinking', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'ui.pet-click' })
    actor.send({ type: 'user.send', text: 'hi' })
    expect(state(actor.getSnapshot())).toBe('thinking')
  })

  it('idle 也能直接 user.send → thinking（兼容快捷键发送）', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    expect(state(actor.getSnapshot())).toBe('thinking')
  })

  it('thinking + agent.thinking-end → speaking', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.thinking-end' })
    expect(state(actor.getSnapshot())).toBe('speaking')
  })

  it('thinking + agent.error → apologetic 并记下错误', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.error', error: 'invalid api key' })
    expect(state(actor.getSnapshot())).toBe('apologetic')
    expect(actor.getSnapshot().context.lastError).toBe('invalid api key')
  })

  it('thinking + agent.stream-chunk 兜底 → speaking 并累积（无需显式 thinking-end）', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.stream-chunk', text: 'hello' })
    expect(state(actor.getSnapshot())).toBe('speaking')
    expect(actor.getSnapshot().context.streamText).toBe('hello')
  })

  it('thinking + agent.stream-end 兜底 → done（零 token 也不会卡死）', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.stream-end' })
    expect(state(actor.getSnapshot())).toBe('done')
  })

  it('speaking + agent.error → apologetic', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.thinking-end' })
    actor.send({ type: 'agent.error', error: 'mid-stream boom' })
    expect(state(actor.getSnapshot())).toBe('apologetic')
    expect(actor.getSnapshot().context.lastError).toBe('mid-stream boom')
  })

  it('apologetic + user.send 立刻 → thinking（用户重试不必等 3s）', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'q1' })
    actor.send({ type: 'agent.error', error: 'boom' })
    actor.send({ type: 'user.send', text: 'q2' })
    expect(state(actor.getSnapshot())).toBe('thinking')
  })

  it('apologetic + ui.pet-click → listening', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'q1' })
    actor.send({ type: 'agent.error', error: 'boom' })
    actor.send({ type: 'ui.pet-click' })
    expect(state(actor.getSnapshot())).toBe('listening')
  })

  it('speaking 期间多个 agent.stream-chunk → 累积到 context.streamText', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.thinking-end' })

    actor.send({ type: 'agent.stream-chunk', text: '你好' })
    actor.send({ type: 'agent.stream-chunk', text: '，' })
    actor.send({ type: 'agent.stream-chunk', text: '世界' })

    expect(state(actor.getSnapshot())).toBe('speaking') // 不切状态
    expect(actor.getSnapshot().context.streamText).toBe('你好，世界')
  })

  it('thinking 进入时清空上一轮的 streamText', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'q1' })
    actor.send({ type: 'agent.thinking-end' })
    actor.send({ type: 'agent.stream-chunk', text: '一段历史回复' })
    actor.send({ type: 'agent.stream-end' })
    // 此时进入 done，streamText 还在
    expect(actor.getSnapshot().context.streamText).toBe('一段历史回复')

    actor.send({ type: 'user.send', text: 'q2' }) // 进 thinking → 应清空
    expect(actor.getSnapshot().context.streamText).toBe('')
  })

  it('speaking + agent.stream-end → done', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.thinking-end' })
    actor.send({ type: 'agent.stream-end' })
    expect(state(actor.getSnapshot())).toBe('done')
  })

  it('done 期间用户追问 → thinking', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.thinking-end' })
    actor.send({ type: 'agent.stream-end' })
    actor.send({ type: 'user.send', text: '再问' })
    expect(state(actor.getSnapshot())).toBe('thinking')
  })
})

describe('petMachine — 超时自动 idle 回流', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('done 不再自动归位 idle —— 是稳态，等用户主动操作', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.thinking-end' })
    actor.send({ type: 'agent.stream-end' })
    expect(state(actor.getSnapshot())).toBe('done')

    vi.advanceTimersByTime(10_000)
    expect(state(actor.getSnapshot())).toBe('done')
  })

  it('done + ui.pet-click → listening', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.thinking-end' })
    actor.send({ type: 'agent.stream-end' })
    actor.send({ type: 'ui.pet-click' })
    expect(state(actor.getSnapshot())).toBe('listening')
  })

  it('apologetic 停 3000ms 后自动回 idle 且 lastError 清掉', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.error', error: 'boom' })
    expect(state(actor.getSnapshot())).toBe('apologetic')
    expect(actor.getSnapshot().context.lastError).toBe('boom')

    vi.advanceTimersByTime(3000)
    expect(state(actor.getSnapshot())).toBe('idle')
    expect(actor.getSnapshot().context.lastError).toBe(null)
  })
})

describe('petMachine — entry action 派发', () => {
  it('进入 listening 时调用 playMotion(FlickUp) + showInputBox', () => {
    const playMotion = vi.fn()
    const showInputBox = vi.fn()

    const machine = petMachine.provide({
      actions: {
        playMotion: (_, params) => playMotion(params),
        showInputBox: () => showInputBox()
      }
    })

    const actor = createActor(machine).start()
    actor.send({ type: 'ui.pet-click' })

    expect(playMotion).toHaveBeenCalledWith({ group: 'FlickUp' })
    expect(showInputBox).toHaveBeenCalledTimes(1)
  })

  it('进入 speaking 时调用 playMotion(Tap)', () => {
    const playMotion = vi.fn()
    const machine = petMachine.provide({
      actions: { playMotion: (_, params) => playMotion(params) }
    })
    const actor = createActor(machine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.thinking-end' })

    expect(playMotion).toHaveBeenCalledWith({ group: 'Tap' })
  })

  it('进入 apologetic 时调用 playMotion(FlickDown)', () => {
    const playMotion = vi.fn()
    const machine = petMachine.provide({
      actions: { playMotion: (_, params) => playMotion(params) }
    })
    const actor = createActor(machine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    actor.send({ type: 'agent.error', error: 'boom' })

    expect(playMotion).toHaveBeenCalledWith({ group: 'FlickDown' })
  })

  it('退出 listening 时调用 hideInputBox（送 ui.input-blur 后）', () => {
    const hideInputBox = vi.fn()
    const machine = petMachine.provide({
      actions: { hideInputBox: () => hideInputBox() }
    })
    const actor = createActor(machine).start()
    actor.send({ type: 'ui.pet-click' })
    actor.send({ type: 'ui.input-blur' })

    expect(hideInputBox).toHaveBeenCalledTimes(1)
  })
})

// =====================================================================
// v2.1 W3 NEW —— thinking compound state（deciding/awaitingApproval/acting/observing）
// =====================================================================

describe('petMachine v2.1 — thinking sub-states 初始 + 顶层匹配兼容', () => {
  it('user.send 后进 thinking.deciding', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    expect(state(actor.getSnapshot())).toBe('thinking')
    expect(thinkingSub(actor.getSnapshot())).toBe('deciding')
  })

  it('matches("thinking") 在所有 sub-state 下都 true（W2 渲染层兼容）', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'hi' })
    expect(actor.getSnapshot().matches('thinking')).toBe(true)

    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    expect(actor.getSnapshot().matches('thinking')).toBe(true)
    expect(actor.getSnapshot().matches({ thinking: 'awaitingApproval' })).toBe(true)
  })
})

describe('petMachine v2.1 — awaitingApproval 流程', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('deciding + agent.want-tool → awaitingApproval，且 pendingToolCall 写入 context', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: '列我桌面' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })

    expect(thinkingSub(actor.getSnapshot())).toBe('awaitingApproval')
    expect(actor.getSnapshot().context.pendingToolCall).toEqual(TOOL_CALL)
  })

  it('awaitingApproval + user.approve → acting，toolSteps += 1，pendingToolCall 清空', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: '列我桌面' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    actor.send({ type: 'user.approve' })

    expect(thinkingSub(actor.getSnapshot())).toBe('acting')
    expect(actor.getSnapshot().context.toolSteps).toBe(1)
    expect(actor.getSnapshot().context.pendingToolCall).toBe(null)
  })

  it('awaitingApproval + user.deny → apologetic，记录拒绝原因', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'rm -rf /' })
    actor.send({ type: 'agent.want-tool', payload: { ...TOOL_CALL, scope: 'exec' } })
    actor.send({ type: 'user.deny' })

    expect(state(actor.getSnapshot())).toBe('apologetic')
    expect(actor.getSnapshot().context.lastError).toMatch(/拒绝/)
    expect(actor.getSnapshot().context.pendingToolCall).toBe(null)
  })

  it(`awaitingApproval 超过 ${APPROVAL_TIMEOUT_MS}ms → apologetic（默认拒绝）`, () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'something' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    expect(thinkingSub(actor.getSnapshot())).toBe('awaitingApproval')

    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS + 1)
    expect(state(actor.getSnapshot())).toBe('apologetic')
    expect(actor.getSnapshot().context.lastError).toMatch(/审批超时/)
  })
})

describe('petMachine v2.1 — acting 流程', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('acting + tool.call-end → observing 且 lastToolResult 写入', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'x' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    actor.send({ type: 'user.approve' })
    actor.send({ type: 'tool.call-end', resultSummary: '3 个文件' })

    expect(thinkingSub(actor.getSnapshot())).toBe('observing')
    expect(actor.getSnapshot().context.lastToolResult).toBe('3 个文件')
  })

  it('acting + tool.error → apologetic', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'x' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    actor.send({ type: 'user.approve' })
    actor.send({ type: 'tool.error', error: 'EPERM' })

    expect(state(actor.getSnapshot())).toBe('apologetic')
    expect(actor.getSnapshot().context.lastError).toBe('EPERM')
  })

  it(`acting 超过 ${TOOL_TIMEOUT_MS}ms 无 tool.call-end → apologetic（工具超时）`, () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'x' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    actor.send({ type: 'user.approve' })

    vi.advanceTimersByTime(TOOL_TIMEOUT_MS + 1)
    expect(state(actor.getSnapshot())).toBe('apologetic')
    expect(actor.getSnapshot().context.lastError).toMatch(/工具调用超时/)
  })
})

describe('petMachine v2.1 — observing → 收尾 / ReAct loop', () => {
  it('observing + agent.thinking-end → speaking', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'x' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    actor.send({ type: 'user.approve' })
    actor.send({ type: 'tool.call-end', resultSummary: 'ok' })
    actor.send({ type: 'agent.thinking-end' })

    expect(state(actor.getSnapshot())).toBe('speaking')
  })

  it('observing + agent.stream-end → done', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'x' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    actor.send({ type: 'user.approve' })
    actor.send({ type: 'tool.call-end', resultSummary: 'ok' })
    actor.send({ type: 'agent.stream-end' })

    expect(state(actor.getSnapshot())).toBe('done')
  })

  it('observing + agent.continue → 回 deciding（ReAct 第二步）', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'x' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    actor.send({ type: 'user.approve' })
    actor.send({ type: 'tool.call-end', resultSummary: 'step1' })
    actor.send({ type: 'agent.continue' })

    expect(thinkingSub(actor.getSnapshot())).toBe('deciding')
    expect(actor.getSnapshot().context.toolSteps).toBe(1)
    expect(actor.getSnapshot().context.lastToolResult).toBe('step1')
  })

  it('observing + agent.error → apologetic', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'x' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    actor.send({ type: 'user.approve' })
    actor.send({ type: 'tool.call-end', resultSummary: 'step1' })
    actor.send({ type: 'agent.error', error: 'LLM blew up post-observe' })

    expect(state(actor.getSnapshot())).toBe('apologetic')
    expect(actor.getSnapshot().context.lastError).toBe('LLM blew up post-observe')
  })
})

describe('petMachine v2.1 — MAX_TOOL_STEPS 守卫', () => {
  it(`第 ${MAX_TOOL_STEPS + 1} 步的 want-tool 应被拒，直接 apologetic`, () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'multi-step task' })

    // 跑满 MAX_TOOL_STEPS 步：每步 want-tool → approve → call-end → continue
    for (let i = 0; i < MAX_TOOL_STEPS; i++) {
      actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
      actor.send({ type: 'user.approve' })
      actor.send({ type: 'tool.call-end', resultSummary: `step ${i + 1}` })
      actor.send({ type: 'agent.continue' })
    }
    expect(actor.getSnapshot().context.toolSteps).toBe(MAX_TOOL_STEPS)
    expect(thinkingSub(actor.getSnapshot())).toBe('deciding')

    // 第 MAX_TOOL_STEPS+1 步的 want-tool 必须被守卫拒
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    expect(state(actor.getSnapshot())).toBe('apologetic')
    expect(actor.getSnapshot().context.lastError).toMatch(new RegExp(`${MAX_TOOL_STEPS}`))
  })
})

describe('petMachine v2.1 — context 清理', () => {
  it('进入 idle 清掉 pendingToolCall + toolSteps（apologetic 3s 后 idle）', () => {
    vi.useFakeTimers()
    try {
      const actor = createActor(petMachine).start()
      actor.send({ type: 'user.send', text: 'x' })
      actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
      actor.send({ type: 'user.deny' })

      expect(state(actor.getSnapshot())).toBe('apologetic')
      expect(actor.getSnapshot().context.toolSteps).toBe(0) // apologetic entry 已清

      vi.advanceTimersByTime(3000)
      expect(state(actor.getSnapshot())).toBe('idle')
      expect(actor.getSnapshot().context.pendingToolCall).toBe(null)
      expect(actor.getSnapshot().context.toolSteps).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('进入 done 重置 toolSteps（一轮工具流走完气泡淡出后清零）', () => {
    const actor = createActor(petMachine).start()
    actor.send({ type: 'user.send', text: 'x' })
    actor.send({ type: 'agent.want-tool', payload: TOOL_CALL })
    actor.send({ type: 'user.approve' })
    actor.send({ type: 'tool.call-end', resultSummary: 'ok' })
    actor.send({ type: 'agent.stream-end' })

    expect(state(actor.getSnapshot())).toBe('done')
    expect(actor.getSnapshot().context.toolSteps).toBe(0)
  })
})
