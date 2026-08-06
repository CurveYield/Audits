#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "contracts/CurveYieldVlSDTRevenueStaking.sol"), "utf8");

function need(text, label) {
  if (!source.includes(text)) throw new Error(`${label}: missing ${text}`);
}
function forbid(text, label) {
  if (source.includes(text)) throw new Error(`${label}: forbidden ${text}`);
}

need("EXCESS_TREASURY_BPS = 3_300", "33% Treasury fee over benchmark");
need("EXCESS_ADMIN_BPS = 700", "7% admin fee over benchmark");
need("Math.mulDiv(excess, EXCESS_TREASURY_BPS, BPS)", "Treasury excess split");
need("Math.mulDiv(excess, EXCESS_ADMIN_BPS, BPS)", "admin excess split");
need("IERC20(token).safeTransfer(treasuryReceiver, treasuryAmount)", "Treasury fee receiver");
need("IERC20(token).safeTransfer(admin, adminAmount)", "admin fee sent only to admin role address");
need("emit ImmediateAdminReward(token, admin, adminAmount)", "admin fee event names admin role address");
forbid("IERC20(token).safeTransfer(treasuryReceiver, adminAmount)", "admin fee sent to Treasury");
forbid("EXCESS_DAO_BPS", "obsolete 33% DAO excess fee");
forbid("EXCESS_ADMIN_BPS = 1_200", "obsolete 12% admin excess fee");
forbid("adminFeeReceiver", "separate admin fee receiver; fee follows admin role");


const verifier = fs.readFileSync(path.join(root, "deployment-v18/verify-deployment-v18.js"), "utf8");
if (!verifier.includes("revenue staking benchmark fee split mismatch")) {
  throw new Error("deployment verifier does not enforce the 33%/7% benchmark split");
}

const BPS = 10_000n;
const treasuryBps = 3_300n;
const adminBps = 700n;
if (treasuryBps + adminBps !== 4_000n) throw new Error("excess fee total must be exactly 40%");

// Model a reward where 500 is represented benchmark yield: 400 active + 100 queued.
const amount = 1_000n;
const baseActive = 400n;
const baseQueued = 100n;
const excess = amount - baseActive - baseQueued;
const treasuryAmount = baseQueued + excess * treasuryBps / BPS;
const adminAmount = excess * adminBps / BPS;
const userAmount = amount - treasuryAmount - adminAmount;
if (treasuryAmount !== 265n || adminAmount !== 35n || userAmount !== 700n) {
  throw new Error(`benchmark split model mismatch: user=${userAmount} treasury=${treasuryAmount} admin=${adminAmount}`);
}
if (userAmount + treasuryAmount + adminAmount !== amount) throw new Error("benchmark split does not conserve rewards");

console.log("V18.9 Revenue Staking benchmark split passed: 33% Treasury + 7% admin-role fee on excess; admin is the sole non-Treasury fee.");
