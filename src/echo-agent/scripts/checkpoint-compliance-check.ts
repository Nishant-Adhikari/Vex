/**
 * checkpoint-compliance-check — standalone CLI verifying that the PR2
 * extract.ts / merge.ts prompts produce compliant JSON against a real LLM.
 *
 * NOT in CI — pays per run and needs an external API key. Operator runs
 * this after every change to the checkpoint prompts (or before a release)
 * and reads the Recommendation section of the generated markdown report.
 *
 * Usage:
 *   pnpm run check-checkpoint-compliance -- --api-key=sk-or-v1-... --model=anthropic/claude-sonnet-4
 *
 * Env fallbacks (CLI args take precedence):
 *   OPENROUTER_API_KEY   → --api-key
 *   CHECKPOINT_MODEL     → --model
 *   OPENROUTER_BASE_URL  → --base-url   (default https://openrouter.ai/api/v1)
 *   BENCHMARK_OUTPUT_PATH → --out        (default docs/benchmarks/checkpoint-compliance.md)
 *
 * Scenarios per prefix (six curated prefixes in /checkpoint-compliance-fixtures.ts):
 *   A — extractEpisodes with currentCode=null
 *       LLM should infer language and include session_language_inferred + title per episode.
 *   B — extractEpisodes with currentCode=<explicit>
 *       LLM should pin output to the explicit code and set session_language_inferred accordingly.
 *   C — summarizePrefix with currentCode=<explicit>
 *       Rolling summary should be in the explicit language; no English preamble when target ≠ en.
 *
 * Each scenario contributes pass/fail rows to the report; the Recommendation
 * section defaults to `prompt needs revision` if any strict check failed,
 * `proceed` otherwise.
 */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  InferenceConfig,
  InferenceProvider,
  InferenceResponse,
  InferenceUsage,
  ProviderBalance,
  ProviderMessage,
  RequestCost,
  StreamChunk,
  ToolDefinition,
} from "@echo-agent/inference/types.js";
import { extractEpisodes, type ExtractionResult } from "@echo-agent/engine/checkpoint/extract.js";
import { summarizePrefix } from "@echo-agent/engine/checkpoint/merge.js";
import logger from "@utils/logger.js";

import { COMPLIANCE_PREFIXES, type CompliancePrefix } from "./checkpoint-compliance-fixtures.js";

// ── CLI arg parsing ──────────────────────────────────────────────────

interface CliArgs {
  apiKey: string;
  model: string;
  baseUrl: string;
  outputPath: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) continue;
    flags.set(arg.slice(2, eq), arg.slice(eq + 1));
  }
  const apiKey = (flags.get("api-key") ?? process.env.OPENROUTER_API_KEY ?? "").trim();
  const model = (flags.get("model") ?? process.env.CHECKPOINT_MODEL ?? "").trim();
  const baseUrl = (
    flags.get("base-url") ??
    process.env.OPENROUTER_BASE_URL ??
    "https://openrouter.ai/api/v1"
  ).replace(/\/$/, "");
  const outputPath = resolve(
    flags.get("out") ??
      process.env.BENCHMARK_OUTPUT_PATH ??
      "docs/benchmarks/checkpoint-compliance.md",
  );

  if (!apiKey) {
    throw new Error(
      "Missing API key. Pass --api-key=sk-... or set OPENROUTER_API_KEY.",
    );
  }
  if (!model) {
    throw new Error(
      "Missing model. Pass --model=<provider/model> or set CHECKPOINT_MODEL.",
    );
  }
  return { apiKey, model, baseUrl, outputPath };
}

// ── Minimal OpenRouter-compatible provider ───────────────────────────

class ComplianceProvider implements InferenceProvider {
  readonly id = "compliance";
  readonly displayName = "Compliance CLI provider";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async loadConfig(): Promise<InferenceConfig | null> {
    return buildConfig(this.model);
  }

  async chatCompletionSimple(
    messages: ProviderMessage[],
    _config: InferenceConfig,
  ): Promise<{ content: string; usage: InferenceUsage }> {
    const body = {
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: 0,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/EchoClaw-Labs/EchoClaw",
        "X-Title": "EchoClaw checkpoint compliance",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `provider returned ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const content = json.choices?.[0]?.message?.content ?? "";
    const usage: InferenceUsage = {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      totalTokens: json.usage?.total_tokens ?? 0,
    };
    return { content, usage };
  }

  // Unused by extract/merge but required by the interface.
  async chatCompletion(
    _messages: ProviderMessage[],
    _tools: ToolDefinition[],
    _config: InferenceConfig,
  ): Promise<InferenceResponse> {
    throw new Error("compliance provider: chatCompletion not used");
  }

  async *chatCompletionStream(
    _messages: ProviderMessage[],
    _tools: ToolDefinition[],
    _config: InferenceConfig,
  ): AsyncGenerator<StreamChunk> {
    throw new Error("compliance provider: chatCompletionStream not used");
  }

  async getBalance(): Promise<ProviderBalance | null> {
    return null;
  }

  calculateCost(_usage: InferenceUsage, _config: InferenceConfig): RequestCost {
    return {
      totalCost: 0,
      currency: "USD",
      breakdown: {
        promptCost: 0,
        completionCost: 0,
        cachedSavings: 0,
        reasoningCost: 0,
      },
    };
  }
}

function buildConfig(model: string): InferenceConfig {
  return {
    provider: "compliance",
    model,
    contextLimit: 200_000,
    maxOutputTokens: 4096,
    inputPricePerM: 0,
    outputPricePerM: 0,
    priceCurrency: "USD",
    cachePricePerM: null,
    reasoningPricePerM: null,
  };
}

// ── Pass criteria ────────────────────────────────────────────────────

const LANG_CODE_RE = /^([a-z]{2,3}(-[A-Z]{2})?|und)$/;
const TITLE_MAX_CHARS = 100;

interface EpisodeCheck {
  index: number;
  episodeKind: string;
  titleOk: boolean;
  titleChars: number;
  summaryOk: boolean;
  notes: string[];
}

interface ExtractionCheck {
  scenario: "A" | "B";
  prefixId: string;
  expectedLang: string;
  requestedCode: string | null;
  receivedLangInferred: string;
  langInferredOk: boolean;
  languageSanityWarn: string | null;
  episodes: EpisodeCheck[];
  rawJson: string;
  error: string | null;
}

interface MergeCheck {
  scenario: "C";
  prefixId: string;
  expectedLang: string;
  requestedCode: string | null;
  outputPreview: string;
  outputLengthOk: boolean;
  noEnglishPreambleWhenNonEn: boolean;
  rawOutput: string;
  error: string | null;
}

type ScenarioResult = ExtractionCheck | MergeCheck;

function checkExtraction(
  prefixId: string,
  expectedLang: string,
  requestedCode: string | null,
  result: ExtractionResult,
  rawJson: string,
): ExtractionCheck {
  const episodes: EpisodeCheck[] = result.episodes.map((ep, index) => {
    const notes: string[] = [];
    const titleTrimmed = ep.title.trim();
    const titleChars = titleTrimmed.length;
    const titleOk = titleChars > 0 && titleChars <= TITLE_MAX_CHARS;
    if (!titleOk) {
      if (titleChars === 0) notes.push("title empty");
      else if (titleChars > TITLE_MAX_CHARS) notes.push(`title too long (${titleChars} chars)`);
    }
    const summaryOk = ep.summaryText.trim().length > 0;
    if (!summaryOk) notes.push("summary_text empty");
    return { index, episodeKind: ep.episodeKind, titleOk, titleChars, summaryOk, notes };
  });

  const received = result.sessionLanguageInferred;
  const langInferredOk = LANG_CODE_RE.test(received);

  let sanityWarn: string | null = null;
  if (requestedCode === null) {
    // Scenario A — warn only if LLM picked a wildly different language.
    if (expectedLang !== "und" && received && received !== expectedLang) {
      sanityWarn = `expected ~${expectedLang}, LLM inferred ${received}`;
    }
  } else {
    // Scenario B — strict: LLM must confirm the explicit code.
    if (received !== requestedCode) {
      sanityWarn = `explicit code ${requestedCode} not confirmed (LLM returned ${received})`;
    }
  }

  return {
    scenario: requestedCode === null ? "A" : "B",
    prefixId,
    expectedLang,
    requestedCode,
    receivedLangInferred: received,
    langInferredOk,
    languageSanityWarn: sanityWarn,
    episodes,
    rawJson,
    error: null,
  };
}

/**
 * Quick heuristic for scenario C: if the target language is NOT English and
 * the merge output starts with an obvious English preamble, the LLM probably
 * didn't honour the language directive. Keep the list short — this is just a
 * sanity check, not a translator.
 */
const EN_PREAMBLES = [
  /^here is the summary/i,
  /^summary:/i,
  /^rolling summary:/i,
  /^the user /i,
];

function checkMerge(
  prefixId: string,
  expectedLang: string,
  requestedCode: string | null,
  rawOutput: string,
): MergeCheck {
  const outputLengthOk = rawOutput.trim().length > 20;
  const targetIsEnglish =
    requestedCode === "en" || (requestedCode === null && expectedLang === "en");
  let noEnglishPreambleWhenNonEn = true;
  if (!targetIsEnglish) {
    noEnglishPreambleWhenNonEn = !EN_PREAMBLES.some((re) => re.test(rawOutput.trimStart()));
  }
  const preview = rawOutput.trim().slice(0, 240);
  return {
    scenario: "C",
    prefixId,
    expectedLang,
    requestedCode,
    outputPreview: preview,
    outputLengthOk,
    noEnglishPreambleWhenNonEn,
    rawOutput,
    error: null,
  };
}

function scenarioPass(r: ScenarioResult): boolean {
  if (r.error) return false;
  if (r.scenario === "C") {
    return r.outputLengthOk && r.noEnglishPreambleWhenNonEn;
  }
  if (!r.langInferredOk) return false;
  if (r.scenario === "B" && r.languageSanityWarn !== null) return false;
  // Every episode must have title + summary_text.
  return r.episodes.every((ep) => ep.titleOk && ep.summaryOk);
}

// ── Report rendering ─────────────────────────────────────────────────

function buildReport(
  config: { model: string; baseUrl: string; runStartedAt: string; runFinishedAt: string },
  results: readonly ScenarioResult[],
): string {
  const totalPass = results.filter(scenarioPass).length;
  const total = results.length;
  const verdict = totalPass === total ? "proceed" : "prompt needs revision";

  const rows = results.map((r) => {
    const pass = scenarioPass(r);
    if (r.scenario === "C") {
      const mergeNote = r.error
        ? `ERROR: ${r.error}`
        : !r.outputLengthOk
          ? "output too short"
          : !r.noEnglishPreambleWhenNonEn
            ? "English preamble detected on non-EN target"
            : "ok";
      return `| ${r.prefixId} | ${r.expectedLang} | C | ${r.requestedCode ?? "—"} | — | — | ${pass ? "PASS" : "FAIL"} | ${mergeNote} |`;
    }
    const titleFails = r.episodes.filter((ep) => !ep.titleOk).length;
    const summaryFails = r.episodes.filter((ep) => !ep.summaryOk).length;
    const langInferredCell = r.langInferredOk ? r.receivedLangInferred : `BAD (${r.receivedLangInferred || "empty"})`;
    const episodeCell = `${r.episodes.length}ep / ${titleFails}tf / ${summaryFails}sf`;
    const warnCell = r.error ? `ERROR: ${r.error}` : r.languageSanityWarn ?? "ok";
    return `| ${r.prefixId} | ${r.expectedLang} | ${r.scenario} | ${r.requestedCode ?? "—"} | ${langInferredCell} | ${episodeCell} | ${pass ? "PASS" : "FAIL"} | ${warnCell} |`;
  });

  const failSamples = results
    .filter((r) => !scenarioPass(r))
    .map((r) => renderFailSample(r));

  return `# Checkpoint LLM compliance report

**Run started:**  ${config.runStartedAt}
**Run finished:** ${config.runFinishedAt}
**Model:**        ${config.model}
**Base URL:**     ${config.baseUrl}
**Scenarios:**    ${total} (6 prefixes × 3 scenarios each — A/B extract + C merge)

## Scenario matrix

| Prefix | Expected lang | Scenario | Requested code | Lang inferred | Episodes / title fails / summary fails | Result | Notes |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

**Overall:** ${totalPass}/${total} scenarios pass.

## Recommendation

**Verdict:** \`${verdict}\`

**Rationale:** ${
    verdict === "proceed"
      ? "All " +
        total +
        " scenarios pass every strict check (title present and ≤100 chars per episode, session_language_inferred matches the regex, explicit codes confirmed by the LLM, non-English merges produced without an English preamble). The PR2 prompts are compliant with the contract against this model."
      : "At least one strict check failed — inspect the Failure samples section below, adjust the extract.ts / merge.ts prompts, then rerun. Cost of rerun ≈ same as first run."
  }

## Failure samples

${
    failSamples.length > 0
      ? failSamples.join("\n\n---\n\n")
      : "_All scenarios passed — nothing to show._"
  }

## Methodology

- Six curated multilingual prefixes (en, pl, fr, zh, vi, mixed).
- Scenario A: \`extractEpisodes(prefix, provider, config, null)\` — LLM must infer \`session_language_inferred\` and emit \`title\` per episode.
- Scenario B: \`extractEpisodes(prefix, provider, config, <explicit>)\` — LLM must confirm the explicit code and keep output in that language.
- Scenario C: \`summarizePrefix(prefix, null, provider, config, <explicit>)\` — merge output must be in the pinned language (no English preamble when target ≠ en).
- Strict criteria: title non-empty + ≤100 chars; summary_text non-empty; session_language_inferred regex \`^([a-z]{2,3}(-[A-Z]{2})?|und)$\`; scenario B requires explicit code confirmation.
- Model cost per run is small (6 prefixes × 3 scenarios ≈ 18 short calls). Re-run freely after prompt changes.

## Next steps if verdict is \`proceed\`

- Commit the model name and date into your rollout checklist so you know which model was certified against the prompt.
- Re-run with a cheaper / faster model as a periodic regression check.

## Next steps if verdict is \`prompt needs revision\`

- Read the failure samples below for the raw LLM output.
- Tighten the directive in \`src/echo-agent/engine/checkpoint/extract.ts\` or \`merge.ts\` — common causes: LLM omits \`title\`, returns the explicit code in a different casing, or adds "Here is the summary:" preamble.
- Re-run this CLI.
`;
}

function renderFailSample(r: ScenarioResult): string {
  const header = `### ${r.prefixId} · scenario ${r.scenario} · requested code \`${r.requestedCode ?? "null"}\``;
  if (r.scenario === "C") {
    return `${header}

${r.error ? `Error: \`${r.error}\`\n\n` : ""}Output preview (first 240 chars):
\`\`\`
${r.outputPreview || "(empty)"}
\`\`\`

Full raw output:
\`\`\`
${(r.rawOutput || "(empty)").slice(0, 1200)}
\`\`\``;
  }
  const epLines = r.episodes.map(
    (ep) =>
      `  - #${ep.index} kind=${ep.episodeKind} title_chars=${ep.titleChars} title_ok=${ep.titleOk} summary_ok=${ep.summaryOk}${ep.notes.length ? ` · ${ep.notes.join(", ")}` : ""}`,
  );
  return `${header}

${r.error ? `Error: \`${r.error}\`\n\n` : ""}\`session_language_inferred\`: \`${r.receivedLangInferred || "(empty)"}\` · regex_ok=${r.langInferredOk}${r.languageSanityWarn ? ` · sanity: ${r.languageSanityWarn}` : ""}

Episodes (${r.episodes.length}):
${epLines.join("\n") || "  (no episodes returned)"}

Raw JSON:
\`\`\`json
${r.rawJson.slice(0, 1500)}
\`\`\``;
}

// ── Orchestration ────────────────────────────────────────────────────

async function runComplianceSuite(args: CliArgs): Promise<void> {
  const runStartedAt = new Date().toISOString();
  const provider = new ComplianceProvider(args.apiKey, args.model, args.baseUrl);
  const config = buildConfig(args.model);

  logger.info("compliance.start", {
    model: args.model,
    baseUrl: args.baseUrl,
    prefixes: COMPLIANCE_PREFIXES.length,
  });

  const results: ScenarioResult[] = [];

  for (const prefix of COMPLIANCE_PREFIXES) {
    logger.info("compliance.prefix.start", {
      id: prefix.id,
      label: prefix.label,
      expectedLang: prefix.expectedLang,
      messages: prefix.messages.length,
    });

    // ── Scenario A — null currentCode ────────────────────────────
    try {
      const a = await extractEpisodes(prefix.messages, provider, config, null);
      results.push(checkExtraction(prefix.id, prefix.expectedLang, null, a, JSON.stringify(a)));
    } catch (err) {
      results.push(makeErrorExtractionResult(prefix, "A", null, err));
    }

    // ── Scenario B — explicit code ───────────────────────────────
    const explicitCode = pickExplicitCode(prefix);
    try {
      const b = await extractEpisodes(prefix.messages, provider, config, explicitCode);
      results.push(checkExtraction(prefix.id, prefix.expectedLang, explicitCode, b, JSON.stringify(b)));
    } catch (err) {
      results.push(makeErrorExtractionResult(prefix, "B", explicitCode, err));
    }

    // ── Scenario C — merge ───────────────────────────────────────
    try {
      const c = await summarizePrefix(prefix.messages, null, provider, config, explicitCode);
      results.push(checkMerge(prefix.id, prefix.expectedLang, explicitCode, c));
    } catch (err) {
      results.push(makeErrorMergeResult(prefix, explicitCode, err));
    }
  }

  const runFinishedAt = new Date().toISOString();
  const report = buildReport(
    { model: args.model, baseUrl: args.baseUrl, runStartedAt, runFinishedAt },
    results,
  );
  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, report, "utf-8");

  const passed = results.filter(scenarioPass).length;
  const total = results.length;
  logger.info("compliance.done", {
    outputPath: args.outputPath,
    passed,
    total,
    recall1Pct: Number(((passed / total) * 100).toFixed(1)),
    verdict: passed === total ? "proceed" : "prompt needs revision",
  });
}

function pickExplicitCode(prefix: CompliancePrefix): string {
  // "und" prefixes use "und" as the explicit code so scenario B tests the
  // "session marked undetermined" branch of the prompt.
  return prefix.expectedLang;
}

function makeErrorExtractionResult(
  prefix: CompliancePrefix,
  scenario: "A" | "B",
  requestedCode: string | null,
  err: unknown,
): ExtractionCheck {
  return {
    scenario,
    prefixId: prefix.id,
    expectedLang: prefix.expectedLang,
    requestedCode,
    receivedLangInferred: "",
    langInferredOk: false,
    languageSanityWarn: null,
    episodes: [],
    rawJson: "",
    error: err instanceof Error ? err.message : String(err),
  };
}

function makeErrorMergeResult(
  prefix: CompliancePrefix,
  requestedCode: string | null,
  err: unknown,
): MergeCheck {
  return {
    scenario: "C",
    prefixId: prefix.id,
    expectedLang: prefix.expectedLang,
    requestedCode,
    outputPreview: "",
    outputLengthOk: false,
    noEnglishPreambleWhenNonEn: false,
    rawOutput: "",
    error: err instanceof Error ? err.message : String(err),
  };
}

// ── CLI entry ────────────────────────────────────────────────────────

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    runComplianceSuite(args)
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error("compliance.failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}
