/**
 * Web tools — Tavily-backed search + fetch.
 *
 * Both gated on TAVILY_API_KEY: hidden from the LLM when the env var is missing.
 */

import type { ToolDef } from "../types.js";

export const WEB_TOOLS: readonly ToolDef[] = [
  {
    name: "web_search", kind: "internal", mutating: false, requiresEnv: "TAVILY_API_KEY",
    description: "Search the internet — token research, market news, protocol docs, chain analytics, contract audits.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Search query" },
    }, required: ["query"] },
  },
  {
    name: "web_fetch", kind: "internal", mutating: false, requiresEnv: "TAVILY_API_KEY",
    description: "Fetch any URL as markdown — docs, block explorers, dashboards, API responses.",
    parameters: { type: "object", properties: {
      url: { type: "string", description: "URL to fetch" },
    }, required: ["url"] },
  },
];
