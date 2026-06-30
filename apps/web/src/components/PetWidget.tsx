'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useChat } from '@/lib/useChat'
import { SITE } from '@/lib/site'

const Live2DStage = dynamic(() => import('./Live2DStage'), { ssr: false })

// 气泡自动淡出时长（对齐桌面版）：问候 10s、回复完 5s；思考/流式/输入中常驻
const GREETING_HIDE_MS = 10_000
const REPLY_HIDE_MS = 5_000

export default function PetWidget(): React.ReactElement {
  const [inputOpen, setInputOpen] = useState(false)
  const [stageError, setStageError] = useState(false)
  const { messages, status, nudged, send } = useChat()
  const [draft, setDraft] = useState('')

  const busy = status !== 'idle'

  // 桌面版交互：只显示 EchoPet 最近一句回复的气泡（用户输入在输入框里）
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const showDots = status === 'thinking' && (!lastAssistant || !lastAssistant.content)

  // 气泡可见性（对齐桌面版）：常驻挂载、靠 opacity 淡入淡出。
  // 每次有新动静先显示，再按当前阶段决定是否自动淡出。
  const [bubbleVisible, setBubbleVisible] = useState(true)
  const greetingConsumedRef = useRef(false)
  const lastAssistantId = lastAssistant?.id
  const lastAssistantContent = lastAssistant?.content

  useEffect(() => {
    setBubbleVisible(true)
    // 思考 / 流式 / 输入框打开（≈监听）→ 常驻，不自动淡出
    if (status === 'thinking' || status === 'streaming' || inputOpen) return
    // idle：首次问候 10s，其余（回复完成 / 引导）5s
    const delay = greetingConsumedRef.current ? REPLY_HIDE_MS : GREETING_HIDE_MS
    greetingConsumedRef.current = true
    const t = window.setTimeout(() => setBubbleVisible(false), delay)
    return () => window.clearTimeout(t)
  }, [status, inputOpen, lastAssistantId, lastAssistantContent])

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!draft.trim() || busy) return
    send(draft)
    setDraft('')
  }

  return (
    <div className="fixed right-2 top-1/2 z-50 flex -translate-y-1/2 flex-col items-end gap-2 sm:right-4">
      {/* 气泡：EchoPet 的回复，靠右、在人物头顶上方；常驻挂载，靠 opacity 淡入淡出 */}
      {(lastAssistant || showDots) && (
        <div
          role="status"
          aria-hidden={!bubbleVisible}
          className={`max-w-[15rem] rounded-2xl rounded-br-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink shadow-lg shadow-peach-300/20 ring-1 ring-peach-100 transition-opacity duration-300 sm:max-w-[17rem] ${
            bubbleVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {showDots ? (
            <span className="inline-flex gap-1 py-1">
              <span className="dot-blink h-1.5 w-1.5 rounded-full bg-peach-400" />
              <span
                className="dot-blink h-1.5 w-1.5 rounded-full bg-peach-400"
                style={{ animationDelay: '0.2s' }}
              />
              <span
                className="dot-blink h-1.5 w-1.5 rounded-full bg-peach-400"
                style={{ animationDelay: '0.4s' }}
              />
            </span>
          ) : (
            <span className="whitespace-pre-wrap">{lastAssistant?.content}</span>
          )}
          {nudged && (
            <a
              href={SITE.downloadMac}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-peach-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-peach-600"
            >
              把 {SITE.petName} 带回家 ↓
            </a>
          )}
        </div>
      )}

      {/* 人物：点一下在脚下弹出/收起输入框 */}
      <button
        onClick={() => setInputOpen((o) => !o)}
        aria-label={inputOpen ? '收起输入框' : '和 EchoPet 聊聊'}
        className="block h-[32rem] max-h-[78vh] w-[19rem] cursor-pointer sm:w-[23rem]"
      >
        {stageError ? (
          <span className="grid h-full w-full place-items-center">
            <span className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-peach-300 to-peach-500 text-5xl shadow-lg">
              🍑
            </span>
          </span>
        ) : (
          <Live2DStage
            speaking={status === 'streaming'}
            onError={() => setStageError(true)}
            className="h-full w-full"
          />
        )}
      </button>

      {/* 脚下输入框：点人物后出现 */}
      {inputOpen && (
        <form
          onSubmit={onSubmit}
          className="animate-fade-up flex w-[17rem] items-center gap-2 rounded-full border border-peach-100 bg-white px-3 py-2 shadow-xl shadow-peach-300/30 sm:w-[20rem]"
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="和 EchoPet 说点什么…"
            maxLength={500}
            className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-ink-soft/60"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-peach-500 text-white transition enabled:hover:bg-peach-600 disabled:opacity-40"
            aria-label="发送"
          >
            ↑
          </button>
        </form>
      )}
    </div>
  )
}
