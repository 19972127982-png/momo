import { describe, expect, it } from "vitest";
import {
  extractTextFromMcpResult,
  inferScope,
  mcpResultIsError,
  mcpToolToFunctionTool,
  summarizeToolResult,
} from "../src/bridge";

describe("mcpToolToFunctionTool", () => {
  it("工具名命名空间化 + inputSchema 透传为 parameters", () => {
    const ft = mcpToolToFunctionTool(
      {
        name: "list_directory",
        description: "list a dir",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
      "filesystem",
    );
    expect(ft.type).toBe("function");
    expect(ft.function.name).toBe("filesystem__list_directory");
    expect(ft.function.description).toBe("list a dir");
    expect(ft.function.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
    });
  });

  it("缺 inputSchema 时给空 object schema", () => {
    const ft = mcpToolToFunctionTool({ name: "ping" }, "svc");
    expect(ft.function.parameters).toEqual({ type: "object", properties: {} });
    expect(ft.function.description).toBe("");
  });
});

describe("inferScope", () => {
  it("list/read/get/本地 search → read", () => {
    expect(inferScope("list_directory")).toBe("read");
    expect(inferScope("read_file")).toBe("read");
    expect(inferScope("get_file_info")).toBe("read");
    // 本地文件搜索属 read，不应被当成网络
    expect(inferScope("search_files")).toBe("read");
  });
  it("write/create/edit/move/delete → write", () => {
    expect(inferScope("write_file")).toBe("write");
    expect(inferScope("create_directory")).toBe("write");
    expect(inferScope("move_file")).toBe("write");
    expect(inferScope("delete_file")).toBe("write");
  });
  it("exec/run/shell → exec", () => {
    expect(inferScope("run_command")).toBe("exec");
    expect(inferScope("exec_shell")).toBe("exec");
  });
  it("fetch/web/download → network", () => {
    expect(inferScope("brave_web_search")).toBe("network");
    expect(inferScope("fetch_url")).toBe("network");
    expect(inferScope("download_file")).toBe("network");
  });
  it("命名空间化的名字也能判", () => {
    expect(inferScope("filesystem__write_file")).toBe("write");
  });
});

describe("extractTextFromMcpResult", () => {
  it("拼接 text 部分", () => {
    const r = {
      content: [
        { type: "text", text: "a.txt" },
        { type: "text", text: "b.md" },
      ],
    };
    expect(extractTextFromMcpResult(r)).toBe("a.txt\nb.md");
  });
  it("非文本部分用占位符", () => {
    const r = { content: [{ type: "text", text: "hi" }, { type: "image" }] };
    expect(extractTextFromMcpResult(r)).toBe("hi\n[image]");
  });
  it("无 content / 非对象 → 空串", () => {
    expect(extractTextFromMcpResult({})).toBe("");
    expect(extractTextFromMcpResult(null)).toBe("");
    expect(extractTextFromMcpResult("nope")).toBe("");
  });
});

describe("mcpResultIsError", () => {
  it("isError 标志", () => {
    expect(mcpResultIsError({ isError: true, content: [] })).toBe(true);
    expect(mcpResultIsError({ content: [] })).toBe(false);
    expect(mcpResultIsError(null)).toBe(false);
  });
});

describe("summarizeToolResult", () => {
  it("短文本原样（折叠空白）", () => {
    expect(summarizeToolResult("a.txt\n b.md")).toBe("a.txt b.md");
  });
  it("超长截断加省略号", () => {
    const long = "x".repeat(300);
    const s = summarizeToolResult(long, 200);
    expect(s.length).toBe(201);
    expect(s.endsWith("…")).toBe(true);
  });
});
