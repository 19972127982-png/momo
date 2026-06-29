import { describe, expect, it, vi } from "vitest";
import {
  classifyIntentByKeywords,
  classifyUtilityAgent,
  hasWeakTaskHint,
  KeywordIntentRouter,
  HybridIntentRouter,
  type LlmIntentClassifier,
} from "../src/intent-router";

describe("classifyIntentByKeywords", () => {
  it("「列一下我的桌面有什么」→ utility / FileAgent", () => {
    const r = classifyIntentByKeywords("列一下我的桌面有什么");
    expect(r.mode).toBe("utility");
    expect(r.agentName).toBe("FileAgent");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("「桌面上都有些啥」→ utility（强短语）", () => {
    expect(classifyIntentByKeywords("桌面上都有些啥").mode).toBe("utility");
  });

  it("「看看目录里有哪些文件」→ utility", () => {
    expect(classifyIntentByKeywords("看看目录里有哪些文件").mode).toBe(
      "utility",
    );
  });

  it("「读一下那个 md 文件」→ utility", () => {
    expect(classifyIntentByKeywords("帮我读一下那个 md 文件").mode).toBe(
      "utility",
    );
  });

  it("英文 list desktop → utility", () => {
    expect(classifyIntentByKeywords("list my desktop files").mode).toBe(
      "utility",
    );
  });

  it("普通闲聊 → companion", () => {
    const r = classifyIntentByKeywords("今天好累啊");
    expect(r.mode).toBe("companion");
    expect(r.agentName).toBeUndefined();
  });

  it("提到「文件」但非文件操作意图不误伤", () => {
    // 没有「动作+对象」组合，只是聊到文件这个词
    expect(classifyIntentByKeywords("我今天心情像废纸文件一样").mode).toBe(
      "companion",
    );
  });

  // —— W4：写 / 改类意图也要进 utility（之前会漏判成 companion）——
  it("「桌面创建一个新文件夹」→ utility", () => {
    expect(classifyIntentByKeywords("桌面创建一个新文件夹").mode).toBe(
      "utility",
    );
  });

  it("「在桌面的 TXT 里面写点东西」→ utility", () => {
    expect(classifyIntentByKeywords("在桌面的TXT里面写点东西").mode).toBe(
      "utility",
    );
  });

  it("「帮我新建一个 txt 文档」→ utility", () => {
    expect(classifyIntentByKeywords("帮我新建一个 txt 文档").mode).toBe(
      "utility",
    );
  });

  it("「把这个文件重命名」→ utility", () => {
    expect(classifyIntentByKeywords("把这个文件重命名").mode).toBe("utility");
  });

  it("明确点名「调用工具写」→ utility", () => {
    expect(classifyIntentByKeywords("没写进去啊，调用工具写").mode).toBe(
      "utility",
    );
  });

  it("英文 create file → utility", () => {
    expect(classifyIntentByKeywords("create a new file on desktop").mode).toBe(
      "utility",
    );
  });

  it("空输入 → companion", () => {
    expect(classifyIntentByKeywords("").mode).toBe("companion");
    expect(classifyIntentByKeywords("   ").mode).toBe("companion");
  });
});

describe("KeywordIntentRouter", () => {
  const router = new KeywordIntentRouter();
  const ctx = { workingMemory: [], signal: new AbortController().signal };

  it("route 返回 RouterResult", async () => {
    const r = await router.route("看看我桌面有什么", ctx);
    expect(r.mode).toBe("utility");
    expect(r.agentName).toBe("FileAgent");
    expect(r.scores?.keyword).toBeGreaterThan(0);
  });

  it("闲聊走 companion", async () => {
    const r = await router.route("陪我聊会儿天", ctx);
    expect(r.mode).toBe("companion");
  });
});

describe("classifyUtilityAgent（二级路由）", () => {
  it("剪贴板 / 通知 → SystemAgent", () => {
    expect(classifyUtilityAgent("把这段复制到剪贴板").agent).toBe(
      "SystemAgent",
    );
    expect(classifyUtilityAgent("一会儿弹个提醒我").agent).toBe("SystemAgent");
  });

  it("文件 / 桌面 / 默认 → FileAgent", () => {
    expect(classifyUtilityAgent("在桌面新建一个 txt").agent).toBe("FileAgent");
    expect(classifyUtilityAgent("整理一下我的文件").agent).toBe("FileAgent");
    expect(classifyUtilityAgent("随便干点啥").agent).toBe("FileAgent");
  });
});

describe("hasWeakTaskHint", () => {
  it("带文件/动作/工具词 → true", () => {
    expect(hasWeakTaskHint("没写进去啊，调用工具写")).toBe(true);
    expect(hasWeakTaskHint("帮我整理一下")).toBe(true);
    expect(hasWeakTaskHint("桌面那个东西")).toBe(true);
  });
  it("纯闲聊 → false", () => {
    expect(hasWeakTaskHint("今天好累啊")).toBe(false);
    expect(hasWeakTaskHint("你喜欢我吗")).toBe(false);
    expect(hasWeakTaskHint("")).toBe(false);
  });
});

describe("HybridIntentRouter", () => {
  const ctx = { workingMemory: [], signal: new AbortController().signal };

  const fakeClassifier = (
    mode: "utility" | "companion" | null,
  ): LlmIntentClassifier => ({
    classify: vi.fn(async () =>
      mode === null
        ? null
        : mode === "utility"
          ? {
              mode: "utility" as const,
              confidence: 0.75,
              agentName: "FileAgent",
            }
          : { mode: "companion" as const, confidence: 0.7 },
    ),
  });

  it("关键词命中 utility → 直接用，不调 LLM", async () => {
    const clf = fakeClassifier("companion");
    const router = new HybridIntentRouter({ classifier: clf });
    const r = await router.route("列一下我的桌面有什么", ctx);
    expect(r.mode).toBe("utility");
    expect(clf.classify).not.toHaveBeenCalled();
  });

  it("纯闲聊（无弱信号）→ companion，不调 LLM", async () => {
    const clf = fakeClassifier("utility");
    const router = new HybridIntentRouter({ classifier: clf });
    const r = await router.route("今天好累啊", ctx);
    expect(r.mode).toBe("companion");
    expect(clf.classify).not.toHaveBeenCalled();
  });

  it("关键词漏判但带弱信号 → LLM 兜底判 utility", async () => {
    const clf = fakeClassifier("utility");
    const router = new HybridIntentRouter({ classifier: clf });
    const r = await router.route("那个东西帮我写一下嘛", ctx);
    expect(clf.classify).toHaveBeenCalledOnce();
    expect(r.mode).toBe("utility");
    expect(r.agentName).toBe("FileAgent");
    expect(r.scores?.llm).toBe(0.75);
  });

  it("LLM 返回 null（不确定）→ 退回关键词 companion", async () => {
    const clf = fakeClassifier(null);
    const router = new HybridIntentRouter({ classifier: clf });
    const r = await router.route("帮我处理一下文件这个事", ctx);
    expect(clf.classify).toHaveBeenCalledOnce();
    expect(r.mode).toBe("companion");
  });

  it("LLM 抛错 → 退回关键词 companion，不冒泡", async () => {
    const clf: LlmIntentClassifier = {
      classify: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };
    const router = new HybridIntentRouter({ classifier: clf });
    // 「那个东西帮我弄一下」：关键词判 companion，但带弱信号「帮我弄」→ 触发兜底
    const r = await router.route("那个东西帮我弄一下", ctx);
    expect(clf.classify).toHaveBeenCalledOnce();
    expect(r.mode).toBe("companion");
  });

  it("没有 classifier → 退化为纯关键词", async () => {
    const router = new HybridIntentRouter();
    const r = await router.route("今天好累啊", ctx);
    expect(r.mode).toBe("companion");
  });
});
