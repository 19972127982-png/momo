/**
 * 性格状态 repo —— pet_personality 单行
 */
import type { PersonalityState } from '@echopet/agent-core'
import type { DB } from './connection'

export interface PersonalityRow {
  persona_name: string
  energy: number
  attachment: number
  sensitivity: number
  total_interactions: number
  last_evolved_at: number | null
  created_at: number
}

export class PersonalityRepo {
  constructor(private readonly db: DB) {}

  getRow(): PersonalityRow {
    const row = this.db
      .prepare(`SELECT * FROM pet_personality WHERE id = 1`)
      .get() as PersonalityRow | undefined
    // seedSingletons 保证行存在，但兜底一份默认值（PRD §4.5 锚点）
    return (
      row ?? {
        persona_name: '小桃',
        energy: 0,
        attachment: 0.2,
        sensitivity: -0.3,
        total_interactions: 0,
        last_evolved_at: null,
        created_at: Date.now()
      }
    )
  }

  getVector(): PersonalityState {
    const r = this.getRow()
    return { energy: r.energy, attachment: r.attachment, sensitivity: r.sensitivity }
  }

  /** 更新三维向量（D5 演化引擎 clamp 后调用），同时记录 last_evolved_at */
  setVector(next: PersonalityState): void {
    this.db
      .prepare(
        `UPDATE pet_personality
         SET energy = @energy, attachment = @attachment, sensitivity = @sensitivity,
             last_evolved_at = @ts
         WHERE id = 1`
      )
      .run({ ...next, ts: Date.now() })
  }

  /** 互动计数 +1，返回新值 */
  incrementInteractions(): number {
    this.db
      .prepare(
        `UPDATE pet_personality SET total_interactions = total_interactions + 1 WHERE id = 1`
      )
      .run()
    return this.getTotalInteractions()
  }

  getTotalInteractions(): number {
    const row = this.db
      .prepare(`SELECT total_interactions AS n FROM pet_personality WHERE id = 1`)
      .get() as { n: number } | undefined
    return row?.n ?? 0
  }
}
