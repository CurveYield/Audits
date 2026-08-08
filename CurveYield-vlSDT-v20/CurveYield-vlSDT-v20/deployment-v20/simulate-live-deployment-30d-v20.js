#!/usr/bin/env node
"use strict";

/**
 * CurveYield vlSDT V20 — live-connected 30-day deployment simulation
 *
 * PURPOSE
 * -------
 * This script performs one coherent deployment lifecycle on an Ethereum-mainnet
 * Anvil fork. It deliberately does NOT run the old ABI-probe/random-action
 * simulation and does NOT mint cyvlSDT by impersonating the Locker.
 *
 * The simulation:
 *   1. forks Ethereum mainnet at one fixed block;
 *   2. deploys and configures the complete V20 system through the canonical
 *      deploy-configure-v20.js path;
 *   3. verifies all live Stake DAO integrations and all internal wiring;
 *   4. sources real SDT from an actual mainnet holder on the fork;
 *   5. directly stakes 1,000 SDT into the live Stake DAO vlSDT contract;
 *   6. deposits 4 x 1,000 SDT through the newly deployed Locker, producing
 *      real cyvlSDT backed 1:1 by live vlSDT;
 *   7. stakes/deposits 1,000 principal into every CurveYield staking/vault path;
 *   8. completes the ownership/admin handoff to the configured final owner;
 *   9. advances exactly 30 days while running a documented weekly Locker keeper;
 *  10. harvests every reward path and records exact token balance deltas;
 *  11. withdraws every position and proves the resulting principal balances;
 *  12. writes a detailed JSON report and fails if required proofs are absent.
 *
 * IMPORTANT LIMITATION OF A STATIC FORK
 * -------------------------------------
 * Advancing Anvil time does not replay future mainnet transactions. Therefore,
 * the live Stake DAO Fee Distributor can only pay rewards already represented in
 * its forked state. This script never fabricates those rewards. A zero live reward
 * is reported as a failed reward proof, not disguised with synthetic SDT deposits.
 *
 * CURRENT CONFIGURATION BLOCKERS ARE INTENTIONAL FAILURES
 * ------------------------------------------------------
 * config-mainnet-v20.json currently contains zero governance emission/yield rates
 * and no USDC converter route. The script reports those exact blockers. It does
 * not silently override production economics with arbitrary test rates.
 *
 * REQUIRED ENVIRONMENT
 * --------------------
 *   ETHEREUM_RPC_URL=<mainnet RPC URL>
 *
 * OPTIONAL ENVIRONMENT
 * --------------------
 *   ANVIL_PATH=anvil
 *   ANVIL_PORT=8545
 *   ANVIL_FORK_BLOCK=<fixed block number>
 *   REQUIRE_NONZERO_REWARDS=true|false   (default: true)
 *
 * RUN COMMAND (only after review):
 *   node deployment-v20/simulate-live-deployment-30d-v20.js config-mainnet-v20.json
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const {
  ROOT,
  OWNABLE_CONTRACTS,
  ethers,
  loadConfig,
  statePath,
  saveState,
  contract,
  writeJson
} = require("./lib-v20");
const { deployAndConfigure } = require("./deploy-configure-v20");
const { proposeHandoff } = require("./propose-handoff-v20");
const { verifyDeployment } = require("./verify-deployment-v20");
const { fundErc20FromRealHolder } = require("./simulation-v20/actors-v20");
const { anvilArguments, waitForRpc } = require("./simulate-all-functions-v20");

const ONE_DAY = 24 * 60 * 60;
const THIRTY_DAYS = 30 * ONE_DAY;
const PRINCIPAL = ethers.parseEther("1000");
const SDT_REQUIRED = PRINCIPAL * 5n;
const MAX_UINT256 = ethers.MaxUint256;

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address recipient,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const LIVE_VLSDT_ABI = [
  "function SDT() view returns (address)",
  "function stake(uint256 amount,address recipient)",
  "function balanceOf(address account) view returns (uint256)",
  "function unstake(uint256 amount) returns (uint256 id)",
  "function unstakeConfig() view returns (uint96 nonce,uint32 delay,uint32 pendingDelay,uint48 effectiveTimestamp)",
  "function unstakeRequests(uint256 id) view returns (uint160 amount,uint48 deadline,uint48 createdAt)",
  "function calculatePenalty(uint256 id) view returns (uint256 penaltyAmount,uint256 penaltyBps,uint256 userReceives,bool canWithdrawEarly)",
  "function withdraw(uint256 id,address recipient)",
  "function withdrawEarly(uint256 id,address recipient)",
  "event Staked(address indexed caller,address indexed recipient,uint256 amount)",
  "event UnstakeRequested(uint256 indexed id,address indexed owner,uint256 amount,uint256 deadline)",
  "event WithdrawnEarly(uint256 indexed id,address indexed owner,address indexed recipient,uint256 amount,uint256 penaltyAmount)"
];

const FEE_DISTRIBUTOR_ABI = [
  "function REWARD_TOKEN() view returns (address)",
  "function claim(address user,address receiver) returns (uint256)",
  "event Claimed(address indexed user,address indexed receiver,uint256 amount,uint256 claimUpToEpoch)"
];
const ROUTER_ABI = [
  "function execute(bytes[] calls) payable returns (bytes[])"
];

function serialize(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

function errorText(error) {
  if (!error) return "unknown error";
  const message = String(
    error.shortMessage
      || error.reason
      || (error.info && error.info.error && error.info.error.message)
      || error.message
      || error
  );
  const data = [
    error.data,
    error.error && error.error.data,
    error.info && error.info.error && error.info.error.data
  ].find(value => typeof value === "string" && value.startsWith("0x"));
  const selector = data && data.slice(0, 10);
  const knownErrors = {
    "0x27e1f1e5": "OnlyOperator()"
  };
  return selector && knownErrors[selector]
    ? `${message}; ${knownErrors[selector]} [${selector}]`
    : message;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertAddress(actual, expected, label) {
  const a = ethers.getAddress(actual);
  const e = ethers.getAddress(expected);
  assert(a === e, `${label}: ${a} != ${e}`);
}

function assertEq(actual, expected, label) {
  assert(BigInt(actual) === BigInt(expected), `${label}: ${actual} != ${expected}`);
}

function makeActor(provider, label) {
  const privateKey = ethers.keccak256(ethers.toUtf8Bytes(`CurveYield-v20-live-simulation:${label}`));
  return new ethers.Wallet(privateKey, provider);
}

async function setEthBalance(provider, address, amount = ethers.parseEther("100")) {
  await provider.send("anvil_setBalance", [address, ethers.toBeHex(amount)]);
}

async function latestBlock(provider) {
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  return {
    number: Number(block.number),
    timestamp: Number(block.timestamp)
  };
}

async function advanceExactly(provider, seconds) {
  const before = await latestBlock(provider);
  const target = before.timestamp + Number(seconds);
  await provider.send("evm_setNextBlockTimestamp", [target]);
  await provider.send("evm_mine", []);
  const after = await latestBlock(provider);
  assert(after.timestamp - before.timestamp === Number(seconds), "incorrect time advance");
  return { before, after, elapsedSeconds: Number(seconds) };
}

async function pendingNonce(provider, address) {
  const raw = await provider.send("eth_getTransactionCount", [address, "pending"]);
  return Number(raw);
}

async function sendTx(provider, target, signer, signature, args = [], label = signature) {
  const method = target.connect(signer).getFunction(signature);
  const populated = await method.populateTransaction(...args);
  const from = await signer.getAddress();
  const estimate = await provider.estimateGas({ ...populated, from });
  const tx = await signer.sendTransaction({
    ...populated,
    gasLimit: estimate * 12n / 10n + 25_000n,
    nonce: await pendingNonce(provider, from)
  });
  const receipt = await tx.wait();
  assert(receipt.status === 1, `${label} transaction failed`);
  return {
    label,
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    logs: receipt.logs
  };
}

async function attemptTx(operation, label) {
  try {
    return { ok: true, result: await operation() };
  } catch (error) {
    return { ok: false, label, error: errorText(error) };
  }
}

async function tokenMeta(token) {
  let symbol = "TOKEN";
  let decimals = 18;
  try { symbol = await token.symbol(); } catch (_) {}
  try { decimals = Number(await token.decimals()); } catch (_) {}
  return { symbol, decimals };
}

async function balanceDelta(token, address, operation) {
  const before = await token.balanceOf(address);
  const result = await operation();
  const after = await token.balanceOf(address);
  return { before, after, delta: after - before, result };
}

function directVlSdtClaimPlan(user, distributors, tokens) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return {
    signature: "execute(bytes[])",
    args: [[
      ethers.concat([
        "0x0c",
        "0xb38aab9d",
        coder.encode(["address[]"], [distributors])
      ]),
      ethers.concat([
        "0x07",
        "0x780469bb",
        coder.encode(["address[]"], [tokens])
      ])
    ]],
    receiver: user
  };
}

function parseEvent(contractInterface, logs, eventName) {
  for (const log of logs || []) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed && parsed.name === eventName) return parsed;
    } catch (_) {}
  }
  return null;
}

async function acceptOwnershipByImpersonation({ provider, ctx, finalOwner }) {
  await setEthBalance(provider, finalOwner);
  await provider.send("anvil_impersonateAccount", [finalOwner]);
  const signer = await provider.getSigner(finalOwner);
  const receipts = [];
  try {
    for (const [key] of OWNABLE_CONTRACTS) {
      const target = contract(ctx, key, signer);
      const owner = ethers.getAddress(await target.owner());
      if (owner === ethers.getAddress(finalOwner)) continue;
      assertAddress(await target.pendingOwner(), finalOwner, `${key}.pendingOwner`);
      receipts.push(await sendTx(provider, target, signer, "acceptOwnership()", [], `${key}.acceptOwnership`));
    }
  } finally {
    await provider.send("anvil_stopImpersonatingAccount", [finalOwner]);
  }
  ctx.state.phase = "ownership-accepted";
  saveState(ctx.stateFile, ctx.state);
  return receipts;
}

async function verifyLiveWiring(ctx) {
  const c = ctx.config;
  const governanceToken = contract(ctx, "governanceToken");
  const governanceStaking = contract(ctx, "governanceStaking");
  const governanceMintController = contract(ctx, "governanceMintController");
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

  assertAddress(await locker.SDT(), c.stakeDao.sdt, "locker.SDT");
  assertAddress(await locker.VLSDT(), c.stakeDao.vlSdt, "locker.VLSDT");
  assertAddress(await locker.VLBOOST(), c.stakeDao.vlBoost, "locker.VLBOOST");
  assertAddress(await locker.STAKE_DAO_ROUTER(), c.stakeDao.router, "locker.STAKE_DAO_ROUTER");
  assertAddress(
    await locker.VLSDT_FEE_DISTRIBUTOR_USDC(),
    c.stakeDao.vlSdtFeeDistributorUsdc,
    "locker.VLSDT_FEE_DISTRIBUTOR_USDC"
  );
  assertAddress(
    await locker.VLSDT_FEE_DISTRIBUTOR_SDT(),
    c.stakeDao.vlSdtFeeDistributorSdt,
    "locker.VLSDT_FEE_DISTRIBUTOR_SDT"
  );
  assertAddress(await locker.BOOST_MARKETPLACE(), c.stakeDao.boostMarketplace, "locker.BOOST_MARKETPLACE");
  assertAddress(await locker.CYVLSDT(), await cyvlSdt.getAddress(), "locker.CYVLSDT");
  assertAddress(await cyvlSdt.locker(), await locker.getAddress(), "cyvlSDT.locker");
  assertAddress(await locker.revenueStaking(), await revenueStaking.getAddress(), "locker.revenueStaking");
  assertAddress(await locker.boostStaking(), await boostStaking.getAddress(), "locker.boostStaking");
  assertAddress(await locker.boostMerchant(), await boostMerchant.getAddress(), "locker.boostMerchant");

  assertAddress(await governanceStaking.GOVERNANCE_TOKEN(), await governanceToken.getAddress(), "governance staking token");
  assertAddress(await governanceStaking.governanceMintController(), await governanceMintController.getAddress(), "governance mint controller");
  assertAddress(await cyGovYieldStaking.CYVLSDT(), await cyvlSdt.getAddress(), "cyGovYield asset");
  assertAddress(await cyGovYieldStaking.GOVERNANCE_TOKEN(), await governanceToken.getAddress(), "cyGovYield reward");
  assertAddress(await revenueStaking.CYVLSDT(), await cyvlSdt.getAddress(), "revenue staking asset");
  assertAddress(await boostStaking.CYVLSDT(), await cyvlSdt.getAddress(), "boost staking asset");
  assertAddress(await boostStaking.LOCKER(), await locker.getAddress(), "boost staking locker");

  assertAddress(await revenueVault.strategy(), await revenueStrategy.getAddress(), "vault.strategy");
  assertAddress(await revenueVault.CYGOV_DISTRIBUTOR(), await cyGovDistributor.getAddress(), "vault.distributor");
  assertAddress(await revenueStrategy.vault(), await revenueVault.getAddress(), "strategy.vault");
  assertAddress(await revenueStrategy.want(), await cyvlSdt.getAddress(), "strategy.want");
  assertAddress(await revenueStrategy.REVENUE_STAKING(), await revenueStaking.getAddress(), "strategy.revenueStaking");
  assertAddress(await revenueStrategy.CONVERTER(), await revenueConverter.getAddress(), "strategy.converter");
  assertAddress(await revenueConverter.LOCKER(), await locker.getAddress(), "converter.locker");
  assertAddress(await revenueConverter.outputToken(), await cyvlSdt.getAddress(), "converter.outputToken");

  const usdcFeeDistributor = new ethers.Contract(
    c.stakeDao.vlSdtFeeDistributorUsdc,
    FEE_DISTRIBUTOR_ABI,
    ctx.provider
  );
  const sdtFeeDistributor = new ethers.Contract(
    c.stakeDao.vlSdtFeeDistributorSdt,
    FEE_DISTRIBUTOR_ABI,
    ctx.provider
  );
  const rewardTokenAddress = ethers.getAddress(await usdcFeeDistributor.REWARD_TOKEN());
  const sdtRewardTokenAddress = ethers.getAddress(await sdtFeeDistributor.REWARD_TOKEN());
  assertAddress(sdtRewardTokenAddress, c.stakeDao.sdt, "SDT FeeDistributor reward token");
  const rewardSupportedByConverter = await revenueConverter.supportsToken(rewardTokenAddress);

  return {
    rewardTokenAddress,
    sdtRewardTokenAddress,
    rewardSupportedByConverter,
    addresses: Object.fromEntries(
      Object.entries(ctx.state.contracts).map(([key, item]) => [key, item.address])
    )
  };
}

function rewardConfigurationSnapshot(config, contracts, converterSupportsLiveReward) {
  return Promise.all([
    contracts.cyGovYieldStaking.targetYield(),
    contracts.cyGovYieldStaking.maxMintRate(),
    contracts.revenueStaking.governanceEmissionRate(),
    contracts.boostStaking.governanceEmissionRate()
  ]).then(([targetYield, maxMintRate, revenueEmission, boostEmission]) => ({
    governanceStaking: {
      configuredRewardTokens: config.governanceStaking.rewardTokens || [],
      configuredNotifiers: config.governanceStaking.notifiers || [],
      periodicGovernanceMintAmount: config.governanceMinting.governanceStaking.periodicAmount,
      rewardConfigured:
        (config.governanceStaking.rewardTokens || []).length > 0
        || BigInt(config.governanceMinting.governanceStaking.periodicAmount || "0") > 0n
    },
    cyGovYieldStaking: {
      targetYield,
      maxMintRate,
      rewardConfigured: targetYield > 0n && maxMintRate > 0n
    },
    revenueStaking: {
      governanceEmission: revenueEmission,
      liveVlSdtRewardConfigured: true,
      rewardConfigured: true
    },
    boostStaking: {
      governanceEmission: boostEmission,
      rewardConfigured: boostEmission > 0n
    },
    revenueVault: {
      converterSupportsLiveReward,
      rewardConfigured: converterSupportsLiveReward
    }
  }));
}

async function runThirtyDayKeeper({ provider, locker, revenueStaking, rewardTokenAddress, keeper }) {
  const events = [];
  let startCycleOnDay = null;

  for (let day = 1; day <= 30; day++) {
    await advanceExactly(provider, ONE_DAY);

    if (startCycleOnDay === day) {
      events.push({
        day,
        action: "revenueStaking.startRewardCycle",
        ...(await attemptTx(
          () => sendTx(
            provider,
            revenueStaking,
            keeper,
            "startRewardCycle(address)",
            [rewardTokenAddress],
            `day-${day}:startRewardCycle`
          ),
          `day-${day}:startRewardCycle`
        ))
      });
      startCycleOnDay = null;
    }

    if (day % 7 === 0) {
      const claim = await attemptTx(
        () => sendTx(
          provider,
          locker,
          keeper,
          "claimVlSDTRewards()",
          [],
          `day-${day}:locker.claimVlSDTRewards`
        ),
        `day-${day}:locker.claimVlSDTRewards`
      );
      events.push({ day, action: "locker.claimVlSDTRewards", ...claim });
      if (claim.ok) startCycleOnDay = day + 1;
    }
  }

  const elapsed = events.length;
  return { elapsedDays: 30, keeperActionCount: elapsed, events };
}

async function runLiveDeploymentSimulation(options = {}) {
  const configPath = options.configPath || process.argv[2] || "config-mainnet-v20.json";
  const { config } = loadConfig(configPath);
  const forkUrl = options.forkUrl || process.env.ETHEREUM_RPC_URL;
  if (!forkUrl) throw new Error("ETHEREUM_RPC_URL is required");

  const requireNonzeroRewards = String(
    options.requireNonzeroRewards ?? process.env.REQUIRE_NONZERO_REWARDS ?? "true"
  ).toLowerCase() !== "false";

  const port = Number(options.port || process.env.ANVIL_PORT || config.deployment.anvilPort || 8545);
  const localUrl = `http://127.0.0.1:${port}`;
  const forkBlockOverride = options.forkBlock || process.env.ANVIL_FORK_BLOCK;
  const localConfig = JSON.parse(JSON.stringify(config));
  if (forkBlockOverride) localConfig.deployment.anvilForkBlockNumber = Number(forkBlockOverride);

  const stderrTail = [];
  const anvil = spawn(
    options.anvilPath || process.env.ANVIL_PATH || "anvil",
    anvilArguments(localConfig, forkUrl, port),
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  anvil.stderr.on("data", chunk => {
    stderrTail.push(String(chunk));
    if (stderrTail.length > 30) stderrTail.shift();
  });

  let provider;
  let ctx;
  let reportPath;
  const tag = `live-30d-v20-${Date.now()}`;
  const report = {
    release: config.release,
    simulation: "live-connected-30-day-deployment",
    tag,
    requireNonzeroRewards,
    status: "running",
    failures: [],
    warnings: [],
    transactions: [],
    keeper: null,
    proofs: {}
  };

  try {
    provider = await waitForRpc(localUrl, anvil, stderrTail);
    report.fork = await latestBlock(provider);
    report.chainId = String((await provider.getNetwork()).chainId);

    const deployer = makeActor(provider, "deployer");
    const actors = {
      sdtSource: makeActor(provider, "sdt-source"),
      directVlSdtUser: makeActor(provider, "direct-vlsdt-user"),
      directVlSdtReceiver: makeActor(provider, "direct-vlsdt-receiver"),
      governanceStakingUser: makeActor(provider, "governance-staking-user"),
      governanceStakingReceiver: makeActor(provider, "governance-staking-receiver"),
      cyGovYieldUser: makeActor(provider, "cygov-yield-user"),
      cyGovYieldReceiver: makeActor(provider, "cygov-yield-receiver"),
      revenueStakingUser: makeActor(provider, "revenue-staking-user"),
      revenueStakingReceiver: makeActor(provider, "revenue-staking-receiver"),
      boostStakingUser: makeActor(provider, "boost-staking-user"),
      boostStakingReceiver: makeActor(provider, "boost-staking-receiver"),
      revenueVaultUser: makeActor(provider, "revenue-vault-user"),
      keeper: makeActor(provider, "keeper")
    };
    report.actors = Object.fromEntries(
      Object.entries(actors).map(([name, wallet]) => [name, wallet.address])
    );
    report.deployer = deployer.address;

    await setEthBalance(provider, deployer.address);
    await setEthBalance(provider, config.finalOwner);
    for (const wallet of Object.values(actors)) await setEthBalance(provider, wallet.address);

    const stateFile = statePath(BigInt(config.chainId), tag);
    ctx = await deployAndConfigure({
      configPath,
      rpcUrl: localUrl,
      privateKey: deployer.privateKey,
      tag,
      confirmations: 1,
      stateFile
    });

    const contracts = {
      governanceToken: contract(ctx, "governanceToken"),
      governanceStaking: contract(ctx, "governanceStaking"),
      cyvlSdt: contract(ctx, "cyvlSdt"),
      locker: contract(ctx, "locker"),
      cyGovYieldStaking: contract(ctx, "cyGovYieldStaking"),
      revenueStaking: contract(ctx, "revenueStaking"),
      boostStaking: contract(ctx, "boostStaking"),
      revenueVault: contract(ctx, "revenueVault"),
      revenueStrategy: contract(ctx, "revenueStrategy"),
      revenueConverter: contract(ctx, "revenueConverter"),
      cyGovDistributor: contract(ctx, "cyGovDistributor")
    };

    const wiring = await verifyLiveWiring(ctx);
    report.wiring = wiring;

    const sdt = new ethers.Contract(config.stakeDao.sdt, ERC20_ABI, provider);
    const liveVlSdt = new ethers.Contract(config.stakeDao.vlSdt, LIVE_VLSDT_ABI, provider);
    const router = new ethers.Contract(config.stakeDao.router, ROUTER_ABI, provider);
    const liveRewardToken = new ethers.Contract(wiring.rewardTokenAddress, ERC20_ABI, provider);
    report.tokens = {
      SDT: { address: await sdt.getAddress(), ...(await tokenMeta(sdt)) },
      vlSDT: { address: await liveVlSdt.getAddress(), decimals: 18, symbol: "vlSDT" },
      liveReward: { address: await liveRewardToken.getAddress(), ...(await tokenMeta(liveRewardToken)) },
      cyvlSDT: { address: await contracts.cyvlSdt.getAddress(), ...(await tokenMeta(contracts.cyvlSdt)) },
      cyGOV: { address: await contracts.governanceToken.getAddress(), ...(await tokenMeta(contracts.governanceToken)) }
    };

    report.rewardConfiguration = await rewardConfigurationSnapshot(
      config,
      contracts,
      wiring.rewardSupportedByConverter
    );

    if (!wiring.rewardSupportedByConverter) {
      report.failures.push(
        `Revenue Vault cannot compound the live Fee Distributor reward token ${wiring.rewardTokenAddress}: `
        + "the configured RevenueConverter does not support it"
      );
    }
    if (!report.rewardConfiguration.governanceStaking.rewardConfigured) {
      report.failures.push("Governance Staking has no nonzero configured reward source");
    }
    if (!report.rewardConfiguration.cyGovYieldStaking.rewardConfigured) {
      report.failures.push("cyGOV Yield Staking targetYield/maxMintRate are zero");
    }
    if (!report.rewardConfiguration.boostStaking.rewardConfigured) {
      report.failures.push("Boost Staking governance emission rate is zero");
    }

    // The only fork-only privilege used for principal funding: transfer real SDT
    // from an actual mainnet holder. No internal CurveYield token is force-minted.
    report.sdtFunding = await fundErc20FromRealHolder({
      provider,
      tokenAddress: config.stakeDao.sdt,
      recipient: actors.sdtSource.address,
      amount: SDT_REQUIRED,
      candidates: [
        config.finalOwner,
        config.feeReceivers.treasury,
        config.stakeDao.vlSdt,
        config.stakeDao.vlSdtFeeDistributorSdt,
        config.stakeDao.boostMarketplace
      ],
      lookbackBlocks: 10_000,
      maxWindows: 8
    });
    assertEq(await sdt.balanceOf(actors.sdtSource.address), SDT_REQUIRED, "funded SDT principal");

    // Split real SDT principal: 1,000 for direct live vlSDT and 4,000 for
    // Locker-backed cyvlSDT positions.
    report.transactions.push(await sendTx(
      provider,
      sdt,
      actors.sdtSource,
      "transfer(address,uint256)",
      [actors.directVlSdtUser.address, PRINCIPAL],
      "fund direct vlSDT user"
    ));

    // Direct baseline: actual live vlSDT contract, actual SDT, exact 1:1 stake.
    report.transactions.push(await sendTx(
      provider,
      sdt,
      actors.directVlSdtUser,
      "approve(address,uint256)",
      [config.stakeDao.vlSdt, PRINCIPAL],
      "direct vlSDT approve"
    ));
    report.transactions.push(await sendTx(
      provider,
      liveVlSdt,
      actors.directVlSdtUser,
      "stake(uint256,address)",
      [PRINCIPAL, actors.directVlSdtUser.address],
      "direct live vlSDT stake"
    ));
    assertEq(await liveVlSdt.balanceOf(actors.directVlSdtUser.address), PRINCIPAL, "direct vlSDT stake");

    // Legitimate setup-window governance principal mint. This is used only to
    // obtain the 1,000 cyGOV principal required for the Governance Staking test.
    report.transactions.push(await sendTx(
      provider,
      contracts.governanceToken,
      deployer,
      "mint(address,uint256)",
      [actors.governanceStakingUser.address, PRINCIPAL],
      "mint governance staking principal during setup window"
    ));
    assertEq(
      await contracts.governanceToken.balanceOf(actors.governanceStakingUser.address),
      PRINCIPAL,
      "governance staking principal"
    );

    // Every cyvlSDT position originates from real SDT -> deployed Locker -> live
    // vlSDT. The Locker mints exactly the live vlSDT balance increase.
    report.transactions.push(await sendTx(
      provider,
      sdt,
      actors.sdtSource,
      "approve(address,uint256)",
      [await contracts.locker.getAddress(), PRINCIPAL * 4n],
      "approve Locker for all cyvlSDT principals"
    ));

    for (const [label, receiver] of [
      ["cyGovYieldStaking", actors.cyGovYieldUser],
      ["revenueStaking", actors.revenueStakingUser],
      ["boostStaking", actors.boostStakingUser],
      ["revenueVault", actors.revenueVaultUser]
    ]) {
      report.transactions.push(await sendTx(
        provider,
        contracts.locker,
        actors.sdtSource,
        "deposit(uint256,address)",
        [PRINCIPAL, receiver.address],
        `Locker deposit for ${label}`
      ));
      assertEq(await contracts.cyvlSdt.balanceOf(receiver.address), PRINCIPAL, `${label} cyvlSDT principal`);
    }

    assertEq(await liveVlSdt.balanceOf(await contracts.locker.getAddress()), PRINCIPAL * 4n, "Locker live vlSDT backing");
    assertEq(await contracts.cyvlSdt.totalSupply(), PRINCIPAL * 4n, "cyvlSDT total supply");

    // Finish the canonical ownership/admin handoff before user staking begins.
    ctx = await proposeHandoff({
      configPath,
      rpcUrl: localUrl,
      privateKey: deployer.privateKey,
      tag,
      confirmations: 1,
      stateFile,
      simulation: true
    });
    report.handoffReceipts = await acceptOwnershipByImpersonation({
      provider,
      ctx,
      finalOwner: config.finalOwner
    });
    await verifyDeployment({
      configPath,
      rpcUrl: localUrl,
      privateKey: deployer.privateKey,
      tag,
      expectedOwner: config.finalOwner,
      expectedAdmin: config.finalAdmin
    });

    // Deposit exactly 1,000 principal into each CurveYield staking/vault path.
    const stakingActions = [
      {
        label: "governanceStaking",
        token: contracts.governanceToken,
        user: actors.governanceStakingUser,
        target: contracts.governanceStaking,
        signature: "stake(uint256)",
        args: [PRINCIPAL]
      },
      {
        label: "cyGovYieldStaking",
        token: contracts.cyvlSdt,
        user: actors.cyGovYieldUser,
        target: contracts.cyGovYieldStaking,
        signature: "stake(uint256)",
        args: [PRINCIPAL]
      },
      {
        label: "revenueStaking",
        token: contracts.cyvlSdt,
        user: actors.revenueStakingUser,
        target: contracts.revenueStaking,
        signature: "stake(uint256)",
        args: [PRINCIPAL]
      },
      {
        label: "boostStaking",
        token: contracts.cyvlSdt,
        user: actors.boostStakingUser,
        target: contracts.boostStaking,
        signature: "deposit(uint256)",
        args: [PRINCIPAL]
      },
      {
        label: "revenueVault",
        token: contracts.cyvlSdt,
        user: actors.revenueVaultUser,
        target: contracts.revenueVault,
        signature: "deposit(uint256)",
        args: [PRINCIPAL]
      }
    ];

    for (const action of stakingActions) {
      report.transactions.push(await sendTx(
        provider,
        action.token,
        action.user,
        "approve(address,uint256)",
        [await action.target.getAddress(), MAX_UINT256],
        `${action.label} approve`
      ));
      report.transactions.push(await sendTx(
        provider,
        action.target,
        action.user,
        action.signature,
        action.args,
        `${action.label} deposit`
      ));
    }

    assertEq(await contracts.governanceStaking.balanceOf(actors.governanceStakingUser.address), PRINCIPAL, "governanceStaking deposited");
    assertEq(await contracts.cyGovYieldStaking.balanceOf(actors.cyGovYieldUser.address), PRINCIPAL, "cyGovYieldStaking deposited");
    assertEq(await contracts.revenueStaking.activeBalance(actors.revenueStakingUser.address), PRINCIPAL, "revenueStaking deposited");
    assertEq(await contracts.boostStaking.depositedBalance(actors.boostStakingUser.address), PRINCIPAL, "boostStaking deposited");
    assert((await contracts.revenueVault.balanceOf(actors.revenueVaultUser.address)) > 0n, "revenueVault minted no shares");

    report.depositProof = {
      directLiveVlSdt: await liveVlSdt.balanceOf(actors.directVlSdtUser.address),
      governanceStaking: await contracts.governanceStaking.balanceOf(actors.governanceStakingUser.address),
      cyGovYieldStaking: await contracts.cyGovYieldStaking.balanceOf(actors.cyGovYieldUser.address),
      revenueStaking: await contracts.revenueStaking.activeBalance(actors.revenueStakingUser.address),
      boostStaking: await contracts.boostStaking.depositedBalance(actors.boostStakingUser.address),
      revenueVaultShares: await contracts.revenueVault.balanceOf(actors.revenueVaultUser.address),
      lockerVlSdtBacking: await liveVlSdt.balanceOf(await contracts.locker.getAddress()),
      cyvlSdtSupply: await contracts.cyvlSdt.totalSupply()
    };

    const waitStart = await latestBlock(provider);
    report.keeper = await runThirtyDayKeeper({
      provider,
      locker: contracts.locker,
      revenueStaking: contracts.revenueStaking,
      rewardTokenAddress: wiring.rewardTokenAddress,
      keeper: actors.keeper
    });
    const waitEnd = await latestBlock(provider);
    assert(waitEnd.timestamp - waitStart.timestamp === THIRTY_DAYS, "simulation did not wait exactly 30 days");
    report.wait = { start: waitStart, end: waitEnd, elapsedSeconds: THIRTY_DAYS };

    // Harvest direct live vlSDT reward.
    const directClaim = directVlSdtClaimPlan(
      actors.directVlSdtUser.address,
      [
        config.stakeDao.vlSdtFeeDistributorUsdc,
        config.stakeDao.vlSdtFeeDistributorSdt
      ],
      [wiring.rewardTokenAddress, wiring.sdtRewardTokenAddress]
    );
    const directReward = await balanceDelta(
      liveRewardToken,
      directClaim.receiver,
      () => sendTx(
        provider,
        router,
        actors.directVlSdtUser,
        directClaim.signature,
        directClaim.args,
        "direct live vlSDT reward claim"
      )
    );

    // Harvest each CurveYield path. No test notifier or fake reward token is used.
    const governanceReward = await balanceDelta(
      contracts.governanceToken,
      actors.governanceStakingReceiver.address,
      () => sendTx(
        provider,
        contracts.governanceStaking,
        actors.governanceStakingUser,
        "claimRewards(address)",
        [actors.governanceStakingReceiver.address],
        "governanceStaking claimRewards"
      )
    );

    const cyGovYieldReward = await balanceDelta(
      contracts.governanceToken,
      actors.cyGovYieldReceiver.address,
      () => sendTx(
        provider,
        contracts.cyGovYieldStaking,
        actors.cyGovYieldUser,
        "claim(address)",
        [actors.cyGovYieldReceiver.address],
        "cyGovYieldStaking claim"
      )
    );

    const revenueOrdinaryReward = await balanceDelta(
      liveRewardToken,
      actors.revenueStakingReceiver.address,
      () => sendTx(
        provider,
        contracts.revenueStaking,
        actors.revenueStakingUser,
        "claimRewards(address)",
        [actors.revenueStakingReceiver.address],
        "revenueStaking claimRewards"
      )
    );
    const revenueGovernanceReward = await balanceDelta(
      contracts.governanceToken,
      actors.revenueStakingReceiver.address,
      () => sendTx(
        provider,
        contracts.revenueStaking,
        actors.revenueStakingUser,
        "claimGovernance(address)",
        [actors.revenueStakingReceiver.address],
        "revenueStaking claimGovernance"
      )
    );

    const boostReward = await balanceDelta(
      contracts.governanceToken,
      actors.boostStakingReceiver.address,
      () => sendTx(
        provider,
        contracts.boostStaking,
        actors.boostStakingUser,
        "claimGovernance(address)",
        [actors.boostStakingReceiver.address],
        "boostStaking claimGovernance"
      )
    );

    const vaultPpsBefore = await contracts.revenueVault.getPricePerFullShare();
    const vaultBalanceBefore = await contracts.revenueVault.balance();
    const vaultHarvest = await attemptTx(
      () => sendTx(
        provider,
        contracts.revenueStrategy,
        actors.keeper,
        "harvest(address)",
        [actors.keeper.address],
        "revenueStrategy harvest"
      ),
      "revenueStrategy harvest"
    );
    const vaultPpsAfter = await contracts.revenueVault.getPricePerFullShare();
    const vaultBalanceAfter = await contracts.revenueVault.balance();

    await sendTx(
      provider,
      contracts.cyGovDistributor,
      actors.keeper,
      "sync()",
      [],
      "cyGovDistributor sync"
    );
    const vaultGovernanceReward = await balanceDelta(
      contracts.governanceToken,
      actors.revenueVaultUser.address,
      () => sendTx(
        provider,
        contracts.cyGovDistributor,
        actors.revenueVaultUser,
        "claim(bool)",
        [false],
        "revenueVault cyGOV claim"
      )
    );

    report.harvestProof = {
      directLiveVlSdt: {
        rewardToken: wiring.rewardTokenAddress,
        amount: directReward.delta,
        transaction: directReward.result
      },
      governanceStaking: {
        rewardToken: await contracts.governanceToken.getAddress(),
        amount: governanceReward.delta,
        transaction: governanceReward.result
      },
      cyGovYieldStaking: {
        rewardToken: await contracts.governanceToken.getAddress(),
        amount: cyGovYieldReward.delta,
        transaction: cyGovYieldReward.result
      },
      revenueStaking: {
        ordinaryRewardToken: wiring.rewardTokenAddress,
        ordinaryAmount: revenueOrdinaryReward.delta,
        ordinaryTransaction: revenueOrdinaryReward.result,
        governanceAmount: revenueGovernanceReward.delta,
        governanceTransaction: revenueGovernanceReward.result
      },
      boostStaking: {
        rewardToken: await contracts.governanceToken.getAddress(),
        amount: boostReward.delta,
        transaction: boostReward.result
      },
      revenueVault: {
        harvest: vaultHarvest,
        ppsBefore: vaultPpsBefore,
        ppsAfter: vaultPpsAfter,
        realizedBalanceBefore: vaultBalanceBefore,
        realizedBalanceAfter: vaultBalanceAfter,
        governanceAmount: vaultGovernanceReward.delta,
        governanceTransaction: vaultGovernanceReward.result
      }
    };

    // Withdraw all CurveYield positions after the 30-day harvest.
    const governancePrincipal = await balanceDelta(
      contracts.governanceToken,
      actors.governanceStakingUser.address,
      () => sendTx(
        provider,
        contracts.governanceStaking,
        actors.governanceStakingUser,
        "withdrawImmediately(uint256,address)",
        [PRINCIPAL, actors.governanceStakingUser.address],
        "governanceStaking withdrawImmediately"
      )
    );

    const cyGovYieldPrincipal = await balanceDelta(
      contracts.cyvlSdt,
      actors.cyGovYieldUser.address,
      () => sendTx(
        provider,
        contracts.cyGovYieldStaking,
        actors.cyGovYieldUser,
        "withdrawAll(address)",
        [actors.cyGovYieldUser.address],
        "cyGovYieldStaking withdrawAll"
      )
    );

    const revenueStakeAmount = await contracts.revenueStaking.activeBalance(actors.revenueStakingUser.address);
    const revenueExpected = await contracts.revenueStaking.previewImmediateWithdrawal(revenueStakeAmount);
    const revenuePrincipal = await balanceDelta(
      contracts.cyvlSdt,
      actors.revenueStakingUser.address,
      () => sendTx(
        provider,
        contracts.revenueStaking,
        actors.revenueStakingUser,
        "withdrawImmediate(uint256,address)",
        [revenueStakeAmount, actors.revenueStakingUser.address],
        "revenueStaking withdrawImmediate"
      )
    );
    assertEq(revenuePrincipal.delta, revenueExpected, "revenue staking withdrawal preview");

    const boostStakeAmount = await contracts.boostStaking.depositedBalance(actors.boostStakingUser.address);
    const boostPrincipal = await balanceDelta(
      contracts.cyvlSdt,
      actors.boostStakingUser.address,
      () => sendTx(
        provider,
        contracts.boostStaking,
        actors.boostStakingUser,
        "withdraw(uint256,address)",
        [boostStakeAmount, actors.boostStakingUser.address],
        "boostStaking withdraw"
      )
    );
    assertEq(boostPrincipal.delta, boostStakeAmount, "boost staking withdrawal");

    const vaultShares = await contracts.revenueVault.balanceOf(actors.revenueVaultUser.address);
    const vaultPrincipal = await balanceDelta(
      contracts.cyvlSdt,
      actors.revenueVaultUser.address,
      () => sendTx(
        provider,
        contracts.revenueVault,
        actors.revenueVaultUser,
        "withdrawAll()",
        [],
        "revenueVault withdrawAll"
      )
    );

    // Direct live vlSDT: harvest first, then request unstake and use the real
    // early-exit path. Stake DAO's normal cooldown is eight weeks, so a full
    // penalty-free direct withdrawal is not possible after only 30 days.
    const unstakeTx = await sendTx(
      provider,
      liveVlSdt,
      actors.directVlSdtUser,
      "unstake(uint256)",
      [PRINCIPAL],
      "direct live vlSDT unstake request"
    );
    const unstakeEvent = parseEvent(liveVlSdt.interface, unstakeTx.logs, "UnstakeRequested");
    assert(unstakeEvent, "direct vlSDT UnstakeRequested event missing");
    const unstakeId = BigInt(unstakeEvent.args.id);
    const penalty = await liveVlSdt.calculatePenalty(unstakeId);
    assert(penalty.canWithdrawEarly, "direct vlSDT early withdrawal unavailable");
    const directPrincipal = await balanceDelta(
      sdt,
      actors.directVlSdtReceiver.address,
      () => sendTx(
        provider,
        liveVlSdt,
        actors.directVlSdtUser,
        "withdrawEarly(uint256,address)",
        [unstakeId, actors.directVlSdtReceiver.address],
        "direct live vlSDT withdrawEarly"
      )
    );
    assertEq(directPrincipal.delta, penalty.userReceives, "direct vlSDT early withdrawal amount");

    assertEq(await contracts.governanceStaking.balanceOf(actors.governanceStakingUser.address), 0n, "governanceStaking remaining stake");
    assertEq(await contracts.cyGovYieldStaking.balanceOf(actors.cyGovYieldUser.address), 0n, "cyGovYield remaining stake");
    assertEq(await contracts.revenueStaking.activeBalance(actors.revenueStakingUser.address), 0n, "revenueStaking remaining stake");
    assertEq(await contracts.boostStaking.depositedBalance(actors.boostStakingUser.address), 0n, "boostStaking remaining stake");
    assertEq(await contracts.revenueVault.balanceOf(actors.revenueVaultUser.address), 0n, "revenueVault remaining shares");
    assertEq(await liveVlSdt.balanceOf(actors.directVlSdtUser.address), 0n, "direct vlSDT remaining balance");

    report.withdrawalProof = {
      directLiveVlSdt: {
        unstakeId,
        unstakeTransaction: unstakeTx,
        penaltyAmount: penalty.penaltyAmount,
        penaltyBps: penalty.penaltyBps,
        receivedSdt: directPrincipal.delta,
        withdrawalTransaction: directPrincipal.result
      },
      governanceStaking: {
        receivedCyGov: governancePrincipal.delta,
        transaction: governancePrincipal.result
      },
      cyGovYieldStaking: {
        receivedCyvlSdt: cyGovYieldPrincipal.delta,
        transaction: cyGovYieldPrincipal.result
      },
      revenueStaking: {
        receivedCyvlSdt: revenuePrincipal.delta,
        preview: revenueExpected,
        transaction: revenuePrincipal.result
      },
      boostStaking: {
        receivedCyvlSdt: boostPrincipal.delta,
        transaction: boostPrincipal.result
      },
      revenueVault: {
        burnedShares: vaultShares,
        receivedCyvlSdt: vaultPrincipal.delta,
        transaction: vaultPrincipal.result
      }
    };

    const rewardChecks = {
      directLiveVlSdt: directReward.delta > 0n,
      governanceStaking: governanceReward.delta > 0n,
      cyGovYieldStaking: cyGovYieldReward.delta > 0n,
      revenueStaking: revenueOrdinaryReward.delta > 0n || revenueGovernanceReward.delta > 0n,
      boostStaking: boostReward.delta > 0n,
      revenueVault:
        vaultGovernanceReward.delta > 0n
        || vaultPpsAfter > vaultPpsBefore
        || vaultBalanceAfter > vaultBalanceBefore
    };
    report.rewardChecks = rewardChecks;

    if (requireNonzeroRewards) {
      for (const [component, passed] of Object.entries(rewardChecks)) {
        if (!passed) report.failures.push(`${component} produced no nonzero reward after 30 days`);
      }
    }
    if (!vaultHarvest.ok) report.failures.push(`Revenue Vault harvest failed: ${vaultHarvest.error}`);

    report.status = report.failures.length === 0 ? "passed" : "failed";
    report.finalBlock = await latestBlock(provider);
    reportPath = path.join(ROOT, "deployment-output-v20", `${tag}.json`);
    writeJson(reportPath, serialize(report));

    console.log(
      `LIVE 30-DAY SIMULATION ${report.status.toUpperCase()} `
      + `forkBlock=${report.fork.number} report=${reportPath}`
    );
    if (report.status !== "passed") {
      const error = new Error(`live 30-day simulation failed; see ${reportPath}`);
      error.reportPath = reportPath;
      throw error;
    }
    return { report: serialize(report), reportPath };
  } catch (error) {
    report.status = "failed";
    if (!report.failures.includes(errorText(error))) report.failures.push(errorText(error));
    if (!reportPath) {
      reportPath = path.join(ROOT, "deployment-output-v20", `${tag}-failed.json`);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      writeJson(reportPath, serialize(report));
    }
    error.reportPath = reportPath;
    throw error;
  } finally {
    if (provider && typeof provider.destroy === "function") provider.destroy();
    if (anvil.exitCode === null) anvil.kill("SIGTERM");
  }
}

if (require.main === module) {
  runLiveDeploymentSimulation().catch(error => {
    console.error(error);
    if (error.reportPath) console.error(`report=${error.reportPath}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PRINCIPAL,
  SDT_REQUIRED,
  directVlSdtClaimPlan,
  errorText,
  latestBlock,
  advanceExactly,
  runLiveDeploymentSimulation,
  runThirtyDayKeeper,
  verifyLiveWiring
};
