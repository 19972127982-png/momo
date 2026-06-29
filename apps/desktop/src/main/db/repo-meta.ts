/**
 * 通用 KV repo —— app_meta（W3 D4）
 *
 * 存进程间需要持久化的小状态，目前用于摘要游标（episodic_last_msg_id）：
 * 记录「上次摘要已覆盖到的最大 message id」，避免重启后重复摘要同一批对话。
 */
import type { DB } from './connection'

export class MetaRepo {
  constructor(private readonly db: DB) {}

  get(key: string): string | null {
    const row = this.db
      .prepare(`SELECT value FROM app_meta WHERE key = ?`)
      .get(key) as { value: string } | undefined
    return row ? row.value : null
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }

  getNumber(key: string, fallback = 0): number {
    const raw = this.get(key)
    if (raw === null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  }

  setNumber(key: string, value: number): void {
    this.set(key, String(value))
  }
}
