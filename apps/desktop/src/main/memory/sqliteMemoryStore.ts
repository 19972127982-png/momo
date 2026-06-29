/**
 * SqliteMemoryStore —— agent-core MemoryStore 接口的桌面端实现（W3 D3 / D4）
 *
 * 工作记忆 / 用户画像 / 性格状态 / 演化日志 / 情景记忆 全部走 better-sqlite3。
 * 情景记忆（D4）走「关键词召回」：摘要 Agent 提炼的事件卡片落 episodic_memories，
 * 召回时全量（上限 RECALL_CANDIDATE_LIMIT）取出交给 agent-core scoreEpisodicRecall 打分。
 * 向量召回（bge embedding + 向量库）延后到 W5 升级，接口形状不变。
 *
 * 注意：MemoryStore 接口是 async（为兼容 Web 端 Supabase），但 better-sqlite3 是同步的，
 * 这里用 Promise.resolve 包一层即可。
 */
import {
  scoreEpisodicRecall,
  type ConversationMessage,
  type EpisodicMemory,
  type MemoryStore,
  type PersonalityState,
  type UserProfile
} from '@echopet/agent-core'
import type { DB } from '../db/connection'
import { MessagesRepo } from '../db/repo-messages'
import { ProfileRepo } from '../db/repo-profile'
import { PersonalityRepo } from '../db/repo-personality'
import { EvolutionRepo } from '../db/repo-evolution'
import { EpisodicRepo } from '../db/repo-episodic'
import { MetaRepo } from '../db/repo-meta'

/** 召回打分的候选上限 —— 单用户量级足够，超出按 ts 取最近 */
const RECALL_CANDIDATE_LIMIT = 200
/** 摘要游标存 app_meta 的 key */
const SUMMARY_CURSOR_KEY = 'episodic_last_msg_id'

export class SqliteMemoryStore implements MemoryStore {
  private readonly messages: MessagesRepo
  private readonly profile: ProfileRepo
  private readonly personality: PersonalityRepo
  private readonly evolution: EvolutionRepo
  private readonly episodic: EpisodicRepo
  private readonly meta: MetaRepo

  constructor(db: DB) {
    this.messages = new MessagesRepo(db)
    this.profile = new ProfileRepo(db)
    this.personality = new PersonalityRepo(db)
    this.evolution = new EvolutionRepo(db)
    this.episodic = new EpisodicRepo(db)
    this.meta = new MetaRepo(db)
  }

  // ---- 工作记忆 ----
  async appendMessage(msg: Omit<ConversationMessage, 'id'>): Promise<ConversationMessage> {
    return this.messages.append(msg)
  }

  async recentMessages(n: number): Promise<readonly ConversationMessage[]> {
    return this.messages.recent(n)
  }

  // ---- 情景记忆（D4 关键词召回）----
  async upsertEpisodicMemory(memory: Omit<EpisodicMemory, 'id'>): Promise<EpisodicMemory> {
    return this.episodic.insert(memory)
  }

  async recallEpisodicMemories(query: string, topK: number): Promise<readonly EpisodicMemory[]> {
    const candidates = this.episodic.recent(RECALL_CANDIDATE_LIMIT)
    return scoreEpisodicRecall(query, candidates, topK)
  }

  // ---- 摘要 Agent 装配用（D4，非 MemoryStore 接口）----

  /** 当前最大 message id —— 配合游标算「自上次摘要以来的新消息数」 */
  latestMessageId(): number {
    return this.messages.maxId()
  }

  /** 上次摘要已覆盖到的 message id（默认 0） */
  summaryCursor(): number {
    return this.meta.getNumber(SUMMARY_CURSOR_KEY, 0)
  }

  setSummaryCursor(messageId: number): void {
    this.meta.setNumber(SUMMARY_CURSOR_KEY, messageId)
  }

  /** 游标之后的新消息（旧 → 新），上限 limit 条 */
  messagesAfterCursor(limit: number): ConversationMessage[] {
    return this.messages.after(this.summaryCursor(), limit)
  }

  episodicCount(): number {
    return this.episodic.count()
  }

  // ---- 用户画像 ----
  async getUserProfile(): Promise<UserProfile> {
    return this.profile.get()
  }

  async updateUserProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
    const current = this.profile.get()
    const next: UserProfile = { ...current, ...patch }
    this.profile.set(next)
    return next
  }

  // ---- 性格状态 ----
  async getPersonality(): Promise<PersonalityState> {
    return this.personality.getVector()
  }

  async updatePersonality(next: PersonalityState): Promise<void> {
    this.personality.setVector(next)
  }

  async incrementInteractions(): Promise<number> {
    return this.personality.incrementInteractions()
  }

  async getTotalInteractions(): Promise<number> {
    return this.personality.getTotalInteractions()
  }

  // ---- 演化日志 ----
  async appendEvolutionLog(entry: {
    ts: number
    delta: PersonalityState
    stateAfter: PersonalityState
    triggerMsgSnippet: string
  }): Promise<void> {
    this.evolution.append(entry)
  }
}
