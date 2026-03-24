import { createHash } from "node:crypto";
import { query, queryOne, execute } from "../client.js";

interface MemoryRow { id: number; content: string; category: string | null; source: string | null; created_at: string }

/** Append a memory entry with hash-based dedup. Returns true if inserted, false if duplicate. */
export async function appendMemory(content: string, category?: string, source = "agent"): Promise<boolean> {
  const normalized = content.trim();
  if (!normalized) return false;
  const hash = createHash("md5").update(normalized).digest("hex");

  // Race-safe: UNIQUE index on content_hash + ON CONFLICT prevents duplicates
  const result = await execute(
    `INSERT INTO memory_entries (content, category, source, content_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (content_hash) WHERE content_hash IS NOT NULL DO NOTHING`,
    [normalized, category ?? null, source, hash],
  );
  return result === 1;
}

export async function getMemoryEntries(limit = 200): Promise<MemoryRow[]> {
  return query<MemoryRow>(
    "SELECT id, content, category, source, created_at FROM memory_entries ORDER BY created_at ASC LIMIT $1",
    [limit],
  );
}

/** Concatenate memory entries into a single text block (replaces memory.md). */
export async function getMemoryAsText(limit?: number): Promise<string> {
  const entries = await getMemoryEntries(limit ?? 500);
  if (entries.length === 0) return "";
  return entries.map(e => e.content).join("\n\n");
}

export async function getMemorySize(): Promise<number> {
  const text = await getMemoryAsText();
  return Buffer.byteLength(text, "utf-8");
}

// ── CRUD operations for memory_manage tool ──────────────────────────

export interface MemoryEntry {
  id: number;
  content: string;
  category: string | null;
  createdAt: string;
}

/** List all entries with IDs so the agent can reference them for replace/delete. */
export async function listEntriesWithIds(limit = 500): Promise<MemoryEntry[]> {
  const rows = await query<MemoryRow>(
    "SELECT id, content, category, created_at FROM memory_entries ORDER BY created_at ASC LIMIT $1",
    [limit],
  );
  return rows.map(r => ({
    id: r.id,
    content: r.content,
    category: r.category,
    createdAt: r.created_at,
  }));
}

/** Replace the content of a specific memory entry by ID. Handles hash collisions via dedup. */
export async function replaceEntry(id: number, content: string): Promise<boolean> {
  if (id <= 0) return false;
  if (!content || content.trim().length === 0) return false;
  const normalized = content.trim();
  const hash = createHash("md5").update(normalized).digest("hex");

  // Check if another entry already has this content (hash collision = dedup)
  const existing = await queryOne<{ id: number }>(
    "SELECT id FROM memory_entries WHERE content_hash = $1 AND id != $2 LIMIT 1",
    [hash, id],
  );
  if (existing) {
    // Content already exists elsewhere — delete this entry to avoid duplication
    await execute("DELETE FROM memory_entries WHERE id = $1", [id]);
    return true;
  }

  const rowCount = await execute(
    "UPDATE memory_entries SET content = $1, content_hash = $2 WHERE id = $3",
    [normalized, hash, id],
  );
  return rowCount === 1;
}

/** Delete a specific memory entry by ID. */
export async function deleteEntry(id: number): Promise<boolean> {
  if (id <= 0) return false;
  const rowCount = await execute(
    "DELETE FROM memory_entries WHERE id = $1",
    [id],
  );
  return rowCount === 1;
}
