/**
 * 工具调用审计记录器（W4 D2）—— 薄封装 ToolLogRepo
 *
 * 每次 tool_call（放行执行 / 被拒）都写一行。失败不抛（审计不该影响主流程）。
 */
import { ToolLogRepo, type ToolCallLogEntry } from '../db/repo-tool-logs'
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
}
