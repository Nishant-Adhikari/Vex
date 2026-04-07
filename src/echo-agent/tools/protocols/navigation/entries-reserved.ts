import type { ProtocolNamespaceNavigation } from "./types.js";

export const RESERVED_PROTOCOL_NAVIGATION: readonly ProtocolNamespaceNavigation[] = [
  {
    namespace: "0g-compute",
    advertised: false,
    groupId: "reserved",
    groupLabel: "Reserved",
    summary: "Reserved 0G compute namespace.",
    whenToUse: "Reserved internal namespace. Not available through discover_tools or MCP docs.",
    exampleQueries: [],
    aliases: ["0g compute"],
    discoveryHints: [],
    facets: [],
  },
  {
    namespace: "0g-storage",
    advertised: false,
    groupId: "reserved",
    groupLabel: "Reserved",
    summary: "Reserved 0G storage namespace.",
    whenToUse: "Reserved internal namespace. Not available through discover_tools or MCP docs.",
    exampleQueries: [],
    aliases: ["0g storage"],
    discoveryHints: [],
    facets: [],
  },
] as const;
