export type {
  McpServerConfig,
  McpToolDescriptor,
  McpInvokeResult,
} from "./types";

export {
  mcpToolToFunctionTool,
  inferScope,
  extractTextFromMcpResult,
  mcpResultIsError,
  summarizeToolResult,
} from "./bridge";

export { McpHost } from "./host";
