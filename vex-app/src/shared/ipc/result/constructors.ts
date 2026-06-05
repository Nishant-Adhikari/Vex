import type { Result, VexError } from "./types.js";

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <E extends VexError>(error: E): Result<never, E> => ({
  ok: false,
  error,
});
