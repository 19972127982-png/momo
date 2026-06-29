/**
 * Skills 框架纯逻辑（W4 D1，对齐 PRD §4.6.3）
 *
 * Skill = 一组 MCP server + prompt 偏好 + 默认免审批 scope 的「一键启用」封装。
 * 本模块只定义内置包 + 解析（启用集合 → server 并集 / prompt 增补），
 * 不碰 SQLite（skills / mcp_servers 表）与实际 spawn —— 那些在 apps/desktop/main。
 *
 * W4 落 3 个内置包；研究助手（WebAgent / brave-search）随 WebAgent 一起推迟。
 */
import type { ToolScope } from "./types";

export type SkillId = "dev" | "file-butler" | "bare";

export interface SkillDef {
  id: SkillId;
  name: string;
  /** 引用 serverRegistry 的 server id（apps/desktop/main 侧定义实际配置） */
  servers: readonly string[];
  /** 注入 system prompt 的偏好描述（裸装为空串） */
  promptAddon: string;
  /** 该 Skill 期望默认免审批的 scope（仍受权限闸兜底；read 本就免审批） */
  defaultScopes: readonly ToolScope[];
}

export const BUILTIN_SKILLS: readonly SkillDef[] = [
  {
    id: "dev",
    name: "开发者助手",
    servers: ["git", "filesystem-projects"],
    promptAddon:
      "你可以帮 ta 看 git 状态、读项目文件。涉及改动（commit / 写文件）务必先说清要做什么、再等 ta 点头。",
    defaultScopes: ["read"],
  },
  {
    id: "file-butler",
    name: "文件管家",
    servers: ["filesystem-desktop"],
    promptAddon:
      "你可以帮 ta 整理桌面文件（列出、归类、重命名、移动）。任何写操作都要先征得同意。",
    defaultScopes: ["read"],
  },
  {
    id: "bare",
    name: "裸装",
    servers: [],
    promptAddon: "",
    defaultScopes: [],
  },
];

const BY_ID = new Map<SkillId, SkillDef>(BUILTIN_SKILLS.map((s) => [s.id, s]));

export function getSkill(id: string): SkillDef | undefined {
  return BY_ID.get(id as SkillId);
}

export function isSkillId(id: string): id is SkillId {
  return BY_ID.has(id as SkillId);
}

/** 已启用 Skill 集合 → 需要 spawn 的 server id 并集（去重，保持稳定顺序）。 */
export function serversForEnabledSkills(
  enabledIds: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of enabledIds) {
    const skill = getSkill(id);
    if (!skill) continue;
    for (const srv of skill.servers) {
      if (!seen.has(srv)) {
        seen.add(srv);
        out.push(srv);
      }
    }
  }
  return out;
}

/** 已启用 Skill 集合 → 拼接的 prompt 增补（空增补跳过，按启用顺序换行连接）。 */
export function promptAddonForEnabledSkills(
  enabledIds: readonly string[],
): string {
  const parts: string[] = [];
  for (const id of enabledIds) {
    const skill = getSkill(id);
    if (skill && skill.promptAddon.trim()) parts.push(skill.promptAddon.trim());
  }
  return parts.join("\n");
}

/** 已启用 Skill 集合 → 默认免审批 scope 并集（去重）。 */
export function defaultScopesForEnabledSkills(
  enabledIds: readonly string[],
): ToolScope[] {
  const seen = new Set<ToolScope>();
  for (const id of enabledIds) {
    const skill = getSkill(id);
    if (!skill) continue;
    for (const sc of skill.defaultScopes) seen.add(sc);
  }
  return [...seen];
}
