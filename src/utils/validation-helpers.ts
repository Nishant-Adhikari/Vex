/**
 * Shared runtime validation primitives.
 *
 * Used by Khalani, DexScreener, KyberSwap, and any future API client
 * validators to avoid duplicating the same type-guard boilerplate.
 */

import { VexError } from "../errors.js";

/** Type guard: value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Factory that creates domain-scoped field validators.
 *
 * Each API client module calls this once at the top of its validation file
 * to get helpers that throw the correct domain error code.
 *
 * @example
 * ```ts
 * const { asString, asNumber, asOptionalString } = createFieldValidators(
 *   ErrorCodes.KHALANI_API_ERROR, "Khalani",
 * );
 * ```
 */
export function createFieldValidators(errorCode: string, prefix: string) {
  function asString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new VexError(errorCode, `Invalid ${prefix} response: missing ${field}`);
    }
    return value;
  }

  function asNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new VexError(errorCode, `Invalid ${prefix} response: missing ${field}`);
    }
    return value;
  }

  function asOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  function asOptionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
  }

  function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return { asString, asNumber, asOptionalString, asOptionalNumber, asStringArray };
}
