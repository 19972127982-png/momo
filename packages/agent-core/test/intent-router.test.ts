import { describe, expect, it } from "vitest";
import {
  classifyIntentByKeywords,
  KeywordIntentRouter,
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
