/**
 * 用户画像 repo —— user_profile 单行 JSON
 */
import type { UserProfile } from '@echopet/agent-core'
import type { DB } from './connection'

export class ProfileRepo {
  constructor(private readonly db: DB) {}

  get(): UserProfile {
    const row = this.db
      .prepare(`SELECT data FROM user_profile WHERE id = 1`)
      .get() as { data: string } | undefined
    if (!row) return {}
    try {
      const parsed = JSON.parse(row.data) as UserProfile
      return parsed ?? {}
    } catch {
      return {}
    }
  }

  set(profile: UserProfile): void {
    this.db
      .prepare(
        `UPDATE user_profile SET data = @data, updated_at = @updated_at WHERE id = 1`
      )
      .run({ data: JSON.stringify(profile ?? {}), updated_at: Date.now() })
  }
}
