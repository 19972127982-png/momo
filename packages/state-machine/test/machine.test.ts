import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createActor, type Snapshot } from 'xstate'
import { petMachine } from '../src/machine'
import type { PetState } from '../src/types'

/** 工具：取当前状态值（顶层 state，平面化好对比） */
function state(snapshot: Snapshot<unknown>): PetState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (snapshot as any).value as PetState
}

describe('petMachine — 核心状态转移', () => {
  it('初始状态是 idle，context 干净', () => {
    const actor = createActor(petMachine).start()
    expect(state(actor.getSnapshot())).toBe('idle')
    expect(actor.getSnapshot().context).toEqual({ streamText: '', lastError: null })
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
