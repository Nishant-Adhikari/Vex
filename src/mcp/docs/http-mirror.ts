/**
 * Production MCP — HTTP docs mirror.
 *
 * Mounts read-only GET routes alongside `/mcp` on the same Fastify instance.
 * The payloads come from the same `registry-projection` functions that back
 * the MCP-native `docs://*` resources, so the two surfaces never drift.
 *
 * Hooks (host header validation + bearer token) are installed once on the
 * Fastify instance by `transports/http.ts` before this function is called,
 * so every route below inherits them automatically. This file is dumb
 * routing only; it does not install any auth.
 *
 * The mirror only ships when the HTTP transport is enabled. In stdio mode
 * there is no Fastify instance and `mountHttpDocs` is never called.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  buildOverview,
  buildProtocolList,
  buildProtocolNamespace,
  buildRuntimeEnv,
  buildSurfaceManifest,
  buildToolGroups,
} from "./registry-projection.js";

export function mountHttpDocs(fastify: FastifyInstance): void {
  fastify.get("/docs/overview", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(buildOverview());
  });

  fastify.get("/docs/tools", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(buildToolGroups());
  });

  fastify.get("/docs/protocols", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(buildProtocolList());
  });

  fastify.get<{ Params: { namespace: string } }>(
    "/docs/protocols/:namespace",
    async (req, reply) => {
      const payload = buildProtocolNamespace(req.params.namespace);
      if (!payload) {
        return reply.code(404).send({ error: `unknown namespace: ${req.params.namespace}` });
      }
      return reply.send(payload);
    },
  );

  fastify.get("/manifest.json", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(buildSurfaceManifest());
  });

  fastify.get("/runtime/env", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(buildRuntimeEnv());
  });
}
