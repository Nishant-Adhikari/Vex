import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const UPDATE_COMMAND_TEST_TIMEOUT_MS = 60_000;
let mockedCheckForUpdates: ReturnType<typeof vi.fn> | null = null;

vi.mock("../../update/updater.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../update/updater.js")>();
  return {
    ...actual,
    checkForUpdates: (...args: any[]) =>
      mockedCheckForUpdates != null
        ? mockedCheckForUpdates(...args)
        : actual.checkForUpdates(...args),
  };
});

function captureStdout(): { output: () => string; restore: () => void } {
  let output = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: any, encoding?: any, cb?: any) => {
    output += typeof chunk === "string" ? chunk : chunk.toString(encoding);
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof cb === "function") {
      cb();
    }
    return true;
  }) as any;
  return {
    output: () => output,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

async function loadUpdateCommand(
  root: string,
  options: { mockCheckForUpdates?: ReturnType<typeof vi.fn> } = {},
) {
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  process.env.OPENCLAW_HOME = join(root, "openclaw");
  mockedCheckForUpdates = options.mockCheckForUpdates ?? null;
  vi.resetModules();

  const output = await import("@utils/output.js");
  output.setJsonMode(true);

  const updateModule = await import("@commands/update/index.js");
  const pathsModule = await import("@config/paths.js");
  const envModule = await import("../../providers/env-resolution.js");
  const updaterModule = await import("../../update/updater.js");

  return {
    createUpdateCommand: updateModule.createUpdateCommand,
    setJsonMode: output.setJsonMode,
    envFile: pathsModule.ENV_FILE,
    readEnvValue: envModule.readEnvValue,
    updateCheckFile: updaterModule.UPDATE_CHECK_FILE,
  };
}

describe.sequential("update command", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  const savedOpenclawHome = process.env.OPENCLAW_HOME;

  afterEach(() => {
    mockedCheckForUpdates = null;
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;

    if (savedOpenclawHome === undefined) delete process.env.OPENCLAW_HOME;
    else process.env.OPENCLAW_HOME = savedOpenclawHome;
  });

  it("enable/start writes env preference and accepts legacy flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-update-enable-"));
    const { createUpdateCommand, setJsonMode, envFile, readEnvValue } =
      await loadUpdateCommand(root);

    const update = createUpdateCommand();
    const capture = captureStdout();
    try {
      await update.parseAsync(["start", "--daemon", "--interval", "300"], { from: "user" });
      const payload = JSON.parse(capture.output().trim());

      expect(payload.success).toBe(true);
      expect(payload.enabled).toBe(true);
      expect(payload.legacyOptionsIgnored).toBe(true);
      expect(payload.daemonUsed).toBe(false);
      expect(readEnvValue("ECHO_AUTO_UPDATE", envFile)).toBe("1");
    } finally {
      capture.restore();
      setJsonMode(false);
      rmSync(root, { recursive: true, force: true });
    }
  }, UPDATE_COMMAND_TEST_TIMEOUT_MS);

  it("disable/stop writes explicit opt-out", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-update-disable-"));
    const { createUpdateCommand, setJsonMode, envFile, readEnvValue } =
      await loadUpdateCommand(root);

    const update = createUpdateCommand();
    const capture = captureStdout();
    try {
      await update.parseAsync(["stop"], { from: "user" });
      const payload = JSON.parse(capture.output().trim());

      expect(payload.success).toBe(true);
      expect(payload.enabled).toBe(false);
      expect(payload.daemonUsed).toBe(false);
      expect(readEnvValue("ECHO_AUTO_UPDATE", envFile)).toBe("0");
    } finally {
      capture.restore();
      setJsonMode(false);
      rmSync(root, { recursive: true, force: true });
    }
  }, UPDATE_COMMAND_TEST_TIMEOUT_MS);

  it("check reports the background updater result without mutating local state", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-update-check-"));
    const mockCheckForUpdates = vi.fn().mockResolvedValue({
      checked: true,
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      isNewer: true,
      action: "notified",
    });
    const { createUpdateCommand, setJsonMode } =
      await loadUpdateCommand(root, { mockCheckForUpdates });

    const update = createUpdateCommand();
    const capture = captureStdout();
    try {
      await update.parseAsync(["check"], { from: "user" });
      const payload = JSON.parse(capture.output().trim());

      expect(mockCheckForUpdates).toHaveBeenCalledWith(expect.any(String), {
        forceCheck: true,
        readOnly: true,
      });
      expect(payload.success).toBe(true);
      expect(payload.currentVersion).toBe("1.0.0");
      expect(payload.latestVersion).toBe("2.0.0");
      expect(payload.isNewer).toBe(true);
      expect(payload.action).toBe("notified");
    } finally {
      capture.restore();
      setJsonMode(false);
      rmSync(root, { recursive: true, force: true });
    }
  }, UPDATE_COMMAND_TEST_TIMEOUT_MS);

  it("status reports preference and last update-check metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-update-status-"));
    const {
      createUpdateCommand,
      setJsonMode,
      updateCheckFile,
    } = await loadUpdateCommand(root);

    const enableCapture = captureStdout();
    try {
      await createUpdateCommand().parseAsync(["enable"], { from: "user" });
    } finally {
      enableCapture.restore();
    }

    mkdirSync(dirname(updateCheckFile), { recursive: true });
    writeFileSync(updateCheckFile, JSON.stringify({
      lastCheckedAtMs: 1_700_000_000_000,
      lastNotifiedVersion: "2.0.0",
      lastAutoUpdateAttemptAtMs: 1_700_000_123_000,
    }), "utf-8");

    const capture = captureStdout();
    try {
      await createUpdateCommand().parseAsync(["status"], { from: "user" });
      const payload = JSON.parse(capture.output().trim());

      expect(payload.success).toBe(true);
      expect(payload.enabled).toBe(true);
      expect(payload.daemonUsed).toBe(false);
      expect(payload.lastCheck).toMatchObject({
        lastCheckedAtMs: 1_700_000_000_000,
        lastNotifiedVersion: "2.0.0",
        lastAutoUpdateAttemptAtMs: 1_700_000_123_000,
      });
      expect(payload.legacyArtifacts.detected).toBe(false);
    } finally {
      capture.restore();
      setJsonMode(false);
      rmSync(root, { recursive: true, force: true });
    }
  }, UPDATE_COMMAND_TEST_TIMEOUT_MS);
});
