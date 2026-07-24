/**
 * LLM-as-judge orchestration for the Signals grade.
 *
 * Reuses the SAME main-process inference path the onboarding "verify
 * connection" flow uses (`openrouter-test-client.ts`): the OpenRouter SDK
 * imported through `@vex-lib/openrouter-client.js`, with the vault-injected
 * `OPENROUTER_API_KEY` + `AGENT_MODEL` from `process.env` (the same env the
 * background workers gate on). It makes ONE lightweight, non-streaming chat
 * completion — NOT the mission turn-loop — and parses the compact verdict.
 *
 * FAIL-SOFT by contract: a missing key/model, a network/SDK error, or an
 * unparseable response all return an error `Result` (never throw), so the
 * panel keeps listing the signal ungraded.
 */

import { OpenRouter } from "@vex-lib/openrouter-client.js";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  type SignalGradeResult,
  type SignalListItemDto,
} from "@shared/schemas/signals.js";
import { log } from "../logger/index.js";
import {
  OPENROUTER_APP_TITLE,
  OPENROUTER_APP_URL,
  OPENROUTER_NOOP_LOGGER,
} from "../onboarding/openrouter-app-identity.js";
import {
  JUDGE_MAX_OUTPUT_TOKENS,
  buildJudgeMessages,
  parseGradeResponse,
} from "./grade-judge.js";

const GRADE_TIMEOUT_MS = 20_000;

/** Minimal SDK response shape we read (defensive optional chaining). */
interface ChatSendResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: unknown };
  }>;
}

interface ChatClient {
  readonly chat: {
    readonly send: (
      body: unknown,
      options?: { signal?: AbortSignal; retries?: { strategy: "none" } },
    ) => Promise<unknown>;
  };
}

export interface GradeSignalOptions {
  /** Inject a client for tests. Production omits → real OpenRouter SDK. */
  readonly clientFactory?: (apiKey: string, timeoutMs: number) => ChatClient;
  /** Override timeout for tests. */
  readonly timeoutMs?: number;
  /** Correlation id for log lines. */
  readonly correlationId: string;
}

function defaultClientFactory(apiKey: string, timeoutMs: number): ChatClient {
  return new OpenRouter({
    apiKey,
    debugLogger: OPENROUTER_NOOP_LOGGER,
    retryConfig: { strategy: "none" },
    timeoutMs,
    httpReferer: OPENROUTER_APP_URL,
    appTitle: OPENROUTER_APP_TITLE,
  }) as unknown as ChatClient;
}

function unavailable(
  message: string,
  correlationId: string,
): Result<never, VexError> {
  return err({
    code: "provider.unavailable",
    domain: "signals",
    message,
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  });
}

/**
 * Grade one signal via a single LLM completion. Returns the compact verdict
 * or a fail-soft error Result. The API key + model come from the vault-injected
 * env; when either is absent the grade is simply unavailable (not an error the
 * user must fix mid-session).
 */
export async function gradeSignal(
  features: SignalListItemDto,
  options: GradeSignalOptions,
): Promise<Result<SignalGradeResult, VexError>> {
  const { correlationId } = options;
  const apiKey = process.env["OPENROUTER_API_KEY"];
  const model = process.env["AGENT_MODEL"];
  if (
    typeof apiKey !== "string" ||
    apiKey.length === 0 ||
    typeof model !== "string" ||
    model.length === 0
  ) {
    log.info(
      `[signals:grade] inference unavailable (no key/model) correlationId=${correlationId}`,
    );
    return unavailable(
      "Grading is unavailable until an OpenRouter model is configured.",
      correlationId,
    );
  }

  const timeoutMs = options.timeoutMs ?? GRADE_TIMEOUT_MS;
  const factory = options.clientFactory ?? defaultClientFactory;
  const client = factory(apiKey, timeoutMs);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let response: unknown;
  try {
    response = await client.chat.send(
      {
        chatRequest: {
          model,
          messages: buildJudgeMessages(features),
          maxCompletionTokens: JUDGE_MAX_OUTPUT_TOKENS,
          temperature: 0,
        },
      },
      { signal: ac.signal, retries: { strategy: "none" } },
    );
  } catch (cause) {
    // Never surface raw SDK internals — log the class only.
    const className = cause instanceof Error ? cause.constructor.name : typeof cause;
    log.warn(
      `[signals:grade] inference call failed class=${className} correlationId=${correlationId}`,
    );
    return unavailable(
      "Couldn't reach the grading model. Try again in a moment.",
      correlationId,
    );
  } finally {
    clearTimeout(timer);
  }

  const msg = (response as ChatSendResponse).choices?.[0]?.message;
  const content = typeof msg?.content === "string" ? msg.content : "";
  const parsed = parseGradeResponse(content, features.id);
  if (parsed === null) {
    log.warn(
      `[signals:grade] unparseable verdict correlationId=${correlationId}`,
    );
    return unavailable(
      "The grading model returned an unreadable verdict. Try again.",
      correlationId,
    );
  }
  log.info(
    `[signals:grade] ok id=${features.id} grade=${parsed.grade} ` +
      `verdict=${parsed.verdict} correlationId=${correlationId}`,
  );
  return ok(parsed);
}
