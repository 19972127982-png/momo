/**
 * MCP ↔ DeepSeek function calling bridge（W3 D6，纯逻辑）
 *
 * 负责两个方向的翻译 + 一些辅助：
 *   - mcpToolToFunctionTool：MCP Tool（inputSchema=JSON Schema）→ DeepSeek FunctionTool
 *   - inferScope：按工具名推断 scope（read/write/exec/network），驱动审批策略
 *   - extractTextFromMcpResult：MCP callTool 结果（content 数组）→ 纯文本
 *   - summarizeToolResult：截断给 UI / 审计用的短摘要
 *
 * 纯函数、无 IO，便于单测（host.ts 才碰 SDK / 子进程）。
 */
import {
  namespaceToolName,
  type FunctionTool,
  type ToolScope,
} from "@echopet/agent-core";
import type { McpToolDescriptor } from "./types";

const EMPTY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
};

/** MCP Tool → DeepSeek FunctionTool（工具名命名空间化，inputSchema 透传为 parameters） */
export function mcpToolToFunctionTool(
  tool: McpToolDescriptor,
  serverId: string,
): FunctionTool {
  const parameters =
    tool.inputSchema && typeof tool.inputSchema === "object"
      ? tool.inputSchema
      : EMPTY_SCHEMA;
  return {
    type: "function",
    function: {
      name: namespaceToolName(serverId, tool.name),
      description: tool.description ?? "",
      parameters,
    },
  };
}

const WRITE_HINTS = [
  "write",
  "create",
  "edit",
  "update",
  "move",
  "rename",
  "delete",
  "remove",
  "mkdir",
  "put",
  "append",
];
const EXEC_HINTS = ["exec", "run", "spawn", "shell", "command", "kill"];
const NETWORK_HINTS = [
  "fetch",
  "http",
  "request",
  "download",
  "upload",
  "search",
  "browse",
];

/**
 * 按（去命名空间的）工具名推断 scope。默认 'read'。
 * 传入命名空间化的名字也行 —— 只看是否包含关键词。
 */
export function inferScope(toolName: string): ToolScope {
  const n = toolName.toLowerCase();
  if (EXEC_HINTS.some((h) => n.includes(h))) return "exec";
  if (WRITE_HINTS.some((h) => n.includes(h))) return "write";
  if (NETWORK_HINTS.some((h) => n.includes(h))) return "network";
  return "read";
}

/** MCP callTool 结果的 content 元素（只取需要的字段） */
interface McpContentPart {
  type?: string;
  text?: string;
}

interface McpCallResult {
  content?: McpContentPart[];
  isError?: boolean;
}

/** 把 MCP callTool 结果的 content 数组拼成纯文本；非文本部分用占位符标注 */
export function extractTextFromMcpResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as McpCallResult;
  if (!Array.isArray(r.content)) return "";

  const parts: string[] = [];
  for (const c of r.content) {
    if (c && typeof c === "object") {
      if (typeof c.text === "string") parts.push(c.text);
      else if (c.type) parts.push(`[${c.type}]`);
    }
  }
  return parts.join("\n").trim();
}

export function mcpResultIsError(result: unknown): boolean {
  return Boolean(
    result && typeof result === "object" && (result as McpCallResult).isError,
  );
}

/** 截断成短摘要（UI / 审计），默认 200 字 */
export function summarizeToolResult(text: string, maxLen = 200): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen) + "…";
}
