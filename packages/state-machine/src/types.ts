/**
 * 桌宠行为状态 —— 顶层 6 个，严格按 docs/STATE-MACHINE.md
 *
 * v2.1 (W3 NEW)：`thinking` 是 compound state，包含 4 个 sub-state：
 *   - deciding：LLM 决策中（陪伴：直接出文 / 工作：判定要不要 tool_call）
 *   - awaitingApproval：工具调用等待用户审批（W4 启用 UI，W3 host 侧自动 approve）
 *   - acting：工具调用执行中
 *   - observing：拿到 tool_result，喂回 LLM 决定下一步（可触发 ReAct loop）
 *
 * 顶层 `state.matches('thinking')` 在任一 sub-state 下都为 true，
 * W2 的 renderer 代码继续兼容；新代码可用 `state.matches({ thinking: 'acting' })` 精细判定。
 */
export type PetState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'done' | 'apologetic'

export type PetThinkingSubState = 'deciding' | 'awaitingApproval' | 'acting' | 'observing'

/**
 * 触发状态机的事件 —— UI 操作 / Agent 内部状态 / 工具调用结果
 *
 * 命名规则：`<source>.<verb>` —— XState 5 推荐用 `.` 而不是 `/`，但都合法。
 */
export type PetEvent =
  // ---- W2 已有 ----
  | { type: 'ui.pet-click' }
  | { type: 'ui.input-blur' }
  | { type: 'user.send'; text: string }
  | { type: 'agent.thinking-end' }
  | { type: 'agent.stream-chunk'; text: string }
  | { type: 'agent.stream-end' }
  | { type: 'agent.error'; error: string }
  // ---- v2.1 W3 NEW ----
  /** LLM 决定调工具 —— payload 给 UI / permGate 用 */
  | { type: 'agent.want-tool'; payload: PendingToolCall }
  /** observing 后 LLM 决定继续 ReAct loop 而非收尾 */
  | { type: 'agent.continue' }
  /** 用户审批通过（W3：host 自动派发；W4：UI 弹 toast 用户点 Approve） */
  | { type: 'user.approve' }
  /** 用户拒绝审批（W4 启用） */
  | { type: 'user.deny' }
  /** 工具调用完成 */
  | { type: 'tool.call-end'; resultSummary: string }
  /** 工具调用失败 */
  | { type: 'tool.error'; error: string }

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

/** v2.1 NEW —— awaitingApproval 状态下 UI 渲染所需信息 */
export interface PendingToolCall {
  /** 'FileAgent' / 'SystemAgent' / ... */
  agentName: string
  /** MCP server id：'filesystem' / 'git' / ... */
  serverId: string
  /** MCP tool name：'list_directory' / 'write_file' / ... */
  toolName: string
  /** 完整参数 JSON 序列化后前 200 字 */
  argsSummary: string
  /** 影响审批 UX：read 默认放行 / write 要审批 / exec 要双重审批 */
  scope: 'read' | 'write' | 'exec' | 'network'
}

export interface PetContext {
  /** 累积的 streaming 文本，speaking 状态进入时清空 */
  streamText: string
  /** 最近一次错误信息，用于 apologetic 状态下的气泡 */
  lastError: string | null
  // ---- v2.1 W3 NEW ----
  /** awaitingApproval 时 UI 用来显示「要不要调 X 工具」 */
  pendingToolCall: PendingToolCall | null
  /** 当前 ReAct loop 已经走过的步数；进入 idle / done / apologetic 时重置 */
  toolSteps: number
  /** 最近一次工具调用结果摘要 —— observing 状态用来做下一轮决策 */
  lastToolResult: string | null
}
