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
  it("当前落 3 个内置包（文件管家 + 系统助手 + 裸装）", () => {
    expect(BUILTIN_SKILLS.map((s) => s.id)).toEqual([
      "file-butler",
      "system-helper",
      "bare",
    ]);
  });

  it("系统助手默认启用、挂 system", () => {
    const sh = getSkill("system-helper");
    expect(sh?.servers).toEqual(["system"]);
    expect(sh?.defaultEnabled).toBe(true);
  });

  it("文件管家默认启用、挂 filesystem", () => {
    const fb = getSkill("file-butler");
    expect(fb?.servers).toEqual(["filesystem"]);
    expect(fb?.defaultEnabled).toBe(true);
  });

  it("裸装无 server、无增补、默认不启用", () => {
    const bare = getSkill("bare");
    expect(bare?.servers).toEqual([]);
    expect(bare?.promptAddon).toBe("");
    expect(bare?.defaultEnabled).toBeFalsy();
  });
});

describe("getSkill / isSkillId", () => {
  it("已知 id", () => {
    expect(getSkill("file-butler")?.name).toBe("文件管家");
    expect(isSkillId("file-butler")).toBe(true);
  });

  it("未知 id", () => {
    expect(getSkill("dev")).toBeUndefined();
    expect(isSkillId("research")).toBe(false);
  });
});

describe("serversForEnabledSkills", () => {
  it("并集去重、保持顺序", () => {
    expect(serversForEnabledSkills(["file-butler"])).toEqual(["filesystem"]);
  });

  it("忽略未知 id 与裸装", () => {
    expect(serversForEnabledSkills(["bare", "nope", "file-butler"])).toEqual([
      "filesystem",
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
    expect(defaultScopesForEnabledSkills(["file-butler"])).toEqual(["read"]);
  });

  it("裸装 → 空", () => {
    expect(defaultScopesForEnabledSkills(["bare"])).toEqual([]);
  });
});
