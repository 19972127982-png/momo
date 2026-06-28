import type { PersonalitySnapshot } from '../shared/ipcTypes'

/**
 * W2 阶段的性格引擎占位 —— 返回静态 mock。
 * W3 接入真实演化引擎（PRD §4.5）时：
 *   - 把 MOCK 换成 SQLite `pet_personality` 表的 read
 *   - delta 计算流程见 PRD §4.5.4
 */

const MOCK = {
  energy: 0.62,
  attachment: 0.78,
  sensitivity: 0.55,
  interactions: 0
}

function deriveStage(n: number): PersonalitySnapshot['stage'] {
  if (n < 30) return '初识'
  if (n < 100) return '熟悉'
  if (n < 250) return '亲密'
  return '挚友'
}

export function getPersonalitySnapshot(): PersonalitySnapshot {
  return {
    energy: MOCK.energy,
    attachment: MOCK.attachment,
    sensitivity: MOCK.sensitivity,
    interactions: MOCK.interactions,
    stage: deriveStage(MOCK.interactions)
  }
}
