/**
 * Runtime-env facade for vex-app main.
 *
 * vex-app main has no `@providers` alias (only `@vex-lib`, `@vex-agent`,
 * `@tools`, `@utils`, `@config`). It needs `loadProviderDotenv` to populate
 * `process.env` with NON-secret runtime config from `${CONFIG_DIR}/.env`
 * (`AGENT_MODEL`, `AGENT_PROVIDER`, `AGENT_CONTEXT_LIMIT`, `EMBEDDING_*`, …).
 * Managed secrets are skipped — they live in the encrypted vault and are
 * injected separately on unlock.
 *
 * Re-exported here so main imports it as `@vex-lib/runtime-env.js`, matching
 * the established `src/lib` facade pattern (see `dotenv.ts`, `wallet.ts`).
 */
export { loadProviderDotenv } from "../providers/env-resolution.js";
