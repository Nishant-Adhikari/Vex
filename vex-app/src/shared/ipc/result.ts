/**
 * Typed Result<T, VexError> envelope per skill §6.
 *
 * Renderer NEVER receives raw thrown errors. Main process logs internal errors
 * with correlation IDs and redacts public output. All IPC handlers return Result<T>.
 *
 * Compatibility barrel: the contract was split into focused modules under
 * `./result/` (types, codes, constructors, assert). This file re-exports the
 * IDENTICAL public surface so the ~143 importers across preload/renderer/main/
 * shared continue to import from `…/ipc/result` unchanged.
 */

export type {
  JsonValue,
  VexDomain,
  VexErrorCode,
  VexError,
  Result,
} from "./result/types.js";
export { VEX_ERROR_CODES, VEX_DOMAINS } from "./result/codes.js";
export { ok, err } from "./result/constructors.js";
export { assertNever } from "./result/assert.js";
