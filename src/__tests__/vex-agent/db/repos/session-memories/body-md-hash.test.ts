/**
 * Pure unit tests for `computeBodyMdHash`. The function is the foundation
 * of the PR3-final concurrent-resolution embedding race fix: the hash on
 * the row identifies which body_md a given embedding was computed against,
 * so `updateEmbedding` can reject stale writes where a concurrent
 * `markOutstandingResolved` already rotated the body to a fresh state.
 *
 * The DB-side WHERE-clause and the markOutstandingResolved tx integration
 * are covered by the race integration test; this file pins the hash
 * function's contract: deterministic, collision-resistant (sha256), fixed
 * 64-char hex output.
 */

import { describe, it, expect } from "vitest";

import { computeBodyMdHash } from "../../../../../vex-agent/db/repos/session-memories/types.js";

describe("computeBodyMdHash (PR3-final pure unit)", () => {
  it("returns 64-char hex string", () => {
    const hash = computeBodyMdHash("any body");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input produces same hash", () => {
    const body = "## What happened\nDid a thing\n\n## Outstanding\n- [uuid] item A — UNRESOLVED";
    expect(computeBodyMdHash(body)).toBe(computeBodyMdHash(body));
  });

  it("returns different hashes for different bodies", () => {
    const before = "## Outstanding\n- [id-a] item A — UNRESOLVED\n- [id-b] item B — UNRESOLVED";
    const afterAResolved =
      "## Outstanding\n- [id-a] item A — RESOLVED at 2026-01-01T00:00:00Z by agent: done\n- [id-b] item B — UNRESOLVED";
    expect(computeBodyMdHash(before)).not.toBe(computeBodyMdHash(afterAResolved));
  });

  it("returns different hash for a single-character change", () => {
    const a = "the quick brown fox";
    const b = "the quick brown FOX";
    expect(computeBodyMdHash(a)).not.toBe(computeBodyMdHash(b));
  });

  it("handles empty string", () => {
    const hash = computeBodyMdHash("");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // sha256 of empty string is well-known; assert exact value as a
    // regression guard against accidentally swapping the hash algorithm.
    expect(hash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("handles unicode + multi-byte content without throwing", () => {
    const body = "résumé — UTF-8 ✓ кириллица 中文";
    const hash = computeBodyMdHash(body);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
