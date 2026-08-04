#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function must(rel, fragments) {
  const text = read(rel);
  for (const f of fragments) {
    if (!text.includes(f)) throw new Error(`${rel} missing: ${f}`);
  }
}
function absent(rel, fragments) {
  const text = read(rel);
  for (const f of fragments) {
    if (text.includes(f)) throw new Error(`${rel} unexpectedly contains: ${f}`);
  }
}

must("contracts/CurveYieldRevenueVaultV7.sol", [
  "contract CurveYieldRevenueVaultV7",
  "struct StratCandidate",
  "function proposeStrat",
  "function upgradeStrat",
  "function emergencyUpgradeStrat",
  "uint256 public constant approvalDelay = 7 days",
  "function economicBalance",
  "function depositWithStrictHarvest",
  "CYGOV_DISTRIBUTOR.checkpoint"
]);
must("contracts/CurveYieldRevenueStrategyV7.sol", [
  "contract CurveYieldRevenueStrategyV7",
  "function beforeDeposit()",
  "function beforeDepositStrict()",
  "function estimatedUnharvestedWant()",
  "function retireStrat()",
  "function retireStratEmergency()",
  "_harvest(address(0))",
  "retired = true",
  "function proposeConverter",
  "function executeConverter",
  "MAX_WITHDRAW_FEE_BPS = 100",
  "MAX_PERFORMANCE_FEE_BPS = 900",
  "MAX_CALL_FEE_BPS = 100",
  "MAX_TOTAL_HARVEST_FEE_BPS = 1_000",
  "DEFAULT_WITHDRAW_FEE_BPS = 10",
  "DEFAULT_PERFORMANCE_FEE_BPS = 390",
  "DEFAULT_CALL_FEE_BPS = 10",
  "immediateWithdrawFeeBps()",
  "previewImmediateWithdrawal",
  "_grossUpForStakingWithdrawalFee",
  "harvestOnDeposit"
]);
must("contracts/CurveYieldVlSDTRevenueStaking.sol", [
  "MAX_IMMEDIATE_WITHDRAW_FEE_BPS = 250",
  "uint16 public immediateWithdrawFeeBps = 50",
  "function setImmediateWithdrawFeeBps",
  "function previewImmediateWithdrawal"
]);
must("contracts/CurveYieldRevenueVaultV7.sol", [
  "uint256 afterBalance = strictHarvest ? balance() : economicBalance()",
  "uint256 contributedAssets = afterBalance - pool"
]);
must("contracts/CurveYieldRevenueConverter.sol", [
  "contract CurveYieldRevenueConverter",
  "LOCKER.deposit",
  "function setSdtSwapAdapter",
  "function setUsdcRoute",
  "sdtSwapAdapter",
  "usdcAdapter",
  "outputToken()"
]);
absent("contracts/CurveYieldRevenueConverter.sol", [
  "ROUTE_CHANGE_DELAY",
  "pendingUsdc",
  "pendingSdtSwapAdapter"
]);
must("deployment-v18/deploy-configure-v18.js", [
  "setImmediateWithdrawFeeBps",
  "c.revenueStakingConfig.immediateWithdrawFeeBps",
  "setSdtSwapAdapter",
  "setUsdcRoute",
  "rv.withdrawalFeeBps",
  "rv.performanceFeeBps",
  "rv.callFeeBps"
]);
must("deployment-v18/verify-deployment-v18.js", [
  "revenue staking immediate withdrawal fee mismatch",
  "revenue strategy fee configuration mismatch",
  "withdrawal fee cap is not 1%",
  "performance fee cap is not 9%",
  "deployed revenue strategy is already retired"
]);
const migrationTests = read("test/v18/RevenueVaultV18.test.js");
for (const text of [
  "harvests and compounds ordinary rewards before normal strategy retirement",
  "reverts normal migration when reward harvesting fails",
  "emergency migration skips failed harvest",
  "emergencyUpgradeStrat",
  "StrategyAlreadyRetired"
]) {
  if (!migrationTests.includes(text)) throw new Error(`migration regression test missing: ${text}`);
}

const config = JSON.parse(read("config-mainnet-v18.json"));
if (config.release !== "18.9") throw new Error("V18.9 config required");
if (config.revenueStakingConfig.immediateWithdrawFeeBps !== 50) {
  throw new Error("Revenue Staking default immediate withdrawal fee must be 50 bps");
}
if (
  config.revenueVault.strategyApprovalDelaySeconds !== 604800
    || config.revenueVault.withdrawalFeeBps !== 10
    || config.revenueVault.performanceFeeBps !== 390
    || config.revenueVault.callFeeBps !== 10
    || config.revenueVault.harvestOnDeposit !== true
) throw new Error("V18.9 revenue strategy defaults mismatch");

must("contracts/CurveYieldCyGovDistributor.sol", [
  "contract CurveYieldCyGovDistributor",
  "function checkpoint",
  "function claim(bool stakeIntoVotingToken)",
  "claimCyGovToDistributor"
]);
absent("contracts/CurveYieldRevenueStrategyV7.sol", ["GOVERNANCE_TOKEN.forceApprove(address(CONVERTER)"]);

function mulDivFloor(x, y, d) { return x * y / d; }
function mulDivCeil(x, y, d) { return (x * y + d - 1n) / d; }
function previewImmediate(gross, feeBps) { return gross - mulDivFloor(gross, feeBps, 10_000n); }
function grossUp(net, feeBps) {
  let gross = mulDivCeil(net, 10_000n, 10_000n - feeBps);
  if (previewImmediate(gross, feeBps) < net) gross += 1n;
  return gross;
}
for (const fee of [0n, 1n, 50n, 200n, 250n]) {
  for (const net of [1n, 10n, 10n ** 18n, 98n * 10n ** 18n]) {
    const gross = grossUp(net, fee);
    if (previewImmediate(gross, fee) < net) throw new Error(`gross-up underfunds net=${net} fee=${fee}`);
  }
}
const oneHundred = 100n * 10n ** 18n;
if (previewImmediate(oneHundred, 50n) !== 99_500_000_000_000_000_000n) {
  throw new Error("0.5% Revenue Staking preview math mismatch");
}
if (grossUp(98n * 10n ** 18n, 200n) !== oneHundred) {
  throw new Error("2% Revenue Staking gross-up math mismatch");
}

if (fs.existsSync(path.join(root, "contracts/CurveYieldRevenueCompounder.sol"))) {
  throw new Error("active monolithic CurveYieldRevenueCompounder.sol still exists");
}
if (fs.existsSync(path.join(root, "contracts/CurveYieldSdtLockerConverter.sol"))) {
  throw new Error("superseded SDT-only converter still exists in active contracts");
}
console.log("V18.9 Beefy revenue-vault and immediate converter-route static checks passed.");
