/**
 * FileAgent —— v2.1 工作族 Agent（W3 D6 起骨架）
 *
 * 行为（ReAct loop）：
 *   1. 用 system + 用户输入起手，带上可用工具列表调 FunctionCallingClient
 *   2. LLM 要调工具 → yield tool-call event；外部（mcp-host）执行后用 generator.next(resolution) 喂回
 *   3. 把 tool 结果作为 role=tool 消息回喂，继续让 LLM 决策（多步 ReAct，<= maxSteps）
 *   4. LLM 给最终答复 → yield thinking-end + text + done
 *
 * 不做的事（W3）：审批闸（host 侧自动放行 read）、写操作（W4）、流式 token（一次性返回）。
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
  /** 按命名空间工具名判定 scope（影响审批；W3 read 自动放行） */
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
}

const DEFAULT_MAX_STEPS = 8;

function buildSystemPrompt(personaName: string, hint?: string): string {
  const base = `你是「${personaName}」，住在用户桌面的小伙伴，现在帮 ta 处理一个跟文件/桌面有关的小请求。
你可以调用提供的工具来查看目录、读取文件等（只读，不会改动 ta 的东西）。
拿到工具结果后，用「${personaName}」自然口语的口吻，简洁地把结果讲给 ta 听——
别贴原始 JSON，别长篇大论，像朋友一样说重点（比如桌面上有哪些东西）。`;
  return hint ? `${base}\n\n${hint}` : base;
}

export class FileAgent implements Agent {
  readonly name = "FileAgent";
  readonly family = "utility" as const;

  private readonly client: FunctionCallingClient;
  private readonly getTools: () => readonly FunctionTool[];
  private readonly getScope: (fcName: string) => ToolScope;
  private readonly maxSteps: number;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly systemHint?: string;

  constructor(opts: FileAgentOptions) {
    this.client = opts.client;
    this.getTools = opts.getTools;
    this.getScope = opts.getScope ?? (() => "read");
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.temperature = opts.temperature ?? 0.3;
    this.maxTokens = opts.maxTokens ?? 512;
    this.systemHint = opts.systemHint;
  }

  async *run(
    ctx: AgentRunContext,
  ): AsyncGenerator<AgentEvent, void, ToolResolution | undefined> {
    const messages: ChatCompletionMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(ctx.personaName, this.systemHint),
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
