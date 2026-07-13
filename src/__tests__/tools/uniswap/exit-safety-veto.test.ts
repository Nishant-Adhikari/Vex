/**
 * exitSafetyVeto — pure decision for the pre-buy exit-safety guard. Given the
 * result of the two keyless probes (reverse-route existence + fee-on-transfer
 * signal), decide whether to block a buy. A token that can be bought but not
 * sold is a honeypot; a fee-on-transfer token taxes/traps the exit.
 */

import { describe, it, expect } from "vitest";
import { exitSafetyVeto } from "@tools/uniswap/safety.js";

const base = {
  tokenOutSymbol: "NOXA",
  tokenOutAddress: "0x39E0D9057BD9039Cd14590f54dE20B9D3457c56E",
  tokenInSymbol: "ETH",
};

describe("exitSafetyVeto", () => {
  it("passes (null) when a sell route exists and no fee-on-transfer is suspected", () => {
    expect(
      exitSafetyVeto({ ...base, sellBackRouteExists: true, fotSuspected: false }),
    ).toBeNull();
  });

  it("vetoes as a honeypot when no reverse sell route exists", () => {
    const reason = exitSafetyVeto({ ...base, sellBackRouteExists: false, fotSuspected: false });
    expect(reason).not.toBeNull();
    expect(reason!.toLowerCase()).toContain("honeypot");
    expect(reason).toContain("0x39E0D9057BD9039Cd14590f54dE20B9D3457c56E");
  });

  it("vetoes on a fee-on-transfer signal even when a route exists", () => {
    const reason = exitSafetyVeto({ ...base, sellBackRouteExists: true, fotSuspected: true });
    expect(reason).not.toBeNull();
    expect(reason!.toLowerCase()).toContain("fee-on-transfer");
  });

  it("prioritises the no-exit (honeypot) reason over fee-on-transfer", () => {
    const reason = exitSafetyVeto({ ...base, sellBackRouteExists: false, fotSuspected: true });
    expect(reason!.toLowerCase()).toContain("honeypot");
  });
});
