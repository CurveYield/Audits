#!/usr/bin/env node
"use strict";

/**
 * Focused V18.9 marketplace revenue-cycle simulation.
 *
 * Runs the production deployment/configuration procedure on a Hardhat Ethereum
 * mainnet fork, hands ownership to the configured final owner, creates and fills
 * a live Stake DAO marketplace listing for exactly 100 USDC, forwards the full
 * Locker balance permissionlessly, completes one 14-day Revenue Staking stream,
 * harvests the compounder, and withdraws both 1,000-cyvlSDT positions.
 *
 * Required environment:
 *   ETHEREUM_RPC_URL=<Ethereum mainnet RPC URL>
 *
 * Optional:
 *   HARDHAT_PORT=8545
 *   HARDHAT_FORK_BLOCK=<pinned Ethereum block>
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const {
  ROOT,
  OWNABLE_CONTRACTS,
  ethers,
  loadConfig,
  contract,
  deployOne,
  saveState,
  writeJson
} = require("./lib-v18");
const { deployAndConfigure } = require("./deploy-configure-v18");
const { proposeHandoff } = require("./propose-handoff-v18.9-fixed");
const { verifyDeployment } = require("./verify-deployment-v18");
const { waitForRpc } = require("./simulate-all-functions-v18");
const {
  setEthBalance,
  withImpersonatedSigner,
  fundErc20FromRealHolder
} = require("./simulation-v18/actors-v18");

const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;
const STREAM_DURATION = 14 * DAY;
const PRINCIPAL = ethers.parseEther("1000");
const TOTAL_SDT_FUNDING = PRINCIPAL * 2n;
const PURCHASE_USDC = ethers.parseUnits("100", 6);
const EXPECTED_REVIEWED_SCRIPT_HASH =
  "213825aadf4074383d4a91d5a8c79de2ff93fc625979e93217906a54319780d3";
const HARDHAT_DEFAULT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const MAINNET_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const MAINNET_WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const MAINNET_WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const TRICRYPTO_USDC_POOL = "0x7F86Bf177Dd4F3494b841a37e810A34dD56c829B";
const SDT_WETH_POOL = "0xA19bf6fBf05624282cb6ed498f4761f22e084Edd";

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address recipient,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const LIVE_VLSDT_ABI = [
  "function balanceOf(address account) view returns (uint256)"
];

const MARKETPLACE_ABI = [
  "function nextOrderId() view returns (uint256)",
  "function minOrderAmount() view returns (uint256)",
  "function minFillAmount() view returns (uint256)",
  "function maxDurationWeeks() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function getListing(uint256 listingId) view returns (tuple(address seller,uint96 pricePerWeek,address paymentToken,uint32 maxDuration,uint64 expiry,uint128 amount,uint128 filled,uint32 minDuration))",
  "function fillListing(uint256 listingId,uint256 fillAmount,uint256 duration,uint256 maxTotalPayment,uint256 maxEffectiveDuration,address recipient)",
  "event ListingFilled(uint256 indexed listingId,address indexed buyer,address indexed recipient,uint256 amount,uint256 duration,uint256 totalPaid)"
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
  return String(
    error && (
      error.shortMessage
      || error.reason
      || (error.info && error.info.error && error.info.error.message)
      || error.message
      || error
    )
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEq(actual, expected, label) {
  if (BigInt(actual) !== BigInt(expected)) {
    throw new Error(`${label}: ${actual} != ${expected}`);
  }
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function maximum(...values) {
  return values.reduce((a, b) => a > b ? a : b);
}

function fileSha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function makeActor(provider, label) {
  const privateKey = ethers.keccak256(
    ethers.toUtf8Bytes(`CurveYield-v18.9-marketplace-simulation:${label}`)
  );
  return new ethers.Wallet(privateKey, provider);
}

async function latestTimestamp(provider) {
  return Number((await provider.getBlock("latest")).timestamp);
}

async function advanceExactly(provider, seconds) {
  const before = await latestTimestamp(provider);
  await provider.send("evm_setNextBlockTimestamp", [before + Number(seconds)]);
  await provider.send("evm_mine", []);
  const after = await latestTimestamp(provider);
  assert(after - before === Number(seconds), `time advance ${after - before} != ${seconds}`);
  return { before, after, elapsedSeconds: Number(seconds) };
}

async function pendingNonce(provider, address) {
  return Number(await provider.send("eth_getTransactionCount", [address, "pending"]));
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
  assert(receipt.status === 1, `${label} failed`);
  return {
    label,
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    logs: receipt.logs
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

async function acceptOwnershipByImpersonation({ provider, ctx }) {
  const finalOwner = ctx.config.finalOwner;
  const receipts = [];
  await withImpersonatedSigner(provider, finalOwner, async signer => {
    for (const [key] of OWNABLE_CONTRACTS) {
      const target = contract(ctx, key, signer);
      if (ethers.getAddress(await target.owner()) === finalOwner) continue;
      assert(
        ethers.getAddress(await target.pendingOwner()) === finalOwner,
        `${key} final owner is not pending`
      );
      receipts.push(await sendTx(
        provider,
        target,
        signer,
        "acceptOwnership()",
        [],
        `${key}.acceptOwnership`
      ));
    }
  });
  ctx.state.phase = "ownership-accepted";
  saveState(ctx.stateFile, ctx.state);
  return receipts;
}

function calculateListingTerms({
  targetPayment,
  effectiveDuration,
  minimumFill,
  capacity
}) {
  assert(capacity >= minimumFill, "marketplace minimum exceeds Merchant boost capacity");
  const desiredFill = minimumFill + (capacity - minimumFill) / 2n;
  const priceNumerator = targetPayment * BigInt(WEEK) * 10n ** 18n;
  let pricePerWeek = priceNumerator / (desiredFill * effectiveDuration);
  if (pricePerWeek === 0n) pricePerWeek = 1n;

  const fillAmount = ceilDiv(
    targetPayment * BigInt(WEEK) * 10n ** 18n,
    pricePerWeek * effectiveDuration
  );
  const totalPayment = fillAmount * pricePerWeek * effectiveDuration
    / BigInt(WEEK) / 10n ** 18n;

  assert(fillAmount >= minimumFill, "derived listing fill is below the marketplace minimum");
  assert(fillAmount <= capacity, "derived listing fill exceeds Merchant boost capacity");
  assertEq(totalPayment, targetPayment, "derived marketplace total payment");
  assert(pricePerWeek <= (1n << 96n) - 1n, "derived listing price exceeds uint96");
  return { pricePerWeek, fillAmount, totalPayment };
}

function markdownReport(report) {
  const status = String(report.status || "unknown").toUpperCase();
  const lines = [
    "# CurveYield V18.9 Marketplace Revenue Cycle",
    "",
    `**Status:** ${status}`,
    "",
    `- Fork block: ${report.forkBlock ?? "not reached"}`,
    `- Contracts deployed: ${report.deployedContractCount ?? 0}`,
    `- Reviewed 30-day script SHA-256: \`${report.reviewedScriptHash || "not checked"}\``,
    `- Marketplace listing: ${report.marketplace?.listingId ?? "not reached"}`,
    `- Marketplace payment: ${report.marketplace?.totalPaidUsdc ?? "not reached"} USDC base units`,
    `- Revenue forwarded: ${report.forwarding?.forwardedUsdc ?? "not reached"} USDC base units`,
    `- Direct staker USDC claimed: ${report.harvest?.directUsdcClaimed ?? "not reached"}`,
    `- Vault price before harvest: ${report.harvest?.vaultPriceBefore ?? "not reached"}`,
    `- Vault price after harvest: ${report.harvest?.vaultPriceAfter ?? "not reached"}`,
    ""
  ];
  if (report.failures && report.failures.length) {
    lines.push("## Failures", "");
    for (const failure of report.failures) lines.push(`- ${failure}`);
    lines.push("");
  }
  lines.push("## Artifacts", "", `- JSON: \`${path.basename(report.paths?.json || "")}\``, `- Execution log: \`${path.basename(report.paths?.log || "")}\``, "");
  return `${lines.join("\n")}\n`;
}

async function runMarketplaceRevenueCycle(options = {}) {
  const configPath = options.configPath || process.argv[2] || "config-mainnet-v18.json";
  const { config } = loadConfig(configPath);
  const forkUrl = options.forkUrl || process.env.ETHEREUM_RPC_URL;
  if (!forkUrl) throw new Error("ETHEREUM_RPC_URL is required");

  const reviewedScript = path.join(ROOT, "deployment-v18", "simulate-live-deployment-30d-v18.9.js");
  const reviewedScriptHash = fileSha256(reviewedScript);
  assert(
    reviewedScriptHash === EXPECTED_REVIEWED_SCRIPT_HASH,
    `reviewed script SHA-256: ${reviewedScriptHash} != ${EXPECTED_REVIEWED_SCRIPT_HASH}`
  );

  const tag = options.tag || `marketplace-revenue-cycle-v18.9-${Date.now()}`;
  const outputDir = path.join(ROOT, "deployment-output-v18");
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${tag}.json`);
  const markdownPath = path.join(outputDir, `${tag}.md`);
  const logPath = path.join(outputDir, `${tag}.log`);
  const executionLog = [];
  const log = message => {
    const line = `${new Date().toISOString()} ${message}`;
    executionLog.push(line);
    console.log(line);
  };

  const port = Number(options.port || process.env.HARDHAT_PORT || config.deployment.anvilPort || 8545);
  const localUrl = `http://127.0.0.1:${port}`;
  const forkBlock = options.forkBlock
    || process.env.HARDHAT_FORK_BLOCK
    || process.env.ANVIL_FORK_BLOCK
    || config.deployment.anvilForkBlockNumber;
  const hardhatCli = require.resolve("hardhat/internal/cli/cli");
  const childOutputTail = [];
  const child = spawn(
    process.execPath,
    [hardhatCli, "node", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        CURVEYIELD_HARDHAT_FORK_URL: forkUrl,
        ...(forkBlock ? { CURVEYIELD_HARDHAT_FORK_BLOCK: String(forkBlock) } : {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => {
      childOutputTail.push(String(chunk));
      if (childOutputTail.length > 80) childOutputTail.shift();
    });
  }

  let provider;
  let ctx;
  const report = {
    release: config.release,
    status: "running",
    runner: "Hardhat Ethereum mainnet fork",
    reviewedScriptHash,
    expectedReviewedScriptHash: EXPECTED_REVIEWED_SCRIPT_HASH,
    paths: { json: jsonPath, markdown: markdownPath, log: logPath },
    failures: []
  };

  try {
    provider = await waitForRpc(localUrl, child, childOutputTail);
    report.forkBlock = await provider.getBlockNumber();
    report.forkTimestamp = await latestTimestamp(provider);
    log(`Hardhat fork ready at block ${report.forkBlock}`);

    const deployer = new ethers.Wallet(HARDHAT_DEFAULT_PRIVATE_KEY, provider);
    await setEthBalance(provider, deployer.address, ethers.parseEther("10000"));
    await setEthBalance(provider, config.finalOwner, ethers.parseEther("1000"));

    ctx = await deployAndConfigure({
      configPath,
      rpcUrl: localUrl,
      privateKey: deployer.privateKey,
      tag,
      confirmations: 1
    });
    report.canonicalDeployedContractCount = Object.keys(ctx.state.contracts).length;
    assertEq(report.canonicalDeployedContractCount, 14, "canonical deployed contract count");
    log("All 14 canonical production contracts deployed and configured");

    await proposeHandoff({
      configPath,
      rpcUrl: localUrl,
      privateKey: deployer.privateKey,
      tag,
      confirmations: 1,
      stateFile: ctx.stateFile,
      simulation: true
    });
    ctx.state = JSON.parse(fs.readFileSync(ctx.stateFile, "utf8"));
    report.handoffReceipts = await acceptOwnershipByImpersonation({ provider, ctx });
    await verifyDeployment({
      configPath,
      rpcUrl: localUrl,
      privateKey: deployer.privateKey,
      tag,
      expectedOwner: config.finalOwner,
      expectedAdmin: config.finalAdmin
    });
    log("Ownership handoff and canonical deployment verification passed");

    const revenueConverter = contract(ctx, "revenueConverter");
    const usdcAddress = ethers.getAddress(
      ctx.state.external.feeDistributorRewardTokens.usdc
    );
    assert(
      usdcAddress === ethers.getAddress(MAINNET_USDC),
      `live vlSDT USDC reward token ${usdcAddress} != ${MAINNET_USDC}`
    );
    const usdcToSdtConverter = await deployOne(
      ctx,
      "usdcToSdtConverter",
      "CurveYieldUsdcToSdtConverter",
      [
        await revenueConverter.getAddress(),
        usdcAddress,
        MAINNET_WBTC,
        MAINNET_WETH,
        config.stakeDao.sdt,
        TRICRYPTO_USDC_POOL,
        SDT_WETH_POOL
      ]
    );
    await withImpersonatedSigner(provider, config.finalOwner, async finalOwnerSigner => {
      await sendTx(
        provider,
        revenueConverter,
        finalOwnerSigner,
        "setUsdcRoute(address,address)",
        [usdcAddress, await usdcToSdtConverter.getAddress()],
        "revenueConverter.setUsdcRoute"
      );
    });
    assert(
      ethers.getAddress(await revenueConverter.usdc()) === usdcAddress,
      "RevenueConverter USDC token mismatch"
    );
    assert(
      ethers.getAddress(await revenueConverter.usdcAdapter())
        === ethers.getAddress(await usdcToSdtConverter.getAddress()),
      "RevenueConverter USDC route mismatch"
    );
    report.deployedContractCount = Object.keys(ctx.state.contracts).length;
    assertEq(report.deployedContractCount, 15, "deployed contract count with fixed USDC route");
    report.usdcToSdtConverter = await usdcToSdtConverter.getAddress();
    log("Fixed USDC-to-SDT converter deployed as contract 15 and configured by final owner");

    const actors = {
      funder: makeActor(provider, "funder"),
      directUser: makeActor(provider, "direct-user"),
      vaultUser: makeActor(provider, "vault-user"),
      buyer: makeActor(provider, "buyer"),
      buyerRecipient: makeActor(provider, "buyer-recipient"),
      keeper: makeActor(provider, "keeper")
    };
    for (const actor of Object.values(actors)) {
      await setEthBalance(provider, actor.address, ethers.parseEther("100"));
    }

    const locker = contract(ctx, "locker");
    const cyvlSdt = contract(ctx, "cyvlSdt");
    const revenueStaking = contract(ctx, "revenueStaking");
    const revenueVault = contract(ctx, "revenueVault");
    const revenueStrategy = contract(ctx, "revenueStrategy");
    const boostMerchant = contract(ctx, "boostMerchant");
    const sdt = new ethers.Contract(config.stakeDao.sdt, ERC20_ABI, provider);
    const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
    const liveVlSdt = new ethers.Contract(config.stakeDao.vlSdt, LIVE_VLSDT_ABI, provider);
    const marketplace = new ethers.Contract(config.stakeDao.boostMarketplace, MARKETPLACE_ABI, provider);

    await withImpersonatedSigner(provider, config.finalOwner, async finalOwnerSigner => {
      if (!(await revenueStaking.isRewardToken(usdcAddress))) {
        await sendTx(
          provider,
          revenueStaking,
          finalOwnerSigner,
          "addRewardToken(address)",
          [usdcAddress],
          "revenueStaking.addRewardToken(USDC)"
        );
      }
      if (!(await boostMerchant.isKeeper(actors.keeper.address))) {
        await sendTx(
          provider,
          boostMerchant,
          finalOwnerSigner,
          "setKeeper(address,bool)",
          [actors.keeper.address, true],
          "boostMerchant.setKeeper"
        );
      }
    });

    report.sdtFunding = await fundErc20FromRealHolder({
      provider,
      tokenAddress: config.stakeDao.sdt,
      recipient: actors.funder.address,
      amount: TOTAL_SDT_FUNDING,
      candidates: [
        SDT_WETH_POOL,
        config.stakeDao.vlSdt,
        config.stakeDao.vlSdtFeeDistributorSdt,
        config.stakeDao.boostMarketplace,
        config.finalOwner
      ]
    });
    await sendTx(provider, sdt, actors.funder, "transfer(address,uint256)", [actors.directUser.address, PRINCIPAL], "fund direct user");
    await sendTx(provider, sdt, actors.funder, "transfer(address,uint256)", [actors.vaultUser.address, PRINCIPAL], "fund vault user");

    for (const [label, actor] of [["direct", actors.directUser], ["vault", actors.vaultUser]]) {
      await sendTx(provider, sdt, actor, "approve(address,uint256)", [await locker.getAddress(), PRINCIPAL], `${label} approve Locker`);
      await sendTx(provider, locker, actor, "deposit(uint256,address)", [PRINCIPAL, actor.address], `${label} 1,000 SDT Locker deposit`);
      assertEq(await cyvlSdt.balanceOf(actor.address), PRINCIPAL, `${label} cyvlSDT minted`);
    }
    assertEq(await cyvlSdt.totalSupply(), TOTAL_SDT_FUNDING, "cyvlSDT total supply after two deposits");
    assertEq(await liveVlSdt.balanceOf(await locker.getAddress()), TOTAL_SDT_FUNDING, "live vlSDT Locker backing");
    log("Two real 1,000 SDT deposits minted live-backed cyvlSDT");

    await sendTx(provider, cyvlSdt, actors.directUser, "approve(address,uint256)", [await revenueStaking.getAddress(), PRINCIPAL], "direct approve Revenue Staking");
    await sendTx(provider, revenueStaking, actors.directUser, "stake(uint256)", [PRINCIPAL], "direct Revenue Staking stake");
    await sendTx(provider, cyvlSdt, actors.vaultUser, "approve(address,uint256)", [await revenueVault.getAddress(), PRINCIPAL], "vault approve");
    await sendTx(provider, revenueVault, actors.vaultUser, "deposit(uint256)", [PRINCIPAL], "Revenue Vault deposit");
    assertEq(await revenueStaking.activeBalance(actors.directUser.address), PRINCIPAL, "direct active Revenue Staking balance");
    assert((await revenueVault.balanceOf(actors.vaultUser.address)) > 0n, "Revenue Vault minted no shares");
    log("Direct Revenue Staking and compounder staking succeeded");

    report.usdcFunding = await fundErc20FromRealHolder({
      provider,
      tokenAddress: usdcAddress,
      recipient: actors.buyer.address,
      amount: PURCHASE_USDC,
      candidates: [
        TRICRYPTO_USDC_POOL,
        config.stakeDao.vlSdtFeeDistributorUsdc,
        config.stakeDao.boostMarketplace,
        config.finalOwner
      ]
    });
    await sendTx(provider, usdc, actors.buyer, "approve(address,uint256)", [await marketplace.getAddress(), PURCHASE_USDC], "buyer approve marketplace");

    const marketplaceMinimum = maximum(
      await marketplace.minOrderAmount(),
      await marketplace.minFillAmount(),
      1n
    );
    assert((await marketplace.maxDurationWeeks()) >= 2n, "live marketplace maximum duration is below two weeks");
    const capacity = await locker.boostMerchantDelegableBoost();
    const pricingTimestamp = await latestTimestamp(provider);
    const fillTimestamp = pricingTimestamp + 60;
    const endtime = Math.ceil((fillTimestamp + WEEK) / WEEK) * WEEK;
    const effectiveDuration = BigInt(endtime - fillTimestamp);
    assert(effectiveDuration <= 2n * BigInt(WEEK), "one-week purchase exceeds two-week listing maximum");
    const terms = calculateListingTerms({
      targetPayment: PURCHASE_USDC,
      effectiveDuration,
      minimumFill: marketplaceMinimum,
      capacity
    });

    await withImpersonatedSigner(provider, config.finalOwner, async finalOwnerSigner => {
      await sendTx(
        provider,
        boostMerchant,
        finalOwnerSigner,
        "setPaymentToken(address,bool,uint256,uint256)",
        [usdcAddress, true, terms.pricePerWeek, terms.pricePerWeek],
        "boostMerchant.setPaymentToken(USDC)"
      );
    });

    const listingId = await marketplace.nextOrderId();
    await sendTx(
      provider,
      boostMerchant,
      actors.keeper,
      "createMarketplaceListing(address,uint256,uint256,uint256,uint256)",
      [usdcAddress, terms.fillAmount, 1, 2, 0],
      "boostMerchant.createMarketplaceListing"
    );
    const listing = await marketplace.getListing(listingId);
    assert(ethers.getAddress(listing.seller) === ethers.getAddress(await locker.getAddress()), "listing seller is not Locker");
    assertEq(listing.maxDuration, 2n, "listing maximum duration");
    assertEq(listing.pricePerWeek, terms.pricePerWeek, "listing price");
    log(`Live Stake DAO listing ${listingId} created`);

    assert((await latestTimestamp(provider)) < fillTimestamp, "fill timestamp setup window exhausted");
    await provider.send("evm_setNextBlockTimestamp", [fillTimestamp]);
    const fillTx = await marketplace.connect(actors.buyer).fillListing(
      listingId,
      terms.fillAmount,
      1,
      PURCHASE_USDC,
      0,
      actors.buyerRecipient.address,
      { gasLimit: 2_000_000n }
    );
    const fillReceipt = await fillTx.wait();
    assert(fillReceipt.status === 1, "marketplace fill failed");
    const fillEvent = parseEvent(marketplace.interface, fillReceipt.logs, "ListingFilled");
    assert(fillEvent, "ListingFilled event missing");
    assertEq(fillEvent.args.totalPaid, PURCHASE_USDC, "marketplace total paid");
    const lockerUsdcAfterFill = await usdc.balanceOf(await locker.getAddress());
    assert(lockerUsdcAfterFill > 0n, "marketplace transferred no USDC to Locker");
    report.marketplace = {
      listingId,
      pricePerWeek: terms.pricePerWeek,
      fillAmount: terms.fillAmount,
      requestedDurationWeeks: 1,
      listingMaximumDurationWeeks: 2,
      effectiveDurationSeconds: effectiveDuration,
      totalPaidUsdc: fillEvent.args.totalPaid,
      marketplaceFeeBps: await marketplace.feeBps(),
      lockerUsdcAfterFill,
      transactionHash: fillReceipt.hash
    };
    log("100 USDC live marketplace purchase succeeded without EXCEEDS_MAX_DURATION()");

    const revenueUsdcBefore = await usdc.balanceOf(await revenueStaking.getAddress());
    const converterUsdcBeforeForward = await usdc.balanceOf(await revenueConverter.getAddress());
    const converterSdtBeforeForward = await sdt.balanceOf(await revenueConverter.getAddress());
    const forwardReceipt = await sendTx(
      provider,
      locker,
      actors.keeper,
      "forwardMarketplaceRevenue(address)",
      [usdcAddress],
      "permissionless marketplace revenue forwarding"
    );
    const revenueUsdcAfter = await usdc.balanceOf(await revenueStaking.getAddress());
    const converterUsdcAfterForward = await usdc.balanceOf(await revenueConverter.getAddress());
    const converterSdtAfterForward = await sdt.balanceOf(await revenueConverter.getAddress());
    assertEq(await usdc.balanceOf(await locker.getAddress()), 0n, "Locker USDC after forwarding");
    assert(revenueUsdcAfter > revenueUsdcBefore, "Revenue Staking received no USDC");
    assertEq(
      converterUsdcAfterForward,
      converterUsdcBeforeForward,
      "RevenueConverter balance changed during forwarding (USDC)"
    );
    assertEq(
      converterSdtAfterForward,
      converterSdtBeforeForward,
      "RevenueConverter balance changed during forwarding (SDT)"
    );
    report.forwarding = {
      forwardedUsdc: lockerUsdcAfterFill,
      revenueStakingBalanceDelta: revenueUsdcAfter - revenueUsdcBefore,
      converterUsdcBalanceDelta: converterUsdcAfterForward - converterUsdcBeforeForward,
      converterSdtBalanceDelta: converterSdtAfterForward - converterSdtBeforeForward,
      transactionHash: forwardReceipt.hash
    };
    log("Permissionless forward-all sent the complete Locker USDC balance to Revenue Staking");

    report.pendingPeriod = await advanceExactly(provider, DAY);
    const cycleReceipt = await sendTx(
      provider,
      revenueStaking,
      actors.keeper,
      "startRewardCycle(address)",
      [usdcAddress],
      "start USDC reward cycle"
    );
    report.streamAdvance = await advanceExactly(provider, STREAM_DURATION);
    log("One complete 14-day USDC reward stream elapsed");

    const directUsdcBefore = await usdc.balanceOf(actors.directUser.address);
    const directClaim = await sendTx(
      provider,
      revenueStaking,
      actors.directUser,
      "claimRewards(address)",
      [actors.directUser.address],
      "direct staker claimRewards"
    );
    const directUsdcClaimed = await usdc.balanceOf(actors.directUser.address) - directUsdcBefore;
    assert(directUsdcClaimed > 0n, "direct Revenue Staking user claimed no USDC");

    const vaultPriceBefore = await revenueVault.getPricePerFullShare();
    const vaultBalanceBefore = await revenueVault.balance();
    const routeUsdcBeforeHarvest = await usdc.balanceOf(await usdcToSdtConverter.getAddress());
    const routeSdtBeforeHarvest = await sdt.balanceOf(await usdcToSdtConverter.getAddress());
    const strategyActiveBefore = await revenueStaking.activeBalance(await revenueStrategy.getAddress());
    const harvestReceipt = await sendTx(
      provider,
      revenueStrategy,
      actors.keeper,
      "harvest(address)",
      [actors.keeper.address],
      "Revenue Strategy harvest"
    );
    const vaultPriceAfter = await revenueVault.getPricePerFullShare();
    const vaultBalanceAfter = await revenueVault.balance();
    const strategyActiveAfter = await revenueStaking.activeBalance(await revenueStrategy.getAddress());
    const routeUsdcAfterHarvest = await usdc.balanceOf(await usdcToSdtConverter.getAddress());
    const routeSdtAfterHarvest = await sdt.balanceOf(await usdcToSdtConverter.getAddress());
    assertEq(routeUsdcAfterHarvest, routeUsdcBeforeHarvest, "USDC route retained USDC after harvest");
    assertEq(routeSdtAfterHarvest, routeSdtBeforeHarvest, "USDC route retained SDT after harvest");
    assert(
      vaultPriceAfter > vaultPriceBefore || vaultBalanceAfter > vaultBalanceBefore || strategyActiveAfter > strategyActiveBefore,
      "compounder harvest produced no measurable increase"
    );
    report.harvest = {
      cycleTransactionHash: cycleReceipt.hash,
      directClaimTransactionHash: directClaim.hash,
      directUsdcClaimed,
      harvestTransactionHash: harvestReceipt.hash,
      vaultPriceBefore,
      vaultPriceAfter,
      vaultBalanceBefore,
      vaultBalanceAfter,
      strategyActiveBefore,
      strategyActiveAfter,
      routeUsdcBeforeHarvest,
      routeUsdcAfterHarvest,
      routeSdtBeforeHarvest,
      routeSdtAfterHarvest
    };
    log("Direct claim and compounder harvest succeeded");

    const directActive = await revenueStaking.activeBalance(actors.directUser.address);
    const directCyvlBefore = await cyvlSdt.balanceOf(actors.directUser.address);
    const directWithdraw = await sendTx(
      provider,
      revenueStaking,
      actors.directUser,
      "withdrawImmediate(uint256,address)",
      [directActive, actors.directUser.address],
      "direct Revenue Staking withdrawal"
    );
    const directCyvlReceived = await cyvlSdt.balanceOf(actors.directUser.address) - directCyvlBefore;
    assert(directCyvlReceived > 0n, "direct withdrawal returned no cyvlSDT");
    assertEq(await revenueStaking.activeBalance(actors.directUser.address), 0n, "direct remaining active stake");

    const vaultShares = await revenueVault.balanceOf(actors.vaultUser.address);
    const vaultCyvlBefore = await cyvlSdt.balanceOf(actors.vaultUser.address);
    const vaultWithdraw = await sendTx(
      provider,
      revenueVault,
      actors.vaultUser,
      "withdrawAll()",
      [],
      "Revenue Vault withdrawal"
    );
    const vaultCyvlReceived = await cyvlSdt.balanceOf(actors.vaultUser.address) - vaultCyvlBefore;
    assert(vaultCyvlReceived > 0n, "vault withdrawal returned no cyvlSDT");
    assertEq(await revenueVault.balanceOf(actors.vaultUser.address), 0n, "vault remaining shares");
    report.withdrawals = {
      directStakedAmount: directActive,
      directCyvlReceived,
      directTransactionHash: directWithdraw.hash,
      vaultShares,
      vaultCyvlReceived,
      vaultTransactionHash: vaultWithdraw.hash
    };
    log("Direct staking and compounder positions withdrew through their real paths");

    report.status = "passed";
    report.finalBlock = await provider.getBlockNumber();
    report.finalTimestamp = await latestTimestamp(provider);
    writeJson(jsonPath, serialize(report));
    fs.writeFileSync(markdownPath, markdownReport(serialize(report)));
    fs.writeFileSync(logPath, `${executionLog.join("\n")}\n`);
    console.log(`MARKETPLACE REVENUE CYCLE PASSED report=${jsonPath}`);
    return { report: serialize(report), paths: report.paths };
  } catch (error) {
    report.status = "failed";
    report.failures.push(errorText(error));
    report.hardhatTail = childOutputTail.join("").slice(-20_000);
    writeJson(jsonPath, serialize(report));
    fs.writeFileSync(markdownPath, markdownReport(serialize(report)));
    executionLog.push(`${new Date().toISOString()} FAILURE ${errorText(error)}`);
    fs.writeFileSync(logPath, `${executionLog.join("\n")}\n`);
    error.reportPath = jsonPath;
    throw error;
  } finally {
    if (provider && typeof provider.destroy === "function") provider.destroy();
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

if (require.main === module) {
  runMarketplaceRevenueCycle().catch(error => {
    console.error(error);
    if (error.reportPath) console.error(`report=${error.reportPath}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PRINCIPAL,
  PURCHASE_USDC,
  calculateListingTerms,
  runMarketplaceRevenueCycle
};
