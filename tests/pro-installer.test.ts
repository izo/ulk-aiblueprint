import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => ({
  exec: vi.fn((_cmd: string, optsOrCb: any, cb?: any) => {
    const callback = typeof optsOrCb === "function" ? optsOrCb : cb;
    callback(new Error("git not available in sandbox"));
    return {} as any;
  }),
  execFile: vi.fn((_file: string, _args: any, optsOrCb: any, cb?: any) => {
    const callback = typeof optsOrCb === "function" ? optsOrCb : cb;
    callback(new Error("git not available in sandbox"));
    return {} as any;
  }),
}));

import { ensureHermesExternalSkillsDir, installProConfigs } from "../src/lib/pro-installer";

function contentsResponse(files: Array<{ name: string; type: "file" | "dir" }>) {
  return { ok: true, status: 200, json: () => Promise.resolve(files) };
}

function bufferOf(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer as ArrayBuffer;
}

describe("pro-installer", () => {
  describe("ensureHermesExternalSkillsDir", () => {
    let hermesDir: string;
    let root: string;

    beforeEach(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-hermes-"));
      hermesDir = path.join(root, ".hermes");
      vi.spyOn(os, "homedir").mockReturnValue(root);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await fs.remove(root);
    });

    it("creates config.yaml with the skills entry when none exists", async () => {
      const agentsSkillsDir = path.join(root, ".agents", "skills");

      const changed = await ensureHermesExternalSkillsDir(hermesDir, agentsSkillsDir);

      expect(changed).toBe(true);
      const content = await fs.readFile(path.join(hermesDir, "config.yaml"), "utf-8");
      expect(content).toContain("external_dirs:");
      expect(content).toContain(JSON.stringify("~/.agents/skills"));
    });

    it("uses the absolute path when the skills dir is not the default ~/.agents/skills", async () => {
      const customSkillsDir = path.join(root, "custom", "skills");

      await ensureHermesExternalSkillsDir(hermesDir, customSkillsDir);

      const content = await fs.readFile(path.join(hermesDir, "config.yaml"), "utf-8");
      expect(content).toContain(JSON.stringify(path.resolve(customSkillsDir)));
    });

    it("appends external_dirs under an existing skills: block without disturbing other keys", async () => {
      await fs.ensureDir(hermesDir);
      await fs.writeFile(
        path.join(hermesDir, "config.yaml"),
        "model: gpt\nskills:\n  timeout: 30\nlogging:\n  level: info\n",
        "utf-8",
      );

      const changed = await ensureHermesExternalSkillsDir(hermesDir, path.join(root, ".agents", "skills"));

      expect(changed).toBe(true);
      const content = await fs.readFile(path.join(hermesDir, "config.yaml"), "utf-8");
      expect(content).toContain("model: gpt");
      expect(content).toContain("logging:");
      expect(content).toContain("external_dirs:");
    });

    it("is idempotent: does not add a duplicate entry on a second run", async () => {
      const agentsSkillsDir = path.join(root, ".agents", "skills");
      await ensureHermesExternalSkillsDir(hermesDir, agentsSkillsDir);

      const changed = await ensureHermesExternalSkillsDir(hermesDir, agentsSkillsDir);

      expect(changed).toBe(false);
      const content = await fs.readFile(path.join(hermesDir, "config.yaml"), "utf-8");
      const occurrences = content.split("~/.agents/skills").length - 1;
      expect(occurrences).toBe(1);
    });

    it("throws a clear error instead of corrupting an inline skills: value", async () => {
      await fs.ensureDir(hermesDir);
      await fs.writeFile(path.join(hermesDir, "config.yaml"), "skills: some-string-value\n", "utf-8");

      await expect(
        ensureHermesExternalSkillsDir(hermesDir, path.join(root, ".agents", "skills")),
      ).rejects.toThrow(/inline value/);
    });
  });

  describe("installProConfigs", () => {
    let root: string;
    let claudeDir: string;
    let codexDir: string;
    let agentsDir: string;
    let fetchMock: any;
    let execMock: any;

    beforeEach(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-pro-installer-"));
      vi.spyOn(os, "homedir").mockReturnValue(root);
      claudeDir = path.join(root, ".claude");
      codexDir = path.join(root, ".codex");
      agentsDir = path.join(root, ".agents");

      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { exec } = await import("child_process");
      execMock = exec;

      fetchMock = vi.fn((url: string) => {
        if (url === "https://api.github.com/repos/Melvynx/aiblueprint-cli-premium/contents/agents-config?ref=main") {
          return Promise.resolve(
            contentsResponse([
              { name: "settings.json", type: "file" },
              { name: "claude-config", type: "dir" },
            ]),
          );
        }
        if (url === "https://api.github.com/repos/Melvynx/aiblueprint-cli-premium/contents/agents-config/claude-config?ref=main") {
          return Promise.resolve(contentsResponse([{ name: "hooks", type: "dir" }]));
        }
        if (url === "https://api.github.com/repos/Melvynx/aiblueprint-cli-premium/contents/agents-config/claude-config/hooks?ref=main") {
          return Promise.resolve(contentsResponse([{ name: "greet.sh", type: "file" }]));
        }
        if (url === "https://raw.githubusercontent.com/Melvynx/aiblueprint-cli-premium/main/agents-config/settings.json") {
          return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(bufferOf('{"path": "{CLAUDE_PATH}/config"}')) });
        }
        if (url === "https://raw.githubusercontent.com/Melvynx/aiblueprint-cli-premium/main/agents-config/claude-config/hooks/greet.sh") {
          return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(bufferOf("#!/bin/sh\necho hi")) });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(async () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      await fs.remove(root);
    });

    it("falls back to the GitHub API when git is unavailable, authenticating every call via header only", async () => {
      await installProConfigs({
        githubToken: "secret-gh-token",
        claudeCodeFolder: claudeDir,
        codexFolder: codexDir,
        agentsFolder: agentsDir,
      });

      expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
      for (const [url, options] of fetchMock.mock.calls) {
        expect(String(url)).not.toContain("secret-gh-token");
        expect(options.headers.Authorization).toBe("token secret-gh-token");
      }
    });

    it("routes a legacy flat file and a claude-config/-nested file to claudeDir, substituting {CLAUDE_PATH}", async () => {
      await installProConfigs({
        githubToken: "tok",
        claudeCodeFolder: claudeDir,
        codexFolder: codexDir,
        agentsFolder: agentsDir,
      });

      const settings = await fs.readFile(path.join(claudeDir, "settings.json"), "utf-8");
      expect(settings).toBe(`{"path": "${claudeDir}/config"}`);

      const hook = await fs.readFile(path.join(claudeDir, "hooks", "greet.sh"), "utf-8");
      expect(hook).toBe("#!/bin/sh\necho hi");
    });

    it("attempts an authenticated git clone first, embedding the token in the clone URL", async () => {
      await installProConfigs({
        githubToken: "secret-gh-token",
        claudeCodeFolder: claudeDir,
        codexFolder: codexDir,
        agentsFolder: agentsDir,
      });

      expect(execMock).toHaveBeenCalled();
      const cloneCall = execMock.mock.calls.find(([cmd]: [string]) => cmd.includes("git clone"));
      expect(cloneCall).toBeDefined();
      expect(cloneCall![0]).toContain("https://x-access-token:secret-gh-token@github.com/Melvynx/aiblueprint-cli-premium.git");
    });

    it("removes the temporary download directory after a successful install", async () => {
      const before = await fs.readdir(os.tmpdir());
      const premiumDirsBefore = before.filter((n) => n.startsWith("aiblueprint-premium-"));

      await installProConfigs({
        githubToken: "tok",
        claudeCodeFolder: claudeDir,
        codexFolder: codexDir,
        agentsFolder: agentsDir,
      });

      const after = await fs.readdir(os.tmpdir());
      const premiumDirsAfter = after.filter((n) => n.startsWith("aiblueprint-premium-"));
      expect(premiumDirsAfter.length).toBe(premiumDirsBefore.length);
    });

    it("does not abort the whole install when a single file download fails", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url === "https://api.github.com/repos/Melvynx/aiblueprint-cli-premium/contents/agents-config?ref=main") {
          return Promise.resolve(contentsResponse([{ name: "settings.json", type: "file" }]));
        }
        if (url === "https://raw.githubusercontent.com/Melvynx/aiblueprint-cli-premium/main/agents-config/settings.json") {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      await expect(
        installProConfigs({
          githubToken: "tok",
          claudeCodeFolder: claudeDir,
          codexFolder: codexDir,
          agentsFolder: agentsDir,
        }),
      ).resolves.toBeUndefined();

      expect(await fs.pathExists(path.join(claudeDir, "settings.json"))).toBe(false);
    });
  });
});
