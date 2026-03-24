import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EchoSnapshot } from "../commands/echo/snapshot.js";
import { isCoreComputeReady } from "../launcher/core-compute.js";

vi.mock("../providers/registry.js", () => ({
  autoDetectProvider: () => ({ name: "openclaw" }),
  detectProviders: () => ({
    openclaw: { detected: true },
    "claude-code": { detected: false },
    codex: { detected: false },
    other: { detected: true },
  }),
  resolveProvider: (name: string) => ({
    name,
    displayName: name,
    installSkill: () => ({ source: "/mock", target: "/mock" }),
    getSkillTargets: () => ({ userDir: "/mock", projectDir: null }),
    getRestartInfo: () => ({ instructions: [] }),
  }),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { defaultScopeForRuntime } = await import("../commands/echo/assessment.js");

interface RoutingDecision {
  mode: "wizard" | "dashboard";
  reason: string;
}

function computeRoutingDecision(snapshot: EchoSnapshot): RoutingDecision {
  if (!snapshot.wallet.configuredAddress && !snapshot.wallet.keystorePresent) {
    return { mode: "wizard", reason: "no_wallet" };
  }
  if (!snapshot.configExists) {
    return { mode: "wizard", reason: "no_config" };
  }
  return isCoreComputeReady(snapshot.compute.readiness?.checks)
    ? { mode: "dashboard", reason: "ready" }
    : { mode: "dashboard", reason: "setup_incomplete" };
}

function makeSnapshot(overrides: {
  walletAddress?: string | null;
  keystorePresent?: boolean;
  configExists?: boolean;
  coreComputeReady?: boolean;
  openclawConfigReady?: boolean;
}): EchoSnapshot {
  const coreReady = overrides.coreComputeReady !== false;
  const openclawConfigReady = overrides.openclawConfigReady !== false;
  const check = (ok: boolean) => ({ ok, detail: ok ? "ok" : "fail" });

  return {
    generatedAt: new Date().toISOString(),
    version: "0.0.0-test",
    configExists: overrides.configExists ?? true,
    wallet: {
      configuredAddress: overrides.walletAddress ?? null,
      keystorePresent: overrides.keystorePresent ?? false,
      evmAddress: overrides.walletAddress ?? null,
      evmKeystorePresent: overrides.keystorePresent ?? false,
      solanaAddress: null,
      solanaKeystorePresent: false,
      password: { status: "ok" as const, driftSources: [] },
      decryptable: true,
    },
    runtimes: {
      recommended: "openclaw",
      detected: {
        openclaw: { detected: true },
        "claude-code": { detected: false },
        codex: { detected: false },
        other: { detected: true },
      } as any,
      skills: [],
    },
    compute: {
      state: { activeProvider: "0xPROVIDER", model: "test" },
      readiness: {
        ready: coreReady && openclawConfigReady,
        provider: "0xPROVIDER",
        checks: {
          wallet: check(coreReady),
          broker: check(coreReady),
          ledger: check(coreReady),
          subAccount: check(coreReady),
          ack: check(coreReady),
          openclawConfig: check(openclawConfigReady),
        },
      },
    },
    claude: {
      configured: false,
      running: false,
      healthy: false,
      pid: null,
      port: 0,
      authConfigured: false,
      provider: null,
      model: null,
      providerEndpoint: null,
      logFile: "",
      settings: {
        projectLocal: { path: "", exists: false },
        projectShared: { path: "", exists: false },
        user: { path: "", exists: false },
      },
    },
    monitor: { running: false, pid: null },
    solanaCluster: "mainnet-beta",
    solanaRpcUrl: "https://api.mainnet-beta.solana.com",
    jupiterApiKeySet: false,
  } as EchoSnapshot;
}

describe("launcher routing decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes to wizard when no wallet is configured", () => {
    const snapshot = makeSnapshot({
      walletAddress: null,
      keystorePresent: false,
      configExists: true,
    });

    expect(computeRoutingDecision(snapshot)).toEqual({
      mode: "wizard",
      reason: "no_wallet",
    });
  });

  it("routes to wizard when config is missing", () => {
    const snapshot = makeSnapshot({
      walletAddress: "0x1234",
      keystorePresent: true,
      configExists: false,
    });

    expect(computeRoutingDecision(snapshot)).toEqual({
      mode: "wizard",
      reason: "no_config",
    });
  });

  it("routes to dashboard setup when a core compute step is missing", () => {
    const snapshot = makeSnapshot({
      walletAddress: "0x1234",
      keystorePresent: true,
      configExists: true,
      coreComputeReady: false,
    });

    expect(computeRoutingDecision(snapshot)).toEqual({
      mode: "dashboard",
      reason: "setup_incomplete",
    });
  });

  it("routes to dashboard ready when only runtime auth is missing", () => {
    const snapshot = makeSnapshot({
      walletAddress: "0x1234",
      keystorePresent: true,
      configExists: true,
      coreComputeReady: true,
      openclawConfigReady: false,
    });

    expect(computeRoutingDecision(snapshot)).toEqual({
      mode: "dashboard",
      reason: "ready",
    });
  });

  it("routes to dashboard ready when core compute and runtime auth are both ready", () => {
    const snapshot = makeSnapshot({
      walletAddress: "0x1234",
      keystorePresent: true,
      configExists: true,
      coreComputeReady: true,
      openclawConfigReady: true,
    });

    expect(computeRoutingDecision(snapshot)).toEqual({
      mode: "dashboard",
      reason: "ready",
    });
  });
});

describe("defaultScopeForRuntime", () => {
  it('returns "user" for openclaw', () => {
    expect(defaultScopeForRuntime("openclaw")).toBe("user");
  });

  it('returns "project" for claude-code', () => {
    expect(defaultScopeForRuntime("claude-code")).toBe("project");
  });

  it('returns "project" for codex', () => {
    expect(defaultScopeForRuntime("codex")).toBe("project");
  });
});
