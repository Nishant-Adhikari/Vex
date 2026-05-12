/**
 * Host-side embeddings-runtime readiness probe (M11.5.4).
 *
 * Codex turn 1 RED #4 — compose `healthcheck` cannot assume that the
 * llama.cpp:server image ships `curl`/`wget`/`nc`. Real readiness is
 * verified from Electron main via two host-side HTTP calls:
 *
 *   1. GET /health → 200 OK iff the model has finished loading
 *      (llama.cpp:server returns 503 while loading, 200 once ready).
 *   2. POST /v1/embeddings with a 1-token probe → assert the
 *      returned vector length equals `EMBEDDING_DIM` (768). This
 *      catches the silent regression where the runtime starts in
 *      completion mode (missing `--embeddings`) — /health would
 *      still be 200 but /v1/embeddings would 4xx.
 *
 * Used by `lifecycle.composeUp` after `waitForHealth(db)` returns
 * true. Returns a discriminated union so the caller surfaces the
 * appropriate failure to the renderer (timeout vs. dim mismatch).
 */

import { z } from "zod";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ALIAS,
} from "../onboarding/embedding-defaults.js";
import { log } from "../logger/index.js";

// Zod schema for the trusted subset of the OpenAI-compatible
// `/v1/embeddings` response (codex review turn 2 YELLOW #7-8 —
// replace `as { data: unknown }` casts with a real validation step).
// `.passthrough()` because llama.cpp:server emits extra fields
// (model, usage, etc.) we do not consume but must not reject.
const embeddingsResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            embedding: z.array(z.number()),
          })
          .passthrough()
      )
      .min(1),
  })
  .passthrough();

const HEALTH_PROBE_TIMEOUT_MS = 3_000;
const EMBEDDINGS_PROBE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;
/** Cold start budget: image pull + GGUF download (~333 MB) + model load. */
const DEFAULT_OVERALL_TIMEOUT_MS = 4 * 60_000;

export interface EmbeddingsReadinessOpts {
  readonly embedPort: number;
  readonly signal?: AbortSignal;
  readonly overallTimeoutMs?: number;
  readonly onLogLine?: (stream: "stdout" | "stderr", line: string) => void;
}

export type EmbeddingsReadinessKind =
  | "ready"
  | "timeout"
  | "aborted"
  | "dim_mismatch";

export interface EmbeddingsReadinessResult {
  readonly kind: EmbeddingsReadinessKind;
  readonly attempts: number;
  readonly observedDim: number | null;
  readonly message: string;
}

function withTimeoutAndAbort(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { ac: AbortController; cleanup: () => void } {
  const ac = new AbortController();
  const onAbort = (): void => ac.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  return {
    ac,
    cleanup: () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

async function probeHealth(
  port: number,
  signal: AbortSignal | undefined
): Promise<boolean> {
  const { ac, cleanup } = withTimeoutAndAbort(signal, HEALTH_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "GET",
      signal: ac.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    cleanup();
  }
}

interface EmbeddingsProbeResult {
  readonly ok: boolean;
  readonly dim: number | null;
}

async function probeEmbeddings(
  port: number,
  signal: AbortSignal | undefined
): Promise<EmbeddingsProbeResult> {
  const { ac, cleanup } = withTimeoutAndAbort(
    signal,
    EMBEDDINGS_PROBE_TIMEOUT_MS
  );
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "vex",
        model: EMBEDDING_MODEL_ALIAS,
      }),
    });
    if (!res.ok) return { ok: false, dim: null };
    const payload: unknown = await res.json();
    const parsed = embeddingsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, dim: null };
    }
    const first = parsed.data.data[0];
    if (first === undefined) return { ok: false, dim: null };
    return { ok: true, dim: first.embedding.length };
  } catch {
    return { ok: false, dim: null };
  } finally {
    cleanup();
  }
}

export async function waitForEmbeddingsRuntimeReady(
  opts: EmbeddingsReadinessOpts
): Promise<EmbeddingsReadinessResult> {
  const overallTimeoutMs =
    opts.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
  const deadline = Date.now() + overallTimeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      return {
        kind: "aborted",
        attempts,
        observedDim: null,
        message: "Embeddings probe aborted",
      };
    }
    attempts += 1;
    opts.onLogLine?.(
      "stdout",
      `Embeddings probe #${attempts}: GET /health on 127.0.0.1:${opts.embedPort}…`
    );

    if (await probeHealth(opts.embedPort, opts.signal)) {
      opts.onLogLine?.(
        "stdout",
        "Embeddings /health OK; probing /v1/embeddings…"
      );
      const probe = await probeEmbeddings(opts.embedPort, opts.signal);

      if (probe.ok && probe.dim === EMBEDDING_DIM) {
        opts.onLogLine?.(
          "stdout",
          `Embeddings runtime ready (dim=${probe.dim}, attempts=${attempts})`
        );
        return {
          kind: "ready",
          attempts,
          observedDim: probe.dim,
          message: `Embeddings runtime ready on :${opts.embedPort}`,
        };
      }

      if (probe.ok && probe.dim !== null && probe.dim !== EMBEDDING_DIM) {
        // Hard mismatch: model loaded but produces unexpected vector
        // length. Almost certainly a template ↔ embedding-defaults drift
        // — retrying will not help, fail fast.
        const msg = `Embeddings runtime reports dim=${probe.dim}, expected ${EMBEDDING_DIM}. Compose template and embedding-defaults.ts are out of sync.`;
        opts.onLogLine?.("stderr", msg);
        log.error(`[embeddings-health] ${msg}`);
        return {
          kind: "dim_mismatch",
          attempts,
          observedDim: probe.dim,
          message: msg,
        };
      }

      opts.onLogLine?.(
        "stderr",
        `Embeddings probe #${attempts}: /v1/embeddings not ready yet`
      );
    } else {
      opts.onLogLine?.(
        "stderr",
        `Embeddings probe #${attempts}: /health not yet 200; model still loading or runtime not up`
      );
    }

    await new Promise<void>((resolve) =>
      setTimeout(resolve, POLL_INTERVAL_MS)
    );
  }

  return {
    kind: "timeout",
    attempts,
    observedDim: null,
    message: `Embeddings runtime did not become ready within ${overallTimeoutMs / 60_000} min`,
  };
}
