/**
 * vex.onboarding.embeddingConfigure — Wizard Step 4 IPC handler (M9).
 *
 * Validates baseUrl / model / dim / provider via Zod, runs the
 * writer inside `withEnvWriteLock`. The writer skips the dim-lock
 * DB query when the new dim equals the existing one (codex turn 3
 * D7 fix — no over-blocking on URL/model/provider-only edits).
 *
 * Returned errors:
 *   - validation.invalid_input — malformed URL / out-of-range dim /
 *     missing fields
 *   - embedding.dim_locked — knowledge_entries already use a
 *     different dim; details carry existingRowCount + targetDim
 *   - embedding.db_unavailable — DB unreachable for the dim safety
 *     check; renderer renders retry + System Check link
 *   - onboarding.env_persist_failed — disk write failed
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  embeddingConfigureInputSchema,
  embeddingConfigureResultSchema,
  type EmbeddingConfigureResult,
} from "@shared/schemas/embedding.js";
import { writeEmbeddingConfig } from "../../onboarding/embedding-writer.js";
import { withEnvWriteLock } from "../../onboarding/env-write-mutex.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerEmbeddingHandler(): () => void {
  return registerHandler({
    channel: CH.onboarding.embeddingConfigure,
    domain: "onboarding",
    inputSchema: embeddingConfigureInputSchema,
    outputSchema: embeddingConfigureResultSchema,
    handle: async (input, ctx): Promise<Result<EmbeddingConfigureResult>> => {
      const outcome = await withEnvWriteLock(() =>
        writeEmbeddingConfig(input),
      );
      if (outcome.ok) {
        log.info(
          `[ipc:vex:onboarding:embeddingConfigure] ` +
            `dim=${input.dim} dimChanged=${outcome.data.dimChanged} ` +
            `correlationId=${ctx.requestId}`,
        );
      }
      return outcome;
    },
  });
}
