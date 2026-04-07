import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildInstructions } from "../../../mcp/docs/instructions.js";

describe("mcp docs — buildInstructions", () => {
  const ENV_KEYS = [
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIM",
    "EMBEDDING_PROVIDER",
    "JUPITER_API_KEY",
    "POLYMARKET_API_KEY",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    process.env.EMBEDDING_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1";
    process.env.EMBEDDING_MODEL = "ai/embeddinggemma:300M-Q8_0";
    process.env.EMBEDDING_DIM = "768";
    process.env.EMBEDDING_PROVIDER = "local";
    // Baseline so existing tests see solana / polymarket as fully available.
    process.env.JUPITER_API_KEY = "test-jupiter-key";
    process.env.POLYMARKET_API_KEY = "test-polymarket-key";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("returns a non-empty markdown preamble", () => {
    const text = buildInstructions();
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("# EchoClaw MCP");
  });

  it("mentions discover_tools and execute_tool meta-tools", () => {
    const text = buildInstructions();
    expect(text).toContain("discover_tools");
    expect(text).toContain("execute_tool");
  });

  it("mentions that the host is the approval gate", () => {
    const text = buildInstructions();
    // Either 'host' or 'Claude Code / Cursor / Codex' should appear in the
    // approval/gate section.
    expect(text.toLowerCase()).toContain("host");
    expect(text).toMatch(/approval|gate|permission/i);
  });

  it("explicitly states there are no subagents", () => {
    const text = buildInstructions();
    expect(text).toMatch(/subagent/i);
    expect(text).toMatch(/no.*subagent|without.*subagent/i);
  });

  it("explicitly states schedule_* and mission_* are not surfaced", () => {
    const text = buildInstructions();
    expect(text).toMatch(/no.*schedule_/i);
    expect(text).toMatch(/no.*mission_/i);
  });

  it("does not list schedule_* or mission_* in the internal tools blurb", () => {
    const text = buildInstructions();
    // The "Internal tools (...)" line must NOT mention schedule_* or mission_*
    // anymore — they live in Echo Agent only.
    const internalToolsLine = text.match(/Internal tools \([^)]*\)/);
    expect(internalToolsLine).not.toBeNull();
    expect(internalToolsLine![0]).not.toMatch(/schedule_/);
    expect(internalToolsLine![0]).not.toMatch(/mission_/);
  });

  it("references docs:// resources for deeper reading", () => {
    const text = buildInstructions();
    expect(text).toContain("docs://overview");
    expect(text).toContain("docs://tools");
    expect(text).toContain("docs://protocols");
  });

  it("lists active protocol namespaces dynamically", () => {
    const text = buildInstructions();
    expect(text).toContain("solana");
    expect(text).toContain("polymarket");
    expect(text).not.toContain("0g-compute");
    expect(text).not.toContain("0g-storage");
  });

  // ── R5: per-namespace one-liner descriptions ────────────────────

  it("renders a one-liner description per namespace, not just the name (R5)", () => {
    const text = buildInstructions();
    // Anchor on real copy from descriptions.ts: khalani description must
    // mention bridging, slop must mention bonding curve, echobook must
    // mention social. If those substrings disappear from the preamble it
    // means the renderer dropped descriptions and the model is back to
    // seeing namespace names with no context.
    expect(text.toLowerCase()).toContain("bridge");
    expect(text.toLowerCase()).toContain("bonding curve");
    expect(text.toLowerCase()).toContain("social");
  });

  it("groups namespaces by product family", () => {
    const text = buildInstructions();
    expect(text).toContain("### 0G Ecosystem");
    expect(text).toContain("### Cross-chain");
    expect(text).toContain("### Prediction Markets");
  });

  it("shows tool counts alongside descriptions in italics (R5)", () => {
    const text = buildInstructions();
    expect(text).toMatch(/_\(\d+ active tools\)_/);
  });

  // ── Env-aware availability hints (audit follow-up) ───────────────

  it("renders 'requires X to enable' hint when a fully gated namespace has 0 active tools", () => {
    delete process.env.JUPITER_API_KEY;
    const text = buildInstructions();
    // Anchor on the solana line: 0 active tools + the JUPITER hint.
    expect(text).toMatch(/`solana`[\s\S]*0 active tools[\s\S]*requires JUPITER_API_KEY to enable/);
  });

  it("does not render env hint when a namespace has available tools", () => {
    const text = buildInstructions();
    const solanaSection = text.split("`solana`")[1]?.split("- **`")[0] ?? "";
    expect(solanaSection).not.toMatch(/requires JUPITER_API_KEY to enable/);
  });
});
