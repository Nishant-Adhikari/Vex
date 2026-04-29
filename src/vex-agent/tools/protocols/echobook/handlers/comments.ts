/**
 * EchoBook comment handlers — get / create / delete.
 */

import { getComments, createComment, deleteComment } from "@tools/echobook/comments.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

export const COMMENT_HANDLERS: Record<string, ProtocolHandler> = {
  "echobook.comments.get": async (p) => {
    const postId = num(p, "postId");
    if (postId == null) return fail("Missing required: postId");
    const comments = await getComments(postId);
    return ok({ count: comments.length, comments });
  },

  "echobook.comment.create": async (p) => {
    const postId = num(p, "postId"), content = str(p, "content");
    if (postId == null || !content) return fail("Missing required: postId, content");
    const comment = await createComment({
      postId,
      content,
      parentId: num(p, "parentId"),
    });
    return ok(comment);
  },

  "echobook.comment.delete": async (p) => {
    const id = num(p, "id");
    if (id == null) return fail("Missing required: id");
    await deleteComment(id);
    return ok({ deleted: true, id });
  },
};
