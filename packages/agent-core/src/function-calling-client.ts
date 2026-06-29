/**
 * Function Calling LLM 客户端抽象（W3 D6 · 工作族 Agent 用）
 *
 * 与 ChatCompletionClient（陪伴族流式纯文本）并列：工作族 Agent 需要让 LLM 在
 * 「直接回答」和「调用工具」之间做决策，所以走 **非流式** function calling：
 *   - 入参带 tools（DeepSeek `tools` 字段）
 *   - 返回 toolCalls（LLM 要调工具）或 content（LLM 给最终答复），二选一
 *
 * 为什么非流式：工具调用决策本身不需要打字机效果，且流式解析 tool_calls 增量复杂、
 * 易错；W3 工作族回复一次性返回即可（陪伴族仍走流式）。
 *
 * 约定：实现不抛异常 —— 失败通过 result.error 表达，便于 Agent 统一兜底。
 */
import type { ChatCompletionMessage, FunctionToolCall } from "./types";

/** DeepSeek / OpenAI 兼容的 function tool 定义（schema 由 mcp-host bridge 翻译产出） */
export interface FunctionTool {
  type: "function";
  function: {
    /** 命名空间化：`${serverId}__${toolName}` */
    name: string;
    description: string;
    /** JSON Schema（MCP inputSchema 直接透传） */
    parameters: Record<string, unknown>;
  };
}

export interface FunctionCallingOptions {
  messages: readonly ChatCompletionMessage[];
  tools: readonly FunctionTool[];
  temperature?: number;
  maxTokens?: number;
  signal: AbortSignal;
}

export interface FunctionCallingResult {
  /** LLM 决定调用的工具（可能多个）；为空表示 LLM 给了最终答复 */
  toolCalls?: FunctionToolCall[];
  /** 最终答复文本（toolCalls 为空时有值） */
  content?: string;
  /** 失败信息（实现不抛异常，错误走这里） */
  error?: string;
}

export interface FunctionCallingClient {
  complete(opts: FunctionCallingOptions): Promise<FunctionCallingResult>;
}
