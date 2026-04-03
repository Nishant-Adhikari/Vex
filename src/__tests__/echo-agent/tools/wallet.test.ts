import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock wallet dependencies — no real keystore/config in test env
vi.mock("@tools/wallet/multi-auth.js", () => ({
  requireEvmWallet: () => ({ family: "eip155", address: "0x1234567890abcdef1234567890abcdef12345678", privateKey: "0x" + "ab".repeat(32) }),
  requireSolanaWallet: () => ({ family: "solana", address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", secretKey: new Uint8Array(64) }),
}));

vi.mock("@tools/wallet/family.js", () => ({
  normalizeWalletChain: (input?: string) => {
    if (!input || input === "eip155" || input === "evm") return "eip155";
    if (input === "solana" || input === "sol") return "solana";
    throw new Error(`Unsupported wallet chain: ${input}`);
  },
}));

const MOCK_CHAIN = {
  id: 16661, name: "0G", type: "eip155" as const,
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.0g.example.com"] } },
};

vi.mock("@tools/khalani/client.js", () => ({
  getKhalaniClient: () => ({
    getTokenBalances: async (address: string, chainIds?: number[]) => [
      { address: "native", chainId: 16661, symbol: "0G", decimals: 18, extensions: { balance: "5000000000000000000", price: { usd: "0.05" } } },
      { address: "0xUSDC", chainId: 16661, symbol: "USDC", decimals: 6, extensions: { balance: "100000000", price: { usd: "1.00" } } },
    ],
    getChains: async () => [MOCK_CHAIN],
  }),
}));

vi.mock("@tools/khalani/chains.js", () => ({
  resolveChainId: () => 16661,
  getChain: () => MOCK_CHAIN,
}));

vi.mock("@tools/khalani/evm-client.js", () => ({
  createDynamicPublicClient: () => ({
    waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 123n }),
    readContract: async () => 18, // decimals fallback
  }),
  createDynamicWalletClient: () => ({
    sendTransaction: async () => "0xmockhash" as `0x${string}`,
    writeContract: async () => "0xmockhash" as `0x${string}`,
    account: { address: "0x1234567890abcdef1234567890abcdef12345678" },
  }),
}));

// Keep old mocks for backward compat (unused after rewrite but safe to have)
vi.mock("@tools/wallet/client.js", () => ({
  getPublicClient: () => ({ waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 123n }) }),
}));

vi.mock("@tools/wallet/signingClient.js", () => ({
  getSigningClient: () => ({ sendTransaction: async () => "0xmockhash" }),
}));

vi.mock("@tools/solana-ecosystem/shared/solana-transfer.js", () => ({
  sendSol: async () => ({ signature: "mocksig123", explorerUrl: "https://explorer.solana.com/tx/mocksig123" }),
  sendSplToken: async () => ({ signature: "mocksplsig456", explorerUrl: "https://explorer.solana.com/tx/mocksplsig456" }),
}));

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js", () => ({
  resolveJupiterToken: async (sym: string) => {
    if (sym === "USDC") return { chain: "solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6 };
    return undefined;
  },
}));

vi.mock("@solana/web3.js", async () => {
  const actual = await vi.importActual<typeof import("@solana/web3.js")>("@solana/web3.js");
  return { ...actual, Keypair: { fromSecretKey: () => ({ publicKey: { toBase58: () => "9WzDXwBbmkg" } }) } };
});

const { handleWalletRead, handleWalletSendPrepare, handleWalletSendConfirm } = await import(
  "../../../echo-agent/tools/internal/wallet.js"
);

const baseContext = {
  sessionId: "test-session",
  loadedKnowledge: new Map<string, string>(),
  loopMode: "off" as const,
  approved: false,
};

describe("wallet_read", () => {
  // ── address ────────────────────────────────────────────────────

  it("returns EVM address by default", async () => {
    const result = await handleWalletRead({ action: "address" }, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.chain).toBe("eip155");
    expect(data.address).toMatch(/^0x/);
  });

  it("returns EVM address when chain=eip155", async () => {
    const result = await handleWalletRead({ action: "address", chain: "eip155" }, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.chain).toBe("eip155");
  });

  it("returns Solana address when chain=solana", async () => {
    const result = await handleWalletRead({ action: "address", chain: "solana" }, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.chain).toBe("solana");
    expect(data.address).toBeTruthy();
  });

  // ── balances ───────────────────────────────────────────────────

  it("returns balances for all wallets by default", async () => {
    const result = await handleWalletRead({ action: "balances" }, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.wallets).toBeInstanceOf(Array);
    expect(data.wallets.length).toBeGreaterThanOrEqual(1);
  });

  it("returns balances for eip155 only", async () => {
    const result = await handleWalletRead({ action: "balances", wallet: "eip155" }, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.wallets).toHaveLength(1);
    expect(data.wallets[0].wallet).toBe("eip155");
    expect(data.wallets[0].tokens.length).toBeGreaterThan(0);
  });

  it("returns balances for solana only", async () => {
    const result = await handleWalletRead({ action: "balances", wallet: "solana" }, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.wallets).toHaveLength(1);
    expect(data.wallets[0].wallet).toBe("solana");
  });

  it("balances include token data with prices", async () => {
    const result = await handleWalletRead({ action: "balances", wallet: "eip155" }, baseContext);
    const data = JSON.parse(result.output);
    const tokens = data.wallets[0].tokens;
    expect(tokens[0].symbol).toBe("0G");
    expect(tokens[0].extensions.price.usd).toBe("0.05");
  });

  // ── errors ─────────────────────────────────────────────────────

  it("fails on unknown action", async () => {
    const result = await handleWalletRead({ action: "foo" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown wallet_read action");
  });

  it("fails when action is missing", async () => {
    const result = await handleWalletRead({}, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown wallet_read action");
  });
});

describe("wallet_send_prepare", () => {
  it("creates a transfer intent for Solana native", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.5" },
      baseContext,
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.intentId).toMatch(/^intent-/);
    expect(data.network).toBe("solana");
    expect(data.amount).toBe("1.5");
    expect(data.token).toBe("native");
    expect(data.status).toBe("prepared");
  });

  it("creates a transfer intent for EVM", async () => {
    const result = await handleWalletSendPrepare(
      { network: "eip155", to: "0x1234567890abcdef1234567890abcdef12345678", amount: "0.5" },
      baseContext,
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.network).toBe("eip155");
  });

  it("creates intent with SPL token", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "100", token: "USDC" },
      baseContext,
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.token).toBe("USDC");
  });

  it("fails without network", async () => {
    const result = await handleWalletSendPrepare(
      { to: "0x123", amount: "1" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("fails without to", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", amount: "1" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("fails without amount", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("fails on invalid amount", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg", amount: "abc" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid amount");
  });

  it("fails on zero amount", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg", amount: "0" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid amount");
  });

  it("fails on invalid network", async () => {
    const result = await handleWalletSendPrepare(
      { network: "bitcoin", to: "abc", amount: "1" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("network must be");
  });
});

describe("wallet_send_confirm", () => {
  it("fails without intentId", async () => {
    const result = await handleWalletSendConfirm(
      { network: "solana" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("fails on unknown intentId", async () => {
    const result = await handleWalletSendConfirm(
      { network: "solana", intentId: "intent-nonexistent" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Intent not found");
  });

  it("executes Solana native transfer after prepare", async () => {
    // Prepare
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.0" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    // Confirm
    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.signature).toBe("mocksig123");
  });

  it("executes Solana SPL token transfer after prepare", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "50", token: "USDC" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.signature).toBe("mocksplsig456");
  });

  it("executes EVM native transfer after prepare", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "eip155", to: "0x1234567890abcdef1234567890abcdef12345678", amount: "0.1" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.txHash).toBe("0xmockhash");
  });

  it("intent is one-time use — second confirm fails", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.0" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    // First confirm
    await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );

    // Second confirm — should fail
    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Intent not found");
  });

  it("fails on network mismatch", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.0" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Network mismatch");
  });

  it("includes _tradeCapture in result data", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.0" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.data).toBeDefined();
    expect(result.data!._tradeCapture).toBeDefined();
    expect((result.data!._tradeCapture as Record<string, unknown>).type).toBe("transfer");
    expect((result.data!._tradeCapture as Record<string, unknown>).chain).toBe("solana");
  });

  it("fails on unknown token for SPL transfer", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "10", token: "NONEXISTENT" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(false);
    // Without JUPITER_API_KEY, resolution fails with key error; with key, it fails with "Token not found"
    expect(result.output).toMatch(/Token not found|JUPITER_API_KEY/);
  });
});
