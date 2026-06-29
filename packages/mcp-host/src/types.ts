/**
 * mcp-host 类型（W3 D6）
 */
import type { ToolScope } from "@echopet/agent-core";

/** 一个 MCP server 的启动配置（stdio transport） */
export interface McpServerConfig {
  /** 命名空间用，工具名前缀：'filesystem' / 'git' / ... */
  id: string;
  /** 可执行命令，如 'npx' */
  command: string;
  /** 命令参数，如 ['-y', '@modelcontextprotocol/server-filesystem', '/path'] */
  args: string[];
  /** 额外环境变量 */
  env?: Record<string, string>;
  /**
   * 该 server 工具的默认 scope（W3：filesystem 白名单只读 → 'read'）。
   * 更细的按工具名推断见 bridge.inferScope。
   */
  defaultScope?: ToolScope;
}

/** MCP server 暴露的工具（listTools 的子集，bridge 只需要这些字段） */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** host.invoke 的结果 —— 与 agent-core ToolResolution 对齐 */
export type McpInvokeResult =
  | { ok: true; resultSummary: string; resultFull: string }
  | { ok: false; error: string };
