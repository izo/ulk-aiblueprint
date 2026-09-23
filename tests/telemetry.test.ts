import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushTelemetry,
  trackError,
  trackEvent,
} from "../src/lib/telemetry";

const TELEMETRY_URL = "https://codelynx.dev/api/cli/events";

describe("telemetry", () => {
  let tmpHome: string;
  let fetchMock: any;
  const originalDisabled = process.env.AIBLUEPRINT_TELEMETRY_DISABLED;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "aiblueprint-telemetry-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.AIBLUEPRINT_TELEMETRY_DISABLED;

    fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    ) as any;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await flushTelemetry();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalDisabled === undefined) delete process.env.AIBLUEPRINT_TELEMETRY_DISABLED;
    else process.env.AIBLUEPRINT_TELEMETRY_DISABLED = originalDisabled;
    await fs.remove(tmpHome);
  });

  describe("trackEvent", () => {
    it("posts to the telemetry endpoint with the event name and payload", async () => {
      trackEvent("cli_started", { command: "setup" });
      await flushTelemetry();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(TELEMETRY_URL);
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });

      const body = JSON.parse(options.body);
      expect(body.event).toBe("cli_started");
      expect(body.data).toEqual({ command: "setup" });
      expect(body.platform).toBe("darwin");
      expect(typeof body.cliVersion).toBe("string");
      expect(body.nodeVersion).toBe(process.version);
    });

    it("respects AIBLUEPRINT_TELEMETRY_DISABLED=1 and never calls fetch", async () => {
      process.env.AIBLUEPRINT_TELEMETRY_DISABLED = "1";

      trackEvent("cli_started");
      await flushTelemetry();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("still sends when the opt-out variable is set to something other than '1'", async () => {
      process.env.AIBLUEPRINT_TELEMETRY_DISABLED = "true";

      trackEvent("cli_started");
      await flushTelemetry();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("swallows network failures instead of throwing", async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));

      expect(() => trackEvent("cli_started")).not.toThrow();
      await expect(flushTelemetry()).resolves.toBeUndefined();
    });

    it("attaches an abort signal with a timeout so it never hangs the CLI", async () => {
      trackEvent("cli_started");
      await flushTelemetry();

      const [, options] = fetchMock.mock.calls[0];
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("trackError", () => {
    it("reports the error message, a truncated stack, and system info", async () => {
      const err = new Error("boom");
      err.stack = `Error: boom\n${"  at frame\n".repeat(200)}`;

      trackError(err, { context: "setup" });
      await flushTelemetry();

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.event).toBe("error");
      expect(body.data.message).toBe("boom");
      expect(body.data.stack.length).toBeLessThanOrEqual(1500);
      expect(body.data.context).toBe("setup");
      expect(body.data.osType).toBeDefined();
      expect(body.data.cpus).toBeGreaterThan(0);
      expect(body.data.homeDir).toBe(tmpHome);
    });

    it("stringifies non-Error values instead of crashing", async () => {
      trackError("plain string failure");
      await flushTelemetry();

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.data.message).toBe("plain string failure");
      expect(body.data.stack).toBeUndefined();
    });

    it("reports hasProToken=false when no token file exists", async () => {
      trackError(new Error("boom"));
      await flushTelemetry();

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.data.hasProToken).toBe(false);
    });

    it("reports hasProToken=true when a token file exists at the aiblueprint config path", async () => {
      const tokenFile = path.join(tmpHome, ".config", "aiblueprint", "token.txt");
      await fs.ensureDir(path.dirname(tokenFile));
      await fs.writeFile(tokenFile, "ghp_secret");

      trackError(new Error("boom"));
      await flushTelemetry();

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.data.hasProToken).toBe(true);
    });

    it("respects the opt-out and never calls fetch", async () => {
      process.env.AIBLUEPRINT_TELEMETRY_DISABLED = "1";

      trackError(new Error("boom"));
      await flushTelemetry();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("flushTelemetry", () => {
    it("resolves immediately when there is no pending request", async () => {
      await expect(flushTelemetry()).resolves.toBeUndefined();
    });
  });
});
