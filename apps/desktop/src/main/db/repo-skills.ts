/**
 * Skills repo —— skills 表（W4 D1）
 *
 * 启用态持久化。行的内容（name / included_servers / prompt_addon）以 agent-core
 * BUILTIN_SKILLS 为准，首次启动播种；用户只切换 enabled。
 */
import { BUILTIN_SKILLS } from '@echopet/agent-core'
import type { DB } from './connection'

export interface SkillRow {
  id: string
  name: string
  enabled: boolean
  includedServers: string[]
  promptAddon: string
  createdAt: number
}

interface RawSkillRow {
  id: string
  name: string
  enabled: number
  included_servers: string
  prompt_addon: string
  created_at: number
}

function parseServers(raw: string): string[] {
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return arr.filter((s): s is string => typeof s === 'string')
  } catch {
    /* ignore */
  }
  return []
}

function rowTo(row: RawSkillRow): SkillRow {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    includedServers: parseServers(row.included_servers),
    promptAddon: row.prompt_addon,
    createdAt: row.created_at
  }
}

export class SkillRepo {
  constructor(private readonly db: DB) {}

  /** 幂等播种内置包（仅插入缺失的，不覆盖用户的 enabled）。defaultEnabled 决定首播时是否开。 */
  seed(now: number): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO skills (id, name, enabled, included_servers, prompt_addon, created_at)
       VALUES (@id, @name, @enabled, @servers, @addon, @now)`
    )
    const tx = this.db.transaction(() => {
      for (const s of BUILTIN_SKILLS) {
        stmt.run({
          id: s.id,
          name: s.name,
          enabled: s.defaultEnabled ? 1 : 0,
          servers: JSON.stringify(s.servers),
          addon: s.promptAddon,
          now
        })
      }
    })
    tx()
  }

  all(): SkillRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM skills ORDER BY created_at ASC`)
      .all() as RawSkillRow[]
    return rows.map(rowTo)
  }

  get(id: string): SkillRow | null {
    const row = this.db.prepare(`SELECT * FROM skills WHERE id = @id`).get({ id }) as
      | RawSkillRow
      | undefined
    return row ? rowTo(row) : null
  }

  /** 切换启用态；返回是否命中。 */
  setEnabled(id: string, enabled: boolean): boolean {
    const info = this.db
      .prepare(`UPDATE skills SET enabled = @enabled WHERE id = @id`)
      .run({ id, enabled: enabled ? 1 : 0 })
    return info.changes > 0
  }

  /** 当前启用的 skill id 列表。 */
  enabledIds(): string[] {
    const rows = this.db
      .prepare(`SELECT id FROM skills WHERE enabled = 1 ORDER BY created_at ASC`)
      .all() as { id: string }[]
    return rows.map((r) => r.id)
  }
}
