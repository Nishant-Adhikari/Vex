/**
 * Folders repo — first-class directory tree for documents.
 */

import { query, queryOne, execute } from "../client.js";

export interface FolderRow {
  id: number;
  space: string;
  parent_id: number | null;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: number;
  space: string;
  parentId: number | null;
  name: string;
  slug: string;
  createdAt: string;
}

function mapRow(r: FolderRow): Folder {
  return { id: r.id, space: r.space, parentId: r.parent_id, name: r.name, slug: r.slug, createdAt: r.created_at };
}

export async function createFolder(space: string, parentId: number | null, name: string, slug: string): Promise<Folder> {
  const row = await queryOne<FolderRow>(
    `INSERT INTO folders (space, parent_id, name, slug) VALUES ($1, $2, $3, $4) RETURNING *`,
    [space, parentId, name, slug],
  );
  return mapRow(row!);
}

export async function getFolder(id: number): Promise<Folder | null> {
  const row = await queryOne<FolderRow>("SELECT * FROM folders WHERE id = $1", [id]);
  return row ? mapRow(row) : null;
}

export async function getFolderBySlug(space: string, parentId: number | null, slug: string): Promise<Folder | null> {
  const row = parentId === null
    ? await queryOne<FolderRow>("SELECT * FROM folders WHERE space = $1 AND parent_id IS NULL AND slug = $2", [space, slug])
    : await queryOne<FolderRow>("SELECT * FROM folders WHERE space = $1 AND parent_id = $2 AND slug = $3", [space, parentId, slug]);
  return row ? mapRow(row) : null;
}

export async function listFolders(space: string, parentId?: number | null): Promise<Folder[]> {
  if (parentId === undefined) {
    const rows = await query<FolderRow>("SELECT * FROM folders WHERE space = $1 ORDER BY name", [space]);
    return rows.map(mapRow);
  }
  const rows = parentId === null
    ? await query<FolderRow>("SELECT * FROM folders WHERE space = $1 AND parent_id IS NULL ORDER BY name", [space])
    : await query<FolderRow>("SELECT * FROM folders WHERE space = $1 AND parent_id = $2 ORDER BY name", [space, parentId]);
  return rows.map(mapRow);
}

export async function deleteFolder(id: number): Promise<boolean> {
  const rowCount = await execute("DELETE FROM folders WHERE id = $1", [id]);
  return rowCount > 0;
}
