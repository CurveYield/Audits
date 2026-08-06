#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const staking = fs.readFileSync(path.join(root, "contracts", "CurveYieldGovernanceStaking.sol"), "utf8");
const keeper = fs.readFileSync(path.join(root, "scripts", "proposal-participation-keeper-v18.js"), "utf8");
const payloadBuilder = fs.readFileSync(path.join(root, "scripts", "build-proposal-sync-payload-v18.js"), "utf8");

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(message);
}

for (const [label, source] of [["modular", staking]]) {
  requireMatch(source, /PARTICIPATION_WINDOW\s*=\s*15\s*;/, `${label} PARTICIPATION_WINDOW must be 15`);
  requireMatch(source, /PARTICIPATION_THRESHOLD\s*=\s*12\s*;/, `${label} PARTICIPATION_THRESHOLD must be 12`);
  requireMatch(source, /uint256 weightedParticipationPoints\s*=\s*directCount\s*\*\s*2\s*\+\s*delegatedCount\s*;/, `${label} mixed histories must use one combined weighted score`);
  requireMatch(source, /uint256 maxParticipationPoints\s*=\s*PARTICIPATION_THRESHOLD\s*\*\s*2\s*;/, `${label} weighted score cap must equal twelve direct-vote equivalents`);
  requireMatch(source, /Math\.mulDiv\(\s*weightedParticipationPoints,\s*DIRECT_PARTICIPATION_MULTIPLIER_BPS\s*-\s*BASE_PARTICIPATION_MULTIPLIER_BPS,\s*maxParticipationPoints\s*\)/s, `${label} mixed direct and delegated histories must be blended in one proportional calculation`);
  if (/if\s*\(count\s*==\s*PARTICIPATION_WINDOW\)/.test(source)) {
    throw new Error(`${label} multiplier must not wait for a full fifteen-proposal history`);
  }
  requireMatch(source, /ParticipationRecord\[15\]/, `${label} account participation storage must be length 15`);
  requireMatch(source, /ProposalSync\(address caller,uint256 expectedStartIndex,bytes32 proposalIdsHash,uint256 deadline\)/, `${label} proposal sync must bind the caller`);
  requireMatch(source, /registerFinalizedProposalsWithSignature\s*\(/, `${label} signed registration is missing`);
  requireMatch(source, /stakeWithProposalSync\s*\(/, `${label} stakeWithProposalSync is missing`);
  requireMatch(source, /stakeForWithProposalSync\s*\(/, `${label} stakeForWithProposalSync is missing`);
  requireMatch(source, /requestWithdrawalWithProposalSync\s*\(/, `${label} requestWithdrawalWithProposalSync is missing`);
  requireMatch(source, /claimRewardsWithProposalSync\s*\(/, `${label} claimRewardsWithProposalSync is missing`);
  requireMatch(source, /kickWithProposalSync\s*\(/, `${label} kickWithProposalSync is missing`);
  requireMatch(source, /function stake\(uint256 amount\)/, `${label} original stake function is missing`);
  requireMatch(source, /function stakeFor\(address recipient, uint256 amount\)/, `${label} original stakeFor is missing`);
  requireMatch(source, /function requestWithdrawal\(uint256 amount, address receiver\)/, `${label} original withdrawal request is missing`);
  requireMatch(source, /function claimRewards\(address receiver\)/, `${label} original claimRewards is missing`);
  requireMatch(source, /function kick\(address account\)/, `${label} original kick is missing`);
  requireMatch(source, /mapping\(address => RewardData\) internal _rewardData;/, `${label} ordinary continuous reward accumulator is missing`);
  requireMatch(source, /mapping\(address => RewardData\) internal _participationRewardData;/, `${label} participation continuous reward accumulator is missing`);
  requireMatch(source, /_checkpointAllRewards\(account\);[\s\S]*?_burn\(account, amount\);[\s\S]*?_setParticipationWorkingWeight\(account\);/, `${label} withdrawal must settle old weights before reducing active balance and working weight`);
  requireMatch(source, /_rewardEligibleBalance\(account\), current - paid, PRECISION/, `${label} ordinary rewards must use current active eligible balance`);
  requireMatch(source, /participationWorkingWeight\[account\], current - paid, PRECISION/, `${label} participation rewards must use current active working weight`);
  if (/GovernanceRewardCycles|rewardCycleManager|setRewardCycleManager/.test(source)) {
    throw new Error(`${label} must not retain snapshot reward-cycle manager logic`);
  }
  if (/function\s+createProposal\s*\(/.test(source)) {
    throw new Error(`${label} source must not contain an Aragon proposal-creation gateway`);
  }
}

requireMatch(keeper, /MAX_RETAINED_WINDOW\s*=\s*15\s*;/, "keeper retained window must be 15");
requireMatch(payloadBuilder, /MAX_RETAINED_WINDOW\s*=\s*15\s*;/, "payload builder retained window must be 15");
requireMatch(payloadBuilder, /\{ name: "caller", type: "address" \}/, "payload builder must bind the caller");
requireMatch(payloadBuilder, /ProposalSync:\s*\[/, "payload builder EIP-712 ProposalSync type is missing");
requireMatch(payloadBuilder, /proposalIdsHash/, "payload builder proposalIdsHash binding is missing");
requireMatch(payloadBuilder, /signTypedData/, "payload builder registrar signature is missing");

console.log(" continuous active-deposit rewards and blended participation requirements satisfied.");
