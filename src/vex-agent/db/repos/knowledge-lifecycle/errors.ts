/**
 * Error taxonomy for the knowledge supersede transaction.
 *
 * Discriminated `code` lets callers (the `knowledge_supersede` handler)
 * map to good LLM-facing messages without string-matching pg error text.
 */

export type SupersedeErrorCode =
  | "predecessor_not_found"
  | "predecessor_not_active"
  | "predecessor_already_superseded"
  | "identical_content"
  | "content_hash_collision";

export class SupersedeError extends Error {
  readonly code: SupersedeErrorCode;
  readonly predecessorId: number;
  readonly details: Record<string, unknown>;
  constructor(
    code: SupersedeErrorCode,
    predecessorId: number,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SupersedeError";
    this.code = code;
    this.predecessorId = predecessorId;
    this.details = details;
  }
}
