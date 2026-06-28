/**
 * Global env-write mutex (M9).
 *
 * Serialises every `${CONFIG_DIR}/.env` mutation issued by the
 * onboarding handlers. Different IPC paths (keystoreSet,
 * apiKeysSet, embeddingConfigure, agentCoreConfigure) all touch the
 * same file via `appendToDotenvFile` — concurrent invocations from
 * StrictMode dev double-mount, joined IPC calls, or future
 * Settings-side rotate flows could interleave the read-modify-write
 * cycle and lose values.
 *
 * Pattern mirrors `wallet-mutex.ts`: a chain-of-promises serialiser
 * that DOES NOT poison on rejection — a failed env write never
 * blocks subsequent ones. Process-local only; cross-process
 * concurrency (another process editing the same file) remains an accepted
 * Phase 1 risk per codex turn 2 RED #7.
 *
 * Wallet ops keep their own dedicated `wallet-mutex` because they
 * coordinate keystore.json + solana-keystore.json + config.json +
 * autoBackup() together — a different domain with different files.
 * No handler path needs both locks (audited M9 plan turn 1 R1).
 */

import { CRITICAL_OP, beginCriticalOp } from "../updates/critical-ops.js";

let envChain: Promise<unknown> = Promise.resolve();

export function withEnvWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  let resolved!: (value: T) => void;
  let rejected!: (reason: unknown) => void;
  const result = new Promise<T>((res, rej) => {
    resolved = res;
    rejected = rej;
  });
  // Every env-write mutation persists a secret (api key / provider / embedding /
  // agent-core) into the vault + .env. Mark it as a secret-vault op so the
  // updater safe-restart gate (M13) blocks while it runs. `finally` releases.
  const run = async (): Promise<void> => {
    const endCriticalOp = beginCriticalOp(CRITICAL_OP.secretVaultOp);
    try {
      resolved(await fn());
    } catch (e) {
      rejected(e);
    } finally {
      endCriticalOp();
    }
  };
  const next = envChain.then(run, run);
  envChain = next.catch(() => undefined);
  return result;
}

/** Test-only: reset the chain so unit tests start from a clean state. */
export function __resetEnvWriteMutexForTests(): void {
  envChain = Promise.resolve();
}
