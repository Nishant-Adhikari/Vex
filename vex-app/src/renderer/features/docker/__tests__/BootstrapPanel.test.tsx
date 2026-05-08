/**
 * Branch matrix tests for BootstrapPanel — ensures each (engine present,
 * daemon running, platform) combination renders the correct branch
 * (A/B/C-desktop/C-linux/D) per M4 plan.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const mockHooks = vi.hoisted(() => ({
  useDockerStatus: vi.fn(),
  useDockerInstall: vi.fn(),
  useDockerStart: vi.fn(),
  useSystemHealth: vi.fn(),
}));

vi.mock("../../../lib/api/docker.js", () => ({
  useDockerStatus: mockHooks.useDockerStatus,
  useDockerInstall: mockHooks.useDockerInstall,
  useDockerStart: mockHooks.useDockerStart,
}));
vi.mock("../../../lib/api/system.js", () => ({
  useSystemHealth: mockHooks.useSystemHealth,
}));

import { BootstrapPanel } from "../BootstrapPanel.js";

function statusResult(opts: {
  enginePresent: boolean;
  daemonRunning: boolean;
}) {
  return {
    isPending: false,
    data: {
      ok: true as const,
      data: {
        engine: { present: opts.enginePresent, version: opts.enginePresent ? "27.5.1" : null, runtimeOK: opts.daemonRunning },
        compose: { present: opts.enginePresent, version: opts.enginePresent ? "v2.32.4" : null },
        modelRunner: { present: opts.enginePresent, status: "active" as const, tcpReachable: true },
        daemon: { running: opts.daemonRunning, startable: opts.enginePresent },
        ports: { vexPgFree: true },
        disk: { availableGB: 50 },
      },
    },
    refetch: vi.fn(),
  };
}

function healthResult(platform: "linux" | "darwin" | "win32") {
  return {
    isPending: false,
    data: {
      ok: true as const,
      data: {
        os: {
          platform,
          arch: "x64" as const,
          release: "1",
          distro: null,
          homedir: "/h",
          userDataDir: "/u",
          appVersion: "0.1.0-dev",
          electronVersion: "42.0.0",
          nodeVersion: "22.0.0",
        },
        network: { online: true, latencyMs: 1, probedAt: "2026-05-08T00:00:00Z" },
        setupComplete: false,
        overall: "degraded" as const,
      },
    },
  };
}

const noopMutation = {
  mutate: vi.fn(),
  isPending: false,
  data: undefined,
};

describe("BootstrapPanel branch matrix", () => {
  beforeEach(() => {
    mockHooks.useDockerInstall.mockReturnValue(noopMutation);
    mockHooks.useDockerStart.mockReturnValue(noopMutation);
  });

  afterEach(() => {
    cleanup();
    mockHooks.useDockerStatus.mockReset();
    mockHooks.useDockerInstall.mockReset();
    mockHooks.useDockerStart.mockReset();
    mockHooks.useSystemHealth.mockReset();
    noopMutation.mutate.mockReset();
  });

  it.each<["linux" | "darwin" | "win32"]>([["darwin"], ["win32"], ["linux"]])(
    "branch A: ready when engine present + daemon running (%s)",
    (platform) => {
      mockHooks.useDockerStatus.mockReturnValue(
        statusResult({ enginePresent: true, daemonRunning: true })
      );
      mockHooks.useSystemHealth.mockReturnValue(healthResult(platform));
      const { getByText } = render(<BootstrapPanel />);
      expect(getByText(/Docker is ready/i)).toBeDefined();
    }
  );

  it.each<["linux" | "darwin" | "win32"]>([["darwin"], ["win32"], ["linux"]])(
    "branch B: daemon stopped offers Start Docker (%s)",
    (platform) => {
      mockHooks.useDockerStatus.mockReturnValue(
        statusResult({ enginePresent: true, daemonRunning: false })
      );
      mockHooks.useSystemHealth.mockReturnValue(healthResult(platform));
      const { getByRole } = render(<BootstrapPanel />);
      expect(getByRole("button", { name: /Start Docker/i })).toBeDefined();
    }
  );

  it.each<["darwin" | "win32"]>([["darwin"], ["win32"]])(
    "branch C-desktop: missing engine on macOS/Windows offers Download (%s)",
    (platform) => {
      mockHooks.useDockerStatus.mockReturnValue(
        statusResult({ enginePresent: false, daemonRunning: false })
      );
      mockHooks.useSystemHealth.mockReturnValue(healthResult(platform));
      const { getByRole } = render(<BootstrapPanel />);
      expect(getByRole("button", { name: /Download installer/i })).toBeDefined();
    }
  );

  it("branch C-linux: missing engine on Linux offers auto + manual options", () => {
    mockHooks.useDockerStatus.mockReturnValue(
      statusResult({ enginePresent: false, daemonRunning: false })
    );
    mockHooks.useSystemHealth.mockReturnValue(healthResult("linux"));
    const { getByRole } = render(<BootstrapPanel />);
    expect(getByRole("button", { name: /Run for me/i })).toBeDefined();
    expect(getByRole("button", { name: /Show manual instructions/i })).toBeDefined();
  });
});
