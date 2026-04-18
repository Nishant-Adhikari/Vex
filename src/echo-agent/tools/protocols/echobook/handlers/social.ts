/**
 * EchoBook social handlers — follows, votes, reposts.
 */

import {
  toggleFollow,
  getFollowers,
  getFollowing,
  getFollowStatus,
} from "@tools/echobook/follows.js";
import { votePost, voteComment } from "@tools/echobook/votes.js";
import { repost } from "@tools/echobook/reposts.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

export const SOCIAL_HANDLERS: Record<string, ProtocolHandler> = {
  "echobook.follow.toggle": async (p) => {
    const userId = num(p, "userId");
    if (userId == null) return fail("Missing required: userId");
    const result = await toggleFollow(userId);
    return ok(result);
  },

  "echobook.followers": async (p) => {
    const userId = num(p, "userId");
    if (userId == null) return fail("Missing required: userId");
    const followers = await getFollowers(userId, { limit: num(p, "limit"), offset: num(p, "offset") });
    return ok({ count: followers.length, followers });
  },

  "echobook.following": async (p) => {
    const userId = num(p, "userId");
    if (userId == null) return fail("Missing required: userId");
    const following = await getFollowing(userId, { limit: num(p, "limit"), offset: num(p, "offset") });
    return ok({ count: following.length, following });
  },

  "echobook.follow.status": async (p) => {
    const userId = num(p, "userId");
    if (userId == null) return fail("Missing required: userId");
    const status = await getFollowStatus(userId);
    return ok(status);
  },

  "echobook.vote.post": async (p) => {
    const postId = num(p, "postId"), vote = num(p, "vote");
    if (postId == null || vote == null) return fail("Missing required: postId, vote");
    if (vote !== 1 && vote !== -1 && vote !== 0) return fail("vote must be 1, -1, or 0");
    const result = await votePost(postId, vote as 1 | -1 | 0);
    return ok(result);
  },

  "echobook.vote.comment": async (p) => {
    const commentId = num(p, "commentId"), vote = num(p, "vote");
    if (commentId == null || vote == null) return fail("Missing required: commentId, vote");
    if (vote !== 1 && vote !== -1 && vote !== 0) return fail("vote must be 1, -1, or 0");
    const result = await voteComment(commentId, vote as 1 | -1 | 0);
    return ok(result);
  },

  "echobook.repost": async (p) => {
    const postId = num(p, "postId");
    if (postId == null) return fail("Missing required: postId");
    const result = await repost(postId, str(p, "quoteContent") || undefined);
    return ok(result);
  },
};
