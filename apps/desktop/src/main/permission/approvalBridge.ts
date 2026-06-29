/**
 * 审批回环（W4 D3）—— 主进程 ↔ renderer 的「请求授权 → 等用户点 toast → 拿结果」
 *
 * - request()：生成 reqId，向 renderer 发 'permission:request'，返回一个 Promise，
 *   在「用户响应 / 30s 超时 / 本轮 abort / 窗口销毁」任一发生时 resolve。
 * - resolve()：renderer 点了 toast，ipcMain('permission:respond') 调它喂回结果。
 * - 默认拒绝：超时 / abort / 窗口没了都按 'deny' 处理（PRD §4.6.4 默认拒绝兜底）。
 */
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { GrantGrade, ToolScope } from '@echopet/agent-core'

const APPROVAL_TIMEOUT_MS = 30_000

export interface ApprovalRequestPayload {
  reqId: string
  scope: ToolScope
  /** 目标（路径等），renderer 拼审批文案用 */
  target: string
  agentName: string
  toolName: string
}

interface Pending {
  resolve: (grade: GrantGrade) => void
  timer: NodeJS.Timeout
}

class ApprovalBridge {
  private pending = new Map<string, Pending>()

  /**
   * 发起一次审批，等用户响应。signal 触发（本轮对话被打断）或 30s 超时 → 默认 'deny'。
   */
  request(
    sender: WebContents,
    input: Omit<ApprovalRequestPayload, 'reqId'>,
    signal?: AbortSignal
  ): Promise<GrantGrade> {
    const reqId = randomUUID()

    return new Promise<GrantGrade>((resolve) => {
      const settle = (grade: GrantGrade): void => {
        const p = this.pending.get(reqId)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(reqId)
        signal?.removeEventListener('abort', onAbort)
        resolve(grade)
      }

      const onAbort = (): void => settle('deny')

      const timer = setTimeout(() => settle('deny'), APPROVAL_TIMEOUT_MS)
      this.pending.set(reqId, { resolve: settle, timer })

      if (signal) {
        if (signal.aborted) {
          settle('deny')
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      if (sender.isDestroyed()) {
        settle('deny')
        return
      }
      const payload: ApprovalRequestPayload = { reqId, ...input }
      sender.send('permission:request', payload)
    })
  }

  /** renderer 点了 toast（once/session/forever/deny）。未知 reqId 静默忽略。 */
  resolve(reqId: string, grade: GrantGrade): void {
    this.pending.get(reqId)?.resolve(grade)
  }
}

export const approvalBridge = new ApprovalBridge()
