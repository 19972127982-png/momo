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
  FunctionToolCall,
  PromptBuilder,
} from "./types";

// v2.1 D2 NEW —— 双层 prompt + CompanionAgent + LLM 客户端抽象
export type {
  ChatCompletionStreamOptions,
  ChatCompletionStreamChunk,
  ChatCompletionClient,
} from "./chat-completion-client";

export {
  bucketDimension,
  describePersonality,
  formatPersonalityLines,
  type DimensionLevel,
  type PersonalityDescriptionLines,
} from "./personality-mapper";

export { deriveGrowthStage, describeGrowthStage } from "./growth-stage";

export {
  DefaultPromptBuilder,
  type DefaultPromptBuilderOptions,
} from "./prompt-builder";

export { CompanionAgent, type CompanionAgentOptions } from "./companion-agent";

// v2.1 D3 NEW —— 用户画像提取纯逻辑（触发 / 解析 / 合并 / 摘要）
export {
  shouldExtractProfile,
  buildProfileExtractionPrompt,
  parseProfileExtraction,
  mergeUserProfile,
  profilePatchIsEmpty,
  summarizeUserProfile,
  type ShouldExtractInput,
} from "./profile-extraction";

// v2.1 D4 NEW —— 情景记忆：摘要 Agent 纯逻辑 + 关键词召回
export {
  shouldSummarize,
  buildSummaryPrompt,
  parseSummaryCards,
  type ShouldSummarizeInput,
  type SummaryCard,
} from "./episodic-summary";

export {
  tokenize,
  scoreEpisodicRecall,
  type RecallScored,
} from "./episodic-recall";

// v2.1 D5 NEW —— 性格演化引擎纯逻辑（prompt / 解析 / clamp 应用）
export {
  buildEvolutionPrompt,
  parsePersonalityDelta,
  deltaIsNegligible,
  applyPersonalityDelta,
  personalityL2,
  PERSONALITY_BOUNDS,
  MAX_DELTA_PER_TURN,
  type PersonalityDelta,
} from "./personality-evolution";

// v2.1 D6 NEW —— 工作族 Agent：function calling 客户端 + 一级路由 + FileAgent
export type {
  FunctionTool,
  FunctionCallingOptions,
  FunctionCallingResult,
  FunctionCallingClient,
} from "./function-calling-client";

export {
  namespaceToolName,
  parseNamespacedToolName,
  type ParsedToolName,
} from "./fc-naming";

export {
  classifyIntentByKeywords,
  KeywordIntentRouter,
  type KeywordIntentResult,
} from "./intent-router";

export { FileAgent, type FileAgentOptions } from "./file-agent";

// 拖文件总结纯逻辑（类型判定 / 总结 prompt / 截断 / 边界提示）
export {
  classifyDroppedFile,
  truncateForSummary,
  buildFileSummaryMessages,
  emptyImageTextReply,
  unsupportedFileReply,
  SUMMARY_MAX_CHARS,
  type DroppedFileKind,
  type FileSummaryInput,
} from "./file-summary";

// v2.1 W4 D1 NEW —— 权限闸纯逻辑（grant 匹配 / scope 审批判定 / 决策）
export {
  scopeNeedsApproval,
  targetMatches,
  grantIsActive,
  grantCovers,
  findCoveringGrant,
  evaluatePermission,
  buildGrantFromDecision,
  type GrantGrade,
  type PermissionGrant,
  type PermissionRequest,
  type PermissionDecision,
} from "./permission";

// v2.1 W4 D1 NEW —— Skills 框架（3 内置包定义 + 解析）
export {
  BUILTIN_SKILLS,
  getSkill,
  isSkillId,
  serversForEnabledSkills,
  promptAddonForEnabledSkills,
  defaultScopesForEnabledSkills,
  type SkillId,
  type SkillDef,
} from "./skills";
