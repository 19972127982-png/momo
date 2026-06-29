/**
 * 工具调用审计 repo —— tool_call_logs（W4 D1，append-only）
 *
 * 每次 tool_call（成功 / 失败 / 拒绝）都写一行；Permissions tab 审计 + W5 评测数据源。
 */
import type { DB } from './connection'

export interface ToolCallLogEntry {
  ts: number
  agentName?: string
  serverId?: string
  toolName: string
  argsSummary?: string
  resultSummary?: string
  ok: boolean
  latencyMs?: number
  /** 被权限闸拒绝时的原因（denied / timeout 等）；放行执行的留空 */
  deniedReason?: string
}

export interface StoredToolCallLog extends ToolCallLogEntry {
  id: number
}

export interface ToolLogQuery {
  agentName?: string
  /** 只看某 ts 之后 */
  since?: number
  limit?: number
}

interface LogRow {
  id: number
  ts: number
  agent_name: string | null
  server_id: string | null
  tool_name: string
  args_summary: string | null
  result_summary: string | null
  ok: number
  latency_ms: number | null
  denied_reason: string | null
}

function rowToLog(row: LogRow): StoredToolCallLog {
  return {
    id: row.id,
    ts: row.ts,
    agentName: row.agent_name ?? undefined,
    serverId: row.server_id ?? undefined,
    toolName: row.tool_name,
    argsSummary: row.args_summary ?? undefined,
    resultSummary: row.result_summary ?? undefined,
    ok: row.ok === 1,
    latencyMs: row.latency_ms ?? undefined,
    deniedReason: row.denied_reason ?? undefined
  }
}

export class ToolLogRepo {
  constructor(private readonly db: DB) {}

  append(entry: ToolCallLogEntry): number {
    const info = this.db
      .prepare(
        `INSERT INTO tool_call_logs (
           ts, agent_name, server_id, tool_name, args_summary,
           result_summary, ok, latency_ms, denied_reason
         ) VALUES (@ts, @agent, @server, @tool, @args, @result, @ok, @latency, @denied)`
      )
      .run({
        ts: entry.ts,
        agent: entry.agentName ?? null,
        server: entry.serverId ?? null,
        tool: entry.toolName,
        args: entry.argsSummary ?? null,
        result: entry.resultSummary ?? null,
        ok: entry.ok ? 1 : 0,
        latency: entry.latencyMs ?? null,
        denied: entry.deniedReason ?? null
      })
    return Number(info.lastInsertRowid)
  }

  /** 倒序最近 N 条，可按 agent / 起始时间筛选。默认 100 条。 */
  recent(query: ToolLogQuery = {}): StoredToolCallLog[] {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (query.agentName) {
      where.push('agent_name = @agent')
      params.agent = query.agentName
    }
    if (query.since != null) {
      where.push('ts >= @since')
      params.since = query.since
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const limit = query.limit ?? 100
    const rows = this.db
      .prepare(`SELECT * FROM tool_call_logs ${whereSql} ORDER BY ts DESC LIMIT @limit`)
      .all({ ...params, limit }) as LogRow[]
    return rows.map(rowToLog)
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM tool_call_logs`).get() as {
      c: number
    }
    return row.c
  }

  /** 删除 ts 早于 cutoff 的日志（PRD §8.1：30 天自动清理），返回删除条数。 */
  purgeOlderThan(cutoffTs: number): number {
    const info = this.db
      .prepare(`DELETE FROM tool_call_logs WHERE ts < @cutoff`)
      .run({ cutoff: cutoffTs })
    return info.changes
  }
}
