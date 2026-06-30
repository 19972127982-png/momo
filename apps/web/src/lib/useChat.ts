'use client'

import { useCallback, useRef, useState } from 'react'
import { classifyIntentByKeywords } from '@echopet/agent-core'

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** nudge：工具意图被前端短路成的「去下载 App」引导气泡 */
  kind?: 'normal' | 'nudge'
}

export type ChatStatus = 'idle' | 'thinking' | 'streaming'

const GREETING = '嗨，我是 EchoPet～ 说说看，今天过得怎么样？'

const NUDGE_REPLY =
  '这个得在桌面上的我才能帮你弄哦——整理文件、设提醒这些动手的活，网页版做不了。点下面把我带回家，就什么都能帮你啦～'

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export interface UseChat {
  messages: ChatMessage[]
  status: ChatStatus
  /** 最近一次是否触发了「下载引导」（用于高亮下载按钮） */
  nudged: boolean
  send: (text: string) => void
  reset: () => void
}

export function useChat(): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: uid(), role: 'assistant', content: GREETING, kind: 'normal' }
  ])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [nudged, setNudged] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || status !== 'idle') return

      const userMsg: ChatMessage = { id: uid(), role: 'user', content: trimmed }
      setNudged(false)

      // —— 工具意图短路：复用桌面端同款关键词分类，命中即引导下载，不打 LLM ——
      const intent = classifyIntentByKeywords(trimmed)
      if (intent.mode === 'utility') {
        setMessages((prev) => [
          ...prev,
          userMsg,
          { id: uid(), role: 'assistant', content: NUDGE_REPLY, kind: 'nudge' }
        ])
        setNudged(true)
        return
      }

      // —— 普通闲聊：走 /api/chat 流式 ——
      const history = [...messages, userMsg]
        .filter((m) => m.kind !== 'nudge')
        .map((m) => ({ role: m.role, content: m.content }))

      const assistantId = uid()
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '', kind: 'normal' }
      ])
      setStatus('thinking')

      const ac = new AbortController()
      abortRef.current = ac

      ;(async () => {
        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messages: history }),
            signal: ac.signal
          })

          if (!res.ok || !res.body) {
            let msg = 'EchoPet 走神了，稍后再试试～'
            try {
              const j = await res.json()
              if (j?.error) msg = j.error
            } catch {
              /* ignore */
            }
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: msg } : m))
            )
            setStatus('idle')
            return
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let acc = ''
          setStatus('streaming')
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            acc += decoder.decode(value, { stream: true })
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m))
            )
          }
          if (!acc.trim()) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: '嗯…我有点没听清，再说一次？' } : m
              )
            )
          }
        } catch (e) {
          if ((e as Error)?.name !== 'AbortError') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId && !m.content
                  ? { ...m, content: '网络好像断了，待会儿再聊？' }
                  : m
              )
            )
          }
        } finally {
          setStatus('idle')
          abortRef.current = null
        }
      })()
    },
    [messages, status]
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([{ id: uid(), role: 'assistant', content: GREETING, kind: 'normal' }])
    setStatus('idle')
    setNudged(false)
  }, [])

  return { messages, status, nudged, send, reset }
}
