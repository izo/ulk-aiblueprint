import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  groupScriptsByPrefix,
  parseScriptCommands,
  readScriptsPackageJson,
  type ScriptCommand,
} from "../src/lib/script-parser";

describe("script-parser", () => {
  describe("readScriptsPackageJson", () => {
    let claudeDir: string;

    beforeEach(async () => {
      claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-script-parser-"));
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      delete process.env.DEBUG;
      await fs.remove(claudeDir);
    });

    it("returns null when scripts/package.json does not exist", async () => {
      expect(await readScriptsPackageJson(claudeDir)).toBeNull();
    });

    it("returns the scripts map from scripts/package.json", async () => {
      await fs.outputJson(path.join(claudeDir, "scripts", "package.json"), {
        scripts: { "db:migrate": "bun migrate.ts" },
      });

      expect(await readScriptsPackageJson(claudeDir)).toEqual({ "db:migrate": "bun migrate.ts" });
    });

    it("returns null when the file has no scripts field", async () => {
      await fs.outputJson(path.join(claudeDir, "scripts", "package.json"), { name: "scripts" });

      expect(await readScriptsPackageJson(claudeDir)).toBeNull();
    });

    it("returns null instead of throwing when package.json is invalid JSON", async () => {
      await fs.outputFile(path.join(claudeDir, "scripts", "package.json"), "{not valid json");

      expect(await readScriptsPackageJson(claudeDir)).toBeNull();
    });

    it("logs the parse failure only when DEBUG is set", async () => {
      await fs.outputFile(path.join(claudeDir, "scripts", "package.json"), "{not valid json");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      process.env.DEBUG = "1";
      await readScriptsPackageJson(claudeDir);
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockClear();
      delete process.env.DEBUG;
      await readScriptsPackageJson(claudeDir);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("parseScriptCommands", () => {
    it("keeps only prefix:action scripts, dropping bare script names", () => {
      const commands = parseScriptCommands({
        "db:migrate": "bun migrate.ts",
        build: "bun build.ts",
      });

      expect(commands).toEqual([
        { prefix: "db", action: "migrate", fullScriptName: "db:migrate" },
      ]);
    });

    it("excludes well-known non-actionable scripts (test, lint, format, start)", () => {
      const commands = parseScriptCommands({
        test: "vitest",
        lint: "biome check",
        format: "biome format",
        start: "node index.js",
        "db:migrate": "bun migrate.ts",
      });

      expect(commands.map((c) => c.fullScriptName)).toEqual(["db:migrate"]);
    });

    it("excludes scripts with a :test, :lint, :test-fixtures or :start suffix", () => {
      const commands = parseScriptCommands({
        "db:test": "vitest db",
        "db:lint": "biome check db",
        "db:test-fixtures": "bun fixtures.ts",
        "server:start": "node server.js",
        "db:migrate": "bun migrate.ts",
      });

      expect(commands.map((c) => c.fullScriptName)).toEqual(["db:migrate"]);
    });

    it("joins multi-colon script names into a single action", () => {
      const commands = parseScriptCommands({ "db:migrate:up": "bun migrate.ts up" });

      expect(commands).toEqual([
        { prefix: "db", action: "migrate:up", fullScriptName: "db:migrate:up" },
      ]);
    });

    it("drops a script name that ends with a trailing colon (empty action)", () => {
      const commands = parseScriptCommands({ "db:": "noop" });

      expect(commands).toEqual([]);
    });
  });

  describe("groupScriptsByPrefix", () => {
    it("groups actions under their shared prefix, preserving encounter order", () => {
      const commands: ScriptCommand[] = [
        { prefix: "db", action: "migrate", fullScriptName: "db:migrate" },
        { prefix: "db", action: "seed", fullScriptName: "db:seed" },
        { prefix: "cache", action: "clear", fullScriptName: "cache:clear" },
      ];

      expect(groupScriptsByPrefix(commands)).toEqual({
        db: ["migrate", "seed"],
        cache: ["clear"],
      });
    });

    it("returns an empty object for an empty command list", () => {
      expect(groupScriptsByPrefix([])).toEqual({});
    });
  });
});
