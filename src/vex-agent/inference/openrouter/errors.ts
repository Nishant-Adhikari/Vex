function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumberOrString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

function truncate(value: string, max = 800): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function stringifyMetadataValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pickErrorObject(err: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(err.error)) return err.error;
  const body = parseJsonObject(err.body);
  return body && isRecord(body.error) ? body.error : null;
}

function formatMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;

  const preferredKeys = ["provider_name", "raw", "reason", "details"];
  const selected: string[] = [];
  for (const key of preferredKeys) {
    if (metadata[key] !== undefined && metadata[key] !== null) {
      selected.push(`${key}=${truncate(stringifyMetadataValue(metadata[key]), 400)}`);
    }
  }

  if (selected.length > 0) return selected.join(" ");
  return truncate(stringifyMetadataValue(metadata), 800);
}

export function normalizeOpenRouterError(err: unknown, operation: string): Error {
  const originalMessage = err instanceof Error ? err.message : String(err);

  if (!isRecord(err)) {
    return new Error(`OpenRouter ${operation} failed: ${originalMessage}`);
  }

  const errorObject = pickErrorObject(err);
  const status = asNumberOrString(err.statusCode);
  const code = errorObject ? asNumberOrString(errorObject.code) : null;
  const providerMessage = errorObject ? asString(errorObject.message) : null;
  const metadata = errorObject ? formatMetadata(errorObject.metadata) : null;
  const body = !errorObject && err.body !== undefined
    ? truncate(stringifyMetadataValue(err.body), 800)
    : null;

  const details = [
    status ? `status=${status}` : null,
    code ? `code=${code}` : null,
    providerMessage ?? originalMessage,
    metadata ? `metadata: ${metadata}` : null,
    body ? `body: ${body}` : null,
  ].filter((part): part is string => Boolean(part));

  const normalized = new Error(`OpenRouter ${operation} failed: ${details.join(" | ")}`);
  if (err instanceof Error && err.stack) normalized.stack = err.stack;
  return normalized;
}
