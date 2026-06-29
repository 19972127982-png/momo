/**
 * SQLite 连接 + 迁移（W3 D3）
 *
 * - better-sqlite3 同步 API，主进程里跑没问题（不阻塞 renderer，IPC 是异步的）。
 * - 单例：第一次 getDb() 时打开 + 跑迁移 + 播种单行表。
 * - 数据库落在 userData/echopet.db（与 config.enc / settings.json 同目录）。
 * - WAL 模式：并发读 + 崩溃安全更好。
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import { MIGRATIONS } from './migrations'
import { SkillRepo } from './repo-skills'

export type DB = Database.Database

let db: DB | null = null

function dbPath(): string {
  return path.join(app.getPath('userData'), 'echopet.db')
}

/** 顺序应用所有版本高于 user_version 的迁移 */
function runMigrations(database: DB): void {
  const current = (database.pragma('user_version', { simple: true }) as number) ?? 0
  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version
  )

  for (const m of pending) {
    const tx = database.transaction(() => {
      database.exec(m.sql)
      // user_version 不能用占位符参数，需直接拼数字（version 来自代码常量，安全）
      database.pragma(`user_version = ${m.version}`)
    })
    tx()
  }
}

/** 播种单行表（pet_personality / user_profile），幂等 */
function seedSingletons(database: DB): void {
  const now = Date.now()
  database.prepare(`INSERT OR IGNORE INTO pet_personality (id, created_at) VALUES (1, ?)`).run(now)
  database
    .prepare(`INSERT OR IGNORE INTO user_profile (id, data, updated_at) VALUES (1, '{}', ?)`)
    .run(now)
  // W4：播种 3 个内置 Skill（仅插入缺失的，不覆盖用户 enabled）
  new SkillRepo(database).seed(now)
}

export function getDb(): DB {
  if (db) return db
  const database = new Database(dbPath())
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  runMigrations(database)
  seedSingletons(database)
  db = database
  return db
}

/** 测试 / 多实例场景：用注入的 Database 初始化（如 :memory:） */
export function initDbWith(database: DB): DB {
  database.pragma('journal_mode = WAL')
  runMigrations(database)
  seedSingletons(database)
  db = database
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
