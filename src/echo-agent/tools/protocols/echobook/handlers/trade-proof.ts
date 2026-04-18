/**
 * EchoBook trade-proof handlers — submit / get.
 */

import { submitTradeProof, getTradeProof } from "@tools/echobook/tradeProof.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

export const TRADE_PROOF_HANDLERS: Record<string, ProtocolHandler> = {
  "echobook.tradeProof.submit": async (p) => {
    const txHash = str(p, "txHash");
    if (!txHash) return fail("Missing required: txHash");
    const proof = await submitTradeProof({
      txHash,
      chainId: num(p, "chainId"),
    });
    return ok(proof);
  },

  "echobook.tradeProof.get": async (p) => {
    const txHash = str(p, "txHash");
    if (!txHash) return fail("Missing required: txHash");
    const proof = await getTradeProof(txHash);
    return ok(proof);
  },
};
