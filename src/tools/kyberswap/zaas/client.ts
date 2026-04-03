/**
 * KyberSwap ZaaS (Zap as a Service) client.
 *
 * Zap In / Zap Out / Zap Migrate for concentrated liquidity provisioning.
 * Base URL: https://zap-api.kyberswap.com/{chain}/api/v1/...
 * Rate limit: 10 req/10s per X-Client-Id.
 * Singleton via getKyberZaasClient().
 */

import { loadConfig } from "../../../config/store.js";
import { fetchWithTimeout, readJson } from "../../../utils/http.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import { mapKyberTransportError } from "../errors.js";
import { mapZaasError } from "./errors.js";
import { validateZapRouteResponse, validateZapBuildResponse } from "./validation.js";
import { KYBER_CLIENT_ID, ZAAS_TIMEOUT_MS } from "../constants.js";
import logger from "../../../utils/logger.js";
import type { EchoError } from "../../../errors.js";
import type { KyberChainSlug } from "../types.js";
import type {
  ZapInRouteParams,
  ZapOutRouteParams,
  ZapMigrateRouteParams,
  ZapRouteResponse,
  ZapBuildRequest,
  ZapBuildOutRequest,
  ZapBuildMigrateRequest,
  ZapBuildResponse,
} from "./types.js";

export class KyberZaasClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = ZAAS_TIMEOUT_MS,
  ) {}

  private buildUrl(chain: KyberChainSlug, path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(`/${chain}${path}`, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value.length > 0) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private async request<T>(
    chain: KyberChainSlug,
    path: string,
    validator: (raw: unknown) => T,
    options: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = this.buildUrl(chain, path, options.query);
    const method = options.method ?? "GET";

    try {
      logger.debug({ event: "kyberswap.zaas.request.start", chain, path, method });

      const response = await fetchWithTimeout(url, {
        method,
        headers: {
          "X-Client-Id": KYBER_CLIENT_ID,
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : undefined),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        timeoutMs: this.timeoutMs,
      });

      if (!response.ok) {
        const raw = await readJson(response);
        const rpcCode = isRecord(raw) && typeof raw.code === "number" ? raw.code : null;
        const message = isRecord(raw) && typeof raw.message === "string" ? raw.message : `HTTP ${response.status}`;
        logger.warn({ event: "kyberswap.zaas.request.error", chain, path, status: response.status });
        throw mapZaasError(response.status, rpcCode, message);
      }

      const raw = await readJson(response);
      const result = validator(raw);
      logger.debug({ event: "kyberswap.zaas.request.success", chain, path });
      return result;
    } catch (err) {
      if ((err as EchoError).code?.startsWith("KYBER_")) throw err;
      mapKyberTransportError(err);
    }
  }

  private toStringQuery(params: object): Record<string, string | undefined> {
    const result: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (value !== undefined && value !== null) {
        result[key] = String(value);
      }
    }
    return result;
  }

  // ── Zap In ──────────────────────────────────────────────────────

  getZapInRoute(chain: KyberChainSlug, params: ZapInRouteParams): Promise<ZapRouteResponse> {
    return this.request(chain, "/api/v1/in/route", validateZapRouteResponse, {
      query: this.toStringQuery(params),
    });
  }

  buildZapIn(chain: KyberChainSlug, body: ZapBuildRequest): Promise<ZapBuildResponse> {
    return this.request(chain, "/api/v1/in/route/build", validateZapBuildResponse, {
      method: "POST", body,
    });
  }

  // ── Zap Out ─────────────────────────────────────────────────────

  getZapOutRoute(chain: KyberChainSlug, params: ZapOutRouteParams): Promise<ZapRouteResponse> {
    return this.request(chain, "/api/v1/out/route", validateZapRouteResponse, {
      query: this.toStringQuery(params),
    });
  }

  buildZapOut(chain: KyberChainSlug, body: ZapBuildOutRequest): Promise<ZapBuildResponse> {
    return this.request(chain, "/api/v1/out/route/build", validateZapBuildResponse, {
      method: "POST", body,
    });
  }

  // ── Zap Migrate ─────────────────────────────────────────────────

  getZapMigrateRoute(chain: KyberChainSlug, params: ZapMigrateRouteParams): Promise<ZapRouteResponse> {
    return this.request(chain, "/api/v1/migrate/route", validateZapRouteResponse, {
      query: this.toStringQuery(params),
    });
  }

  buildZapMigrate(chain: KyberChainSlug, body: ZapBuildMigrateRequest): Promise<ZapBuildResponse> {
    return this.request(chain, "/api/v1/migrate/route/build", validateZapBuildResponse, {
      method: "POST", body,
    });
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let cachedClient: KyberZaasClient | null = null;
let cachedBaseUrl: string | null = null;

export function getKyberZaasClient(): KyberZaasClient {
  const baseUrl = loadConfig().services.kyberswapZaasUrl;
  if (cachedClient && cachedBaseUrl === baseUrl) return cachedClient;
  cachedClient = new KyberZaasClient(baseUrl);
  cachedBaseUrl = baseUrl;
  return cachedClient;
}
