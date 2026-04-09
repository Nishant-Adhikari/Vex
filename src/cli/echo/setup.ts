import { REQUIRED_ENV } from "../../mcp/bootstrap.js";
import { loadProviderDotenv, writeAppEnvValue } from "../../providers/env-resolution.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";
import { getEnvExamplePath } from "./package-assets.js";
import { readAppEnvMap } from "./status.js";
import { promptSecret, renderSection } from "./ui.js";

const TRACKED_ENV_KEYS = [...REQUIRED_ENV, "ECHO_KEYSTORE_PASSWORD", "TAVILY_API_KEY", "POLYMARKET_API_KEY"];

function readBundledEnvDefaults(): Record<string, string> {
  return readAppEnvMap(getEnvExamplePath());
}

export function synchronizeTrackedEnv(): void {
  const envMap = readAppEnvMap();

  for (const key of TRACKED_ENV_KEYS) {
    const value = envMap[key];
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  loadProviderDotenv();
}

export function ensureRequiredEnvDefaults(): void {
  const current = readAppEnvMap();
  const defaults = readBundledEnvDefaults();

  for (const key of REQUIRED_ENV) {
    if ((current[key] ?? "").trim()) {
      continue;
    }

    const fallback = defaults[key];
    if (!fallback) {
      throw new EchoError(
        ErrorCodes.SYSTEM_CHECK_FAILED,
        `Bundled default for ${key} is missing.`,
        "The published package must include docker/echo-agent/.env.example with the required local defaults.",
      );
    }

    writeAppEnvValue(key, fallback);
    process.env[key] = fallback;
    writeStderr(`Configured ${key} from bundled local defaults.`);
  }
}

export async function ensureKeystorePassword(): Promise<void> {
  const envMap = readAppEnvMap();
  const existingPassword = envMap.ECHO_KEYSTORE_PASSWORD?.trim();

  if (existingPassword) {
    process.env.ECHO_KEYSTORE_PASSWORD = existingPassword;
    return;
  }

  renderSection(
    "Password",
    "Create the password that will protect and unlock your local EVM and Solana keystores.",
  );

  while (true) {
    const password = await promptSecret("Enter ECHO_KEYSTORE_PASSWORD");
    if (password.length < 8) {
      writeStderr("Password must be at least 8 characters long.");
      continue;
    }

    const confirmation = await promptSecret("Confirm ECHO_KEYSTORE_PASSWORD");
    if (password !== confirmation) {
      writeStderr("Passwords do not match. Try again.");
      continue;
    }

    writeAppEnvValue("ECHO_KEYSTORE_PASSWORD", password);
    process.env.ECHO_KEYSTORE_PASSWORD = password;
    writeStderr("Stored ECHO_KEYSTORE_PASSWORD in CONFIG_DIR/.env.");
    return;
  }
}
