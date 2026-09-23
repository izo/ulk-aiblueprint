import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteToken,
  getAssistantProToken,
  getAssistantProTokenFilePath,
  getAssistantProTokenInfo,
  getConfigDir,
  getToken,
  getTokenFilePath,
  getTokenInfo,
  hasToken,
  saveAssistantProToken,
  saveToken,
} from "../src/lib/token-storage";

describe("token-storage", () => {
  let tmpHome: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalAppData = process.env.APPDATA;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-token-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.APPDATA;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    await fs.remove(tmpHome);
  });

  describe("getConfigDir", () => {
    it("uses ~/.config/aiblueprint on macOS/Linux", () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      expect(getConfigDir()).toBe(path.join(tmpHome, ".config", "aiblueprint"));
    });

    it("honours XDG_CONFIG_HOME when set", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux");
      const xdg = path.join(tmpHome, "custom-xdg");
      process.env.XDG_CONFIG_HOME = xdg;
      expect(getConfigDir()).toBe(path.join(xdg, "aiblueprint"));
    });

    it("uses %APPDATA%/aiblueprint on Windows", () => {
      vi.spyOn(os, "platform").mockReturnValue("win32");
      const appData = "C:\\Users\\testuser\\AppData\\Roaming";
      process.env.APPDATA = appData;
      expect(getConfigDir()).toBe(path.join(appData, "aiblueprint"));
    });

    it("falls back to homedir/AppData/Roaming on Windows without APPDATA", () => {
      vi.spyOn(os, "platform").mockReturnValue("win32");
      expect(getConfigDir()).toBe(path.join(tmpHome, "AppData", "Roaming", "aiblueprint"));
    });
  });

  describe("token file paths", () => {
    it("points at token.txt for the GitHub token", () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      expect(getTokenFilePath()).toBe(path.join(tmpHome, ".config", "aiblueprint", "token.txt"));
    });

    it("points at assistant-pro-token.txt for the PRO token", () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      expect(getAssistantProTokenFilePath()).toBe(
        path.join(tmpHome, ".config", "aiblueprint", "assistant-pro-token.txt"),
      );
    });
  });

  describe("saveToken / getToken", () => {
    beforeEach(() => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
    });

    it("returns null when no token has been saved", async () => {
      expect(await getToken()).toBeNull();
    });

    it("writes the token to disk and reads it back trimmed", async () => {
      await saveToken("  ghp_secret123  \n");
      const filePath = getTokenFilePath();
      expect(await fs.pathExists(filePath)).toBe(true);
      expect(await getToken()).toBe("ghp_secret123");
    });

    it("creates the config directory if missing", async () => {
      await saveToken("ghp_secret123");
      expect(await fs.pathExists(path.dirname(getTokenFilePath()))).toBe(true);
    });

    it("writes the token file with owner-only permissions (0600)", async () => {
      await saveToken("ghp_secret123");
      const stat = await fs.stat(getTokenFilePath());
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("surfaces a clear error when the config directory cannot be created", async () => {
      const eacces = Object.assign(new Error("denied"), { code: "EACCES" });
      vi.spyOn(fs, "ensureDir").mockRejectedValueOnce(eacces);

      await expect(saveToken("ghp_secret123")).rejects.toThrow(/Permission denied/);
    });

    it("re-throws non-permission errors from ensureDir unchanged", async () => {
      const other = Object.assign(new Error("disk full"), { code: "ENOSPC" });
      vi.spyOn(fs, "ensureDir").mockRejectedValueOnce(other);

      await expect(saveToken("ghp_secret123")).rejects.toThrow("disk full");
    });

    it("returns null when the token file cannot be read", async () => {
      await saveToken("ghp_secret123");
      vi.spyOn(fs, "readFile").mockRejectedValueOnce(new Error("boom"));
      expect(await getToken()).toBeNull();
    });
  });

  describe("saveAssistantProToken / getAssistantProToken", () => {
    beforeEach(() => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
    });

    it("returns null when no PRO token has been saved", async () => {
      expect(await getAssistantProToken()).toBeNull();
    });

    it("writes and reads back the PRO token, trimmed", async () => {
      await saveAssistantProToken("  pro_token_xyz  \n");
      expect(await getAssistantProToken()).toBe("pro_token_xyz");
    });

    it("writes the PRO token file with owner-only permissions (0600)", async () => {
      await saveAssistantProToken("pro_token_xyz");
      const stat = await fs.stat(getAssistantProTokenFilePath());
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("does not collide with the GitHub token file", async () => {
      await saveToken("github-token");
      await saveAssistantProToken("pro-token");
      expect(await getToken()).toBe("github-token");
      expect(await getAssistantProToken()).toBe("pro-token");
    });

    it("returns null when the PRO token file cannot be read", async () => {
      await saveAssistantProToken("pro_token_xyz");
      vi.spyOn(fs, "readFile").mockRejectedValueOnce(new Error("boom"));
      expect(await getAssistantProToken()).toBeNull();
    });
  });

  describe("hasToken", () => {
    beforeEach(() => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
    });

    it("is false when no token is saved", async () => {
      expect(await hasToken()).toBe(false);
    });

    it("is true once a token is saved", async () => {
      await saveToken("ghp_secret123");
      expect(await hasToken()).toBe(true);
    });

    it("is false when the saved token is empty", async () => {
      await saveToken("");
      expect(await hasToken()).toBe(false);
    });
  });

  describe("deleteToken", () => {
    beforeEach(() => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
    });

    it("removes an existing token file", async () => {
      await saveToken("ghp_secret123");
      expect(await fs.pathExists(getTokenFilePath())).toBe(true);

      await deleteToken();

      expect(await fs.pathExists(getTokenFilePath())).toBe(false);
      expect(await getToken()).toBeNull();
    });

    it("is a no-op when no token file exists", async () => {
      await expect(deleteToken()).resolves.toBeUndefined();
    });
  });

  describe("getTokenInfo / getAssistantProTokenInfo", () => {
    it("reports the token path and current platform", () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      const info = getTokenInfo();
      expect(info.path).toBe(getTokenFilePath());
      expect(info.platform).toBe("darwin");
    });

    it("reports the PRO token path and current platform", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux");
      const info = getAssistantProTokenInfo();
      expect(info.path).toBe(getAssistantProTokenFilePath());
      expect(info.platform).toBe("linux");
    });
  });
});
