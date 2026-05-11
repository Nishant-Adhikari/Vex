import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function readDotenvFileValue(key: string, envPath: string): string | null {
  if (!existsSync(envPath)) return null;

  const content = readFileSync(envPath, "utf-8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^${escapedKey}=(.*)$`, "m"));
  if (!match) return null;

  let value = match[1]!.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  return value || null;
}

export function loadDotenvFileIntoProcess(envPath: string): void {
  if (!existsSync(envPath)) return;

  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;

    const key = trimmed.slice(0, eqIdx);
    if (process.env[key] !== undefined) continue;

    let value = trimmed.slice(eqIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    process.env[key] = value;
  }
}

export function appendToDotenvFile(key: string, value: string, envPath: string): string {
  const dir = dirname(envPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quotedValue = `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const line = `${key}=${quotedValue}`;
  const regex = new RegExp(`^${escapedKey}=.*$`, "m");

  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content = content.trimEnd() + `\n${line}\n`;
  }

  const tmpFile = join(dir, `.env.tmp.${Date.now()}`);
  writeFileSync(tmpFile, content, { mode: 0o600 });
  renameSync(tmpFile, envPath);
  return envPath;
}

/**
 * Remove a key from the dotenv file. No-op if file or key is absent.
 *
 * Used by the M9 wizard agent-core writer to honour the explicit
 * "Reset to default" UI action (renderer sends `null` for that field
 * → handler removes the key so engine reads fall back to compile-time
 * default). Atomic: temp+rename, mode 0o600.
 *
 * Returns true when the key was present and removed; false when the
 * file or the key did not exist (idempotent for callers that don't
 * care about prior state).
 */
export function removeFromDotenvFile(key: string, envPath: string): boolean {
  if (!existsSync(envPath)) return false;
  const content = readFileSync(envPath, "utf-8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escapedKey}=.*(?:\r?\n|$)`, "m");
  if (!regex.test(content)) return false;
  const next = content.replace(regex, "");
  const dir = dirname(envPath);
  const tmpFile = join(dir, `.env.tmp.${Date.now()}`);
  writeFileSync(tmpFile, next, { mode: 0o600 });
  renameSync(tmpFile, envPath);
  return true;
}
