/**
 * 工作记忆 repo —— conversation_messages CRUD
 */
import type { ConversationMessage } from '@echopet/agent-core'
import type { DB } from './connection'

interface MessageRow {
  id: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  ts: number
  tool_call_id: string | null
  tool_name: string | null
}

function rowToMessage(row: MessageRow): ConversationMessage {
  const msg: ConversationMessage = {
    id: String(row.id),
    role: row.role,
    content: row.content,
    ts: row.ts
  }
  if (row.tool_call_id) msg.toolCallId = row.tool_call_id
  if (row.tool_name) msg.toolName = row.tool_name
  return msg
}

export class MessagesRepo {
  constructor(private readonly db: DB) {}

  append(msg: Omit<ConversationMessage, 'id'>): ConversationMessage {
    const info = this.db
      .prepare(
        `INSERT INTO conversation_messages (role, content, ts, tool_call_id, tool_name)
         VALUES (@role, @content, @ts, @tool_call_id, @tool_name)`
      )
      .run({
        role: msg.role,
        content: msg.content,
        ts: msg.ts,
        tool_call_id: msg.toolCallId ?? null,
        tool_name: msg.toolName ?? null
      })

    return {
      ...msg,
      id: String(info.lastInsertRowid)
    }
  }

  /** 最近 n 条，返回顺序为 旧 → 新（方便直接拼进 messages 数组） */
  recent(n: number): ConversationMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversation_messages ORDER BY id DESC LIMIT ?`
      )
      .all(n) as MessageRow[]
    return rows.reverse().map(rowToMessage)
  }

  count(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM conversation_messages`)
      .get() as { c: number }
    return row.c
  }
}
