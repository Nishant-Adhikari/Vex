import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `vex-env-test-${Date.now()}`);
const appEnvPath = join(testDir, "app", ".env");

vi.mock("@config/paths.js", () => ({
  ENV_FILE: appEnvPath,
}));

const { readEnvValue, loadProviderDotenv, writeAppEnvValue } = await import(
  "../../providers/env-resolution.js"
);

describe("readEnvValue", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "app"), { recursive: true });
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns null for non-existent file", () => {
    expect(readEnvValue("FOO", "/nonexistent/.env")).toBeNull();
  });

  it("reads unquoted non-secret values from .env", () => {
    writeFileSync(appEnvPath, "MY_KEY=my-value\n");
    expect(readEnvValue("MY_KEY", appEnvPath)).toBe("my-value");
  });

  it("reads double-quoted non-secret values from .env", () => {
    writeFileSync(appEnvPath, 'MY_KEY="my password with spaces"\n');
    expect(readEnvValue("MY_KEY", appEnvPath)).toBe("my password with spaces");
  });

  it("ignores secret values in .env and reads unlocked process.env secrets", () => {
    writeFileSync(appEnvPath, 'OPENROUTER_API_KEY="plaintext-legacy"\n');
    expect(readEnvValue("OPENROUTER_API_KEY", appEnvPath)).toBeNull();

    process.env.OPENROUTER_API_KEY = "loaded-from-vault";
    expect(readEnvValue("OPENROUTER_API_KEY", appEnvPath)).toBe("loaded-from-vault");
  });
});

describe("loadProviderDotenv", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "app"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.TEST_APP_VAR;
    delete process.env.OPENROUTER_API_KEY;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads non-secret app .env values", () => {
    writeFileSync(appEnvPath, "TEST_APP_VAR=from-app\n");
    loadProviderDotenv();
    expect(process.env.TEST_APP_VAR).toBe("from-app");
  });

  it("does not load managed secrets from .env", () => {
    writeFileSync(appEnvPath, 'OPENROUTER_API_KEY="plaintext-legacy"\n');
    loadProviderDotenv();
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it("does not overwrite existing process.env values", () => {
    process.env.TEST_APP_VAR = "already-set";
    writeFileSync(appEnvPath, "TEST_APP_VAR=from-file\n");
    loadProviderDotenv();
    expect(process.env.TEST_APP_VAR).toBe("already-set");
  });
});

describe("writeAppEnvValue", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "app"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes non-secret values to app env", () => {
    const result = writeAppEnvValue("AGENT_MODEL", "openai/test");
    expect(result).toBe(appEnvPath);
    expect(readEnvValue("AGENT_MODEL", appEnvPath)).toBe("openai/test");
  });

  it("rejects managed secret writes to app env", () => {
    expect(() => writeAppEnvValue("VEX_KEYSTORE_PASSWORD", "secret-pass")).toThrow(
      /secret vault/,
    );
  });
});
