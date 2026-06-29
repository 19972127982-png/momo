import { describe, expect, it } from "vitest";
import {
  scopeNeedsApproval,
  targetMatches,
  grantIsActive,
  grantCovers,
  findCoveringGrant,
  evaluatePermission,
  buildGrantFromDecision,
  type PermissionGrant,
  type PermissionRequest,
} from "../src/permission";

const NOW = 1_000_000;

function grant(p: Partial<PermissionGrant>): PermissionGrant {
  return {
    scope: "write",
    targetPattern: "~/Desktop/**",
    grantedAt: NOW,
    expiresAt: null,
    revokedAt: null,
    ...p,
  };
}

describe("scopeNeedsApproval", () => {
  it("read 免审批，其余需审批", () => {
    expect(scopeNeedsApproval("read")).toBe(false);
    expect(scopeNeedsApproval("write")).toBe(true);
    expect(scopeNeedsApproval("exec")).toBe(true);
    expect(scopeNeedsApproval("network")).toBe(true);
  });
});

describe("targetMatches", () => {
  it("精确相等", () => {
    expect(targetMatches("clipboard", "clipboard")).toBe(true);
    expect(targetMatches("clipboard", "notify")).toBe(false);
  });

  it("** 跨段匹配子树", () => {
    expect(targetMatches("~/Desktop/**", "~/Desktop/a/b.txt")).toBe(true);
    expect(targetMatches("~/Desktop/**", "~/Desktop")).toBe(false);
    expect(targetMatches("~/Desktop/**", "~/Projects/x")).toBe(false);
  });

  it("* 只在段内匹配，不跨 /", () => {
    expect(targetMatches("~/Desktop/*.png", "~/Desktop/a.png")).toBe(true);
    expect(targetMatches("~/Desktop/*.png", "~/Desktop/sub/a.png")).toBe(false);
  });

  it("正则元字符按字面处理", () => {
    expect(targetMatches("a.b(c)", "a.b(c)")).toBe(true);
    expect(targetMatches("a.b(c)", "axbXcX")).toBe(false);
  });
});

describe("grantIsActive", () => {
  it("永久（expiresAt null）始终有效", () => {
    expect(grantIsActive(grant({ expiresAt: null }), NOW)).toBe(true);
  });

  it("已撤销则失效", () => {
    expect(grantIsActive(grant({ revokedAt: NOW - 1 }), NOW)).toBe(false);
  });

  it("过期则失效（expiresAt <= now）", () => {
    expect(grantIsActive(grant({ expiresAt: NOW }), NOW)).toBe(false);
    expect(grantIsActive(grant({ expiresAt: NOW + 1 }), NOW)).toBe(true);
  });
});

describe("grantCovers", () => {
  const req: PermissionRequest = { scope: "write", target: "~/Desktop/a.txt" };

  it("scope + target 命中且有效 → 覆盖", () => {
    expect(grantCovers(grant({}), req, NOW)).toBe(true);
  });

  it("scope 不同不覆盖", () => {
    expect(grantCovers(grant({ scope: "exec" }), req, NOW)).toBe(false);
  });

  it("target 不命中不覆盖", () => {
    expect(
      grantCovers(grant({ targetPattern: "~/Projects/**" }), req, NOW),
    ).toBe(false);
  });

  it("失效的 grant 不覆盖", () => {
    expect(grantCovers(grant({ revokedAt: NOW - 1 }), req, NOW)).toBe(false);
  });

  it("请求无 target 时只看 scope（target 视为空串）", () => {
    const g = grant({ scope: "network", targetPattern: "**" });
    expect(grantCovers(g, { scope: "network" }, NOW)).toBe(true);
  });
});

describe("findCoveringGrant", () => {
  it("返回第一条覆盖的 grant", () => {
    const grants = [
      grant({ targetPattern: "~/Projects/**" }),
      grant({ targetPattern: "~/Desktop/**" }),
    ];
    const hit = findCoveringGrant(
      grants,
      { scope: "write", target: "~/Desktop/x" },
      NOW,
    );
    expect(hit?.targetPattern).toBe("~/Desktop/**");
  });

  it("无覆盖返回 null", () => {
    expect(
      findCoveringGrant(
        [grant({})],
        { scope: "exec", target: "~/Desktop/x" },
        NOW,
      ),
    ).toBeNull();
  });
});

describe("evaluatePermission", () => {
  it("read 自动放行", () => {
    const d = evaluatePermission(
      { scope: "read", target: "~/Desktop" },
      [],
      NOW,
    );
    expect(d).toEqual({ decision: "allow", reason: "auto-read" });
  });

  it("write 命中 grant → 放行 + viaGrant", () => {
    const g = grant({});
    const d = evaluatePermission(
      { scope: "write", target: "~/Desktop/a.txt" },
      [g],
      NOW,
    );
    expect(d.decision).toBe("allow");
    expect(d.reason).toBe("granted");
    expect(d.viaGrant).toBe(g);
  });

  it("write 无 grant → 需审批", () => {
    const d = evaluatePermission({ scope: "write", target: "~/x" }, [], NOW);
    expect(d).toEqual({ decision: "needs-approval", reason: "no-grant" });
  });

  it("write grant 已过期 → 需审批", () => {
    const d = evaluatePermission(
      { scope: "write", target: "~/Desktop/a" },
      [grant({ expiresAt: NOW - 1 })],
      NOW,
    );
    expect(d.decision).toBe("needs-approval");
  });
});

describe("buildGrantFromDecision", () => {
  const req: PermissionRequest = {
    scope: "write",
    target: "~/Desktop/a.txt",
    agentName: "FileAgent",
    serverId: "filesystem-desktop",
  };

  it("deny / once 不留痕（返回 null）", () => {
    expect(buildGrantFromDecision(req, "deny", NOW)).toBeNull();
    expect(buildGrantFromDecision(req, "once", NOW)).toBeNull();
  });

  it("session / forever 生成永久形状 grant（过期判定交存储层/进程生命周期）", () => {
    const g = buildGrantFromDecision(req, "forever", NOW);
    expect(g).toMatchObject({
      scope: "write",
      targetPattern: "~/Desktop/a.txt",
      agentName: "FileAgent",
      serverId: "filesystem-desktop",
      grantedAt: NOW,
      expiresAt: null,
      revokedAt: null,
    });
  });

  it("无 target 时退化为 ** 全匹配", () => {
    const g = buildGrantFromDecision({ scope: "network" }, "session", NOW);
    expect(g?.targetPattern).toBe("**");
  });
});
