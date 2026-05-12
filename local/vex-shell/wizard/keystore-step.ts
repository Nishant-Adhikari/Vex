/**
 * Keystore password — ensure `VEX_KEYSTORE_PASSWORD` exists in the .env +
 * process.env. Reuses the bundled env file via `synchronizeTrackedEnv` so
 * values survive across wizard + chat runs.
 */

import { password, isCancel, log } from "@clack/prompts";
import { readAppEnvMap } from "../../../src/cli/setup/status.js";
import { writeAppEnvValue } from "../../../src/providers/env-resolution.js";
import { synchronizeTrackedEnv } from "../../../src/cli/setup/setup.js";

const MIN_PASSWORD_LENGTH = 8;

export interface KeystoreOutcome {
  aborted: boolean;
  wasMissing: boolean;
}

export async function runKeystoreStep(): Promise<KeystoreOutcome> {
  const envMap = readAppEnvMap();
  const existing = envMap.VEX_KEYSTORE_PASSWORD?.trim();
  if (existing) {
    process.env.VEX_KEYSTORE_PASSWORD = existing;
    log.info("Keystore password already configured.");
    return { aborted: false, wasMissing: false };
  }

  log.step("Keystore password");
  log.info(
    "Create the password that will protect and unlock your local EVM and Solana keystores. Minimum 8 characters.",
  );

  while (true) {
    const first = await password({
      message: "Enter VEX_KEYSTORE_PASSWORD",
      validate: (value) => {
        if (!value || value.length < MIN_PASSWORD_LENGTH) {
          return `At least ${MIN_PASSWORD_LENGTH} characters required.`;
        }
        return undefined;
      },
    });
    if (isCancel(first)) return { aborted: true, wasMissing: true };

    const confirm = await password({
      message: "Confirm VEX_KEYSTORE_PASSWORD",
      validate: (value) => (value === first ? undefined : "Passwords do not match."),
    });
    if (isCancel(confirm)) return { aborted: true, wasMissing: true };

    writeAppEnvValue("VEX_KEYSTORE_PASSWORD", first);
    process.env.VEX_KEYSTORE_PASSWORD = first;
    synchronizeTrackedEnv();
    log.success("Stored VEX_KEYSTORE_PASSWORD in CONFIG_DIR/.env.");
    return { aborted: false, wasMissing: true };
  }
}
