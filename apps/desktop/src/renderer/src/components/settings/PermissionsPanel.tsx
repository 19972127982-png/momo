import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GrantView, ToolLogView } from '../../../../shared/ipcTypes'

/**
 * 设置 · 权限（W4 D6）
 *
 * 上半：永久授权列表 —— 撤销单条 / 一键全撤（对齐 PRD §8.1）。
 * 下半：工具调用审计 —— 按 Agent 筛选 + 导出 JSON。
 */
const SCOPE_LABEL: Record<GrantView['scope'], string> = {
  read: '读取',
  write: '写入',
  exec: '执行',
  network: '联网'
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function grantState(g: GrantView): 'revoked' | 'expired' | 'active' {
  if (g.revokedAt) return 'revoked'
  if (g.expiresAt != null && g.expiresAt <= Date.now()) return 'expired'
  return 'active'
}

export default function PermissionsPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const [grants, setGrants] = useState<GrantView[]>([])
  const [logs, setLogs] = useState<ToolLogView[]>([])
  const [agentFilter, setAgentFilter] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void window.echopet?.permissions.listGrants().then(setGrants)
    void window.echopet?.permissions
      .listLogs({ agentName: agentFilter || undefined, limit: 200 })
      .then(setLogs)
  }, [agentFilter])

  useEffect(() => {
    if (visible) refresh()
  }, [visible, refresh])

  const agents = useMemo(() => {
    const set = new Set<string>()
    for (const l of logs) if (l.agentName) set.add(l.agentName)
    return [...set]
  }, [logs])

  const revoke = async (id: number): Promise<void> => {
    setBusy(true)
    await window.echopet?.permissions.revoke(id)
    refresh()
    setBusy(false)
  }

  const revokeAll = async (): Promise<void> => {
    setBusy(true)
    const r = await window.echopet?.permissions.revokeAll()
    setNotice(r ? `已撤销 ${r.count} 条授权` : null)
    refresh()
    setBusy(false)
  }

  const exportLogs = async (): Promise<void> => {
    const r = await window.echopet?.permissions.exportLogs()
    if (r?.ok) setNotice(`已导出 ${r.count} 条到 ${r.path}`)
    else if (r && r.error !== 'cancelled') setNotice(`导出失败：${r.error}`)
  }

  const activeCount = grants.filter((g) => grantState(g) === 'active').length

  return (
    <>
      <div className="config-dialog__section">
        <div className="config-dialog__section-title">
          永久授权
          <span className="config-dialog__section-tag">{activeCount} 条有效</span>
          {activeCount > 0 && (
            <button
              className="perm-link-btn"
              disabled={busy}
              onClick={() => void revokeAll()}
              type="button"
            >
              全部撤销
            </button>
          )}
        </div>
        <div className="grant-list">
          {grants.length === 0 && (
            <div className="config-dialog__hint">还没有永久授权 —— 审批时选「永久」才会留痕。</div>
          )}
          {grants.map((g) => {
            const state = grantState(g)
            return (
              <div key={g.id} className={`grant-row grant-row--${state}`}>
                <div className="grant-row__main">
                  <span className={`grant-scope grant-scope--${g.scope}`}>
                    {SCOPE_LABEL[g.scope]}
                  </span>
                  <span className="grant-row__target" title={g.targetPattern}>
                    {g.targetPattern || '（任意目标）'}
                  </span>
                </div>
                <div className="grant-row__meta">
                  {(g.agentName ?? g.serverId ?? '通用') + ' · ' + fmtTime(g.grantedAt)}
                  {state === 'revoked' && ' · 已撤销'}
                  {state === 'expired' && ' · 已过期'}
                </div>
                {state === 'active' && (
                  <button
                    className="grant-row__revoke"
                    disabled={busy}
                    onClick={() => void revoke(g.id)}
                    type="button"
                  >
                    撤销
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="config-dialog__section">
        <div className="config-dialog__section-title">
          调用审计
          <select
            className="perm-select"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="">全部 Agent</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button className="perm-link-btn" onClick={() => void exportLogs()} type="button">
            导出 JSON
          </button>
        </div>
        <div className="log-list">
          {logs.length === 0 && <div className="config-dialog__hint">暂无调用记录。</div>}
          {logs.map((l) => (
            <div key={l.id} className="log-row">
              <span
                className={`log-dot ${l.deniedReason ? 'log-dot--denied' : l.ok ? 'log-dot--ok' : 'log-dot--fail'}`}
              />
              <div className="log-row__body">
                <div className="log-row__head">
                  <span className="log-row__tool">{l.toolName}</span>
                  <span className="log-row__time">{fmtTime(l.ts)}</span>
                </div>
                <div className="log-row__detail">
                  {l.deniedReason
                    ? `被拒绝：${l.deniedReason}`
                    : l.resultSummary || l.argsSummary || '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {notice && <div className="config-dialog__hint perm-notice">{notice}</div>}
    </>
  )
}
