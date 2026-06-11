import type { MessageMetadata } from "@vex-agent/db/repos/messages.js";
import { appendMessage } from "@vex-agent/engine/events/index.js";
import * as toolOutputBlobsRepo from "@vex-agent/db/repos/tool-output-blobs.js";
import type { ToolOutputShapeKind } from "@vex-agent/db/repos/tool-output-blobs.js";
import {
  TOOL_OUTPUT_OVERFLOW_BYTES,
  TOOL_OUTPUT_TTL_MIN,
} from "@vex-agent/engine/core/tool-output-policy.js";
import logger from "@utils/logger.js";

const TOOL_OUTPUT_TEXT_PREVIEW_CHARS = 160;
const TOOL_OUTPUT_STRUCTURED_PREVIEW_BYTES = 6 * 1024;
const TOOL_OUTPUT_STRUCTURED_PREVIEW_ITEMS = 5;
const TOOL_OUTPUT_SCALAR_STRING_CHARS = 500;

const STRUCTURED_PREVIEW_LIST_KEYS = new Set([
  "items",
  "profiles",
  "boosts",
  "pairs",
  "tweets",
  "users",
  "orders",
  "ads",
  "takeovers",
]);

interface PersistedToolResult {
  content: string;
  metadata: MessageMetadata;
}

/**
 * Persist a tool result - inline when the output is small, blob + stub when
 * it exceeds `TOOL_OUTPUT_OVERFLOW_BYTES`. The returned `content` is safe to
 * push onto `liveMessages`; callers do not need to branch on persistence mode.
 */
export async function persistToolResultWithOverflow(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  output: string,
  success: boolean,
): Promise<PersistedToolResult> {
  const bytes = Buffer.byteLength(output, "utf8");

  if (bytes <= TOOL_OUTPUT_OVERFLOW_BYTES) {
    const metadata: MessageMetadata = {
      source: "tool",
      messageType: "tool_result",
      visibility: "internal",
      payload: { success },
    };
    await appendMessage(
      sessionId,
      { role: "tool", content: output, toolCallId, timestamp: new Date().toISOString() },
      metadata,
    );
    return { content: output, metadata };
  }

  const shapeKind = classifyShape(output);
  const blobKey = toolOutputBlobsRepo.generateBlobKey(sessionId, toolName, toolCallId);
  const preview = buildOverflowPreview(output, shapeKind);
  const stub =
    `[tool_output_overflow blob_key=${blobKey} bytes=${bytes} shape=${shapeKind} ` +
    `preview=${JSON.stringify(preview)}]. ` +
    `Call \`tool_output_read(blob_key="${blobKey}")\` to read bounded slices.`;

  let blobWritten = false;
  try {
    await toolOutputBlobsRepo.writeBlob(
      blobKey,
      sessionId,
      { fullOutput: output, shapeKind, sizeBytes: bytes },
      TOOL_OUTPUT_TTL_MIN * 60_000,
    );
    blobWritten = true;
  } catch (err) {
    logger.warn("turn.tool_output.blob_write_failed", {
      sessionId,
      toolCallId,
      toolName,
      sizeBytes: bytes,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!blobWritten) {
    const metadata: MessageMetadata = {
      source: "tool",
      messageType: "tool_result",
      visibility: "internal",
      payload: { success },
    };
    await appendMessage(
      sessionId,
      { role: "tool", content: output, toolCallId, timestamp: new Date().toISOString() },
      metadata,
    );
    return { content: output, metadata };
  }

  const metadata: MessageMetadata = {
    source: "tool",
    messageType: "tool_result",
    visibility: "internal",
    payload: {
      success,
      overflow: true,
      blobKey,
      sizeBytes: bytes,
      shapeKind,
    },
  };

  await appendMessage(
    sessionId,
    { role: "tool", content: stub, toolCallId, timestamp: new Date().toISOString() },
    metadata,
  );

  return { content: stub, metadata };
}

function classifyShape(output: string): ToolOutputShapeKind {
  const trimmed = output.trim();
  if (trimmed.length === 0) return "text";
  const first = trimmed[0];
  if (first === "{") return "json";
  if (first === "[") return "list";
  return "text";
}

function buildOverflowPreview(output: string, shapeKind: ToolOutputShapeKind): string {
  if (shapeKind === "text") {
    return output.slice(0, TOOL_OUTPUT_TEXT_PREVIEW_CHARS);
  }

  try {
    const parsed = JSON.parse(output) as unknown;
    const preview = JSON.stringify(toStructuredPreview(parsed), null, 2);
    return truncateByBytes(preview, TOOL_OUTPUT_STRUCTURED_PREVIEW_BYTES);
  } catch {
    return output.slice(0, TOOL_OUTPUT_TEXT_PREVIEW_CHARS);
  }
}

function toStructuredPreview(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      _preview: {
        itemLimit: TOOL_OUTPUT_STRUCTURED_PREVIEW_ITEMS,
        totalCount: value.length,
      },
      items: value.slice(0, TOOL_OUTPUT_STRUCTURED_PREVIEW_ITEMS),
    };
  }

  if (!isRecord(value)) return value;

  const meta: Record<string, unknown> = {
    itemLimit: TOOL_OUTPUT_STRUCTURED_PREVIEW_ITEMS,
  };
  const preview: Record<string, unknown> = { _preview: meta };
  const otherArrayCounts: Record<string, number> = {};

  for (const [key, fieldValue] of Object.entries(value)) {
    if (isPreviewScalar(fieldValue)) {
      preview[key] = previewScalar(fieldValue);
    }
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (!Array.isArray(fieldValue)) continue;

    if (STRUCTURED_PREVIEW_LIST_KEYS.has(key)) {
      preview[key] = fieldValue.slice(0, TOOL_OUTPUT_STRUCTURED_PREVIEW_ITEMS);
      meta[`${key}TotalCount`] = fieldValue.length;
    } else {
      otherArrayCounts[key] = fieldValue.length;
    }
  }

  if (Object.keys(otherArrayCounts).length > 0) {
    meta.otherArrayCounts = otherArrayCounts;
  }

  return preview;
}

function isPreviewScalar(value: unknown): value is string | number | boolean | null {
  return value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean";
}

function previewScalar(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value !== "string" || value.length <= TOOL_OUTPUT_SCALAR_STRING_CHARS) {
    return value;
  }
  return `${value.slice(0, TOOL_OUTPUT_SCALAR_STRING_CHARS)}... [truncated]`;
}

function truncateByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;

  const suffix = "\n... [preview truncated]";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let bytes = 0;
  let end = 0;

  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > budget) break;
    bytes += charBytes;
    end += char.length;
  }

  return `${value.slice(0, end)}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
