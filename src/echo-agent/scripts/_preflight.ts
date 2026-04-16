/**
 * Shared pre-flight checks for maintenance scripts.
 *
 * These guards exist because the maintenance commands (knowledge-export,
 * knowledge-import, knowledge-reembed) operate on production data and a
 * wrong-DB or stale-schema run is essentially data loss. The runtime path
 * (MCP server, internal tools) keeps using getPool() with the dev fallback
 * for backwards compatibility — that's a separate audit item, not in scope
 * here. Maintenance scripts MUST be stricter than runtime.
 *
 * Two checks:
 *   1. assertExplicitDbUrl — ECHO_AGENT_DB_URL must be set (no silent fallback
 *      to echo_agent_test). Operators backing up the wrong DB is a real
 *      data-loss scenario.
 *   2. assertSchemaUpToDate — knowledge_entries.supersedes_id column must
 *      exist (added by 006_knowledge_lifecycle.sql). migrate.ts is strictly
 *      forward-only, so this column is the canary for "runMigrations has been
 *      run against this volume on a build that includes 006". We check the
 *      most recently added column rather than an old one so future migrations
 *      can just update the canary instead of rewriting the guard logic.
 */

import { queryOne } from "@echo-agent/db/client.js";

/**
 * Refuses to proceed when ECHO_AGENT_DB_URL is unset / empty / whitespace.
 * Writes an actionable error to stderr and exits with code 2.
 */
export function assertExplicitDbUrl(commandName: string): void {
  const url = (process.env.ECHO_AGENT_DB_URL ?? "").trim();
  if (url.length === 0) {
    process.stderr.write(
      `${commandName}: ECHO_AGENT_DB_URL is required for maintenance commands.\n` +
        `Refusing to run with the dev fallback (echo_agent_test) — operating on\n` +
        `the wrong DB silently produces/consumes data and breaks recovery.\n\n` +
        `Set it explicitly:\n` +
        `  export ECHO_AGENT_DB_URL=postgresql://echo_agent:echo_agent@localhost:5777/echo_agent\n\n` +
        `Or source the dev .env:\n` +
        `  set -a; . docker/echo-agent/.env; set +a\n`,
    );
    process.exit(2);
  }
}

/**
 * Verifies that the schema includes the most recently added lifecycle column.
 * Run AFTER runMigrations() so a fresh DB gets the schema applied; if it's
 * still missing after migrations, something went wrong applying 006.
 */
export async function assertSchemaUpToDate(): Promise<void> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'knowledge_entries' AND column_name = 'supersedes_id'
     ) AS exists`,
  );
  if (!row?.exists) {
    process.stderr.write(
      `knowledge_entries.supersedes_id column missing — migration 006_knowledge_lifecycle.sql\n` +
        `has not been applied to this DB. runMigrations should have picked it up\n` +
        `automatically on startup; if it did not, check the migration logs and\n` +
        `verify that the migrations directory is being read correctly.\n\n` +
        `If you are on an older build and need a clean wipe:\n` +
        `  docker compose -f docker/echo-agent/docker-compose.dev.yml down -v\n` +
        `  docker compose -f docker/echo-agent/docker-compose.dev.yml up -d\n\n` +
        `WARNING: this destroys all local data. Use 'pg_dump' MANUALLY first\n` +
        `if you need to preserve it — knowledge-export cannot run on a schema\n` +
        `missing the lifecycle columns.\n`,
    );
    process.exit(2);
  }
}
