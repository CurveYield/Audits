#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const need = (src, text, label) => { if (!src.includes(text)) throw new Error(`${label}: missing ${text}`); };
const forbid = (src, text, label) => { if (src.includes(text)) throw new Error(`${label}: forbidden ${text}`); };

const file = "contracts/CurveYieldCyGovYieldStaking.sol";
if (!fs.existsSync(path.join(root, file))) throw new Error("missing CurveYieldCyGovYieldStaking.sol");
const staking = read(file);
for (const [text, label] of [
  ["contract CurveYieldCyGovYieldStaking", "contract"],
  ["MAX_WITHDRAW_FEE_BPS = 400", "4% withdrawal cap"],
  ["DEFAULT_WITHDRAW_FEE_BPS = 200", "2% initial withdrawal fee"],
  ["MAX_DAILY_DECAY_RATE = 10", "daily decay cap"],
  ["DEFAULT_DAILY_DECAY_RATE = 3", "initial daily decay"],
  ["CONFIG_TIMELOCK_ACTIVATION_DELAY = 7 days", "setup window"],
  ["CONFIG_CHANGE_DELAY = 14 days", "rate timelock"],
  ["BACKING_DAYS = 30", "30 day backing"],
  ["INITIAL_DIRECT_MINT_CAP = 15_000_000_000 ether", "initial inventory cap"],
  ["function setTargetYield", "target yield setter"],
  ["function setMaxMintRate", "max mint setter"],
  ["function mintInitialInventory", "initial inventory mint"],
  ["function stake(", "stake"],
  ["function withdraw(", "withdraw"],
  ["function claim(", "claim"],
  ["function effectiveMaxMintRate", "effective rate view"],
  ["function lockedMintReserve", "locked reserve view"],
  ["DECAY_DENOMINATOR = BPS * 1 days", "rate-seconds decay denominator"],
  ["cumulativeDecayUnits", "cumulative additive decay schedule"],
  ["_integratedReward", "cadence-independent reward integration"],
  ["CYVLSDT.safeTransfer(treasuryReceiver, fee)", "treasury withdrawal fee"],
  ["CYVLSDT.safeTransfer(treasuryReceiver, decayAmount)", "treasury decay fee"],
  ["freeHeldCyGov()", "free held accounting"],
  ["GOVERNANCE_TOKEN.mintReserved", "reserved reward funding"],
  ["GOVERNANCE_TOKEN.mint(address(this), unreserved)", "direct initial inventory funding"],
  ["requiredBacking = newRate * BACKING_DAYS", "max rate backing"],
  ["GOVERNANCE_TOKEN.replaceMintReservation", "atomic reserve resize"],
  ["if (mintReservationId == 0)", "held-only backing transition branch"],
  ["0, amountToLock, block.timestamp", "protected first automatic reserve"]
]) need(staking, text, label);
forbid(staking, "for (uint256 day", "no per-day loop");

const token = read("contracts/CurveYieldGovernanceToken.sol");
need(token, "function replaceMintReservation", "token reservation resize");
need(token, "_cancelReservationInternal", "reservation replacement release");
need(token, "_reserveExact(msg.sender, newAmount", "reservation replacement lock");
need(token, "mapping(uint256 => bool) public protectedMintReservation", "protected reservation registry");
need(token, "protectedMintReservation[newId] = true", "replacement reservation protection");
need(token, "protectedMintReservation[id] && msg.sender != reservation.minter", "owner cannot release protected rate backing");

const strategy = read("contracts/CurveYieldRevenueStrategyV20.sol");
need(strategy, "address public treasuryReceiver", "strategy treasury" );
need(strategy, "WANT.safeTransfer(treasuryReceiver, fee)", "strategy withdrawal fee treasury");
need(strategy, "WANT.safeTransfer(treasuryReceiver, performanceFee)", "strategy performance fee treasury");
forbid(strategy, "performanceFeeRecipient", "no arbitrary performance fee recipient");

const revenue = read("contracts/CurveYieldVlSDTRevenueStaking.sol");
need(revenue, "IERC20(token).safeTransfer(admin, adminAmount)", "revenue admin fee paid to admin role");
forbid(revenue, "adminFeeReceiver", "no separate revenue admin fee receiver");

const config = JSON.parse(read("config-mainnet-v20.json"));
if (config.release !== "20") throw new Error("release must be 20");
const alloc = config.governanceMinting.allocations;
const expected = {
  revenueStaking: ["5000000000000000000000000000", 800],
  boostStaking: ["10000000000000000000000000000", 1200],
  cyGovYieldStaking: ["15000000000000000000000000000", 3000],
  governanceStaking: ["20000000000000000000000000000", 3000]
};
for (const [key, [initialCap, additionalBps]] of Object.entries(expected)) {
  if (!alloc[key]) throw new Error(`missing allocation ${key}`);
  if (alloc[key].initialCap !== initialCap || alloc[key].additionalBps !== additionalBps) {
    throw new Error(`allocation mismatch ${key}`);
  }
}
if (config.cyGovYieldStaking.initialWithdrawFeeBps !== 200) throw new Error("yield staking initial fee mismatch");
if (config.cyGovYieldStaking.initialDailyDecayRate !== 3) throw new Error("yield staking initial decay mismatch");
if (Object.prototype.hasOwnProperty.call(config.feeReceivers, "admin")) {
  throw new Error("admin fee must follow finalAdmin role, not a separate feeReceivers.admin address");
}


const lib = read("deployment-v20/lib-v20.js");
need(lib, '["cyGovYieldStaking", "CurveYieldCyGovYieldStaking"]', "deployable registry");
need(lib, 'c.release !== "20"', "V20 config validation");
need(lib, 'c.feeReceivers.treasury !== c.finalOwner', "Treasury receiver validation");
forbid(lib, 'feeReceivers.admin', "separate admin fee receiver config");

const verify = read("deployment-v20/verify-deployment-v20.js");
for (const text of [
  'contract(ctx, "cyGovYieldStaking")',
  'cyGovYieldStaking.requiredMintReserve()',
  'cyGovYieldStaking.lockedMintReserve()',
  'governanceToken.protectedMintReservation(yieldReservationId)',
  '["cyGovYieldStaking", await cyGovYieldStaking.getAddress()]',
  'governanceToken.isMinter(await cyGovYieldStaking.getAddress())',
  'originalAdditionalBpsTotal !== 8000n'
]) need(verify, text, "deployment verification");
forbid(verify, "adminFeeReceiver", "stale Revenue Staking admin receiver verification");
forbid(verify, "performanceFeeRecipient", "stale Revenue Strategy fee receiver verification");

const yieldTestPath = "test/v20/CyGovYieldStakingV20.test.js";
if (!fs.existsSync(path.join(root, yieldTestPath))) throw new Error("missing cyGOV Yield Staking executable test source");
const yieldTest = read(yieldTestPath);
need(yieldTest, "protects the first automatic reserve after held-only backing is consumed", "held-only transition regression test");
need(yieldTest, "protectedMintReservation(reservationId)", "protected reserve test assertion");
need(yieldTest, "same linear decay and emissions with daily or annual checkpoints", "checkpoint cadence regression test");

const feeTestPath = "test/v20/RevenueBenchmarkFeesV20.test.js";
if (!fs.existsSync(path.join(root, feeTestPath))) throw new Error("missing Revenue benchmark executable test source");
const feeTest = read(feeTestPath);
need(feeTest, "setAdmin", "admin-role transfer fee test");
need(feeTest, "balanceOf(ctx.nextAdmin.address)", "admin fee reaches new role holder");

const deploy = read("deployment-v20/deploy-configure-v20.js");
for (const text of [
  "CurveYieldCyGovYieldStaking",
  "cyGovYieldStaking",
  "setTargetYield",
  "setMaxMintRate",
  "mintInitialInventory"
]) need(deploy, text, "deployment wiring");

// Arithmetic model: 30-day rate backing, held-first funding, and linear decay.
const backingDays = 30n;
const maxRate = 1_000n;
const held = 6_000n;
const locked = maxRate * backingDays - held;
if ((held + locked) / backingDays !== maxRate) throw new Error("max-rate backing model mismatch");
const oneDayReward = maxRate;
const heldUsed = held < oneDayReward ? held : oneDayReward;
const reserveUsed = oneDayReward - heldUsed;
if (heldUsed !== oneDayReward || reserveUsed !== 0n) throw new Error("held-first reward funding model mismatch");
const principal = 1_000_000n;
const decayRate = 3n;
const secondsPerDay = 86_400n;
const annualUnits = 365n * secondsPerDay * decayRate;
const annualRemaining = principal * (10_000n * secondsPerDay - annualUnits) / (10_000n * secondsPerDay);
let dailyUnits = 0n;
let dailyRemaining = principal;
for (let day = 0n; day < 365n; ++day) {
  dailyUnits += secondsPerDay * decayRate;
  dailyRemaining = principal * (10_000n * secondsPerDay - dailyUnits) / (10_000n * secondsPerDay);
}
if (annualRemaining !== dailyRemaining || annualRemaining !== 890_500n) {
  throw new Error(`checkpoint cadence changes linear decay: annual=${annualRemaining} daily=${dailyRemaining}`);
}

const maxRateDecay = 10n;
const maxAnnualUnits = 365n * secondsPerDay * maxRateDecay;
const maxAnnualRemaining = principal * (10_000n * secondsPerDay - maxAnnualUnits) / (10_000n * secondsPerDay);
let maxDailyUnits = 0n;
let maxDailyRemaining = principal;
for (let day = 0n; day < 365n; ++day) {
  maxDailyUnits += secondsPerDay * maxRateDecay;
  maxDailyRemaining = principal * (10_000n * secondsPerDay - maxDailyUnits) / (10_000n * secondsPerDay);
}
if (maxAnnualRemaining !== maxDailyRemaining || maxAnnualRemaining !== 635_000n) {
  throw new Error(`max-rate cadence mismatch: annual=${maxAnnualRemaining} daily=${maxDailyRemaining}`);
}

// Trapezoidal integration is additive for the same linear principal path.
const startDailyReward = 1_000_000n;
const endDailyReward = 635_000n;
const annualReward = (startDailyReward + endDailyReward) * 365n / 2n;
let dailyReward = 0n;
for (let day = 0n; day < 365n; ++day) {
  const start = startDailyReward - day * 1_000n;
  const end = start - 1_000n;
  dailyReward += (start + end) / 2n;
}
if (annualReward !== dailyReward) throw new Error("linear reward integration changes with checkpoint cadence");

console.log("V20 cyGOV Yield Staking, locked max-rate backing, allocations, Treasury routing, and sole admin-fee exception checks passed.");
