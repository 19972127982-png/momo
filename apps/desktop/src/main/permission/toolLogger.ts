/**
 * 工具调用审计记录器（W4 D2）—— 薄封装 ToolLogRepo
 *
 * 每次 tool_call（放行执行 / 被拒）都写一行。失败不抛（审计不该影响主流程）。
 */
import {
  ToolLogRepo,
  type StoredToolCallLog,
  type ToolCallLogEntry,
  type ToolLogQuery
} from '../db/repo-tool-logs'
import type { DB } from '../db/connection'

export class ToolLogger {
  private readonly repo: ToolLogRepo

  constructor(db: DB) {
    this.repo = new ToolLogRepo(db)
  }

  log(entry: ToolCallLogEntry): void {
    try {
      this.repo.append(entry)
    } catch (err) {
      console.warn('[tool-log] 写审计失败（已忽略）', err)
    }
  }

  /** Permissions tab：倒序最近 N 条审计（可按 agent / 起始时间筛选）。 */
  recent(query: ToolLogQuery = {}): StoredToolCallLog[] {
    return this.repo.recent(query)
  }

  count(): number {
    return this.repo.count()
  }
}
