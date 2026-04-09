import { createWallet } from "../../tools/wallet/create.js";
import { importWallet } from "../../tools/wallet/import.js";
import { createSolanaWallet } from "../../tools/wallet/solana-create.js";
import { importSolanaWallet } from "../../tools/wallet/solana-import.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";
import { formatLauncherError } from "./errors.js";
import { getEvmWalletStatus, getSolanaWalletStatus, type WalletStatus } from "./status.js";
import { confirm, promptMenu, promptSecret, renderWalletStatuses } from "./ui.js";

type AdvancedWalletAction = "continue" | "advanced";
type RecoveryAction = "create" | "import" | "cancel";
type WalletMutationAction = "create" | "import";
type WalletReplacementAction = "replace-evm" | "replace-solana" | "back";

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

async function promptEvmWalletAction(): Promise<WalletMutationAction> {
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

async function promptSolanaWalletAction(): Promise<WalletMutationAction> {
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

async function promptWalletRecovery(kind: WalletStatus["kind"]): Promise<RecoveryAction> {
  const title = kind === "evm" ? "Recover EVM wallet" : "Recover Solana wallet";
  const storedStateDescription = kind === "evm"
    ? "Replace the stored EVM keystore/config state with a newly generated wallet."
    : "Replace the stored Solana keystore/config state with a newly generated wallet.";
  const importDescription = kind === "evm"
    ? "Replace the stored EVM keystore/config state by importing an existing private key."
    : "Replace the stored Solana keystore/config state by importing an existing secret key.";

  return promptMenu(title, [
    {
      id: "create",
      label: kind === "evm" ? "Create a replacement EVM wallet" : "Create a replacement Solana wallet",
      description: storedStateDescription,
    },
    {
      id: "import",
      label: kind === "evm" ? "Import a replacement EVM wallet" : "Import a replacement Solana wallet",
      description: importDescription,
    },
    {
      id: "cancel",
      label: "Cancel setup",
      description: "Exit the guided setup without mutating the current stored wallet files.",
    },
  ]);
}

async function configureEvmWallet(force: boolean): Promise<void> {
  while (true) {
    const action = await promptEvmWalletAction();

    try {
      if (action === "create") {
        const result = await createWallet({ force });
        writeStderr(`Configured EVM wallet ${result.address}.`);
      } else {
        const privateKey = await promptSecret("Paste the EVM private key (0x...)");
        const result = await importWallet(privateKey, { force });
        writeStderr(`Configured EVM wallet ${result.address}.`);
      }
      return;
    } catch (error) {
      writeStderr(formatLauncherError(error));
    }
  }
}

async function configureSolanaWallet(force: boolean): Promise<void> {
  while (true) {
    const action = await promptSolanaWalletAction();

    try {
      if (action === "create") {
        const result = await createSolanaWallet({ force });
        writeStderr(`Configured Solana wallet ${result.address}.`);
      } else {
        const privateKey = await promptSecret("Paste the Solana secret key (base58 or JSON array)");
        const result = await importSolanaWallet(privateKey, { force });
        writeStderr(`Configured Solana wallet ${result.address}.`);
      }
      return;
    } catch (error) {
      writeStderr(formatLauncherError(error));
    }
  }
}

async function recoverWalletStatus(status: WalletStatus): Promise<void> {
  while (true) {
    const action = await promptWalletRecovery(status.kind);

    if (action === "cancel") {
      throw new EchoError(
        ErrorCodes.SETUP_CANCELLED,
        `${status.kind === "evm" ? "EVM" : "Solana"} wallet setup cancelled.`,
        "EchoClaw needs valid local wallets to complete the guided setup.",
      );
    }

    try {
      if (status.kind === "evm") {
        if (action === "create") {
          const result = await createWallet({ force: true });
          writeStderr(`Configured EVM wallet ${result.address}.`);
        } else {
          const privateKey = await promptSecret("Paste the EVM private key (0x...)");
          const result = await importWallet(privateKey, { force: true });
          writeStderr(`Configured EVM wallet ${result.address}.`);
        }
      } else if (action === "create") {
        const result = await createSolanaWallet({ force: true });
        writeStderr(`Configured Solana wallet ${result.address}.`);
      } else {
        const privateKey = await promptSecret("Paste the Solana secret key (base58 or JSON array)");
        const result = await importSolanaWallet(privateKey, { force: true });
        writeStderr(`Configured Solana wallet ${result.address}.`);
      }
      return;
    } catch (error) {
      writeStderr(formatLauncherError(error));
    }
  }
}

async function replaceWallet(status: WalletStatus): Promise<void> {
  const approved = await requestOverwriteApproval(status.kind === "evm" ? "EVM" : "Solana", status.address);
  if (!approved) {
    writeStderr(`Keeping the existing ${status.kind === "evm" ? "EVM" : "Solana"} wallet.`);
    return;
  }

  if (status.kind === "evm") {
    await configureEvmWallet(true);
  } else {
    await configureSolanaWallet(true);
  }
}

async function runAdvancedWalletActions(): Promise<void> {
  while (true) {
    const evmStatus = getEvmWalletStatus();
    const solanaStatus = getSolanaWalletStatus();

    const items = [];
    if (evmStatus.status === "configured") {
      items.push({
        id: "replace-evm",
        label: "Replace EVM wallet",
        description: `Back up the current EVM wallet${evmStatus.address ? ` ${evmStatus.address}` : ""} before replacing it.`,
      });
    }
    if (solanaStatus.status === "configured") {
      items.push({
        id: "replace-solana",
        label: "Replace Solana wallet",
        description: `Back up the current Solana wallet${solanaStatus.address ? ` ${solanaStatus.address}` : ""} before replacing it.`,
      });
    }
    items.push({
      id: "back",
      label: "Back",
      description: "Return to the guided setup without replacing any more wallets.",
    });

    const action = await promptMenu("Advanced wallet actions", items as Array<{
      id: WalletReplacementAction;
      label: string;
      description: string;
    }>);

    if (action === "back") {
      return;
    }

    if (action === "replace-evm") {
      await replaceWallet(evmStatus);
    } else {
      await replaceWallet(solanaStatus);
    }

    renderWalletStatuses([getEvmWalletStatus(), getSolanaWalletStatus()]);
  }
}

async function maybeManageConfiguredWallets(): Promise<void> {
  while (true) {
    const evmStatus = getEvmWalletStatus();
    const solanaStatus = getSolanaWalletStatus();
    const hasConfiguredWallet = evmStatus.status === "configured" || solanaStatus.status === "configured";

    if (!hasConfiguredWallet) {
      return;
    }

    renderWalletStatuses([evmStatus, solanaStatus]);

    const action = await promptMenu("Wallet actions", [
      {
        id: "continue",
        label: "Continue with current wallets",
        description: "Keep the currently configured wallets and move on with the guided MCP setup.",
      },
      {
        id: "advanced",
        label: "Advanced wallet actions",
        description: "Replace a configured wallet after an explicit review and backup-aware confirmation flow.",
      },
    ] as Array<{ id: AdvancedWalletAction; label: string; description: string }>);

    if (action === "continue") {
      return;
    }

    await runAdvancedWalletActions();
  }
}

async function ensureWalletReady(status: WalletStatus): Promise<void> {
  if (status.status === "configured") {
    return;
  }

  if (status.hasStoredState) {
    writeStderr(
      `${status.kind === "evm" ? "EVM" : "Solana"} wallet state needs recovery before setup can continue.`,
    );
    writeStderr(status.detail);
    await recoverWalletStatus(status);
    return;
  }

  if (status.kind === "evm") {
    await configureEvmWallet(false);
  } else {
    await configureSolanaWallet(false);
  }
}

export async function ensureWallets(): Promise<void> {
  await maybeManageConfiguredWallets();

  let evmStatus = getEvmWalletStatus();
  await ensureWalletReady(evmStatus);

  let solanaStatus = getSolanaWalletStatus();
  await ensureWalletReady(solanaStatus);

  evmStatus = getEvmWalletStatus();
  solanaStatus = getSolanaWalletStatus();

  if (evmStatus.status !== "configured" || solanaStatus.status !== "configured") {
    throw new EchoError(
      ErrorCodes.SETUP_CANCELLED,
      "Wallet setup did not complete successfully.",
      "Both the EVM and Solana wallets must be configured before the local MCP can start.",
    );
  }
}
