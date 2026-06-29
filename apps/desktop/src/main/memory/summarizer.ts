/**
 * 摘要 Agent（桌面端装配，W3 D4）
 *
 * 把 agent-core 的纯逻辑（触发判断 / prompt / 解析）和 IO（LLM 调用 + SQLite）接起来：
 * 每累计 N 条新消息，把游标之后的对话提炼成事件卡片落 episodic_memories，推进游标。
 *
 * 调用时机：chat handler 在主回复 stream 完成后异步触发（不阻塞用户感知延迟）。
 * 失败容忍：任何异常都 swallow；只有成功处理一批后才推进游标，失败下轮自然重试。
 */
import {
  buildSummaryPrompt,
  parseSummaryCards,
  shouldSummarize
} from '@echopet/agent-core'
import type { SqliteMemoryStore } from './sqliteMemoryStore'
import { completeDeepSeek } from '../llm'

/** 单次摘要最多吃多少条新消息（防 prompt 过长；超出留给下一轮） */
const MAX_BATCH = 40

export interface MaybeSummarizeParams {
  store: SqliteMemoryStore
  getApiKey: () => string | null
  signal: AbortSignal
}

export interface MaybeSummarizeResult {
  attempted: boolean
  /** 本轮新增的情景卡片数 */
  created: number
}

export async function maybeSummarize(
  params: MaybeSummarizeParams
): Promise<MaybeSummarizeResult> {
  const { store, getApiKey, signal } = params

  const lastId = store.latestMessageId()
  const cursor = store.summaryCursor()
  const pending = lastId - cursor

  if (!shouldSummarize({ newMessagesSinceLastSummary: pending })) {
    return { attempted: false, created: 0 }
  }

  const apiKey = getApiKey()
  if (!apiKey) return { attempted: false, created: 0 }

  const batch = store.messagesAfterCursor(MAX_BATCH)
  if (batch.length === 0) return { attempted: false, created: 0 }

  try {
    const prompt = buildSummaryPrompt(batch)
    const raw = await completeDeepSeek(
      [{ role: 'user', content: prompt }],
      apiKey,
      signal,
      { temperature: 0.3, maxTokens: 400 }
    )

    const cards = parseSummaryCards(raw)
    const now = Date.now()
    for (const card of cards) {
      await store.upsertEpisodicMemory({
        summary: card.summary,
        eventType: card.eventType,
        ts: now,
        metadata: { keywords: card.keywords }
      })
    }

    // 处理成功 → 推进游标到本批最后一条（即便没产出卡片，也别重复嚼同一批）
    const lastInBatch = Number(batch[batch.length - 1].id)
    if (Number.isFinite(lastInBatch)) store.setSummaryCursor(lastInBatch)

    return { attempted: true, created: cards.length }
  } catch (err) {
    console.warn('[summarizer] swallow:', (err as Error).message)
    return { attempted: true, created: 0 }
  }
}
