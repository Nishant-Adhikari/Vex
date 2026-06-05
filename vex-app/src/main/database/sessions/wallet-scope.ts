/**
 * Per-session wallet selection (vex-app pool — sessions are app-owned).
 *
 * Wallet-scope enforcement stays in main: the initialize-if-empty CAS only
 * sets a family while it is NULL and the session has no messages yet, and it
 * recomputes the mission draft's allowed_wallets from the resulting selection
 * in the same transaction.
 */

import type { Client } from "pg";
import { ok, type Result, type VexError } from "@shared/ipc/result.js";
import { VEX_APP_SESSION_SCOPE } from "@shared/schemas/sessions.js";
import { log } from "../../logger/index.js";
import type { WalletRef } from "../../ipc/_wallet-refs.js";
import { dbError, withClient } from "./connection.js";

export interface SessionWalletScopeRow {
  evm: WalletRef | null;
  solana: WalletRef | null;
}

interface ScopeQueryRow {
  selected_evm_wallet_id: string | null;
  selected_evm_wallet_address: string | null;
  selected_solana_wallet_id: string | null;
  selected_solana_wallet_address: string | null;
}

function rowToScope(r: ScopeQueryRow | undefined): SessionWalletScopeRow {
  return {
    evm:
      r?.selected_evm_wallet_id && r.selected_evm_wallet_address
        ? { id: r.selected_evm_wallet_id, address: r.selected_evm_wallet_address }
        : null,
    solana:
      r?.selected_solana_wallet_id && r.selected_solana_wallet_address
        ? { id: r.selected_solana_wallet_id, address: r.selected_solana_wallet_address }
        : null,
  };
}

/** Read the per-session wallet selection (vex-app pool — sessions are app-owned). */
export async function getSessionWalletScope(
  sessionId: string,
): Promise<Result<SessionWalletScopeRow, VexError>> {
  return withClient(async (client) => {
    try {
      const r = await client.query<ScopeQueryRow>(
        `SELECT selected_evm_wallet_id, selected_evm_wallet_address,
                selected_solana_wallet_id, selected_solana_wallet_address
         FROM sessions WHERE id = $1 AND scope = $2`,
        [sessionId, VEX_APP_SESSION_SCOPE],
      );
      return ok(rowToScope(r.rows[0]));
    } catch (cause) {
      return dbError("getSessionWalletScope query failed", cause);
    }
  });
}

/**
 * Initialize-if-empty CAS for the per-session wallet selection (puzzle 5 5C).
 * Per family: set the selection ONLY when currently NULL and the session has
 * no messages yet (immutable after the first turn). For a draft mission
 * session, recompute missions.allowed_wallets from the resulting selection in
 * the SAME transaction. Never overwrites a set family, never clears.
 */
export async function initializeSessionWalletScopeWithClient(
  client: Client,
  sessionId: string,
  evm: WalletRef | null,
  solana: WalletRef | null,
): Promise<{ status: "updated" | "unchanged" }> {
  await client.query("BEGIN");
  let changed = false;
  if (evm) {
    const r = await client.query(
      `UPDATE sessions SET selected_evm_wallet_id = $2, selected_evm_wallet_address = $3
       WHERE id = $1 AND scope = $4 AND selected_evm_wallet_id IS NULL AND message_count = 0`,
      [sessionId, evm.id, evm.address, VEX_APP_SESSION_SCOPE],
    );
    if ((r.rowCount ?? 0) > 0) changed = true;
  }
  if (solana) {
    const r = await client.query(
      `UPDATE sessions SET selected_solana_wallet_id = $2, selected_solana_wallet_address = $3
       WHERE id = $1 AND scope = $4 AND selected_solana_wallet_id IS NULL AND message_count = 0`,
      [sessionId, solana.id, solana.address, VEX_APP_SESSION_SCOPE],
    );
    if ((r.rowCount ?? 0) > 0) changed = true;
  }
  if (changed) {
    // Recompute mission draft allowed_wallets from the (now-updated) selection
    // — draft mission only; no-op for agent sessions (0 rows).
    const sel = await client.query<ScopeQueryRow>(
      `SELECT selected_evm_wallet_id, selected_evm_wallet_address,
              selected_solana_wallet_id, selected_solana_wallet_address
       FROM sessions WHERE id = $1`,
      [sessionId],
    );
    const scope = rowToScope(sel.rows[0]);
    const allowed = [scope.evm?.address, scope.solana?.address].filter(
      (a): a is string => typeof a === "string",
    );
    await client.query(
      `UPDATE missions SET allowed_wallets = $2 WHERE root_session_id = $1 AND status = 'draft'`,
      [sessionId, allowed],
    );
  }
  await client.query("COMMIT");
  return { status: changed ? "updated" : "unchanged" };
}

export async function initializeSessionWalletScope(
  sessionId: string,
  evm: WalletRef | null,
  solana: WalletRef | null,
): Promise<Result<{ status: "updated" | "unchanged" }, VexError>> {
  return withClient(async (client) => {
    try {
      return ok(
        await initializeSessionWalletScopeWithClient(client, sessionId, evm, solana),
      );
    } catch (cause) {
      try {
        await client.query("ROLLBACK");
      } catch (rbCause) {
        log.warn(
          "[sessions-db] ROLLBACK after initializeSessionWalletScope failure failed",
          rbCause,
        );
      }
      return dbError("initializeSessionWalletScope transaction failed", cause);
    }
  });
}
