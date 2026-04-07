/**
 * Production MCP — Streamable HTTP transport entry on Fastify.
 *
 * Architecture:
 *   - Fastify instance binding to `127.0.0.1` on `MCP_HTTP_PORT` (default 4203).
 *   - Three-layer defense:
 *       1. Loopback bind — external addresses cannot reach the process.
 *       2. Host header validation hook (`onRequest`) — replicates DNS rebinding
 *          protection. Allows only `127.0.0.1:{port}`, `localhost:{port}`,
 *          `[::1]:{port}`. Replaces SDK's `createMcpExpressApp` helper so we
 *          stay on Fastify (own TS types, lighter deps).
 *       3. Bearer token preHandler — `Authorization: Bearer {token}` against
 *          a token persisted in `CONFIG_DIR/mcp-http-token` (mode 0600).
 *   - StreamableHTTPServerTransport from the SDK is mounted on
 *     `POST/GET/DELETE /mcp`. The SDK's `handleRequest(req, res, parsedBody?)`
 *     expects raw Node IncomingMessage / ServerResponse, which Fastify exposes
 *     as `request.raw` / `reply.raw`. We pass `request.body` for POSTs so the
 *     SDK does not have to re-parse what Fastify already parsed.
 *   - The HTTP docs mirror is mounted on the same Fastify instance via
 *     `mountHttpDocs(fastify)` so it inherits the same hooks (host validation
 *     + bearer).
 *
 * Session lifecycle in v1: one DB session per HTTP server boot. Created by
 * `createMcpSession({transport:"http"})` before the McpServer is built and
 * ended on graceful shutdown (SIGINT/SIGTERM). Per-MCP-session DB sessions
 * are a follow-up if multi-tenant deployments come into scope.
 */

import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createMcpServerInstance } from "../server/create-server.js";
import { createMcpSession, endMcpSession } from "../sessions.js";
import { mountHttpDocs } from "../docs/http-mirror.js";
import { loadOrCreateHttpToken } from "../auth/token.js";
import logger from "@utils/logger.js";

const DEFAULT_PORT = 4203;
const BIND_HOST = "127.0.0.1";

function parsePort(): number {
  const raw = (process.env.MCP_HTTP_PORT ?? "").trim();
  if (!raw) return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    logger.warn("mcp.http.invalid_port_using_default", { raw, default: DEFAULT_PORT });
    return DEFAULT_PORT;
  }
  return parsed;
}

/** Build the allowed Host header set for the configured port. */
function buildAllowedHosts(port: number): Set<string> {
  // Browser / curl normalizes the Host header to `<hostname>:<port>` (or just
  // `<hostname>` for default ports — neither stdio nor HTTP MCP uses 80/443).
  return new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
}

export async function startHttpTransport(): Promise<void> {
  const port = parsePort();
  const token = loadOrCreateHttpToken();
  const allowedHosts = buildAllowedHosts(port);
  const sessionId = await createMcpSession({ transport: "http" });

  const fastify: FastifyInstance = Fastify({
    // Quiet built-in pino logger; we already log via winston on stderr.
    logger: false,
    // Disable trust proxy — we are loopback only.
    trustProxy: false,
  });

  // ── Layer 2: host header validation (DNS rebinding protection) ────────
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const hostHeader = request.headers.host;
    if (!hostHeader || !allowedHosts.has(hostHeader)) {
      logger.warn("mcp.http.host_rejected", { host: hostHeader ?? "<missing>" });
      reply.code(403).send({ error: "forbidden" });
    }
  });

  // ── Layer 3: bearer token ────────────────────────────────────────────
  const expectedAuth = `Bearer ${token}`;
  fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization ?? "";
    if (auth.length !== expectedAuth.length || auth !== expectedAuth) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  // Mount docs mirror on the same instance — inherits hooks above.
  mountHttpDocs(fastify);

  // ── McpServer + Streamable HTTP transport ─────────────────────────────
  const server = createMcpServerInstance({
    sessionIdProvider: () => sessionId,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  transport.onclose = () => {
    void endMcpSession(sessionId);
    logger.info("mcp.http.transport_closed", { sessionId });
  };

  await server.connect(transport);

  // Pass raw Node req/res to the SDK transport. The SDK does not understand
  // Fastify's request/reply abstractions; it expects Node primitives.
  const handleMcp = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      logger.warn("mcp.http.handle_failed", {
        method: request.method,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!reply.raw.headersSent) {
        reply.code(500).send({ error: "internal" });
      }
    }
  };

  fastify.post("/mcp", handleMcp);
  fastify.get("/mcp", handleMcp);
  fastify.delete("/mcp", handleMcp);

  await fastify.listen({ host: BIND_HOST, port });
  logger.info("mcp.http.listening", { host: BIND_HOST, port, sessionId });

  // ── Graceful shutdown ─────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("mcp.http.shutdown", { signal, sessionId });
    try {
      await fastify.close();
    } catch (err) {
      logger.warn("mcp.http.close_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await endMcpSession(sessionId);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
