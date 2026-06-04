/**
 * chain_read internal tool tests — action dispatch, input validation, mock reads.
 *
 * Scope is on-chain forensics only: tx_receipt + erc721_mint. Native balances
 * are owned by wallet_balances; token metadata by token_find.
 */

import { describe, it, expect, vi } from "vitest";
import { makeTestContext } from "../_test-context.js";

// Mock khalani chain resolution
const MOCK_CHAIN = {
  id: 137, name: "Polygon", type: "eip155" as const,
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: ["https://polygon-rpc.example.com"] } },
};

vi.mock("@tools/khalani/client.js", () => ({
  getKhalaniClient: () => ({
    getChains: vi.fn().mockResolvedValue([MOCK_CHAIN]),
  }),
}));

vi.mock("@tools/khalani/chains.js", () => ({
  resolveChainId: vi.fn().mockReturnValue(137),
  getChain: vi.fn().mockReturnValue(MOCK_CHAIN),
}));

const mockGetTransactionReceipt = vi.fn();

vi.mock("@tools/khalani/evm-client.js", () => ({
  createDynamicPublicClient: () => ({
    getTransactionReceipt: mockGetTransactionReceipt,
  }),
}));

vi.mock("@tools/kyberswap/evm-utils.js", () => ({
  extractMintedNftId: vi.fn().mockReturnValue("2879807"),
}));

const { handleChainRead } = await import("../../../../vex-agent/tools/internal/chain-read.js");

const ctx = makeTestContext({ sessionId: "test" });

describe("chain_read", () => {
  it("rejects missing action", async () => {
    const result = await handleChainRead({ chainId: "137" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: action");
  });

  it("rejects missing chainId", async () => {
    const result = await handleChainRead({ action: "tx_receipt" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: chainId");
  });

  it("rejects unknown action", async () => {
    const result = await handleChainRead({ action: "hack_contract", chainId: "137" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown action");
  });
});

describe("chain_read — tx_receipt", () => {
  it("returns receipt data", async () => {
    mockGetTransactionReceipt.mockResolvedValue({
      status: "success", blockNumber: 12345678n, gasUsed: 150000n,
      logs: [{ address: "0x1", topics: [], data: "0x" }],
      from: "0xabc", to: "0xdef", contractAddress: null,
    });
    const result = await handleChainRead({ action: "tx_receipt", chainId: "137", txHash: "0xabc123" }, ctx);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.status).toBe("success");
    expect(data.gasUsed).toBe("150000");
    expect(data.logsCount).toBe(1);
  });

  it("rejects missing txHash", async () => {
    const result = await handleChainRead({ action: "tx_receipt", chainId: "137" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: txHash");
  });
});

describe("chain_read — erc721_mint", () => {
  it("extracts minted NFTs from receipt", async () => {
    const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const WALLET = "0x00000000000000000000000018b467cb28fc07ca6e17a964b3319051b3072b79";

    mockGetTransactionReceipt.mockResolvedValue({
      status: "success", blockNumber: 100n, gasUsed: 500000n,
      logs: [
        { address: "0xc36442b4a4522e871399cd717abdd847ab11fe88", topics: [TRANSFER, ZERO, WALLET, "0x00000000000000000000000000000000000000000000000000000000002bf43f"], data: "0x" },
      ],
      from: "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79", to: "0xrouter", contractAddress: null,
    });

    const result = await handleChainRead({ action: "erc721_mint", chainId: "137", txHash: "0xabc", address: "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79" }, ctx);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.mintsFound).toBe(1);
    expect(data.mints[0].tokenId).toBe("2880575");
    expect(data.mints[0].contract).toBe("0xc36442b4a4522e871399cd717abdd847ab11fe88");
  });

  it("rejects missing txHash", async () => {
    const result = await handleChainRead({ action: "erc721_mint", chainId: "137" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: txHash");
  });
});
