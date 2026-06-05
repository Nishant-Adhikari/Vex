/**
 * Session-memories — outstanding-item resolution.
 *
 * `markOutstandingResolved`:
 *   - Updates one element of the `outstanding_items` JSONB array by id.
 *   - Re-renders `body_md` from the new state. Caller is responsible for
 *     re-embedding and updating `embedding` + `embedding_model` + dim if the
 *     hash changes substantially; this repo does NOT re-embed on its own
 *     (embedding service IO must be explicit at call sites).
 */

import { getPool, queryOneWith } from "../../client.js";
import { jsonb } from "../../params.js";
import {
  computeBodyMdHash,
  MEMORY_COLUMNS,
  mapRow,
  renderBodyMd,
  toPersistedItem,
  type OutstandingItem,
  type SessionMemory,
  type SessionMemoryRow,
} from "./types.js";

export type ResolveOutstandingResult =
  | { ok: true; memory: SessionMemory }
  | { ok: false; reason: "memory_not_found" | "item_not_found" | "already_resolved" };

/**
 * Resolve a single outstanding item by id. Updates the JSONB array element,
 * re-renders `body_md`, recomputes the row's `updated_at`. Embedding is NOT
 * re-generated here — that requires the embedding service and the caller is
 * responsible (typically the tool handler) for orchestrating that.
 *
 * Concurrency: the read + transform + write runs inside a single
 * transaction with `SELECT ... FOR UPDATE` on the memory row. Two concurrent
 * resolutions race on the lock; the second one re-reads the row's current
 * `outstanding_items` after acquiring it, so a resolution already applied
 * by the first call cleanly returns `already_resolved` rather than
 * silently overwriting the resolution_note. (codex P2 — round 2.)
 */
export async function markOutstandingResolved(
  memoryId: number,
  outstandingItemId: string,
  resolutionNote: string,
  resolutionSource: "agent" | "user" | "auto",
): Promise<ResolveOutstandingResult> {
  const pool = getPool();
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    const lockedRow = await queryOneWith<SessionMemoryRow>(
      tx,
      `SELECT ${MEMORY_COLUMNS} FROM session_memories WHERE id = $1 FOR UPDATE`,
      [memoryId],
    );
    if (!lockedRow) {
      await tx.query("ROLLBACK").catch(() => undefined);
      return { ok: false, reason: "memory_not_found" };
    }
    const existing = mapRow(lockedRow);

    const item = existing.outstandingItems.find((it) => it.id === outstandingItemId);
    if (!item) {
      await tx.query("ROLLBACK").catch(() => undefined);
      return { ok: false, reason: "item_not_found" };
    }
    if (item.resolvedAt !== null) {
      await tx.query("ROLLBACK").catch(() => undefined);
      return { ok: false, reason: "already_resolved" };
    }

    const updatedItems: OutstandingItem[] = existing.outstandingItems.map((it) =>
      it.id === outstandingItemId
        ? {
            ...it,
            resolvedAt: new Date().toISOString(),
            resolutionNote,
            resolutionSource,
          }
        : it,
    );

    const newBodyMd = renderBodyMd({
      happenedMd: existing.happenedMd,
      didMd: existing.didMd,
      triedMd: existing.triedMd,
      outstandingItems: updatedItems,
    });
    const newBodyMdHash = computeBodyMdHash(newBodyMd);

    // Persist via snake_case JSONB (matches migration 016 + unresolved-count
    // SQL). content_hash is NOT updated because the immutable narrative core
    // didn't change (see types.ts content-hash contract). body_md_hash IS
    // updated so a stale `updateEmbedding` call from a concurrent resolution
    // path can be rejected by its WHERE clause (codex PR3-final race fix).
    const persistedItems = updatedItems.map(toPersistedItem);
    const updated = await queryOneWith<SessionMemoryRow>(
      tx,
      `UPDATE session_memories
       SET outstanding_items = $2::jsonb,
           body_md           = $3,
           body_md_hash      = $4,
           updated_at        = NOW()
       WHERE id = $1
       RETURNING ${MEMORY_COLUMNS}`,
      [memoryId, jsonb(persistedItems), newBodyMd, newBodyMdHash],
    );
    await tx.query("COMMIT");
    if (!updated) return { ok: false, reason: "memory_not_found" };
    return { ok: true, memory: mapRow(updated) };
  } catch (err) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    tx.release();
  }
}
