/**
 * VEX Ink-based shell — private local harness over the Vex Agent engine.
 * Runs a linear @clack wizard (system-check + bootstrap + keystore + wallets
 * + api-keys + embedding + agent-core + provider + mode + wake), then mounts
 * the Ink TUI (Cockpit + Messages + Thinking + Approvals + Input) with a
 * 13-tab settings panel (Ctrl+S).
 *
 * Run: pnpm exec tsx --tsconfig local/vex-shell/tsconfig.json local/vex-shell/index.ts
 *
 * LOG_FORMAT=pretty is set before dynamic-importing main.js because winston
 * caches the formatter at first import of `src/utils/logger.ts`; any module
 * that touches the logger after this point would otherwise emit JSON.
 */

if (!process.env.LOG_FORMAT) {
  process.env.LOG_FORMAT = "pretty";
}

const { runInkShell } = await import("./main.js");

runInkShell().catch((err) => {
  process.stderr.write(
    `[vex-shell] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
