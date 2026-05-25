/**
 * vex.onboarding.polymarketConfiguredAddresses — puzzle 5 B-UI read handler.
 *
 * Returns the lowercased EVM addresses that currently have Polymarket CLOB
 * credentials in the vault (per-wallet map keys + the legacy-primary fallback
 * when the three fixed keys are present). The renderer's wallet picker uses
 * this to mark each EVM wallet ✓ configured / ◦ not.
 *
 * PUBLIC ADDRESSES ONLY — no credential material crosses this boundary. The
 * heavy lifting (require unlock → unlock vault → parse map → dedupe) lives in
 * `secrets/session.getConfiguredPolymarketAddresses`, which fails CLOSED on a
 * malformed map (error Result, never an empty list).
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  polymarketConfiguredAddressesResultSchema,
  type PolymarketConfiguredAddressesResult,
} from "@shared/schemas/api-keys.js";
import { z } from "zod";
import { getConfiguredPolymarketAddresses } from "../../secrets/session.js";
import { registerHandler } from "../register-handler.js";

const emptyInputSchema = z.object({}).strict();

export function registerPolymarketConfiguredAddressesHandler(): () => void {
  return registerHandler({
    channel: CH.onboarding.polymarketConfiguredAddresses,
    domain: "onboarding",
    inputSchema: emptyInputSchema,
    outputSchema: polymarketConfiguredAddressesResultSchema,
    handle: async (): Promise<Result<PolymarketConfiguredAddressesResult>> => {
      const result = getConfiguredPolymarketAddresses();
      if (!result.ok) return result;
      // `result.data` is a readonly string[]; the output schema validates the
      // address shape, so a malformed map key (impossible — parse already
      // validated) would be caught at the boundary.
      return ok({ addresses: [...result.data] });
    },
  });
}
