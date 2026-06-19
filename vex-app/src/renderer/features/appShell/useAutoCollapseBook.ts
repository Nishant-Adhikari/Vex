/**
 * Auto-collapse the BOOK panel on the narrow-viewport edge.
 *
 * The shell now has four columns when a session is open: the sidebar
 * (SessionsList) + the chat section + the MISSION RAIL (200px) + the BOOK panel
 * (320px). Below ~1360px those four can no longer breathe, so when the viewport
 * crosses INTO the narrow band we collapse BOOK to reclaim its 320px.
 *
 * Deliberately ONE-WAY on the transition edge, not a continuous enforce:
 *   - crossing narrow → wide leaves BOOK as-is (we don't auto-reopen);
 *   - inside the narrow band the user can still manually re-open BOOK (the DESK
 *     RULE / BookPanel chevron) and we won't fight that — we only act again on
 *     the next wide→narrow crossing.
 *
 * Using the `change` event (not a render-time read) means a manual toggle does
 * not retrigger the collapse; only an actual breakpoint crossing does. The
 * matchMedia guard mirrors `usePrefersReducedMotion` for jsdom safety.
 */

import { useEffect } from "react";
import { useUiStore } from "../../stores/uiStore.js";

/** Four columns stop fitting below this width (see the shell layout math). */
const NARROW_QUERY = "(max-width: 1359px)";

export function useAutoCollapseBook(): void {
  const setBookOpen = useUiStore((s) => s.setBookOpen);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const query = window.matchMedia(NARROW_QUERY);

    // Initial mount in the narrow band → collapse once.
    if (query.matches) setBookOpen(false);

    const onChange = (event: MediaQueryListEvent): void => {
      // Only the wide→narrow crossing collapses; the narrow→wide crossing is a
      // no-op so we never override a user's choice.
      if (event.matches) setBookOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [setBookOpen]);
}
