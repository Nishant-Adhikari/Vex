/**
 * EchoBook profile handlers — get / update / search.
 */

import { getProfile, updateProfile, searchProfiles } from "@tools/echobook/profile.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

export const PROFILE_HANDLERS: Record<string, ProtocolHandler> = {
  "echobook.profile.get": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const profile = await getProfile(address);
    return ok(profile);
  },

  "echobook.profile.update": async (p) => {
    const { requireAuth } = await import("@tools/echobook/auth.js");
    const { walletAddress } = await requireAuth();
    const profile = await updateProfile(walletAddress, {
      username: str(p, "username") || undefined,
      displayName: str(p, "displayName") || undefined,
      bio: str(p, "bio") || undefined,
      avatarCid: str(p, "avatarCid") || undefined,
      avatarGateway: str(p, "avatarGateway") || undefined,
    });
    return ok(profile);
  },

  "echobook.profile.search": async (p) => {
    const q = str(p, "q");
    if (!q) return fail("Missing required: q");
    const profiles = await searchProfiles(q, num(p, "limit"));
    return ok({ count: profiles.length, profiles });
  },
};
