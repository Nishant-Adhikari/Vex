import { describe, expect, it } from "vitest";

import { shouldOfferLocalServicesStart } from "../../../../local/vex-shell/wizard/bootstrap-recovery.js";

describe("local shell bootstrap recovery", () => {
  it("does not start Docker services for missing env failures", () => {
    expect(
      shouldOfferLocalServicesStart({
        failure: {
          stage: "bootstrap_checks",
          message: "Missing required env: JUPITER_API_KEY",
        },
      }),
    ).toBe(false);
  });

  it("offers to start services for connection failures", () => {
    expect(
      shouldOfferLocalServicesStart({
        failure: {
          stage: "bootstrap_checks",
          message: "Health probe failed: connect ECONNREFUSED 127.0.0.1:15432",
        },
      }),
    ).toBe(true);
  });

  it("offers to start services for migration bootstrap failures", () => {
    expect(
      shouldOfferLocalServicesStart({
        failure: {
          stage: "bootstrap_checks",
          message: "Migrations failed: database is not reachable",
        },
      }),
    ).toBe(true);
  });
});
