/**
 * McpHost —— spawn + 连接 MCP server（stdio），缓存工具列表，转发调用（W3 D6）
 *
 * 用法（桌面端 main 进程）：
 *   const host = new McpHost()
 *   await host.register({ id:'filesystem', command:'npx',
 *     args:['-y','@modelcontextprotocol/server-filesystem', desktopDir], defaultScope:'read' })
 *   const tools = host.listFunctionTools()        // 喂给 FileAgent
 *   const res = await host.invoke('filesystem__list_directory', { path: desktopDir })
 *   await host.close()                            // app will-quit
 *
 * 只读约定（W3）：filesystem server 启动时只给白名单目录，FileAgent 也只调 list/read 类工具。
 * 写操作的审批闸留到 W4。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  parseNamespacedToolName,
  type FunctionTool,
  type ToolScope,
} from "@echopet/agent-core";
import type {
  McpInvokeResult,
  McpServerConfig,
  McpToolDescriptor,
} from "./types";
import {
  extractTextFromMcpResult,
  inferScope,
  mcpResultIsError,
  mcpToolToFunctionTool,
  summarizeToolResult,
} from "./bridge";

interface RegisteredServer {
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolDescriptor[];
}

/** 过滤掉值为 undefined 的环境变量（StdioClientTransport 的 env 不接受 undefined） */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export class McpHost {
  private servers = new Map<string, RegisteredServer>();

  /** 启动并连接一个 MCP server，缓存其工具列表。失败抛错（调用方决定降级）。 */
  async register(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.id)) return;

    // 不传 env 时 SDK 用 getDefaultEnvironment()（含 PATH，npx 可用）；
    // 传了就要自己带上 PATH，所以这里 merge 当前进程环境。
    const env = config.env
      ? { ...cleanEnv(process.env), ...config.env }
      : undefined;

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      ...(env ? { env } : {}),
    });
    const client = new Client(
      { name: "echopet-host", version: "0.1.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    const listed = await client.listTools();
    const tools: McpToolDescriptor[] = (listed.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));

    this.servers.set(config.id, { config, client, transport, tools });
  }

  isRegistered(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  /** 所有已连接 server 的工具，命名空间化后给 LLM */
  listFunctionTools(): FunctionTool[] {
    const out: FunctionTool[] = [];
    for (const [id, s] of this.servers) {
      for (const t of s.tools) out.push(mcpToolToFunctionTool(t, id));
    }
    return out;
  }

  /** 命名空间工具名 → scope（server 配置 defaultScope 优先，否则按名字推断） */
  scopeOf(fcName: string): ToolScope {
    const { serverId, toolName } = parseNamespacedToolName(fcName);
    const s = this.servers.get(serverId);
    return s?.config.defaultScope ?? inferScope(toolName);
  }

  /** 执行一次工具调用。不抛异常 —— 失败走 McpInvokeResult.error。 */
  async invoke(fcName: string, args: unknown): Promise<McpInvokeResult> {
    const { serverId, toolName } = parseNamespacedToolName(fcName);
    const server = this.servers.get(serverId);
    if (!server) return { ok: false, error: `未知的 MCP server：${serverId}` };

    try {
      const result = await server.client.callTool({
        name: toolName,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
      const text = extractTextFromMcpResult(result);
      if (mcpResultIsError(result)) {
        return { ok: false, error: text || "工具返回错误" };
      }
      return {
        ok: true,
        resultSummary: summarizeToolResult(text),
        resultFull: text,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** 关闭所有 server（终止子进程）。幂等。 */
  async close(): Promise<void> {
    const all = [...this.servers.values()];
    this.servers.clear();
    await Promise.allSettled(all.map((s) => s.client.close()));
  }
}
