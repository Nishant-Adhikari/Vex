/**
 * `echoclaw polymarket setup` — auto-generate CLOB API key.
 *
 * Delegates to shared derive module in src/tools/polymarket/derive-credentials.ts.
 * CLI layer handles: confirmation, --force, display. Derive logic lives in tools/.
 */

import { Command } from "commander";
import { hasPolyClobCredentials } from "../../tools/polymarket/auth.js";
import { deriveAndSavePolymarketCredentials } from "../../tools/polymarket/derive-credentials.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";

export function createSetupSubcommand(): Command {
  return new Command("setup")
    .description("Auto-generate Polymarket CLOB API key (one-click)")
    .option("--yes", "Confirm setup")
    .option("--force", "Re-generate even if already configured")
    .exitOverride()
    .action(async (options: { yes?: boolean; force?: boolean }) => {
      if (hasPolyClobCredentials() && !options.force) {
        if (isHeadless()) {
          writeJsonSuccess({ configured: true, message: "Polymarket API key already configured" });
        } else {
          infoBox("Polymarket Setup", "API key already configured. Use --force to re-generate.");
        }
        return;
      }

      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm API key generation");
      }

      const spin = spinner("Generating Polymarket API key...");
      spin.start();

      try {
        spin.text = "Deriving API credentials...";
        const result = await deriveAndSavePolymarketCredentials();
        spin.succeed("Polymarket API key generated");

        if (isHeadless()) {
          writeJsonSuccess({
            configured: true,
            apiKeyPrefix: result.apiKeyPrefix,
            address: result.address,
          });
        } else {
          successBox("Polymarket Setup Complete", [
            `API Key: ${colors.info(result.apiKeyPrefix)}...`,
            `Address: ${colors.muted(result.address)}`,
            `Saved to: ${colors.muted(result.envFilePath)}`,
            "",
            "You can now trade on Polymarket!",
          ].join("\n"));
        }
      } catch (err) {
        spin.fail("Setup failed");
        throw err;
      }
    });
}
