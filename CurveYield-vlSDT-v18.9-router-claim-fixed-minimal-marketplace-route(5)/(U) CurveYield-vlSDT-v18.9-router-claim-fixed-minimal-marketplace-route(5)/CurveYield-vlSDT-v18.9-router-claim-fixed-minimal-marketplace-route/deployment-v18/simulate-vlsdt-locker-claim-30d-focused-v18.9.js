#!/usr/bin/env node
"use strict";

/**
 * Focused vlSDT locker claim simulation.
 *
 * 1. Resolve the highest Ethereum block at or before head.timestamp - 30 days.
 * 2. Fork mainnet at that historical block.
 * 3. Deploy and configure V18.9 through the canonical deployAndConfigure path.
 * 4. Fund one actor with 1,000 real forked SDT and deposit it through the
 *    deployed locker into the live Stake DAO vlSDT contract.
 * 5. Mine the claim transaction exactly 30 days after the deposit block.
 * 6. Record the real claim result without injecting rewards.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const {
  ROOT,
  ethers,
  loadConfig,
  statePath,
  contract,
  writeJson
} = require("./lib-v18");
const { deployAndConfigure } = require("./deploy-configure-v18");
const { fundErc20FromRealHolder } = require("./simulation-v18/actors-v18");
const { anvilArguments, waitForRpc } = require("./simulate-all-functions-v18");

const THIRTY_DAYS = 30 * 24 * 60 * 60;
const PRINCIPAL = ethers.parseEther("1000");
const ERC20_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];
const VLSDT_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "event Staked(address indexed caller,address indexed recipient,uint256 amount)"
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
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serialize(item)])
    );
  }
  return value;
}

function makeActor(provider, label) {
  const privateKey = ethers.keccak256(
    ethers.toUtf8Bytes(`CurveYield-v18.9-focused-vlsdt-claim:${label}`)
  );
  return new ethers.Wallet(privateKey, provider);
}

function stakeDaoRouterClaimPlan(distributors, tokens) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return {
    signature: "execute(bytes[])",
    calls: [
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
    ]
  };
}

async function setEthBalance(provider, address, amount = ethers.parseEther("100")) {
  await provider.send("anvil_setBalance", [address, ethers.toBeHex(amount)]);
}

async function rawBlock(provider, tag) {
  const block = await provider.send("eth_getBlockByNumber", [tag, false]);
  if (!block) throw new Error(`block not found: ${tag}`);
  return {
    number: Number(block.number),
    timestamp: Number(block.timestamp),
    hash: block.hash
  };
}

async function blockByNumber(provider, number) {
  return rawBlock(provider, ethers.toBeHex(number));
}

async function findBlockAtOrBefore(provider, targetTimestamp, head) {
  const age = head.timestamp - targetTimestamp;
  let estimate = Math.max(0, head.number - Math.ceil(age / 12));
  let candidate = await blockByNumber(provider, estimate);

  // Ethereum's average block interval makes interpolation converge in a few
  // archive requests and avoids probing ancient blocks on a slow RPC.
  for (let attempt = 0; attempt < 8; attempt++) {
    const timestampDelta = targetTimestamp - candidate.timestamp;
    if (Math.abs(timestampDelta) <= 24) break;
    const blockDelta = Math.trunc(timestampDelta / 12);
    const next = Math.max(
      0,
      Math.min(head.number, candidate.number + (blockDelta || Math.sign(timestampDelta)))
    );
    if (next === candidate.number) break;
    candidate = await blockByNumber(provider, next);
  }

  let low;
  let high;
  if (candidate.timestamp <= targetTimestamp) {
    low = candidate.number;
    high = Math.min(head.number, low + 64);
    while ((await blockByNumber(provider, high)).timestamp <= targetTimestamp) {
      if (high === head.number) return head;
      low = high;
      high = Math.min(head.number, high + 256);
    }
  } else {
    high = candidate.number;
    low = Math.max(0, high - 64);
    while ((await blockByNumber(provider, low)).timestamp > targetTimestamp) {
      if (low === 0) throw new Error("target timestamp predates Ethereum genesis");
      high = low;
      low = Math.max(0, low - 256);
    }
  }

  let selected = await blockByNumber(provider, low);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const block = await blockByNumber(provider, middle);
    if (block.timestamp <= targetTimestamp) {
      selected = block;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return selected;
}

async function pendingNonce(provider, address) {
  const raw = await provider.send("eth_getTransactionCount", [address, "pending"]);
  return Number(raw);
}

async function sendTx(provider, target, signer, signature, args, label) {
  const method = target.connect(signer).getFunction(signature);
  const request = await method.populateTransaction(...args);
  const from = await signer.getAddress();
  const estimate = await provider.estimateGas({ ...request, from });
  const tx = await signer.sendTransaction({
    ...request,
    gasLimit: estimate * 12n / 10n + 25_000n,
    nonce: await pendingNonce(provider, from)
  });
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`${label} failed`);
  return {
    label,
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    receipt
  };
}

function errorData(error) {
  const candidates = [
    error && error.data,
    error && error.error && error.error.data,
    error && error.info && error.info.error && error.info.error.data,
    error && error.cause && error.cause.data
  ];
  return candidates.find(value => typeof value === "string" && value.startsWith("0x"));
}

function readableError(error) {
  return String(
    (error && error.shortMessage)
      || (error && error.reason)
      || (error && error.message)
      || error
      || "unknown error"
  );
}

async function decodeClaimRevert(provider, locker, keeper, blockNumber) {
  const request = await locker.claimVlSDTRewards.populateTransaction();
  try {
    await provider.call(
      { ...request, from: keeper.address },
      blockNumber
    );
    return null;
  } catch (error) {
    const data = errorData(error);
    if (data) {
      try {
        const parsed = locker.interface.parseError(data);
        return {
          name: parsed.name,
          signature: parsed.signature,
          selector: data.slice(0, 10),
          data
        };
      } catch (_) {
        return { name: null, signature: null, selector: data.slice(0, 10), data };
      }
    }
    return { name: null, signature: null, selector: null, message: readableError(error) };
  }
}

function parseEvents(receipt, contracts) {
  const events = [];
  for (const log of receipt.logs || []) {
    for (const [source, target] of Object.entries(contracts)) {
      try {
        const parsed = target.interface.parseLog(log);
        events.push({
          source,
          address: log.address,
          name: parsed.name,
          signature: parsed.signature,
          args: serialize(parsed.args.toArray())
        });
        break;
      } catch (_) {
        // The log belongs to another contract.
      }
    }
  }
  return events;
}

function markdownReport(report) {
  const claim = report.claim;
  const lines = [
    "# Focused vlSDT Locker 30-Day Claim Simulation",
    "",
    `Status: **${report.status.toUpperCase()}**`,
    "",
    "## Fork",
    "",
    `- Upstream head: block ${report.upstreamHead.number}, timestamp ${report.upstreamHead.timestamp}`,
    `- Requested historical timestamp: ${report.targetForkTimestamp}`,
    `- Selected fork: block ${report.fork.number}, timestamp ${report.fork.timestamp}`,
    `- Historical age at resolution: ${report.upstreamHead.timestamp - report.fork.timestamp} seconds`,
    "",
    "## Deployment and Configuration",
    "",
    `- Canonical deployment/configuration: ${report.requirements.deployedAndConfigured}`,
    `- Deployed contracts: ${Object.keys(report.deployedContracts).length}`,
    `- Locker: ${report.deployedContracts.locker.address}`,
    `- cyvlSDT: ${report.deployedContracts.cyvlSdt.address}`,
    `- Revenue staking: ${report.deployedContracts.revenueStaking.address}`,
    `- Live SDT: ${report.external.sdt}`,
    `- Live vlSDT: ${report.external.vlSdt}`,
    `- Live Stake DAO Router: ${report.external.router}`,
    `- Live USDC FeeDistributor: ${report.external.vlSdtFeeDistributorUsdc}`,
    `- Live SDT FeeDistributor: ${report.external.vlSdtFeeDistributorSdt}`,
    `- Live reward tokens: ${report.rewards.map(reward => `${reward.symbol} (${reward.address})`).join(", ")}`,
    "",
    "## Stake",
    "",
    `- Real SDT source: ${report.funding.holder}`,
    `- Deposit amount: ${report.stake.amount} wei (1,000 SDT)`,
    `- Deposit transaction: ${report.stake.transactionHash}`,
    `- Stake block timestamp: ${report.stake.blockTimestamp}`,
    `- Locker vlSDT backing after deposit: ${report.stake.lockerVlSdtAfter}`,
    `- cyvlSDT minted: ${report.stake.cyvlSdtMinted}`,
    "",
    "## Time and Claim",
    "",
    `- Claim target timestamp: ${report.timeAdvance.claimTargetTimestamp}`,
    `- Claim block timestamp: ${report.timeAdvance.claimBlockTimestamp}`,
    `- Exact elapsed time: ${report.timeAdvance.elapsedSeconds} seconds`,
    `- Claim transaction: ${claim.transactionHash || "not returned by RPC"}`,
    `- Claim status: ${claim.ok ? "SUCCESS" : "REVERTED"}`,
    `- Decoded revert: ${claim.revert ? `${claim.revert.signature || claim.revert.name || "unknown"} (${claim.revert.selector || "no selector"})` : "none"}`,
    `- Actual USDC distributed: ${claim.rewards.usdc.distributorDelta}`,
    `- Actual SDT distributed: ${claim.rewards.sdt.distributorDelta}`,
    `- Operator-only revert observed: ${claim.operatorOnlyRevert}`,
    "",
    "## Requirements",
    ""
  ];
  for (const [key, value] of Object.entries(report.requirements)) {
    lines.push(`- ${key}: **${value}**`);
  }
  lines.push(
    "",
    "No reward tokens were injected. Time travel on a static fork does not replay",
    "the intervening mainnet transactions, so a zero reward is an honest live-state result.",
    ""
  );
  return lines.join("\n");
}

async function runFocusedSimulation(options = {}) {
  const configPath = options.configPath || process.argv[2] || "config-mainnet-v18.json";
  const { config } = loadConfig(configPath);
  const forkUrl = options.forkUrl || process.env.ETHEREUM_RPC_URL;
  if (!forkUrl) throw new Error("ETHEREUM_RPC_URL is required");

  const pinnedForkBlock = process.env.HISTORICAL_FORK_BLOCK;
  const pinnedForkTimestamp = process.env.HISTORICAL_FORK_TIMESTAMP;
  const pinnedHeadBlock = process.env.UPSTREAM_HEAD_BLOCK;
  const pinnedHeadTimestamp = process.env.UPSTREAM_HEAD_TIMESTAMP;
  let upstreamHead;
  let historicalBlock;
  let targetForkTimestamp;
  if (
    pinnedForkBlock
    && pinnedForkTimestamp
    && pinnedHeadBlock
    && pinnedHeadTimestamp
  ) {
    upstreamHead = {
      number: Number(pinnedHeadBlock),
      timestamp: Number(pinnedHeadTimestamp),
      hash: null
    };
    targetForkTimestamp = upstreamHead.timestamp - THIRTY_DAYS;
    historicalBlock = {
      number: Number(pinnedForkBlock),
      timestamp: Number(pinnedForkTimestamp),
      hash: null
    };
    if (historicalBlock.timestamp !== targetForkTimestamp) {
      throw new Error(
        `pinned fork timestamp ${historicalBlock.timestamp} does not equal `
        + `head minus 30 days ${targetForkTimestamp}`
      );
    }
  } else {
    const upstreamRequest = new ethers.FetchRequest(forkUrl);
    upstreamRequest.timeout = 120_000;
    const upstream = new ethers.JsonRpcProvider(
      upstreamRequest,
      1,
      { staticNetwork: true, batchMaxCount: 1 }
    );
    upstreamHead = await rawBlock(upstream, "latest");
    targetForkTimestamp = upstreamHead.timestamp - THIRTY_DAYS;
    historicalBlock = await findBlockAtOrBefore(
      upstream,
      targetForkTimestamp,
      upstreamHead
    );
    if (typeof upstream.destroy === "function") upstream.destroy();
  }

  const port = Number(options.port || process.env.ANVIL_PORT || 8549);
  const localUrl = `http://127.0.0.1:${port}`;
  const localConfig = JSON.parse(JSON.stringify(config));
  localConfig.deployment.anvilForkBlockNumber = historicalBlock.number;
  const stderrTail = [];
  const forkArguments = anvilArguments(localConfig, forkUrl, port);
  // The focused runner uses only its own funded wallets. Avoid deriving Anvil's
  // ten default accounts, which otherwise triggers unnecessary historical
  // account reads during fork genesis on rate-limited RPC endpoints.
  forkArguments.push("--accounts", "0", "--timeout", "120000");
  const anvil = spawn(
    options.anvilPath || process.env.ANVIL_PATH || "anvil",
    forkArguments,
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  anvil.stderr.on("data", chunk => {
    stderrTail.push(String(chunk));
    if (stderrTail.length > 40) stderrTail.shift();
  });

  const tag = `focused-vlsdt-claim-30d-v18.9-${Date.now()}`;
  const report = {
    release: config.release,
    simulation: "focused-vlsdt-locker-claim-30d",
    status: "running",
    tag,
    upstreamHead,
    targetForkTimestamp,
    fork: historicalBlock,
    external: {
      sdt: config.stakeDao.sdt,
      vlSdt: config.stakeDao.vlSdt,
      vlBoost: config.stakeDao.vlBoost,
      router: config.stakeDao.router,
      vlSdtFeeDistributorUsdc: config.stakeDao.vlSdtFeeDistributorUsdc,
      vlSdtFeeDistributorSdt: config.stakeDao.vlSdtFeeDistributorSdt,
      boostMarketplace: config.stakeDao.boostMarketplace
    },
    deployedContracts: {},
    transactions: [],
    requirements: {}
  };

  let provider;
  let reportJsonPath;
  let reportMarkdownPath;
  try {
    provider = await waitForRpc(localUrl, anvil, stderrTail);
    const localFork = await rawBlock(provider, "latest");
    if (localFork.number !== historicalBlock.number) {
      throw new Error(
        `fork block mismatch: ${localFork.number} != ${historicalBlock.number}`
      );
    }
    report.fork.hash = localFork.hash;

    const deployer = makeActor(provider, "deployer");
    const staker = makeActor(provider, "staker");
    const keeper = makeActor(provider, "keeper");
    await setEthBalance(provider, deployer.address);
    await setEthBalance(provider, staker.address);
    await setEthBalance(provider, keeper.address);
    report.actors = {
      deployer: deployer.address,
      staker: staker.address,
      keeper: keeper.address
    };

    const stateFile = statePath(BigInt(config.chainId), tag);
    const ctx = await deployAndConfigure({
      configPath,
      rpcUrl: localUrl,
      privateKey: deployer.privateKey,
      tag,
      confirmations: 1,
      stateFile
    });
    report.deployedContracts = ctx.state.contracts;
    report.transactions.push(...ctx.state.transactions);

    const locker = contract(ctx, "locker");
    const cyvlSdt = contract(ctx, "cyvlSdt");
    const revenueStaking = contract(ctx, "revenueStaking");
    const sdt = new ethers.Contract(config.stakeDao.sdt, ERC20_ABI, provider);
    const vlSdt = new ethers.Contract(config.stakeDao.vlSdt, VLSDT_ABI, provider);
    const router = new ethers.Contract(config.stakeDao.router, ROUTER_ABI, provider);
    const usdcDistributor = new ethers.Contract(
      config.stakeDao.vlSdtFeeDistributorUsdc,
      FEE_DISTRIBUTOR_ABI,
      provider
    );
    const sdtDistributor = new ethers.Contract(
      config.stakeDao.vlSdtFeeDistributorSdt,
      FEE_DISTRIBUTOR_ABI,
      provider
    );
    const usdcAddress = ethers.getAddress(await usdcDistributor.REWARD_TOKEN());
    const sdtRewardAddress = ethers.getAddress(await sdtDistributor.REWARD_TOKEN());
    const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
    const rewardSdt = new ethers.Contract(sdtRewardAddress, ERC20_ABI, provider);
    report.rewards = [
      {
        key: "usdc",
        address: usdcAddress,
        symbol: await usdc.symbol(),
        decimals: Number(await usdc.decimals()),
        distributor: config.stakeDao.vlSdtFeeDistributorUsdc
      },
      {
        key: "sdt",
        address: sdtRewardAddress,
        symbol: await rewardSdt.symbol(),
        decimals: Number(await rewardSdt.decimals()),
        distributor: config.stakeDao.vlSdtFeeDistributorSdt
      }
    ];

    const wiring = {
      cyvlLocker: ethers.getAddress(await cyvlSdt.locker()),
      lockerCyvl: ethers.getAddress(await locker.CYVLSDT()),
      lockerVlSdt: ethers.getAddress(await locker.VLSDT()),
      lockerRouter: ethers.getAddress(await locker.STAKE_DAO_ROUTER()),
      lockerUsdcFeeDistributor:
        ethers.getAddress(await locker.VLSDT_FEE_DISTRIBUTOR_USDC()),
      lockerSdtFeeDistributor:
        ethers.getAddress(await locker.VLSDT_FEE_DISTRIBUTOR_SDT()),
      lockerUsdcRewardToken: ethers.getAddress(await locker.USDC_REWARD_TOKEN()),
      revenueNotifier: await revenueStaking.isNotifier(await locker.getAddress()),
      usdcRewardTokenEnabled: await revenueStaking.isRewardToken(usdcAddress),
      sdtRewardTokenEnabled: await revenueStaking.isRewardToken(sdtRewardAddress),
      systemConfigured: await locker.systemConfigured()
    };
    report.wiring = wiring;
    const deployedAndConfigured =
      wiring.cyvlLocker === ethers.getAddress(await locker.getAddress())
      && wiring.lockerCyvl === ethers.getAddress(await cyvlSdt.getAddress())
      && wiring.lockerVlSdt === ethers.getAddress(config.stakeDao.vlSdt)
      && wiring.lockerRouter === ethers.getAddress(config.stakeDao.router)
      && wiring.lockerUsdcFeeDistributor
        === ethers.getAddress(config.stakeDao.vlSdtFeeDistributorUsdc)
      && wiring.lockerSdtFeeDistributor
        === ethers.getAddress(config.stakeDao.vlSdtFeeDistributorSdt)
      && wiring.lockerUsdcRewardToken === usdcAddress
      && sdtRewardAddress === ethers.getAddress(config.stakeDao.sdt)
      && wiring.revenueNotifier
      && wiring.usdcRewardTokenEnabled
      && wiring.sdtRewardTokenEnabled
      && wiring.systemConfigured;
    report.requirements.deployedAndConfigured = deployedAndConfigured ? "PASS" : "FAIL";
    if (!deployedAndConfigured) throw new Error("focused locker dependency wiring failed");

    report.funding = await fundErc20FromRealHolder({
      provider,
      tokenAddress: config.stakeDao.sdt,
      recipient: staker.address,
      amount: PRINCIPAL,
      candidates: [config.finalOwner, config.feeReceivers.treasury]
    });
    report.requirements.realForkedSdt = "PASS";

    const approve = await sendTx(
      provider,
      sdt,
      staker,
      "approve(address,uint256)",
      [await locker.getAddress(), PRINCIPAL],
      "approve locker for 1,000 SDT"
    );
    report.transactions.push(serialize({ ...approve, receipt: undefined }));

    const lockerVlSdtBefore = await vlSdt.balanceOf(await locker.getAddress());
    const cyvlBefore = await cyvlSdt.balanceOf(staker.address);
    const deposit = await sendTx(
      provider,
      locker,
      staker,
      "deposit(uint256,address)",
      [PRINCIPAL, staker.address],
      "deposit 1,000 SDT through locker"
    );
    const depositBlock = await blockByNumber(provider, deposit.blockNumber);
    const lockerVlSdtAfter = await vlSdt.balanceOf(await locker.getAddress());
    const cyvlAfter = await cyvlSdt.balanceOf(staker.address);
    report.transactions.push(serialize({ ...deposit, receipt: undefined }));
    report.stake = {
      amount: PRINCIPAL,
      approvalTransactionHash: approve.hash,
      transactionHash: deposit.hash,
      blockNumber: deposit.blockNumber,
      blockTimestamp: depositBlock.timestamp,
      events: parseEvents(deposit.receipt, { locker, vlSdt }),
      lockerVlSdtBefore,
      lockerVlSdtAfter,
      cyvlSdtBefore: cyvlBefore,
      cyvlSdtAfter: cyvlAfter,
      cyvlSdtMinted: cyvlAfter - cyvlBefore
    };
    const exactStake =
      lockerVlSdtAfter - lockerVlSdtBefore === PRINCIPAL
      && cyvlAfter - cyvlBefore === PRINCIPAL;
    report.requirements.exact1000SdtStake = exactStake ? "PASS" : "FAIL";
    report.requirements.cyvlSdtBacking = exactStake ? "PASS" : "FAIL";
    if (!exactStake) throw new Error("1,000 SDT deposit or vlSDT backing mismatch");

    const claimTargetTimestamp = depositBlock.timestamp + THIRTY_DAYS;
    await provider.send("evm_setNextBlockTimestamp", [claimTargetTimestamp]);

    const lockerAddress = await locker.getAddress();
    const revenueAddress = await revenueStaking.getAddress();
    const rewardBalances = async (token, distributor) => ({
      feeDistributor: await token.balanceOf(distributor),
      router: await token.balanceOf(config.stakeDao.router),
      locker: await token.balanceOf(lockerAddress),
      revenueStaking: await token.balanceOf(revenueAddress),
      treasury: await token.balanceOf(config.feeReceivers.treasury)
    });
    const balancesBefore = {
      usdc: await rewardBalances(usdc, config.stakeDao.vlSdtFeeDistributorUsdc),
      sdt: await rewardBalances(rewardSdt, config.stakeDao.vlSdtFeeDistributorSdt)
    };
    let claimTx;
    let claimReceipt;
    let claimError;
    try {
      claimTx = await locker.connect(keeper).claimVlSDTRewards({
        gasLimit: 2_000_000,
        nonce: await pendingNonce(provider, keeper.address)
      });
      claimReceipt = await claimTx.wait();
    } catch (error) {
      claimError = error;
      claimReceipt = error.receipt || null;
    }
    const claimBlockNumber = claimReceipt
      ? claimReceipt.blockNumber
      : (await rawBlock(provider, "latest")).number;
    const claimBlock = await blockByNumber(provider, claimBlockNumber);
    const revert = claimReceipt && claimReceipt.status === 0
      ? await decodeClaimRevert(provider, locker.connect(keeper), keeper, claimBlockNumber)
      : null;
    const balancesAfter = {
      usdc: await rewardBalances(usdc, config.stakeDao.vlSdtFeeDistributorUsdc),
      sdt: await rewardBalances(rewardSdt, config.stakeDao.vlSdtFeeDistributorSdt)
    };
    const claimedReward = key => ({
      address: key === "usdc" ? usdcAddress : sdtRewardAddress,
      balancesBefore: balancesBefore[key],
      balancesAfter: balancesAfter[key],
      distributorDelta:
        balancesBefore[key].feeDistributor - balancesAfter[key].feeDistributor,
      lockerDelta: balancesAfter[key].locker - balancesBefore[key].locker,
      revenueStakingDelta:
        balancesAfter[key].revenueStaking - balancesBefore[key].revenueStaking
    });
    const elapsedSeconds = claimBlock.timestamp - depositBlock.timestamp;
    const claimOk = Boolean(claimReceipt && claimReceipt.status === 1);
    const operatorOnlyRevert = Boolean(
      revert && (revert.name === "OnlyOperator" || revert.selector === "0x27e1f1e5")
    );
    report.timeAdvance = {
      fromBlock: depositBlock.number,
      fromTimestamp: depositBlock.timestamp,
      claimTargetTimestamp,
      claimBlockNumber,
      claimBlockTimestamp: claimBlock.timestamp,
      elapsedSeconds
    };
    report.claim = {
      attempted: true,
      ok: claimOk,
      transactionHash:
        (claimReceipt && claimReceipt.hash)
        || (claimTx && claimTx.hash)
        || (claimError && claimError.transactionHash)
        || null,
      receiptStatus: claimReceipt ? claimReceipt.status : null,
      error: claimError ? readableError(claimError) : null,
      revert,
      operatorOnlyRevert,
      rewards: {
        usdc: claimedReward("usdc"),
        sdt: claimedReward("sdt")
      },
      events: claimReceipt && claimReceipt.status === 1
        ? parseEvents(claimReceipt, {
            locker,
            router,
            usdcDistributor,
            sdtDistributor,
            revenueStaking
          })
        : []
    };

    report.requirements.exact30DayElapsed =
      elapsedSeconds === THIRTY_DAYS ? "PASS" : "FAIL";
    report.requirements.claimTransactionAttempted =
      report.claim.transactionHash ? "PASS" : "FAIL";
    const expectedZeroRewardRevert = Boolean(revert && revert.name === "NoRewardClaimed");
    report.requirements.routerExecuteClaimPath =
      (claimOk || expectedZeroRewardRevert) && !operatorOnlyRevert ? "PASS" : "FAIL";
    report.requirements.syntheticRewardsInjected = "PASS (none injected)";
    report.requirements.actualRewardMeasured = "PASS";
    report.status = Object.values(report.requirements).some(value =>
      String(value).startsWith("FAIL")
    ) ? "failed" : "passed";

    reportJsonPath = path.join(
      ROOT,
      "deployment-output-v18",
      `${tag}.json`
    );
    reportMarkdownPath = path.join(
      ROOT,
      "deployment-output-v18",
      `${tag}.md`
    );
    writeJson(reportJsonPath, serialize(report));
    fs.writeFileSync(reportMarkdownPath, markdownReport(serialize(report)));

    console.log(
      `FOCUSED VLSDT CLAIM ${report.status.toUpperCase()} `
      + `forkBlock=${report.fork.number} elapsed=${elapsedSeconds} `
      + `claim=${report.claim.ok ? "success" : report.claim.revert?.signature || "reverted"} `
      + `usdc=${report.claim.rewards.usdc.distributorDelta} `
      + `sdt=${report.claim.rewards.sdt.distributorDelta} report=${reportJsonPath}`
    );
    return { report: serialize(report), reportJsonPath, reportMarkdownPath };
  } catch (error) {
    report.status = "failed";
    report.fatalError = readableError(error);
    reportJsonPath = reportJsonPath || path.join(
      ROOT,
      "deployment-output-v18",
      `${tag}-failed.json`
    );
    writeJson(reportJsonPath, serialize(report));
    error.reportPath = reportJsonPath;
    throw error;
  } finally {
    if (provider && typeof provider.destroy === "function") provider.destroy();
    if (anvil.exitCode === null) anvil.kill("SIGTERM");
  }
}

if (require.main === module) {
  runFocusedSimulation().catch(error => {
    console.error(readableError(error));
    if (error.reportPath) console.error(`report=${error.reportPath}`);
    process.exitCode = 1;
  });
}

module.exports = {
  THIRTY_DAYS,
  PRINCIPAL,
  stakeDaoRouterClaimPlan,
  findBlockAtOrBefore,
  runFocusedSimulation
};
