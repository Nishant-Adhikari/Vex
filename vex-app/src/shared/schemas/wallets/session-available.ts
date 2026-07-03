/**
 * Agent integration puzzle 1: per-session wallet scope + available-wallets
 * inventory DTOs (the create picker), plus the set-scope result.
 *
 * Per-session wallet scope is DB-backed (phase 5C): the read-only handler
 * returns the stored scope, and `setSessionWalletScope` resolves wallet
 * ids server-side, failing closed on unknown ids with
 * `wallets.invalid_selection`.
 *
 * Field names match the canonical refs vocabulary in `BUG-REPORTING.md §3`
 * — `sessionId` is the canonical identifier, never `session_id` snake_case.
 *
 * `intent_id` is local-wallet only. Wallet side effects use hot wallets
 * created or imported by the user during onboarding.
 *
 * `WALLET_INTENT_MAX_LIST` is the single-source cap reused by
 * `availableWalletsDtoSchema` (and historically named for the intent list).
 */

import { z } from "zod";

export const WALLET_INTENT_MAX_LIST = 16;

// Puzzle 5 phase 5C: per-session wallet selection is an explicit 1 EVM + 1
// Solana pair (immutable at session start), NOT an allow-list. `null` per
// family = unselected → wallet tools for that family fail closed.
export const selectedWalletDtoSchema = z
  .object({
    walletId: z.string().max(128),
    address: z.string().max(128),
    label: z.string().max(120),
  })
  .strict();
export type SelectedWalletDto = z.infer<typeof selectedWalletDtoSchema>;

export const sessionWalletScopeDtoSchema = z
  .object({
    sessionId: z.string().uuid(),
    evm: selectedWalletDtoSchema.nullable(),
    solana: selectedWalletDtoSchema.nullable(),
  })
  .strict();
export type SessionWalletScopeDto = z.infer<typeof sessionWalletScopeDtoSchema>;

export const walletsListSessionInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();
export type WalletsListSessionInput = z.infer<
  typeof walletsListSessionInputSchema
>;

// Renderer sends only wallet IDs; main resolves id → address from the engine
// inventory server-side (never trust a renderer-supplied address). `null` =
// leave that family unselected.
export const walletsSetScopeInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    evmWalletId: z.string().max(128).nullable(),
    solanaWalletId: z.string().max(128).nullable(),
  })
  .strict();
export type WalletsSetScopeInput = z.infer<typeof walletsSetScopeInputSchema>;

// ── Available wallets (engine inventory, surfaced for the create picker) ──
// Read from config-backed inventory in main; addresses are public, keys never
// cross the boundary.
export const walletsListAvailableInputSchema = z.object({}).strict();
export type WalletsListAvailableInput = z.infer<typeof walletsListAvailableInputSchema>;

export const availableWalletDtoSchema = z
  .object({
    id: z.string().max(128),
    family: z.enum(["evm", "solana"]),
    address: z.string().max(128),
    label: z.string().max(120),
  })
  .strict();
export type AvailableWalletDto = z.infer<typeof availableWalletDtoSchema>;

export const availableWalletsDtoSchema = z
  .object({
    evm: z.array(availableWalletDtoSchema).max(WALLET_INTENT_MAX_LIST),
    solana: z.array(availableWalletDtoSchema).max(WALLET_INTENT_MAX_LIST),
  })
  .strict();
export type AvailableWalletsDto = z.infer<typeof availableWalletsDtoSchema>;

export const walletsSetScopeResultSchema = z
  .object({
    sessionId: z.string().uuid(),
    status: z.enum(["updated", "unchanged", "unavailable"]),
    message: z.string(),
  })
  .strict();
export type WalletsSetScopeResult = z.infer<typeof walletsSetScopeResultSchema>;
