import { EventEmitter } from "events";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let execSyncBehavior: () => void = () => {};
let spawnedChild: EventEmitter & { kill?: () => void };
let spawnCalls: Array<{ command: string; args: string[]; options: any }> = [];

vi.mock("child_process", () => ({
  execSync: vi.fn(() => execSyncBehavior()),
  spawn: vi.fn((command: string, args: string[], options: any) => {
    spawnCalls.push({ command, args, options });
    spawnedChild = new EventEmitter();
    return spawnedChild;
  }),
}));

import { executeScript } from "../src/commands/script-runner";
import { execSync, spawn } from "child_process";

async function waitForSpawn(): Promise<void> {
  await vi.waitFor(() => {
    if (!spawnedChild) throw new Error("spawn has not been called yet");
  });
}

describe("script-runner", () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-script-runner-"));
    execSyncBehavior = () => {}; // `bun` found by default
    spawnCalls = [];
    spawnedChild = undefined as unknown as EventEmitter;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(claudeDir);
  });

  it("returns 1 without spawning anything when bun is not installed", async () => {
    execSyncBehavior = () => {
      throw new Error("command not found: bun");
    };

    const code = await executeScript("start", claudeDir);

    expect(code).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns 1 when the scripts directory does not exist", async () => {
    const code = await executeScript("start", claudeDir);

    expect(code).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns 1 when scripts/package.json is missing", async () => {
    await fs.ensureDir(path.join(claudeDir, "scripts"));

    const code = await executeScript("start", claudeDir);

    expect(code).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns 1 when the requested script is not declared in package.json", async () => {
    await fs.outputJson(path.join(claudeDir, "scripts", "package.json"), {
      scripts: { build: "bun build.ts" },
    });

    const code = await executeScript("start", claudeDir);

    expect(code).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns `bun run <scriptName>` as argv (never via a shell string) in the scripts directory", async () => {
    const scriptsDir = path.join(claudeDir, "scripts");
    await fs.outputJson(path.join(scriptsDir, "package.json"), {
      scripts: { start: "bun index.ts" },
    });

    const resultPromise = executeScript("start", claudeDir);
    await waitForSpawn();
    spawnedChild.emit("close", 0);
    const code = await resultPromise;

    expect(code).toBe(0);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe("bun");
    expect(spawnCalls[0].args).toEqual(["run", "start"]);
    expect(spawnCalls[0].options.cwd).toBe(scriptsDir);
    expect(spawnCalls[0].options.shell).not.toBe(true);
  });

  it("resolves with the child's non-zero exit code", async () => {
    await fs.outputJson(path.join(claudeDir, "scripts", "package.json"), {
      scripts: { start: "bun index.ts" },
    });

    const resultPromise = executeScript("start", claudeDir);
    await waitForSpawn();
    spawnedChild.emit("close", 7);

    expect(await resultPromise).toBe(7);
  });

  it("resolves with 1 instead of throwing/hanging when spawn itself errors", async () => {
    await fs.outputJson(path.join(claudeDir, "scripts", "package.json"), {
      scripts: { start: "bun index.ts" },
    });

    const resultPromise = executeScript("start", claudeDir);
    await waitForSpawn();
    spawnedChild.emit("error", new Error("ENOENT"));

    expect(await resultPromise).toBe(1);
  });
});
