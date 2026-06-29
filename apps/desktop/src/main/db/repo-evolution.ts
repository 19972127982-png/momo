/**
 * 性格漂移日志 repo —— evolution_log（D5 写入，作品集漂移轨迹图数据源）
 */
import type { PersonalityState } from '@echopet/agent-core'
import type { DB } from './connection'

export interface EvolutionLogEntry {
  ts: number
  delta: PersonalityState
  stateAfter: PersonalityState
  triggerMsgSnippet: string
}

export class EvolutionRepo {
  constructor(private readonly db: DB) {}

  append(entry: EvolutionLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO evolution_log (
           ts, delta_energy, delta_attachment, delta_sensitivity,
           state_after_energy, state_after_attachment, state_after_sensitivity,
           trigger_msg_snippet
         ) VALUES (
           @ts, @de, @da, @ds, @sae, @saa, @sas, @snippet
         )`
      )
      .run({
        ts: entry.ts,
        de: entry.delta.energy,
        da: entry.delta.attachment,
        ds: entry.delta.sensitivity,
        sae: entry.stateAfter.energy,
        saa: entry.stateAfter.attachment,
        sas: entry.stateAfter.sensitivity,
        snippet: entry.triggerMsgSnippet.slice(0, 50)
      })
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM evolution_log`).get() as {
      c: number
    }
    return row.c
  }
}
