import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import type { MessageMetadata } from "@vex-agent/db/repos/messages.js";
import * as toolOutputBlobsRepo from "@vex-agent/db/repos/tool-output-blobs.js";
import type { ToolOutputShapeKind } from "@vex-agent/db/repos/tool-output-blobs.js";
import {
  TOOL_OUTPUT_OVERFLOW_BYTES,
  TOOL_OUTPUT_TTL_MIN,
} from "@vex-agent/knowledge/policy.js";
import logger from "@utils/logger.js";

const TOOL_OUTPUT_PREVIEW_CHARS = 160;

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
    await messagesRepo.addMessage(
      sessionId,
      { role: "tool", content: output, toolCallId, timestamp: new Date().toISOString() },
      metadata,
    );
    return { content: output, metadata };
  }

  const shapeKind = classifyShape(output);
  const blobKey = toolOutputBlobsRepo.generateBlobKey(sessionId, toolName, toolCallId);
  const preview = output.slice(0, TOOL_OUTPUT_PREVIEW_CHARS).replace(/"/g, "'");
  const stub =
    `[tool_output_overflow blob_key=${blobKey} bytes=${bytes} shape=${shapeKind} ` +
    `preview="${preview}"]. ` +
    `Call \`tool_output_read(blob_key="${blobKey}")\` for the full payload.`;

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
    await messagesRepo.addMessage(
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

  await messagesRepo.addMessage(
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
