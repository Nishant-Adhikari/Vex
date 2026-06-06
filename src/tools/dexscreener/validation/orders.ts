/**
 * Order validator.
 *
 * Strict `parseOrder` plus the `validateOrdersResponse` array validator. The
 * original casts `asString(...)` to the enum types WITHOUT validating
 * membership; preserved VERBATIM from the original `validation.ts`.
 */

import { z } from "zod";
import { VexError, ErrorCodes } from "../../../errors.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import type { DexOrder } from "../types.js";
import { asNumber, asString, parseOrThrow } from "./_shared.js";

const orderObjectSchema: z.ZodType<DexOrder> = z
  .object({
    // The original casts `asString(...)` to the enum types WITHOUT validating
    // membership, so any non-empty string passes. Preserved: required string +
    // local cast (no enum check).
    type: asString("order.type"),
    status: asString("order.status"),
    paymentTimestamp: asNumber("order.paymentTimestamp"),
  })
  .transform((o) => ({
    type: o.type as DexOrder["type"],
    status: o.status as DexOrder["status"],
    paymentTimestamp: o.paymentTimestamp,
  }));

function parseOrder(raw: unknown): DexOrder {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: order must be an object");
  }
  return parseOrThrow(orderObjectSchema, raw);
}

export function validateOrdersResponse(raw: unknown): DexOrder[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected orders array");
  }
  return raw.map(parseOrder);
}
