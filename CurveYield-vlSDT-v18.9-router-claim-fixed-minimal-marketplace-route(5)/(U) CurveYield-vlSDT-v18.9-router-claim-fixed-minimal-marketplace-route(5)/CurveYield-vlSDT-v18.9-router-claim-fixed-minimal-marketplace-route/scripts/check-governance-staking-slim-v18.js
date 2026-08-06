"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const staking = read("contracts/CurveYieldGovernanceStaking.sol");
const strategy = read("contracts/CurveYieldGovernanceBoostStrategy.sol");
const controller = read("contracts/CurveYieldGovernanceMintController.sol");
const baselineSourceBytes = 62041;
const currentSourceBytes = Buffer.byteLength(staking);
if (currentSourceBytes >= 52000) throw new Error(`Governance Staking source unexpectedly large: ${currentSourceBytes}`);
const requiredConvenience = [
  "kickWithProposalSync", "stakeWithProposalSync", "stakeForWithProposalSync",
  "requestWithdrawalWithProposalSync", "claimRewardsWithProposalSync"
];
for (const fn of requiredConvenience) {
  if (!staking.includes(`function ${fn}`)) throw new Error(`missing convenience function ${fn}`);
}
const forbidden = [
  "activeStakerCount", "hasEverStaked", "_governanceStakers",
  "_rewardEligibleSupplyCheckpoints", "proposeOneTimeGovernanceMint",
  "executePeriodicGovernanceMintConfig", "isProposalRegistrar",
  "function setAragonVotingPlugin", "function setProposalRegistrar",
  "function registerFinalizedProposals(", "function registerFinalizedProposalsWithSignature",
  "function proposalSyncDigest", "function setCommunityBonusBps",
  "function participationMultiplierBps", "function participationStreamActive",
  "function setNotifiers", "function startRewardCycle(address token)"
];
for (const term of forbidden) {
  if (staking.includes(term)) throw new Error(`obsolete Governance Staking surface remains: ${term}`);
}
for (const term of [
  "setAragonVotingPlugin", "setProposalRegistrar", "registerFinalizedProposals",
  "registerFinalizedProposalsWithSignature", "proposalSyncDigest",
  "setCommunityBonusBps", "communityBonusBps", "governanceBoostBps"
]) {
  if (!strategy.includes(`function ${term}`)) throw new Error(`proposal-sync logic not moved to strategy: ${term}`);
}
for (const term of ["proposeOneTimeGovernanceMint", "executePeriodicGovernanceMint", "reserveNextPeriodicGovernanceMint"]) {
  if (!controller.includes(`function ${term}`)) throw new Error(`mint scheduling not moved to controller: ${term}`);
}
const reduction = baselineSourceBytes - currentSourceBytes;
const percent = (reduction * 100 / baselineSourceBytes).toFixed(1);
console.log(`Governance Staking slimming checks passed: ${baselineSourceBytes} -> ${currentSourceBytes} source bytes (${percent}% reduction).`);
