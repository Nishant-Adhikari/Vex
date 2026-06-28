/**
 * Map raw `electron-updater` payloads to the public `UpdateStatus`/`VexError`
 * contracts, and provide a redaction-filtered updater logger.
 *
 * Redaction contract (skill §"Non-negotiable rules" 8): NOTHING that crosses
 * the IPC boundary or a log sink may carry installer paths, artifact URLs,
 * tokens, raw metadata, or release-notes HTML. `UpdateInfo`/`ProgressInfo` are
 * projected to versions + bounded progress + a short plain summary only; error
 * messages are coarse and user-safe; the updater logger scrubs URLs/paths.
 */

import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { VexError, VexErrorCode } from "@shared/ipc/result.js";
import type { UpdateStatus } from "@shared/schemas/updater.js";
import { getCurrentStatus } from "./statusCache.js";
import { log } from "../logger/index.js";

const SUMMARY_MAX = 200;

/** Recover the latest version from the current status, else fall back. */
function latestFromCacheOr(fallback: string): string {
  const prev = getCurrentStatus();
  return "latestVersion" in prev ? prev.latestVersion : fallback;
}

export function availableStatus(
  info: UpdateInfo,
  currentVersion: string,
): UpdateStatus {
  const latestVersion =
    typeof info.version === "string" && info.version.length > 0
      ? info.version
      : currentVersion;
  const releaseName =
    typeof info.releaseName === "string" ? info.releaseName.trim() : "";
  const releaseDate =
    typeof info.releaseDate === "string" ? info.releaseDate.trim() : "";
  return {
    kind: "available",
    currentVersion,
    latestVersion,
    severity: "normal",
    ...(releaseDate.length > 0 ? { releaseDate } : {}),
    ...(releaseName.length > 0
      ? { summary: releaseName.slice(0, SUMMARY_MAX) }
      : {}),
  };
}

export function downloadingStatus(
  progress: ProgressInfo,
  currentVersion: string,
): UpdateStatus {
  return {
    kind: "downloading",
    currentVersion,
    latestVersion: latestFromCacheOr(currentVersion),
    percent: clampPercent(progress.percent),
    ...(isFiniteNonNeg(progress.bytesPerSecond)
      ? { bytesPerSecond: progress.bytesPerSecond }
      : {}),
    ...(isFiniteNonNeg(progress.transferred)
      ? { transferred: progress.transferred }
      : {}),
    ...(isFiniteNonNeg(progress.total) ? { total: progress.total } : {}),
  };
}

export function errorStatus(
  error: unknown,
  currentVersion: string,
): UpdateStatus {
  return {
    kind: "error",
    currentVersion,
    message: safeUpdateErrorMessage(error),
    retryable: true,
  };
}

/**
 * Redacted, user-safe error string. `electron-updater` error messages can embed
 * feed URLs / file paths, so the raw message is never surfaced — only a coarse,
 * actionable line. Structural diagnosis is logged separately in main.
 */
export function safeUpdateErrorMessage(_error: unknown): string {
  return "Update failed. Check your connection and try again.";
}

type UpdateErrorCode = Extract<VexErrorCode, `update.${string}`>;

const UPDATE_ERROR_MESSAGES: Record<UpdateErrorCode, string> = {
  "update.check_failed":
    "Couldn't check for updates. Check your connection and try again.",
  "update.download_failed": "The update download failed. Try again.",
  "update.apply_failed": "Couldn't apply the update right now. Try again.",
};

export function publicUpdateError(
  code: UpdateErrorCode,
  correlationId: string,
  messageOverride?: string,
): VexError {
  return {
    code,
    domain: "updater",
    message: messageOverride ?? UPDATE_ERROR_MESSAGES[code],
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

// ── filtered updater logger ─────────────────────────────────────────────────
// electron-updater logs feed/artifact URLs and installer paths directly. Scrub
// http(s) URLs and absolute file paths before delegating to the redacted app
// logger (which separately scrubs key material / addresses).

const URL_RE = /\bhttps?:\/\/\S+/gi;
const WIN_PATH_RE = /\b[A-Za-z]:\\[^\s"']+/g;
const NIX_PATH_RE = /(?<![\w[])\/(?:[^\s"'/]+\/)+[^\s"']*/g;

function safeStringify(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function scrub(value: unknown): string {
  return safeStringify(value)
    .replace(URL_RE, "[url]")
    .replace(WIN_PATH_RE, "[path]")
    .replace(NIX_PATH_RE, "[path]");
}

export interface UpdaterLogger {
  info(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
  debug(message: unknown): void;
}

export const filteredUpdaterLogger: UpdaterLogger = {
  info: (m) => log.info(`[updater] ${scrub(m)}`),
  warn: (m) => log.warn(`[updater] ${scrub(m)}`),
  error: (m) => log.error(`[updater] ${scrub(m)}`),
  debug: (m) => log.debug(`[updater] ${scrub(m)}`),
};

function clampPercent(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function isFiniteNonNeg(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
