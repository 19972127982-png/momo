import { describe, expect, it } from "vitest";
import { FileAgent } from "../src/file-agent";
import type {
  FunctionCallingClient,
  FunctionCallingOptions,
  FunctionCallingResult,
  FunctionTool,
} from "../src/function-calling-client";
import type { AgentEvent, AgentRunContext, ToolResolution } from "../src/types";

/** 按脚本依次返回结果的 mock client，记录每次入参 */
class ScriptedFcClient implements FunctionCallingClient {
  calls: FunctionCallingOptions[] = [];
  constructor(private script: FunctionCallingResult[]) {}
  async complete(opts: FunctionCallingOptions): Promise<FunctionCallingResult> {
    this.calls.push(opts);
    return this.script.shift() ?? { content: "（脚本耗尽）" };
  }
}

const TOOLS: FunctionTool[] = [
  {
    type: "function",
    function: {
      name: "filesystem__list_directory",
      description: "list a directory",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  },
];

function makeCtx(userInput: string): AgentRunContext {
  return {
    userInput,
    workingMemory: [],
    userProfileSummary: "",
    recentEpisodicMemories: [],
    personality: { energy: 0, attachment: 0.2, sensitivity: -0.3 },
    growthStage: "初识",
    totalInteractions: 0,
    personaName: "小桃",
    signal: new AbortController().signal,
  };
}

/** 驱动 generator：tool-call 时用 resolveTool 喂回，其余事件 next(undefined) */
async function drive(
  agent: FileAgent,
  ctx: AgentRunContext,
  resolveTool: (
    ev: Extract<AgentEvent, { kind: "tool-call" }>,
  ) => ToolResolution | undefined,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const gen = agent.run(ctx);
  let res = await gen.next();
  while (!res.done) {
    const ev = res.value;
    events.push(ev);
    if (ev.kind === "tool-call") {
      res = await gen.next(resolveTool(ev));
    } else {
      res = await gen.next(undefined);
    }
  }
  return events;
}

describe("FileAgent", () => {
  it("无需工具时直接出最终答复", async () => {
    const client = new ScriptedFcClient([{ content: "你桌面挺干净的呀" }]);
    const agent = new FileAgent({ client, getTools: () => TOOLS });
    const events = await drive(agent, makeCtx("随便聊"), () => ({
      ok: true,
      resultSummary: "",
      resultFull: "",
    }));
    expect(events.map((e) => e.kind)).toEqual(["thinking-end", "text", "done"]);
    expect(events.find((e) => e.kind === "text")).toMatchObject({
      text: "你桌面挺干净的呀",
    });
    expect(client.calls).toHaveLength(1);
  });

  it("一次工具调用后给答复（ReAct 单步）", async () => {
    const client = new ScriptedFcClient([
      {
        toolCalls: [
          {
            id: "t1",
            name: "filesystem__list_directory",
            arguments: '{"path":"~/Desktop"}',
          },
        ],
      },
      { content: "你桌面上有 a.txt 和 b.md" },
    ]);
    const agent = new FileAgent({ client, getTools: () => TOOLS });

    const events = await drive(agent, makeCtx("列一下我桌面"), (ev) => {
      expect(ev.serverId).toBe("filesystem");
      expect(ev.toolName).toBe("list_directory");
      expect(ev.scope).toBe("read");
      expect(ev.args).toEqual({ path: "~/Desktop" });
      return { ok: true, resultSummary: "2 个文件", resultFull: "a.txt\nb.md" };
    });

    expect(events.map((e) => e.kind)).toEqual([
      "tool-call",
      "thinking-end",
      "text",
      "done",
    ]);
    expect(events.find((e) => e.kind === "text")).toMatchObject({
      text: "你桌面上有 a.txt 和 b.md",
    });

    // 第二次 complete 应带上 assistant(toolCalls) + tool 结果消息
    const secondMsgs = client.calls[1].messages;
    const assistantMsg = secondMsgs.find((m) => m.role === "assistant");
    expect(assistantMsg?.toolCalls?.[0].id).toBe("t1");
    const toolMsg = secondMsgs.find((m) => m.role === "tool");
    expect(toolMsg?.toolCallId).toBe("t1");
    expect(toolMsg?.content).toBe("a.txt\nb.md");
  });

  it("工具失败时把错误回喂 LLM", async () => {
    const client = new ScriptedFcClient([
      {
        toolCalls: [
          { id: "t1", name: "filesystem__read_file", arguments: "{}" },
        ],
      },
      { content: "那个文件好像读不了，要不换一个？" },
    ]);
    const agent = new FileAgent({ client, getTools: () => TOOLS });

    await drive(agent, makeCtx("读个文件"), () => ({
      ok: false,
      error: "权限拒绝",
    }));

    const toolMsg = client.calls[1].messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("工具调用失败：权限拒绝");
  });

  it("getScope 决定 scope", async () => {
    const client = new ScriptedFcClient([
      {
        toolCalls: [
          { id: "t1", name: "filesystem__write_file", arguments: "{}" },
        ],
      },
      { content: "done" },
    ]);
    const agent = new FileAgent({
      client,
      getTools: () => TOOLS,
      getScope: (n) => (n.includes("write") ? "write" : "read"),
    });
    let seenScope = "";
    await drive(agent, makeCtx("写文件"), (ev) => {
      seenScope = ev.scope;
      return { ok: true, resultSummary: "", resultFull: "ok" };
    });
    expect(seenScope).toBe("write");
  });

  it("client 报错 → error 事件", async () => {
    const client = new ScriptedFcClient([{ error: "DeepSeek 返回 500" }]);
    const agent = new FileAgent({ client, getTools: () => TOOLS });
    const events = await drive(agent, makeCtx("列桌面"), () => ({
      ok: true,
      resultSummary: "",
      resultFull: "",
    }));
    expect(events).toEqual([{ kind: "error", error: "DeepSeek 返回 500" }]);
  });

  it("超过 maxSteps → error", async () => {
    // 永远返回 toolCalls，逼到步数上限
    const loop = (): FunctionCallingResult => ({
      toolCalls: [
        { id: "x", name: "filesystem__list_directory", arguments: "{}" },
      ],
    });
    const client = new ScriptedFcClient([loop(), loop(), loop()]);
    const agent = new FileAgent({ client, getTools: () => TOOLS, maxSteps: 2 });
    const events = await drive(agent, makeCtx("列桌面"), () => ({
      ok: true,
      resultSummary: "",
      resultFull: "ok",
    }));
    const last = events[events.length - 1];
    expect(last.kind).toBe("error");
    expect(last).toMatchObject({
      error: expect.stringContaining("步数超过上限"),
    });
    expect(client.calls).toHaveLength(2);
  });

  it("host 未喂回 resolution → error", async () => {
    const client = new ScriptedFcClient([
      {
        toolCalls: [
          { id: "t1", name: "filesystem__list_directory", arguments: "{}" },
        ],
      },
    ]);
    const agent = new FileAgent({ client, getTools: () => TOOLS });
    const events = await drive(agent, makeCtx("列桌面"), () => undefined);
    const last = events[events.length - 1];
    expect(last.kind).toBe("error");
    expect(last).toMatchObject({ error: expect.stringContaining("未喂回") });
  });
});
