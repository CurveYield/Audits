#!/usr/bin/env node
"use strict";

const E18 = 10n ** 18n;
const B = 1_000_000_000n * E18;
const CAP = 1_000n * B;
const INITIAL = 200n * B;

function monthly(month) {
  if (month <= 0) return 0n;
  if (month <= 21) return 20n * B - BigInt(month - 1) * (B / 2n);
  if (month <= 51) return 98n * B / 10n - BigInt(month - 22) * (B / 5n);
  return 4n * B;
}

function unlocked(months) {
  let total = INITIAL;
  for (let month = 1; month <= months && total < CAP; month += 1) {
    const amount = monthly(month);
    total = total + amount > CAP ? CAP : total + amount;
  }
  return total;
}

const checks = new Map([
  [0, 200n * B],
  [24, 5438n * B / 10n],
  [36, 641n * B],
  [48, 7094n * B / 10n],
  [51, 722n * B],
  [60, 758n * B],
  [120, 998n * B],
  [121, CAP]
]);
for (const [months, expected] of checks) {
  const actual = unlocked(months);
  if (actual !== expected) {
    throw new Error(`month ${months}: ${actual} != ${expected}`);
  }
}
if (monthly(1) !== 20n * B) throw new Error("month 1 allotment mismatch");
if (monthly(21) !== 10n * B) throw new Error("month 21 allotment mismatch");
if (monthly(22) !== 98n * B / 10n) throw new Error("month 22 allotment mismatch");
if (monthly(51) !== 4n * B || monthly(52) !== 4n * B) {
  throw new Error("4B floor mismatch");
}

console.log("V20 mint schedule math passed: cap reached in month 121.");
