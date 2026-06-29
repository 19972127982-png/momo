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

/**
 * 进程内（local）工具定义。
 *
 * 有些能力（如 Electron 剪贴板 / 系统通知）只能在宿主进程里直接调，无法塞进一个独立
 * stdio 子进程。host 因此支持「local server」：工具就是一个内联 handler 函数。
 * handler 由宿主（apps/desktop main）注入，mcp-host 本身不依赖 Electron。
 */
export interface LocalToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  /** 该工具的权限 scope（read 透传 / write 等走审批） */
  scope: ToolScope;
  /** 执行体：返回给 LLM 的文本结果（抛错即视为失败）。 */
  handler: (args: Record<string, unknown>) => string | Promise<string>;
}

/** 一个进程内 server 的配置（无子进程，工具即 handler） */
export interface LocalServerConfig {
  id: string;
  tools: readonly LocalToolDef[];
}

/** host.invoke 的结果 —— 与 agent-core ToolResolution 对齐 */
export type McpInvokeResult =
  | { ok: true; resultSummary: string; resultFull: string }
  | { ok: false; error: string };
