/**
 * strategy_versions repo (migration 047) — versioning / approval / rollback /
 * reset-to-baseline against the real Postgres schema.
 *
 * Proves guardrail (c): prior versions are never mutated/destroyed, exactly one
 * version is ever active, and rollback + reset-to-baseline are safe re-
 * activations. Requires the integration harness (testcontainers Postgres) —
 * runs under `pnpm test:integration`, not the default unit run.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  ensureBaseline,
  getActiveVersion,
  getBaselineVersion,
  insertProposal,
  activateVersion,
  resetToBaseline,
  listVersions,
  getRecentAdoptedContents,
} from "@vex-agent/db/repos/strategy-versions.js";
import { resetDb } from "../setup/fixtures.js";

const BASELINE = "Baseline tactics: prefer liquid tokens and take profit into strength.";

describe("strategy_versions repo (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("seeds the baseline as version 0 and makes it active (idempotent)", async () => {
    const first = await ensureBaseline(BASELINE);
    expect(first.versionNo).toBe(0);
    expect(first.isBaseline).toBe(true);
    expect(first.active).toBe(true);
    // Idempotent — a second call does not create a duplicate baseline.
    await ensureBaseline(BASELINE);
    const all = await listVersions();
    expect(all.filter((v) => v.isBaseline)).toHaveLength(1);
  });

  it("stores a pending proposal without activating it, then approves it", async () => {
    await ensureBaseline(BASELINE);
    const pending = await insertProposal({
      id: "p1",
      content: "Revised tactics v1",
      status: "pending",
      drivingMissionRunId: null,
      drivingLessons: ["wait for liquidity"],
      rejectionReason: null,
      audit: { stage: "accepted" },
      model: "m",
    });
    expect(pending.active).toBe(false);
    // Baseline still live until approval.
    expect((await getActiveVersion())?.isBaseline).toBe(true);

    const approved = await activateVersion("p1");
    expect(approved?.active).toBe(true);
    expect(approved?.status).toBe("active");
    const active = await getActiveVersion();
    expect(active?.id).toBe("p1");
    // Exactly one active row.
    const all = await listVersions();
    expect(all.filter((v) => v.active)).toHaveLength(1);
    // Prior baseline is preserved (archived to baseline status), not destroyed.
    const base = await getBaselineVersion();
    expect(base?.active).toBe(false);
    expect(base?.content).toBe(BASELINE);
  });

  it("rejected proposals are never activatable", async () => {
    await ensureBaseline(BASELINE);
    await insertProposal({
      id: "r1",
      content: "malicious",
      status: "rejected",
      drivingMissionRunId: null,
      drivingLessons: [],
      rejectionReason: "red-flag",
      audit: {},
      model: null,
    });
    expect(await activateVersion("r1")).toBeNull();
    expect((await getActiveVersion())?.isBaseline).toBe(true);
  });

  it("rolls back to a prior version and preserves every version", async () => {
    await ensureBaseline(BASELINE);
    await insertProposal({ id: "p1", content: "v1", status: "pending", drivingMissionRunId: null, drivingLessons: [], rejectionReason: null, audit: {}, model: null });
    await activateVersion("p1");
    await insertProposal({ id: "p2", content: "v2", status: "pending", drivingMissionRunId: null, drivingLessons: [], rejectionReason: null, audit: {}, model: null });
    await activateVersion("p2");
    expect((await getActiveVersion())?.id).toBe("p2");

    // Roll back to p1 (now archived).
    const rolled = await activateVersion("p1");
    expect(rolled?.id).toBe("p1");
    expect((await getActiveVersion())?.id).toBe("p1");
    // All three (+baseline) still exist.
    expect((await listVersions()).length).toBeGreaterThanOrEqual(3);
    // Recently-adopted contents include the re-activated one, newest first.
    const adopted = await getRecentAdoptedContents(3);
    expect(adopted[0]).toBe("v1");
  });

  it("reset-to-baseline re-activates the seed and re-syncs its content", async () => {
    await ensureBaseline(BASELINE);
    await insertProposal({ id: "p1", content: "v1", status: "pending", drivingMissionRunId: null, drivingLessons: [], rejectionReason: null, audit: {}, model: null });
    await activateVersion("p1");
    expect((await getActiveVersion())?.id).toBe("p1");

    const NEW_BASELINE = "Updated baseline seed tactics with fresh guidance.";
    const active = await resetToBaseline(NEW_BASELINE);
    expect(active.isBaseline).toBe(true);
    expect(active.active).toBe(true);
    expect(active.content).toBe(NEW_BASELINE);
    expect((await getActiveVersion())?.isBaseline).toBe(true);
  });
});
