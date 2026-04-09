import { EchoError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";

export function buildVexHelpText(): string {
  return [
    "Usage:",
    "  echoclaw vex",
    "",
    "Status:",
    "  VEX Agent launcher is coming soon.",
  ].join("\n");
}

export async function runVexCli(argv: readonly string[] = []): Promise<void> {
  const [subcommand] = argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    for (const line of buildVexHelpText().split("\n")) {
      writeStderr(line);
    }
    return;
  }

  throw new EchoError(
    ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    `Unknown echoclaw vex subcommand: ${subcommand}`,
    "Use `echoclaw vex` to inspect the placeholder entrypoint.",
  );
}
