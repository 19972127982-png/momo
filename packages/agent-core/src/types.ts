/**
 * EchoPet agent-core · 跨端 agent / memory / prompt 抽象
 *
 * 设计原则：
 *   1. 纯 TS 类型 + 接口，无任何 IO 依赖（不引 sqlite / chromadb / electron）
 *   2. 桌面端在 main 进程实现具体类（SQLite + ChromaDB + safeStorage），Web 端实现 Supabase 版本
 *   3. Agent 是 AsyncGenerator —— 外部可 `next(toolResolution)` 喂回工具调用结果，支持 ReAct loop
 *   4. v2.1 简化：陪伴族 1 个 CompanionAgent，工作族每个工具一个 Agent（FileAgent / SystemAgent / DevAgent / WebAgent）
 */

// =====================================================================
// 1. 基础数据类型 —— 与 packages/state-machine 解耦，专注业务实体
// =====================================================================

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** Unix epoch ms */
  ts: number
  /** v2.1：tool 角色专属 */
  toolCallId?: string
  toolName?: string
}

export interface EpisodicMemory {
  id: string
  summary: string
  /** 向量长度由 embedding provider 决定（bge-small-zh = 512 维） */
  embedding?: readonly number[]
  eventType?: string
  ts: number
  metadata?: Record<string, unknown>
}

export interface PersonalityState {
  /** [-1, +1] —— 安静内敛 ↔ 活泼好动 */
  energy: number
  /** [-0.5, +1.0] —— 独立 ↔ 粘人 */
  attachment: number
  /** [-0.6, +0.8] —— 钝感 ↔ 高敏感 */
  sensitivity: number
}

export type GrowthStage = '初识' | '熟悉' | '亲密' | '挚友'

export interface UserProfile {
  nickname?: string
  petCalling?: string
  mbti?: string
  importantDates?: Array<{ date: string; label: string }>
  preferences?: Record<string, unknown>
  pets?: Array<{ name: string; species?: string; note?: string }>
}

// =====================================================================
// 2. Agent —— 单个 LLM 调用单元 + 流式输出 + 工具调用挂钩
// =====================================================================

export type ToolScope = 'read' | 'write' | 'exec' | 'network'

export type AgentFamily = 'companion' | 'utility'

/** Agent 流式输出 event —— 状态机 + UI + 上层调用方都基于这一类型 */
export type AgentEvent =
  /** 流式 token（陪伴族 & 工作族包装 tool_result 后都会发） */
  | { kind: 'text'; text: string }
  /** 思考阶段结束、开始流式输出（用于状态机 thinking → speaking 转移） */
  | { kind: 'thinking-end' }
  /** 工作族 LLM 决定调工具 —— 外部需要在 generator.next(resolution) 喂回结果 */
  | {
      kind: 'tool-call'
      agentName: string
      serverId: string
      toolName: string
      /** 完整参数（JSON 序列化后） */
      args: unknown
      /** 前 200 字摘要，UI / 审计用 */
      argsSummary: string
      scope: ToolScope
    }
  /** 整轮（含可能的多步 ReAct loop）输出完毕 */
  | { kind: 'done' }
  /** 不可恢复错误，调用方应进 apologetic */
  | { kind: 'error'; error: string }

/** 调用方对 tool-call event 的回应（喂回 generator） */
export type ToolResolution =
  | { ok: true; resultSummary: string; /** LLM 上下文喂回的完整 tool message */ resultFull: string }
  | { ok: false; error: string }

/** Agent.run() 入参 —— 把所有"读"过的上下文一次性给齐，agent 内部不再调 store */
export interface AgentRunContext {
  userInput: string
  /** 最近 N 轮，含 user / assistant / tool 角色 */
  workingMemory: readonly ConversationMessage[]
  /** 用户画像摘要（已 LLM-summarize，长度有界） */
  userProfileSummary: string
  /** 向量召回 Top-K */
  recentEpisodicMemories: readonly EpisodicMemory[]
  personality: PersonalityState
  growthStage: GrowthStage
  totalInteractions: number
  /** 用户配置的桌宠代号（默认"小桃"） */
  personaName: string
  /** 用户希望桌宠如何称呼自己（来自 settings.userNickname），注入 prompt */
  userCalling?: string
  /** 中断信号 —— 用户取消 / 应用退出时由 host 触发 */
  signal: AbortSignal
}

/**
 * Agent 流式 generator
 *
 * 用法：
 *   ```
 *   const gen = agent.run(ctx)
 *   let value: AgentEvent | undefined
 *   while (true) {
 *     const r = await gen.next(/* tool resolution if pending *\/)
 *     if (r.done) break
 *     const ev = r.value
 *     if (ev.kind === 'tool-call') {
 *       const resolution = await mcpHost.invoke(ev)
 *       const r2 = await gen.next(resolution)  // 喂回去
 *     } else {
 *       dispatch(ev)
 *     }
 *   }
 *   ```
 */
export interface Agent {
  readonly name: string
  readonly family: AgentFamily
  /** 第三个泛型参数 ToolResolution = 外部 next(value) 时传入的数据类型 */
  run(ctx: AgentRunContext): AsyncGenerator<AgentEvent, void, ToolResolution | undefined>
}

// =====================================================================
// 3. Router —— 两级路由：一级模式分流 + 二级族内选 Agent
// =====================================================================

export type IntentMode = 'companion' | 'utility'

export interface RouterResult {
  mode: IntentMode
  /** 0-1 的置信度 */
  confidence: number
  /** companion 模式下省略；utility 模式下指定具体 Agent name */
  agentName?: string
  /** 内部 debug 用 —— 三路融合的各路打分 */
  scores?: { llm?: number; vec?: number; keyword?: number }
  /** 触发关键词 / intent 标签 */
  intent?: string
}

export interface Router {
  route(userInput: string, ctx: Pick<AgentRunContext, 'workingMemory' | 'signal'>): Promise<RouterResult>
}

// =====================================================================
// 4. MemoryStore —— 抽象桌面端 SQLite/Chroma 与 Web 端 Supabase 的统一接口
// =====================================================================

export interface MemoryStore {
  // ---- 工作记忆 ----
  appendMessage(msg: Omit<ConversationMessage, 'id'>): Promise<ConversationMessage>
  recentMessages(n: number): Promise<readonly ConversationMessage[]>

  // ---- 情景记忆 ----
  upsertEpisodicMemory(memory: Omit<EpisodicMemory, 'id'>): Promise<EpisodicMemory>
  recallEpisodicMemories(query: string, topK: number): Promise<readonly EpisodicMemory[]>

  // ---- 用户画像 ----
  getUserProfile(): Promise<UserProfile>
  updateUserProfile(patch: Partial<UserProfile>): Promise<UserProfile>

  // ---- 性格状态 ----
  getPersonality(): Promise<PersonalityState>
  updatePersonality(next: PersonalityState): Promise<void>
  incrementInteractions(): Promise<number>
  getTotalInteractions(): Promise<number>

  // ---- 演化日志 ----
  appendEvolutionLog(entry: {
    ts: number
    delta: PersonalityState
    stateAfter: PersonalityState
    triggerMsgSnippet: string
  }): Promise<void>
}

// =====================================================================
// 5. PromptBuilder —— 双层 prompt 拼接（v2.1 PRD §4.7.3）
// =====================================================================

export interface PromptBuilderInput {
  personaName: string
  userCalling?: string
  personality: PersonalityState
  growthStage: GrowthStage
  totalInteractions: number
  userProfile: UserProfile
  /** 已经 LLM-summarize 过的画像文本（长度有界，安全注入 prompt） */
  userProfileSummary: string
  recentEpisodicMemories: readonly EpisodicMemory[]
  /** 工作记忆 —— prompt 拼接前会被截到 max N 轮 */
  workingMemory: readonly ConversationMessage[]
  userInput: string
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** tool 角色专属（OpenAI / DeepSeek FC 风格） */
  toolCallId?: string
  name?: string
}

export interface PromptBuilder {
  /** 仅 system prompt（含人格底色 + 性格修饰 + 记忆注入） */
  composeSystemPrompt(input: PromptBuilderInput): string
  /** 完整 messages 数组（system + 工作记忆裁剪后 + 当前 user 输入） */
  composeMessages(input: PromptBuilderInput): ChatCompletionMessage[]
}
