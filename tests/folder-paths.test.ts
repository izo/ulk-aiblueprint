import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFolders } from "../src/lib/folder-paths";

describe("resolveFolders", () => {
  beforeEach(() => {
    vi.spyOn(os, "homedir").mockReturnValue("/Users/testuser");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to the home directory and its .claude/.codex/.agents children", () => {
    const result = resolveFolders();

    expect(result.rootDir).toBe("/Users/testuser");
    expect(result.claudeDir).toBe(path.join("/Users/testuser", ".claude"));
    expect(result.codexDir).toBe(path.join("/Users/testuser", ".codex"));
    expect(result.agentsDir).toBe(path.join("/Users/testuser", ".agents"));
  });

  it("resolves a custom root folder and derives the three children from it", () => {
    const result = resolveFolders({ folder: "/tmp/custom-root" });

    expect(result.rootDir).toBe("/tmp/custom-root");
    expect(result.claudeDir).toBe(path.join("/tmp/custom-root", ".claude"));
    expect(result.codexDir).toBe(path.join("/tmp/custom-root", ".codex"));
    expect(result.agentsDir).toBe(path.join("/tmp/custom-root", ".agents"));
  });

  it("resolves a relative root folder against the current working directory", () => {
    const result = resolveFolders({ folder: "relative-root" });

    expect(result.rootDir).toBe(path.resolve("relative-root"));
  });

  it("lets explicit claude/codex/agents folders override the derived defaults", () => {
    const result = resolveFolders({
      claudeCodeFolder: "/tmp/explicit-claude",
      codexFolder: "/tmp/explicit-codex",
      agentsFolder: "/tmp/explicit-agents",
    });

    expect(result.rootDir).toBe("/Users/testuser");
    expect(result.claudeDir).toBe("/tmp/explicit-claude");
    expect(result.codexDir).toBe("/tmp/explicit-codex");
    expect(result.agentsDir).toBe("/tmp/explicit-agents");
  });

  it("resolves explicit folders as paths, even when a custom root is also given", () => {
    const result = resolveFolders({
      folder: "/tmp/custom-root",
      claudeCodeFolder: "/tmp/explicit-claude",
    });

    expect(result.rootDir).toBe("/tmp/custom-root");
    expect(result.claudeDir).toBe("/tmp/explicit-claude");
    expect(result.codexDir).toBe(path.join("/tmp/custom-root", ".codex"));
    expect(result.agentsDir).toBe(path.join("/tmp/custom-root", ".agents"));
  });

  it("resolves a relative explicit folder against the current working directory", () => {
    const result = resolveFolders({ agentsFolder: "relative-agents" });

    expect(result.agentsDir).toBe(path.resolve("relative-agents"));
  });
});
