export const MASTER_PASSWORD_ENV_KEY = "VEX_KEYSTORE_PASSWORD" as const;

export const VAULT_SECRET_KEYS = [
  "OPENROUTER_API_KEY",
  "JUPITER_API_KEY",
  "TAVILY_API_KEY",
  "RETTIWT_API_KEY",
  "POLYMARKET_API_KEY",
  "POLYMARKET_API_SECRET",
  "POLYMARKET_PASSPHRASE",
] as const;

export type VaultSecretKey = (typeof VAULT_SECRET_KEYS)[number];

export const MANAGED_SECRET_ENV_KEYS = [
  MASTER_PASSWORD_ENV_KEY,
  ...VAULT_SECRET_KEYS,
] as const;

export function isVaultSecretKey(key: string): key is VaultSecretKey {
  return (VAULT_SECRET_KEYS as readonly string[]).includes(key);
}

export function isManagedSecretEnvKey(key: string): boolean {
  return (MANAGED_SECRET_ENV_KEYS as readonly string[]).includes(key);
}
