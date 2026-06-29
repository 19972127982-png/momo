import { describe, expect, it } from "vitest";
import { McpHost } from "../src/host";

/**
 * 进程内（local）server 路径单测（W4 D6）。
 * 不涉及 stdio 子进程，纯验证 registerLocal / listFunctionTools / scopeOf / invoke。
 */
function makeHost(): McpHost {
  const host = new McpHost();
  host.registerLocal({
    id: "system",
    tools: [
      {
        name: "read_clipboard",
        scope: "read",
        handler: () => "hello",
      },
      {
        name: "write_clipboard",
        scope: "write",
        handler: (args) => `wrote:${String(args.text)}`,
      },
      {
        name: "boom",
        scope: "write",
        handler: () => {
          throw new Error("炸了");
        },
      },
    ],
  });
  return host;
}

describe("McpHost · local server", () => {
  it("注册后 isRegistered / listServers 反映出来", () => {
    const host = makeHost();
    expect(host.isRegistered("system")).toBe(true);
    const servers = host.listServers();
    expect(servers).toEqual([{ id: "system", kind: "local", toolCount: 3 }]);
  });

  it("listFunctionTools 命名空间化，可按 serverIds 过滤", () => {
    const host = makeHost();
    const tools = host.listFunctionTools(["system"]);
    expect(tools.map((t) => t.function.name)).toContain("system__read_clipboard");
    expect(host.listFunctionTools(["other"])).toEqual([]);
  });

  it("scopeOf 用工具声明的 scope", () => {
    const host = makeHost();
    expect(host.scopeOf("system__read_clipboard")).toBe("read");
    expect(host.scopeOf("system__write_clipboard")).toBe("write");
  });

  it("invoke 调 handler，成功返回摘要 + 全文", async () => {
    const host = makeHost();
    const r = await host.invoke("system__write_clipboard", { text: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resultFull).toBe("wrote:hi");
  });

  it("invoke handler 抛错 → ok:false", async () => {
    const host = makeHost();
    const r = await host.invoke("system__boom", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("炸了");
  });

  it("未知工具 → ok:false", async () => {
    const host = makeHost();
    const r = await host.invoke("system__nope", {});
    expect(r.ok).toBe(false);
  });

  it("unregister 后注销", async () => {
    const host = makeHost();
    await host.unregister("system");
    expect(host.isRegistered("system")).toBe(false);
    expect(host.listServers()).toEqual([]);
  });
});
