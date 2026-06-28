import { useEffect, useRef, useState } from 'react'

interface ChatInputProps {
  visible: boolean
  onSend: (text: string) => void
  onClose: () => void
}

/**
 * W2 起的对话输入入口。
 *
 * - 永远占据 grid 第 3 行（48px），保持角色 stage 高度恒定，
 *   visible 切换时只做 opacity / transform 渐变，不触发 layout reflow。
 * - listening 状态进入时自动 focus；Enter 发送、Esc 取消、blur 也取消。
 * - 状态机里 hideInputBox 通过 onClose 触发上层 setState(false)。
 */
function ChatInput({ visible, onSend, onClose }: ChatInputProps): React.JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      inputRef.current?.focus()
    } else {
      setText('')
    }
  }, [visible])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      const trimmed = text.trim()
      if (trimmed) {
        onSend(trimmed)
        setText('')
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className={`chat-input ${visible ? 'chat-input--visible' : ''}`}>
      <input
        ref={inputRef}
        className="chat-input__field"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => visible && onClose()}
        placeholder="说点什么…（Enter 发送 · Esc 取消）"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  )
}

export default ChatInput
