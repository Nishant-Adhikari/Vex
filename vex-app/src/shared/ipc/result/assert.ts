/** Exhaustive switch helper — call from default branch to assert all variants handled. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
