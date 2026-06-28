/**
 * Hiyori 的「状态」定义 —— 严格 1:1 映射资源里的 motion group。
 *
 * 来源：apps/desktop/public/live2d/hiyori/hiyori_pro_t11.model3.json#FileReferences.Motions
 *
 *   Idle        m01 m02 m05   —— 待机
 *   Tap         m07 m08       —— 头部被点击
 *   Tap@Body    m09           —— 身体被点击
 *   Flick       m03           —— 脸部横扫
 *   FlickUp     m06           —— 上滑
 *   FlickDown   m04           —— 下滑
 *   Flick@Body  m10           —— 身体被横扫
 *
 * W1：每个 group 一个按钮，不做情感解释。W3 接 LLM 后再做「情绪 → 状态」映射。
 *
 * group 名严禁修改 —— 必须和 model3.json 字面量一致，否则 motion(group) 会 404。
 */

export type StateKey =
  | 'idle'
  | 'tap'
  | 'tapBody'
  | 'flick'
  | 'flickUp'
  | 'flickDown'

export interface StateMeta {
  key: StateKey
  /** model3.json 里的 motion group 原名，对外只读 */
  group: string
  label: string
  /** 该 group 内的 motion 数量，来自 model3.json */
  count: number
  /** 中性视觉占位（仅指示触发位置/方向，不暗示情绪） */
  icon: string
}

/**
 * Idle 是默认状态 —— pixi-live2d-display 在无其他 motion 时会自动从 Idle group
 * 抽一个播，所以这里不需要专门给「待机」做按钮触发；但仍保留在列表里供 debug 手动触发。
 *
 * 已剔除 Flick@Body（扫身）—— 该 motion 位移幅度大，与「脚钉画布底」的视觉锚点冲突。
 */
export const STATES: readonly StateMeta[] = [
  { key: 'idle', group: 'Idle', label: '待机', count: 3, icon: '💤' },
  { key: 'tap', group: 'Tap', label: '点头', count: 2, icon: '👆' },
  { key: 'tapBody', group: 'Tap@Body', label: '点身', count: 1, icon: '✋' },
  { key: 'flick', group: 'Flick', label: '扫脸', count: 1, icon: '↔️' },
  { key: 'flickUp', group: 'FlickUp', label: '上滑', count: 1, icon: '⬆️' },
  { key: 'flickDown', group: 'FlickDown', label: '下滑', count: 1, icon: '⬇️' }
] as const

export const STATE_BY_KEY: Record<StateKey, StateMeta> = STATES.reduce(
  (acc, s) => {
    acc[s.key] = s
    return acc
  },
  {} as Record<StateKey, StateMeta>
)
