/**
 * Documents repo — DB-first markdown content with folder FK.
 */

import { query, queryOne, execute } from "../client.js";

interface DocumentRow {
  id: number; space: string; folder_id: number | null; title: string; slug: string;
  content_md: string; size_bytes: number; created_at: string; updated_at: string; archived_at: string | null;
}

export interface Document {
  id: number;
  space: string;
  folderId: number | null;
  title: string;
  slug: string;
  contentMd: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentListItem {
  id: number;
  space: string;
  folderId: number | null;
  title: string;
  slug: string;
  sizeBytes: number;
  updatedAt: string;
}

function mapRow(r: DocumentRow): Document {
  return {
    id: r.id, space: r.space, folderId: r.folder_id, title: r.title, slug: r.slug,
    contentMd: r.content_md, sizeBytes: r.size_bytes, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Get a document by space + folder + slug. */
export async function getDocument(space: string, folderId: number | null, slug: string): Promise<Document | null> {
  const row = folderId === null
    ? await queryOne<DocumentRow>(
        "SELECT * FROM documents WHERE space = $1 AND folder_id IS NULL AND slug = $2 AND archived_at IS NULL",
        [space, slug],
      )
    : await queryOne<DocumentRow>(
        "SELECT * FROM documents WHERE space = $1 AND folder_id = $2 AND slug = $3 AND archived_at IS NULL",
        [space, folderId, slug],
      );
  return row ? mapRow(row) : null;
}

/** Get a document by ID. */
export async function getDocumentById(id: number): Promise<Document | null> {
  const row = await queryOne<DocumentRow>("SELECT * FROM documents WHERE id = $1 AND archived_at IS NULL", [id]);
  return row ? mapRow(row) : null;
}

/** Create or update a document. Upserts by (space, folder_id, slug). */
export async function upsertDocument(
  space: string, folderId: number | null, title: string, slug: string, contentMd: string,
): Promise<Document> {
  const sizeBytes = Buffer.byteLength(contentMd, "utf-8");

  // Upsert strategy differs for NULL vs non-NULL folder_id due to split unique indexes
  let row: DocumentRow | null;
  if (folderId === null) {
    row = await queryOne<DocumentRow>(
      `INSERT INTO documents (space, folder_id, title, slug, content_md, size_bytes)
       VALUES ($1, NULL, $2, $3, $4, $5)
       ON CONFLICT (space, slug) WHERE folder_id IS NULL AND archived_at IS NULL
       DO UPDATE SET title = $2, content_md = $4, size_bytes = $5, updated_at = NOW()
       RETURNING *`,
      [space, title, slug, contentMd, sizeBytes],
    );
  } else {
    row = await queryOne<DocumentRow>(
      `INSERT INTO documents (space, folder_id, title, slug, content_md, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (space, folder_id, slug) WHERE folder_id IS NOT NULL AND archived_at IS NULL
       DO UPDATE SET title = $3, content_md = $5, size_bytes = $6, updated_at = NOW()
       RETURNING *`,
      [space, folderId, title, slug, contentMd, sizeBytes],
    );
  }

  return mapRow(row!);
}

/** List documents in a space, optionally filtered by folder. */
export async function listDocuments(space: string, folderId?: number | null): Promise<DocumentListItem[]> {
  let rows: DocumentRow[];
  if (folderId === undefined) {
    rows = await query<DocumentRow>(
      "SELECT id, space, folder_id, title, slug, size_bytes, updated_at FROM documents WHERE space = $1 AND archived_at IS NULL ORDER BY title",
      [space],
    );
  } else if (folderId === null) {
    rows = await query<DocumentRow>(
      "SELECT id, space, folder_id, title, slug, size_bytes, updated_at FROM documents WHERE space = $1 AND folder_id IS NULL AND archived_at IS NULL ORDER BY title",
      [space],
    );
  } else {
    rows = await query<DocumentRow>(
      "SELECT id, space, folder_id, title, slug, size_bytes, updated_at FROM documents WHERE space = $1 AND folder_id = $2 AND archived_at IS NULL ORDER BY title",
      [space, folderId],
    );
  }
  return rows.map(r => ({
    id: r.id, space: r.space, folderId: r.folder_id, title: r.title,
    slug: r.slug, sizeBytes: r.size_bytes, updatedAt: r.updated_at,
  }));
}

/** Soft-delete a document by ID. */
export async function softDeleteDocument(id: number): Promise<boolean> {
  const rowCount = await execute(
    "UPDATE documents SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL",
    [id],
  );
  return rowCount === 1;
}

/** Count active documents, optionally filtered by space. */
export async function countDocuments(space?: string): Promise<number> {
  const sql = space
    ? "SELECT COUNT(*) AS c FROM documents WHERE space = $1 AND archived_at IS NULL"
    : "SELECT COUNT(*) AS c FROM documents WHERE archived_at IS NULL";
  const row = await queryOne<{ c: string }>(sql, space ? [space] : []);
  return parseInt(row?.c ?? "0", 10);
}
