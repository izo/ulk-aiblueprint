import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOpenclawToken,
  getOpenclawTokenInfo,
  hasOpenclawToken,
  saveOpenclawToken,
} from "../src/lib/openclaw-token-storage";

describe("openclaw-token-storage", () => {
  let tmpHome: string;
  const originalAppData = process.env.APPDATA;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-openclaw-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    delete process.env.APPDATA;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    await fs.remove(tmpHome);
  });

  describe("getOpenclawTokenInfo", () => {
    it("points at ~/.config/openclaw/token.txt on macOS/Linux", () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      const info = getOpenclawTokenInfo();
      expect(info.path).toBe(path.join(tmpHome, ".config", "openclaw", "token.txt"));
      expect(info.platform).toBe("darwin");
    });

    it("points at %APPDATA%/openclaw/token.txt on Windows", () => {
      vi.spyOn(os, "platform").mockReturnValue("win32");
      const appData = "C:\\Users\\testuser\\AppData\\Roaming";
      process.env.APPDATA = appData;
      const info = getOpenclawTokenInfo();
      expect(info.path).toBe(path.join(appData, "openclaw", "token.txt"));
      expect(info.platform).toBe("win32");
    });

    it("falls back to homedir/openclaw on Windows without APPDATA", () => {
      vi.spyOn(os, "platform").mockReturnValue("win32");
      const info = getOpenclawTokenInfo();
      expect(info.path).toBe(path.join(tmpHome, "openclaw", "token.txt"));
    });
  });

  describe("saveOpenclawToken / getOpenclawToken", () => {
    beforeEach(() => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
    });

    it("returns null when no token has been saved", async () => {
      expect(await getOpenclawToken()).toBeNull();
    });

    it("writes the token to disk and reads it back trimmed", async () => {
      await saveOpenclawToken("  oc_secret_abc  \n");
      const { path: tokenPath } = getOpenclawTokenInfo();
      expect(await fs.pathExists(tokenPath)).toBe(true);
      expect(await getOpenclawToken()).toBe("oc_secret_abc");
    });

    it("creates the config directory if missing", async () => {
      await saveOpenclawToken("oc_secret_abc");
      const { path: tokenPath } = getOpenclawTokenInfo();
      expect(await fs.pathExists(path.dirname(tokenPath))).toBe(true);
    });

    it("writes the token file with owner-only permissions (0600)", async () => {
      await saveOpenclawToken("oc_secret_abc");
      const { path: tokenPath } = getOpenclawTokenInfo();
      const stat = await fs.stat(tokenPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("overwrites a previously saved token", async () => {
      await saveOpenclawToken("first-token");
      await saveOpenclawToken("second-token");
      expect(await getOpenclawToken()).toBe("second-token");
    });
  });

  describe("hasOpenclawToken", () => {
    beforeEach(() => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
    });

    it("is false when no token is saved", async () => {
      expect(await hasOpenclawToken()).toBe(false);
    });

    it("is true once a token is saved", async () => {
      await saveOpenclawToken("oc_secret_abc");
      expect(await hasOpenclawToken()).toBe(true);
    });
  });

  it("does not collide with the aiblueprint token config directory", async () => {
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    await saveOpenclawToken("openclaw-token");
    const { path: tokenPath } = getOpenclawTokenInfo();
    expect(tokenPath).toContain(path.join(".config", "openclaw"));
    expect(tokenPath).not.toContain(path.join(".config", "aiblueprint"));
  });
});
