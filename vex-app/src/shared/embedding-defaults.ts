/**
 * User-facing embedding defaults — shared between main and renderer
 * (M11.5.4). The renderer needs the port / alias / dim so the wizard
 * placeholder and skip-card copy stay in lockstep with the compose
 * stack; the main process consumes the same values to populate
 * `${CONFIG_DIR}/.env`.
 *
 * Server-only constants (image digests, GGUF download URL + SHA256)
 * live in `main/onboarding/embedding-defaults.ts` because they have
 * no business shipping to renderer bundles.
 *
 * The probe address is **always** `127.0.0.1` — never `localhost`.
 * Compose publishes ports on the loopback IPv4 interface; the OS
 * resolver may prefer `::1` for `localhost` on some Linux configs,
 * yielding a connection-refused mismatch between the readiness
 * probe and the engine reading EMBEDDING_BASE_URL at runtime
 * (codex review turn 2 RED #2).
 */

export const DEFAULT_EMBED_PORT = 55134;
export const EMBEDDING_MODEL_ALIAS = "ai/embeddinggemma:300M-Q8_0";
export const EMBEDDING_DIM = 768;
export const EMBEDDING_PROVIDER = "local";

export function buildEmbeddingBaseUrl(port: number = DEFAULT_EMBED_PORT): string {
  return `http://127.0.0.1:${port}/v1`;
}

/**
 * Canonical user-facing default for the 4 EMBEDDING_* env keys. Main
 * process writes this on first run; renderer mirrors the same values
 * in form placeholders + skip-card copy. Server-only metadata
 * (filename, SHA, digests, URL) lives in main-side `embedding-defaults`.
 */
export function defaultEmbeddingEnv(
  port: number = DEFAULT_EMBED_PORT
): Readonly<{
  EMBEDDING_BASE_URL: string;
  EMBEDDING_MODEL: string;
  EMBEDDING_DIM: string;
  EMBEDDING_PROVIDER: string;
}> {
  return {
    EMBEDDING_BASE_URL: buildEmbeddingBaseUrl(port),
    EMBEDDING_MODEL: EMBEDDING_MODEL_ALIAS,
    EMBEDDING_DIM: String(EMBEDDING_DIM),
    EMBEDDING_PROVIDER,
  };
}
