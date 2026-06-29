import { describe, expect, it } from "vitest";
import { namespaceToolName, parseNamespacedToolName } from "../src/fc-naming";

describe("fc-naming", () => {
  it("命名空间化", () => {
    expect(namespaceToolName("filesystem", "list_directory")).toBe(
      "filesystem__list_directory",
    );
  });

  it("往返一致", () => {
    const ns = namespaceToolName("git", "commit");
    expect(parseNamespacedToolName(ns)).toEqual({
      serverId: "git",
      toolName: "commit",
    });
  });

  it("无分隔符时 serverId 空、整串当 toolName", () => {
    expect(parseNamespacedToolName("weird")).toEqual({
      serverId: "",
      toolName: "weird",
    });
  });

  it("toolName 含双下划线只按首个分隔符拆", () => {
    expect(parseNamespacedToolName("fs__read__raw")).toEqual({
      serverId: "fs",
      toolName: "read__raw",
    });
  });
});
