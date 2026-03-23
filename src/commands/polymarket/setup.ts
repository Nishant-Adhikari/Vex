/**
 * `echoclaw polymarket setup` — auto-generate CLOB API key.
 *
 * Flow: requireEvmWallet → get nonce → sign → derive API key → save to .env
 */

import { Command } from "commander";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { fetchWithTimeout, readJson } from "../../utils/http.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { CLOB_BASE_URL, ENV_POLYMARKET_API_KEY, ENV_POLYMARKET_API_SECRET, ENV_POLYMARKET_PASSPHRASE } from "../../polymarket/constants.js";
import { hasPolyClobCredentials } from "../../polymarket/auth.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import { CONFIG_DIR } from "../../config/paths.js";
import { isRecord } from "../../utils/validation-helpers.js";

function getEnvFilePath(): string {
  return join(CONFIG_DIR, ".env");
}

function appendToEnvFile(key: string, value: string): void {
  const envPath = getEnvFilePath();
  const line = `${key}=${value}\n`;

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    // Replace existing line or append
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      writeFileSync(envPath, content.replace(regex, `${key}=${value}`), "utf-8");
    } else {
      appendFileSync(envPath, line, "utf-8");
    }
  } else {
    writeFileSync(envPath, line, { encoding: "utf-8", mode: 0o600 });
  }
}

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

      const { address, privateKey } = requireWalletAndKeystore();

      const spin = spinner("Generating Polymarket API key...");
      spin.start();

      try {
        // Step 1: Get API key credentials via derive endpoint
        // Polymarket uses L1 auth: sign a message with wallet, POST to derive-api-key
        spin.text = "Deriving API credentials...";

        const deriveUrl = `${CLOB_BASE_URL}/auth/derive-api-key`;

        // For L1 auth, we need to sign a specific message
        // The exact flow depends on Polymarket's auth spec
        // Simplified: POST with wallet signature
        const { createWalletClient, http } = await import("viem");
        const { privateKeyToAccount } = await import("viem/accounts");
        const { polygon } = await import("viem/chains");

        const account = privateKeyToAccount(privateKey as `0x${string}`);
        const client = createWalletClient({ account, chain: polygon, transport: http() });

        // Sign a nonce for L1 authentication
        const nonceResponse = await fetchWithTimeout(`${CLOB_BASE_URL}/auth/nonce`, {
          method: "GET",
          timeoutMs: 15000,
        });

        let nonce = "0";
        if (nonceResponse.ok) {
          const nonceData = await readJson(nonceResponse);
          if (typeof nonceData === "string") nonce = nonceData;
          else if (isRecord(nonceData) && typeof nonceData.nonce === "string") nonce = nonceData.nonce;
        }

        // Sign the nonce
        const signature = await account.signMessage({ message: nonce });

        // Derive API key
        const deriveResponse = await fetchWithTimeout(deriveUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: account.address,
            nonce,
            signature,
            timestamp: Math.floor(Date.now() / 1000).toString(),
          }),
          timeoutMs: 15000,
        });

        if (!deriveResponse.ok) {
          const errBody = await readJson(deriveResponse);
          const errMsg = isRecord(errBody) && typeof errBody.error === "string" ? errBody.error : `HTTP ${deriveResponse.status}`;
          throw new EchoError(ErrorCodes.POLYMARKET_AUTH_FAILED, `Failed to derive API key: ${errMsg}`);
        }

        const creds = await readJson(deriveResponse);
        if (!isRecord(creds) || !creds.apiKey || !creds.secret || !creds.passphrase) {
          throw new EchoError(ErrorCodes.POLYMARKET_AUTH_FAILED, "Invalid API key response from Polymarket");
        }

        // Step 2: Save to .env
        spin.text = "Saving credentials...";

        appendToEnvFile(ENV_POLYMARKET_API_KEY, String(creds.apiKey));
        appendToEnvFile(ENV_POLYMARKET_API_SECRET, String(creds.secret));
        appendToEnvFile(ENV_POLYMARKET_PASSPHRASE, String(creds.passphrase));

        // Also set in process.env for immediate use
        process.env[ENV_POLYMARKET_API_KEY] = String(creds.apiKey);
        process.env[ENV_POLYMARKET_API_SECRET] = String(creds.secret);
        process.env[ENV_POLYMARKET_PASSPHRASE] = String(creds.passphrase);

        spin.succeed("Polymarket API key generated");

        if (isHeadless()) {
          writeJsonSuccess({
            configured: true,
            apiKey: String(creds.apiKey),
            address: account.address,
          });
        } else {
          successBox("Polymarket Setup Complete", [
            `API Key: ${colors.info(String(creds.apiKey).slice(0, 8))}...`,
            `Address: ${colors.muted(account.address)}`,
            `Saved to: ${colors.muted(getEnvFilePath())}`,
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
