/**
 * Runtime validators for KyberSwap Common Service responses.
 */

import { ErrorCodes } from "../../../errors.js";
import { isRecord, createFieldValidators } from "../../../utils/validation-helpers.js";
import type { KyberChainInfo } from "../types.js";

const { asString, asNumber } = createFieldValidators(
  ErrorCodes.KYBER_API_ERROR, "KyberSwap Common Service",
);

function parseChainInfo(raw: unknown): KyberChainInfo {
  if (!isRecord(raw)) {
    throw new Error("chain info must be an object");
  }
  const state = asString(raw.state, "chain.state");
  return {
    chainId: asNumber(raw.chainId, "chain.chainId"),
    chainName: asString(raw.chainName, "chain.chainName"),
    displayName: asString(raw.displayName, "chain.displayName"),
    state: (state === "active" || state === "inactive" || state === "new") ? state : "inactive",
  };
}

export function validateSupportedChainsResponse(raw: unknown): KyberChainInfo[] {
  if (!isRecord(raw) || !Array.isArray(raw.data)) {
    throw new Error("Expected supported chains response with data array");
  }
  return raw.data.map(parseChainInfo);
}
