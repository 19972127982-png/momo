/**
 * Main / preload / renderer 共享的 IPC 数据形状。
 *
 * 放在 shared/ 下是因为 main 进程的 configStore 和 personality 都要定义 / 返回，
 * preload 暴露这些 API 时要类型，renderer 拿到 echopet.config.getSettings() 的
 * 返回值也是这个类型 —— 三者用同一个 source of truth 避免漂移。
 */

export interface AppSettings {
  /** 人格名字（PRD §4.5：静态底色 = 小桃） */
  petName: string
  /** 桌宠该如何称呼你（可空） */
  userNickname: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  petName: '小桃',
  userNickname: ''
}

/**
 * 性格演化引擎的对外快照。
 *
 * W2 由 main/personality.ts 返回 mock 值；W3 起接真实引擎时替换实现不动接口。
 *
 * 三维向量 0~1，定义见 PRD §4.5：
 *   - energy        活力：内向 ↔ 外向
 *   - attachment    依恋：疏离 ↔ 黏人
 *   - sensitivity   敏感度：迟钝 ↔ 敏感
 *
 * 成长阶段按互动总数推导：
 *   < 30   → 初识
 *   < 100  → 熟悉
 *   < 250  → 亲密
 *   ≥ 250  → 挚友
 */
export interface PersonalitySnapshot {
  energy: number
  attachment: number
  sensitivity: number
  interactions: number
  stage: '初识' | '熟悉' | '亲密' | '挚友'
}

/** W4 D5：设置面板 Skills tab 的一行（main SkillManager.list 返回） */
export interface SkillView {
  id: string
  name: string
  enabled: boolean
  servers: string[]
  promptAddon: string
}

/** W4 D6：Tools tab —— 一个内置 MCP server 的健康状态 */
export interface ServerStatusView {
  id: string
  label: string
  capability: string
  agent: string
  kind: 'stdio' | 'local'
  health: 'running' | 'failed' | 'stopped'
  toolCount: number
}

/** W4 D6：Permissions tab —— 一条永久授权 */
export interface GrantView {
  id: number
  scope: 'read' | 'write' | 'exec' | 'network'
  targetPattern: string
  agentName?: string
  serverId?: string
  grantedAt: number
  expiresAt: number | null
  revokedAt: number | null
}

/** W4 D6：Permissions tab —— 一条工具调用审计 */
export interface ToolLogView {
  id: number
  ts: number
  agentName?: string
  serverId?: string
  toolName: string
  argsSummary?: string
  resultSummary?: string
  ok: boolean
  latencyMs?: number
  deniedReason?: string
}
