/**
 * Memory repo — append log with hash-based dedup.
 */

import { createHash } from "node:crypto";
import { query, queryOne, execute } from "../client.js";

interface MemoryRow { id: number; content_md: string; category: string | null; source: string | null; created_at: string }

export interface MemoryEntry {
  id: number;
  contentMd: string;
  category: string | null;
  createdAt: string;
}

/** Append a memory entry with hash-based dedup. Returns true if inserted, false if duplicate. */
export async function appendMemory(contentMd: string, category?: string, source = "agent"): Promise<boolean> {
  const normalized = contentMd.trim();
  if (!normalized) return false;
  const hash = createHash("md5").update(normalized).digest("hex");

  const result = await execute(
    `INSERT INTO memory_entries (content_md, category, source, content_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (content_hash) WHERE content_hash IS NOT NULL DO NOTHING`,
    [normalized, category ?? null, source, hash],
  );
  return result === 1;
}

/** List all entries with IDs for replace/delete. */
export async function listEntriesWithIds(limit = 500): Promise<MemoryEntry[]> {
  const rows = await query<MemoryRow>(
    "SELECT id, content_md, category, created_at FROM memory_entries ORDER BY created_at ASC LIMIT $1",
    [limit],
  );
  return rows.map(r => ({ id: r.id, contentMd: r.content_md, category: r.category, createdAt: r.created_at }));
}

/** Replace the content of a specific entry by ID. Handles hash dedup. */
export async function replaceEntry(id: number, contentMd: string): Promise<boolean> {
  if (id <= 0) return false;
  const normalized = contentMd.trim();
  if (!normalized) return false;
  const hash = createHash("md5").update(normalized).digest("hex");

  // If another entry already has this content, delete this one to avoid duplication
  const existing = await queryOne<{ id: number }>(
    "SELECT id FROM memory_entries WHERE content_hash = $1 AND id != $2 LIMIT 1",
    [hash, id],
  );
  if (existing) {
    await execute("DELETE FROM memory_entries WHERE id = $1", [id]);
    return true;
  }

  const rowCount = await execute(
    "UPDATE memory_entries SET content_md = $1, content_hash = $2, updated_at = NOW() WHERE id = $3",
    [normalized, hash, id],
  );
  return rowCount === 1;
}

/** Delete a specific entry by ID. */
export async function deleteEntry(id: number): Promise<boolean> {
  if (id <= 0) return false;
  const rowCount = await execute("DELETE FROM memory_entries WHERE id = $1", [id]);
  return rowCount === 1;
}

/** Concatenate memory entries into a single text block. */
export async function getMemoryAsText(limit = 500): Promise<string> {
  const entries = await query<MemoryRow>(
    "SELECT content_md FROM memory_entries ORDER BY created_at ASC LIMIT $1",
    [limit],
  );
  if (entries.length === 0) return "";
  return entries.map(e => e.content_md).join("\n\n");
}
