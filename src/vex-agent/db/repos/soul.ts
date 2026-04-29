/**
 * Soul repo — singleton agent identity.
 */

import { queryOne, execute } from "../client.js";

interface SoulRow { content_md: string; pfp_url: string | null; updated_at: string }

export async function getSoul(): Promise<{ contentMd: string; pfpUrl: string | null } | null> {
  const row = await queryOne<SoulRow>("SELECT content_md, pfp_url FROM soul WHERE id = 1");
  if (!row || !row.content_md) return null;
  return { contentMd: row.content_md, pfpUrl: row.pfp_url };
}

export async function upsertSoul(contentMd: string, pfpUrl?: string): Promise<void> {
  await execute(
    `UPDATE soul SET content_md = $1, pfp_url = COALESCE($2, pfp_url), updated_at = NOW() WHERE id = 1`,
    [contentMd, pfpUrl ?? null],
  );
}
