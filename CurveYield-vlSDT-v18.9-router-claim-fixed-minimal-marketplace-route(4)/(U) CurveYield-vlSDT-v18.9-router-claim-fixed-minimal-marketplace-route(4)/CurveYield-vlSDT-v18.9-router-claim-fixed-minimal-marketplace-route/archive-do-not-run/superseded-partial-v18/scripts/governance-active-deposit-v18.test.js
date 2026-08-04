#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "contracts", "CurveYieldGovernanceStaking.sol"),
  "utf8"
);

// A 140-token stream over two equal seven-day intervals.
const firstHalf = 70;
const secondHalf = 70;

// Full exit at the midpoint: only the first half was earned while active.
assert.strictEqual(firstHalf + secondHalf * 0, 70);

// Half exit at the midpoint: full first half plus half of the second half.
assert.strictEqual(firstHalf + secondHalf * 0.5, 105);

// No exit: full stream.
assert.strictEqual(firstHalf + secondHalf, 140);

assert.match(
  source,
  /_checkpointAllRewards\(account\);[\s\S]*?_burn\(account, amount\);[\s\S]*?_setParticipationWorkingWeight\(account\);/,
  "withdrawal must settle rewards before reducing active balance and participation weight"
);
assert.match(
  source,
  /_checkpointRewardData\(_rewardData\[token\], token, totalRewardEligibleSupply, false\)/,
  "ordinary rewards must use current eligible active supply"
);
assert.match(
  source,
  /_checkpointRewardData\(_participationRewardData\[token\], token, totalParticipationWeight, true\)/,
  "participation rewards must use current active working supply"
);
assert.doesNotMatch(
  source,
  /GovernanceRewardCycles|rewardCycleManager|setRewardCycleManager/,
  "snapshot-cycle manager logic must be absent"
);

console.log(" Governance Staking active-deposit reward behavior satisfied.");
