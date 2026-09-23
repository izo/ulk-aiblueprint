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

vi.mock("../src/lib/pro-installer.js", () => ({
  installProConfigs: vi.fn(),
  installAssistantProSkills: vi.fn(),
  configureAssistantProConsumers: vi.fn(),
}));

import { proActivateCommand, proStatusCommand, proUpdateCommand } from "../src/commands/pro";
import { installProConfigs } from "../src/lib/pro-installer.js";
import { getToken, saveToken } from "../src/lib/token-storage";

function okAccessResponse(githubToken?: string) {
  const metadata: Record<string, string> = {};
  if (githubToken !== undefined) metadata["cli-github-token"] = githubToken;
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        hasAccess: true,
        user: { name: "Ada", email: "ada@example.com" },
        product: { title: "AIBlueprint Premium", metadata },
      }),
  };
}

function noAccessResponse() {
  return { ok: true, json: () => Promise.resolve({ hasAccess: false }) };
}

describe("pro command", () => {
  let tmpHome: string;
  let fetchMock: any;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-pro-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    delete process.env.XDG_CONFIG_HOME;
    process.env.AIBLUEPRINT_TELEMETRY_DISABLED = "1";

    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.AIBLUEPRINT_TELEMETRY_DISABLED;
    await fs.remove(tmpHome);
  });

  describe("proActivateCommand", () => {
    it("saves the GitHub token once a product grants access, using the token passed on the CLI", async () => {
      // first product: no access, second product: access granted
      fetchMock
        .mockResolvedValueOnce(noAccessResponse())
        .mockResolvedValueOnce(okAccessResponse("github-token-from-metadata"));

      await proActivateCommand("my-premium-token");

      expect(await getToken()).toBe("github-token-from-metadata");
      expect(clack.log.success).toHaveBeenCalledWith("✅ Token activated!");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("sends the premium token as a URL-encoded query parameter to the have-access endpoint", async () => {
      fetchMock.mockResolvedValue(okAccessResponse("github-token-from-metadata"));

      await proActivateCommand("token with spaces");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("token=token%20with%20spaces"),
      );
    });

    it("exits with code 1 and never saves a token when no product grants access", async () => {
      fetchMock.mockResolvedValue(noAccessResponse());

      await proActivateCommand("bad-token");

      expect(await getToken()).toBeNull();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(clack.log.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid token or no access"),
      );
    });

    it("exits with code 1 when the product grants access but carries no GitHub token in its metadata", async () => {
      fetchMock.mockResolvedValue(okAccessResponse());

      await proActivateCommand("token-without-github-token");

      expect(await getToken()).toBeNull();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(clack.log.error).toHaveBeenCalledWith(
        expect.stringContaining("No GitHub token found in product metadata"),
      );
    });
  });

  describe("proStatusCommand", () => {
    it("warns and exits with code 0 when no token is saved", async () => {
      await proStatusCommand();

      expect(clack.log.warn).toHaveBeenCalledWith("No token found");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("reports the token file location when a token is saved, without exiting with an error", async () => {
      await saveToken("ghp_existing_token");

      await proStatusCommand();

      expect(clack.log.success).toHaveBeenCalledWith("✅ Token active");
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });
  });

  describe("proUpdateCommand", () => {
    it("refuses to update and exits with code 1 when no token is saved", async () => {
      await proUpdateCommand();

      expect(clack.log.error).toHaveBeenCalledWith("No token found");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("passes the saved GitHub token through to installProConfigs", async () => {
      await saveToken("ghp_update_token");

      await proUpdateCommand({ claudeCodeFolder: "/tmp/claude", codexFolder: "/tmp/codex" });

      expect(installProConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          githubToken: "ghp_update_token",
          claudeCodeFolder: "/tmp/claude",
          codexFolder: "/tmp/codex",
        }),
      );
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });

    it("exits with code 1 and reports the error when installProConfigs fails", async () => {
      await saveToken("ghp_update_token");
      vi.mocked(installProConfigs).mockRejectedValueOnce(new Error("network unreachable"));

      await proUpdateCommand();

      expect(clack.log.error).toHaveBeenCalledWith("network unreachable");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
