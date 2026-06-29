export type {
  McpServerConfig,
  McpToolDescriptor,
  McpInvokeResult,
  LocalToolDef,
  LocalServerConfig,
} from "./types";

export {
  mcpToolToFunctionTool,
  inferScope,
  extractTextFromMcpResult,
  mcpResultIsError,
  summarizeToolResult,
} from "./bridge";

export { McpHost } from "./host";
export type { ServerInfo } from "./host";
