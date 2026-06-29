/**
 * 权限闸纯逻辑（W4 D1）
 *
 * 只做「给定一次工具调用请求 + 当前已授权清单 + 当前时间 → 是否放行 / 需审批」的纯判定，
 * 不碰 SQLite、不碰 IPC、不碰状态机 —— 那些副作用在 apps/desktop/main 的 PermissionGate 里。
 *
 * 设计要点（对齐 PRD §4.6.4）：
 *   - scope 四档：read / write / exec / network。`read` 默认免审批，其余默认需审批。
 *   - 授权三档：一次性（不落库）/ 本次会话（内存）/ 永久（permission_grants 表）。
 *     本模块不区分存储位置，只看「传进来的 grants 列表里有没有覆盖本次请求且仍有效的」。
 *   - grant 有效 = 未撤销（revokedAt 空）且未过期（expiresAt 空=永久，或 > now）。
 *   - target 匹配：支持 glob（`*` 段内通配、`**` 跨段通配），也兼容精确串（剪贴板/通知等非路径目标）。
 */
import type { ToolScope } from "./types";

/** 用户对一次审批的选择 */
export type GrantGrade = "once" | "session" | "forever" | "deny";

/** 一条授权记录（会话内存层与 permission_grants 表共用此形状） */
export interface PermissionGrant {
  scope: ToolScope;
  /** 目标匹配模式：路径 glob（如 `~/Desktop/**`）或精确串（如 `clipboard`） */
  targetPattern: string;
  agentName?: string;
  serverId?: string;
  grantedAt: number;
  /** null/undefined = 永久；数字 = 过期时间戳（本模块只用于有效性判定） */
  expiresAt?: number | null;
  /** 非空 = 已撤销 */
  revokedAt?: number | null;
}

/** 一次待判定的工具调用请求 */
export interface PermissionRequest {
  scope: ToolScope;
  /** 本次调用的目标：写文件的 path、git 仓库路径、`clipboard` 等。read 可不传。 */
  target?: string;
  agentName?: string;
  serverId?: string;
}

export interface PermissionDecision {
  decision: "allow" | "needs-approval";
  /** allow 时若来自某条 grant（而非 read 自动放行），指向命中的那条 */
  viaGrant?: PermissionGrant;
  /** 'auto-read' | 'granted' | 'no-grant' —— 便于审计与测试 */
  reason: "auto-read" | "granted" | "no-grant";
}

/** read 默认免审批；write/exec/network 默认需审批。 */
export function scopeNeedsApproval(scope: ToolScope): boolean {
  return scope !== "read";
}

/**
 * glob 匹配：`**` 匹配任意（含 `/` 与空），`*` 匹配非 `/` 段内字符，其余字符按字面。
 * 不做路径规范化（调用方负责把 `~` / 相对路径展开成可比较的绝对形式）。
 */
export function targetMatches(pattern: string, target: string): boolean {
  if (pattern === target) return true;
  const re = globToRegExp(pattern);
  return re.test(target);
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*"; // ** 跨段
        i++;
      } else {
        out += "[^/]*"; // * 段内
      }
    } else if ("\\^$.|?+()[]{}".includes(ch)) {
      out += "\\" + ch; // 转义正则元字符
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

/** grant 是否仍有效（未撤销 + 未过期）。 */
export function grantIsActive(grant: PermissionGrant, now: number): boolean {
  if (grant.revokedAt != null) return false;
  if (grant.expiresAt != null && grant.expiresAt <= now) return false;
  return true;
}

/** 某条 grant 是否覆盖本次请求（scope 相等 + target 命中 + 仍有效）。 */
export function grantCovers(
  grant: PermissionGrant,
  req: PermissionRequest,
  now: number,
): boolean {
  if (!grantIsActive(grant, now)) return false;
  if (grant.scope !== req.scope) return false;
  // target 缺省（如纯 read）时，只要 scope 命中即覆盖
  const target = req.target ?? "";
  return targetMatches(grant.targetPattern, target);
}

/** 找到第一条覆盖本次请求的有效 grant，没有则返回 null。 */
export function findCoveringGrant(
  grants: readonly PermissionGrant[],
  req: PermissionRequest,
  now: number,
): PermissionGrant | null {
  for (const g of grants) {
    if (grantCovers(g, req, now)) return g;
  }
  return null;
}

/**
 * 综合判定：read 自动放行；否则查 grants；命中即放行，否则需审批。
 */
export function evaluatePermission(
  req: PermissionRequest,
  grants: readonly PermissionGrant[],
  now: number,
): PermissionDecision {
  if (!scopeNeedsApproval(req.scope)) {
    return { decision: "allow", reason: "auto-read" };
  }
  const hit = findCoveringGrant(grants, req, now);
  if (hit) {
    return { decision: "allow", viaGrant: hit, reason: "granted" };
  }
  return { decision: "needs-approval", reason: "no-grant" };
}

/**
 * 把一次审批选择转成要持久化/缓存的 grant（deny / once 返回 null —— 不留痕）。
 * - session：交给内存层持有，本模块不设过期（进程退出即失效）。
 * - forever：写 permission_grants 表，expiresAt = null。
 */
export function buildGrantFromDecision(
  req: PermissionRequest,
  grade: GrantGrade,
  now: number,
): PermissionGrant | null {
  if (grade === "deny" || grade === "once") return null;
  return {
    scope: req.scope,
    targetPattern: req.target ?? "**",
    agentName: req.agentName,
    serverId: req.serverId,
    grantedAt: now,
    expiresAt: null,
    revokedAt: null,
  };
}
