/**
 * Tolerant tool-name resolution — separator-variant routing.
 *
 * Regression for the 31s / 0-trade mission dead-end: the model emitted
 * protocol toolIds directly as tool names AND swapped the canonical dot for an
 * underscore (`dexscreener_search` for `dexscreener.search`), so dispatch fell
 * through to "Unknown tool" and the mission stopped without discovering or
 * trading anything. Dispatch must resolve both separator forms to the canonical
 * protocol tool and route it through `executeProtocolTool` (all gates intact),
 * while genuinely unknown names still return "Unknown tool" and exact-match
 * behavior is unchanged.
 */

import { describe, it, expect } from "vitest";
import "./_dispatcher-test-mocks.js";
import { makeTestContext } from "./_test-context.js";

const { dispatchTool } = await import("../../../vex-agent/tools/dispatcher.js");
const { resolveProtocolToolId } = await import(
  "../../../vex-agent/tools/protocols/catalog.js"
);
const { getAllTools } = await import("../../../vex-agent/tools/registry.js");
const { normalizeToolName } = await import(
  "../../../vex-agent/tools/name-normalize.js"
);

const baseContext = makeTestContext();

describe("dispatcher — tolerant tool-name resolution (underscore↔dot)", () => {
  // ── Underscore variants of protocol toolIds route (the actual bug) ──

  it("routes `dexscreener_search` to the `dexscreener.search` protocol tool (not Unknown tool)", async () => {
    // Empty params → the resolved manifest's required `query` param is
    // reported by executeProtocolTool's strict validator, proving the call
    // reached the protocol runtime rather than dead-ending at Unknown tool.
    const result = await dispatchTool(
      { name: "dexscreener_search", args: {}, toolCallId: "call_ds_us" },
      baseContext,
    );

    expect(result.output).not.toContain("Unknown tool");
    expect(result.output).toContain("query");
  });

  it("routes `virtuals_list` to the `virtuals.list` protocol tool (not Unknown tool)", async () => {
    // `virtuals.list` requires `chain` — empty params surface that, proving
    // the underscore variant resolved and dispatched into the runtime.
    const result = await dispatchTool(
      { name: "virtuals_list", args: {}, toolCallId: "call_vl_us" },
      baseContext,
    );

    expect(result.output).not.toContain("Unknown tool");
    expect(result.output).toContain("chain");
  });

  it("routes `dexscreener_attention` to the `dexscreener.attention` protocol tool (not Unknown tool)", async () => {
    // `dexscreener.attention` has only optional params; an unknown/extra key
    // trips the strict param-boundary validator — a protocol-runtime error,
    // NOT the dispatcher's Unknown-tool dead-end (and no network call).
    const result = await dispatchTool(
      { name: "dexscreener_attention", args: { __probe_unknown_key: 1 }, toolCallId: "call_da_us" },
      baseContext,
    );

    expect(result.output).not.toContain("Unknown tool");
    expect(result.success).toBe(false);
  });

  // ── Exact canonical dot names still route unchanged ────────────────

  it("routes the exact canonical dot name `dexscreener.search` through the runtime", async () => {
    const result = await dispatchTool(
      { name: "dexscreener.search", args: {}, toolCallId: "call_ds_dot" },
      baseContext,
    );

    expect(result.output).not.toContain("Unknown tool");
    expect(result.output).toContain("query");
  });

  // ── Genuinely unknown names still dead-end (guard the fallback) ─────

  it("still returns Unknown tool for a genuinely unknown name", async () => {
    const result = await dispatchTool(
      { name: "totally_made_up_tool", args: {}, toolCallId: "call_unknown" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown tool");
  });

  it("does not resolve an internal-tool name to a protocol tool", () => {
    // `wallet_balances` is an internal tool, not a protocol toolId — the
    // protocol resolver must not claim it.
    expect(resolveProtocolToolId("wallet_balances")).toBeUndefined();
    expect(resolveProtocolToolId("totally_made_up_tool")).toBeUndefined();
  });

  // ── Collision safety over the REAL registries ──────────────────────

  it("no two protocol toolIds collide under normalization", async () => {
    const { getAllProtocolToolIds } = await import(
      "../../../vex-agent/tools/protocols/catalog.js"
    );
    const ids: string[] = getAllProtocolToolIds();
    const byKey = new Map<string, string[]>();
    for (const id of ids) {
      const key = normalizeToolName(id);
      byKey.set(key, [...(byKey.get(key) ?? []), id]);
    }
    const collisions = [...byKey.values()].filter((g) => g.length > 1);
    expect(collisions).toEqual([]);
  });

  it("no two internal tool names collide under normalization", () => {
    const byKey = new Map<string, string[]>();
    for (const t of getAllTools()) {
      const key = normalizeToolName(t.name);
      byKey.set(key, [...(byKey.get(key) ?? []), t.name]);
    }
    const collisions = [...byKey.values()].filter((g) => g.length > 1);
    expect(collisions).toEqual([]);
  });
});
