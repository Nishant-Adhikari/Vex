/**
 * EchoBook notification handlers — list, unread count, mark read.
 */

import { getNotifications, getUnreadCount, markRead } from "@tools/echobook/notifications.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok } from "../../handler-helpers.js";

export const NOTIFICATION_HANDLERS: Record<string, ProtocolHandler> = {
  "echobook.notifications.list": async (p) => {
    const result = await getNotifications({
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
    });
    return ok(result);
  },

  "echobook.notifications.unreadCount": async () => {
    const count = await getUnreadCount();
    return ok({ unreadCount: count });
  },

  "echobook.notifications.markRead": async (p) => {
    const idsRaw = str(p, "ids");
    const ids = idsRaw
      ? idsRaw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n))
      : undefined;
    await markRead({
      all: p.all === true || (!ids && !num(p, "beforeMs")),
      ids,
      beforeMs: num(p, "beforeMs"),
    });
    return ok({ marked: true });
  },
};
