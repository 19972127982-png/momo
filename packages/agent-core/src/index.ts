export type {
  // 基础数据
  ConversationMessage,
  EpisodicMemory,
  PersonalityState,
  GrowthStage,
  UserProfile,
  // Agent
  ToolScope,
  AgentFamily,
  AgentEvent,
  ToolResolution,
  AgentRunContext,
  Agent,
  // Router
  IntentMode,
  RouterResult,
  Router,
  // MemoryStore
  MemoryStore,
  // PromptBuilder
  PromptBuilderInput,
  ChatCompletionMessage,
  PromptBuilder
} from './types'

// v2.1 D2 NEW —— 双层 prompt + CompanionAgent + LLM 客户端抽象
export type {
  ChatCompletionStreamOptions,
  ChatCompletionStreamChunk,
  ChatCompletionClient
} from './chat-completion-client'

export {
  bucketDimension,
  describePersonality,
  formatPersonalityLines,
  type DimensionLevel,
  type PersonalityDescriptionLines
} from './personality-mapper'

export { deriveGrowthStage, describeGrowthStage } from './growth-stage'

export {
  DefaultPromptBuilder,
  type DefaultPromptBuilderOptions
} from './prompt-builder'

export {
  CompanionAgent,
  type CompanionAgentOptions
} from './companion-agent'

// v2.1 D3 NEW —— 用户画像提取纯逻辑（触发 / 解析 / 合并 / 摘要）
export {
  shouldExtractProfile,
  buildProfileExtractionPrompt,
  parseProfileExtraction,
  mergeUserProfile,
  profilePatchIsEmpty,
  summarizeUserProfile,
  type ShouldExtractInput
} from './profile-extraction'

// v2.1 D4 NEW —— 情景记忆：摘要 Agent 纯逻辑 + 关键词召回
export {
  shouldSummarize,
  buildSummaryPrompt,
  parseSummaryCards,
  type ShouldSummarizeInput,
  type SummaryCard
} from './episodic-summary'

export {
  tokenize,
  scoreEpisodicRecall,
  type RecallScored
} from './episodic-recall'
