/**
 * 情景记忆 repo —— episodic_memories CRUD（W3 D4）
 *
 * 摘要 Agent 提炼出的事件卡片落这张表，关键词召回时全量（或上限）取出交给
 * agent-core 的 scoreEpisodicRecall 做 JS 打分。keywords 单列存 JSON 数组，
 * 读出时注入 metadata.keywords，对齐 agent-core EpisodicMemory 约定。
 */
import type { EpisodicMemory } from '@echopet/agent-core'
import type { DB } from './connection'

interface EpisodicRow {
  id: number
  summary: string
  event_type: string | null
  keywords: string
  ts: number
  metadata: string | null
}

function parseKeywords(raw: string): string[] {
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return arr.filter((k): k is string => typeof k === 'string')
  } catch {
    /* ignore */
  }
  return []
}

function rowToMemory(row: EpisodicRow): EpisodicMemory {
  const keywords = parseKeywords(row.keywords)
  let metadata: Record<string, unknown> = {}
  if (row.metadata) {
    try {
      const parsed = JSON.parse(row.metadata)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>
      }
    } catch {
      /* ignore */
    }
  }
  metadata.keywords = keywords

  const mem: EpisodicMemory = {
    id: String(row.id),
    summary: row.summary,
    ts: row.ts,
    metadata
  }
  if (row.event_type) mem.eventType = row.event_type
  return mem
}

export class EpisodicRepo {
  constructor(private readonly db: DB) {}

  insert(memory: Omit<EpisodicMemory, 'id'>): EpisodicMemory {
    const kwArr = Array.isArray(memory.metadata?.keywords)
      ? (memory.metadata!.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
      : []

    // metadata 落库时剔除 keywords（已单列），其余保留
    const rest: Record<string, unknown> = { ...(memory.metadata ?? {}) }
    delete rest.keywords
    const metadataJson = Object.keys(rest).length ? JSON.stringify(rest) : null

    const info = this.db
      .prepare(
        `INSERT INTO episodic_memories (summary, event_type, keywords, ts, metadata)
         VALUES (@summary, @event_type, @keywords, @ts, @metadata)`
      )
      .run({
        summary: memory.summary,
        event_type: memory.eventType ?? null,
        keywords: JSON.stringify(kwArr),
        ts: memory.ts,
        metadata: metadataJson
      })

    return rowToMemory({
      id: Number(info.lastInsertRowid),
      summary: memory.summary,
      event_type: memory.eventType ?? null,
      keywords: JSON.stringify(kwArr),
      ts: memory.ts,
      metadata: metadataJson
    })
  }

  /** 最近 limit 条（按 ts 降序取，再按时间正序返回），作为召回候选 */
  recent(limit: number): EpisodicMemory[] {
    const rows = this.db
      .prepare(`SELECT * FROM episodic_memories ORDER BY id DESC LIMIT ?`)
      .all(limit) as EpisodicRow[]
    return rows.map(rowToMemory)
  }

  count(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM episodic_memories`)
      .get() as { c: number }
    return row.c
  }
}
