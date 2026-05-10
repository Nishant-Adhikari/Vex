/**
 * Global wallet write mutex (M8).
 *
 * Per codex turn 8 RED #2: every wallet generate/import/restore is a
 * destructive filesystem mutation that touches BOTH chain-specific
 * keystore files AND the shared `config.json`. Renderer pending-state
 * (TanStack mutation flags, RHF submitting) is not a security boundary
 * — concurrent invocations from StrictMode dev double-mount, joined
 * IPC calls, or future Settings-side rotate flows could interleave
 * `loadConfig → ... → saveConfig` cycles and lose state.
 *
 * The mutex is global (NOT per-chain) because `autoBackup()` reads both
 * `keystore.json` and `solana-keystore.json` plus `config.json` into a
 * single backup directory. A concurrent EVM-generate + Solana-restore
 * could race on the config write.
 *
 * Pattern mirrors `PreferencesStore.enqueue` (`src/main/preferences/store.ts`):
 * a chain-of-promises serialiser that DOES NOT poison on rejection — a
 * failed wallet operation never blocks subsequent ones.
 */

let walletChain: Promise<unknown> = Promise.resolve();

export function withWalletLock<T>(fn: () => Promise<T>): Promise<T> {
  let resolved!: (value: T) => void;
  let rejected!: (reason: unknown) => void;
  const result = new Promise<T>((res, rej) => {
    resolved = res;
    rejected = rej;
  });
  const next = walletChain.then(
    async () => {
      try {
        resolved(await fn());
      } catch (e) {
        rejected(e);
      }
    },
    async () => {
      try {
        resolved(await fn());
      } catch (e) {
        rejected(e);
      }
    }
  );
  walletChain = next.catch(() => undefined);
  return result;
}

/** Test-only: reset the chain so unit tests start from a clean state. */
export function __resetWalletMutexForTests(): void {
  walletChain = Promise.resolve();
}
