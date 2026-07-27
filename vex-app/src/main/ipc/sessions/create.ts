/**
 * vex.sessions.create — Phase 2 multi-session shell (M12).
 *
 * Creates a new session row, plus (mission mode only) a companion
 * `missions` draft row in the same DB transaction. Returns the freshly
 * persisted list-item shape so the renderer can splice it into the
 * sidebar cache without a follow-up `vex.sessions.list` roundtrip.
 *
 * Mission setup conversational flow is NOT invoked here — that's deferred
 * to the engine's `processMissionSetupTurn` on the first message of the
 * mission session. This handler stays NO-LLM by design.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, type Result } from "@shared/ipc/result.js";
import {
  sessionCreateInputSchema,
  sessionCreateResultSchema,
  type SessionCreateResult,
} from "@shared/schemas/sessions.js";
import { createSession } from "../../database/sessions-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import {
  defaultMissionEvmWalletRef,
  invalidWalletSelectionError,
  isVaultWallet,
  resolveWalletRef,
  vaultWalletSelectionError,
} from "../_wallet-refs.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";

/**
 * Seed the freshly-created mission draft from a one-click preset's structured
 * fields so the contract renders complete (no "Still Missing"). Best-effort:
 * the session+mission rows are already committed, and the goal-prose setup turn
 * remains a fallback, so a seeding failure must NOT fail the launch — we log and
 * return the created session. Routes through the engine's SAME validated
 * draft-write pipeline the agent's `mission_draft_update` uses.
 */
async function seedPresetDraft(
  sessionId: string,
  seed: unknown,
  correlationId: string,
): Promise<void> {
  const dbUrlOutcome = await ensureEngineDbUrl(correlationId);
  if (!dbUrlOutcome.ok) {
    log.warn(
      `[ipc:vex:sessions:create] preset_seed_db_unavailable ` +
        `correlationId=${correlationId}`,
    );
    return;
  }
  try {
    const { seedMissionDraftForSession } = await import(
      "@vex-agent/engine/index.js"
    );
    const result = await seedMissionDraftForSession(sessionId, seed);
    log.info(
      `[ipc:vex:sessions:create] preset_seed_applied ` +
        `ready=${result?.ready ?? "no_mission"} correlationId=${correlationId}`,
    );
  } catch (cause) {
    log.warn(
      `[ipc:vex:sessions:create] preset_seed_failed correlationId=${correlationId}`,
      cause,
    );
  }
}

export function registerSessionsCreateHandler(): () => void {
  return registerHandler({
    channel: CH.sessions.create,
    domain: "internal",
    inputSchema: sessionCreateInputSchema,
    outputSchema: sessionCreateResultSchema,
    handle: async (input, ctx): Promise<Result<SessionCreateResult>> => {
      // Resolve selected wallet IDs → {id,address} server-side. Invalid id →
      // fail closed WITHOUT creating the session (or the mission row).
      let evm = resolveWalletRef("evm", input.selectedEvmWalletId);
      const solana = resolveWalletRef("solana", input.selectedSolanaWalletId);
      if (evm === "invalid" || solana === "invalid") {
        log.info(
          `[ipc:vex:sessions:create] invalid_wallet_selection correlationId=${ctx.requestId}`,
        );
        return err(invalidWalletSelectionError(ctx.requestId));
      }
      // Defense in depth: a vault (hold-only) wallet must never be bound to a
      // session. The dialog already hides them; this fails closed if one is
      // selected via any other path — no session/mission row is created.
      if (
        isVaultWallet("evm", input.selectedEvmWalletId) ||
        isVaultWallet("solana", input.selectedSolanaWalletId)
      ) {
        log.info(
          `[ipc:vex:sessions:create] vault_wallet_rejected correlationId=${ctx.requestId}`,
        );
        return err(vaultWalletSelectionError(ctx.requestId));
      }
      // MISSION default: when the operator selected no EVM wallet, bind the
      // session to the PRIMARY trading wallet so they never have to pick one
      // (covers both the Mission Presets tab and the normal new-mission flow,
      // which both send selectedEvmWalletId: null). Only fills when unselected —
      // never overrides an explicit choice — and never lands on a vault
      // (defaultMissionEvmWalletRef returns null for a vault/missing primary).
      if (input.mode === "mission" && !input.selectedEvmWalletId && evm === null) {
        evm = defaultMissionEvmWalletRef();
        if (evm) {
          log.info(
            `[ipc:vex:sessions:create] mission_default_evm_wallet applied ` +
              `correlationId=${ctx.requestId}`,
          );
        } else {
          log.info(
            `[ipc:vex:sessions:create] mission_default_evm_wallet unavailable ` +
              `(no primary or vault) correlationId=${ctx.requestId}`,
          );
        }
      }
      const outcome = await createSession(input, { evm, solana });
      if (outcome.ok) {
        log.info(
          `[ipc:vex:sessions:create] ok ` +
            `mode=${outcome.data.mode} permission=${outcome.data.permission} ` +
            `correlationId=${ctx.requestId}`,
        );
        // One-click preset launch: seed the mission contract's structured
        // fields now so it renders complete instead of "Still Missing".
        if (input.mode === "mission" && input.missionDraftSeed) {
          await seedPresetDraft(
            outcome.data.id,
            input.missionDraftSeed,
            ctx.requestId,
          );
        }
      } else {
        log.info(
          `[ipc:vex:sessions:create] errCode=${outcome.error.code} ` +
            `correlationId=${ctx.requestId}`,
        );
      }
      return outcome;
    },
  });
}
