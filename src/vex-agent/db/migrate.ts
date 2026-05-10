/**
 * Vex Agent — auto-migration entrypoint.
 *
 * Thin delegation to the shared runner in src/lib/db/migrate-runner.ts.
 * Signature stays `Promise<void>` so existing consumers (MCP bootstrap,
 * integration globalSetup, knowledge-import script, idempotency test)
 * continue to work unchanged. The shared runner adds advisory-lock
 * concurrency safety + per-statement timeouts, both of which are also
 * desirable here.
 */

import {
  runMigrationsWithProgress,
  MigrationError,
} from "../../lib/db/migrate-runner.js";
import { getPool } from "./client.js";
import logger from "@utils/logger.js";
import { getVexAgentMigrationsDir } from "@utils/package-assets.js";

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const migrationsDir = getVexAgentMigrationsDir();

  try {
    const result = await runMigrationsWithProgress({
      pool,
      migrationsDir,
      onProgress: (event) => {
        if (event.phase === "start") {
          logger.info("vex-db.migration.applying", { file: event.file });
        } else if (event.phase === "applied") {
          logger.info("vex-db.migration.applied", { file: event.file });
        }
      },
    });

    if (result.applied > 0) {
      logger.info("vex-db.migrations.completed", { applied: result.applied });
    } else {
      logger.debug("vex-db.schema.up_to_date");
    }
  } catch (err: unknown) {
    if (err instanceof MigrationError) {
      logger.error("vex-db.migration.failed", {
        file: err.file,
        version: err.version,
        error: err.cause instanceof Error ? err.cause.message : String(err.cause),
      });
    }
    throw err;
  }
}
