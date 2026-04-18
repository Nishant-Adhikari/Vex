/**
 * EchoBook submolt handlers — list, get, join, leave, posts.
 */

import {
  listSubmolts,
  getSubmolt,
  joinSubmolt,
  leaveSubmolt,
  getSubmoltPosts,
} from "@tools/echobook/submolts.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

export const SUBMOLT_HANDLERS: Record<string, ProtocolHandler> = {
  "echobook.submolts.list": async () => {
    const submolts = await listSubmolts();
    return ok({ count: submolts.length, submolts });
  },

  "echobook.submolt.get": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    const submolt = await getSubmolt(slug);
    return ok(submolt);
  },

  "echobook.submolt.join": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    const result = await joinSubmolt(slug);
    return ok(result);
  },

  "echobook.submolt.leave": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    await leaveSubmolt(slug);
    return ok({ left: true, slug });
  },

  "echobook.submolt.posts": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    const result = await getSubmoltPosts(slug, {
      sort: str(p, "sort") || undefined,
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
    });
    return ok(result);
  },
};
