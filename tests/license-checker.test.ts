import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasProLicense, requireProLicense } from "../src/lib/license-checker";
import { saveToken } from "../src/lib/token-storage";

describe("license-checker", () => {
  let tmpHome: string;
  const mockExit = vi.fn();

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-license-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    vi.spyOn(process, "exit").mockImplementation(mockExit as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    mockExit.mockClear();
    await fs.remove(tmpHome);
  });

  describe("hasProLicense", () => {
    it("is false when no token is saved", async () => {
      expect(await hasProLicense()).toBe(false);
    });

    it("is true once a token is saved", async () => {
      await saveToken("ghp_pro_token");
      expect(await hasProLicense()).toBe(true);
    });
  });

  describe("requireProLicense", () => {
    it("returns the token without exiting when a token is saved", async () => {
      await saveToken("ghp_pro_token");

      const token = await requireProLicense();

      expect(token).toBe("ghp_pro_token");
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("exits with code 1 and prints guidance when no token is saved", async () => {
      await requireProLicense();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Premium"),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("agents pro activate"),
      );
    });

    it("never reaches the network to validate the token", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await saveToken("ghp_pro_token");
      await requireProLicense();

      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});
