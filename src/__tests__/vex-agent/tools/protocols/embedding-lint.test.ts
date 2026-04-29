/**
 * A3 — embedding-passage shape linter test.
 *
 * Iterates every active protocol manifest (skipping `deprecated_hidden`
 * and `reserved` namespaces) and asserts the passage shape rules from
 * `_embedding-lint.ts`: presence of `Use when:` and `Example queries:`,
 * absence of banned phrasings, length bounds, and an action verb in the
 * first sentence for mutating tools.
 *
 * Complements the existing token-level linter
 * (`__tests__/vex-agent/tools/embedding-text-style.test.ts`) which guards
 * the technical-jargon and word-count axes.
 */

import { describe, it, expect } from "vitest";
import { PROTOCOL_TOOLS } from "../../../../vex-agent/tools/protocols/catalog.js";
import { isDeprecatedNamespace, NAMESPACE_LIFECYCLE } from "../../../../vex-agent/tools/protocols/lifecycle.js";
import { lintEmbeddingPassage } from "../../../../vex-agent/tools/protocols/_embedding-lint.js";

describe("A3 — embedding-passage shape linter", () => {
  const activeWithEmbedding = PROTOCOL_TOOLS.filter(
    (m) =>
      !isDeprecatedNamespace(m.namespace) &&
      NAMESPACE_LIFECYCLE[m.namespace] !== "reserved" &&
      m.discovery?.embeddingText,
  );

  it("at least one active manifest has an embeddingText (sanity)", () => {
    expect(activeWithEmbedding.length).toBeGreaterThan(0);
  });

  for (const manifest of activeWithEmbedding) {
    const text = manifest.discovery!.embeddingText!;

    it(`${manifest.toolId}: passage shape conforms to lint rules`, () => {
      const issues = lintEmbeddingPassage(manifest.toolId, text, manifest.mutating);
      const formatted = issues.map((i) => `  - [${i.rule}] ${i.message}`).join("\n");
      expect(
        issues,
        `embedding passage for ${manifest.toolId} violates shape rules:\n${formatted}\n\nPassage:\n${text}`,
      ).toEqual([]);
    });
  }
});
