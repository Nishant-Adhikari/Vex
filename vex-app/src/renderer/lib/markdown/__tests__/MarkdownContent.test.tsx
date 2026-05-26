/**
 * MarkdownContent tests (stage 8-2a). Covers element rendering for the
 * supported subset and the security matrix: href allowlist (https only),
 * raw-HTML-stays-literal, image-as-alt-text, and table/unsupported fallback.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { MarkdownContent, safeHref } from "../MarkdownContent.js";

function renderMd(text: string) {
  return render(createElement(MarkdownContent, { text }));
}

const NUL = String.fromCharCode(0);

describe("safeHref", () => {
  it("allows absolute https URLs", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
  });

  it("rejects every non-https / unsafe form", () => {
    expect(safeHref("http://example.com")).toBeNull();
    expect(safeHref("mailto:a@b.com")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("file:///etc/passwd")).toBeNull();
    expect(safeHref("/relative/path")).toBeNull();
    expect(safeHref("//protocol-relative.example")).toBeNull();
    expect(safeHref("   ")).toBeNull();
    expect(safeHref(`https://e${NUL}.com`)).toBeNull();
  });
});

describe("MarkdownContent", () => {
  it("renders inline emphasis + inline code as elements", () => {
    const { container } = renderMd("**bold** and *em* and `code`");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("em");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("renders headings, lists, blockquotes and fenced code blocks", () => {
    const { container } = renderMd(
      "# Title\n\n- a\n- b\n\n1. x\n\n> quote\n\n```\ncode()\n```",
    );
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain("code()");
  });

  it("renders an https link as a safe blank-target anchor", () => {
    const { container } = renderMd("[ok](https://a.example/b)");
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://a.example/b");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("never renders a javascript: or http: link as an anchor (text only)", () => {
    const { container } = renderMd("[x](javascript:alert(1)) [y](http://a.b)");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("x");
    expect(container.textContent).toContain("y");
  });

  it("renders raw HTML inside markdown as literal text, never as elements", () => {
    const { container } = renderMd('<img src=x onerror="alert(1)"> <b>nope</b>');
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('onerror="alert(1)"');
  });

  it("renders image markdown as alt text only (no img element)", () => {
    const { container } = renderMd("![the alt](https://a.b/c.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("the alt");
  });

  it("does not crash on table markdown (renders its text)", () => {
    const { container } = renderMd("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(container.textContent).toContain("a");
    expect(container.textContent).toContain("1");
  });
});
