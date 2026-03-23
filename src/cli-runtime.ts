import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { createConfigCommand } from "./commands/config.js";
import { createWalletCommand, importPrivateKeyAction } from "./commands/wallet/index.js";
import { createSendCommand } from "./commands/send.js";
import { createJaineCommand } from "./commands/jaine/index.js";
import { createSlopCommand } from "./commands/slop/index.js";
import { createSlopAppCommand } from "./commands/slop-app/index.js";
import { createEchoBookCommand } from "./commands/echobook/index.js";
import { createSetupCommand } from "./commands/setup.js";
import { createChainScanCommand } from "./commands/chainscan/index.js";
import { createKhalaniCommand } from "./commands/khalani/index.js";
import { createKyberSwapCommand } from "./commands/kyberswap/index.js";
import { createPolymarketCommand } from "./commands/polymarket/index.js";
import { createDexScreenerCommand } from "./commands/dexscreener/index.js";
import { createSlopStreamCommand } from "./commands/slop-stream.js";
import { createBotCommand } from "./commands/marketmaker/index.js";
import { create0gComputeCommand } from "./commands/0g-compute/index.js";
import { create0gStorageCommand } from "./commands/0g-storage/index.js";
import { createSkillCommand, createInstallAlias } from "./commands/skill.js";
import { createEchoCommand } from "./commands/echo/index.js";
import { createSolanaCommand } from "./commands/solana/index.js";
import { errorBox } from "./utils/ui.js";
import { setJsonMode, isHeadless, writeJsonError } from "./utils/output.js";
import { EchoError } from "./errors.js";
import { createUpdateCommand } from "./commands/update/index.js";
import { createCliPreAction } from "./cli-auto-update.js";
import { loadProviderDotenv } from "./providers/env-resolution.js";

/**
 * Global error handler for consistent error output.
 * Outputs JSON error in headless mode, UI box otherwise.
 */
export function handleError(err: unknown): never {
  // Handle Commander errors (unknown option, missing required, etc.)
  if (err instanceof CommanderError) {
    // Skip help/version exits (exitCode 0)
    if (err.exitCode === 0) {
      process.exit(0);
    }

    // Safety net: detect legacy `bot` command usage
    const firstCmd = process.argv.slice(2).find((a) => !a.startsWith("-"));
    if (firstCmd === "bot") {
      if (isHeadless()) {
        writeJsonError("CLI_ERROR", "Command 'bot' is not available", "Use: echoclaw marketmaker ... (alias: echoclaw mm ...)");
      } else {
        process.stderr.write("\n  Command 'bot' is not available. Use: echoclaw marketmaker ... (alias: echoclaw mm ...)\n\n");
      }
      process.exit(1);
    }

    if (isHeadless()) {
      writeJsonError("CLI_ERROR", err.message);
    } else {
      errorBox("CLI Error", err.message);
    }
    process.exit(1);
  }

  if (err instanceof EchoError) {
    if (isHeadless()) {
      writeJsonError(err.code, err.message, err.hint, {
        retryable: err.retryable,
        externalName: err.externalName,
      });
    } else {
      const content = err.hint ? `${err.message}\n\nHint: ${err.hint}` : err.message;
      errorBox(err.code, content);
    }
  } else {
    const message = err instanceof Error ? err.message : String(err);
    if (isHeadless()) {
      writeJsonError("UNKNOWN_ERROR", message);
    } else {
      errorBox("Error", message);
    }
  }
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

function configureProgramOutput(program: Command): void {
  program.configureOutput({
    writeOut: (str) => {
      if (isHeadless()) {
        process.stderr.write(str);
      } else {
        process.stdout.write(str);
      }
    },
    writeErr: (str) => process.stderr.write(str),
  });
}

function addProgramCommands(program: Command): void {
  const importAlias = new Command("import")
    .description("Import private key (alias for: wallet import)")
    .argument("[privateKey]", "Private key hex (0x-prefixed or raw)")
    .option("--stdin", "Read private key from stdin")
    .option("--force", "Overwrite existing keystore (auto-backup first)")
    .exitOverride()
    .action(importPrivateKeyAction);
  program.addCommand(importAlias);

  program.addCommand(createConfigCommand());
  program.addCommand(createWalletCommand());
  program.addCommand(createSendCommand());
  program.addCommand(createJaineCommand());
  program.addCommand(createSlopCommand());
  program.addCommand(createSlopAppCommand());
  program.addCommand(createEchoBookCommand());
  program.addCommand(createChainScanCommand());
  program.addCommand(createKhalaniCommand());
  program.addCommand(createKyberSwapCommand());
  program.addCommand(createPolymarketCommand());
  program.addCommand(createDexScreenerCommand());
  program.addCommand(createSetupCommand());
  program.addCommand(createSlopStreamCommand());
  program.addCommand(createBotCommand());
  program.addCommand(create0gComputeCommand());
  program.addCommand(create0gStorageCommand());
  program.addCommand(createEchoCommand());
  program.addCommand(createSolanaCommand());
  program.addCommand(createSkillCommand());
  program.addCommand(createInstallAlias());
  program.addCommand(createUpdateCommand());
}

export function createCliProgram(
  currentVersion = pkg.version,
  dependencies?: Parameters<typeof createCliPreAction>[2],
): Command {
  const program = new Command();

  program
    .name("echoclaw")
    .description("EchoClaw CLI for 0G Network")
    .version(currentVersion)
    .option("--json", "Output in JSON format (implies headless mode)")
    .hook("preAction", createCliPreAction(program, currentVersion, dependencies));

  configureProgramOutput(program);
  program.exitOverride();
  addProgramCommands(program);
  return program;
}

export function initializeCliJsonMode(argv = process.argv): void {
  if (argv.includes("--json")) {
    setJsonMode(true);
  }
}

let unhandledRejectionHandlerInstalled = false;

function installUnhandledRejectionHandler(): void {
  if (unhandledRejectionHandlerInstalled) {
    return;
  }

  process.on("unhandledRejection", (err) => {
    handleError(err);
  });
  unhandledRejectionHandlerInstalled = true;
}

export async function runCli(argv = process.argv): Promise<void> {
  loadProviderDotenv();
  initializeCliJsonMode(argv);
  installUnhandledRejectionHandler();
  const program = createCliProgram();
  await program.parseAsync(argv);
}
