import type { Address, Hex } from "viem";
import { loadConfig } from "../../config/store.js";
import { loadKeystore, decryptPrivateKey } from "./keystore.js";
import { requireKeystorePassword } from "../../utils/env.js";
import { VexError, ErrorCodes } from "../../errors.js";

export function requireWalletAndKeystore(): { address: Address; privateKey: Hex } {
  const cfg = loadConfig();
  if (!cfg.wallet.address) {
    throw new VexError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      "No wallet configured.",
      "Run: vex wallet create --json"
    );
  }

  const password = requireKeystorePassword();
  const keystore = loadKeystore();
  if (!keystore) {
    throw new VexError(ErrorCodes.KEYSTORE_NOT_FOUND, "Keystore not found.", "Run: vex wallet create --json");
  }

  const privateKey = decryptPrivateKey(keystore, password);
  return { address: cfg.wallet.address, privateKey };
}
