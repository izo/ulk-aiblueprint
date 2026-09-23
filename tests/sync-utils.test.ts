import crypto from "crypto";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncItem } from "../src/lib/sync-utils";

function githubContentsResponse(
  files: Array<{ name: string; type: "file" | "dir"; sha?: string }>,
) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve(
        files.map((f) => ({
          name: f.name,
          path: f.name,
          sha: f.sha ?? "abc123",
          type: f.type,
        })),
      ),
  };
}

function bufferOf(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer as ArrayBuffer;
}

describe("sync-utils", () => {
  let root: string;
  let claudeDir: string;
  let agentsDir: string;
  let fetchMock: any;

  beforeEach(async () => {
    vi.resetModules();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-sync-utils-"));
    claudeDir = path.join(root, ".claude");
    agentsDir = path.join(root, ".agents");
    await fs.ensureDir(claudeDir);
    await fs.ensureDir(agentsDir);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await fs.remove(root);
  });

  describe("analyzeSyncChanges", () => {
    it("classifies a remote-only file as new", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/contents/agents-config?")) return Promise.resolve({ ok: true, status: 200 });
        if (url.includes("claude-config/scripts")) {
          return Promise.resolve(
            githubContentsResponse([{ name: "deploy.sh", type: "file", sha: "sha-deploy" }]),
          );
        }
        return Promise.resolve(githubContentsResponse([]));
      });

      const { analyzeSyncChanges } = await import("../src/lib/sync-utils");
      const result = await analyzeSyncChanges(claudeDir, "gh-token-abc", agentsDir);

      const scriptItem = result.items.find((i) => i.relativePath === "scripts/deploy.sh");
      expect(scriptItem?.status).toBe("new");
      expect(result.newCount).toBeGreaterThanOrEqual(1);
    });

    it("classifies an unchanged local file whose git-blob sha matches the remote sha", async () => {
      const content = Buffer.from("echo hi");
      const header = `blob ${content.length}\0`;
      const sha = crypto
        .createHash("sha1")
        .update(Buffer.concat([Buffer.from(header), content]))
        .digest("hex");
      await fs.outputFile(path.join(claudeDir, "scripts", "deploy.sh"), content);

      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/contents/agents-config?")) return Promise.resolve({ ok: true, status: 200 });
        if (url.includes("claude-config/scripts")) {
          return Promise.resolve(githubContentsResponse([{ name: "deploy.sh", type: "file", sha }]));
        }
        return Promise.resolve(githubContentsResponse([]));
      });

      const { analyzeSyncChanges } = await import("../src/lib/sync-utils");
      const result = await analyzeSyncChanges(claudeDir, "gh-token", agentsDir);

      const scriptItem = result.items.find((i) => i.relativePath === "scripts/deploy.sh");
      expect(scriptItem?.status).toBe("unchanged");
    });

    it("classifies a locally-modified file whose content no longer matches the remote sha", async () => {
      await fs.outputFile(path.join(claudeDir, "scripts", "deploy.sh"), "echo modified locally");

      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/contents/agents-config?")) return Promise.resolve({ ok: true, status: 200 });
        if (url.includes("claude-config/scripts")) {
          return Promise.resolve(
            githubContentsResponse([{ name: "deploy.sh", type: "file", sha: "remote-sha-does-not-match" }]),
          );
        }
        return Promise.resolve(githubContentsResponse([]));
      });

      const { analyzeSyncChanges } = await import("../src/lib/sync-utils");
      const result = await analyzeSyncChanges(claudeDir, "gh-token", agentsDir);

      const scriptItem = result.items.find((i) => i.relativePath === "scripts/deploy.sh");
      expect(scriptItem?.status).toBe("modified");
    });

    it("sends the GitHub token only as an Authorization header, never in a URL", async () => {
      fetchMock.mockImplementation(() => Promise.resolve(githubContentsResponse([])));

      const { analyzeSyncChanges } = await import("../src/lib/sync-utils");
      await analyzeSyncChanges(claudeDir, "super-secret-token", agentsDir);

      expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
      for (const [url, options] of fetchMock.mock.calls) {
        expect(String(url)).not.toContain("super-secret-token");
        expect(options.headers.Authorization).toBe("token super-secret-token");
      }
    });
  });

  describe("syncSelectedItems", () => {
    it("downloads a new remote file and writes it locally", async () => {
      const remoteContent = "#!/bin/sh\necho deployed";
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/contents/agents-config?")) return Promise.resolve({ ok: true, status: 200 });
        if (url.startsWith("https://raw.githubusercontent.com")) {
          return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(bufferOf(remoteContent)) });
        }
        return Promise.resolve(githubContentsResponse([]));
      });

      const { syncSelectedItems } = await import("../src/lib/sync-utils");
      const item: SyncItem = {
        name: "deploy.sh",
        relativePath: "scripts/deploy.sh",
        status: "new",
        category: "scripts",
      };
      const result = await syncSelectedItems(claudeDir, [item], "secret-token-xyz", agentsDir);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      const written = await fs.readFile(path.join(claudeDir, "scripts", "deploy.sh"), "utf-8");
      expect(written).toBe(remoteContent);

      const rawCall = fetchMock.mock.calls.find(([url]: [string]) =>
        String(url).startsWith("https://raw.githubusercontent.com"),
      );
      expect(rawCall).toBeDefined();
      expect(String(rawCall![0])).not.toContain("secret-token-xyz");
      expect(rawCall![1].headers.Authorization).toBe("token secret-token-xyz");
    });

    it("applies the {CLAUDE_PATH} placeholder substitution to downloaded text files", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/contents/agents-config?")) return Promise.resolve({ ok: true, status: 200 });
        if (url.startsWith("https://raw.githubusercontent.com")) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(bufferOf("cd {CLAUDE_PATH}/hooks")),
          });
        }
        return Promise.resolve(githubContentsResponse([]));
      });

      const { syncSelectedItems } = await import("../src/lib/sync-utils");
      const item: SyncItem = {
        name: "hook.sh",
        relativePath: "scripts/hook.sh",
        status: "new",
        category: "scripts",
      };
      await syncSelectedItems(claudeDir, [item], "tok", agentsDir);

      const written = await fs.readFile(path.join(claudeDir, "scripts", "hook.sh"), "utf-8");
      expect(written).toBe(`cd ${claudeDir}/hooks`);
    });

    it("marks the item as failed, without throwing, when the download response is not ok", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/contents/agents-config?")) return Promise.resolve({ ok: true, status: 200 });
        if (url.startsWith("https://raw.githubusercontent.com")) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve(githubContentsResponse([]));
      });

      const { syncSelectedItems } = await import("../src/lib/sync-utils");
      const item: SyncItem = {
        name: "missing.sh",
        relativePath: "scripts/missing.sh",
        status: "new",
        category: "scripts",
      };
      const result = await syncSelectedItems(claudeDir, [item], "tok", agentsDir);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(await fs.pathExists(path.join(claudeDir, "scripts", "missing.sh"))).toBe(false);
    });

    it("marks the item as failed, without throwing, when fetch itself rejects", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/contents/agents-config?")) return Promise.resolve({ ok: true, status: 200 });
        if (url.startsWith("https://raw.githubusercontent.com")) {
          return Promise.reject(new Error("network down"));
        }
        return Promise.resolve(githubContentsResponse([]));
      });

      const { syncSelectedItems } = await import("../src/lib/sync-utils");
      const item: SyncItem = {
        name: "flaky.sh",
        relativePath: "scripts/flaky.sh",
        status: "new",
        category: "scripts",
      };

      await expect(syncSelectedItems(claudeDir, [item], "tok", agentsDir)).resolves.toEqual(
        expect.objectContaining({ success: 0, failed: 1 }),
      );
    });

    it("deletes a locally removed-upstream file without touching the network", async () => {
      const target = path.join(claudeDir, "scripts", "gone.sh");
      await fs.outputFile(target, "echo bye");

      const { syncSelectedItems } = await import("../src/lib/sync-utils");
      const item: SyncItem = {
        name: "gone.sh",
        relativePath: "scripts/gone.sh",
        status: "deleted",
        category: "scripts",
      };
      const result = await syncSelectedItems(claudeDir, [item], "tok", agentsDir);

      expect(result.deleted).toBe(1);
      expect(await fs.pathExists(target)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
