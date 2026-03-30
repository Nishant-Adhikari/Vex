import { Command } from "commander";
import { createBrowseSubcommand } from "./browse.js";
import { createTransferSubcommand, createSendTokenSubcommand } from "./transfer.js";
import { createSwapSubcommand } from "./swap.js";
import { createBurnSubcommand, createCloseAccountsSubcommand } from "./burn.js";
import { createPriceSubcommand } from "./price.js";
import { createLendSubcommand } from "./lend.js";
import { createPredictSubcommand } from "./predict.js";

export function createSolanaCommand(): Command {
  const solana = new Command("solana")
    .description("Solana DeFi via Jupiter (swap, browse, price, lend, predict, transfer, burn)")
    .exitOverride();

  solana.addCommand(createBrowseSubcommand());
  solana.addCommand(createPriceSubcommand());
  solana.addCommand(createTransferSubcommand());
  solana.addCommand(createSendTokenSubcommand());
  solana.addCommand(createSwapSubcommand());
  solana.addCommand(createBurnSubcommand());
  solana.addCommand(createCloseAccountsSubcommand());
  solana.addCommand(createLendSubcommand());
  solana.addCommand(createPredictSubcommand());

  return solana;
}
