/**
 * Echo Agent — auto-migration runner.
 *
 * Reads numbered SQL files from migrations/, checks schema_version table,
 * applies pending migrations in order. Idempotent — safe to run on every startup.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./client.js";
import logger from "@utils/logger.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations(): Promise<void> {
  const pool = getPool();

  // Ensure schema_version table exists (bootstrap)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get current version
  const result = await pool.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0) AS version FROM schema_version",
  );
  const currentVersion = result.rows[0]?.version ?? 0;

  // Find migration files
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql") && /^\d{3}_/.test(f))
    .sort();

  let applied = 0;

  for (const file of files) {
    const version = parseInt(file.slice(0, 3), 10);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    logger.info("echo-db.migration.applying", { file });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_version (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      applied++;
      logger.info("echo-db.migration.applied", { file });
    } catch (err) {
      await client.query("ROLLBACK");
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("echo-db.migration.failed", { file, error: msg });
      throw err;
    } finally {
      client.release();
    }
  }

  if (applied > 0) {
    logger.info("echo-db.migrations.completed", { applied });
  } else {
    logger.debug("echo-db.schema.up_to_date");
  }
}
