import { Command } from "commander";
import { createChainsSubcommand } from "./chains.js";
import { createTokensSubcommand } from "./tokens.js";
import { createSwapSubcommand } from "./swap.js";
import { createLimitOrderSubcommand } from "./limit-order.js";
import { createZapSubcommand } from "./zap.js";

export function createKyberSwapCommand(): Command {
  const kyberswap = new Command("kyberswap")
    .description("Multi-chain EVM swaps, limit orders, and liquidity via KyberSwap (18 chains, 400+ DEXs)")
    .exitOverride();

  kyberswap.addCommand(createChainsSubcommand());
  kyberswap.addCommand(createTokensSubcommand());
  kyberswap.addCommand(createSwapSubcommand());
  kyberswap.addCommand(createLimitOrderSubcommand());
  kyberswap.addCommand(createZapSubcommand());

  return kyberswap;
}
