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
 *   - episodic_memories     : 情景记忆事件卡片（D4，关键词召回；向量召回 W5 升级）
 *   - app_meta              : 通用 KV（D4，存摘要游标等进程间持久化的小状态）
 *   - skills / mcp_servers  : W4 Skills 框架（启用态 + server 配置）
 *   - permission_grants     : W4 权限闸（永久授权，expires_at NULL=永久）
 *   - tool_call_logs        : W4 工具调用审计（append-only）
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
  },
  {
    version: 2,
    name: 'episodic_memory',
    sql: `
-- 情景记忆：摘要 Agent 提炼的事件卡片（D4 关键词召回）
-- keywords 单列存 JSON 数组，便于召回打分；metadata 存其它附加信息
CREATE TABLE IF NOT EXISTS episodic_memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  summary    TEXT    NOT NULL,
  event_type TEXT,
  keywords   TEXT    NOT NULL DEFAULT '[]',
  ts         INTEGER NOT NULL,
  metadata   TEXT
);
CREATE INDEX IF NOT EXISTS idx_episodic_ts ON episodic_memories (ts);

-- 通用 KV：摘要游标（episodic_last_msg_id）等进程间持久化小状态
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
  },
  {
    version: 3,
    name: 'tools_skills_permissions',
    sql: `
-- Skills 内置包启用态（id 对齐 agent-core BUILTIN_SKILLS：dev/file-butler/bare）
CREATE TABLE IF NOT EXISTS skills (
  id               TEXT    PRIMARY KEY,
  name             TEXT    NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 0,
  included_servers TEXT    NOT NULL DEFAULT '[]',
  prompt_addon     TEXT    NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL
);

-- MCP server 配置 + 健康状态（启用的会被动态 spawn）
CREATE TABLE IF NOT EXISTS mcp_servers (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  transport    TEXT    NOT NULL DEFAULT 'stdio' CHECK (transport IN ('stdio', 'sse')),
  command      TEXT,
  args         TEXT    NOT NULL DEFAULT '[]',
  env          TEXT    NOT NULL DEFAULT '{}',
  capabilities TEXT    NOT NULL DEFAULT '[]',
  status       TEXT    NOT NULL DEFAULT 'stopped' CHECK (status IN ('running', 'stopped', 'degraded')),
  last_ping_at INTEGER,
  enabled      INTEGER NOT NULL DEFAULT 0
);

-- 权限闸：永久授权（expires_at NULL=永久；revoked_at 非空=已撤销）
CREATE TABLE IF NOT EXISTS permission_grants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scope          TEXT    NOT NULL CHECK (scope IN ('read', 'write', 'exec', 'network')),
  target_pattern TEXT    NOT NULL,
  agent_name     TEXT,
  server_id      TEXT,
  granted_at     INTEGER NOT NULL,
  expires_at     INTEGER,
  revoked_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_grants_scope ON permission_grants (scope);

-- 工具调用审计（append-only，审计 + W5 评测数据源）
CREATE TABLE IF NOT EXISTS tool_call_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             INTEGER NOT NULL,
  agent_name     TEXT,
  server_id      TEXT,
  tool_name      TEXT    NOT NULL,
  args_summary   TEXT,
  result_summary TEXT,
  ok             INTEGER NOT NULL DEFAULT 0,
  latency_ms     INTEGER,
  denied_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_logs_ts ON tool_call_logs (ts);
CREATE INDEX IF NOT EXISTS idx_tool_logs_agent ON tool_call_logs (agent_name);
`
  },
  {
    version: 4,
    name: 'skills_reconcile_drop_dev_enable_filebutler',
    sql: `
-- DevAgent（git）暂不做：清掉旧的「开发者助手」Skill 行
DELETE FROM skills WHERE id = 'dev';
-- 文件管家一次性默认启用（开箱即用；之后用户可自行关闭，本迁移只跑一次）
UPDATE skills SET enabled = 1 WHERE id = 'file-butler';
`
  }
]
