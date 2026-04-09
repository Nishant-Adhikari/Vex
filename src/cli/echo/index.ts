import { EchoError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";
import { runConnectFlow, runLauncherMenu } from "./flow.js";

export function buildEchoHelpText(): string {
  return [
    "Usage:",
    "  echoclaw echo",
    "  echoclaw echo connect",
    "",
    "Commands:",
    "  echo           Open the EchoClaw MCP launcher.",
    "  echo connect   Skip the top-level menu and run the MCP setup flow directly.",
  ].join("\n");
}

function printEchoHelp(): void {
  for (const line of buildEchoHelpText().split("\n")) {
    writeStderr(line);
  }
}

export async function runEchoCli(argv: readonly string[] = []): Promise<void> {
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
    printEchoHelp();
    return;
  }

  throw new EchoError(
    ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    `Unknown echoclaw echo subcommand: ${subcommand}`,
    "Use `echoclaw echo` or `echoclaw echo connect`.",
  );
}
