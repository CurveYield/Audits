#!/usr/bin/env node
"use strict";
const { ethers, makeContext, contract, assertExternalDependencies, assertOwner, writeJson, ROOT } = require("./lib-v17");
const path = require("path");

async function verifyDeployment(options = {}) {
  const ctx = await makeContext({ configPath: options.configPath || process.argv[2], rpcUrl: options.rpcUrl || process.env.RPC_URL, privateKey: options.privateKey || process.env.DEPLOYER_PRIVATE_KEY, tag: options.tag || process.env.DEPLOYMENT_TAG || "live", confirmations: 0, allowWalletMismatch: true });
  const c = ctx.config;
  const expectedOwner = options.expectedOwner || process.env.EXPECTED_OWNER || ctx.wallet.address;
  const expectedAdmin = options.expectedAdmin || process.env.EXPECTED_ADMIN || (ethers.getAddress(expectedOwner) === c.finalOwner ? c.finalAdmin : ctx.wallet.address);
  const rewardToken = await assertExternalDependencies(ctx.provider, c);
  const gov = contract(ctx, "governanceToken");
  const gs = contract(ctx, "governanceStaking");
  const cy = contract(ctx, "cyvlSdt");
  const locker = contract(ctx, "locker");
  const rev = contract(ctx, "revenueStaking");
  const bs = contract(ctx, "boostStaking");
  const bm = contract(ctx, "boostMerchant");
  const comp = contract(ctx, "compounder");
  for (const [label, x] of [["governanceToken",gov],["governanceStaking",gs],["cyvlSdt",cy],["locker",locker],["revenueStaking",rev],["boostStaking",bs],["boostMerchant",bm],["compounder",comp]]) await assertOwner(x, expectedOwner, label);
  const eq = (a,b,label) => { if (ethers.getAddress(a) !== ethers.getAddress(b)) throw new Error(`${label}: ${a} != ${b}`); };
  eq(await gs.GOVERNANCE_TOKEN(), await gov.getAddress(), "governanceStaking token");
  eq(await gs.treasuryReceiver(), c.finalOwner, "governance treasury");
  eq(await locker.treasuryReceiver(), c.finalOwner, "locker treasury");
  eq(await rev.treasuryReceiver(), c.finalOwner, "revenue treasury");
  eq(await rev.adminFeeReceiver(), c.finalOwner, "admin fee receiver");
  eq(await rev.admin(), expectedAdmin, "revenue admin");
  eq(await locker.admin(), expectedAdmin, "locker admin source");
  if (Number(await locker.ADMIN_BOOST_BPS()) !== 500) throw new Error("admin boost cap is not fixed at 5%");
  eq(await cy.locker(), await locker.getAddress(), "cyvl locker");
  eq(await locker.revenueStaking(), await rev.getAddress(), "locker revenue staking");
  eq(await locker.boostStaking(), await bs.getAddress(), "locker boost staking");
  eq(await locker.boostMerchant(), await bm.getAddress(), "locker merchant");
  if (!(await rev.isRewardToken(rewardToken))) throw new Error("fee distributor reward token not registered");
  if (!(await rev.isNotifier(await locker.getAddress())) || !(await rev.isNotifier(await bm.getAddress()))) throw new Error("revenue notifiers incomplete");
  if (!(await gov.isMinter(await rev.getAddress())) || !(await gov.isMinter(await bs.getAddress()))) throw new Error("governance minters incomplete");
  if (!(await gs.isProposalRegistrar(c.finalOwner))) throw new Error("final owner is not proposal registrar");
  if (ctx.wallet.address !== c.finalOwner && await gs.isProposalRegistrar(ctx.wallet.address)) throw new Error("deployer retains proposal registrar role");
  const report = { version:17, chainId:String((await ctx.provider.getNetwork()).chainId), expectedOwner, deployer:ctx.wallet.address, finalOwner:c.finalOwner, finalAdmin:c.finalAdmin, expectedAdmin, feeDistributorRewardToken:rewardToken, contracts:ctx.state.contracts, gasUsed:ctx.state.gasUsed, verifiedAt:new Date().toISOString() };
  const output = path.join(ROOT, "deployment-output-v17", `verification-v17-${options.tag || process.env.DEPLOYMENT_TAG || "live"}.json`);
  writeJson(output, report);
  console.log(`verification passed; report=${output}`);
  return { ctx, report };
}
if (require.main === module) verifyDeployment().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verifyDeployment };
