import { useEffect, useRef, useState } from 'react'
import type { AppSettings, PersonalitySnapshot } from '../../../shared/ipcTypes'

interface ConfigDialogProps {
  visible: boolean
  encryptionAvailable: boolean
  hasKey: boolean
  initialSettings: AppSettings
  personality: PersonalitySnapshot | null
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<{ ok: boolean; error?: string }>
  onSaveApiKey: (key: string) => Promise<{ ok: boolean; error?: string }>
  onClearApiKey: () => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}

const DIMENSIONS: Array<{
  key: 'energy' | 'attachment' | 'sensitivity'
  label: string
  hint: string
}> = [
  { key: 'energy', label: '活力', hint: '内向 ↔ 外向' },
  { key: 'attachment', label: '依恋', hint: '疏离 ↔ 黏人' },
  { key: 'sensitivity', label: '敏感', hint: '迟钝 ↔ 敏感' }
]

/**
 * 设置面板：桌宠基础信息 / 性格三维 / LLM 配置
 *
 * - 永远 mount，靠 visible 切 opacity 做 fade
 * - 性格部分是 read-only 展示，数值由主进程 personality.ts 返回（W2 mock，W3 真实）
 * - 保存逻辑：宠物名字/称呼 → settings.json；API Key → safeStorage
 *   两路独立，互不影响 —— 只填 key 不动名字 / 只改名字不重填 key 都 OK
 */
function ConfigDialog({
  visible,
  encryptionAvailable,
  hasKey,
  initialSettings,
  personality,
  onSaveSettings,
  onSaveApiKey,
  onClearApiKey,
  onClose
}: ConfigDialogProps): React.JSX.Element {
  const [petName, setPetName] = useState(initialSettings.petName)
  const [userNickname, setUserNickname] = useState(initialSettings.userNickname)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  // dialog 每次「打开」时从 props sync 一次表单值；打开期间 props 变化不再覆盖用户输入
  useEffect(() => {
    if (!visible) {
      setApiKey('')
      setError(null)
      return
    }
    setPetName(initialSettings.petName)
    setUserNickname(initialSettings.userNickname)
    const t = setTimeout(() => firstInputRef.current?.focus(), 180)
    return () => clearTimeout(t)
    // 故意只 watch visible —— 打开瞬间 sync 一次，期间 prop 漂移不打断用户编辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const submit = async (): Promise<void> => {
    setSaving(true)
    setError(null)

    // 1) settings: 名字 / 称呼（diff 才发，统一 trim 后比较 + 保存）
    const settingsPatch: Partial<AppSettings> = {}
    const trimmedName = petName.trim()
    const trimmedNickname = userNickname.trim()
    if (trimmedName !== initialSettings.petName) settingsPatch.petName = trimmedName
    if (trimmedNickname !== initialSettings.userNickname)
      settingsPatch.userNickname = trimmedNickname

    if (Object.keys(settingsPatch).length > 0) {
      const r = await onSaveSettings(settingsPatch)
      if (!r.ok) {
        setSaving(false)
        setError(r.error ?? '保存设置失败')
        return
      }
    }

    // 2) API Key: 留空时保留原 key 不动；填了才更新
    const keyTrimmed = apiKey.trim()
    if (keyTrimmed) {
      const r = await onSaveApiKey(keyTrimmed)
      if (!r.ok) {
        setSaving(false)
        setError(r.error ?? '保存 API Key 失败')
        return
      }
    } else if (!hasKey) {
      setSaving(false)
      setError('请填写 DeepSeek API Key')
      return
    }

    setSaving(false)
    onClose()
  }

  const handleClearKey = async (): Promise<void> => {
    setSaving(true)
    const r = await onClearApiKey()
    setSaving(false)
    if (!r.ok) setError(r.error ?? '清除失败')
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void submit()
    }
  }

  return (
    <div className={`config-mask ${visible ? 'config-mask--visible' : ''}`}>
      <div className="config-dialog" onKeyDown={handleKeyDown}>
        <div className="config-dialog__title">设置</div>

        {/* ===== 桌宠 ===== */}
        <div className="config-dialog__section">
          <div className="config-dialog__section-title">桌宠</div>
          <label className="config-dialog__field">
            <span className="config-dialog__label">名字</span>
            <input
              ref={firstInputRef}
              className="config-dialog__input"
              value={petName}
              onChange={(e) => setPetName(e.target.value)}
              placeholder="小桃"
              maxLength={12}
              spellCheck={false}
            />
          </label>
          <label className="config-dialog__field">
            <span className="config-dialog__label">称呼我</span>
            <input
              className="config-dialog__input"
              value={userNickname}
              onChange={(e) => setUserNickname(e.target.value)}
              placeholder="（可选）"
              maxLength={12}
              spellCheck={false}
            />
          </label>
        </div>

        {/* ===== 性格 ===== */}
        <div className="config-dialog__section">
          <div className="config-dialog__section-title">
            性格
            {personality && (
              <span className="config-dialog__section-tag">
                {personality.stage} · {personality.interactions} 次互动
              </span>
            )}
          </div>
          {personality ? (
            <div className="personality">
              {DIMENSIONS.map((d) => {
                const v = personality[d.key]
                const pct = Math.round(v * 100)
                return (
                  <div key={d.key} className="personality__row">
                    <div className="personality__label">{d.label}</div>
                    <div className="personality__bar">
                      <div className="personality__bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="personality__value">{v.toFixed(2)}</div>
                    <div className="personality__hint">{d.hint}</div>
                  </div>
                )
              })}
              <div className="personality__note">
                每次聊天会异步漂移 ±0.02 — W3 接入演化引擎后这里会动起来
              </div>
            </div>
          ) : (
            <div className="config-dialog__hint">加载中…</div>
          )}
        </div>

        {/* ===== 模型 ===== */}
        <div className="config-dialog__section">
          <div className="config-dialog__section-title">
            模型
            <span className="config-dialog__section-tag">DeepSeek-V3</span>
          </div>
          <div className="config-dialog__hint">
            前往 <code>platform.deepseek.com</code> 申请，仅在本机 Keychain 加密保存。
          </div>
          {!encryptionAvailable && (
            <div className="config-dialog__warn">
              ⚠️ 系统不支持安全存储，配置仅保留在内存，重启会丢失。
            </div>
          )}
          <label className="config-dialog__field">
            <span className="config-dialog__label">API Key</span>
            <input
              className="config-dialog__input config-dialog__input--mono"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? '已配置 — 留空保持不变' : 'sk-...'}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {hasKey && (
            <button
              className="config-dialog__inline-action"
              onClick={() => void handleClearKey()}
              disabled={saving}
              type="button"
            >
              清除已保存的 Key
            </button>
          )}
        </div>

        {error && <div className="config-dialog__error">{error}</div>}

        <div className="config-dialog__actions">
          <button
            className="config-dialog__btn config-dialog__btn--ghost"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            className="config-dialog__btn config-dialog__btn--primary"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfigDialog
