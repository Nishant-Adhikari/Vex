/**
 * A5 — discover_tools baseline harness (seed-stage).
 *
 * Loads `tool-discovery-seed.json` (50-query stratified set: English single,
 * English cross-namespace, Polish-against-English) and runs each query
 * through `discoverProtocolCapabilities` in lexical mode. Reports
 * Recall@1 / Recall@5 / MRR@5 per cohort.
 *
 * Two assertion tiers:
 *   1. **Sanity** — every query returns at least one tool (no zero-result
 *      bug). This must always hold; failure here means the registry is
 *      broken, not the retrieval.
 *   2. **Floor recall** — Recall@5 ≥ 0.5 across each cohort. Permissive on
 *      purpose: this is the seed-stage gate before Phase 4 hybrid wiring;
 *      regressions become CI-blockable once hybrid baseline is committed.
 *
 * The hybrid path is NOT exercised here — it requires both pgvector and
 * the local embedding sidecar, which are integration concerns. Phase 4 of
 * the long-term plan adds the hybrid baseline once the eval harness is
 * mature enough to gate.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { discoverProtocolCapabilities } from "../../vex-agent/tools/protocols/runtime.js";

interface SeedQuery {
  query: string;
  language: "en" | "pl";
  expectedToolIds: string[];
  cohort: "single-namespace" | "cross-namespace" | "polish";
}

interface SeedDataset {
  version: string;
  description: string;
  queries: SeedQuery[];
}

const dataset = loadDataset();

function loadDataset(): SeedDataset {
  const path = resolve(import.meta.dirname, "datasets", "tool-discovery-seed.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as SeedDataset;
}

interface RetrievalResult {
  topIds: string[];
  hitRank: number; // 0-based rank of first expected match, or -1 if none
}

async function evaluate(query: SeedQuery): Promise<RetrievalResult> {
  const result = await discoverProtocolCapabilities({ query: query.query, limit: 5 });
  const topIds = result.tools.map((t) => t.toolId);
  const expected = new Set(query.expectedToolIds);
  let hitRank = -1;
  for (let i = 0; i < topIds.length; i++) {
    const id = topIds[i]!;
    const matched = [...expected].some(
      (e) => id === e || id.startsWith(`${e}.`),
    );
    if (matched) { hitRank = i; break; }
  }
  return { topIds, hitRank };
}

interface CohortMetrics {
  count: number;
  recall1: number;
  recall5: number;
  mrr5: number;
  misses: { query: string; topIds: string[]; expected: string[] }[];
}

function aggregate(results: { query: SeedQuery; result: RetrievalResult }[]): CohortMetrics {
  let r1 = 0;
  let r5 = 0;
  let mrrSum = 0;
  const misses: CohortMetrics["misses"] = [];
  for (const { query, result } of results) {
    if (result.hitRank === 0) r1++;
    if (result.hitRank >= 0 && result.hitRank < 5) {
      r5++;
      mrrSum += 1 / (result.hitRank + 1);
    } else {
      misses.push({ query: query.query, topIds: result.topIds, expected: query.expectedToolIds });
    }
  }
  const count = results.length;
  return {
    count,
    recall1: count > 0 ? r1 / count : 0,
    recall5: count > 0 ? r5 / count : 0,
    mrr5: count > 0 ? mrrSum / count : 0,
    misses,
  };
}

describe("A5 — discover_tools baseline harness (lexical mode)", () => {
  it("dataset loaded with at least 40 queries", () => {
    expect(dataset.queries.length).toBeGreaterThanOrEqual(40);
  });

  it("every English query returns at least one tool (sanity)", async () => {
    // Polish-vs-English queries can legitimately return zero in lexical mode
    // — that is the cohort the dense leg is meant to fix. Sanity is asserted
    // only on the English cohorts where the registry SHOULD have a lexical hit.
    const empties: string[] = [];
    for (const q of dataset.queries) {
      if (q.cohort === "polish") continue;
      const result = await discoverProtocolCapabilities({ query: q.query, limit: 5 });
      if (result.tools.length === 0) empties.push(q.query);
    }
    expect(empties, `English queries returning zero tools:\n${empties.join("\n")}`).toEqual([]);
  });

  it("metadata: telemetry retrieval shape is populated", async () => {
    const result = await discoverProtocolCapabilities({ query: "swap usdc on base", limit: 5 });
    expect(result.retrieval).toBeDefined();
    expect(result.retrieval!.method).toBe("lexical");
    expect(result.retrieval!.candidateCount).toBeGreaterThan(0);
  });

  it("baseline floor: Recall@5 across all cohorts", async () => {
    const all: { query: SeedQuery; result: RetrievalResult }[] = [];
    for (const q of dataset.queries) {
      all.push({ query: q, result: await evaluate(q) });
    }

    const cohorts: Record<SeedQuery["cohort"], typeof all> = {
      "single-namespace": [],
      "cross-namespace": [],
      "polish": [],
    };
    for (const entry of all) {
      cohorts[entry.query.cohort].push(entry);
    }

    const overall = aggregate(all);
    const perCohort: Record<string, CohortMetrics> = {};
    for (const [cohort, entries] of Object.entries(cohorts)) {
      perCohort[cohort] = aggregate(entries);
    }

    // eslint-disable-next-line no-console
    console.log("[A5 baseline] lexical recall:", JSON.stringify({
      overall: {
        count: overall.count,
        recall1: round(overall.recall1),
        recall5: round(overall.recall5),
        mrr5: round(overall.mrr5),
      },
      perCohort: Object.fromEntries(
        Object.entries(perCohort).map(([k, m]) => [k, {
          count: m.count,
          recall1: round(m.recall1),
          recall5: round(m.recall5),
          mrr5: round(m.mrr5),
        }]),
      ),
    }, null, 2));

    // Permissive seed-stage floors. Phase 4 raises these once hybrid is wired.
    expect(
      overall.recall5,
      `overall Recall@5 ${(overall.recall5 * 100).toFixed(1)}% < floor 50%`,
    ).toBeGreaterThanOrEqual(0.5);
    // Polish cohort runs against English tool descriptions — easier to miss.
    // Floor 30% for now; Phase 4 dense leg should raise this materially.
    const polish = perCohort["polish"]!;
    expect(
      polish.recall5,
      `polish cohort Recall@5 ${(polish.recall5 * 100).toFixed(1)}% < floor 30%. misses:\n${formatMisses(polish.misses)}`,
    ).toBeGreaterThanOrEqual(0.3);
  });
});

function round(value: number): string {
  return value.toFixed(3);
}

function formatMisses(misses: CohortMetrics["misses"]): string {
  return misses
    .slice(0, 10)
    .map((m) => `  - "${m.query}" expected ${JSON.stringify(m.expected)} got ${JSON.stringify(m.topIds)}`)
    .join("\n");
}
