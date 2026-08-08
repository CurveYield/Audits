#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  ethers,
  makeContext,
  contract,
  assertExternalDependencies,
  assertOwner,
  writeJson,
  ROOT,
  OWNABLE_CONTRACTS
} = require("./lib-v20");

async function verifyDeployment(options = {}) {
  const ctx = await makeContext({
    configPath: options.configPath || process.argv[2],
    rpcUrl: options.rpcUrl || process.env.RPC_URL,
    privateKey: options.privateKey || process.env.DEPLOYER_PRIVATE_KEY,
    tag: options.tag || process.env.DEPLOYMENT_TAG || "live",
    confirmations: 0,
    allowWalletMismatch: true
  });

  const c = ctx.config;
  const expectedOwner = options.expectedOwner || process.env.EXPECTED_OWNER || ctx.wallet.address;
  const expectedAdmin = options.expectedAdmin || process.env.EXPECTED_ADMIN
    || (ethers.getAddress(expectedOwner) === c.finalOwner ? c.finalAdmin : ctx.wallet.address);
  const feeDistributorRewardTokens = await assertExternalDependencies(ctx.provider, c);

  for (const [key] of OWNABLE_CONTRACTS) {
    await assertOwner(contract(ctx, key), expectedOwner, key);
  }

  const governanceToken = contract(ctx, "governanceToken");
  const governanceStaking = contract(ctx, "governanceStaking");
  const governanceMintController = contract(ctx, "governanceMintController");
  const governanceBoostStrategy = contract(ctx, "governanceBoostStrategy");
  const cyvlSdt = contract(ctx, "cyvlSdt");
  const locker = contract(ctx, "locker");
  const cyGovYieldStaking = contract(ctx, "cyGovYieldStaking");
  const revenueStaking = contract(ctx, "revenueStaking");
  const boostStaking = contract(ctx, "boostStaking");
  const boostMerchant = contract(ctx, "boostMerchant");
  const revenueVault = contract(ctx, "revenueVault");
  const revenueConverter = contract(ctx, "revenueConverter");
  const revenueStrategy = contract(ctx, "revenueStrategy");
  const cyGovDistributor = contract(ctx, "cyGovDistributor");

  const eq = (actual, expected, label) => {
    if (ethers.getAddress(actual) !== ethers.getAddress(expected)) {
      throw new Error(`${label}: ${actual} != ${expected}`);
    }
  };

  eq(await governanceStaking.GOVERNANCE_TOKEN(), await governanceToken.getAddress(), "governance staking token");
  eq(await governanceStaking.treasuryReceiver(), c.finalOwner, "governance treasury");
  eq(
    await governanceStaking.governanceMintController(),
    await governanceMintController.getAddress(),
    "governance mint controller"
  );
  eq(
    await governanceMintController.governanceStaking(),
    await governanceStaking.getAddress(),
    "mint controller staking binding"
  );
  eq(
    await governanceMintController.governanceToken(),
    await governanceToken.getAddress(),
    "mint controller token binding"
  );
  eq(
    await governanceStaking.governanceBoostStrategy(),
    await governanceBoostStrategy.getAddress(),
    "active governance boost strategy"
  );
  eq(
    await governanceBoostStrategy.governanceStaking(),
    await governanceStaking.getAddress(),
    "strategy staking binding"
  );
  eq(
    await governanceBoostStrategy.previousStrategy(),
    c.governanceBoostStrategy.previousStrategy,
    "strategy previous-strategy binding"
  );

  if (Number(await governanceStaking.standardWithdrawFeeBps()) !== c.governanceStaking.initialStandardWithdrawFeeBps) {
    throw new Error("governance standard withdrawal fee mismatch");
  }
  if (Number(await governanceStaking.baseWithdrawFeeBps()) !== c.governanceStaking.initialBaseWithdrawFeeBps) {
    throw new Error("governance base withdrawal fee mismatch");
  }
  if (Number(await governanceStaking.withdrawalDelay()) !== c.governanceStaking.initialWithdrawalDelaySeconds) {
    throw new Error("governance withdrawal delay mismatch");
  }
  if (c.governanceStaking.aragonVotingPlugin !== ethers.ZeroAddress) {
    eq(
      await governanceBoostStrategy.aragonVotingPlugin(),
      c.governanceStaking.aragonVotingPlugin,
      "Aragon voting plugin"
    );
  }

  eq(await locker.treasuryReceiver(), c.finalOwner, "locker treasury");
  eq(await revenueStaking.treasuryReceiver(), c.finalOwner, "revenue treasury");
  eq(await revenueStaking.admin(), expectedAdmin, "revenue admin");
  if (Number(await revenueStaking.immediateWithdrawFeeBps()) !== c.revenueStakingConfig.immediateWithdrawFeeBps) {
    throw new Error("revenue staking immediate withdrawal fee mismatch");
  }
  if (
    (await revenueStaking.EXCESS_TREASURY_BPS()) !== 3300n
      || (await revenueStaking.EXCESS_ADMIN_BPS()) !== 700n
  ) {
    throw new Error("revenue staking benchmark fee split mismatch");
  }
  eq(await cyGovYieldStaking.CYVLSDT(), await cyvlSdt.getAddress(), "cyGOV Yield Staking asset");
  eq(
    await cyGovYieldStaking.GOVERNANCE_TOKEN(),
    await governanceToken.getAddress(),
    "cyGOV Yield Staking reward token"
  );
  eq(await cyGovYieldStaking.treasuryReceiver(), c.feeReceivers.treasury, "cyGOV Yield Staking treasury");
  if ((await cyGovYieldStaking.targetYield()) !== BigInt(c.cyGovYieldStaking.initialTargetYield || "0")) {
    throw new Error("cyGOV Yield Staking target yield mismatch");
  }
  if ((await cyGovYieldStaking.maxMintRate()) !== BigInt(c.cyGovYieldStaking.initialMaxMintRate || "0")) {
    throw new Error("cyGOV Yield Staking max mint rate mismatch");
  }
  if (Number(await cyGovYieldStaking.withdrawFeeBps()) !== c.cyGovYieldStaking.initialWithdrawFeeBps) {
    throw new Error("cyGOV Yield Staking withdrawal fee mismatch");
  }
  if (Number(await cyGovYieldStaking.dailyDecayRate()) !== c.cyGovYieldStaking.initialDailyDecayRate) {
    throw new Error("cyGOV Yield Staking daily decay mismatch");
  }
  if ((await cyGovYieldStaking.initialInventoryMinted()) < BigInt(c.cyGovYieldStaking.initialInventoryMint || "0")) {
    throw new Error("cyGOV Yield Staking initial inventory mint mismatch");
  }
  const requiredYieldReserve = await cyGovYieldStaking.requiredMintReserve();
  const lockedYieldReserve = await cyGovYieldStaking.lockedMintReserve();
  if (lockedYieldReserve < requiredYieldReserve) {
    throw new Error("cyGOV Yield Staking max mint rate is not fully backed");
  }
  const yieldReservationId = await cyGovYieldStaking.mintReservationId();
  if (lockedYieldReserve !== 0n) {
    if (yieldReservationId === 0n) throw new Error("cyGOV Yield Staking locked reserve has no reservation");
    if (!(await governanceToken.protectedMintReservation(yieldReservationId))) {
      throw new Error("cyGOV Yield Staking max-rate reservation is not protected");
    }
  }
  eq(await locker.admin(), expectedAdmin, "locker admin source");
  if (Number(await locker.ADMIN_BOOST_BPS()) !== 500) throw new Error("admin boost cap is not fixed at 5%");
  eq(await cyvlSdt.locker(), await locker.getAddress(), "cyvl locker");
  eq(await locker.revenueStaking(), await revenueStaking.getAddress(), "locker revenue staking");
  eq(await locker.boostStaking(), await boostStaking.getAddress(), "locker boost staking");
  eq(await locker.boostMerchant(), await boostMerchant.getAddress(), "locker merchant");
  eq(await locker.STAKE_DAO_ROUTER(), c.stakeDao.router, "locker Stake DAO Router");
  eq(
    await locker.VLSDT_FEE_DISTRIBUTOR_USDC(),
    c.stakeDao.vlSdtFeeDistributorUsdc,
    "locker USDC vlSDT FeeDistributor"
  );
  eq(
    await locker.VLSDT_FEE_DISTRIBUTOR_SDT(),
    c.stakeDao.vlSdtFeeDistributorSdt,
    "locker SDT vlSDT FeeDistributor"
  );
  eq(
    await locker.USDC_REWARD_TOKEN(),
    feeDistributorRewardTokens.usdc,
    "locker USDC reward token"
  );

  eq(await revenueVault.strategy(), await revenueStrategy.getAddress(), "revenue vault strategy");
  eq(await revenueVault.CYGOV_DISTRIBUTOR(), await cyGovDistributor.getAddress(), "revenue vault cyGOV distributor");
  eq(await revenueStrategy.vault(), await revenueVault.getAddress(), "revenue strategy vault");
  eq(await revenueStrategy.want(), await cyvlSdt.getAddress(), "revenue strategy want");
  eq(await revenueStrategy.CONVERTER(), await revenueConverter.getAddress(), "revenue strategy converter");
  eq(await revenueStrategy.cyGovDistributor(), await cyGovDistributor.getAddress(), "strategy cyGOV distributor");
  if (await revenueStrategy.retired()) throw new Error("deployed revenue strategy is already retired");
  eq(await cyGovDistributor.vault(), await revenueVault.getAddress(), "cyGOV distributor vault");
  eq(await revenueConverter.outputToken(), await cyvlSdt.getAddress(), "converter output token");
  if (!(await revenueConverter.supportsToken(c.stakeDao.sdt))) {
    throw new Error("initial converter does not support SDT");
  }
  eq(await revenueConverter.sdtSwapAdapter(), c.revenueConverter.sdtSwapAdapter, "SDT swap adapter");
  eq(await revenueConverter.usdc(), c.revenueConverter.usdc, "USDC route token");
  eq(await revenueConverter.usdcAdapter(), c.revenueConverter.usdcAdapter, "USDC route adapter");
  if (c.revenueConverter.usdc !== ethers.ZeroAddress && !(await revenueConverter.supportsToken(c.revenueConverter.usdc))) {
    throw new Error("configured converter does not support USDC");
  }
  if (Number(await revenueVault.approvalDelay()) !== c.revenueVault.strategyApprovalDelaySeconds) {
    throw new Error("revenue vault strategy approval delay mismatch");
  }
  if ((await revenueStrategy.harvestOnDeposit()) !== (c.revenueVault.harvestOnDeposit === true)) {
    throw new Error("revenue strategy harvest-on-deposit setting mismatch");
  }
  if (
    Number(await revenueStrategy.withdrawalFeeBps()) !== c.revenueVault.withdrawalFeeBps
      || Number(await revenueStrategy.performanceFeeBps()) !== c.revenueVault.performanceFeeBps
      || Number(await revenueStrategy.callFeeBps()) !== c.revenueVault.callFeeBps
  ) {
    throw new Error("revenue strategy fee configuration mismatch");
  }
  eq(await revenueStrategy.treasuryReceiver(), c.feeReceivers.treasury, "revenue strategy treasury");
  if ((await revenueStrategy.MAX_WITHDRAW_FEE_BPS()) !== 100n) {
    throw new Error("revenue strategy withdrawal fee cap is not 1%");
  }
  if ((await revenueStrategy.MAX_PERFORMANCE_FEE_BPS()) !== 900n) {
    throw new Error("revenue strategy performance fee cap is not 9%");
  }

  for (const rewardToken of feeDistributorRewardTokens.all) {
    if (!(await revenueStaking.isRewardToken(rewardToken))) {
      throw new Error(`fee distributor reward token not registered: ${rewardToken}`);
    }
  }
  if (
    !(await revenueStaking.isNotifier(await locker.getAddress()))
      || !(await revenueStaking.isNotifier(await boostMerchant.getAddress()))
  ) {
    throw new Error("revenue notifiers incomplete");
  }
  const expectedInitialUnlock = 200_000_000_000n * 10n ** 18n;
  if ((await governanceToken.INITIAL_UNLOCK()) !== expectedInitialUnlock) {
    throw new Error("governance initial mint unlock mismatch");
  }
  const expectedMonthlyAllotments = [
    [1n, 20_000_000_000n * 10n ** 18n],
    [21n, 10_000_000_000n * 10n ** 18n],
    [22n, 9_800_000_000n * 10n ** 18n],
    [51n, 4_000_000_000n * 10n ** 18n],
    [52n, 4_000_000_000n * 10n ** 18n]
  ];
  for (const [month, expected] of expectedMonthlyAllotments) {
    if ((await governanceToken.monthlyMintAllotment(month)) !== expected) {
      throw new Error(`governance monthly mint allotment mismatch at month ${month}`);
    }
  }

  if ((await governanceToken.MIN_ALLOCATION_BPS()) !== 3000n) {
    throw new Error("minimum allocation percentage mismatch");
  }
  if ((await governanceToken.MINTER_ALLOCATION_DELAY()) !== 14n * 24n * 60n * 60n) {
    throw new Error("minter allocation delay mismatch");
  }

  const allocationTargets = [
    ["revenueStaking", await revenueStaking.getAddress()],
    ["boostStaking", await boostStaking.getAddress()],
    ["cyGovYieldStaking", await cyGovYieldStaking.getAddress()],
    ["governanceStaking", await governanceMintController.getAddress()]
  ];
  let liveInitialTotal = 0n;
  let liveAdditionalBpsTotal = 0n;
  let originalInitialTotal = 0n;
  let originalAdditionalBpsTotal = 0n;
  for (const [key, minter] of allocationTargets) {
    const expected = c.governanceMinting.allocations[key];
    const expectedInitial = BigInt(expected.initialCap);
    const expectedAdditionalBps = BigInt(expected.additionalBps);
    if (!(await governanceToken.originalMinterAllocationConfigured(minter))) {
      throw new Error(`original governance minter allocation missing for ${key}`);
    }

    const original = await governanceToken.originalMinterAllocation(minter);
    if (
      original.initialCap !== expectedInitial
        || original.additionalBps !== expectedAdditionalBps
    ) {
      throw new Error(`original governance minter allocation mismatch for ${key}`);
    }

    const minimum = await governanceToken.minimumMinterAllocation(minter);
    const expectedMinimumInitial = (expectedInitial * 3000n + 9999n) / 10000n;
    const expectedMinimumAdditionalBps = (expectedAdditionalBps * 3000n + 9999n) / 10000n;
    if (
      minimum.minimumInitialCap !== expectedMinimumInitial
        || minimum.minimumAdditionalBps !== expectedMinimumAdditionalBps
    ) {
      throw new Error(`minimum governance minter allocation mismatch for ${key}`);
    }

    const actual = await governanceToken.minterAllocation(minter);
    if (
      actual.initialCap < minimum.minimumInitialCap
        || actual.initialCap > original.initialCap
        || actual.additionalBps < minimum.minimumAdditionalBps
        || actual.additionalBps > original.additionalBps
    ) {
      throw new Error(`live governance minter allocation outside permitted range for ${key}`);
    }

    const used = (await governanceToken.mintedByMinter(minter))
      + (await governanceToken.reservedByMinter(minter));
    const allowance = await governanceToken.minterMintAllowance(minter);
    if (used > allowance) {
      throw new Error(`live governance minter allocation undercollateralizes usage for ${key}`);
    }

    liveInitialTotal += actual.initialCap;
    liveAdditionalBpsTotal += actual.additionalBps;
    originalInitialTotal += original.initialCap;
    originalAdditionalBpsTotal += original.additionalBps;
  }
  if ((await governanceToken.totalInitialMinterCaps()) !== liveInitialTotal) {
    throw new Error("aggregate live initial minter cap mismatch");
  }
  if ((await governanceToken.totalAdditionalMinterBps()) !== liveAdditionalBpsTotal) {
    throw new Error("aggregate live additional minter percentage mismatch");
  }
  if (
    originalInitialTotal !== 50_000_000_000n * 10n ** 18n
      || originalAdditionalBpsTotal !== 8000n
  ) {
    throw new Error("aggregate original minter allocation mismatch");
  }

  if (
    !(await governanceToken.isMinter(await revenueStaking.getAddress()))
      || !(await governanceToken.isMinter(await boostStaking.getAddress()))
      || !(await governanceToken.isMinter(await cyGovYieldStaking.getAddress()))
      || !(await governanceToken.isMinter(await governanceMintController.getAddress()))
  ) {
    throw new Error("governance minters incomplete");
  }
  if (!(await governanceStaking.isRewardToken(await governanceToken.getAddress()))) {
    throw new Error("governance token is not registered as a Governance Staking participation reward");
  }
  if (!(await governanceBoostStrategy.isProposalRegistrar(c.finalOwner))) {
    throw new Error("final owner is not proposal registrar");
  }
  if (
    ctx.wallet.address.toLowerCase() !== c.finalOwner.toLowerCase()
      && await governanceBoostStrategy.isProposalRegistrar(ctx.wallet.address)
  ) {
    throw new Error("deployer retains proposal registrar role");
  }

  const report = {
    version: 18,
    release: c.release || "20",
    chainId: String((await ctx.provider.getNetwork()).chainId),
    expectedOwner,
    deployer: ctx.wallet.address,
    finalOwner: c.finalOwner,
    finalAdmin: c.finalAdmin,
    expectedAdmin,
    feeDistributorRewardTokens,
    contracts: ctx.state.contracts,
    gasUsed: ctx.state.gasUsed,
    verifiedAt: new Date().toISOString()
  };
  const output = path.join(
    ROOT,
    "deployment-output-v20",
    `verification-v20-${options.tag || process.env.DEPLOYMENT_TAG || "live"}.json`
  );
  writeJson(output, report);
  console.log(`verification passed; report=${output}`);
  return { ctx, report };
}

if (require.main === module) {
  verifyDeployment().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { verifyDeployment };
