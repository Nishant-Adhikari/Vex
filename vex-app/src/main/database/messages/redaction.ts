/**
 * LOCAL tool-call args redaction for the messages DB repository.
 *
 * This is the LOCAL secret-word redaction used when reducing
 * `messages.tool_calls` JSONB to a renderer-visible display string. It is
 * deliberately independent of the diagnostics/bug-report redactor — do NOT
 * swap in `redactBugPayload` or any other redactor here. `sanitizeToolArgs`
 * stays behind `extractToolCalls` (see `./mappers.ts`) as the single place
 * tool args cross the boundary.
 */

// ── Tool-call args sanitization (renderer disclosure) ─────────────────
// The renderer reveals the params a tool was called with. Args can carry
// sensitive material, so this is the ONLY place they cross the boundary —
// and only as a redacted, size-capped JSON STRING (never raw JSONB). Two
// independent layers, defense in depth:
//   1. drop any key whose NAME indicates a secret (segment-aware so common
//      DeFi args like `tokenAddress` / `signer` are NOT false-dropped);
//   2. hard-redact any VALUE that looks like a secret (private key, JWT,
//      mnemonic, long base58/base64) while preserving public identifiers
//      (EVM/Solana addresses, amounts, chain ids).

/** Secret-indicating key segments (matched against camel/snake/kebab words). */
const SECRET_KEY_WORDS = new Set<string>([
  "secret",
  "seed",
  "mnemonic",
  "password",
  "passphrase",
  "passwd",
  "privatekey",
  "privkey",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "bearer",
  "credential",
  "credentials",
  "jwt",
  "signature",
]);

/** 32-byte hex (private-key / hash shaped). Params almost never carry a tx
 *  hash, so redacting by default favors safety; the value still appears in the
 *  tool OUTPUT row when it is a legitimate hash. */
const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BASE58_LONG_RE = /^[1-9A-HJ-NP-Za-km-z]{50,}$/; // beyond Solana addr length
const BASE64_LONG_RE = /^[A-Za-z0-9+/=]{60,}$/;

const ARG_MAX_STRING = 256;
const ARG_MAX_ARRAY = 50;
const ARG_MAX_KEYS = 50;
const ARG_MAX_DEPTH = 4;
const ARGS_MAX_SERIALIZED = 2000;

function splitKeyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 0);
}

function isSecretKey(key: string): boolean {
  const words = splitKeyWords(key);
  for (const w of words) {
    if (SECRET_KEY_WORDS.has(w)) return true;
  }
  // Joined camelCase forms: privateKey→[private,key], apiKey→[api,key], …
  const joined = words.join("");
  return /(privatekey|privkey|apikey|accesstoken|refreshtoken|authtoken|secretkey|seedphrase)/.test(
    joined,
  );
}

function redactScalarString(value: string): string {
  if (JWT_RE.test(value)) return "[redacted:jwt]";
  if (HEX32_RE.test(value)) return "[redacted:key]";
  if (BASE58_LONG_RE.test(value)) return "[redacted:secret]";
  if (BASE64_LONG_RE.test(value)) return "[redacted:secret]";
  // BIP39-like: >= 12 space-separated lowercase words.
  const words = value.trim().split(/\s+/);
  if (words.length >= 12 && words.every((w) => /^[a-z]+$/.test(w))) {
    return "[redacted:mnemonic]";
  }
  return value.length > ARG_MAX_STRING ? `${value.slice(0, ARG_MAX_STRING)}…` : value;
}

function redactArgValue(value: unknown, depth: number): unknown {
  if (depth > ARG_MAX_DEPTH) return "[…]";
  if (typeof value === "string") return redactScalarString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, ARG_MAX_ARRAY).map((v) => redactArgValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count >= ARG_MAX_KEYS) break;
      if (isSecretKey(k)) continue; // drop secret-named keys entirely
      out[k] = redactArgValue(v, depth + 1);
      count += 1;
    }
    return out;
  }
  return undefined; // functions / symbols / bigint — never expose
}

/**
 * Sanitize one tool call's `args` into a display string, or `null` when there
 * is nothing safe/meaningful to show.
 */
export function sanitizeToolArgs(rawArgs: unknown): string | null {
  if (rawArgs === null || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return null;
  }
  const redacted = redactArgValue(rawArgs, 0);
  if (
    redacted === null ||
    typeof redacted !== "object" ||
    Object.keys(redacted as Record<string, unknown>).length === 0
  ) {
    return null;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(redacted, null, 2);
  } catch {
    return null;
  }
  return serialized.length > ARGS_MAX_SERIALIZED
    ? `${serialized.slice(0, ARGS_MAX_SERIALIZED)}\n…(truncated)`
    : serialized;
}
