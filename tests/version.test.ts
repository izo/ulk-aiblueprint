import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("version", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("fs");
    vi.restoreAllMocks();
  });

  it("returns 'unknown' instead of throwing when package.json cannot be located", async () => {
    // getVersion() resolves package.json relative to the compiled dist/ output
    // (../package.json from dirname(import.meta.url)). Running from TS source
    // under the test runner, that path does not exist — this documents the
    // safe fallback rather than a crash.
    const { getVersion } = await import("../src/lib/version");

    expect(getVersion()).toBe("unknown");
  });

  it("returns the version field when package.json can be read", async () => {
    vi.doMock("fs", () => ({
      readFileSync: vi.fn(() => JSON.stringify({ name: "aiblueprint-cli", version: "9.9.9" })),
    }));

    const { getVersion } = await import("../src/lib/version");

    expect(getVersion()).toBe("9.9.9");
  });

  it("falls back to 'unknown' when reading package.json throws", async () => {
    vi.doMock("fs", () => ({
      readFileSync: vi.fn(() => {
        throw new Error("ENOENT: no such file or directory");
      }),
    }));

    const { getVersion } = await import("../src/lib/version");

    expect(getVersion()).toBe("unknown");
  });

  it("falls back to 'unknown' when package.json contains invalid JSON", async () => {
    vi.doMock("fs", () => ({
      readFileSync: vi.fn(() => "{not valid json"),
    }));

    const { getVersion } = await import("../src/lib/version");

    expect(getVersion()).toBe("unknown");
  });

  it("reads package.json at most once and caches the result", async () => {
    const readFileSync = vi.fn(() => JSON.stringify({ version: "1.2.3" }));
    vi.doMock("fs", () => ({ readFileSync }));

    const { getVersion } = await import("../src/lib/version");
    const first = getVersion();
    const second = getVersion();

    expect(first).toBe("1.2.3");
    expect(second).toBe("1.2.3");
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });
});
