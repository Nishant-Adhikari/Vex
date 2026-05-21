import { CH } from "../../shared/ipc/channels.js";
import { walletExportPrivateKeyInputSchema } from "../../shared/schemas/wallets.js";
import type { WalletExportPrivateKeyInput } from "../../shared/schemas/wallets.js";
import type { WalletBridge } from "../../shared/types/bridge/shell/wallet.js";
import { invokeWithSchema } from "../_dispatch.js";

export const wallet = {
  exportPrivateKey(input: WalletExportPrivateKeyInput) {
    return invokeWithSchema(
      CH.wallet.exportPrivateKey,
      input,
      walletExportPrivateKeyInputSchema
    );
  },
} satisfies WalletBridge;
