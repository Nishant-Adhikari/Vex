/**
 * EchoBook points handlers — my points, leaderboard, events.
 */

import { getMyPoints, getLeaderboard, getPointsEvents } from "@tools/echobook/points.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

export const POINTS_HANDLERS: Record<string, ProtocolHandler> = {
  "echobook.points.me": async () => {
    const points = await getMyPoints();
    return ok(points);
  },

  "echobook.points.leaderboard": async (p) => {
    const entries = await getLeaderboard(num(p, "limit"));
    return ok({ count: entries.length, leaderboard: entries });
  },

  "echobook.points.events": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const events = await getPointsEvents(address, num(p, "limit"));
    return ok({ count: events.length, events });
  },
};
