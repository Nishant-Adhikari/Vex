/**
 * `echoclaw kyberswap tokens` — token search and honeypot/FOT check.
 */

import { Command } from "commander";
import { getKyberTokenApiClient } from "../../tools/kyberswap/token-api/client.js";
import { resolveChainWithId } from "./helpers.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, infoBox, successBox, colors } from "../../utils/ui.js";
import { parseIntSafe } from "../../utils/validation.js";

export function createTokensSubcommand(): Command {
  const tokens = new Command("tokens")
    .description("Token search and safety checks via KyberSwap Token API")
    .exitOverride();

  tokens
    .command("search <query>")
    .description("Search tokens by name or symbol")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .option("--whitelisted", "Only show KyberSwap-vetted tokens")
    .option("--limit <n>", "Max results", "10")
    .action(async (query: string, options: { chain: string; whitelisted?: boolean; limit: string }) => {
      const { chainId } = resolveChainWithId(options.chain);
      const limit = parseIntSafe(options.limit, "limit");
      const client = getKyberTokenApiClient();

      const spin = spinner("Searching tokens...");
      spin.start();

      const tokens = await client.searchTokens(String(chainId), {
        name: query,
        isWhitelisted: options.whitelisted ?? true,
        pageSize: limit,
      });

      spin.succeed(`Found ${tokens.length} token(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ tokens, chainId, query });
        return;
      }

      if (tokens.length === 0) {
        infoBox("Token Search", `No tokens found for "${query}" on chain ${chainId}`);
        return;
      }

      const lines = tokens.map((t) => {
        const cap = t.marketCap ? `MC: $${(t.marketCap / 1e6).toFixed(1)}M` : "";
        const flags = [
          t.isWhitelisted ? "WL" : null,
          t.isVerified ? "V" : null,
          t.isStable ? "S" : null,
        ].filter(Boolean).join(",");
        return `${colors.value(t.symbol.padEnd(8))} ${t.name.padEnd(20)} ${t.address}\n  ${cap} ${flags ? `[${flags}]` : ""}`;
      });

      infoBox("Token Search Results", lines.join("\n"));
    });

  tokens
    .command("check <address>")
    .description("Check if a token is a honeypot or has fee-on-transfer")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .action(async (address: string, options: { chain: string }) => {
      const { chainId } = resolveChainWithId(options.chain);
      const client = getKyberTokenApiClient();

      const spin = spinner("Checking token safety...");
      spin.start();

      const info = await client.getHoneypotFotInfo(chainId, address);

      if (info.isHoneypot) {
        spin.fail("HONEYPOT DETECTED");
      } else if (info.isFOT) {
        spin.warn("Fee-on-transfer token");
      } else {
        spin.succeed("Token appears safe");
      }

      if (isHeadless()) {
        writeJsonSuccess({ address, chainId, ...info });
        return;
      }

      const status = info.isHoneypot
        ? `${colors.error("HONEYPOT")} — Cannot sell after buying!`
        : info.isFOT
          ? `${colors.warn("FEE-ON-TRANSFER")} — Tax: ${info.tax}%`
          : `${colors.value("SAFE")} — No honeypot or FOT detected`;

      const boxFn = info.isHoneypot ? infoBox : successBox;
      boxFn("Token Safety Check", `Address: ${address}\nChain: ${chainId}\nResult: ${status}`);
    });

  return tokens;
}
