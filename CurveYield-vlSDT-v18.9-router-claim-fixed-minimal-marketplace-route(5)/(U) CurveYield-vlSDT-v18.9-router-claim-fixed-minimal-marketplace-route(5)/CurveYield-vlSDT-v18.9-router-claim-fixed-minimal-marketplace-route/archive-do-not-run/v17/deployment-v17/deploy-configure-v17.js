#!/usr/bin/env node
"use strict";

const {
  ethers, makeContext, deployOne, send, contract, assertExternalDependencies, saveState, requireAddress
} = require("./lib-v17");

async function deployAndConfigure(options = {}) {
  const ctx = await makeContext({
    configPath: options.configPath || process.argv[2],
    rpcUrl: options.rpcUrl || process.env.RPC_URL,
    privateKey: options.privateKey || process.env.DEPLOYER_PRIVATE_KEY,
    tag: options.tag || process.env.DEPLOYMENT_TAG || "live",
    confirmations: options.confirmations,
    stateFile: options.stateFile
  });
  const c = ctx.config;
  const deployer = ctx.wallet.address;
  const treasury = c.feeReceivers.treasury;
  const adminReceiver = c.feeReceivers.admin;
  const rewardToken = await assertExternalDependencies(ctx.provider, c);
  ctx.state.external = { ...c.stakeDao, feeDistributorRewardToken: rewardToken };
  saveState(ctx.stateFile, ctx.state);

  const governanceToken = await deployOne(ctx, "governanceToken", "CurveYieldGovernanceTokenV17", [deployer, c.governanceToken.name, c.governanceToken.symbol]);
  const governanceStaking = await deployOne(ctx, "governanceStaking", "CurveYieldGovernanceStakingV17", [
    deployer, await governanceToken.getAddress(), treasury, c.governanceStaking.name, c.governanceStaking.symbol,
    c.governanceStaking.initialWithdrawTaxBps, c.governanceStaking.initialWithdrawHoldTimeSeconds
  ]);
  const cyvlSdt = await deployOne(ctx, "cyvlSdt", "CurveYieldVlSDTTokenV17", [deployer]);
  const locker = await deployOne(ctx, "locker", "CurveYieldVlSDTLockerV17", [
    deployer, treasury, c.stakeDao.sdt, c.stakeDao.vlSdt, c.stakeDao.vlBoost,
    c.stakeDao.feeDistributor, c.stakeDao.boostMarketplace, await cyvlSdt.getAddress()
  ]);
  const revenueStaking = await deployOne(ctx, "revenueStaking", "CurveYieldVlSDTRevenueStakingV17", [
    deployer, deployer, treasury, adminReceiver, await cyvlSdt.getAddress(), await governanceToken.getAddress()
  ]);
  const boostStaking = await deployOne(ctx, "boostStaking", "CurveYieldVlSDTBoostStakingV17", [
    deployer, await cyvlSdt.getAddress(), await locker.getAddress(), await governanceToken.getAddress()
  ]);
  const boostMerchant = await deployOne(ctx, "boostMerchant", "CurveYieldVlSDTBoostMerchantV17", [
    deployer, await locker.getAddress(), await revenueStaking.getAddress(), c.stakeDao.boostMarketplace
  ]);
  const compounder = await deployOne(ctx, "compounder", "CurveYieldRevenueCompounderV17", [
    deployer, await cyvlSdt.getAddress(), c.stakeDao.sdt, await governanceToken.getAddress(), await locker.getAddress(),
    await revenueStaking.getAddress(), await governanceStaking.getAddress()
  ]);

  if ((await cyvlSdt.locker()) === ethers.ZeroAddress) await send(ctx, "configure:cyvlSdt.setLocker", cyvlSdt, "setLocker", [await locker.getAddress()]);
  if (!(await locker.systemConfigured())) await send(ctx, "configure:locker.configureSystem", locker, "configureSystem", [await revenueStaking.getAddress(), await boostStaking.getAddress(), await boostMerchant.getAddress()]);
  if (!(await revenueStaking.isRewardToken(rewardToken))) await send(ctx, "configure:revenue.addRewardToken", revenueStaking, "addRewardToken", [rewardToken]);
  const revenueNotifiers = [await locker.getAddress(), await boostMerchant.getAddress()];
  const revenueNotifierStates = await Promise.all(revenueNotifiers.map(x => revenueStaking.isNotifier(x)));
  if (revenueNotifierStates.some(x => !x)) {
    await send(ctx, "configure:revenue.setNotifiers", revenueStaking, "setNotifiers", [revenueNotifiers, true]);
  }
  const minters = [await revenueStaking.getAddress(), await boostStaking.getAddress()];
  if (!(await governanceToken.isMinter(minters[0])) || !(await governanceToken.isMinter(minters[1]))) {
    await send(ctx, "configure:governanceToken.setMinters", governanceToken, "setMinters", [minters, true]);
  }

  const minMultiplier = BigInt(c.boostEconomics.minimumBoostStakingMultiplierWei);
  const maxMultiplier = BigInt(c.boostEconomics.maximumBoostStakingMultiplierWei);
  if ((await boostStaking.minimumMultiplier()) !== minMultiplier || (await boostStaking.maximumMultiplier()) !== maxMultiplier) {
    await send(ctx, "configure:boostStaking.setMultiplierRange", boostStaking, "setMultiplierRange", [minMultiplier, maxMultiplier]);
  }
  const merchantBps = Number(c.boostEconomics.merchantStandingReserveBps || 0);
  const stakingBps = Number(c.boostEconomics.boostStakingStandingReserveBps || 0);
  if (Number(await locker.merchantReserveBps()) !== merchantBps || Number(await locker.boostStakingReserveBps()) !== stakingBps) {
    await send(ctx, "configure:locker.setModuleBoostReserveBps", locker, "setModuleBoostReserveBps", [merchantBps, stakingBps]);
  }
  const release = BigInt(c.boostEconomics.daoBoostReleasedToModules || "0");
  if ((await locker.daoBoostReleasedToModules()) !== release) await send(ctx, "configure:locker.setDaoBoostReleasedToModules", locker, "setDaoBoostReleasedToModules", [release]);

  for (const [i, p] of (c.boostEconomics.merchantPaymentTokens || []).entries()) {
    const token = requireAddress(`merchantPaymentTokens[${i}].token`, p.token);
    await send(ctx, `configure:merchant.paymentToken:${i}`, boostMerchant, "setPaymentToken", [token, p.enabled !== false, BigInt(p.minimumPricePerWeek), BigInt(p.maximumPricePerWeek)]);
  }
  const revEmission = BigInt(c.emissions.revenueStakingGovernancePerSecond || "0");
  if ((await revenueStaking.governanceEmissionRate()) !== revEmission) await send(ctx, "configure:revenue.emission", revenueStaking, "setGovernanceEmissionRate", [revEmission]);
  const boostEmission = BigInt(c.emissions.boostStakingGovernancePerSecond || "0");
  if ((await boostStaking.governanceEmissionRate()) !== boostEmission) await send(ctx, "configure:boost.emission", boostStaking, "setGovernanceEmissionRate", [boostEmission]);
  const advantage = Number(c.compounder.minimumMarketAdvantageBps || 0);
  if (Number(await compounder.minimumMarketAdvantageBps()) !== advantage) await send(ctx, "configure:compounder.advantage", compounder, "setMinimumMarketAdvantageBps", [advantage]);

  for (const keeper of c.compounder.keepers || []) if (!(await compounder.isKeeper(keeper))) await send(ctx, `configure:compounder.keeper:${keeper}`, compounder, "setKeeper", [keeper, true]);
  if (c.compounder.sdtToCyvlSdtAdapter) {
    const adapter = requireAddress("compounder.sdtToCyvlSdtAdapter", c.compounder.sdtToCyvlSdtAdapter);
    if (ethers.getAddress(await compounder.sdtToCyvlSdtAdapter()) !== adapter) await send(ctx, "configure:compounder.sdtAdapter", compounder, "setSdtToCyvlSdtAdapter", [adapter]);
  }
  for (const [tokenRaw, adapterRaw] of Object.entries(c.compounder.rewardToSdtAdapters || {})) {
    const token = requireAddress("compounder.reward token", tokenRaw);
    const adapter = requireAddress("compounder.reward adapter", adapterRaw);
    await send(ctx, `configure:compounder.rewardAdapter:${token}`, compounder, "setRewardAdapter", [token, adapter]);
  }

  for (const token of c.governanceStaking.rewardTokens || []) if (!(await governanceStaking.isRewardToken(token))) await send(ctx, `configure:governanceStaking.reward:${token}`, governanceStaking, "addRewardToken", [token]);
  if ((c.governanceStaking.notifiers || []).length) await send(ctx, "configure:governanceStaking.setNotifiers", governanceStaking, "setNotifiers", [c.governanceStaking.notifiers, true]);

  if (!(await governanceStaking.isProposalRegistrar(c.finalOwner))) await send(ctx, "configure:governanceStaking.addFinalRegistrar", governanceStaking, "setProposalRegistrar", [c.finalOwner, true]);
  if (deployer !== c.finalOwner && await governanceStaking.isProposalRegistrar(deployer)) await send(ctx, "configure:governanceStaking.removeDeployerRegistrar", governanceStaking, "setProposalRegistrar", [deployer, false]);

  // This is a direct call to the external vlBoost contract, not an Aragon action.
  await send(ctx, "configure:locker.setMarketplaceOperator", locker, "setMarketplaceOperator", [true]);

  ctx.state.phase = "configured";
  saveState(ctx.stateFile, ctx.state);
  console.log(`configuration complete; state=${ctx.stateFile}`);
  return ctx;
}

if (require.main === module) deployAndConfigure().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { deployAndConfigure };
