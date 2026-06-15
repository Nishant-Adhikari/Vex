/**
 * Eval report-card collector (Phase 0).
 *
 * DISK-BACKED accumulator. The eval config runs single-file-at-a-time on the
 * threads pool, which does NOT share module singletons across files — each test
 * file gets its own module instance. So the collector persists its state to a
 * FIXED JSON sidecar in `os.tmpdir()` (the eval globalSetup deletes it once at
 * run start for a clean slate; env-propagated per-run ids do not reliably reach
 * worker threads in Vitest 4, so a fixed path is the robust choice): every
 * record* call loads the prior files' state, merges its own, and persists back.
 * `zz-report.int.test.ts` (sorts last) loads the fully-merged state and writes
 * the markdown to `memory-system/eval-report-latest.md`, then clears the sidecar.
 *
 * Sequential-file execution (`fileParallelism:false`, `maxWorkers:1`) makes the
 * load→merge→persist cycle race-free: only one worker touches the sidecar at a
 * time.
 *
 * PRIVACY: this collector stores ONLY counts, enums, ids, and metrics. It NEVER
 * stores raw candidate text, titles, summaries, or secrets. Helpers below accept
 * only primitive metrics; suites must not pass free text.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const REPORT_PATH = resolve(ROOT, "memory-system/eval-report-latest.md");

/**
 * FIXED sidecar path — the cross-file accumulator (the threads pool isolates
 * module singletons per file). Deliberately NOT keyed by an env-propagated run
 * id: env mutations in the globalSetup main process do NOT reliably reach every
 * worker thread in Vitest 4, so a per-run id would split the accumulator across
 * sidecars. Instead the path is constant and the eval globalSetup DELETES it
 * once at the start of each run (clean slate), so stale data never leaks in and
 * every file shares the one accumulator.
 */
export const REPORT_SIDECAR_PATH = resolve(tmpdir(), "vex-eval-report-card.json");
function sidecarPath(): string {
  return REPORT_SIDECAR_PATH;
}

export interface CheckRow {
  /** Short stable label (no free text from candidates). */
  readonly label: string;
  readonly pass: boolean;
  /** Optional metric note — enums/counts only. */
  readonly note?: string;
}

export interface JudgeSample {
  /** Which suite/scenario produced this judge call. */
  readonly scenario: string;
  readonly llmCalls: number;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  /** Resolved decision type or verdict enum (e.g. "promote", "flip→invalidate"). */
  readonly verdict: string;
}

export interface PrecisionSample {
  readonly k: number;
  readonly precisionAtK: number;
  readonly queries: number;
  readonly relevantHits: number;
}

/**
 * F31 headline metric — one row per judge ESCALATION (the consolidate/reconcile
 * candidate reached the judge). `valid` means the model returned a verdict that
 * passed `judgeVerdictSchema`. `invalidReason` is the bounded failure category
 * when the judge was reached but produced no valid verdict (schema_invalid /
 * judge_timeout / judge_malformed). NEVER carries raw model text.
 */
export type JudgeInvalidReason =
  | "schema_invalid"
  | "judge_timeout"
  | "judge_malformed"
  | "provider_config"
  | "judge_unknown";

export interface JudgeAttemptSample {
  /** Which suite/scenario produced this escalation. */
  readonly scenario: string;
  /** True iff the candidate escalated and a judge call was attempted. */
  readonly reached: boolean;
  /** True iff a verdict validated against judgeVerdictSchema. */
  readonly valid: boolean;
  /** Failure category when reached but not valid; null on a valid verdict. */
  readonly invalidReason: JudgeInvalidReason | null;
}

export interface FindingRow {
  /** Funnel code, e.g. "F1", "F2", "F3", "F5". */
  readonly code: string;
  /** One-line, metrics-only characterization. */
  readonly summary: string;
  /** Whether the baseline empirically demonstrated the bug. */
  readonly manifested: boolean;
}

/**
 * Oracle dimension — which memory behavior the e2e correctness suite (S4/S5)
 * scored this item against the pre-registered independent oracle. Bounded set so
 * the per-dimension table groups cleanly; NEVER carries raw candidate text.
 */
export type OracleDimension =
  | "promotion"
  | "supersession"
  | "graph"
  | "decay"
  | "reconcile"
  | "retrieval"
  | "junk_rejection"
  | "steered_judge";

/**
 * Bounded per-subsystem failure-attribution code (S6 debuggability). Threaded
 * from the runner's terminal captures so a divergence is tagged with the
 * responsible gate instead of a bare "decision=null". STRICTLY enumerated —
 * NEVER free text, never secrets, never candidate content:
 *   - premature_generalization — D7 retained a generalized lesson at recurrence<2.
 *   - no_matched_lot           — reconcile re-resolve found no matched FIFO lot
 *                                (shortfall sell; no realized loss to flip).
 *   - wake_wrong_target        — a same-token wake fan-out claimed a reconcile
 *                                job for a DIFFERENT entry.
 *   - judge_failed             — the live judge (consolidate OR reconcile flip)
 *                                failed F31 (schema_invalid/timeout/malformed),
 *                                so a flip/supersede could not be applied.
 *   - f31_unmeasured           — the item dropped from a soft denominator under
 *                                F31 (judge reached but produced no valid verdict).
 */
export type OracleCauseCode =
  | "premature_generalization"
  | "no_matched_lot"
  | "wake_wrong_target"
  | "judge_failed"
  | "f31_unmeasured";

/**
 * One scored item from the e2e correctness eval: the oracle's `expected`
 * (enum/code/count string) vs the pipeline's `actual`, and whether they agree.
 * Pure metrics — `itemId` is the corpus item id (a stable code, never free
 * text); `expected`/`actual` are short enums/codes; `note` is optional
 * metrics-only context. NEVER stores candidate titles/summaries/secrets.
 */
export interface OracleScoreSample {
  /** Stable corpus item id (e.g. "A-03", "K-01") — never free text. */
  readonly itemId: string;
  readonly dimension: OracleDimension;
  /** Oracle's pre-registered expectation (enum/code/count string). */
  readonly expected: string;
  /** Pipeline's observed result (enum/code/count string). */
  readonly actual: string;
  /** True iff actual satisfies expected (the scorer decides; pure record here). */
  readonly pass: boolean;
  /** Optional metrics-only note — enums/counts only, no candidate text. */
  readonly note?: string;
  /**
   * Optional bounded failure-attribution code (S6). Tags WHY this dimension did
   * not pass so the report can triage per-subsystem. Absent on a clean pass.
   */
  readonly causeCode?: OracleCauseCode;
}

/**
 * The entry-path distribution for a run — which ROUTE each processed item took
 * INTO the pipeline, so a green run's meaning is explicit. These are ENTRY ROUTES,
 * NOT judge-reach claims: a routed item may still terminate deterministically
 * (near-dup / recurrence-first / mundane) before the LLM. The report prints the
 * ACTUAL live-judge reach (from judgeAttempts) beside this split. Bounded buckets
 * (field names are legacy route labels):
 *   - `fullDoorJudge`   — ROUTE door→consolidation: entered the REAL door
 *                         (handleLongMemorySuggest) and proceeded into consolidation.
 *   - `judgeViaCandidate` — ROUTE seeded-candidate→consolidation: a directly-seeded
 *                         Gemma candidate entered consolidation (door bypassed by
 *                         design for recurrence siblings).
 *   - `doorOnlyAdversarial` — an N/O/P/Q/R adversarial item whose terminal IS the
 *                         door (redaction/live-state/English/garbage). Never
 *                         proceeds to consolidation by design.
 *   - `directSeedScaffold` — a residual `seedPromotedLessonDirect` row the judge
 *                         CANNOT bootstrap (a pre-existing aged/superseded/reconcile
 *                         baseline predecessor or graph-cluster owner). Each carries
 *                         a printed scaffold reason.
 */
export interface PathSplitSample {
  readonly suite: string;
  readonly fullDoorJudge: number;
  readonly judgeViaCandidate: number;
  readonly doorOnlyAdversarial: number;
  readonly directSeedScaffold: number;
  /** Item-id → short reason for each residual direct-seed scaffold (honesty). */
  readonly scaffoldReasons: Readonly<Record<string, string>>;
}

interface Section {
  readonly suite: string;
  readonly checks: CheckRow[];
}

/** The serializable shape persisted to the per-run sidecar. */
interface ReportState {
  sections: Section[];
  judge: JudgeSample[];
  judgeAttempts: JudgeAttemptSample[];
  precision: PrecisionSample[];
  findings: FindingRow[];
  oracleScores: OracleScoreSample[];
  pathSplits: PathSplitSample[];
  providerModel: string | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
}

class ReportCard {
  private sections = new Map<string, Section>();
  private judge: JudgeSample[] = [];
  private judgeAttempts: JudgeAttemptSample[] = [];
  private precision: PrecisionSample[] = [];
  private findings: FindingRow[] = [];
  private oracleScores: OracleScoreSample[] = [];
  private pathSplits: PathSplitSample[] = [];
  private providerModel: string | null = null;
  private embeddingModel: string | null = null;
  private embeddingDim: number | null = null;

  /** Load the cross-file accumulated state from the sidecar (best-effort). */
  private load(): void {
    const path = sidecarPath();
    if (!existsSync(path)) return;
    try {
      const raw = readFileSync(path, "utf8");
      const state = JSON.parse(raw) as ReportState;
      this.sections = new Map(state.sections.map((s) => [s.suite, s]));
      this.judge = state.judge;
      this.judgeAttempts = state.judgeAttempts;
      this.precision = state.precision;
      this.findings = state.findings;
      // Backward-compatible: a sidecar written before this field existed has no
      // oracleScores key — default to empty rather than undefined.
      this.oracleScores = state.oracleScores ?? [];
      this.pathSplits = state.pathSplits ?? [];
      this.providerModel = state.providerModel;
      this.embeddingModel = state.embeddingModel;
      this.embeddingDim = state.embeddingDim;
    } catch {
      // Corrupt/partial sidecar — start fresh rather than crash the run.
    }
  }

  /** Persist the merged state back to the sidecar for the next file to inherit. */
  private persist(): void {
    const state: ReportState = {
      sections: [...this.sections.values()],
      judge: this.judge,
      judgeAttempts: this.judgeAttempts,
      precision: this.precision,
      findings: this.findings,
      oracleScores: this.oracleScores,
      pathSplits: this.pathSplits,
      providerModel: this.providerModel,
      embeddingModel: this.embeddingModel,
      embeddingDim: this.embeddingDim,
    };
    writeFileSync(sidecarPath(), JSON.stringify(state), "utf8");
  }

  setProvenance(p: {
    providerModel: string;
    embeddingModel: string;
    embeddingDim: number;
  }): void {
    this.load();
    this.providerModel = p.providerModel;
    this.embeddingModel = p.embeddingModel;
    this.embeddingDim = p.embeddingDim;
    this.persist();
  }

  recordCheck(suite: string, row: CheckRow): void {
    this.load();
    const existing = this.sections.get(suite);
    if (existing) {
      existing.checks.push(row);
    } else {
      this.sections.set(suite, { suite, checks: [row] });
    }
    this.persist();
  }

  recordJudge(sample: JudgeSample): void {
    this.load();
    this.judge.push(sample);
    this.persist();
  }

  /** F31 headline — record ONE judge escalation (reached + valid/invalid). */
  recordJudgeAttempt(sample: JudgeAttemptSample): void {
    this.load();
    this.judgeAttempts.push(sample);
    this.persist();
  }

  /** Aggregate F31 counters for cross-suite assertions (judge reached anywhere). */
  judgeAttemptTotals(): {
    attempted: number;
    schemaValid: number;
    schemaInvalid: number;
    byReason: Record<string, number>;
  } {
    this.load();
    const attempted = this.judgeAttempts.filter((a) => a.reached).length;
    const schemaValid = this.judgeAttempts.filter((a) => a.reached && a.valid).length;
    const schemaInvalid = this.judgeAttempts.filter((a) => a.reached && !a.valid).length;
    const byReason: Record<string, number> = {};
    for (const a of this.judgeAttempts) {
      if (a.reached && !a.valid && a.invalidReason !== null) {
        byReason[a.invalidReason] = (byReason[a.invalidReason] ?? 0) + 1;
      }
    }
    return { attempted, schemaValid, schemaInvalid, byReason };
  }

  recordPrecision(sample: PrecisionSample): void {
    this.load();
    this.precision.push(sample);
    this.persist();
  }

  recordFinding(row: FindingRow): void {
    this.load();
    this.findings.push(row);
    this.persist();
  }

  /**
   * Record ONE oracle-vs-pipeline score from the e2e correctness eval (S4/S5).
   * Pure push+persist — NO expect/throw (the scoring lane must never red the
   * suite; the hard structural gates are expect()-ed by the suite itself, this
   * collector only accumulates the scored metrics). Stores only the item id +
   * dimension + short expected/actual codes + pass bit; never candidate text.
   */
  recordOracleScore(entry: OracleScoreSample): void {
    this.load();
    this.oracleScores.push(entry);
    this.persist();
  }

  /**
   * Record the entry-path distribution for a run (honest path-split). One sample
   * per suite; the render prints how many items reached the pipeline via each
   * bounded path so a green run's MEANING is explicit (how much went through the
   * real door+judge vs. residual scaffold). Pure metrics — item ids + counts.
   */
  recordPathSplit(sample: PathSplitSample): void {
    this.load();
    this.pathSplits.push(sample);
    this.persist();
  }

  /**
   * Render the dated run section, write it to the report path, and CLEAR the
   * sidecar (the run is done — the next run's globalSetup also clears it).
   */
  flush(timestampMs: number): string {
    this.load();
    const md = this.render(timestampMs);
    writeFileSync(REPORT_PATH, md, "utf8");
    try {
      rmSync(sidecarPath(), { force: true });
    } catch {
      // Best-effort cleanup — a leftover tmp sidecar is harmless.
    }
    return md;
  }

  /** Render without writing (for assertions / debugging). */
  render(timestampMs: number): string {
    this.load();
    const ts = new Date(timestampMs).toISOString();
    const lines: string[] = [];
    lines.push("# Memory System — Live Eval Report (latest)");
    lines.push("");
    lines.push(`## Run ${ts}`);
    lines.push("");
    lines.push("### Provenance");
    lines.push("");
    lines.push(`- judge provider model: \`${process.env.AGENT_MODEL ?? "unknown"}\``);
    lines.push(`- embedding provider model (returned): \`${this.providerModel ?? "unknown"}\``);
    lines.push(`- embedding model (configured): \`${this.embeddingModel ?? "unknown"}\``);
    lines.push(`- embedding dim: \`${this.embeddingDim ?? "unknown"}\``);
    lines.push("");

    // F31 HEADLINE — judge output-valid rate.
    lines.push("### F31 headline — judge output-valid rate");
    lines.push("");
    const t = this.judgeAttemptTotals();
    const model = process.env.AGENT_MODEL ?? "unknown";
    if (t.attempted === 0) {
      lines.push(
        `_no judge escalations recorded — the judge was never reached (this is itself a finding; see funnel F32)._`,
      );
    } else {
      const ratePct = Math.round((t.schemaValid / t.attempted) * 100);
      const reasonStr =
        Object.keys(t.byReason).length === 0
          ? "n/a"
          : Object.entries(t.byReason)
              .sort((a, b) => b[1] - a[1])
              .map(([r, n]) => `${r}=${n}`)
              .join(", ");
      lines.push(
        `**F31 manifests: judge output-valid rate = ${ratePct}% ` +
          `(${t.schemaValid}/${t.attempted} valid) with model=\`${model}\`.**`,
      );
      lines.push("");
      lines.push("| metric | count |");
      lines.push("| --- | ---: |");
      lines.push(`| judgeCallsAttempted (escalations reaching the judge) | ${t.attempted} |`);
      lines.push(`| judgeCallsSchemaValid | ${t.schemaValid} |`);
      lines.push(`| judgeCallsSchemaInvalid | ${t.schemaInvalid} |`);
      lines.push(`| invalid reasons | ${reasonStr} |`);
      lines.push("");
      lines.push("Per-escalation:");
      lines.push("");
      lines.push("| scenario | reached | valid | invalidReason |");
      lines.push("| --- | --- | --- | --- |");
      for (const a of this.judgeAttempts) {
        lines.push(
          `| ${a.scenario} | ${a.reached ? "yes" : "no"} | ${a.valid ? "yes" : "no"} | ${a.invalidReason ?? "—"} |`,
        );
      }
    }
    lines.push("");

    // ── Entry-path distribution (honest path-split). What a green run MEANS. ──
    lines.push("### Entry-path distribution (how each item reached the pipeline)");
    lines.push("");
    if (this.pathSplits.length === 0) {
      lines.push("_no path-split recorded_");
    } else {
      lines.push(
        "| suite | door→consolidation | seeded-candidate→consolidation | door-only adversarial | residual direct-seed scaffold |",
      );
      lines.push("| --- | ---: | ---: | ---: | ---: |");
      for (const p of this.pathSplits) {
        lines.push(
          `| ${p.suite} | ${p.fullDoorJudge} | ${p.judgeViaCandidate} | ${p.doorOnlyAdversarial} | ${p.directSeedScaffold} |`,
        );
      }
      // ROUTE buckets, NOT judge-reach. A `door→consolidation` / `seeded-candidate→
      // consolidation` item enters the real consolidation pipeline but MAY
      // deterministically terminate (near-dup / recurrence-first / mundane) before the
      // LLM. Print the ACTUAL live-judge reach so the split is never mis-read.
      const judgeReachedN = this.judgeAttempts.filter((a) => a.reached).length;
      const judgeValidN = this.judgeAttempts.filter((a) => a.valid).length;
      lines.push("");
      lines.push(
        `Routes are entry-points, NOT judge reach. Of the consolidation-routed items, ` +
          `**${judgeReachedN} actually reached the live judge** (${judgeValidN} returned a valid verdict); ` +
          `the rest terminated deterministically before the LLM.`,
      );
      // Residual direct-seed scaffold reasons (each a scaffold precondition the live
      // judge genuinely cannot bootstrap — surfaced loudly, never silent).
      const reasonRows = this.pathSplits.flatMap((p) =>
        Object.entries(p.scaffoldReasons).map(([id, reason]) => ({ id, reason })),
      );
      if (reasonRows.length > 0) {
        lines.push("");
        lines.push("Residual direct-seed scaffold (scaffold reason):");
        lines.push("");
        lines.push("| item | reason (why the judge cannot bootstrap this precondition) |");
        lines.push("| --- | --- |");
        for (const r of reasonRows) lines.push(`| ${r.id} | ${r.reason} |`);
      }
    }
    lines.push("");

    // Per-dimension pass-rate table.
    lines.push("### Per-dimension pass-rate");
    lines.push("");
    lines.push("| suite | checks | passed | pass-rate |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const section of this.sortedSections()) {
      const total = section.checks.length;
      const passed = section.checks.filter((c) => c.pass).length;
      const rate = total === 0 ? "n/a" : `${Math.round((passed / total) * 100)}%`;
      lines.push(`| ${section.suite} | ${total} | ${passed} | ${rate} |`);
    }
    lines.push("");

    // Per-check detail.
    for (const section of this.sortedSections()) {
      lines.push(`#### ${section.suite}`);
      lines.push("");
      for (const c of section.checks) {
        const mark = c.pass ? "PASS" : "FAIL";
        const note = c.note ? ` — ${c.note}` : "";
        lines.push(`- [${mark}] ${c.label}${note}`);
      }
      lines.push("");
    }

    // Judge metrics.
    lines.push("### Judge (live DeepSeek via OpenRouter)");
    lines.push("");
    if (this.judge.length === 0) {
      lines.push("_no judge calls recorded_");
    } else {
      lines.push("| scenario | llmCalls | costUsd | latencyMs | verdict |");
      lines.push("| --- | ---: | ---: | ---: | --- |");
      for (const j of this.judge) {
        const cost = j.costUsd === null ? "null" : j.costUsd.toFixed(6);
        lines.push(
          `| ${j.scenario} | ${j.llmCalls} | ${cost} | ${j.latencyMs} | ${j.verdict} |`,
        );
      }
      const totalCalls = this.judge.reduce((a, j) => a + j.llmCalls, 0);
      const costs = this.judge
        .map((j) => j.costUsd)
        .filter((c): c is number => c !== null);
      const totalCost = costs.reduce((a, c) => a + c, 0);
      const latencies = this.judge.map((j) => j.latencyMs);
      const avgLatency =
        latencies.length === 0
          ? 0
          : Math.round(latencies.reduce((a, l) => a + l, 0) / latencies.length);
      lines.push("");
      lines.push(
        `- total llmCalls: ${totalCalls}; cost samples: ${costs.length}/${this.judge.length}; ` +
          `total cost (where reported): ${totalCost.toFixed(6)}; avg latency: ${avgLatency}ms`,
      );
    }
    lines.push("");

    // Precision@k.
    lines.push("### Retrieval precision@k (real Gemma corpus)");
    lines.push("");
    if (this.precision.length === 0) {
      lines.push("_no precision samples recorded_");
    } else {
      lines.push("| k | queries | relevantHits | precision@k |");
      lines.push("| ---: | ---: | ---: | ---: |");
      for (const p of this.precision) {
        lines.push(
          `| ${p.k} | ${p.queries} | ${p.relevantHits} | ${p.precisionAtK.toFixed(3)} |`,
        );
      }
    }
    lines.push("");

    // Funnel findings.
    lines.push("### Funnel findings (baseline characterization)");
    lines.push("");
    if (this.findings.length === 0) {
      lines.push("_no findings recorded_");
    } else {
      lines.push("| code | manifested | summary |");
      lines.push("| --- | --- | --- |");
      for (const f of this.findings) {
        lines.push(`| ${f.code} | ${f.manifested ? "YES" : "no"} | ${f.summary} |`);
      }
    }
    lines.push("");

    // Oracle scoring (e2e correctness — pipeline vs pre-registered oracle).
    lines.push("### Oracle scoring (e2e correctness vs pre-registered oracle)");
    lines.push("");
    if (this.oracleScores.length === 0) {
      lines.push("_no oracle scores recorded_");
    } else {
      // Per-dimension pass/total counts (stable dimension order).
      const byDimension = new Map<string, { passed: number; total: number }>();
      for (const s of this.oracleScores) {
        const agg = byDimension.get(s.dimension) ?? { passed: 0, total: 0 };
        agg.total += 1;
        if (s.pass) agg.passed += 1;
        byDimension.set(s.dimension, agg);
      }
      lines.push("| dimension | scored | passed | pass-rate |");
      lines.push("| --- | ---: | ---: | ---: |");
      for (const [dimension, agg] of [...byDimension.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        const rate =
          agg.total === 0 ? "n/a" : `${Math.round((agg.passed / agg.total) * 100)}%`;
        lines.push(`| ${dimension} | ${agg.total} | ${agg.passed} | ${rate} |`);
      }
      const totalScored = this.oracleScores.length;
      const totalPassed = this.oracleScores.filter((s) => s.pass).length;
      lines.push("");
      lines.push(
        `- total scored: ${totalScored}; passed: ${totalPassed}; ` +
          `overall: ${Math.round((totalPassed / totalScored) * 100)}%`,
      );

      // ── Per-subsystem failure attribution (S6 cause-codes). ──
      const byCause = new Map<string, number>();
      for (const s of this.oracleScores) {
        if (s.causeCode !== undefined) {
          byCause.set(s.causeCode, (byCause.get(s.causeCode) ?? 0) + 1);
        }
      }
      lines.push("");
      lines.push("#### Per-subsystem failure attribution (cause-codes)");
      lines.push("");
      if (byCause.size === 0) {
        lines.push("_no cause-coded divergences recorded_");
      } else {
        lines.push("| causeCode | count | items |");
        lines.push("| --- | ---: | --- |");
        for (const [cause, count] of [...byCause.entries()].sort((a, b) => b[1] - a[1])) {
          const items = this.oracleScores
            .filter((s) => s.causeCode === cause)
            .map((s) => s.itemId)
            .join(", ");
          lines.push(`| ${cause} | ${count} | ${items} |`);
        }
      }

      // ── F31 unmeasured headline. Count the ROOT cause: judge calls that reached
      // the LLM but returned an INVALID verdict. Those items' soft dimensions
      // (promotion/graph/junk/supersession) are dropped from — or cause-coded in —
      // their denominators, so they are genuinely UNMEASURED. (Counting only
      // `f31_unmeasured` oracle rows under-reports: several dimensions silently skip
      // an invalid verdict instead of recording a row.)
      const f31Invalid = this.judgeAttempts.filter((a) => a.reached && !a.valid).length;
      const f31UnmeasuredRows = this.oracleScores.filter(
        (s) => s.causeCode === "f31_unmeasured",
      ).length;
      lines.push("");
      lines.push(
        `- F31 unmeasured: **${f31Invalid}** judge call(s) reached the LLM but returned an INVALID ` +
          `verdict → those items' soft dimensions were dropped from / cause-coded in their ` +
          `denominators (${f31UnmeasuredRows} explicitly recorded as \`f31_unmeasured\`; ` +
          `${totalScored} dimensions scored total).`,
      );
    }
    lines.push("");

    return lines.join("\n");
  }

  private sortedSections(): Section[] {
    return [...this.sections.values()].sort((a, b) =>
      a.suite.localeCompare(b.suite),
    );
  }
}

/** Process-singleton — shared across every suite in a serialized eval run. */
export const reportCard = new ReportCard();

export { REPORT_PATH };
