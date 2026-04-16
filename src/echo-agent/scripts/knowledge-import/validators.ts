/**
 * knowledge-import — fail-loud audit field validators.
 *
 * Missing fields (undefined / null) are OK and map to defaults via SQL
 * COALESCE in insertEntry. Present-but-bad values throw — caught by the
 * per-row try/catch in the orchestrator, counted as `failed`, and surfaced
 * in the report. Silently coercing garbage to NOW() / 'active' would falsify
 * history exactly where the importer should be most strict.
 */

import type { KnowledgeStatus } from "@echo-agent/knowledge/policy.js";

export interface ImportedRow {
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags?: string[];
  source_refs?: Record<string, unknown>;
  confidence?: number | null;
  status?: string;
  pinned?: boolean;
  valid_from?: string;
  valid_until?: string | null;
  // content_hash is read but ignored — recomputed locally
  content_hash?: string;
  created_at?: string;
  updated_at?: string;
  // ── v2 provenance fields (undefined on v1 input; optional on v2)
  source_surface?: string;
  source_session?: string | null;
  // ── v2 lifecycle fields (undefined on v1 input)
  supersedes_content_hash?: string | null;
  status_reason?: string | null;
  change_summary?: string | null;
  what_failed?: string | null;
}

export type ManifestVersion = 1 | 2;

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function isKnowledgeStatus(s: unknown): s is KnowledgeStatus {
  return (
    s === "active" || s === "superseded" || s === "invalidated" || s === "archived"
  );
}

export function requireValidStatusOrUndefined(
  s: unknown,
  lineNumber: number,
): KnowledgeStatus | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: status must be a string, got ${typeof s}`);
  }
  if (!isKnowledgeStatus(s)) {
    throw new Error(
      `line ${lineNumber}: status="${s}" is not a valid KnowledgeStatus ` +
        `(active|superseded|invalidated|archived)`,
    );
  }
  return s;
}

export function requireValidDateOrUndefined(
  s: unknown,
  field: string,
  lineNumber: number,
): Date | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: ${field} must be a string ISO date, got ${typeof s}`);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`line ${lineNumber}: ${field}="${s}" is not a parseable ISO date`);
  }
  return d;
}

export function requireValidValidUntil(s: unknown, lineNumber: number): Date | null {
  // Special-case: explicit null is meaningful (evergreen / pinned).
  if (s === null || s === undefined) return null;
  if (typeof s !== "string") {
    throw new Error(
      `line ${lineNumber}: valid_until must be a string ISO date or null, got ${typeof s}`,
    );
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`line ${lineNumber}: valid_until="${s}" is not a parseable ISO date`);
  }
  return d;
}

export function requireOptionalStringOrNull(
  s: unknown,
  field: string,
  lineNumber: number,
): string | null {
  if (s === undefined || s === null) return null;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: ${field} must be a string or null, got ${typeof s}`);
  }
  return s;
}

/** sha256 hex format — 64 hex chars. Rejects tampered / non-hex strings. */
export function requireValidHashOrNull(
  s: unknown,
  field: string,
  lineNumber: number,
): string | null {
  if (s === undefined || s === null) return null;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: ${field} must be a string or null, got ${typeof s}`);
  }
  if (!/^[a-f0-9]{64}$/.test(s)) {
    throw new Error(`line ${lineNumber}: ${field}="${s}" is not a valid sha256 hex`);
  }
  return s;
}

/**
 * source_surface enum — only `echo_agent` or `mcp_local` are valid. Absence is
 * OK (maps to undefined → default `echo_agent` via COALESCE in insertEntry).
 */
export function requireValidSourceSurfaceOrUndefined(
  s: unknown,
  lineNumber: number,
): "echo_agent" | "mcp_local" | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== "string") {
    throw new Error(`line ${lineNumber}: source_surface must be a string, got ${typeof s}`);
  }
  if (s !== "echo_agent" && s !== "mcp_local") {
    throw new Error(
      `line ${lineNumber}: source_surface="${s}" is not valid (expected echo_agent | mcp_local)`,
    );
  }
  return s;
}
