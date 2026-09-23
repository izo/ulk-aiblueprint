import fs from "fs-extra";
import os from "os";
import path from "path";
import * as clack from "@clack/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../src/lib/openclaw-installer.js", () => ({
  installOpenclawProConfigs: vi.fn(),
}));

import {
  openclawProActivateCommand,
  openclawProStatusCommand,
  openclawProUpdateCommand,
} from "../src/commands/openclaw-pro";
import { installOpenclawProConfigs } from "../src/lib/openclaw-installer.js";
import { getOpenclawToken, saveOpenclawToken } from "../src/lib/openclaw-token-storage";

function accessResponse(body: Record<string, unknown>) {
  return { ok: true, json: () => Promise.resolve(body) };
}

describe("openclaw-pro command", () => {
  let tmpHome: string;
  let fetchMock: any;
  let exitSpy: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-openclaw-pro-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    vi.spyOn(os, "platform").mockReturnValue("darwin");

    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await fs.remove(tmpHome);
  });

  describe("openclawProActivateCommand", () => {
    it("saves the GitHub token once access is granted, using the token passed on the CLI", async () => {
      fetchMock.mockResolvedValue(
        accessResponse({
          hasAccess: true,
          user: { name: "Ada", email: "ada@example.com" },
          product: { title: "OpenClaw Pro", metadata: { "cli-github-token": "gh-token-from-metadata" } },
        }),
      );

      await openclawProActivateCommand("my-openclaw-token");

      expect(await getOpenclawToken()).toBe("gh-token-from-metadata");
      expect(clack.log.success).toHaveBeenCalledWith("✅ Token activated!");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("sends the token as a query parameter to the have-access endpoint", async () => {
      fetchMock.mockResolvedValue(
        accessResponse({
          hasAccess: true,
          user: { name: "Ada", email: "ada@example.com" },
          product: { title: "OpenClaw Pro", metadata: { "cli-github-token": "gh-token" } },
        }),
      );

      await openclawProActivateCommand("my-openclaw-token");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/have-access?token=my-openclaw-token"),
      );
    });

    it("exits with code 1 and saves nothing when the have-access endpoint responds not-ok", async () => {
      fetchMock.mockResolvedValue({ ok: false });

      await openclawProActivateCommand("bad-token");

      expect(await getOpenclawToken()).toBeNull();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(clack.log.error).toHaveBeenCalledWith("Invalid token or no access");
    });

    it("exits with code 1 and saves nothing when the product grants no access", async () => {
      fetchMock.mockResolvedValue(accessResponse({ hasAccess: false }));

      await openclawProActivateCommand("no-access-token");

      expect(await getOpenclawToken()).toBeNull();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(clack.log.error).toHaveBeenCalledWith("No access to OpenClaw Pro");
    });

    it("exits with code 1 when access is granted but no GitHub token is in the product metadata", async () => {
      fetchMock.mockResolvedValue(
        accessResponse({
          hasAccess: true,
          user: { name: "Ada", email: "ada@example.com" },
          product: { title: "OpenClaw Pro", metadata: {} },
        }),
      );

      await openclawProActivateCommand("token-without-github-token");

      expect(await getOpenclawToken()).toBeNull();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(clack.log.error).toHaveBeenCalledWith(
        "No GitHub token found in product metadata. Contact support.",
      );
    });
  });

  describe("openclawProStatusCommand", () => {
    it("warns and exits with code 0 when no token is saved", async () => {
      await openclawProStatusCommand();

      expect(clack.log.warn).toHaveBeenCalledWith("No token found");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("reports the token file location when a token is saved", async () => {
      await saveOpenclawToken("existing-openclaw-token");

      await openclawProStatusCommand();

      expect(clack.log.success).toHaveBeenCalledWith("✅ Token active");
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });
  });

  describe("openclawProUpdateCommand", () => {
    it("reports the missing-token error and exits with code 1 before continuing", async () => {
      await openclawProUpdateCommand();

      expect(clack.log.error).toHaveBeenCalledWith("No token found");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("passes the saved GitHub token through to installOpenclawProConfigs", async () => {
      await saveOpenclawToken("gh-update-token");
      vi.mocked(installOpenclawProConfigs).mockResolvedValue();

      await openclawProUpdateCommand({ folder: "/tmp/openclaw-target" });

      expect(installOpenclawProConfigs).toHaveBeenCalledWith(
        expect.objectContaining({ githubToken: "gh-update-token", openclawFolder: "/tmp/openclaw-target" }),
      );
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });

    it("exits with code 1 and reports the error when installOpenclawProConfigs fails", async () => {
      await saveOpenclawToken("gh-update-token");
      vi.mocked(installOpenclawProConfigs).mockRejectedValue(new Error("git auth failed"));

      await openclawProUpdateCommand();

      expect(clack.log.error).toHaveBeenCalledWith("git auth failed");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
