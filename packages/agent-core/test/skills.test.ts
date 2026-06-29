import { describe, expect, it } from "vitest";
import {
  BUILTIN_SKILLS,
  getSkill,
  isSkillId,
  serversForEnabledSkills,
  promptAddonForEnabledSkills,
  defaultScopesForEnabledSkills,
} from "../src/skills";

describe("BUILTIN_SKILLS", () => {
  it("W4 落 3 个内置包", () => {
    expect(BUILTIN_SKILLS.map((s) => s.id)).toEqual([
      "dev",
      "file-butler",
      "bare",
    ]);
  });

  it("裸装无 server、无增补", () => {
    const bare = getSkill("bare");
    expect(bare?.servers).toEqual([]);
    expect(bare?.promptAddon).toBe("");
  });
});

describe("getSkill / isSkillId", () => {
  it("已知 id", () => {
    expect(getSkill("dev")?.name).toBe("开发者助手");
    expect(isSkillId("file-butler")).toBe(true);
  });

  it("未知 id", () => {
    expect(getSkill("research")).toBeUndefined();
    expect(isSkillId("research")).toBe(false);
  });
});

describe("serversForEnabledSkills", () => {
  it("并集去重、保持顺序", () => {
    expect(serversForEnabledSkills(["dev", "file-butler"])).toEqual([
      "git",
      "filesystem-projects",
      "filesystem-desktop",
    ]);
  });

  it("忽略未知 id 与裸装", () => {
    expect(serversForEnabledSkills(["bare", "nope", "file-butler"])).toEqual([
      "filesystem-desktop",
    ]);
  });

  it("空集合 → 空", () => {
    expect(serversForEnabledSkills([])).toEqual([]);
  });
});

describe("promptAddonForEnabledSkills", () => {
  it("按启用顺序换行连接，跳过空增补", () => {
    const out = promptAddonForEnabledSkills(["bare", "file-butler"]);
    expect(out).toContain("整理桌面文件");
    expect(out.startsWith("\n")).toBe(false);
  });

  it("全空 → 空串", () => {
    expect(promptAddonForEnabledSkills(["bare"])).toBe("");
  });
});

describe("defaultScopesForEnabledSkills", () => {
  it("并集去重", () => {
    expect(defaultScopesForEnabledSkills(["dev", "file-butler"])).toEqual([
      "read",
    ]);
  });

  it("裸装 → 空", () => {
    expect(defaultScopesForEnabledSkills(["bare"])).toEqual([]);
  });
});
