/**
 * Dialog primitive scroll-chain test (core-chat-loop slice).
 *
 * Pins the layout contract that keeps a tall dialog usable: the body is the
 * single bounded, scrollable region (`flex-1 min-h-0 overflow-y-auto`) while
 * the header and footer never compress (`shrink-0`), so a long form's footer
 * actions (e.g. the New-session "Create" button) stay pinned and reachable.
 * jsdom has no layout engine, so this asserts the structural classes; the
 * real small-viewport scroll behaviour is a manual/Playwright check.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../dialog.js";

beforeAll(() => {
  // jsdom does not implement the native <dialog> modal methods.
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModalPolyfill(this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function closePolyfill(this: HTMLDialogElement): void {
      this.removeAttribute("open");
    };
  }
});

describe("Dialog scroll chain", () => {
  it("body is the bounded scroll region; header + footer are pinned", () => {
    const { container } = render(
      createElement(
        Dialog,
        { open: true, onOpenChange: () => {} },
        createElement(
          DialogContent,
          {},
          createElement(
            DialogHeader,
            { "data-testid": "header" },
            createElement(DialogTitle, {}, "Title"),
          ),
          createElement(DialogBody, { "data-testid": "body" }, "body content"),
          createElement(DialogFooter, { "data-testid": "footer" }, "actions"),
        ),
      ),
    );

    const body = container.querySelector('[data-testid="body"]');
    const header = container.querySelector('[data-testid="header"]');
    const footer = container.querySelector('[data-testid="footer"]');
    expect(body).not.toBeNull();
    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();

    // Body flexes + scrolls, bounded by the dialog's max-h-[85vh].
    expect(body!.classList.contains("flex-1")).toBe(true);
    expect(body!.classList.contains("min-h-0")).toBe(true);
    expect(body!.classList.contains("overflow-y-auto")).toBe(true);

    // Header + footer never compress → footer actions stay reachable.
    expect(header!.classList.contains("shrink-0")).toBe(true);
    expect(footer!.classList.contains("shrink-0")).toBe(true);
  });
});
