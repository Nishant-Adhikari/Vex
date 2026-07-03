/**
 * Starter chips shown under an empty conversation's composer (phase 4 —
 * three compact ghost pills in one row; labels are chip-short, prompts stay
 * full sentences). Pure data — each chip seeds the composer draft with its
 * prompt. Hidden in mission mode and once the transcript has messages.
 */

export interface QuickAction {
  readonly label: string;
  readonly prompt: string;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    label: "Wallet balances & activity",
    prompt: "Check my wallet balances and recent activity.",
  },
  {
    label: "Plan a swap — route first",
    prompt:
      "Plan a swap for me — show me the full route and costs before anything moves.",
  },
  {
    label: "Watch gas, report daily",
    prompt: "Set up a mission that watches gas prices and reports to me daily.",
  },
];
