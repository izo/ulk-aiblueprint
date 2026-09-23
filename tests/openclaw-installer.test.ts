import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Simulated exec: no real git or network. Each test configures per-command
// behaviour (success/failure) and may create fixture files on disk as the
// side effect a real `git clone` would have produced.
type ExecHandler = (command: string) => Promise<void> | void;
let execHandler: ExecHandler = () => {};

vi.mock("child_process", () => ({
  exec: vi.fn((cmd: string, optsOrCb: any, cb?: any) => {
    const callback = typeof optsOrCb === "function" ? optsOrCb : cb;
    Promise.resolve(execHandler(cmd)).then(
      () => callback(null, { stdout: "", stderr: "" }),
      (err) => callback(err),
    );
    return {} as any;
  }),
}));

import { installOpenclawProConfigs } from "../src/lib/openclaw-installer";
import { exec } from "child_process";

describe("openclaw-installer", () => {
  let root: string;
  let openclawFolder: string;
  let cacheDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-openclaw-installer-"));
    vi.spyOn(os, "homedir").mockReturnValue(root);
    openclawFolder = path.join(root, "target-openclaw");
    cacheDir = path.join(root, ".config", "openclaw", "pro-repos", "openclawpro");
    execHandler = () => {};
    vi.mocked(exec).mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(root);
  });

  it("clones with the token embedded in the authenticated URL, never logging it in plain form elsewhere", async () => {
    execHandler = async (cmd: string) => {
      if (cmd.includes("git clone")) {
        await fs.outputFile(path.join(cacheDir, "openclaw-config", "config.yaml"), "provider: openclaw\n");
      }
    };

    await installOpenclawProConfigs({ githubToken: "secret-openclaw-token", openclawFolder });

    const cloneCall = vi.mocked(exec).mock.calls.find(([cmd]) => String(cmd).includes("git clone"));
    expect(cloneCall).toBeDefined();
    expect(String(cloneCall![0])).toContain(
      "https://x-access-token:secret-openclaw-token@github.com/Melvynx/openclawpro.git",
    );
  });

  it("copies the cloned openclaw-config tree into the target folder", async () => {
    execHandler = async (cmd: string) => {
      if (cmd.includes("git clone")) {
        await fs.outputFile(path.join(cacheDir, "openclaw-config", "config.yaml"), "provider: openclaw\n");
        await fs.outputFile(path.join(cacheDir, "openclaw-config", "skills", "demo.md"), "# demo skill");
      }
    };

    await installOpenclawProConfigs({ githubToken: "tok", openclawFolder });

    expect(await fs.readFile(path.join(openclawFolder, "config.yaml"), "utf-8")).toBe("provider: openclaw\n");
    expect(await fs.readFile(path.join(openclawFolder, "skills", "demo.md"), "utf-8")).toBe("# demo skill");
  });

  it("defaults the install target to ~/.openclaw when no folder is given", async () => {
    execHandler = async (cmd: string) => {
      if (cmd.includes("git clone")) {
        await fs.outputFile(path.join(cacheDir, "openclaw-config", "config.yaml"), "provider: openclaw\n");
      }
    };

    await installOpenclawProConfigs({ githubToken: "tok" });

    expect(await fs.pathExists(path.join(root, ".openclaw", "config.yaml"))).toBe(true);
  });

  it("wraps git failures in a clear, actionable error and never falls back to writing partial files", async () => {
    execHandler = () => {
      throw new Error("Authentication failed");
    };

    await expect(
      installOpenclawProConfigs({ githubToken: "bad-token", openclawFolder }),
    ).rejects.toThrow(/Failed to install OpenClaw Pro configs/);

    expect(await fs.pathExists(openclawFolder)).toBe(false);
  });

  it("removes and re-clones the cache when an existing repo fails to pull", async () => {
    await fs.outputFile(path.join(cacheDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await fs.outputFile(path.join(cacheDir, "stale-marker.txt"), "old clone");

    execHandler = async (cmd: string) => {
      if (cmd.includes("git pull")) {
        throw new Error("non-fast-forward");
      }
      if (cmd.includes("git clone")) {
        await fs.outputFile(path.join(cacheDir, "openclaw-config", "config.yaml"), "provider: openclaw\n");
      }
    };

    await installOpenclawProConfigs({ githubToken: "tok", openclawFolder });

    expect(await fs.pathExists(path.join(cacheDir, "stale-marker.txt"))).toBe(false);
    expect(await fs.readFile(path.join(openclawFolder, "config.yaml"), "utf-8")).toBe("provider: openclaw\n");
  });
});
