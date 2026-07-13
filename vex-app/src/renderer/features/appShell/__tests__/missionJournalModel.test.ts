/**
 * Pure derivation tests for the mission-result Decision Journal: rationale
 * distillation, trade↔reasoning timestamp mapping, mission-scoped bag counting,
 * and the run-window filter.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import {
  RATIONALE_MAX_CHARS,
  buildJournal,
  countMissionBagsHeld,
  distillRationale,
  isWithinRun,
  selectReasoningTurns,
  tradedToken,
  type JournalMessage,
  type JournalMove,
} from "../missionJournalModel.js";

function move(over: Partial<JournalMove>): JournalMove {
  return {
    id: "1",
    tradeSide: "buy",
    inputToken: "ETH",
    outputToken: "VENA",
    createdAt: "2026-07-13T10:00:00.000Z",
    ...over,
  };
}

function msg(over: Partial<JournalMessage>): JournalMessage {
  return {
    id: 1,
    role: "assistant",
    kind: "text",
    content: "hello",
    createdAt: "2026-07-13T10:00:00.000Z",
    ...over,
  };
}

describe("distillRationale", () => {
  it("strips markdown headers, emphasis, and bullets to the first sentence", () => {
    const raw =
      "## Decision\n\n**Buying VENA** because momentum is strong. It also has volume.";
    expect(distillRationale(raw)).toBe("Buying VENA because momentum is strong.");
  });

  it("drops list markers and collapses whitespace", () => {
    const raw = "- Entering   the   trade now.\n- second point";
    expect(distillRationale(raw)).toBe("Entering the trade now.");
  });

  it("removes emoji and warning glyphs", () => {
    expect(distillRationale("⚠️ Selling to cut the loss. ✅")).toBe(
      "Selling to cut the loss.",
    );
  });

  it("strips inline code and fenced blocks", () => {
    const raw = "Ran ```\ncode\n``` then decided to `buy` the dip now.";
    expect(distillRationale(raw)).toBe("Ran then decided to buy the dip now.");
  });

  it("resolves markdown links to their text", () => {
    expect(distillRationale("See [the chart](http://x.io) for the setup.")).toBe(
      "See the chart for the setup.",
    );
  });

  it("falls back past a too-short lead sentence", () => {
    const raw = "OK. Now selling because the target was hit cleanly.";
    expect(distillRationale(raw)).toBe(
      "OK. Now selling because the target was hit cleanly.",
    );
  });

  it("truncates long rationales on a word boundary with an ellipsis", () => {
    const raw =
      "Buying this token because the on-chain volume keeps climbing and the holder base is expanding steadily across every hour of the session window here";
    const out = distillRationale(raw);
    expect(out.length).toBeLessThanOrEqual(RATIONALE_MAX_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
  });

  it("returns empty string for empty / whitespace-only input", () => {
    expect(distillRationale("")).toBe("");
    expect(distillRationale("   \n  ")).toBe("");
  });
});

describe("tradedToken", () => {
  it("returns the output token for a buy", () => {
    expect(tradedToken(move({ tradeSide: "buy", outputToken: "VENA" }))).toBe(
      "VENA",
    );
  });

  it("returns the input token for a sell", () => {
    expect(
      tradedToken(move({ tradeSide: "sell", inputToken: "VENA", outputToken: "ETH" })),
    ).toBe("VENA");
  });

  it("ignores unit legs and empty tokens", () => {
    expect(tradedToken(move({ tradeSide: "buy", outputToken: "ETH" }))).toBeNull();
    expect(tradedToken(move({ tradeSide: "buy", outputToken: null }))).toBeNull();
    expect(
      tradedToken(
        move({
          tradeSide: "sell",
          inputToken: "0x4200000000000000000000000000000000000006",
        }),
      ),
    ).toBeNull();
  });
});

describe("isWithinRun", () => {
  const start = "2026-07-13T10:00:00.000Z";
  const end = "2026-07-13T10:41:00.000Z";
  it("includes moves inside the window and excludes those outside", () => {
    expect(isWithinRun("2026-07-13T10:20:00.000Z", start, end)).toBe(true);
    expect(isWithinRun("2026-07-13T09:59:00.000Z", start, end)).toBe(false);
    expect(isWithinRun("2026-07-13T10:42:00.000Z", start, end)).toBe(false);
  });
  it("treats a null endedAt as an open upper bound", () => {
    expect(isWithinRun("2026-07-14T00:00:00.000Z", start, null)).toBe(true);
  });
  it("excludes unparseable timestamps", () => {
    expect(isWithinRun("not-a-date", start, end)).toBe(false);
  });
});

describe("countMissionBagsHeld", () => {
  const start = "2026-07-13T10:00:00.000Z";
  const end = "2026-07-13T10:41:00.000Z";

  it("returns 0 when every bought token is later sold (the reported bug)", () => {
    const moves: JournalMove[] = [
      move({ id: "1", tradeSide: "buy", outputToken: "AAA", createdAt: "2026-07-13T10:05:00.000Z" }),
      move({ id: "2", tradeSide: "buy", outputToken: "BBB", createdAt: "2026-07-13T10:06:00.000Z" }),
      move({ id: "3", tradeSide: "buy", outputToken: "CCC", createdAt: "2026-07-13T10:07:00.000Z" }),
      move({ id: "4", tradeSide: "sell", inputToken: "AAA", outputToken: "ETH", createdAt: "2026-07-13T10:30:00.000Z" }),
      move({ id: "5", tradeSide: "sell", inputToken: "BBB", outputToken: "ETH", createdAt: "2026-07-13T10:31:00.000Z" }),
      move({ id: "6", tradeSide: "sell", inputToken: "CCC", outputToken: "ETH", createdAt: "2026-07-13T10:32:00.000Z" }),
    ];
    expect(countMissionBagsHeld(moves, start, end)).toBe(0);
  });

  it("counts a token bought but not sold", () => {
    const moves: JournalMove[] = [
      move({ id: "1", tradeSide: "buy", outputToken: "AAA", createdAt: "2026-07-13T10:05:00.000Z" }),
      move({ id: "2", tradeSide: "buy", outputToken: "BBB", createdAt: "2026-07-13T10:06:00.000Z" }),
      move({ id: "3", tradeSide: "sell", inputToken: "AAA", outputToken: "ETH", createdAt: "2026-07-13T10:30:00.000Z" }),
    ];
    expect(countMissionBagsHeld(moves, start, end)).toBe(1);
  });

  it("ignores pre-existing legacy holdings sold before the mission window", () => {
    const moves: JournalMove[] = [
      // Legacy sell before the run starts — must not count as a mission bag.
      move({ id: "0", tradeSide: "sell", inputToken: "OLD", outputToken: "ETH", createdAt: "2026-07-13T09:00:00.000Z" }),
      move({ id: "1", tradeSide: "buy", outputToken: "AAA", createdAt: "2026-07-13T10:05:00.000Z" }),
      move({ id: "2", tradeSide: "sell", inputToken: "AAA", outputToken: "ETH", createdAt: "2026-07-13T10:30:00.000Z" }),
    ];
    expect(countMissionBagsHeld(moves, start, end)).toBe(0);
  });
});

describe("selectReasoningTurns", () => {
  it("keeps assistant prose + stopped turns, drops empties, tool + user rows", () => {
    const messages: JournalMessage[] = [
      msg({ id: 1, role: "user", content: "go" }),
      msg({ id: 2, role: "assistant", kind: "text", content: "thinking" }),
      msg({ id: 3, role: "assistant", kind: "tool_call", content: "call" }),
      msg({ id: 4, role: "assistant", kind: "text", content: "   " }),
      msg({ id: 5, role: "assistant", kind: "assistant_stopped", content: "halted" }),
    ];
    const turns = selectReasoningTurns(messages);
    expect(turns.map((t) => t.id)).toEqual([2, 5]);
  });

  it("sorts oldest→newest with id as the tie-break", () => {
    const same = "2026-07-13T10:00:00.000Z";
    const turns = selectReasoningTurns([
      msg({ id: 9, content: "b", createdAt: same }),
      msg({ id: 4, content: "a", createdAt: same }),
    ]);
    expect(turns.map((t) => t.id)).toEqual([4, 9]);
  });
});

describe("buildJournal", () => {
  const start = "2026-07-13T10:00:00.000Z";
  const end = "2026-07-13T10:41:00.000Z";

  it("anchors each trade to the last reasoning turn at/before it", () => {
    const messages: JournalMessage[] = [
      msg({ id: 1, content: "## Plan\n**Buying AAA** on strong momentum.", createdAt: "2026-07-13T10:04:00.000Z" }),
      msg({ id: 2, content: "Selling AAA — target hit.", createdAt: "2026-07-13T10:29:00.000Z" }),
    ];
    const moves: JournalMove[] = [
      move({ id: "m2", tradeSide: "sell", inputToken: "AAA", outputToken: "ETH", createdAt: "2026-07-13T10:30:00.000Z" }),
      move({ id: "m1", tradeSide: "buy", outputToken: "AAA", createdAt: "2026-07-13T10:05:00.000Z" }),
    ];
    const journal = buildJournal(moves, messages, start, end);
    // Sorted chronologically: buy first, then sell.
    expect(journal.map((e) => e.key)).toEqual(["m1", "m2"]);
    expect(journal[0]?.side).toBe("buy");
    expect(journal[0]?.token).toBe("AAA");
    expect(journal[0]?.rationaleLine).toBe("Buying AAA on strong momentum.");
    expect(journal[0]?.rationaleFull).toBe("## Plan\n**Buying AAA** on strong momentum.");
    expect(journal[1]?.side).toBe("sell");
    expect(journal[1]?.rationaleLine).toBe("Selling AAA — target hit.");
  });

  it("leaves a trade with no preceding reasoning null (never fabricates)", () => {
    const moves: JournalMove[] = [
      move({ id: "m1", tradeSide: "buy", outputToken: "AAA", createdAt: "2026-07-13T10:05:00.000Z" }),
    ];
    const journal = buildJournal(moves, [], start, end);
    expect(journal[0]?.rationaleFull).toBeNull();
    expect(journal[0]?.rationaleLine).toBeNull();
  });

  it("excludes trades outside the run window (prior-mission moves)", () => {
    const moves: JournalMove[] = [
      move({ id: "old", tradeSide: "buy", outputToken: "OLD", createdAt: "2026-07-13T09:00:00.000Z" }),
      move({ id: "m1", tradeSide: "buy", outputToken: "AAA", createdAt: "2026-07-13T10:05:00.000Z" }),
    ];
    const journal = buildJournal(moves, [], start, end);
    expect(journal.map((e) => e.key)).toEqual(["m1"]);
  });

  it("truncates an address-like traded token for the chip, keeping the full value", () => {
    const addr = "AbCdEf1234567890ghijKLMnop";
    const journal = buildJournal(
      [move({ id: "m1", tradeSide: "buy", outputToken: addr, createdAt: "2026-07-13T10:05:00.000Z" })],
      [],
      start,
      end,
    );
    expect(journal[0]?.tokenFull).toBe(addr);
    expect(journal[0]?.token).not.toBe(addr);
    expect(journal[0]?.token).toContain("…");
  });
});
