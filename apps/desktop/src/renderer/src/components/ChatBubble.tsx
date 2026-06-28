interface ChatBubbleProps {
  text: string
  visible?: boolean
}

/**
 * 气泡组件 —— 永远 mount，靠 className 切换 opacity 做 fade in/out。
 * pointer-events 在 CSS 里恒为 none，不挡 click / drag。
 */
function ChatBubble({ text, visible = true }: ChatBubbleProps): React.JSX.Element {
  return (
    <div
      className={`chat-bubble ${visible ? 'chat-bubble--visible' : ''}`}
      role="status"
      aria-hidden={!visible}
    >
      <div className="chat-bubble__content">{text}</div>
      <div className="chat-bubble__tail" />
    </div>
  )
}

export default ChatBubble
