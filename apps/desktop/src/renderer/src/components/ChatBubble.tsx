interface ChatBubbleProps {
  text: string
  visible?: boolean
}

function ChatBubble({ text, visible = true }: ChatBubbleProps): React.JSX.Element | null {
  if (!visible) return null

  return (
    <div className="chat-bubble" role="status">
      <div className="chat-bubble__content">{text}</div>
      <div className="chat-bubble__tail" />
    </div>
  )
}

export default ChatBubble
