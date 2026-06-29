/**
 * FileAgent —— v2.1 工作族 Agent（W3 D6 起骨架）
 *
 * 行为（ReAct loop）：
 *   1. 用 system + 用户输入起手，带上可用工具列表调 FunctionCallingClient
 *   2. LLM 要调工具 → yield tool-call event；外部（mcp-host）执行后用 generator.next(resolution) 喂回
 *   3. 把 tool 结果作为 role=tool 消息回喂，继续让 LLM 决策（多步 ReAct，<= maxSteps）
 *   4. LLM 给最终答复 → yield thinking-end + text + done
 *
 * W4：放开写操作 —— read 自动放行，write/exec/network 经权限闸弹审批（桌面端 chat:send 接）。
 * 暂不做：流式 token（一次性返回）。
 *
 * 工具列表是运行时由 MCP host 发现的，通过 getTools/getScope 回调注入（Agent.run 签名固定）。
 */
import type {
  Agent,
  AgentEvent,
  AgentRunContext,
  ChatCompletionMessage,
  ToolResolution,
  ToolScope,
} from "./types";
import type {
  FunctionCallingClient,
  FunctionTool,
} from "./function-calling-client";
import { parseNamespacedToolName } from "./fc-naming";

export interface FileAgentOptions {
  client: FunctionCallingClient;
  /** 运行时取当前可用工具（mcp-host 发现后提供） */
  getTools: () => readonly FunctionTool[];
  /** 按命名空间工具名判定 scope（影响审批；read 自动放行，write/exec/network 走审批） */
  getScope?: (fcName: string) => ToolScope;
  /** ReAct loop 步数上限（与状态机 MAX_TOOL_STEPS 对齐，默认 8） */
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  /**
   * 附加到 system prompt 的环境提示（如「桌面绝对路径是 /Users/x/Desktop」）。
   * 让 LLM 第一次调工具就用对路径，省掉试错的 ReAct 轮次。
   */
  systemHint?: string;
  /** Agent 名（出现在 tool-call 事件 + 审计日志）。默认 "FileAgent"。 */
  name?: string;
  /** 处理的领域短语，拼进 prompt（如「跟文件/桌面有关」）。 */
  domain?: string;
  /** 能力描述句，拼进 prompt（告诉 LLM 它能用工具做什么）。 */
  capabilities?: string;
}

const DEFAULT_MAX_STEPS = 8;

const DEFAULT_DOMAIN = "跟文件/桌面有关";
const DEFAULT_CAPABILITIES =
  "你能用提供的工具查看目录、读取文件，也能新建/写入/修改/重命名/移动/删除文件和文件夹。";

function buildSystemPrompt(
  personaName: string,
  opts: { domain: string; capabilities: string; hint?: string },
): string {
  const base = `你是「${personaName}」，住在用户桌面的小伙伴，现在帮 ta 处理一个${opts.domain}的小请求。
${opts.capabilities}
重要原则：
- 当 ta 让你做「写 / 新建 / 创建 / 保存 / 修改 / 移动 / 删除 / 提交」这类动作时，请**真的去调用对应的工具**，不要只是口头答应或只读不动手。
- 改动类操作会先弹给 ta 确认，你不用在文字里反复征求同意——直接调用工具即可，系统会替 ta 把关。
- 信息不全时（比如没说文件名/内容），先用合理的默认值动手做，再把你做了什么告诉 ta，而不是一直追问。
拿到工具结果后，用「${personaName}」自然口语的口吻简洁汇报——别贴原始 JSON，别长篇大论，像朋友一样说重点（做了什么、放在哪）。`;
  return opts.hint ? `${base}\n\n${opts.hint}` : base;
}

/**
 * 通用「工具使用」Agent（ReAct loop）。FileAgent 是它的默认形态（文件/桌面领域）；
 * 传入不同的 name/domain/capabilities + 工具集即可复用成 DevAgent（git）/ SystemAgent 等。
 */
export class FileAgent implements Agent {
  readonly name: string;
  readonly family = "utility" as const;

  private readonly client: FunctionCallingClient;
  private readonly getTools: () => readonly FunctionTool[];
  private readonly getScope: (fcName: string) => ToolScope;
  private readonly maxSteps: number;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly systemHint?: string;
  private readonly domain: string;
  private readonly capabilities: string;

  constructor(opts: FileAgentOptions) {
    this.client = opts.client;
    this.getTools = opts.getTools;
    this.getScope = opts.getScope ?? (() => "read");
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.temperature = opts.temperature ?? 0.3;
    this.maxTokens = opts.maxTokens ?? 512;
    this.systemHint = opts.systemHint;
    this.name = opts.name ?? "FileAgent";
    this.domain = opts.domain ?? DEFAULT_DOMAIN;
    this.capabilities = opts.capabilities ?? DEFAULT_CAPABILITIES;
  }

  async *run(
    ctx: AgentRunContext,
  ): AsyncGenerator<AgentEvent, void, ToolResolution | undefined> {
    const messages: ChatCompletionMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(ctx.personaName, {
          domain: this.domain,
          capabilities: this.capabilities,
          hint: this.systemHint,
        }),
      },
      { role: "user", content: ctx.userInput },
    ];

    for (let step = 0; step < this.maxSteps; step++) {
      const result = await this.client.complete({
        messages,
        tools: this.getTools(),
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        signal: ctx.signal,
      });

      if (result.error) {
        yield { kind: "error", error: result.error };
        return;
      }

      const toolCalls = result.toolCalls ?? [];
      if (toolCalls.length === 0) {
        // 最终答复
        yield { kind: "thinking-end" };
        const content = result.content ?? "";
        if (content.length > 0) yield { kind: "text", text: content };
        yield { kind: "done" };
        return;
      }

      // 记录 assistant 的 tool_calls（回喂下一轮 LLM 必须带上）
      messages.push({
        role: "assistant",
        content: result.content ?? "",
        toolCalls,
      });

      for (const tc of toolCalls) {
        const { serverId, toolName } = parseNamespacedToolName(tc.name);
        const argsSummary = tc.arguments.slice(0, 200);
        let parsedArgs: unknown = tc.arguments;
        try {
          parsedArgs = JSON.parse(tc.arguments);
        } catch {
          /* 保留原始字符串 */
        }

        const resolution = yield {
          kind: "tool-call",
          agentName: this.name,
          serverId,
          toolName,
          args: parsedArgs,
          argsSummary,
          scope: this.getScope(tc.name),
        };

        if (!resolution) {
          yield {
            kind: "error",
            error: "工具调用没有返回结果（host 未喂回 resolution）",
          };
          return;
        }

        messages.push({
          role: "tool",
          toolCallId: tc.id,
          name: tc.name,
          content: resolution.ok
            ? resolution.resultFull
            : `工具调用失败：${resolution.error}`,
        });
      }
    }

    yield {
      kind: "error",
      error: `工具调用步数超过上限（${this.maxSteps} 步）`,
    };
  }
}
