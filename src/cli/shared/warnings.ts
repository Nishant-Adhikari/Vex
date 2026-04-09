let dep0040Suppressed = false;

function isDep0040Warning(
  warning: Parameters<typeof process.emitWarning>[0],
  args: unknown[],
): boolean {
  const type = typeof args[0] === "string" ? args[0] : undefined;
  const code = typeof args[1] === "string" ? args[1] : undefined;
  const message = typeof warning === "string" ? warning : warning?.message ?? "";

  return code === "DEP0040" || (type === "DeprecationWarning" && message.includes("punycode"));
}

export function suppressDep0040Warnings(): void {
  if (dep0040Suppressed) {
    return;
  }

  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: Parameters<typeof process.emitWarning>[0], ...args: unknown[]) => {
    if (isDep0040Warning(warning, args)) {
      return;
    }

    return originalEmitWarning(
      warning as Parameters<typeof process.emitWarning>[0],
      ...(args as Parameters<typeof process.emitWarning> extends [unknown, ...infer Rest] ? Rest : never),
    );
  }) as typeof process.emitWarning;

  dep0040Suppressed = true;
}
