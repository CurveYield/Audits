#!/usr/bin/env node
"use strict";

const {
  ethers, makeContext, deployOne, send, contract, assertExternalDependencies, saveState, requireAddress
} = require("./lib-v18");

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
  const feeDistributorRewardTokens = await assertExternalDependencies(ctx.provider, c);
  ctx.state.external = { ...c.stakeDao, feeDistributorRewardTokens };
  saveState(ctx.stateFile, ctx.state);

  const governanceToken = await deployOne(ctx, "governanceToken", "CurveYieldGovernanceToken", [deployer, c.governanceToken.name, c.governanceToken.symbol]);
  const governanceStaking = await deployOne(ctx, "governanceStaking", "CurveYieldGovernanceStaking", [
    deployer,
    await governanceToken.getAddress(),
    treasury,
    c.governanceStaking.name,
    c.governanceStaking.symbol,
    c.governanceStaking.initialStandardWithdrawFeeBps,
    c.governanceStaking.initialBaseWithdrawFeeBps,
    c.governanceStaking.initialWithdrawalDelaySeconds
  ]);
  const governanceMintController = await deployOne(
    ctx,
    "governanceMintController",
    "CurveYieldGovernanceMintController",
    [deployer, await governanceToken.getAddress(), await governanceStaking.getAddress()]
  );
  const governanceBoostStrategy = await deployOne(
    ctx,
    "governanceBoostStrategy",
    "CurveYieldGovernanceBoostStrategy",
    [await governanceStaking.getAddress(), c.governanceBoostStrategy.previousStrategy]
  );
  const cyvlSdt = await deployOne(ctx, "cyvlSdt", "CurveYieldVlSDTToken", [deployer]);
  const locker = await deployOne(ctx, "locker", "CurveYieldVlSDTLocker", [
    deployer, treasury, c.stakeDao.sdt, c.stakeDao.vlSdt, c.stakeDao.vlBoost,
    c.stakeDao.router, c.stakeDao.vlSdtFeeDistributorUsdc,
    c.stakeDao.vlSdtFeeDistributorSdt, c.stakeDao.boostMarketplace,
    await cyvlSdt.getAddress()
  ]);
  const cyGovYieldStaking = await deployOne(ctx, "cyGovYieldStaking", "CurveYieldCyGovYieldStaking", [
    deployer, await cyvlSdt.getAddress(), await governanceToken.getAddress(), treasury
  ]);
  const revenueStaking = await deployOne(ctx, "revenueStaking", "CurveYieldVlSDTRevenueStaking", [
    deployer, deployer, treasury, await cyvlSdt.getAddress(), await governanceToken.getAddress()
  ]);
  const boostStaking = await deployOne(ctx, "boostStaking", "CurveYieldVlSDTBoostStaking", [
    deployer, await cyvlSdt.getAddress(), await locker.getAddress(), await governanceToken.getAddress()
  ]);
  const boostMerchant = await deployOne(ctx, "boostMerchant", "CurveYieldVlSDTBoostMerchant", [
    deployer, await locker.getAddress(), await revenueStaking.getAddress(), c.stakeDao.boostMarketplace
  ]);
  const revenueVault = await deployOne(ctx, "revenueVault", "CurveYieldRevenueVaultV7", [
    c.revenueVault.name,
    c.revenueVault.symbol,
    deployer
  ]);
  const revenueConverter = await deployOne(ctx, "revenueConverter", "CurveYieldRevenueConverter", [
    deployer, c.stakeDao.sdt, await cyvlSdt.getAddress(), await locker.getAddress()
  ]);
  const revenueStrategy = await deployOne(ctx, "revenueStrategy", "CurveYieldRevenueStrategyV7", [
    deployer,
    await revenueVault.getAddress(),
    await cyvlSdt.getAddress(),
    c.stakeDao.sdt,
    await governanceToken.getAddress(),
    await revenueStaking.getAddress(),
    await revenueConverter.getAddress(),
    treasury
  ]);
  const cyGovDistributor = await deployOne(ctx, "cyGovDistributor", "CurveYieldCyGovDistributor", [
    await revenueVault.getAddress(),
    await governanceToken.getAddress(),
    await governanceStaking.getAddress()
  ]);

  if (ethers.getAddress(await governanceStaking.governanceMintController()) !== ethers.getAddress(await governanceMintController.getAddress())) {
    await send(
      ctx,
      "configure:governanceStaking.setGovernanceMintController",
      governanceStaking,
      "setGovernanceMintController",
      [await governanceMintController.getAddress()]
    );
  }
  if (ethers.getAddress(await governanceStaking.governanceBoostStrategy()) !== ethers.getAddress(await governanceBoostStrategy.getAddress())) {
    await send(
      ctx,
      "configure:governanceStaking.setGovernanceBoostStrategy",
      governanceStaking,
      "setGovernanceBoostStrategy",
      [await governanceBoostStrategy.getAddress()]
    );
  }
  if (c.governanceStaking.aragonVotingPlugin !== ethers.ZeroAddress) {
    const currentPlugin = await governanceBoostStrategy.aragonVotingPlugin();
    if (ethers.getAddress(currentPlugin) !== c.governanceStaking.aragonVotingPlugin) {
      await send(
        ctx,
        "configure:governanceBoostStrategy.setAragonVotingPlugin",
        governanceBoostStrategy,
        "setAragonVotingPlugin",
        [c.governanceStaking.aragonVotingPlugin]
      );
    }
  }

  if ((await cyvlSdt.locker()) === ethers.ZeroAddress) await send(ctx, "configure:cyvlSdt.setLocker", cyvlSdt, "setLocker", [await locker.getAddress()]);
  if (!(await locker.systemConfigured())) await send(ctx, "configure:locker.configureSystem", locker, "configureSystem", [await revenueStaking.getAddress(), await boostStaking.getAddress(), await boostMerchant.getAddress()]);
  for (const rewardToken of feeDistributorRewardTokens.all) {
    if (!(await revenueStaking.isRewardToken(rewardToken))) {
      await send(
        ctx,
        `configure:revenue.addRewardToken:${rewardToken}`,
        revenueStaking,
        "addRewardToken",
        [rewardToken]
      );
    }
  }
  if (Number(await revenueStaking.immediateWithdrawFeeBps()) !== c.revenueStakingConfig.immediateWithdrawFeeBps) {
    await send(
      ctx,
      "configure:revenue.immediateWithdrawFee",
      revenueStaking,
      "setImmediateWithdrawFeeBps",
      [c.revenueStakingConfig.immediateWithdrawFeeBps]
    );
  }
  const revenueNotifiers = [await locker.getAddress(), await boostMerchant.getAddress()];
  const revenueNotifierStates = await Promise.all(revenueNotifiers.map(x => revenueStaking.isNotifier(x)));
  if (revenueNotifierStates.some(x => !x)) {
    await send(ctx, "configure:revenue.setNotifiers", revenueStaking, "setNotifiers", [revenueNotifiers, true]);
  }
  const minting = c.governanceMinting || {};
  const allocationConfig = minting.allocations || {};
  const allocationTargets = [
    ["revenueStaking", await revenueStaking.getAddress()],
    ["boostStaking", await boostStaking.getAddress()],
    ["cyGovYieldStaking", await cyGovYieldStaking.getAddress()],
    ["governanceStaking", await governanceMintController.getAddress()]
  ];

  const configureMinterAllocation = async (key, minter) => {
    const target = allocationConfig[key];
    const initialCap = BigInt(target.initialCap);
    const additionalBps = BigInt(target.additionalBps);
    const current = await governanceToken.minterAllocation(minter);
    const originalConfigured = await governanceToken.originalMinterAllocationConfigured(minter);
    const now = BigInt((await ctx.provider.getBlock("latest")).timestamp);
    const timelocksActiveAt = await governanceToken.timelocksActiveAt();

    if (now < timelocksActiveAt) {
      const original = await governanceToken.originalMinterAllocation(minter);
      if (
        originalConfigured
          && original.initialCap === initialCap
          && original.additionalBps === additionalBps
          && current.initialCap === initialCap
          && current.additionalBps === additionalBps
      ) return;

      await send(
        ctx,
        `configure:governanceToken.setOriginalMinterAllocation:${key}`,
        governanceToken,
        "setMinterAllocation",
        [minter, initialCap, additionalBps]
      );
      return;
    }

    if (!originalConfigured) {
      throw new Error(
        `${key} original minter allocation was not configured during the seven-day setup window`
      );
    }

    const original = await governanceToken.originalMinterAllocation(minter);
    if (original.initialCap !== initialCap || original.additionalBps !== additionalBps) {
      throw new Error(`${key} original minter allocation does not match deployment config`);
    }

    const minimum = await governanceToken.minimumMinterAllocation(minter);
    if (
      current.initialCap < minimum.minimumInitialCap
        || current.initialCap > original.initialCap
        || current.additionalBps < minimum.minimumAdditionalBps
        || current.additionalBps > original.additionalBps
    ) {
      throw new Error(`${key} live minter allocation is outside its permitted 30%-100% range`);
    }

    // Post-setup allocations are governance-managed through the token's 14-day queue.
    // A deployment-script rerun must not silently restore an intentionally reduced allocation.
  };

  for (const [key, minter] of allocationTargets) {
    await configureMinterAllocation(key, minter);
  }

  const minters = allocationTargets.map(([, address]) => address);
  const minterStates = await Promise.all(minters.map(x => governanceToken.isMinter(x)));
  if (minterStates.some(x => !x)) {
    await send(ctx, "configure:governanceToken.setMinters", governanceToken, "setMinters", [minters, true]);
  }

  const yieldConfig = c.cyGovYieldStaking;
  if ((await cyGovYieldStaking.targetYield()) !== BigInt(yieldConfig.initialTargetYield || "0")) {
    await send(ctx, "configure:cyGovYieldStaking.setTargetYield", cyGovYieldStaking, "setTargetYield", [BigInt(yieldConfig.initialTargetYield || "0")]);
  }
  if (Number(await cyGovYieldStaking.withdrawFeeBps()) !== yieldConfig.initialWithdrawFeeBps) {
    await send(ctx, "configure:cyGovYieldStaking.setWithdrawFeeBps", cyGovYieldStaking, "setWithdrawFeeBps", [yieldConfig.initialWithdrawFeeBps]);
  }
  if (Number(await cyGovYieldStaking.dailyDecayRate()) !== yieldConfig.initialDailyDecayRate) {
    await send(ctx, "configure:cyGovYieldStaking.setDailyDecayRate", cyGovYieldStaking, "setDailyDecayRate", [yieldConfig.initialDailyDecayRate]);
  }
  if ((await cyGovYieldStaking.maxMintRate()) !== BigInt(yieldConfig.initialMaxMintRate || "0")) {
    await send(ctx, "configure:cyGovYieldStaking.setMaxMintRate", cyGovYieldStaking, "setMaxMintRate", [BigInt(yieldConfig.initialMaxMintRate || "0")]);
  }
  const initialInventoryMint = BigInt(yieldConfig.initialInventoryMint || "0");
  if (initialInventoryMint !== 0n && (await cyGovYieldStaking.initialInventoryMinted()) < initialInventoryMint) {
    await send(ctx, "configure:cyGovYieldStaking.mintInitialInventory", cyGovYieldStaking, "mintInitialInventory", [initialInventoryMint - (await cyGovYieldStaking.initialInventoryMinted())]);
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
  const currentChainTimestamp = async () => BigInt((await ctx.provider.getBlock("latest")).timestamp);

  const configureEmissionRate = async (label, contract, targetRate) => {
    if ((await contract.governanceEmissionRate()) === targetRate) return;
    const pendingReadyAt = await contract.governanceEmissionRateReadyAt();
    const pendingRate = await contract.pendingGovernanceEmissionRate();
    if (pendingReadyAt !== 0n && pendingRate === targetRate) {
      const now = await currentChainTimestamp();
      if (now >= pendingReadyAt) {
        await send(ctx, `${label}.execute`, contract, "executeGovernanceEmissionRate", []);
      }
      return;
    }
    await send(ctx, `${label}.propose`, contract, "setGovernanceEmissionRate", [targetRate]);
  };

  const revEmission = BigInt(c.emissions.revenueStakingGovernancePerSecond || "0");
  await configureEmissionRate("configure:revenue.emission", revenueStaking, revEmission);
  const boostEmission = BigInt(c.emissions.boostStakingGovernancePerSecond || "0");
  await configureEmissionRate("configure:boost.emission", boostStaking, boostEmission);

  const configurePeriodicMint = async (label, contract, cfg) => {
    const amount = BigInt(cfg.periodicAmount || "0");
    const interval = BigInt(cfg.periodicIntervalSeconds || 0);
    if (
      (await contract.periodicGovernanceMintAmount()) === amount
        && (await contract.periodicGovernanceMintInterval()) === interval
    ) return;
    const pendingReadyAt = await contract.periodicGovernanceMintConfigReadyAt();
    const pendingAmount = await contract.pendingPeriodicGovernanceMintAmount();
    const pendingInterval = await contract.pendingPeriodicGovernanceMintInterval();
    if (pendingReadyAt !== 0n && pendingAmount === amount && pendingInterval === interval) {
      const now = await currentChainTimestamp();
      if (now >= pendingReadyAt) {
        await send(ctx, `${label}.execute`, contract, "executePeriodicGovernanceMintConfig", []);
      }
      return;
    }
    await send(ctx, `${label}.propose`, contract, "proposePeriodicGovernanceMint", [amount, interval]);
  };

  await configurePeriodicMint("configure:revenue.periodicMint", revenueStaking, minting.revenueStaking || {});
  await configurePeriodicMint("configure:boost.periodicMint", boostStaking, minting.boostStaking || {});
  await configurePeriodicMint(
    "configure:governanceMintController.periodicMint",
    governanceMintController,
    minting.governanceStaking || {}
  );
  if ((await revenueStrategy.cyGovDistributor()) === ethers.ZeroAddress) {
    await send(
      ctx,
      "configure:revenueStrategy.cyGovDistributor",
      revenueStrategy,
      "setCyGovDistributor",
      [await cyGovDistributor.getAddress()]
    );
  }
  if (!(await revenueVault.initialConfigurationSet())) {
    await send(
      ctx,
      "configure:revenueVault.initialConfiguration",
      revenueVault,
      "setInitialConfiguration",
      [await revenueStrategy.getAddress(), await cyGovDistributor.getAddress()]
    );
  }

  const rv = c.revenueVault;
  if (
    Number(await revenueStrategy.withdrawalFeeBps()) !== rv.withdrawalFeeBps
      || Number(await revenueStrategy.performanceFeeBps()) !== rv.performanceFeeBps
      || Number(await revenueStrategy.callFeeBps()) !== rv.callFeeBps
  ) {
    await send(
      ctx,
      "configure:revenueStrategy.fees",
      revenueStrategy,
      "setFees",
      [rv.withdrawalFeeBps, rv.performanceFeeBps, rv.callFeeBps]
    );
  }
  if ((await revenueStrategy.harvestOnDeposit()) !== (rv.harvestOnDeposit === true)) {
    await send(
      ctx,
      "configure:revenueStrategy.harvestOnDeposit",
      revenueStrategy,
      "setHarvestOnDeposit",
      [rv.harvestOnDeposit === true]
    );
  }

  const converterConfig = c.revenueConverter || {};
  if (ethers.getAddress(await revenueConverter.sdtSwapAdapter()) !== converterConfig.sdtSwapAdapter) {
    await send(
      ctx,
      "configure:revenueConverter.sdtSwapAdapter",
      revenueConverter,
      "setSdtSwapAdapter",
      [converterConfig.sdtSwapAdapter]
    );
  }
  const liveUsdc = ethers.getAddress(await revenueConverter.usdc());
  const liveUsdcAdapter = ethers.getAddress(await revenueConverter.usdcAdapter());
  if (liveUsdc !== converterConfig.usdc || liveUsdcAdapter !== converterConfig.usdcAdapter) {
    await send(
      ctx,
      "configure:revenueConverter.usdcRoute",
      revenueConverter,
      "setUsdcRoute",
      [converterConfig.usdc, converterConfig.usdcAdapter]
    );
  }

  for (const token of c.governanceStaking.rewardTokens || []) if (!(await governanceStaking.isRewardToken(token))) await send(ctx, `configure:governanceStaking.reward:${token}`, governanceStaking, "addRewardToken", [token]);
  for (const notifier of c.governanceStaking.notifiers || []) {
    if (!(await governanceStaking.isNotifier(notifier))) {
      await send(
        ctx,
        `configure:governanceStaking.notifier:${notifier}`,
        governanceStaking,
        "setNotifier",
        [notifier, true]
      );
    }
  }

  if (!(await governanceBoostStrategy.isProposalRegistrar(c.finalOwner))) {
    await send(
      ctx,
      "configure:governanceBoostStrategy.addFinalRegistrar",
      governanceBoostStrategy,
      "setProposalRegistrar",
      [c.finalOwner, true]
    );
  }
  if (deployer !== c.finalOwner && await governanceBoostStrategy.isProposalRegistrar(deployer)) {
    await send(
      ctx,
      "configure:governanceBoostStrategy.removeDeployerRegistrar",
      governanceBoostStrategy,
      "setProposalRegistrar",
      [deployer, false]
    );
  }

  // This is a direct call to the external vlBoost contract, not an Aragon action.
  await send(ctx, "configure:locker.setMarketplaceOperator", locker, "setMarketplaceOperator", [true]);

  ctx.state.phase = "configured";
  saveState(ctx.stateFile, ctx.state);
  console.log(`configuration complete; state=${ctx.stateFile}`);
  return ctx;
}

if (require.main === module) deployAndConfigure().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { deployAndConfigure };
