import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMachine } from '@xstate/react'
import { petMachine, type PetState } from '@echopet/state-machine'
import PetCanvas, { type PetCanvasHandle } from './components/PetCanvas'
import ChatBubble from './components/ChatBubble'
import ChatInput from './components/ChatInput'
import ConfigDialog from './components/ConfigDialog'
import ApprovalToast, { type ApprovalRequest, type GrantGrade } from './components/ApprovalToast'
import { DEFAULT_SETTINGS, type AppSettings, type PersonalitySnapshot } from '../../shared/ipcTypes'

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
  // W3 D6：工作族 Agent 调工具时的状态提示（如「正在看你桌面上有什么…」）
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  // 拖文件总结：拖拽悬停态（显示「松手丢给我」提示）
  const [dragActive, setDragActive] = useState(false)
  // W4 D3：待用户审批的权限请求（非空时弹 toast + 进询问态）
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)

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

  // 每次打开设置面板时刷新性格快照 —— 互动次数 / 三维向量在主进程每轮对话后已落库，
  // 但 renderer 的 personality 状态只在启动时拉过一次，这里重拉保证设置面板显示最新值。
  useEffect(() => {
    if (!configVisible) return
    const ipc = window.echopet
    if (!ipc) return
    void ipc.personality.getSnapshot().then(setPersonality)
  }, [configVisible])

  // 订阅 main 推过来的 stream 事件，转译成状态机事件
  useEffect(() => {
    const ipc = window.echopet
    if (!ipc) return

    const offChunk = ipc.chat.onChunk((text) => {
      setToolStatus(null) // 最终答复开始 → 清掉工具状态提示
      setApproval(null) // 已进入回答阶段 → 清掉残留审批 toast（含主进程超时兜底后）
      if (firstChunkRef.current) {
        firstChunkRef.current = false
        send({ type: 'agent.thinking-end' })
      }
      send({ type: 'agent.stream-chunk', text })
    })
    const offEnd = ipc.chat.onEnd(() => {
      setToolStatus(null)
      setApproval(null)
      send({ type: 'agent.stream-end' })
    })
    const offError = ipc.chat.onError((err) => {
      setToolStatus(null)
      setApproval(null)
      send({ type: 'agent.error', error: err })
    })
    const offTool = ipc.chat.onTool((label) => {
      setToolStatus(label)
    })
    const offPerm = ipc.permission.onRequest((req) => {
      setApproval(req)
      setBubbleVisible(true)
    })

    return () => {
      offChunk()
      offEnd()
      offError()
      offTool()
      offPerm()
    }
  }, [send])

  // 审批回应：把选择回传主进程，并关掉 toast
  const handleApproval = useCallback((grade: GrantGrade) => {
    setApproval((cur) => {
      if (cur) window.echopet?.permission.respond(cur.reqId, grade)
      return null
    })
  }, [])

  // 拖文件/图片喂给桌宠 → 总结。复用 chat 流式通道：发合成 user.send 进 thinking，
  // 再调 file.summarize，结果走 chat:chunk/end/error 推进状态机（与对话一致）。
  // 真正发起总结：进 thinking → 调 file.summarize（结果走 chat:chunk/end/error）
  const triggerSummarize = useCallback(
    (path: string, name: string) => {
      // 忙时（生成中）忽略，避免打断当前回复
      if (stateValue === 'thinking' || stateValue === 'speaking') return
      firstChunkRef.current = true
      setToolStatus(`正在读「${name}」…`)
      send({ type: 'user.send', text: `📄 ${name}` })
      window.echopet?.file.summarize(path).catch(() => {
        send({ type: 'agent.error', error: '总结失败，请重试' })
      })
    },
    [send, stateValue]
  )

  const handleDropFile = useCallback(
    (file: File) => {
      const ipc = window.echopet
      if (!ipc?.file) return
      const path = ipc.file.getPathForFile(file)
      if (!path) return
      triggerSummarize(path, file.name)
    },
    [triggerSummarize]
  )

  // 点击「📎 喂文件」：原生文件框选文件 → 总结（拖放不可用时的可靠入口）
  const handlePickFile = useCallback(async () => {
    const ipc = window.echopet
    if (!ipc?.file) return
    const r = await ipc.file.pick()
    if (r.canceled || !r.path) return
    triggerSummarize(r.path, r.name ?? r.path)
  }, [triggerSummarize])
  // 用 ref 持有最新 handler，让拖拽监听器只挂一次
  const dropHandlerRef = useRef(handleDropFile)
  useEffect(() => {
    dropHandlerRef.current = handleDropFile
  }, [handleDropFile])

  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types
      if (!types) return false
      // types 可能是数组或 DOMStringList，统一用 Array.from 兼容
      return Array.from(types as ArrayLike<string>).includes('Files')
    }
    // 必须无条件 preventDefault dragenter/dragover，否则 Chromium 不会派发 drop
    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault()
      if (hasFiles(e)) {
        setBubbleVisible(true)
        setDragActive(true)
      }
    }
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      if (hasFiles(e)) {
        setBubbleVisible(true)
        setDragActive(true)
      }
    }
    const onDragLeave = (e: DragEvent): void => {
      // relatedTarget 为 null 表示拖出了窗口
      if (e.relatedTarget === null) setDragActive(false)
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      setDragActive(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) dropHandlerRef.current(file)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

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
    if (approval) {
      const verb = { read: '看看', write: '动', exec: '执行', network: '联网查' }[approval.scope]
      return approval.target
        ? `我想帮你${verb}「${approval.target}」，可以吗？`
        : `我想用一下工具（${approval.toolName}），可以吗？`
    }
    if (dragActive && stateValue !== 'thinking' && stateValue !== 'speaking') {
      return '把文件或图片松手丢给我，我帮你看看里面写了啥~'
    }
    if (stateValue === 'speaking' || stateValue === 'done') {
      return snapshot.context.streamText || FALLBACK_TEXT[stateValue]
    }
    if (stateValue === 'apologetic') {
      return snapshot.context.lastError ?? FALLBACK_TEXT.apologetic
    }
    // 工作族调工具期间（仍在 thinking）显示工具状态提示，比「让我想想…」更具体
    if (stateValue === 'thinking' && toolStatus) return toolStatus
    return FALLBACK_TEXT[stateValue]
  }, [
    loadError,
    approval,
    dragActive,
    stateValue,
    snapshot.context.streamText,
    snapshot.context.lastError,
    toolStatus
  ])

  const handleSend = useCallback(
    (text: string) => {
      firstChunkRef.current = true
      setToolStatus(null)
      setApproval(null)
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
      <div className={`pet-stage${dragActive ? ' drag-active' : ''}`}>
        <ChatBubble text={bubbleText} visible={bubbleVisible} />

        {approval && <ApprovalToast request={approval} onRespond={handleApproval} />}

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
          className="feed-fab"
          title="喂个文件/图片给我看看"
          onClick={(e) => {
            e.stopPropagation()
            void handlePickFile()
          }}
        >
          {'\u2709'}
        </button>

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
