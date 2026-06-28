/**
 * Safe-restart gating at the keystore/secret-vault seam (M13, Codex final
 * review finding 1). Every wallet write routes through `withWalletLock` and
 * every secret .env write through `withEnvWriteLock`; both must mark a
 * `secretVaultOp` critical op for the locked section so the updater gate blocks
 * a restart while a keystore/secret operation is in flight.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  __resetWalletMutexForTests,
  withWalletLock,
} from "../wallet-mutex.js";
import {
  __resetEnvWriteMutexForTests,
  withEnvWriteLock,
} from "../env-write-mutex.js";
import {
  __resetCriticalOpsForTests,
  criticalOpInFlight,
} from "../../updates/critical-ops.js";

afterEach(() => {
  __resetWalletMutexForTests();
  __resetEnvWriteMutexForTests();
  __resetCriticalOpsForTests();
});

describe("mutex safe-restart gating", () => {
  it("withWalletLock holds a critical op for the locked section", async () => {
    expect(criticalOpInFlight()).toBe(false);
    let insideFlag = false;
    await withWalletLock(async () => {
      insideFlag = criticalOpInFlight();
    });
    expect(insideFlag).toBe(true);
    expect(criticalOpInFlight()).toBe(false);
  });

  it("withEnvWriteLock holds a critical op for the locked section", async () => {
    let insideFlag = false;
    await withEnvWriteLock(async () => {
      insideFlag = criticalOpInFlight();
    });
    expect(insideFlag).toBe(true);
    expect(criticalOpInFlight()).toBe(false);
  });

  it("releases the critical op even when the locked fn throws", async () => {
    await expect(
      withWalletLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(criticalOpInFlight()).toBe(false);
  });
});
