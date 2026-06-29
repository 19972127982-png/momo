import { describe, expect, it } from "vitest";
import {
  classifyDroppedFile,
  truncateForSummary,
  buildFileSummaryMessages,
  emptyImageTextReply,
  unsupportedFileReply,
  SUMMARY_MAX_CHARS,
} from "../src/file-summary";

describe("classifyDroppedFile", () => {
  it("文本扩展名 → text", () => {
    for (const f of [
      "a.txt",
      "README.md",
      "data.json",
      "x.csv",
      "main.py",
      "App.tsx",
      "q.sql",
    ]) {
      expect(classifyDroppedFile(f)).toBe("text");
    }
  });
  it("图片扩展名 → image", () => {
    for (const f of ["a.png", "b.JPG", "c.jpeg", "d.webp", "e.gif", "f.tiff"]) {
      expect(classifyDroppedFile(f)).toBe("image");
    }
  });
  it("无扩展名的常见文件名 → text", () => {
    expect(classifyDroppedFile("Dockerfile")).toBe("text");
    expect(classifyDroppedFile("Makefile")).toBe("text");
    expect(classifyDroppedFile(".gitignore")).toBe("text");
    expect(classifyDroppedFile(".env")).toBe("text");
  });
  it("带路径也能判", () => {
    expect(classifyDroppedFile("/Users/x/Desktop/notes.md")).toBe("text");
    expect(classifyDroppedFile("C:\\\\Users\\\\x\\\\pic.png")).toBe("image");
  });
  it("不支持类型 → unsupported", () => {
    for (const f of ["a.zip", "b.exe", "c.dmg", "noext"]) {
      expect(classifyDroppedFile(f)).toBe("unsupported");
    }
  });
});

describe("truncateForSummary", () => {
  it("短文本原样", () => {
    expect(truncateForSummary("hello")).toEqual({
      text: "hello",
      truncated: false,
    });
  });
  it("超长截断", () => {
    const long = "x".repeat(SUMMARY_MAX_CHARS + 100);
    const r = truncateForSummary(long);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(SUMMARY_MAX_CHARS);
  });
  it("自定义上限", () => {
    expect(truncateForSummary("abcdef", 3)).toEqual({
      text: "abc",
      truncated: true,
    });
  });
});

describe("buildFileSummaryMessages", () => {
  it("文本文件：system 含人格 + user 含内容", () => {
    const msgs = buildFileSummaryMessages({
      personaName: "小桃",
      filename: "notes.md",
      kind: "text",
      content: "# 待办\n买菜",
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("小桃");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain("notes.md");
    expect(msgs[1].content).toContain("买菜");
  });

  it("图片文件：user 提到 OCR", () => {
    const msgs = buildFileSummaryMessages({
      personaName: "小桃",
      filename: "shot.png",
      kind: "image",
      content: "会议纪要",
    });
    expect(msgs[1].content).toContain("OCR");
    expect(msgs[1].content).toContain("shot.png");
  });

  it("userCalling 注入 system", () => {
    const msgs = buildFileSummaryMessages({
      personaName: "小桃",
      userCalling: "Lily",
      filename: "a.txt",
      kind: "text",
      content: "hi",
    });
    expect(msgs[0].content).toContain("Lily");
  });

  it("truncated 标记体现在 user 文案", () => {
    const msgs = buildFileSummaryMessages({
      personaName: "小桃",
      filename: "a.txt",
      kind: "text",
      content: "hi",
      truncated: true,
    });
    expect(msgs[1].content).toContain("开头");
  });
});

describe("边界提示语", () => {
  it("空 OCR 提示含人格名", () => {
    expect(emptyImageTextReply("小桃")).toContain("小桃");
  });
  it("不支持类型提示含文件名", () => {
    expect(unsupportedFileReply("/a/b/foo.zip")).toContain("foo.zip");
  });
});
