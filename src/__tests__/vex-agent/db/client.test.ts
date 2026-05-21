import { describe, expect, it, vi } from "vitest";

// `withTransaction` resolves the pool client through `getPool().connect()`.
// The mock returns a fake client whose `.query()` we observe and whose
// `.release()` we assert always fires.

interface FakeClient {
  readonly query: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
}

let currentClient: FakeClient | null = null;
const connectMock = vi.fn(async () => {
  currentClient = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
  return currentClient;
});

vi.mock("pg", () => {
  class FakePool {
    connect() {
      return connectMock();
    }
    on() {
      return this;
    }
  }
  return { default: { Pool: FakePool } };
});

// Force a clean module + env BEFORE importing client.
process.env.VEX_DB_URL = "postgresql://test:test@localhost/test";

const { withTransaction } = await import(
  "../../../vex-agent/db/client.js"
);

describe("withTransaction", () => {
  it("commits on success and releases the client", async () => {
    connectMock.mockClear();

    const result = await withTransaction(async (client) => {
      await client.query("SELECT 1");
      return 42;
    });

    expect(result).toBe(42);
    const client = currentClient!;
    expect(connectMock).toHaveBeenCalledTimes(1);
    // Calls in order: BEGIN, SELECT 1, COMMIT
    expect(client.query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(client.query.mock.calls[1]?.[0]).toBe("SELECT 1");
    expect(client.query.mock.calls[2]?.[0]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and rethrows when the callback throws", async () => {
    connectMock.mockClear();

    await expect(
      withTransaction(async (client) => {
        await client.query("SELECT 1");
        throw new Error("inner failure");
      }),
    ).rejects.toThrow("inner failure");

    const client = currentClient!;
    const queries = client.query.mock.calls.map((c) => c[0]);
    expect(queries).toContain("BEGIN");
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("does not mask the original throw when ROLLBACK itself fails", async () => {
    connectMock.mockClear();

    await expect(
      withTransaction(async (client) => {
        await client.query("BEGIN-ish");
        client.query.mockRejectedValueOnce(new Error("rollback failed"));
        throw new Error("original failure");
      }),
    ).rejects.toThrow("original failure");

    const client = currentClient!;
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
