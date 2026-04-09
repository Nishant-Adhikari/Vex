import { createWallet } from "../../tools/wallet/create.js";
import { importWallet } from "../../tools/wallet/import.js";
import { createSolanaWallet } from "../../tools/wallet/solana-create.js";
import { importSolanaWallet } from "../../tools/wallet/solana-import.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";
import { formatLauncherError } from "./errors.js";
import { getEvmWalletStatus, getSolanaWalletStatus } from "./status.js";
import { confirm, promptMenu, promptSecret, renderWalletStatuses } from "./ui.js";

async function requestOverwriteApproval(kindLabel: string, address: string | null): Promise<boolean> {
  const subject = address ? `${kindLabel} wallet ${address}` : `stored ${kindLabel} wallet state`;
  const firstApproval = await confirm(`An existing ${subject} was found. Do you want to overwrite it?`, false);
  if (!firstApproval) {
    return false;
  }

  return confirm(
    `EchoClaw will back up the current ${kindLabel} wallet before replacing it. Continue?`,
    false,
  );
}

async function promptEvmWalletAction(): Promise<"create" | "import"> {
  return promptMenu("Configure EVM wallet", [
    {
      id: "create",
      label: "Create a new EVM wallet",
      description: "Generate a fresh EVM wallet and store it in the local encrypted keystore.",
    },
    {
      id: "import",
      label: "Import an existing EVM wallet",
      description: "Paste an existing EVM private key and store it in the local encrypted keystore.",
    },
  ]);
}

async function promptSolanaWalletAction(): Promise<"create" | "import"> {
  return promptMenu("Configure Solana wallet", [
    {
      id: "create",
      label: "Create a new Solana wallet",
      description: "Generate a fresh Solana wallet and store it in the local encrypted keystore.",
    },
    {
      id: "import",
      label: "Import an existing Solana wallet",
      description: "Paste a base58 or JSON-array Solana secret key and store it in the local encrypted keystore.",
    },
  ]);
}

export async function ensureEvmWallet(): Promise<void> {
  const status = getEvmWalletStatus();
  renderWalletStatuses([status]);

  const requiresOverwrite = status.status === "configured" || status.hasStoredState;
  if (requiresOverwrite) {
    const approved = await requestOverwriteApproval("EVM", status.address);
    if (!approved && status.status === "configured") {
      writeStderr("Keeping the existing EVM wallet.");
      return;
    }
    if (!approved) {
      throw new EchoError(
        ErrorCodes.SETUP_CANCELLED,
        "EVM wallet setup cancelled.",
        "EchoClaw needs a valid local EVM wallet to complete the guided setup.",
      );
    }
  }

  while (true) {
    const action = await promptEvmWalletAction();

    try {
      if (action === "create") {
        const result = await createWallet({ force: requiresOverwrite });
        writeStderr(`Configured EVM wallet ${result.address}.`);
      } else {
        const privateKey = await promptSecret("Paste the EVM private key (0x...)");
        const result = await importWallet(privateKey, { force: requiresOverwrite });
        writeStderr(`Configured EVM wallet ${result.address}.`);
      }
      return;
    } catch (error) {
      writeStderr(formatLauncherError(error));
    }
  }
}

export async function ensureSolanaWallet(): Promise<void> {
  const status = getSolanaWalletStatus();
  renderWalletStatuses([status]);

  const requiresOverwrite = status.status === "configured" || status.hasStoredState;
  if (requiresOverwrite) {
    const approved = await requestOverwriteApproval("Solana", status.address);
    if (!approved && status.status === "configured") {
      writeStderr("Keeping the existing Solana wallet.");
      return;
    }
    if (!approved) {
      throw new EchoError(
        ErrorCodes.SETUP_CANCELLED,
        "Solana wallet setup cancelled.",
        "EchoClaw needs a valid local Solana wallet to complete the guided setup.",
      );
    }
  }

  while (true) {
    const action = await promptSolanaWalletAction();

    try {
      if (action === "create") {
        const result = await createSolanaWallet({ force: requiresOverwrite });
        writeStderr(`Configured Solana wallet ${result.address}.`);
      } else {
        const privateKey = await promptSecret("Paste the Solana secret key (base58 or JSON array)");
        const result = await importSolanaWallet(privateKey, { force: requiresOverwrite });
        writeStderr(`Configured Solana wallet ${result.address}.`);
      }
      return;
    } catch (error) {
      writeStderr(formatLauncherError(error));
    }
  }
}
