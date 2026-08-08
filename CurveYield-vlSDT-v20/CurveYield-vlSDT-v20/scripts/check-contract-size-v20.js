#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const artifactRoot = path.join(root, "artifacts-v20", "contracts");
const EIP170_LIMIT = 24576;
const GOVERNANCE_STAKING_TARGET = EIP170_LIMIT;
const REVENUE_STRATEGY_TARGET = 23500;

if (!fs.existsSync(artifactRoot)) {
  throw new Error("artifacts-v20 is missing. Compile V20 first, then run this size check.");
}

const deployableNames = new Set([
  "CurveYieldGovernanceToken",
  "CurveYieldGovernanceStaking",
  "CurveYieldGovernanceMintController",
  "CurveYieldGovernanceBoostStrategy",
  "CurveYieldVlSDTToken",
  "CurveYieldVlSDTLocker",
  "CurveYieldVlSDTRevenueStaking",
  "CurveYieldVlSDTBoostStaking",
  "CurveYieldVlSDTBoostMerchant",
  "CurveYieldRevenueVaultV7",
  "CurveYieldRevenueStrategyV7",
  "CurveYieldRevenueConverter",
  "CurveYieldCyGovDistributor",
  "CurveYieldCyGovYieldStaking"
]);

const results = [];
for (const sourceDir of fs.readdirSync(artifactRoot, { withFileTypes: true })) {
  if (!sourceDir.isDirectory()) continue;
  const dir = path.join(artifactRoot, sourceDir.name);
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file.endsWith(".dbg.json")) continue;
    const artifact = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    if (!deployableNames.has(artifact.contractName)) continue;
    const hex = (artifact.deployedBytecode || "0x").replace(/^0x/, "");
    results.push({ contract: artifact.contractName, bytes: hex.length / 2 });
  }
}

results.sort((a, b) => b.bytes - a.bytes);
let failed = false;
for (const result of results) {
  const target = result.contract === "CurveYieldGovernanceStaking"
    ? GOVERNANCE_STAKING_TARGET
    : result.contract === "CurveYieldRevenueStrategyV7"
      ? REVENUE_STRATEGY_TARGET
      : EIP170_LIMIT;
  const status = result.bytes <= target ? "PASS" : "FAIL";
  console.log(`${status} ${result.contract}: ${result.bytes} bytes (target ${target})`);
  if (result.bytes > target || result.bytes > EIP170_LIMIT) failed = true;
}

if (results.length !== deployableNames.size) {
  throw new Error(`Expected ${deployableNames.size} deployable artifacts, found ${results.length}`);
}
if (failed) process.exitCode = 1;
