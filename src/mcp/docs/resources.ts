/**
 * Production MCP — MCP-native documentation resources.
 *
 * Registers all `docs://*`, `surface://manifest`, and `runtime://env`
 * resources on the supplied McpServer. Each resource read callback wraps
 * the relevant `registry-projection` function in an MCP envelope. The same
 * projection functions are used by `http-mirror.ts` so the two surfaces
 * can never drift.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildOverview,
  buildProtocolList,
  buildProtocolNamespace,
  buildRuntimeEnv,
  buildSurfaceManifest,
  buildToolGroups,
} from "./registry-projection.js";

export function registerDocsResources(server: McpServer): void {
  // ── docs://overview ─────────────────────────────────────────
  server.registerResource(
    "docs-overview",
    "docs://overview",
    {
      title: "Vex MCP Overview",
      description: "Purpose, surface size, transport mode, runtime requirements",
      mimeType: "application/json",
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(buildOverview(), null, 2),
        },
      ],
    }),
  );

  // ── docs://tools ────────────────────────────────────────────
  server.registerResource(
    "docs-tools",
    "docs://tools",
    {
      title: "Internal tool catalog",
      description: "All internal tools surfaced by this MCP, grouped by capability family",
      mimeType: "application/json",
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(buildToolGroups(), null, 2),
        },
      ],
    }),
  );

  // ── docs://protocols ────────────────────────────────────────
  server.registerResource(
    "docs-protocols",
    "docs://protocols",
    {
      title: "Protocol namespace overview",
      description:
        "Active protocol namespaces (use discover_tools / execute_tool to invoke them)",
      mimeType: "application/json",
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(buildProtocolList(), null, 2),
        },
      ],
    }),
  );

  // ── docs://protocols/{namespace} ────────────────────────────
  server.registerResource(
    "docs-protocol-namespace",
    new ResourceTemplate("docs://protocols/{namespace}", { list: undefined }),
    {
      title: "Protocol namespace tools",
      description: "Per-namespace protocol tool manifests",
      mimeType: "application/json",
    },
    async (uri: URL, variables: Record<string, string | string[]>) => {
      const raw = variables.namespace;
      const namespace = Array.isArray(raw) ? raw[0] : raw;
      if (!namespace) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: "missing namespace variable" }, null, 2),
            },
          ],
        };
      }
      const payload = buildProtocolNamespace(namespace);
      if (!payload) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                { error: `unknown namespace: ${namespace}` },
                null,
                2,
              ),
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  // ── surface://manifest ──────────────────────────────────────
  server.registerResource(
    "surface-manifest",
    "surface://manifest",
    {
      title: "MCP surface manifest",
      description: "Machine-readable JSON snapshot of the active surface",
      mimeType: "application/json",
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(buildSurfaceManifest(), null, 2),
        },
      ],
    }),
  );

  // ── runtime://env ───────────────────────────────────────────
  server.registerResource(
    "runtime-env",
    "runtime://env",
    {
      title: "Runtime environment status",
      description:
        "Presence flags for runtime env vars (never values), embedding model + dim",
      mimeType: "application/json",
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(buildRuntimeEnv(), null, 2),
        },
      ],
    }),
  );
}
