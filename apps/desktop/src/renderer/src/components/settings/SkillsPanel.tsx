import { useEffect, useState } from 'react'
import type { SkillView } from '../../../../shared/ipcTypes'

/**
 * 设置 · 技能包（W4 D5）
 *
 * 列出内置 Skill，ON/OFF 即时生效（toggle → IPC 落库）。启用某 Skill 后，对应的
 * MCP server 才会在实用对话里被允许 spawn —— 关掉「文件管家」桌宠就不碰文件了。
 */
export default function SkillsPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const [skills, setSkills] = useState<SkillView[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    void window.echopet?.skills.list().then(setSkills)
  }, [visible])

  const toggle = async (s: SkillView): Promise<void> => {
    setBusy(s.id)
    const r = await window.echopet?.skills.setEnabled(s.id, !s.enabled)
    if (r?.ok) {
      setSkills((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))
    }
    setBusy(null)
  }

  return (
    <div className="config-dialog__section">
      <div className="config-dialog__section-title">
        技能包
        <span className="config-dialog__section-tag">启用后桌宠才会用对应工具</span>
      </div>
      <div className="skill-list">
        {skills.length === 0 && <div className="config-dialog__hint">加载中…</div>}
        {skills.map((s) => (
          <div key={s.id} className={`skill-card${s.enabled ? ' skill-card--on' : ''}`}>
            <div className="skill-card__info">
              <div className="skill-card__name">{s.name}</div>
              <div className="skill-card__desc">
                {s.promptAddon || '仅陪伴，不使用任何工具'}
              </div>
              {s.servers.length > 0 && (
                <div className="skill-card__servers">工具来源：{s.servers.join('、')}</div>
              )}
            </div>
            <button
              className={`skill-toggle${s.enabled ? ' skill-toggle--on' : ''}`}
              disabled={busy === s.id}
              onClick={() => void toggle(s)}
              title={s.enabled ? '点击关闭' : '点击启用'}
              type="button"
            >
              <span className="skill-toggle__knob" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
