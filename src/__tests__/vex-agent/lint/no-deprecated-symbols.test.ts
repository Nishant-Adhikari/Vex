/**
 * PR-12 — dead-symbol freeze for runtime code in `src/vex-agent/`.
 *
 * The wake-driven autonomy rollout (PR-1 through PR-11) removed four
 * concept families. This lint asserts their identifiers never reappear in
 * runtime code — a re-introduction should be caught structurally, not
 * noticed months later during archaeology.
 *
 * Forbidden identifiers:
 *   - Placeholder scheduler (PR-1): `schedule_create`, `schedule_remove`,
 *     `schedule_runs`, `node-cron`, `node_cron`. The name `schedules` is
 *     too common (legitimate English noun) so we don't ban it.
 *   - Auto-promotion (PR-2): `runPromotionForSession`, `promotion_version`,
 *     `source_episode_id`, `source_episode_hash`, `cluster_hash`.
 *   - Dead status (PR-0): `paused_checkpoint`.
 *   - Comment rot from the wake rollout: phrases like `"lands in PR-"`,
 *     `"stub today"`, `"zero behaviour change until PR-"`. Those tags are
 *     meaningful only while a PR series is still open — after merge they
 *     become historical drift that misleads readers. Banning them
 *     structurally stops the rot from sneaking back in.
 *
 * Scope: runtime files under `src/vex-agent/` (mirrors the no-any-policy
 * scope). Tests / e2e / scripts are excluded — they may legitimately
 * reference the deprecated strings in comments describing what was
 * removed.
 *
 * When you intentionally re-introduce one of these identifiers (extremely
 * unlikely — they are dead by design), bump this test's allowlist with a
 * comment explaining why.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const FORBIDDEN_IDENTIFIERS = [
  // PR-1 — placeholder scheduler
  "schedule_create",
  "schedule_remove",
  "schedule_runs",
  "node-cron",
  "node_cron",
  // PR-2 — auto-promotion
  "runPromotionForSession",
  "promotion_version",
  "source_episode_id",
  "source_episode_hash",
  "cluster_hash",
  // PR-0 — dead status
  "paused_checkpoint",
  // Post-rollout comment rot — phrases that only make sense while a PR
  // series is open. Banning them keeps stale forward-references out of
  // runtime after the PRs land.
  "lands in PR-",
  "stub today",
  "zero behaviour change until PR-",
] as const;

const EXCLUDED_SUBPATHS = [
  "/scripts/",
  "/e2e/",
  "/AUDIT_INVENTORY",
];

function listRuntimeFiles(): string[] {
  const raw = execSync("git ls-files -- 'src/vex-agent/**/*.ts'", {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  return raw
    .split("\n")
    .filter(Boolean)
    .filter((p) => !p.includes("/__tests__/"))
    .filter((p) => !EXCLUDED_SUBPATHS.some((ex) => p.includes(ex)))
    .map((p) => resolve(process.cwd(), p))
    // Tracked-but-deleted files (a pending deletion in the working tree)
    // still show up in `git ls-files`; skip them instead of crashing.
    .filter((p) => existsSync(p));
}

describe("no-deprecated-symbols policy — runtime code in src/vex-agent/", () => {
  // Generous timeout: this is a repo-wide fs scan, which can take >10s on
  // slow mounts (WSL drvfs); it is a lint sweep, not a perf test.
  it("never mentions any removed scheduler / promotion / paused_checkpoint identifier", { timeout: 60_000 }, () => {
    const files = listRuntimeFiles();
    expect(files.length, "no runtime files discovered — git ls-files failing?").toBeGreaterThan(0);

    const offenders: Array<{ path: string; identifier: string; line: number; snippet: string }> = [];
    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      const lines = raw.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const identifier of FORBIDDEN_IDENTIFIERS) {
          if (line.includes(identifier)) {
            offenders.push({
              path: file,
              identifier,
              line: i + 1,
              snippet: line.trim().slice(0, 120),
            });
          }
        }
      }
    }

    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.path}:${o.line}  [${o.identifier}]  ${o.snippet}`)
        .join("\n");
      throw new Error(
        `no-deprecated-symbols policy violated: ${offenders.length} occurrence(s) found.\n` +
          `These identifiers were removed by the wake-driven autonomy rollout and must not return:\n` +
          detail,
      );
    }

    expect(offenders).toEqual([]);
  });

  it("`findLastUserInput` has no CODE references (its last home, the recall-seed module, was deleted in S9)", { timeout: 60_000 }, () => {
    const files = listRuntimeFiles();
    const hits: Array<{ path: string; line: number }> = [];
    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      // Strip block comments then line comments so references inside
      // documentation blocks do not count as code. Mirrors the same trick
      // used by `no-any-policy.test.ts`.
      const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
      const lines = noBlock.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const codeOnly = lines[i]!.replace(/\/\/.*$/, "");
        if (codeOnly.includes("findLastUserInput")) {
          hits.push({ path: file, line: i + 1 });
        }
      }
    }

    if (hits.length > 0) {
      const detail = hits.map((h) => `  ${h.path}:${h.line}`).join("\n");
      throw new Error(
        `findLastUserInput was deleted with the legacy recall seed (S9) and must not return:\n${detail}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
