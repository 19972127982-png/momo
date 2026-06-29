/**
 * SqliteMemoryStore —— agent-core MemoryStore 接口的桌面端实现（W3 D3）
 *
 * 工作记忆 / 用户画像 / 性格状态 / 演化日志 全部走 better-sqlite3。
 * 情景记忆（episodic）在 D4 接 ChromaDB + bge embedding，这里先 stub：
 *   - recallEpisodicMemories 返回 []（PromptBuilder 会因此跳过「最近聊过的事」段）
 *   - upsertEpisodicMemory 直接返回入参（不持久化）
 * D4 会用真正的 ChromaMemoryStore 包一层或替换这两个方法。
 *
 * 注意：MemoryStore 接口是 async（为兼容 Web 端 Supabase），但 better-sqlite3 是同步的，
 * 这里用 Promise.resolve 包一层即可。
 */
import type {
  ConversationMessage,
  EpisodicMemory,
  MemoryStore,
  PersonalityState,
  UserProfile
} from '@echopet/agent-core'
import type { DB } from '../db/connection'
import { MessagesRepo } from '../db/repo-messages'
import { ProfileRepo } from '../db/repo-profile'
import { PersonalityRepo } from '../db/repo-personality'
import { EvolutionRepo } from '../db/repo-evolution'

export class SqliteMemoryStore implements MemoryStore {
  private readonly messages: MessagesRepo
  private readonly profile: ProfileRepo
  private readonly personality: PersonalityRepo
  private readonly evolution: EvolutionRepo

  constructor(db: DB) {
    this.messages = new MessagesRepo(db)
    this.profile = new ProfileRepo(db)
    this.personality = new PersonalityRepo(db)
    this.evolution = new EvolutionRepo(db)
  }

  // ---- 工作记忆 ----
  async appendMessage(msg: Omit<ConversationMessage, 'id'>): Promise<ConversationMessage> {
    return this.messages.append(msg)
  }

  async recentMessages(n: number): Promise<readonly ConversationMessage[]> {
    return this.messages.recent(n)
  }

  // ---- 情景记忆（D4 接 ChromaDB）----
  async upsertEpisodicMemory(memory: Omit<EpisodicMemory, 'id'>): Promise<EpisodicMemory> {
    // TODO(D4): 写入 ChromaDB + bge embedding
    return { ...memory, id: `stub-${memory.ts}` }
  }

  async recallEpisodicMemories(_query: string, _topK: number): Promise<readonly EpisodicMemory[]> {
    // TODO(D4): bge embed query → ChromaDB Top-K 召回
    return []
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
