/**
 * Unit tests for the `memory_language_code` contract in the sessions repo.
 *
 * Covers the LANG_CODE_RE boundary validator and the idempotency invariant
 * of `setMemoryLanguageCode` (UPDATE gated by `WHERE memory_language_code IS
 * NULL` so a second call on the same session is a no-op).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecuteWith = vi.fn();
const mockQueryOneWith = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  executeWith: (...args: unknown[]) => mockExecuteWith(...args),
  queryOneWith: (...args: unknown[]) => mockQueryOneWith(...args),
  getPool: () => ({
    query: vi.fn(),
    connect: async () => ({ query: vi.fn(), release: vi.fn() }),
  }),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn(),
}));

const { LANG_CODE_RE, getMemoryLanguageCode, setMemoryLanguageCode } = await import(
  "../../../../vex-agent/db/repos/sessions.js"
);

beforeEach(() => {
  mockExecuteWith.mockReset();
  mockExecuteWith.mockResolvedValue(0);
  mockQueryOneWith.mockReset();
});

describe("LANG_CODE_RE validator", () => {
  it("accepts bare 2-3 letter language codes", () => {
    expect(LANG_CODE_RE.test("en")).toBe(true);
    expect(LANG_CODE_RE.test("pl")).toBe(true);
    expect(LANG_CODE_RE.test("fr")).toBe(true);
    expect(LANG_CODE_RE.test("zh")).toBe(true);
    expect(LANG_CODE_RE.test("vi")).toBe(true);
    expect(LANG_CODE_RE.test("kor")).toBe(true);
  });

  it("accepts language-region with uppercase region", () => {
    expect(LANG_CODE_RE.test("pt-BR")).toBe(true);
    expect(LANG_CODE_RE.test("zh-CN")).toBe(true);
    expect(LANG_CODE_RE.test("en-US")).toBe(true);
  });

  it("accepts the und fallback", () => {
    expect(LANG_CODE_RE.test("und")).toBe(true);
  });

  it("rejects uppercase language part", () => {
    expect(LANG_CODE_RE.test("EN")).toBe(false);
    expect(LANG_CODE_RE.test("Pt-BR")).toBe(false);
  });

  it("rejects lowercase region suffix", () => {
    expect(LANG_CODE_RE.test("pt-br")).toBe(false);
  });

  it("rejects length outliers and garbage", () => {
    expect(LANG_CODE_RE.test("")).toBe(false);
    expect(LANG_CODE_RE.test("e")).toBe(false);
    expect(LANG_CODE_RE.test("engli")).toBe(false);
    expect(LANG_CODE_RE.test("123")).toBe(false);
    expect(LANG_CODE_RE.test("garbage!")).toBe(false);
  });

  it("rejects codes with spaces or extra suffixes", () => {
    expect(LANG_CODE_RE.test(" en")).toBe(false);
    expect(LANG_CODE_RE.test("en ")).toBe(false);
    expect(LANG_CODE_RE.test("en-US-variant")).toBe(false);
  });
});

describe("setMemoryLanguageCode", () => {
  it("throws LOUD on codes that fail LANG_CODE_RE and never issues SQL", async () => {
    await expect(setMemoryLanguageCode("session-1", "GARBAGE!")).rejects.toThrow(
      /invalid code/i,
    );
    expect(mockExecuteWith).not.toHaveBeenCalled();
  });

  it("runs an UPDATE gated by WHERE memory_language_code IS NULL for valid codes", async () => {
    await setMemoryLanguageCode("session-1", "pl");
    expect(mockExecuteWith).toHaveBeenCalledTimes(1);
    const [, sql, params] = mockExecuteWith.mock.calls[0] as [
      unknown,
      string,
      unknown[],
    ];
    expect(sql).toMatch(/UPDATE sessions SET memory_language_code/);
    expect(sql).toMatch(/WHERE id = \$1 AND memory_language_code IS NULL/);
    expect(params).toEqual(["session-1", "pl"]);
  });

  it("accepts und / en-US shapes without throwing", async () => {
    await expect(setMemoryLanguageCode("session-1", "und")).resolves.toBeUndefined();
    await expect(setMemoryLanguageCode("session-1", "en-US")).resolves.toBeUndefined();
  });
});

describe("getMemoryLanguageCode", () => {
  it("returns null when the row has no persisted value", async () => {
    mockQueryOneWith.mockResolvedValueOnce(null);
    const result = await getMemoryLanguageCode("session-1");
    expect(result).toBeNull();
  });

  it("returns null when the row exists but column is NULL", async () => {
    mockQueryOneWith.mockResolvedValueOnce({ memory_language_code: null });
    const result = await getMemoryLanguageCode("session-1");
    expect(result).toBeNull();
  });

  it("returns the persisted code as-is (no validation on read)", async () => {
    mockQueryOneWith.mockResolvedValueOnce({ memory_language_code: "pl" });
    const result = await getMemoryLanguageCode("session-1");
    expect(result).toBe("pl");
  });
});
