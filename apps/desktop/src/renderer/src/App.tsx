import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMachine } from '@xstate/react'
import { petMachine, type PetState } from '@echopet/state-machine'
import PetCanvas, { type PetCanvasHandle } from './components/PetCanvas'
import ChatBubble from './components/ChatBubble'
import ChatInput from './components/ChatInput'
import ConfigDialog from './components/ConfigDialog'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type PersonalitySnapshot
} from '../../shared/ipcTypes'

/** 默认气泡文案（speaking/done/apologetic 优先用 context 数据，这里只是 fallback） */
const FALLBACK_TEXT: Record<PetState, string> = {
  idle: '你好，我是 EchoPet — 点我说话吧',
  listening: '在听你说…',
  thinking: '让我想想…',
  speaking: '',
  done: '',
  apologetic: '出错了，待会儿再聊'
}

/** 鼠标位移超过这个像素就视为「拖动」而非「点击」 */
const CLICK_VS_DRAG_THRESHOLD_PX = 5

/** 气泡自动淡出时长：每种状态多久后让气泡 fade 掉（null = 不自动淡出） */
const BUBBLE_AUTO_HIDE_MS: Record<PetState, number | null> = {
  idle: 10_000, // 默认问候语展示 10s
  listening: null,
  thinking: null,
  speaking: null,
  done: 5_000, // 回复完毕展示 5s
  apologetic: null // 状态机 3s 后自动回 idle，靠状态切换关闭
}

function App(): React.JSX.Element {
  const petRef = useRef<PetCanvasHandle>(null)
  const [petReady, setPetReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [inputVisible, setInputVisible] = useState(false)
  const [configVisible, setConfigVisible] = useState(false)
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [hasKey, setHasKey] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [personality, setPersonality] = useState<PersonalitySnapshot | null>(null)
  const [bubbleVisible, setBubbleVisible] = useState(true)

  // 第一个 LLM chunk 到达时要先 emit thinking-end，再 emit chunk —— 用 ref 标记本轮
  const firstChunkRef = useRef(true)
  // 首次进 idle 才展示问候；之后再进 idle 不再 nag（设计上 done 永久停留，不会再次进 idle）
  const idleGreetingShownRef = useRef(false)

  const handleReady = useCallback(() => setPetReady(true), [])
  const handleError = useCallback((err: Error) => setLoadError(err.message), [])

  // 状态机：用 provide 把 noop entry action 替换成真实 Live2D / UI 副作用
  // useMemo deps 故意留空 —— petRef.current 是 lazy 读取，setInputVisible 是 stable
  const machine = useMemo(
    () =>
      petMachine.provide({
        actions: {
          playMotion: (_, params: { group: string }) => {
            petRef.current?.playMotion(params.group)
          },
          showInputBox: () => setInputVisible(true),
          hideInputBox: () => setInputVisible(false)
        }
      }),
    []
  )

  const [snapshot, send] = useMachine(machine)

  // v2.1 W3：thinking 已升级为 compound state（含 deciding/awaitingApproval/acting/observing 子态），
  // snapshot.value 在 thinking 时为 { thinking: '<sub>' } 而非字符串。把它平坦化成顶层 PetState
  // 即可让 W2 写好的 stateValue === 'thinking' 等比较继续工作。
  const stateValue: PetState =
    typeof snapshot.value === 'string'
      ? (snapshot.value as PetState)
      : (Object.keys(snapshot.value)[0] as PetState)

  // 启动时拉所有配置：key 状态 / 应用设置 / 性格快照
  // 设置面板需要这三块数据，没 key 时还会自动弹窗引导填
  useEffect(() => {
    const ipc = window.echopet
    if (!ipc) return
    void (async () => {
      const [status, loadedSettings, snapshot] = await Promise.all([
        ipc.config.getStatus(),
        ipc.config.getSettings(),
        ipc.personality.getSnapshot()
      ])
      setEncryptionAvailable(status.encryptionAvailable)
      setHasKey(status.hasKey)
      setSettings(loadedSettings)
      setPersonality(snapshot)
      if (!status.hasKey) setConfigVisible(true)
    })()
  }, [])

  // 订阅 main 推过来的 stream 事件，转译成状态机事件
  useEffect(() => {
    const ipc = window.echopet
    if (!ipc) return

    const offChunk = ipc.chat.onChunk((text) => {
      if (firstChunkRef.current) {
        firstChunkRef.current = false
        send({ type: 'agent.thinking-end' })
      }
      send({ type: 'agent.stream-chunk', text })
    })
    const offEnd = ipc.chat.onEnd(() => {
      send({ type: 'agent.stream-end' })
    })
    const offError = ipc.chat.onError((err) => {
      send({ type: 'agent.error', error: err })
    })

    return () => {
      offChunk()
      offEnd()
      offError()
    }
  }, [send])

  // 区分 click vs drag：mousedown 记下起点 → mousemove 超阈值才进拖动 → mouseup 没拖动 = click
  useEffect(() => {
    let downAt: { x: number; y: number } | null = null
    let dragging = false

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (!target?.closest('.pet-stage')) return
      if (target.closest('.chat-bubble, .chat-input, .config-mask, .settings-fab')) return
      downAt = { x: e.clientX, y: e.clientY }
      dragging = false
    }
    const onMouseMove = (e: MouseEvent): void => {
      if (!downAt || dragging) return
      const dx = e.clientX - downAt.x
      const dy = e.clientY - downAt.y
      if (Math.hypot(dx, dy) > CLICK_VS_DRAG_THRESHOLD_PX) {
        dragging = true
        window.echopet?.pet.startDrag?.()
      }
    }
    const onMouseUp = (): void => {
      if (!downAt) return
      const wasDrag = dragging
      downAt = null
      dragging = false
      if (wasDrag) {
        window.echopet?.pet.endDrag?.()
      } else {
        send({ type: 'ui.pet-click' })
      }
    }
    const onBlur = (): void => {
      if (dragging) window.echopet?.pet.endDrag?.()
      downAt = null
      dragging = false
    }

    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [send])

  // 气泡可见性：每次状态变化时先显示，按状态决定自动淡出时长
  useEffect(() => {
    if (loadError) {
      setBubbleVisible(true)
      return
    }

    // idle 二次进入（理论上不会发生，因为 done 永久停留）静默处理
    if (stateValue === 'idle' && idleGreetingShownRef.current) {
      setBubbleVisible(false)
      return
    }
    if (stateValue === 'idle') {
      idleGreetingShownRef.current = true
    }

    setBubbleVisible(true)

    const delay = BUBBLE_AUTO_HIDE_MS[stateValue]
    if (delay === null) return
    const t = window.setTimeout(() => setBubbleVisible(false), delay)
    return () => window.clearTimeout(t)
  }, [stateValue, loadError])

  // 状态 → 气泡文案
  const bubbleText = useMemo(() => {
    if (loadError) return loadError
    if (stateValue === 'speaking' || stateValue === 'done') {
      return snapshot.context.streamText || FALLBACK_TEXT[stateValue]
    }
    if (stateValue === 'apologetic') {
      return snapshot.context.lastError ?? FALLBACK_TEXT.apologetic
    }
    return FALLBACK_TEXT[stateValue]
  }, [loadError, stateValue, snapshot.context.streamText, snapshot.context.lastError])

  const handleSend = useCallback(
    (text: string) => {
      firstChunkRef.current = true
      send({ type: 'user.send', text })
      window.echopet?.chat.send(text).catch(() => {
        send({ type: 'agent.error', error: '调用失败，请检查网络或 API Key' })
      })
    },
    [send]
  )
  const handleClose = useCallback(() => send({ type: 'ui.input-blur' }), [send])

  const handleSaveKey = useCallback(
    async (key: string): Promise<{ ok: boolean; error?: string }> => {
      const ipc = window.echopet
      if (!ipc) return { ok: false, error: 'IPC 不可用' }
      const r = await ipc.config.setApiKey(key)
      if (r.ok) setHasKey(true)
      return r
    },
    []
  )

  const handleClearKey = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    const ipc = window.echopet
    if (!ipc) return { ok: false, error: 'IPC 不可用' }
    const r = await ipc.config.clearApiKey()
    if (r.ok) setHasKey(false)
    return r
  }, [])

  const handleSaveSettings = useCallback(
    async (patch: Partial<AppSettings>): Promise<{ ok: boolean; error?: string }> => {
      const ipc = window.echopet
      if (!ipc) return { ok: false, error: 'IPC 不可用' }
      const r = await ipc.config.setSettings(patch)
      if (r.ok && r.settings) setSettings(r.settings)
      return { ok: r.ok, error: r.error }
    },
    []
  )

  return (
    <div className="pet-root">
      <div className="pet-stage">
        <ChatBubble text={bubbleText} visible={bubbleVisible} />

        {!petReady && !loadError && (
          <div className="pet-loading">
            <div className="pet-loading__spinner" />
            <div className="pet-loading__text">加载 Hiyori 中…</div>
          </div>
        )}
        {loadError && (
          <div className="pet-error">
            <div className="pet-error__title">😿 Hiyori 加载失败</div>
            <div className="pet-error__hint">{loadError}</div>
            <div className="pet-error__hint">
              先跑 <code>pnpm setup:cubism</code>，再试 <code>pnpm dev</code>
            </div>
          </div>
        )}
        <PetCanvas ref={petRef} onReady={handleReady} onError={handleError} />

        <button
          className="settings-fab"
          title="配置 API Key"
          onClick={(e) => {
            e.stopPropagation()
            setConfigVisible(true)
          }}
        >
          ⚙
        </button>
      </div>

      <ChatInput visible={inputVisible} onSend={handleSend} onClose={handleClose} />

      <ConfigDialog
        visible={configVisible}
        encryptionAvailable={encryptionAvailable}
        hasKey={hasKey}
        initialSettings={settings}
        personality={personality}
        onSaveSettings={handleSaveSettings}
        onSaveApiKey={handleSaveKey}
        onClearApiKey={handleClearKey}
        onClose={() => setConfigVisible(false)}
      />
    </div>
  )
}

export default App
