/**
 * Polymarket Relayer API client — gasless transaction submission.
 * Singleton via getPolyRelayerClient().
 */

import { fetchWithTimeout, readJson } from "../../utils/http.js";
import { isRecord } from "../../utils/validation-helpers.js";
import { mapPolyTransportError, mapPolyApiError } from "../errors.js";
import { RELAYER_BASE_URL, RELAYER_TIMEOUT_MS } from "../constants.js";
import { validateSubmitResponse, validateTransactionsResponse, validateNonceResponse, validateDeployedResponse, validateApiKeysResponse } from "./validation.js";
import logger from "../../utils/logger.js";
import type { EchoError } from "../../errors.js";
import type { RelayerSubmitRequest, RelayerSubmitResponse, RelayerTransaction, RelayerApiKey } from "./types.js";

export class PolyRelayerClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number = RELAYER_TIMEOUT_MS) {}

  private async get<T>(path: string, validator: (raw: unknown) => T, query?: Record<string, string>, headers?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    try {
      logger.debug({ event: "polymarket.relayer.request.start", path });
      const response = await fetchWithTimeout(url.toString(), { headers, timeoutMs: this.timeoutMs });
      if (!response.ok) {
        const raw = await readJson(response);
        const msg = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`;
        throw mapPolyApiError(response.status, msg, "Relayer");
      }
      return validator(await readJson(response));
    } catch (err) {
      if ((err as EchoError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  private async post<T>(path: string, body: unknown, validator: (raw: unknown) => T, headers?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();
    try {
      logger.debug({ event: "polymarket.relayer.request.start", path });
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        timeoutMs: this.timeoutMs,
      });
      if (!response.ok) {
        const raw = await readJson(response);
        const msg = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`;
        throw mapPolyApiError(response.status, msg, "Relayer");
      }
      return validator(await readJson(response));
    } catch (err) {
      if ((err as EchoError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  submitTransaction(params: RelayerSubmitRequest, authHeaders?: Record<string, string>): Promise<RelayerSubmitResponse> {
    return this.post("/submit", params, validateSubmitResponse, authHeaders);
  }

  getTransaction(id: string): Promise<RelayerTransaction[]> {
    return this.get("/transaction", validateTransactionsResponse, { id });
  }

  getTransactions(authHeaders: Record<string, string>): Promise<RelayerTransaction[]> {
    return this.get("/transactions", validateTransactionsResponse, undefined, authHeaders);
  }

  getNonce(address: string, type: "PROXY" | "SAFE"): Promise<{ nonce: string }> {
    return this.get("/nonce", validateNonceResponse, { address, type });
  }

  getRelayPayload(address: string, type: "PROXY" | "SAFE"): Promise<{ address: string; nonce: string }> {
    return this.get("/relay-payload", (raw) => {
      if (!isRecord(raw)) return { address: "", nonce: "0" };
      return { address: typeof raw.address === "string" ? raw.address : "", nonce: typeof raw.nonce === "string" ? raw.nonce : "0" };
    }, { address, type });
  }

  isDeployed(proxyAddress: string): Promise<{ deployed: boolean }> {
    return this.get("/deployed", validateDeployedResponse, { address: proxyAddress });
  }

  getApiKeys(authHeaders: Record<string, string>): Promise<RelayerApiKey[]> {
    return this.get("/relayer/api/keys", validateApiKeysResponse, undefined, authHeaders);
  }
}

let cachedClient: PolyRelayerClient | null = null;
export function getPolyRelayerClient(): PolyRelayerClient {
  if (cachedClient) return cachedClient;
  cachedClient = new PolyRelayerClient(RELAYER_BASE_URL);
  return cachedClient;
}
