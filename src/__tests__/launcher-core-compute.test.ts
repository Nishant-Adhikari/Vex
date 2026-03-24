import { describe, expect, it } from "vitest";
import { isCoreComputeReady, listCoreComputeFailures } from "../launcher/core-compute.js";

describe("core compute readiness helpers", () => {
  it("treats runtime auth as non-blocking for EchoClaw core readiness", () => {
    const checks = {
      wallet: { ok: true },
      broker: { ok: true },
      ledger: { ok: true },
      subAccount: { ok: true },
      ack: { ok: true },
      openclawConfig: { ok: false },
    };

    expect(isCoreComputeReady(checks)).toBe(true);
    expect(listCoreComputeFailures(checks)).toEqual([]);
  });

  it("returns the missing core checks when setup is incomplete", () => {
    const checks = {
      wallet: { ok: true },
      broker: { ok: true },
      ledger: { ok: false },
      subAccount: { ok: false },
      ack: { ok: true },
      openclawConfig: { ok: false },
    };

    expect(isCoreComputeReady(checks)).toBe(false);
    expect(listCoreComputeFailures(checks)).toEqual(["ledger", "subAccount"]);
  });

  it("treats missing checks as not ready", () => {
    expect(isCoreComputeReady(null)).toBe(false);
    expect(listCoreComputeFailures(undefined)).toEqual([
      "wallet",
      "broker",
      "ledger",
      "subAccount",
      "ack",
    ]);
  });
});
