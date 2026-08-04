#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const sources = [path.join(root, "contracts", "CurveYieldGovernanceStakingV17.sol")];

for (const sourcePath of sources) {
  const source = fs.readFileSync(sourcePath, "utf8");
  assert.match(source, /uint256 weightedParticipationPoints\s*=\s*directCount\s*\*\s*2\s*\+\s*delegatedCount\s*;/);
  assert.match(source, /if \(weightedParticipationPoints > maxParticipationPoints\)/);
}

const BPS = 10_000n;
const THRESHOLD = 12n;
const BASE = 10_000n;
const DIRECT_CAP = 30_000n;

function multiplier(directHits, delegatedHits) {
  const direct = BigInt(Math.min(directHits, Number(THRESHOLD)));
  const delegated = BigInt(Math.min(delegatedHits, Number(THRESHOLD)));
  let points = direct * 2n + delegated;
  const maxPoints = THRESHOLD * 2n;
  if (points > maxPoints) points = maxPoints;
  return BASE + (points * (DIRECT_CAP - BASE)) / maxPoints;
}

assert.equal(multiplier(0, 0), 10_000n);
assert.equal(multiplier(0, 6), 15_000n);
assert.equal(multiplier(6, 0), 20_000n);
assert.equal(multiplier(0, 12), 20_000n);
assert.equal(multiplier(6, 6), 25_000n);
assert.equal(multiplier(12, 0), 30_000n);
assert.equal(multiplier(0, 15), 20_000n, "delegated contribution must remain capped at twelve votes");

// Replacing one delegated record with one direct record must never decrease the multiplier.
let previous = multiplier(0, 12);
for (let direct = 1; direct <= 12; direct++) {
  const delegated = 12 - direct;
  const current = multiplier(direct, delegated);
  assert(current > previous, `switch to self voting did not increase at ${direct} direct votes`);
  previous = current;
}

// Replacing one direct record with one delegated record must never increase the multiplier.
previous = multiplier(12, 0);
for (let delegated = 1; delegated <= 12; delegated++) {
  const direct = 12 - delegated;
  const current = multiplier(direct, delegated);
  assert(current < previous, `switch to delegated voting did not decrease at ${delegated} delegated votes`);
  previous = current;
}

assert.equal(BPS, BASE);
console.log("V17 delegation-transition participation math satisfied.");
