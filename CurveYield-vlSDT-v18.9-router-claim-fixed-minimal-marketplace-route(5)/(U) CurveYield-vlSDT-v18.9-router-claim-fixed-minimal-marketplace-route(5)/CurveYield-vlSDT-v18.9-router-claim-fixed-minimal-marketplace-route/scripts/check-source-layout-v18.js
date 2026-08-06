#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const contracts = path.join(root, "contracts");
const tests = path.join(root, "test", "v18");
const archive = path.join(root, "archive-do-not-run");
const stakingFile = path.join(contracts, "CurveYieldGovernanceStaking.sol");
const strategyFile = path.join(contracts, "CurveYieldGovernanceBoostStrategy.sol");
const revenueVaultFile = path.join(contracts, "CurveYieldRevenueVaultV7.sol");
const revenueStrategyFile = path.join(contracts, "CurveYieldRevenueStrategyV7.sol");
const revenueConverterFile = path.join(contracts, "CurveYieldRevenueConverter.sol");
const governanceMintControllerFile = path.join(contracts, "CurveYieldGovernanceMintController.sol");
const cyGovDistributorFile = path.join(contracts, "CurveYieldCyGovDistributor.sol");
const cyGovYieldStakingFile = path.join(contracts, "CurveYieldCyGovYieldStaking.sol");

function fail(message) {
  throw new Error(message);
}

for (const required of [contracts, tests, archive, stakingFile, strategyFile, governanceMintControllerFile, revenueVaultFile, revenueStrategyFile, revenueConverterFile, cyGovDistributorFile, cyGovYieldStakingFile]) {
  if (!fs.existsSync(required)) fail(`missing required V18 path: ${required}`);
}


const activeFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else activeFiles.push(full);
  }
}
walk(contracts);
walk(tests);

for (const file of activeFiles) {
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  if (/archive-do-not-run/.test(text)) fail(`${relative} imports or references the archive`);
  const legacyScan = text
    .replaceAll("CurveYieldRevenueVaultV7", "CurveYieldRevenueVault")
    .replaceAll("CurveYieldRevenueStrategyV7", "CurveYieldRevenueStrategy");
  if (/CurveYield[A-Za-z0-9_]*V(?:1[0-7]|[1-9])\b/.test(legacyScan)) {
    fail(`${relative} contains an active legacy contract symbol`);
  }
}

for (const file of activeFiles.filter((candidate) => candidate.endsWith(".sol"))) {
  const text = fs.readFileSync(file, "utf8");
  const importPattern = /import(?:\s+\{[\s\S]*?\}\s+from\s+|\s+)["']([^"']+)["'];/g;
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    const target = path.resolve(path.dirname(file), specifier);
    if (!fs.existsSync(target)) fail(`${path.relative(root, file)} has missing import ${specifier}`);
  }
}

const staking = fs.readFileSync(stakingFile, "utf8");
const requiredFragments = [
  "IGovernanceBoostStrategy public governanceBoostStrategy",
  "strategy.governanceBoostBps(account)",
  "function proposeWithdrawalConfig(",
  "function executeWithdrawalConfig()",
  "function cancelWithdrawalConfig()",
  "function withdrawImmediately(",
  "standardFeeBps + baseFeeBps",
  "EARLY_STANDARD_FEE_REDUCTION_BPS = 5_000",
  "REWARD_CYCLE_INTERVAL = 1 days",
  "MAX_ACTIVE_STREAMS_PER_TOKEN = 14"
];
for (const fragment of requiredFragments) {
  if (!staking.includes(fragment)) fail(`staking source missing: ${fragment}`);
}
for (const forbidden of [
  "struct ParticipationRecord",
  "struct CanonicalProposal",
  "_appendParticipationRecord(",
  "function registeredProposalCount(",
  "function canonicalProposalWindowCount(",
  "function canonicalProposals(",
  "function participationHistoryCount(",
  "function participationHistoryCurrent(",
  "function participationRecord(",
  "function participationStats(",
  "function proposalStateHash("
]) {
  if (staking.includes(forbidden)) fail(`staking still duplicates strategy surface: ${forbidden}`);
}

const governanceMintController = fs.readFileSync(governanceMintControllerFile, "utf8");
for (const fragment of [
  "contract CurveYieldGovernanceMintController",
  "mintReservedAndReserveNext",
  "queueMintedParticipationReward"
]) {
  if (!governanceMintController.includes(fragment)) fail(`mint controller source missing: ${fragment}`);
}
for (const forbidden of [
  "activeStakerCount",
  "hasEverStaked",
  "_governanceStakers",
  "_rewardEligibleSupplyCheckpoints",
  "pendingOneTimeGovernanceMint",
  "periodicGovernanceMintAmount",
  "isProposalRegistrar"
]) {
  if (staking.includes(forbidden)) fail(`slimmed staking still contains externalized state: ${forbidden}`);
}
for (const preserved of [
  "kickWithProposalSync",
  "stakeWithProposalSync",
  "stakeForWithProposalSync",
  "requestWithdrawalWithProposalSync",
  "claimRewardsWithProposalSync"
]) {
  if (!staking.includes(preserved)) fail(`staking convenience method removed: ${preserved}`);
}

const revenueVault = fs.readFileSync(revenueVaultFile, "utf8");
for (const fragment of [
  "contract CurveYieldRevenueVaultV7",
  "struct StratCandidate",
  "function economicBalance()",
  "function depositWithStrictHarvest(",
  "function proposeStrat(",
  "function upgradeStrat()",
  "CYGOV_DISTRIBUTOR.checkpoint(from, to)"
]) {
  if (!revenueVault.includes(fragment)) fail(`revenue vault source missing: ${fragment}`);
}
if (fs.existsSync(path.join(contracts, "CurveYieldRevenueCompounder.sol"))) {
  fail("superseded monolithic compounder remains active");
}
const revenueStrategy = fs.readFileSync(revenueStrategyFile, "utf8");
for (const fragment of [
  "MAX_WITHDRAW_FEE_BPS = 100",
  "MAX_PERFORMANCE_FEE_BPS = 900",
  "MAX_TOTAL_HARVEST_FEE_BPS = 1_000",
  "bool public harvestOnDeposit",
  "function beforeDepositStrict()",
  "function estimatedUnharvestedWant()",
  "function proposeConverter(",
  "function executeConverter()",
  "function retireStrat()"
]) {
  if (!revenueStrategy.includes(fragment)) fail(`revenue strategy source missing: ${fragment}`);
}
const revenueConverter = fs.readFileSync(revenueConverterFile, "utf8");
for (const fragment of [
  "contract CurveYieldRevenueConverter",
  "LOCKER.deposit(amountIn, recipient)",
  "function setSdtSwapAdapter",
  "function setUsdcRoute"
]) {
  if (!revenueConverter.includes(fragment)) fail(`revenue converter source missing: ${fragment}`);
}
const cyGovDistributor = fs.readFileSync(cyGovDistributorFile, "utf8");
for (const fragment of ["function checkpoint(address from, address to)", "function claim(bool stakeIntoVotingToken)", "claimCyGovToDistributor"] ) {
  if (!cyGovDistributor.includes(fragment)) fail(`cyGOV distributor source missing: ${fragment}`);
}

console.log("V18.9 active source layout and architecture checks passed.");
