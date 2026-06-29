import type { PersonalitySnapshot } from '../shared/ipcTypes'
import { deriveGrowthStage, type PersonalityState } from '@echopet/agent-core'

/**
 * 把性格向量 + 互动总数组装成对外快照（供设置面板 / 状态条展示）。
 *
 * W2 时这里返回静态 mock；W3 D3 起真实数据来自 SQLite `pet_personality`，
 * 本文件退化为纯组装函数，由 index.ts 从 SqliteMemoryStore 取数后调用。
 */
export function buildPersonalitySnapshot(
  vector: PersonalityState,
  interactions: number
): PersonalitySnapshot {
  return {
    energy: vector.energy,
    attachment: vector.attachment,
    sensitivity: vector.sensitivity,
    interactions,
    stage: deriveGrowthStage(interactions)
  }
}
