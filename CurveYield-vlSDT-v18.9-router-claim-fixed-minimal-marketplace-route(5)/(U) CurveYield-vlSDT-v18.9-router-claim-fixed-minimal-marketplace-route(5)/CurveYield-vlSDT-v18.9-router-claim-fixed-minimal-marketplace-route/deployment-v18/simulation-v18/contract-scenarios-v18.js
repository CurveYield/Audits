"use strict";

const {
  ethers,
  contract
} = require("../lib-v18");
const {
  createEphemeralActors,
  fundErc20FromRealHolder,
  withImpersonatedSigner
} = require("./actors-v18");

const LIFECYCLE_COMPONENTS = [
  "governanceStaking",
  "cyGovYieldStaking",
  "revenueStaking",
  "boostStaking",
  "revenueVault"
];

const ERC20_INTERFACE = new ethers.Interface([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
]);

async function pendingNonce(provider, address) {
  const value = await provider.send("eth_getTransactionCount", [address, "pending"]);
  return Number(value);
}

async function sendContract(provider, target, signer, signature, args = []) {
  try {
    const method = target.connect(signer).getFunction(signature);
    const populated = await method.populateTransaction(...args);
    const from = await signer.getAddress();
    const estimate = await provider.estimateGas({ ...populated, from });
    const tx = await signer.sendTransaction({
      ...populated,
      gasLimit: estimate * 12n / 10n + 25_000n,
      nonce: await pendingNonce(provider, from)
    });
    return tx.wait();
  } catch (error) {
    if (error) error.simulationContractInterface = target.interface;
    throw error;
  }
}

async function coveredTransaction({
  executor,
  id,
  target,
  signer,
  signature,
  args = [],
  scenario
}) {
  const record = await executor.execute({
    id,
    expected: "success",
    contractInterface: target.interface,
    caller: await signer.getAddress(),
    args,
    scenario,
    operation: async () => {
      const method = target.connect(signer).getFunction(signature);
      const populated = await method.populateTransaction(...args);
      const from = await signer.getAddress();
      const estimate = await target.runner.provider.estimateGas({ ...populated, from });
      return signer.sendTransaction({
        ...populated,
        gasLimit: estimate * 12n / 10n + 25_000n,
        nonce: await pendingNonce(target.runner.provider, from)
      });
    }
  });
  if (record.status !== "passed-success") {
    throw new Error(`${scenario} failed for ${id}: ${record.error && (record.error.decoded || record.error.message)}`);
  }
  return record;
}

async function approve(provider, token, signer, spender, amount = ethers.MaxUint256) {
  return sendContract(provider, token, signer, "approve(address,uint256)", [spender, amount]);
}

function actorNames() {
  const names = ["probe", "rewardFunder", "governanceBootstrap", "revenueBootstrap"];
  for (const component of LIFECYCLE_COMPONENTS) {
    names.push(`${component}User`, `${component}Receiver`);
  }
  return names;
}

function governanceBootstrapPrincipal(minimumRewardEligibleBalance) {
  const minimum = BigInt(minimumRewardEligibleBalance);
  if (minimum <= 0n) throw new Error("invalid governance reward-eligibility floor");
  return minimum;
}

function missingRewardRegistrations(governanceRegistered, revenueRegistered) {
  const missing = [];
  if (!governanceRegistered) missing.push("governanceStaking");
  if (!revenueRegistered) missing.push("revenueStaking");
  return missing;
}

async function withSimulationStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error && !error.simulationStage) error.simulationStage = stage;
    throw error;
  }
}

async function mintFromAuthorizedAddress({
  provider,
  token,
  authorizedAddress,
  recipients
}) {
  return withImpersonatedSigner(provider, authorizedAddress, async signer => {
    const receipts = [];
    for (const [recipient, amount] of recipients) {
      receipts.push(await sendContract(provider, token, signer, "mint(address,uint256)", [
        recipient,
        amount
      ]));
    }
    return receipts;
  });
}

async function prepareYieldEnvironment({ ctx, executor }) {
  const provider = ctx.provider;
  const actors = await createEphemeralActors(provider, actorNames());
  const contracts = {};
  for (const key of [
    "governanceToken",
    "governanceStaking",
    "governanceMintController",
    "cyvlSdt",
    "locker",
    "cyGovYieldStaking",
    "revenueStaking",
    "boostStaking",
    "revenueVault",
    "revenueStrategy"
  ]) contracts[key] = contract(ctx, key);

  const cyclePrincipal = ethers.parseEther("10");
  const bootstrapPrincipal = governanceBootstrapPrincipal(
    await contracts.governanceStaking.MIN_REWARD_ELIGIBLE_BALANCE()
  );
  const governanceRecipients = [
    [actors.governanceStakingUser.address, cyclePrincipal * 2n],
    [actors.governanceBootstrap.address, bootstrapPrincipal]
  ];
  await withSimulationStage("setup:mint-governance", async () => mintFromAuthorizedAddress({
    provider,
    token: contracts.governanceToken,
    authorizedAddress: await contracts.governanceMintController.getAddress(),
    recipients: governanceRecipients
  }));

  const cyvlRecipients = [
    [actors.cyGovYieldStakingUser.address, cyclePrincipal * 2n],
    [actors.revenueStakingUser.address, cyclePrincipal * 2n],
    [actors.boostStakingUser.address, cyclePrincipal * 2n],
    [actors.revenueVaultUser.address, cyclePrincipal * 2n],
    [actors.revenueBootstrap.address, bootstrapPrincipal]
  ];
  await withSimulationStage("setup:mint-cyvlSDT", async () => mintFromAuthorizedAddress({
    provider,
    token: contracts.cyvlSdt,
    authorizedAddress: await contracts.locker.getAddress(),
    recipients: cyvlRecipients
  }));

  const sdtAddress = ctx.config.stakeDao.sdt;
  const rewardFunding = ethers.parseEther("2000");
  const funding = await withSimulationStage("setup:fund-real-SDT", () => fundErc20FromRealHolder({
    provider,
    tokenAddress: sdtAddress,
    recipient: actors.rewardFunder.address,
    amount: rewardFunding,
    candidates: [
      ctx.config.finalOwner,
      ctx.config.feeReceivers.treasury,
      ctx.config.stakeDao.vlSdtFeeDistributorSdt,
      ctx.config.stakeDao.vlSdt,
      ctx.config.stakeDao.boostMarketplace
    ]
  }));

  const governanceToken = contracts.governanceToken;
  const cyvlSdt = contracts.cyvlSdt;
  await withSimulationStage("setup:bootstrap-governance-stake", async () => {
    await approve(
      provider,
      governanceToken,
      actors.governanceBootstrap,
      await contracts.governanceStaking.getAddress()
    );
    await sendContract(
      provider,
      contracts.governanceStaking,
      actors.governanceBootstrap,
      "stake(uint256)",
      [bootstrapPrincipal]
    );
  });
  await withSimulationStage("setup:bootstrap-revenue-stake", async () => {
    await approve(
      provider,
      cyvlSdt,
      actors.revenueBootstrap,
      await contracts.revenueStaking.getAddress()
    );
    await sendContract(
      provider,
      contracts.revenueStaking,
      actors.revenueBootstrap,
      "stake(uint256)",
      [bootstrapPrincipal]
    );
  });

  const sdt = new ethers.Contract(sdtAddress, ERC20_INTERFACE, provider);
  await withSimulationStage("setup:configure-reward-streams", async () => {
    const missing = missingRewardRegistrations(
      await contracts.governanceStaking.isRewardToken(sdtAddress),
      await contracts.revenueStaking.isRewardToken(sdtAddress)
    );
    for (const key of missing) {
      await sendContract(
        provider,
        contracts[key],
        ctx.wallet,
        "addRewardToken(address)",
        [sdtAddress]
      );
    }
    await sendContract(
      provider,
      contracts.governanceStaking,
      ctx.wallet,
      "setNotifier(address,bool)",
      [actors.rewardFunder.address, true]
    );
    await sendContract(
      provider,
      contracts.revenueStaking,
      ctx.wallet,
      "setNotifier(address,bool)",
      [actors.rewardFunder.address, true]
    );
  });

  await withSimulationStage("setup:configure-yield-rates", async () => {
    await sendContract(
      provider,
      contracts.cyGovYieldStaking,
      ctx.wallet,
      "setTargetYield(uint256)",
      [ethers.parseUnits("0.01", 18)]
    );
    await sendContract(
      provider,
      contracts.cyGovYieldStaking,
      ctx.wallet,
      "setMaxMintRate(uint256)",
      [ethers.parseEther("10")]
    );
    await sendContract(
      provider,
      contracts.boostStaking,
      ctx.wallet,
      "setGovernanceEmissionRate(uint256)",
      [1_000_000_000_000n]
    );
  });

  await withSimulationStage("setup:approve-SDT-rewards", async () => {
    await approve(
      provider,
      sdt,
      actors.rewardFunder,
      await contracts.governanceStaking.getAddress()
    );
    await approve(
      provider,
      sdt,
      actors.rewardFunder,
      await contracts.revenueStaking.getAddress()
    );
  });

  return {
    ctx,
    executor,
    provider,
    actors,
    contracts,
    sdt,
    sdtAddress,
    cyclePrincipal,
    bootstrapPrincipal,
    funding
  };
}

async function advanceOneDay(provider) {
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  await provider.send("evm_setNextBlockTimestamp", [
    Number(BigInt(block.timestamp)) + 24 * 60 * 60
  ]);
  await provider.send("evm_mine", []);
}

async function seedCycleRewards(env, cycleLabel) {
  const {
    provider,
    actors,
    contracts,
    sdtAddress
  } = env;
  const governanceReward = ethers.parseEther("200");
  const revenueReward = ethers.parseEther("500");
  await withSimulationStage(`${cycleLabel}:seed-governance-reward`, () => sendContract(
    provider,
    contracts.governanceStaking,
    actors.rewardFunder,
    "notifyReward(address,uint256)",
    [sdtAddress, governanceReward]
  ));
  const active = await contracts.revenueStaking.totalActiveStake();
  const baseRewardPerVlSdt = revenueReward * ethers.parseEther("1") / active;
  await withSimulationStage(`${cycleLabel}:seed-revenue-reward`, () => sendContract(
    provider,
    contracts.revenueStaking,
    actors.rewardFunder,
    "notifyReward(address,uint256,uint256)",
    [sdtAddress, revenueReward, baseRewardPerVlSdt]
  ));
  await withSimulationStage(`${cycleLabel}:advance-reward-batch-day`, () => advanceOneDay(provider));
  await withSimulationStage(`${cycleLabel}:start-governance-reward-cycle`, () => sendContract(
    provider,
    contracts.governanceStaking,
    ctxSigner(env),
    "startRewardCycle(address,bool)",
    [sdtAddress, false]
  ));
  await withSimulationStage(`${cycleLabel}:start-revenue-reward-cycle`, () => sendContract(
    provider,
    contracts.revenueStaking,
    ctxSigner(env),
    "startRewardCycle(address)",
    [sdtAddress]
  ));
  return {
    cycleLabel,
    governanceReward: governanceReward.toString(),
    revenueReward: revenueReward.toString(),
    startedAt: Number(BigInt(
      (await provider.send("eth_getBlockByNumber", ["latest", false])).timestamp
    ))
  };
}

function ctxSigner(env) {
  return env.ctx.wallet;
}

function baseMeasurement(principal, rewards, pps, extra = {}, principalAsset = null) {
  const measurement = {
    principal: principal.toString(),
    pps: pps === null ? null : pps.toString(),
    ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : value
    ]))
  };
  if (principalAsset !== null) measurement.principalAsset = principalAsset;
  if (typeof rewards === "object" && rewards !== null) {
    measurement.rewardBalances = Object.fromEntries(
      Object.entries(rewards).map(([asset, value]) => [asset, value.toString()])
    );
  } else {
    measurement.rewards = rewards.toString();
  }
  return measurement;
}

function createYieldAdapters(env, cycleLabel) {
  const {
    provider,
    executor,
    actors,
    contracts,
    sdt,
    cyclePrincipal
  } = env;
  const adapters = [];

  {
    const user = actors.governanceStakingUser;
    const receiver = actors.governanceStakingReceiver;
    adapters.push({
      name: "governanceStaking",
      async measure() {
        return baseMeasurement(
          await contracts.governanceToken.balanceOf(user.address),
          { SDT: await sdt.balanceOf(receiver.address) },
          null,
          {
            staked: await contracts.governanceStaking.balanceOf(user.address),
            earned: await contracts.governanceStaking.earned(user.address, env.sdtAddress)
          },
          "GOV"
        );
      },
      async deposit() {
        await approve(provider, contracts.governanceToken, user, await contracts.governanceStaking.getAddress());
        return coveredTransaction({
          executor,
          id: "governanceStaking:stake(uint256)",
          target: contracts.governanceStaking,
          signer: user,
          signature: "stake(uint256)",
          args: [cyclePrincipal],
          scenario: `${cycleLabel}:deposit`
        });
      },
      async harvest() {
        return coveredTransaction({
          executor,
          id: "governanceStaking:claimRewards(address)",
          target: contracts.governanceStaking,
          signer: user,
          signature: "claimRewards(address)",
          args: [receiver.address],
          scenario: `${cycleLabel}:harvest`
        });
      },
      async withdraw() {
        const amount = await contracts.governanceStaking.balanceOf(user.address);
        return coveredTransaction({
          executor,
          id: "governanceStaking:withdrawImmediately(uint256,address)",
          target: contracts.governanceStaking,
          signer: user,
          signature: "withdrawImmediately(uint256,address)",
          args: [amount, user.address],
          scenario: `${cycleLabel}:withdraw`
        });
      }
    });
  }

  {
    const user = actors.cyGovYieldStakingUser;
    const receiver = actors.cyGovYieldStakingReceiver;
    adapters.push({
      name: "cyGovYieldStaking",
      async measure() {
        return baseMeasurement(
          await contracts.cyvlSdt.balanceOf(user.address),
          { GOV: await contracts.governanceToken.balanceOf(receiver.address) },
          null,
          {
            staked: await contracts.cyGovYieldStaking.balanceOf(user.address),
            earned: await contracts.cyGovYieldStaking.earned(user.address)
          },
          "cyvlSDT"
        );
      },
      async deposit() {
        await approve(provider, contracts.cyvlSdt, user, await contracts.cyGovYieldStaking.getAddress());
        return coveredTransaction({
          executor,
          id: "cyGovYieldStaking:stake(uint256)",
          target: contracts.cyGovYieldStaking,
          signer: user,
          signature: "stake(uint256)",
          args: [cyclePrincipal],
          scenario: `${cycleLabel}:deposit`
        });
      },
      async harvest() {
        return coveredTransaction({
          executor,
          id: "cyGovYieldStaking:claim(address)",
          target: contracts.cyGovYieldStaking,
          signer: user,
          signature: "claim(address)",
          args: [receiver.address],
          scenario: `${cycleLabel}:harvest`
        });
      },
      async withdraw() {
        return coveredTransaction({
          executor,
          id: "cyGovYieldStaking:withdrawAll(address)",
          target: contracts.cyGovYieldStaking,
          signer: user,
          signature: "withdrawAll(address)",
          args: [user.address],
          scenario: `${cycleLabel}:withdraw`
        });
      }
    });
  }

  {
    const user = actors.revenueStakingUser;
    const receiver = actors.revenueStakingReceiver;
    adapters.push({
      name: "revenueStaking",
      async measure() {
        return baseMeasurement(
          await contracts.cyvlSdt.balanceOf(user.address),
          {
            SDT: await sdt.balanceOf(receiver.address),
            GOV: await contracts.governanceToken.balanceOf(receiver.address)
          },
          null,
          {
            staked: await contracts.revenueStaking.activeBalance(user.address),
            earned: await contracts.revenueStaking.earned(user.address, env.sdtAddress)
          },
          "cyvlSDT"
        );
      },
      async deposit() {
        await approve(provider, contracts.cyvlSdt, user, await contracts.revenueStaking.getAddress());
        return coveredTransaction({
          executor,
          id: "revenueStaking:stake(uint256)",
          target: contracts.revenueStaking,
          signer: user,
          signature: "stake(uint256)",
          args: [cyclePrincipal],
          scenario: `${cycleLabel}:deposit`
        });
      },
      async harvest() {
        const ordinary = await coveredTransaction({
          executor,
          id: "revenueStaking:claimRewards(address)",
          target: contracts.revenueStaking,
          signer: user,
          signature: "claimRewards(address)",
          args: [receiver.address],
          scenario: `${cycleLabel}:harvest`
        });
        const governance = await coveredTransaction({
          executor,
          id: "revenueStaking:claimGovernance(address)",
          target: contracts.revenueStaking,
          signer: user,
          signature: "claimGovernance(address)",
          args: [receiver.address],
          scenario: `${cycleLabel}:harvest-governance`
        });
        return { ordinary, governance };
      },
      async withdraw() {
        const amount = await contracts.revenueStaking.activeBalance(user.address);
        return coveredTransaction({
          executor,
          id: "revenueStaking:withdrawImmediate(uint256,address)",
          target: contracts.revenueStaking,
          signer: user,
          signature: "withdrawImmediate(uint256,address)",
          args: [amount, user.address],
          scenario: `${cycleLabel}:withdraw`
        });
      }
    });
  }

  {
    const user = actors.boostStakingUser;
    const receiver = actors.boostStakingReceiver;
    adapters.push({
      name: "boostStaking",
      async measure() {
        return baseMeasurement(
          await contracts.cyvlSdt.balanceOf(user.address),
          { GOV: await contracts.governanceToken.balanceOf(receiver.address) },
          null,
          {
            staked: await contracts.boostStaking.depositedBalance(user.address),
            earned: await contracts.boostStaking.earnedGovernance(user.address)
          },
          "cyvlSDT"
        );
      },
      async deposit() {
        await approve(provider, contracts.cyvlSdt, user, await contracts.boostStaking.getAddress());
        return coveredTransaction({
          executor,
          id: "boostStaking:deposit(uint256)",
          target: contracts.boostStaking,
          signer: user,
          signature: "deposit(uint256)",
          args: [cyclePrincipal],
          scenario: `${cycleLabel}:deposit`
        });
      },
      async harvest() {
        return coveredTransaction({
          executor,
          id: "boostStaking:claimGovernance(address)",
          target: contracts.boostStaking,
          signer: user,
          signature: "claimGovernance(address)",
          args: [receiver.address],
          scenario: `${cycleLabel}:harvest`
        });
      },
      async withdraw() {
        const amount = await contracts.boostStaking.depositedBalance(user.address);
        return coveredTransaction({
          executor,
          id: "boostStaking:withdraw(uint256,address)",
          target: contracts.boostStaking,
          signer: user,
          signature: "withdraw(uint256,address)",
          args: [amount, user.address],
          scenario: `${cycleLabel}:withdraw`
        });
      }
    });
  }

  {
    const user = actors.revenueVaultUser;
    adapters.push({
      name: "revenueVault",
      async measure() {
        return baseMeasurement(
          await contracts.cyvlSdt.balanceOf(user.address),
          {},
          await contracts.revenueVault.getPricePerFullShare(),
          {
            shares: await contracts.revenueVault.balanceOf(user.address),
            economicBalance: await contracts.revenueVault.economicBalance(),
            realizedBalance: await contracts.revenueVault.balance()
          },
          "cyvlSDT"
        );
      },
      async deposit() {
        await approve(provider, contracts.cyvlSdt, user, await contracts.revenueVault.getAddress());
        return coveredTransaction({
          executor,
          id: "revenueVault:deposit(uint256)",
          target: contracts.revenueVault,
          signer: user,
          signature: "deposit(uint256)",
          args: [cyclePrincipal],
          scenario: `${cycleLabel}:deposit`
        });
      },
      async harvest() {
        return coveredTransaction({
          executor,
          id: "revenueStrategy:harvest(address)",
          target: contracts.revenueStrategy,
          signer: user,
          signature: "harvest(address)",
          args: [user.address],
          scenario: `${cycleLabel}:harvest`
        });
      },
      async withdraw() {
        return coveredTransaction({
          executor,
          id: "revenueVault:withdrawAll()",
          target: contracts.revenueVault,
          signer: user,
          signature: "withdrawAll()",
          args: [],
          scenario: `${cycleLabel}:withdraw`
        });
      }
    });
  }

  return adapters;
}

module.exports = {
  LIFECYCLE_COMPONENTS,
  governanceBootstrapPrincipal,
  missingRewardRegistrations,
  withSimulationStage,
  pendingNonce,
  sendContract,
  coveredTransaction,
  prepareYieldEnvironment,
  seedCycleRewards,
  createYieldAdapters
};
