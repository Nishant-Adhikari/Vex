/**
 * `echoclaw kyberswap chains` — list supported chains and feature availability.
 */

import { Command } from "commander";
import { getKyberChains } from "../../kyberswap/chains.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { colors, infoBox } from "../../utils/ui.js";

export function createChainsSubcommand(): Command {
  return new Command("chains")
    .description("List KyberSwap supported chains and feature availability")
    .exitOverride()
    .action(async () => {
      const chains = getKyberChains();

      if (isHeadless()) {
        writeJsonSuccess({ chains });
        return;
      }

      const lines = chains.map((c) => {
        const features = [
          c.aggregator ? colors.value("Swap") : null,
          c.limitOrder ? colors.value("LO") : null,
          c.zaas ? colors.value("Zap") : null,
        ].filter(Boolean).join(", ");

        return `${colors.info(c.slug.padEnd(12))} ${String(c.chainId).padEnd(6)} ${features}`;
      });

      infoBox(
        "KyberSwap Supported Chains (18)",
        `${"Chain".padEnd(12)} ${"ID".padEnd(6)} Features\n` +
        `${"─".repeat(12)} ${"─".repeat(6)} ${"─".repeat(20)}\n` +
        lines.join("\n"),
      );
    });
}
