/**
 * 摘要 Agent —— 跨平台纯逻辑（PRD §4.3 情景记忆 · 事件卡片提炼）
 *
 * 每隔 N 条新消息，把一段对话提炼成若干「事件卡片」（summary + eventType + keywords），
 * 卡片落 SQLite，供后续关键词召回。这里只放不依赖 IO 的部分（触发 / prompt / 解析），
 * LLM 调用 + 落库在 apps/desktop 的 summarizer.ts 里装配。
 */
import type { ConversationMessage } from './types'

// =====================================================================
// 1. 触发判断
// =====================================================================

export interface ShouldSummarizeInput {
  /** 距上次摘要游标之后新增的消息条数 */
  newMessagesSinceLastSummary: number
  /** 累计到 N 条新消息才摘要一次（默认 8 ≈ 4 轮对话） */
  everyNMessages?: number
}

export function shouldSummarize(input: ShouldSummarizeInput): boolean {
  const everyN = input.everyNMessages ?? 8
  return input.newMessagesSinceLastSummary >= everyN
}

// =====================================================================
// 2. 摘要 prompt
// =====================================================================

function renderTranscript(messages: readonly ConversationMessage[]): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? '用户' : '桌宠'}：${m.content.slice(0, 200)}`)
    .join('\n')
}

export function buildSummaryPrompt(messages: readonly ConversationMessage[]): string {
  const transcript = renderTranscript(messages)
  return `你是一个对话记忆提炼器。下面是一段用户和桌宠的对话，请提炼出「值得长期记住的事件 / 话题」，做成事件卡片。

对话：
${transcript}

要求：
- 只记录有信息量、未来值得回忆的事（如「用户下周有面试很焦虑」「聊到用户喜欢的乐队」），忽略寒暄。
- 每张卡片 summary 用一句话第三人称概括（≤ 40 字）。
- keywords 给 2-5 个便于检索的中文关键词（人名 / 事件 / 情绪 / 物品等）。
- 没有任何值得记的就输出空数组 []。

只输出一个 JSON 数组，元素形如：
[{ "summary": "用户下周三有面试，比较紧张", "eventType": "工作", "keywords": ["面试", "紧张", "下周三"] }]

严格只输出 JSON 数组，不要解释，不要 markdown 围栏以外的任何文字。`
}

// =====================================================================
// 3. 解析 LLM 返回
// =====================================================================

export interface SummaryCard {
  summary: string
  eventType?: string
  keywords: string[]
}

/** 从可能含 ```json 围栏 / 噪声的字符串里抠出第一个 JSON 数组并清洗成 SummaryCard[] */
export function parseSummaryCards(raw: string): SummaryCard[] {
  if (!raw) return []
  let text = raw.trim()

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence && fence[1]) text = fence[1].trim()

  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []

  let arr: unknown
  try {
    arr = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []

  const cards: SummaryCard[] = []
  for (const item of arr) {
    const card = sanitizeCard(item)
    if (card) cards.push(card)
  }
  return cards
}

function sanitizeCard(item: unknown): SummaryCard | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
  const o = item as Record<string, unknown>

  if (typeof o.summary !== 'string' || !o.summary.trim()) return null
  const summary = o.summary.trim()

  const keywords: string[] = []
  if (Array.isArray(o.keywords)) {
    for (const k of o.keywords) {
      if (typeof k === 'string' && k.trim()) keywords.push(k.trim())
    }
  }

  const card: SummaryCard = { summary, keywords }
  if (typeof o.eventType === 'string' && o.eventType.trim()) {
    card.eventType = o.eventType.trim()
  }
  return card
}
