#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

const gov = read("contracts/CurveYieldGovernanceStaking.sol");
const rev = read("contracts/CurveYieldVlSDTRevenueStaking.sol");
const locker = read("contracts/CurveYieldVlSDTLocker.sol");
const compounder = read("contracts/CurveYieldRevenueCompounder.sol");
const all = fs.readdirSync(path.join(root, "contracts")).filter(x => /^CurveYield.*\.sol$/.test(x)).map(x => read(`contracts/${x}`)).join("\n");

must(gov.includes("IERC20 public immutable GOVERNANCE_TOKEN;"), "governance token dependency must remain immutable");
must(gov.includes("address public treasuryReceiver;"), "governance treasury receiver must be mutable storage");
must(gov.includes("function setTreasuryReceiver(address newReceiver) external onlyOwner"), "governance treasury setter missing");
must(!gov.includes("address public immutable DAO;"), "immutable DAO receiver remains in governance staking");

must(rev.includes("IERC20 public immutable CYVLSDT;"), "revenue staking asset must remain immutable");
must(rev.includes("address public admin;"), "admin storage missing");
must(rev.includes("address public adminFeeReceiver;"), "admin receiver storage missing");
must(rev.includes("function setAdmin(address newAdmin) external onlyAdmin"), "self-admin setter missing");
must(rev.includes("function setAdminFeeReceiver(address newReceiver) external onlyAdmin"), "admin-only receiver setter missing");
must(rev.includes("function setTreasuryReceiver(address newReceiver) external onlyOwner"), "owner treasury setter missing");

must(!locker.includes("address public immutable ADMIN;"), "locker admin role must be removed");
must(locker.includes("address public treasuryReceiver;"), "locker treasury receiver missing");
must(locker.includes("uint256 public constant ADMIN_BOOST_BPS = 500;"), "fixed 5% admin boost cap missing");
must(locker.includes("function delegateAdminBoost") && /function delegateAdminBoost[\s\S]{0,180}onlyAdmin/.test(locker), "reserved admin boost must be admin-controlled");
must(!/function delegateAdminBoost[\s\S]{0,180}onlyOwner/.test(locker), "owner must not control reserved admin boost");
must(compounder.includes("ERC4626(IERC20(cyvlSdt_))"), "ERC4626 asset must remain immutable");

const nonRevenueAdminUses = (all.replace(rev, "").match(/\bonlyAdmin\b/g) || []).length;
must(nonRevenueAdminUses === 2, "only the Locker modifier and delegateAdminBoost may use admin authority outside Revenue Staking");
must(!all.includes("address public immutable DAO;"), "immutable DAO receiver remains");
must(!all.includes("ADMIN_FEE_RECEIVER"), "immutable admin fee receiver remains");

const config = JSON.parse(read("config-mainnet-v18.json"));
must(config.finalOwner === "0x9f2B20A772246960810045905B7daccf960eE288", "final owner mismatch");
must(config.feeReceivers.treasury === config.finalOwner, "treasury receiver mismatch");
must(config.feeReceivers.admin === config.finalOwner, "admin receiver mismatch");

for (const script of ["preflight-anvil-v18.js", "deploy-configure-v18.js", "verify-deployment-v18.js", "propose-handoff-v18.js", "accept-handoff-v18.js"]) {
  must(fs.existsSync(path.join(root, "deployment-v18", script)), `${script} missing`);
}
const deploymentText = fs.readdirSync(path.join(root, "deployment-v18")).filter(x => x.endsWith(".js")).map(x => read(`deployment-v18/${x}`)).join("\n");
must(!/executeProposal|Admin plugin|aragon.*call/i.test(deploymentText), "deployment package contains Aragon execution logic");
must(deploymentText.includes("anvil"), "Anvil integration missing");
console.log(" deployment-package static requirements passed");
