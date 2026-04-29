/**
 * Polymarket Bridge API client — deposit, withdraw, quote, status.
 * All public, no auth. Singleton via getPolyBridgeClient().
 */

import { loadConfig } from "../../../config/store.js";
import { fetchWithTimeout, readJson } from "../../../utils/http.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import { mapPolyTransportError, mapPolyApiError } from "../errors.js";
import { BRIDGE_BASE_URL, BRIDGE_TIMEOUT_MS } from "../constants.js";
import { validateSupportedAssetsResponse, validateDepositResponse, validateQuoteResponse, validateTransactionsResponse } from "./validation.js";
import logger from "../../../utils/logger.js";
import type { VexError } from "../../../errors.js";
import type { BridgeSupportedAsset, BridgeDepositResponse, BridgeQuoteRequest, BridgeQuoteResponse, BridgeTransaction } from "./types.js";

export class PolyBridgeClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number = BRIDGE_TIMEOUT_MS) {}

  private async get<T>(path: string, validator: (raw: unknown) => T, query?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    try {
      logger.debug({ event: "polymarket.bridge.request.start", path });
      const response = await fetchWithTimeout(url.toString(), { timeoutMs: this.timeoutMs });
      if (!response.ok) {
        const raw = await readJson(response);
        const msg = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`;
        throw mapPolyApiError(response.status, msg, "Bridge");
      }
      return validator(await readJson(response));
    } catch (err) {
      if ((err as VexError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  private async post<T>(path: string, body: unknown, validator: (raw: unknown) => T): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();
    try {
      logger.debug({ event: "polymarket.bridge.request.start", path });
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeoutMs: this.timeoutMs,
      });
      if (!response.ok) {
        const raw = await readJson(response);
        const msg = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`;
        throw mapPolyApiError(response.status, msg, "Bridge");
      }
      return validator(await readJson(response));
    } catch (err) {
      if ((err as VexError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  getSupportedAssets(): Promise<BridgeSupportedAsset[]> {
    return this.get("/supported-assets", validateSupportedAssetsResponse);
  }

  createDeposit(address: string): Promise<BridgeDepositResponse> {
    return this.post("/deposit", { address }, validateDepositResponse);
  }

  createWithdraw(params: { address: string; toChainId: string; toTokenAddress: string; recipientAddr: string }): Promise<BridgeDepositResponse> {
    return this.post("/withdraw", params, validateDepositResponse);
  }

  getQuote(params: BridgeQuoteRequest): Promise<BridgeQuoteResponse> {
    return this.post("/quote", params, validateQuoteResponse);
  }

  getStatus(address: string): Promise<BridgeTransaction[]> {
    return this.get(`/status/${encodeURIComponent(address)}`, validateTransactionsResponse);
  }
}

let cachedClient: PolyBridgeClient | null = null;
export function getPolyBridgeClient(): PolyBridgeClient {
  if (cachedClient) return cachedClient;
  cachedClient = new PolyBridgeClient(BRIDGE_BASE_URL);
  return cachedClient;
}
