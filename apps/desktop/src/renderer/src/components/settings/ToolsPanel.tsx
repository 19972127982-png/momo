import { useCallback, useEffect, useState } from 'react'
import type { ServerStatusView } from '../../../../shared/ipcTypes'

/**
 * 设置 · 工具（W4 D6）
 *
 * 列出内置 MCP server 的健康状态（已启动 / 启动失败 / 未启动）+ 工具数，
 * 提供「重启」按钮（注销后重新拉起，常用于 npx server 首次失败后重试）。
 */
const HEALTH_LABEL: Record<ServerStatusView['health'], string> = {
  running: '运行中',
  failed: '启动失败',
  stopped: '未启动'
}

export default function ToolsPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const [servers, setServers] = useState<ServerStatusView[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void window.echopet?.tools.listServers().then(setServers)
  }, [])

  useEffect(() => {
    if (visible) refresh()
  }, [visible, refresh])

  const restart = async (id: string): Promise<void> => {
    setBusy(id)
    await window.echopet?.tools.restartServer(id)
    refresh()
    setBusy(null)
  }

  return (
    <div className="config-dialog__section">
      <div className="config-dialog__section-title">
        工具服务
        <span className="config-dialog__section-tag">桌宠按需拉起，用完常驻</span>
      </div>
      <div className="server-list">
        {servers.length === 0 && <div className="config-dialog__hint">加载中…</div>}
        {servers.map((s) => (
          <div key={s.id} className="server-card">
            <div className="server-card__info">
              <div className="server-card__head">
                <span className="server-card__name">{s.label}</span>
                <span className={`server-badge server-badge--${s.health}`}>
                  {HEALTH_LABEL[s.health]}
                </span>
              </div>
              <div className="server-card__desc">{s.capability}</div>
              <div className="server-card__meta">
                {s.agent} · {s.kind === 'local' ? '进程内' : '子进程'} ·{' '}
                {s.health === 'running' ? `${s.toolCount} 个工具` : '—'}
              </div>
            </div>
            <button
              className="server-card__btn"
              disabled={busy === s.id}
              onClick={() => void restart(s.id)}
              type="button"
            >
              {busy === s.id ? '重启中…' : '重启'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
