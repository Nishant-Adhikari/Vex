/**
 * Touch ID unlock logic — fully DI'd, no Electron / no disk.
 *
 * The load-bearing security property: the fingerprint prompt gates BEFORE the
 * stored password is ever decrypted, and nothing is written unless the vault is
 * currently unlocked (so a wrong password can't be enrolled).
 */

import { describe, it, expect, vi } from "vitest";
import {
  getTouchIdStatus, enableTouchId, disableTouchId, unlockWithTouchId,
  type TouchIdDeps,
} from "../touchid.js";

function deps(over: Partial<TouchIdDeps> = {}): TouchIdDeps {
  return {
    supported: () => true,
    encrypt: (p) => Buffer.from(`enc:${p}`),
    decrypt: (c) => c.toString().replace(/^enc:/, ""),
    promptBiometric: async () => {},
    currentUnlockedPassword: () => "hunter2",
    unlockSession: () => true,
    readCipher: async () => null,
    writeCipher: async () => {},
    removeCipher: async () => {},
    ...over,
  };
}

describe("getTouchIdStatus", () => {
  it("enabled reflects whether a stored cipher exists", async () => {
    expect(await getTouchIdStatus(deps({ readCipher: async () => null }))).toEqual({ supported: true, enabled: false });
    expect(await getTouchIdStatus(deps({ readCipher: async () => Buffer.from("x") }))).toEqual({ supported: true, enabled: true });
  });
  it("supported is false off macOS / without safeStorage", async () => {
    expect((await getTouchIdStatus(deps({ supported: () => false }))).supported).toBe(false);
  });
});

describe("enableTouchId", () => {
  it("stores the encrypted CURRENT password when unlocked", async () => {
    const writeCipher = vi.fn(async () => {});
    const r = await enableTouchId(deps({ writeCipher }));
    expect(r).toEqual({ ok: true });
    expect(writeCipher).toHaveBeenCalledWith(Buffer.from("enc:hunter2"));
  });
  it("refuses when the vault is locked (no password in memory) — never stores a guess", async () => {
    const writeCipher = vi.fn(async () => {});
    const r = await enableTouchId(deps({ currentUnlockedPassword: () => null, writeCipher }));
    expect(r).toEqual({ ok: false, reason: "locked" });
    expect(writeCipher).not.toHaveBeenCalled();
  });
  it("refuses when Touch ID is unsupported", async () => {
    expect(await enableTouchId(deps({ supported: () => false }))).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("unlockWithTouchId", () => {
  it("prompts biometric, then decrypts, then unlocks", async () => {
    const order: string[] = [];
    const r = await unlockWithTouchId(deps({
      readCipher: async () => Buffer.from("enc:hunter2"),
      promptBiometric: async () => { order.push("prompt"); },
      decrypt: (c) => { order.push("decrypt"); return c.toString().replace(/^enc:/, ""); },
      unlockSession: (p) => { order.push(`unlock:${p}`); return true; },
    }));
    expect(r).toEqual({ unlocked: true });
    expect(order).toEqual(["prompt", "decrypt", "unlock:hunter2"]);
  });

  it("does NOT decrypt if the biometric prompt fails (gate is first)", async () => {
    const decrypt = vi.fn(() => "x");
    const r = await unlockWithTouchId(deps({
      readCipher: async () => Buffer.from("enc:hunter2"),
      promptBiometric: async () => { throw new Error("cancelled"); },
      decrypt,
    }));
    expect(r).toEqual({ unlocked: false, reason: "biometric_failed" });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("returns not_enrolled when no cipher is stored", async () => {
    expect(await unlockWithTouchId(deps({ readCipher: async () => null }))).toEqual({ unlocked: false, reason: "not_enrolled" });
  });

  it("surfaces a bad stored secret (decrypted password no longer unlocks)", async () => {
    const r = await unlockWithTouchId(deps({
      readCipher: async () => Buffer.from("enc:stale"),
      unlockSession: () => false,
    }));
    expect(r).toEqual({ unlocked: false, reason: "bad_secret" });
  });
});

describe("disableTouchId", () => {
  it("removes the stored cipher", async () => {
    const removeCipher = vi.fn(async () => {});
    await disableTouchId(deps({ removeCipher }));
    expect(removeCipher).toHaveBeenCalledOnce();
  });
});
