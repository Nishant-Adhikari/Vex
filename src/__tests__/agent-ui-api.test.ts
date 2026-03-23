import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRuntimeUpdate,
  fetchLauncherJson,
  getLauncherOrigin,
  getRuntimeUpdateStatus,
  retryRuntimeUpdatePull,
} from "../agent/ui/src/api.js";

describe("agent UI launcher bridge", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("builds the launcher origin from the current hostname", () => {
    expect(getLauncherOrigin()).toBe("http://127.0.0.1:4200");
    expect(getLauncherOrigin({ protocol: "https:", hostname: "echo.local" } as Pick<Location, "protocol" | "hostname">))
      .toBe("https://echo.local:4200");
  });

  it("fetches launcher JSON and maps launcher-side errors", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ updateAvailable: true }),
    });

    await expect(fetchLauncherJson("/api/runtime-update")).resolves.toEqual({ updateAvailable: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4200/api/runtime-update", expect.any(Object));

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: "launcher offline" } }),
    });

    await expect(fetchLauncherJson("/api/runtime-update")).rejects.toThrow("launcher offline");
  });

  it("uses the launcher bridge helpers for runtime update control", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ readyToApply: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ retried: true, status: { pullStatus: "pulling" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ applied: true, healthy: true, status: { targetPackageVersion: null } }),
      });

    await expect(getRuntimeUpdateStatus()).resolves.toEqual({ readyToApply: true });
    await expect(retryRuntimeUpdatePull()).resolves.toEqual({
      retried: true,
      status: { pullStatus: "pulling" },
    });
    await expect(applyRuntimeUpdate()).resolves.toEqual({
      applied: true,
      healthy: true,
      status: { targetPackageVersion: null },
    });

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "POST" });
  });
});
