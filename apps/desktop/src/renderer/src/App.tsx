import { useCallback, useEffect, useRef, useState } from 'react'
import PetCanvas, { type PetCanvasHandle } from './components/PetCanvas'
import ChatBubble from './components/ChatBubble'

const GREETING = '你好，我是 EchoPet（W1 静态版） — W2 起会由对话驱动'

function App(): React.JSX.Element {
  const petRef = useRef<PetCanvasHandle>(null)
  const [petReady, setPetReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleReady = useCallback(() => setPetReady(true), [])
  const handleError = useCallback((err: Error) => setError(err.message), [])

  // 拖动：pet-stage 上 mousedown → IPC 启动主进程 setPosition 循环；任意 mouseup 结束
  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (!target?.closest('.pet-stage')) return
      if (target.closest('.chat-bubble')) return
      e.preventDefault()
      window.echopet?.pet.startDrag?.()
    }
    const onMouseUp = (): void => window.echopet?.pet.endDrag?.()

    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onMouseUp)

    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onMouseUp)
    }
  }, [])

  // 防止未使用的 petRef 警告（W2 起 actor → useLive2DBridge 会用上）
  void petRef

  return (
    <div className="pet-root">
      <ChatBubble text={error ?? GREETING} visible />

      <div className="pet-stage">
        {!petReady && !error && (
          <div className="pet-loading">
            <div className="pet-loading__spinner" />
            <div className="pet-loading__text">加载 Hiyori 中…</div>
          </div>
        )}
        {error && (
          <div className="pet-error">
            <div className="pet-error__title">😿 Hiyori 加载失败</div>
            <div className="pet-error__hint">{error}</div>
            <div className="pet-error__hint">
              先跑 <code>pnpm setup:cubism</code>，再试 <code>pnpm dev</code>
            </div>
          </div>
        )}
        <PetCanvas ref={petRef} onReady={handleReady} onError={handleError} />
      </div>
    </div>
  )
}

export default App
