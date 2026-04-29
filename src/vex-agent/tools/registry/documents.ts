/**
 * Documents — DB-first freeform agent scratchpad.
 *
 * Canonical structured memory lives in knowledge_* — these are the freeform
 * notes-space sibling.
 */

import type { ToolDef } from "../types.js";

export const DOCUMENT_TOOLS: readonly ToolDef[] = [
  {
    name: "document_read", kind: "internal", mutating: false,
    description: "Read a freeform note from the notes space. For canonical structured memory use knowledge_get. Use preview=true for first 1000 chars without context load.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space (only 'notes' is exposed)" },
      slug: { type: "string", description: "Document slug" },
      folder: { type: "string", description: "Folder slug (optional, default: root)" },
      preview: { type: "boolean", description: "Preview mode (first 1000 chars, no context load)" },
    }, required: ["slug"] },
  },
  {
    name: "document_write", kind: "internal", mutating: false,
    description: "Create or update a freeform note in the notes space. For canonical structured memory (rules, observations, strategies) use knowledge_write instead — it embeds and is retrievable.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space (only 'notes' is exposed)" },
      folder: { type: "string", description: "Folder slug (optional)" },
      title: { type: "string", description: "Document title" },
      slug: { type: "string", description: "URL-safe identifier (auto-generated from title if omitted)" },
      content: { type: "string", description: "Markdown content" },
    }, required: ["title", "content"] },
  },
  {
    name: "document_list", kind: "internal", mutating: false,
    description: "List notes in a space, optionally filtered by folder.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space (only 'notes' is exposed)" },
      folder: { type: "string", description: "Folder slug filter" },
    } },
  },
  {
    name: "document_delete", kind: "internal", mutating: false,
    description: "Archive (soft-delete) a note.",
    parameters: { type: "object", properties: {
      space: { type: "string", enum: ["notes"], description: "Document space" },
      slug: { type: "string", description: "Document slug" },
      folder: { type: "string", description: "Folder slug" },
    }, required: ["slug"] },
  },
];
