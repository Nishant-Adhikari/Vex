import { EchoError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";
import { writeConnectorArtifacts } from "./connectors.js";
import { ensureKeystorePassword, ensureRequiredEnvDefaults, synchronizeTrackedEnv } from "./setup.js";
import { collectEnvFieldStatuses, getEvmWalletStatus, getSolanaWalletStatus } from "./status.js";
import { ensureSystemChecksPassed, startLocalServices, waitForBootstrapSuccess } from "./system.js";
import { ensureWallets } from "./wallets.js";
import {
  assertInteractiveLauncher,
  promptMenu,
  renderConnectorDetails,
  renderEnvStatuses,
  renderLauncherHeader,
  renderSection,
  renderWalletStatuses,
} from "./ui.js";

export async function runConnectFlow(): Promise<void> {
  assertInteractiveLauncher();

  renderLauncherHeader(false);
  renderSection(
    "Connect EchoClaw to your AI agent",
    "This flow sets up the local EchoClaw MCP, configures both wallets, starts local services, and writes ready connectors for Cursor, Claude Code, Codex, OpenClaw, and a default MCP client.",
  );

  await ensureSystemChecksPassed();

  renderEnvStatuses(collectEnvFieldStatuses());
  ensureRequiredEnvDefaults();
  await ensureKeystorePassword();
  synchronizeTrackedEnv();
  renderEnvStatuses(collectEnvFieldStatuses());

  await ensureWallets();
  renderWalletStatuses([getEvmWalletStatus(), getSolanaWalletStatus()]);

  startLocalServices();
  await waitForBootstrapSuccess();

  renderLauncherHeader(true);
  const generated = writeConnectorArtifacts();
  writeStderr(`Generated connector artifacts in ${generated.directory}`);
  writeStderr(`Connector index: ${generated.readmePath}`);

  const selectedTarget = await promptMenu(
    "Choose the AI agent connector you want to inspect now",
    generated.bundles.map((bundle) => ({
      id: bundle.id,
      label: bundle.title,
      description: bundle.description,
    })),
  );

  const bundle = generated.bundles.find((entry) => entry.id === selectedTarget);
  if (!bundle) {
    throw new EchoError(
      ErrorCodes.CONNECTOR_WRITE_FAILED,
      `Unknown connector target: ${selectedTarget}`,
    );
  }

  renderConnectorDetails(bundle, generated.directory);
}

export async function runLauncherMenu(): Promise<void> {
  assertInteractiveLauncher();

  const selection = await promptMenu("EchoClaw", [
    {
      id: "connect",
      label: "Connect EchoClaw to your AI agent",
      description:
        "Set up the local EchoClaw MCP, configure wallets, start services, and generate ready connectors for Cursor, Claude Code, Codex, OpenClaw, and a default MCP client.",
    },
    {
      id: "vex",
      label: "Run VEX Agent",
      description: "Reserved for the future VEX runtime. Not available in v1.0.12.",
      disabled: true,
    },
  ]);

  if (selection === "connect") {
    await runConnectFlow();
  }
}
