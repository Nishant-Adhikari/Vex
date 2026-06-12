/**
 * Eval: report-card writer (sorts LAST — `zz-` prefix).
 *
 * Because the eval config runs single-worker / one file at a time, the
 * `reportCard` singleton has accumulated every prior suite's checks/judge/
 * precision/findings by the time this file runs. Its `afterAll` stamps the
 * provenance (real Gemma providerModel + dim) and writes the dated section to
 * `memory-system/eval-report-latest.md`.
 *
 * NEVER includes raw candidate text or secrets — counts, enums, ids, metrics
 * only (enforced by the collector's typed API).
 */

import { describe, it, expect, afterAll } from "vitest";

import { embedDocument } from "@vex-agent/embeddings/client.js";
import { reportCard, REPORT_PATH } from "./_report-card.js";
import { GEMMA_DIM } from "./_eval-fixtures.js";

const hasKey = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!hasKey)("eval: report card writer", () => {
  afterAll(async () => {
    // Resolve the real provider model string from a live embed call.
    let providerModel = process.env.EMBEDDING_MODEL ?? "unknown";
    let dim = GEMMA_DIM;
    try {
      const probe = await embedDocument("report", "provenance probe");
      providerModel = probe.providerModel;
      dim = probe.embedding.length;
    } catch {
      // Best-effort — fall back to configured values.
    }
    reportCard.setProvenance({
      providerModel,
      embeddingModel: process.env.EMBEDDING_MODEL ?? "unknown",
      embeddingDim: dim,
    });
    const md = reportCard.flush(Date.now());
    const totals = reportCard.judgeAttemptTotals();
    // eslint-disable-next-line no-console
    console.log(
      `[eval] report card written to ${REPORT_PATH} (${md.length} chars). ` +
        `judge attempted=${totals.attempted} valid=${totals.schemaValid} invalid=${totals.schemaInvalid}.`,
    );
  });

  it("the judge was REACHED at least once across the run (judge-path proof)", () => {
    // Cross-suite invariant: the judge-path suites MUST have escalated to the
    // real judge (a call was attempted) — otherwise the F31 measurement is
    // vacuous. This is asserted here because the singleton has every suite's
    // attempts by the time this file (zz-) runs last.
    const totals = reportCard.judgeAttemptTotals();
    expect(totals.attempted).toBeGreaterThan(0);
  });
});
