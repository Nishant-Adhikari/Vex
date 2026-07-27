const ACRONYMS = new Set([
  "ai",
  "api",
  "gpt",
  "llm",
  "r1",
  "r2",
  "r3",
  "r4",
  "ui",
  "v3",
  "v4",
]);

const SPECIAL_WORDS: Record<string, string> = {
  claude: "Claude",
  deepseek: "DeepSeek",
  gemini: "Gemini",
};

function titleCaseWord(word: string): string {
  if (word.length === 0) return word;
  const lower = word.toLowerCase();
  if (lower in SPECIAL_WORDS) return SPECIAL_WORDS[lower]!;
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  if (/^\d+(\.\d+)*$/.test(lower)) return word;
  return lower[0]!.toUpperCase() + lower.slice(1);
}

function humanizeModelCore(core: string): string {
  return core
    .split(/[-_]+/g)
    .filter((part) => part.length > 0)
    .map((part) =>
      part
        .split(".")
        .map((segment) => titleCaseWord(segment))
        .join("."),
    )
    .join(" ");
}

export function formatModelLabel(modelId: string | null | undefined): string {
  if (typeof modelId !== "string") return "Unknown model";
  const trimmed = modelId.trim();
  if (trimmed.length === 0) return "Unknown model";
  const slash = trimmed.indexOf("/");
  const core = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  if (core.length === 0) return trimmed;
  return humanizeModelCore(core);
}

export function formatModelStackLabel(input: {
  readonly primaryModelId: string | null;
  readonly fallbackModelId?: string | null;
}): string | null {
  if (input.primaryModelId === null) return null;
  return input.fallbackModelId
    ? `${formatModelLabel(input.primaryModelId)} / ${formatModelLabel(input.fallbackModelId)}`
    : formatModelLabel(input.primaryModelId);
}
