#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`${label}: missing ${text}`);
}
function requireOrder(source, first, second, label) {
  const a = source.indexOf(first);
  const b = source.indexOf(second);
  if (a === -1 || b === -1 || a >= b) throw new Error(`${label}: invalid source ordering`);
}

const token = read("contracts/CurveYieldGovernanceToken.sol");
for (const [text, label] of [
  ["CAP = 1_000_000_000_000 ether", "hard cap"],
  ["MIN_ALLOCATION_BPS = 3_000", "minimum allocation floor"],
  ["INITIAL_UNLOCK = 200_000_000_000 ether", "initial unlock"],
  ["TIMELOCK_ACTIVATION_DELAY = 7 days", "token setup window"],
  ["MINTER_ADDITION_DELAY = 14 days", "minter delay"],
  ["MINTER_ALLOCATION_DELAY = 14 days", "allocation change delay"],
  ["mapping(address => MinterAllocation) public originalMinterAllocation", "original allocation baselines"],
  ["mapping(address => uint256) public reservedByMinter", "per-minter reservations"],
  ["uint256 public totalReservedMint", "global reservations"],
  ["function reserveMint", "exact reservation API"],
  ["function mintReservedAndReserveNext", "periodic roll-forward API"],
  ["function cancelRemovedMinterReservation", "removed-minter protected reservation recovery"],
  ["!reservation.quotaControlled", "removed-minter recovery quota guard"],
  ["!protectedMintReservation[id]", "removed-minter recovery protection guard"],
  ["isMinter[reservation.minter]", "removed-minter recovery active-minter guard"],
  ["_cancelReservationInternal(id)", "shared reservation cancellation accounting"],
  ["totalSupply() + totalReservedMint", "cross-contract commitment accounting"]
]) requireText(token, text, label);

for (const file of [
  "contracts/CurveYieldVlSDTRevenueStaking.sol",
  "contracts/CurveYieldVlSDTBoostStaking.sol",
  "contracts/CurveYieldGovernanceMintController.sol"
]) {
  const source = read(file);
  requireText(source, "MINT_TIMELOCK_ACTIVATION_DELAY = 7 days", `${file} setup window`);
  requireText(source, "MINT_APPROVAL_DELAY = 7 days", `${file} approval delay`);
  requireText(source, "proposeOneTimeGovernanceMint", `${file} one-time approval`);
  requireText(source, ".reserveMint(amount, readyAt)", `${file} one-time reservation`);
  requireText(source, "proposePeriodicGovernanceMint", `${file} periodic approval`);
  requireText(source, "mintReservedAndReserveNext", `${file} periodic roll-forward`);
  requireText(source, "PeriodicGovernanceMintReservationUnavailable", `${file} safe periodic pause`);
  requireText(source, "availableMintableFor(address(this))", `${file} live capacity getter`);
}

const governanceStaking = read("contracts/CurveYieldGovernanceStaking.sol");
const mintController = read("contracts/CurveYieldGovernanceMintController.sol");
requireText(governanceStaking, "setGovernanceMintController", "mint controller wiring");
requireText(governanceStaking, "queueMintedParticipationReward", "mint receiver entrypoint");
requireText(governanceStaking, "_queueReward(data, token, amount, true)", "multiplier-eligible stream queue");
const mintHelper = mintController.slice(mintController.indexOf("function _mintAndQueueParticipationReward"));
requireOrder(
  mintHelper,
  "GOVERNANCE_MINTER.mintReserved(reservationId, governanceStaking, amount)",
  "queueMintedParticipationReward(amount)",
  "controller must mint before recording the participation stream"
);
for (const forbidden of [
  "pendingOneTimeGovernanceMint",
  "periodicGovernanceMintAmount",
  "oneTimeGovernanceMintReservationId",
  "GOVERNANCE_MINTER"
]) {
  if (governanceStaking.includes(forbidden)) {
    throw new Error(`Governance Staking still contains externalized mint scheduler state: ${forbidden}`);
  }
}


const cyGovYieldTests = read("test/v20/CyGovYieldStakingV20.test.js");
for (const text of [
  "recovers a protected reservation only after its minter is removed",
  "cancelRemovedMinterReservation(reservationId)",
  "UnauthorizedMinter",
  "hardhat_stopImpersonatingAccount"
]) {
  requireText(cyGovYieldTests, text, "removed-minter reservation regression");
}

const config = JSON.parse(read("config-mainnet-v20.json"));
if (config.version !== 20 || config.release !== "20") throw new Error("V20 config metadata mismatch");
if (config.governanceMinting.minimumAllocationBps !== 3000) throw new Error("minimum allocation config mismatch");
if (config.governanceMinting.allocationChangeDelaySeconds !== 1209600) throw new Error("allocation delay config mismatch");

const deploy = read("deployment-v20/deploy-configure-v20.js");
requireText(deploy, "CurveYieldGovernanceMintController", "mint controller deployment");
requireText(deploy, "setGovernanceMintController", "mint controller staking wiring");
requireText(deploy, "await governanceMintController.getAddress()", "mint controller minter allocation wiring");
requireOrder(
  deploy,
  "await configureMinterAllocation(key, minter)",
  "governanceToken.setMinters",
  "allocations must be configured before minter privileges"
);

const verify = read("deployment-v20/verify-deployment-v20.js");
requireText(verify, "mint controller staking binding", "mint controller verification");
requireText(verify, "governanceToken.isMinter(await governanceMintController.getAddress())", "mint controller minter verification");

if (token.includes("ActiveMintReservations")) {
  throw new Error("allocation changes still use the obsolete blanket active-reservation prohibition");
}

console.log("V20 governance unlock, adjustable quota, reservation, and external mint-controller checks passed.");
