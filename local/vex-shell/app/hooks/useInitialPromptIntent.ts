import { useEffect, useRef } from "react";
import { dispatchInitialPromptIntent } from "../flows/shellTurn.js";
import type { Store } from "../state/store.js";
import { useStore } from "../state/store.js";

export function useInitialPromptIntent(store: Store): void {
  const sessionId = useStore(store, (s) => s.session?.id ?? null);
  const initialIntent = useStore(store, (s) => s.initialPromptIntent);
  const intentConsumedRef = useRef(false);

  useEffect(() => {
    if (!sessionId || !initialIntent || intentConsumedRef.current) return;
    intentConsumedRef.current = true;
    void dispatchInitialPromptIntent(store, sessionId, initialIntent);
  }, [sessionId, initialIntent, store]);
}
