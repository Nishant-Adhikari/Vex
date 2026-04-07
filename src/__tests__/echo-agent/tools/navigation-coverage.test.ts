import { describe, it, expect } from "vitest";
import {
  PROTOCOL_TOOLS,
  isAdvertisedProtocolNamespace,
} from "../../../echo-agent/tools/protocols/catalog.js";
import { getMatchingFacetsForTool } from "../../../echo-agent/tools/protocols/descriptions.js";

describe("navigation facet coverage", () => {
  it("every advertised protocol tool maps to at least one facet", () => {
    // Regression guard: a manifest landing without a matching facet means
    // the tool will silently fall outside `Paths` guidance and lose its
    // discovery boost. The two known historic gaps were
    // `echobook.comments.get` (facet had `echobook.post` but no
    // `echobook.comment`/`echobook.comments`) and `slop.tokens.mine`
    // (facet had `slop.token` which doesn't match the plural prefix).
    const orphans: string[] = [];
    for (const tool of PROTOCOL_TOOLS) {
      if (!isAdvertisedProtocolNamespace(tool.namespace)) continue;
      const facets = getMatchingFacetsForTool(tool.namespace, tool.toolId);
      if (facets.length === 0) orphans.push(tool.toolId);
    }
    expect(orphans).toEqual([]);
  });
});
