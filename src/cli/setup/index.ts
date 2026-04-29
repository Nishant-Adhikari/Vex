import { VexError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";
import { runConnectFlow, runLauncherMenu } from "./flow.js";

export function buildSetupHelpText(): string {
  return [
    "Usage:",
    "  vex setup",
    "  vex setup connect",
    "",
    "Commands:",
    "  setup           Open the Vex MCP launcher.",
    "  setup connect   Skip the top-level menu and run the MCP setup flow directly.",
  ].join("\n");
}

function printSetupHelp(): void {
  for (const line of buildSetupHelpText().split("\n")) {
    writeStderr(line);
  }
}

export async function runSetupCli(argv: readonly string[] = []): Promise<void> {
  const [subcommand] = argv;

  if (!subcommand) {
    await runLauncherMenu();
    return;
  }

  if (subcommand === "connect") {
    await runConnectFlow();
    return;
  }

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printSetupHelp();
    return;
  }

  throw new VexError(
    ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    `Unknown vex setup subcommand: ${subcommand}`,
    "Use `vex setup` or `vex setup connect`.",
  );
}
