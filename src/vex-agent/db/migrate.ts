/**
 * Vex Agent — auto-migration runner.
 *
 * Reads numbered SQL files from migrations/, checks schema_version table,
 * applies pending migrations in order. Idempotent — safe to run on every startup.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "./client.js";
import logger from "@utils/logger.js";
import { getVexAgentMigrationsDir } from "@utils/package-assets.js";

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const migrationsDir = getVexAgentMigrationsDir();

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
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql") && /^\d{3}_/.test(f))
    .sort();

  let applied = 0;

  for (const file of files) {
    const version = parseInt(file.slice(0, 3), 10);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    logger.info("vex-db.migration.applying", { file });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_version (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      applied++;
      logger.info("vex-db.migration.applied", { file });
    } catch (err) {
      await client.query("ROLLBACK");
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("vex-db.migration.failed", { file, error: msg });
      throw err;
    } finally {
      client.release();
    }
  }

  if (applied > 0) {
    logger.info("vex-db.migrations.completed", { applied });
  } else {
    logger.debug("vex-db.schema.up_to_date");
  }
}
