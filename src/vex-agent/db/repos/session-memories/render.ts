/**
 * Session-memories — materialized chunk render (outstanding items, body_md,
 * body_md_hash, content_hash) computed exactly once from the caller's inputs.
 *
 * Track 2 (the chunking worker) calls `prepareMemoryRender` BEFORE embedding
 * so the bytes fed into `embedDocument` are byte-identical to the `body_md`
 * persisted by `insertPreparedMemory`.
 */

import {
  computeBodyMdHash,
  computeContentHash,
  newOutstandingItem,
  renderBodyMd,
  type OutstandingItem,
} from "./types.js";

/**
 * Materialized chunk render — outstanding items, body_md, and content_hash
 * computed exactly once from the caller's inputs. Track 2 (the chunking
 * worker) calls `prepareMemoryRender` BEFORE embedding so the bytes fed
 * into `embedDocument` are byte-identical to the `body_md` persisted by
 * `insertPreparedMemory` — that pair guarantees the recall-time embedding
 * vector continues to represent what's actually stored in the row.
 *
 * Without this split, the worker would render+embed, then `insertMemories`
 * would generate FRESH `randomUUID()` outstanding items and re-render
 * `body_md`, and the embedding vector would describe a body the DB no
 * longer contains. Codex flagged this as a correctness blocker.
 */
export interface PreparedMemoryRender {
  outstandingItems: readonly OutstandingItem[];
  bodyMd: string;
  bodyMdHash: string;
  contentHash: string;
}

export function prepareMemoryRender(parts: {
  theme: string;
  happenedMd: string;
  didMd: string;
  triedMd: string;
  outstandingTexts: readonly string[];
}): PreparedMemoryRender {
  const outstandingItems: OutstandingItem[] = parts.outstandingTexts.map(newOutstandingItem);
  const bodyMd = renderBodyMd({
    happenedMd: parts.happenedMd,
    didMd: parts.didMd,
    triedMd: parts.triedMd,
    outstandingItems,
  });
  const bodyMdHash = computeBodyMdHash(bodyMd);
  const contentHash = computeContentHash({
    theme: parts.theme,
    happenedMd: parts.happenedMd,
    didMd: parts.didMd,
    triedMd: parts.triedMd,
  });
  return { outstandingItems, bodyMd, bodyMdHash, contentHash };
}
