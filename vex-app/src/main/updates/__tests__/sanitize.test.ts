/**
 * sanitize (M13) — the redaction boundary. Asserts the public status carries
 * only versions/severity/summary/bounded progress, error messages are generic,
 * and the updater logger scrubs URLs/paths (electron-updater logs them raw).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

const logInfo = vi.fn();
vi.mock("../../logger/index.js", () => ({
  log: { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../statusCache.js", () => ({
  getCurrentStatus: () => ({
    kind: "available",
    currentVersion: "1.0.0",
    latestVersion: "2.0.0",
    severity: "normal",
  }),
}));

const {
  availableStatus,
  downloadingStatus,
  errorStatus,
  publicUpdateError,
  filteredUpdaterLogger,
} = await import("../sanitize.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("availableStatus", () => {
  it("projects version/severity/summary and drops paths/files/urls", () => {
    // Test fixture: a realistic UpdateInfo carries paths/files we must NOT leak.
    const info = {
      version: "2.0.0",
      releaseDate: "2026-01-01",
      releaseName: "What's new",
      path: "/Users/x/Library/Caches/vex/Vex-2.0.0.dmg",
      files: [{ url: "https://feed.example/Vex-2.0.0.dmg" }],
    } as unknown as UpdateInfo;
    const status = availableStatus(info, "1.0.0");
    expect(status).toEqual({
      kind: "available",
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      severity: "normal",
      releaseDate: "2026-01-01",
      summary: "What's new",
    });
    expect(JSON.stringify(status)).not.toContain("https://");
    expect(JSON.stringify(status)).not.toContain("/Users/");
  });

  it("maps a [CRITICAL] release-title marker to severity (UX-only convention)", () => {
    const info = {
      version: "2.0.0",
      releaseName: "[CRITICAL] Fix a key-safety regression",
    } as unknown as UpdateInfo;
    expect(availableStatus(info, "1.0.0")).toMatchObject({ severity: "critical" });
  });

  it("maps a [security] marker in releaseNotes (case-insensitive) to severity", () => {
    const info = {
      version: "2.0.0",
      releaseName: "2.0.0",
      releaseNotes: "This release contains a [security] fix.",
    } as unknown as UpdateInfo;
    expect(availableStatus(info, "1.0.0")).toMatchObject({ severity: "security" });
  });

  it("defaults to `normal` when no release marker is present (today's behavior)", () => {
    const info = {
      version: "2.0.0",
      releaseName: "Routine improvements",
    } as unknown as UpdateInfo;
    expect(availableStatus(info, "1.0.0")).toMatchObject({ severity: "normal" });
  });
});

describe("downloadingStatus", () => {
  it("clamps percent and recovers the latest version from cache", () => {
    const progress = {
      percent: 150,
      transferred: 5,
      total: 10,
      bytesPerSecond: 2,
    } as unknown as ProgressInfo;
    expect(downloadingStatus(progress, "1.0.0")).toMatchObject({
      kind: "downloading",
      latestVersion: "2.0.0",
      percent: 100,
    });
  });
});

describe("errorStatus + publicUpdateError", () => {
  it("errorStatus is generic + redacted (no url/path leak)", () => {
    const status = errorStatus(
      new Error("ENOENT https://feed/latest.yml at /tmp/file"),
      "1.0.0",
    );
    expect(status).toEqual({
      kind: "error",
      currentVersion: "1.0.0",
      message: expect.any(String),
      retryable: true,
    });
    expect(JSON.stringify(status)).not.toContain("https://");
    expect(JSON.stringify(status)).not.toContain("/tmp/");
  });

  it("publicUpdateError builds a redacted updater VexError", () => {
    expect(publicUpdateError("update.download_failed", "cid")).toMatchObject({
      code: "update.download_failed",
      domain: "updater",
      redacted: true,
      correlationId: "cid",
    });
  });
});

describe("filteredUpdaterLogger", () => {
  it("scrubs URLs and paths before logging", () => {
    filteredUpdaterLogger.info(
      "downloading https://feed.example/Vex-2.0.0.dmg to /Users/x/Library/Caches/vex/pending",
    );
    expect(logInfo).toHaveBeenCalledTimes(1);
    const logged = String(logInfo.mock.calls[0]?.[0]);
    expect(logged).not.toContain("https://");
    expect(logged).not.toContain("/Users/");
    expect(logged).toContain("[url]");
  });
});
