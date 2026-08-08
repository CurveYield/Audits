"use strict";

const { expect } = require("chai");
const {
  stakeDaoRouterClaimPlan
} = require("../../deployment-v20/simulate-vlsdt-locker-claim-30d-focused-v20");

describe("V20 live FeeDistributor compatibility", function () {
  it("matches the verified Stake DAO aggregate claim transaction", function () {
    const distributors = [
      "0xCa94395469a88E9cAC0D5E5e308910E298270d30",
      "0x6d57d34259f6dc31c9a241c199822861940d38f9"
    ];
    const tokens = [
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "0x73968b9a57c6E53d41345FD57a6E6ae27d6CDB2F"
    ];
    const plan = stakeDaoRouterClaimPlan(distributors, tokens);
    expect(plan.signature).to.equal("execute(bytes[])");
    expect(plan.calls).to.deep.equal([
      "0x0cb38aab9d0000000000000000000000000000000000000000000000000000000000000020"
        + "0000000000000000000000000000000000000000000000000000000000000002"
        + "000000000000000000000000ca94395469a88e9cac0d5e5e308910e298270d30"
        + "0000000000000000000000006d57d34259f6dc31c9a241c199822861940d38f9",
      "0x07780469bb0000000000000000000000000000000000000000000000000000000000000020"
        + "0000000000000000000000000000000000000000000000000000000000000002"
        + "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        + "00000000000000000000000073968b9a57c6e53d41345fd57a6e6ae27d6cdb2f"
    ]);
  });
});
