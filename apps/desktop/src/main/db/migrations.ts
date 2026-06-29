/**
 * SQLite 迁移定义（W3 D3）
 *
 * 设计：
 *   - 迁移以 TS 数组形式内联 SQL 字符串（不读 .sql 文件）—— electron-vite 会把 main
 *     打成单 bundle，外部 .sql 文件不会被复制；内联最稳。
 *   - 版本管理用 `PRAGMA user_version`，connection.ts 的 runMigrations 顺序应用。
 *   - 单用户单桌宠：pet_personality / user_profile 都是单行表，固定主键 id = 1。
 *
 * 表（PRD §6 桌面端）：
 *   - conversation_messages : 工作记忆（每轮 append）
 *   - user_profile          : 结构化用户画像（JSON blob 单行）
 *   - pet_personality       : 三维性格向量 + 互动总数（单行）
 *   - evolution_log         : 性格漂移轨迹（D5 写入，作品集画图数据源）
 *
 * 情景记忆（episodic）在 D4 接 ChromaDB，不落 SQLite，这里不建表。
 */

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
-- 工作记忆：每轮对话消息
CREATE TABLE IF NOT EXISTS conversation_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  role         TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content      TEXT    NOT NULL,
  ts           INTEGER NOT NULL,
  tool_call_id TEXT,
  tool_name    TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON conversation_messages (ts);

-- 用户画像：单行 JSON
CREATE TABLE IF NOT EXISTS user_profile (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT    NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- 性格状态：单行三维向量（PRD §4.5 初始锚点）
CREATE TABLE IF NOT EXISTS pet_personality (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  persona_name       TEXT    NOT NULL DEFAULT '小桃',
  energy             REAL    NOT NULL DEFAULT 0.0,
  attachment         REAL    NOT NULL DEFAULT 0.2,
  sensitivity        REAL    NOT NULL DEFAULT -0.3,
  total_interactions INTEGER NOT NULL DEFAULT 0,
  last_evolved_at    INTEGER,
  created_at         INTEGER NOT NULL
);

-- 性格漂移日志（D5 写入）
CREATE TABLE IF NOT EXISTS evolution_log (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                     INTEGER NOT NULL,
  delta_energy           REAL    NOT NULL,
  delta_attachment       REAL    NOT NULL,
  delta_sensitivity      REAL    NOT NULL,
  state_after_energy     REAL    NOT NULL,
  state_after_attachment REAL    NOT NULL,
  state_after_sensitivity REAL   NOT NULL,
  trigger_msg_snippet    TEXT
);
CREATE INDEX IF NOT EXISTS idx_evolution_ts ON evolution_log (ts);
`
  }
]
