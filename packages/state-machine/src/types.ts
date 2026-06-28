/**
 * 桌宠行为状态 —— 6 个，严格按 docs/STATE-MACHINE.md
 */
export type PetState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'done' | 'apologetic'

/**
 * 触发状态机的事件 —— UI 操作 / Agent 内部状态
 *
 * 命名规则：`<source>.<verb>` —— XState 5 推荐用 `.` 而不是 `/`，但都合法。
 */
export type PetEvent =
  | { type: 'ui.pet-click' }
  | { type: 'ui.input-blur' }
  | { type: 'user.send'; text: string }
  | { type: 'agent.thinking-end' }
  | { type: 'agent.stream-chunk'; text: string }
  | { type: 'agent.stream-end' }
  | { type: 'agent.error'; error: string }

/**
 * 状态进入时由 effect runner 派发的动作。
 * Renderer 订阅 actor，看到这些动作就调对应的 Live2D / UI API。
 */
export type PetMotionGroup =
  | 'Idle'
  | 'Tap'
  | 'Tap@Body'
  | 'Flick'
  | 'FlickUp'
  | 'FlickDown'

export interface PetContext {
  /** 累积的 streaming 文本，speaking 状态进入时清空 */
  streamText: string
  /** 最近一次错误信息，用于 apologetic 状态下的气泡 */
  lastError: string | null
}
