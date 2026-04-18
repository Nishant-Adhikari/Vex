/**
 * EchoBook post handlers — feed, single post, create/delete, profile posts, search.
 */

import {
  getFeed,
  getPost,
  createPost,
  deletePost,
  getProfilePosts,
  searchPosts,
  getFollowingFeed,
} from "@tools/echobook/posts.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail, enumField } from "../../handler-helpers.js";

// SDK enum mirrors — source of truth: `FeedOptions` in `@tools/echobook/posts.ts`.
const FEED_SORTS = ["hot", "new", "top"] as const;
const FEED_PERIODS = ["day", "week", "all"] as const;

export const POST_HANDLERS: Record<string, ProtocolHandler> = {
  "echobook.feed": async (p) => {
    const result = await getFeed({
      sort: enumField(p, "sort", FEED_SORTS),
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
      period: enumField(p, "period", FEED_PERIODS),
    });
    return ok(result);
  },

  "echobook.feed.following": async (p) => {
    const result = await getFollowingFeed({
      sort: enumField(p, "sort", FEED_SORTS),
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
      period: enumField(p, "period", FEED_PERIODS),
    });
    return ok(result);
  },

  "echobook.post.get": async (p) => {
    const id = num(p, "id");
    if (id == null) return fail("Missing required: id");
    const post = await getPost(id);
    return ok(post);
  },

  "echobook.post.create": async (p) => {
    const submoltSlug = str(p, "submoltSlug"), content = str(p, "content");
    if (!submoltSlug || !content) return fail("Missing required: submoltSlug, content");
    const post = await createPost({
      submoltSlug,
      content,
      title: str(p, "title") || undefined,
      imageUrl: str(p, "imageUrl") || undefined,
    });
    return ok(post);
  },

  "echobook.post.delete": async (p) => {
    const id = num(p, "id");
    if (id == null) return fail("Missing required: id");
    await deletePost(id);
    return ok({ deleted: true, id });
  },

  "echobook.posts.byProfile": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const result = await getProfilePosts(address, {
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
      includeReposts: p.includeReposts === true,
    });
    return ok(result);
  },

  "echobook.posts.search": async (p) => {
    const q = str(p, "q");
    if (!q) return fail("Missing required: q");
    const result = await searchPosts(q, num(p, "limit"), str(p, "cursor") || undefined);
    return ok(result);
  },
};
