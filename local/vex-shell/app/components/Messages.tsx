/**
 * Message viewport — bounded chat history with role badges.
 *
 * Renders only the rows that fit in its parent frame so long responses cannot
 * push the input off-screen or leave old Ink frames behind. Assistant turns
 * are rendered through `marked-terminal` (Markdown → ANSI) and are NOT capped
 * per-message — the viewport budget alone trims oldest content with a
 * `… earlier output hidden` marker. Tool entries collapse to a single
 * `[tool:NAME]` line; the full args + result for each tool live in the
 * Ctrl+O history panel (`recentToolCalls` ring-buffer).
 */

import React from "react";
import { Box, Text } from "ink";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import type { Store, ShellViewState, ChatMessageLine } from "../state/store.js";
import { useStore } from "../state/store.js";

interface MessagesProps {
  store: Store;
  viewportRows: number;
  viewportColumns: number;
}

const TAIL_LIMIT = 80;
const MIN_CONTENT_WIDTH = 20;
/**
 * Cap for assistant row count per message. Effectively unlimited — the
 * viewport budget in `buildMessageRows` is the real trim point. Set high
 * so a long assistant turn isn't cut mid-thought.
 */
const ASSISTANT_ROW_LIMIT = 999;

// Cached `Marked` instance per terminal width. Re-instantiating every render
// would re-run extension setup unnecessarily; keying by width keeps wrap
// behavior tied to layout.
const markedCache = new Map<number, Marked>();
function getMarked(width: number): Marked {
  let m = markedCache.get(width);
  if (!m) {
    m = new Marked();
    m.use(markedTerminal({
      width: Math.max(MIN_CONTENT_WIDTH, width),
      reflowText: true,
    }) as Parameters<Marked["use"]>[0]);
    markedCache.set(width, m);
  }
  return m;
}

function renderMarkdown(text: string, width: number): string {
  try {
    const out = getMarked(width).parse(text, { async: false });
    return typeof out === "string" ? out.replace(/\n+$/, "") : text;
  } catch {
    // marked-terminal can throw on malformed input — fall back to raw text
    // so the user still sees something instead of a blank assistant row.
    return text;
  }
}

function selectMessages(s: ShellViewState): ChatMessageLine[] {
  return s.messages.slice(-TAIL_LIMIT);
}

type MessageRenderRow =
  | {
      kind: "label";
      id: string;
      text: string;
      color: string;
    }
  | {
      kind: "content";
      id: string;
      text: string;
      color?: string;
    }
  | {
      kind: "marker" | "spacer";
      id: string;
      text: string;
    };

function roleColor(line: ChatMessageLine): string {
  if (line.tone === "error") return "red";
  switch (line.role) {
    case "user":
      return "cyan";
    case "assistant":
      return "magenta";
    case "tool":
      return "yellow";
    case "system":
      return "gray";
  }
}

function roleLabel(line: ChatMessageLine): string {
  if (line.role === "tool") return `tool:${line.toolName ?? "?"}`;
  return line.role;
}

function contentRowLimit(line: ChatMessageLine): number {
  if (line.role === "tool") return 1;     // `[tool:NAME]` is a single line
  if (line.role === "user") return 5;
  if (line.role === "system") return 5;
  return ASSISTANT_ROW_LIMIT;              // assistant: viewport-budget bounded only
}

function wrapLine(raw: string, width: number): string[] {
  if (raw.length <= width) return [raw];
  const result: string[] = [];
  let rest = raw;
  while (rest.length > width) {
    result.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  result.push(rest);
  return result;
}

function wrapText(text: string, width: number, maxRows: number): string[] {
  const rows: string[] = [];
  const normalized = text.replace(/\t/g, "  ").replace(/\r\n/g, "\n");
  for (const rawLine of normalized.split("\n")) {
    const wrapped = wrapLine(rawLine || " ", width);
    for (const row of wrapped) {
      rows.push(row);
      if (rows.length >= maxRows) {
        if (normalized.length > rows.join("\n").length) {
          rows[rows.length - 1] = `${rows[rows.length - 1]!.slice(0, Math.max(0, width - 1))}…`;
        }
        return rows;
      }
    }
  }
  return rows.length > 0 ? rows : [" "];
}

function makeMessageBlock(
  line: ChatMessageLine,
  width: number,
): MessageRenderRow[] {
  const label = `[${roleLabel(line)}]`;
  const contentColor = line.tone === "error" ? "red" : undefined;
  const rows: MessageRenderRow[] = [
    {
      kind: "label",
      id: `${line.id}-label`,
      text: label,
      color: roleColor(line),
    },
  ];

  // Tool entries are label-only — full args + full result live in the Ctrl+O
  // panel (`recentToolCalls` ring-buffer), not inline. Without this guard
  // the chat would render two identical `[tool:NAME]` rows: the role label
  // (this block, line above) plus a content row from `wrapText(line.content)`
  // because earlier `useTurnState` set content = `[tool:NAME]` to mirror it.
  // We now also push `content: ""` from `useTurnState`, so this is
  // defense-in-depth: if a future change reintroduces non-empty content on a
  // tool row, we still render a single label rather than a duplicate.
  if (line.role === "tool") {
    rows.push({ kind: "spacer", id: `${line.id}-spacer`, text: "" });
    return rows;
  }

  // Assistant messages flow through `marked-terminal` (Markdown → ANSI) so
  // bullets / bold / code blocks render properly. Splitting on `\n` gives the
  // viewport budget logical lines to count; per-line wrap is left to Ink's
  // own ANSI-aware renderer (see the JSX below — `wrap="wrap"` for assistant
  // content rows). Other roles keep the simple character-truncate path.
  if (line.role === "assistant") {
    const md = renderMarkdown(line.content, width);
    const mdLines = md.length > 0 ? md.split("\n") : [" "];
    const cap = contentRowLimit(line);
    const limited = mdLines.length > cap ? mdLines.slice(0, cap) : mdLines;
    rows.push(
      ...limited.map((text, index) => ({
        kind: "content" as const,
        id: `${line.id}-md-${index}`,
        text: text.length > 0 ? text : " ",
        color: contentColor,
      })),
    );
  } else {
    const contentRows = wrapText(line.content, width, contentRowLimit(line));
    rows.push(
      ...contentRows.map((text, index) => ({
        kind: "content" as const,
        id: `${line.id}-content-${index}`,
        text,
        color: contentColor,
      })),
    );
  }
  rows.push({ kind: "spacer", id: `${line.id}-spacer`, text: "" });
  return rows;
}

export function buildMessageRows(
  messages: readonly ChatMessageLine[],
  viewportRows: number,
  viewportColumns: number,
): MessageRenderRow[] {
  const rowBudget = Math.max(1, viewportRows);
  const contentWidth = Math.max(MIN_CONTENT_WIDTH, viewportColumns - 2);
  const blocks = messages.map((line) => makeMessageBlock(line, contentWidth));
  const selected: MessageRenderRow[] = [];
  let remaining = rowBudget;
  let hidden = false;

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]!;
    if (block.length <= remaining) {
      selected.unshift(...block);
      remaining -= block.length;
      continue;
    }

    hidden = true;
    if (selected.length === 0 && remaining > 0) {
      selected.unshift(...block.slice(0, remaining));
      remaining = 0;
    }
    break;
  }

  while (selected.length > 0 && selected[selected.length - 1]?.kind === "spacer") {
    selected.pop();
  }

  if (hidden && rowBudget > 1) {
    const marker: MessageRenderRow = {
      kind: "marker",
      id: "messages-hidden-marker",
      text: "… earlier output hidden",
    };
    return [marker, ...selected.slice(-(rowBudget - 1))];
  }

  return selected.slice(-rowBudget);
}

export function Messages({
  store,
  viewportRows,
  viewportColumns,
}: MessagesProps): React.JSX.Element {
  const messages = useStore(store, selectMessages);
  const height = Math.max(1, viewportRows);
  const rows = buildMessageRows(messages, height, viewportColumns);

  if (messages.length === 0) {
    return (
      <Box height={height} paddingX={1} overflow="hidden">
        <Text dimColor>No messages yet — type below to send your first message.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height} paddingX={1} overflow="hidden">
      {rows.map((row) => (
        row.kind === "label" ? (
          <Text key={row.id} color={row.color} bold wrap="truncate">
            {row.text}
          </Text>
        ) : row.kind === "content" ? (
          // Content rows wrap so ANSI-rendered Markdown (bold, lists, code)
          // doesn't get sliced mid-escape-sequence. `marked-terminal` already
          // wraps to viewport width, so this is mostly a defensive default
          // for over-long single lines.
          <Text key={row.id} color={row.color} wrap="wrap">
            {row.text}
          </Text>
        ) : (
          <Text key={row.id} dimColor wrap="truncate">
            {row.text}
          </Text>
        )
      ))}
    </Box>
  );
}
