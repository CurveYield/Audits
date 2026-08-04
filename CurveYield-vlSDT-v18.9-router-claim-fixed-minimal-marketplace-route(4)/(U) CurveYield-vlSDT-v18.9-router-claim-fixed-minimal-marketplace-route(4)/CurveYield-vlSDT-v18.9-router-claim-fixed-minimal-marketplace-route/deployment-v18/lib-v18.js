#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_FINAL_OWNER = "0x9f2B20A772246960810045905B7daccf960eE288";

const DEPLOYABLES = [
  ["governanceToken", "CurveYieldGovernanceToken"],
  ["governanceStaking", "CurveYieldGovernanceStaking"],
  ["governanceMintController", "CurveYieldGovernanceMintController"],
  ["governanceBoostStrategy", "CurveYieldGovernanceBoostStrategy"],
  ["cyvlSdt", "CurveYieldVlSDTToken"],
  ["locker", "CurveYieldVlSDTLocker"],
  ["cyGovYieldStaking", "CurveYieldCyGovYieldStaking"],
  ["revenueStaking", "CurveYieldVlSDTRevenueStaking"],
  ["boostStaking", "CurveYieldVlSDTBoostStaking"],
  ["boostMerchant", "CurveYieldVlSDTBoostMerchant"],
  ["revenueVault", "CurveYieldRevenueVaultV7"],
  ["revenueConverter", "CurveYieldRevenueConverter"],
  ["revenueStrategy", "CurveYieldRevenueStrategyV7"],
  ["cyGovDistributor", "CurveYieldCyGovDistributor"]
];

const OWNABLE_CONTRACTS = DEPLOYABLES.filter(([key]) => !["governanceBoostStrategy", "cyGovDistributor"].includes(key));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n"
  );
}

function requireAddress(label, value) {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${label} must be a non-zero address`);
  }
  return ethers.getAddress(value);
}

function optionalAddress(label, value) {
  if (value === null || value === undefined || value === "") return ethers.ZeroAddress;
  if (!ethers.isAddress(value)) throw new Error(`${label} must be an address or null`);
  return ethers.getAddress(value);
}

function integerInRange(label, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

function loadConfig(configPath) {
  const resolved = path.resolve(configPath || path.join(ROOT, "config-mainnet-v18.json"));
  const c = readJson(resolved);
  if (c.version !== 18 || c.release !== "18.9" || c.chainId !== 1) {
    throw new Error("V18.9 Ethereum-mainnet config required");
  }

  c.finalOwner = requireAddress("finalOwner", c.finalOwner);
  c.finalAdmin = requireAddress("finalAdmin", c.finalAdmin);
  c.feeReceivers.treasury = requireAddress("feeReceivers.treasury", c.feeReceivers.treasury);
  if (c.finalOwner !== ethers.getAddress(EXPECTED_FINAL_OWNER)) {
    throw new Error(`finalOwner must be ${EXPECTED_FINAL_OWNER}`);
  }
  if (c.feeReceivers.treasury !== c.finalOwner) {
    throw new Error("feeReceivers.treasury must equal finalOwner");
  }

  for (const [key, value] of Object.entries(c.stakeDao)) {
    c.stakeDao[key] = requireAddress(`stakeDao.${key}`, value);
  }

  const gs = c.governanceStaking;
  integerInRange(
    "governanceStaking.initialStandardWithdrawFeeBps",
    gs.initialStandardWithdrawFeeBps,
    0,
    1500
  );
  integerInRange(
    "governanceStaking.initialBaseWithdrawFeeBps",
    gs.initialBaseWithdrawFeeBps,
    0,
    300
  );
  integerInRange(
    "governanceStaking.initialWithdrawalDelaySeconds",
    gs.initialWithdrawalDelaySeconds,
    0,
    150 * 86400
  );
  if (gs.initialStandardWithdrawFeeBps + gs.initialBaseWithdrawFeeBps > 10000) {
    throw new Error("combined governance-staking withdrawal fees exceed 100%");
  }

  gs.aragonVotingPlugin = optionalAddress(
    "governanceStaking.aragonVotingPlugin",
    gs.aragonVotingPlugin
  );
  gs.rewardTokens = (gs.rewardTokens || []).map((x, i) =>
    requireAddress(`governanceStaking.rewardTokens[${i}]`, x)
  );
  gs.notifiers = (gs.notifiers || []).map((x, i) =>
    requireAddress(`governanceStaking.notifiers[${i}]`, x)
  );

  c.governanceBoostStrategy = c.governanceBoostStrategy || {};
  c.governanceBoostStrategy.previousStrategy = optionalAddress(
    "governanceBoostStrategy.previousStrategy",
    c.governanceBoostStrategy.previousStrategy
  );

  c.revenueStakingConfig = c.revenueStakingConfig || {};
  integerInRange(
    "revenueStakingConfig.immediateWithdrawFeeBps",
    c.revenueStakingConfig.immediateWithdrawFeeBps,
    0,
    250
  );

  c.revenueVault = c.revenueVault || {};
  if (c.revenueVault.strategyApprovalDelaySeconds !== 7 * 86400) {
    throw new Error("revenueVault.strategyApprovalDelaySeconds must equal 604800");
  }
  integerInRange("revenueVault.withdrawalFeeBps", c.revenueVault.withdrawalFeeBps, 0, 100);
  integerInRange("revenueVault.performanceFeeBps", c.revenueVault.performanceFeeBps, 0, 900);
  integerInRange("revenueVault.callFeeBps", c.revenueVault.callFeeBps, 0, 100);
  if (c.revenueVault.performanceFeeBps + c.revenueVault.callFeeBps > 1000) {
    throw new Error("combined revenue-vault harvest fees exceed 10%");
  }

  c.revenueConverter = c.revenueConverter || {};
  c.revenueConverter.sdtSwapAdapter = optionalAddress(
    "revenueConverter.sdtSwapAdapter", c.revenueConverter.sdtSwapAdapter
  );
  c.revenueConverter.usdc = optionalAddress(
    "revenueConverter.usdc", c.revenueConverter.usdc
  );
  c.revenueConverter.usdcAdapter = optionalAddress(
    "revenueConverter.usdcAdapter", c.revenueConverter.usdcAdapter
  );
  if ((c.revenueConverter.usdc === ethers.ZeroAddress) !== (c.revenueConverter.usdcAdapter === ethers.ZeroAddress)) {
    throw new Error("revenueConverter.usdc and usdcAdapter must both be set or both be null");
  }

  c.cyGovYieldStaking = c.cyGovYieldStaking || {};
  integerInRange("cyGovYieldStaking.initialWithdrawFeeBps", c.cyGovYieldStaking.initialWithdrawFeeBps, 0, 400);
  integerInRange("cyGovYieldStaking.initialDailyDecayRate", c.cyGovYieldStaking.initialDailyDecayRate, 0, 10);
  for (const key of ["initialTargetYield", "initialMaxMintRate", "initialInventoryMint"]) {
    try { BigInt(c.cyGovYieldStaking[key] || "0"); }
    catch { throw new Error(`cyGovYieldStaking.${key} must be an integer string`); }
  }

  const minting = c.governanceMinting || {};
  const allocations = minting.allocations || {};
  if (minting.minimumAllocationBps !== 3000) {
    throw new Error("governanceMinting.minimumAllocationBps must equal 3000");
  }
  if (minting.allocationChangeDelaySeconds !== 14 * 86400) {
    throw new Error("governanceMinting.allocationChangeDelaySeconds must equal 1209600");
  }
  const expectedAllocations = {
    revenueStaking: { initialCap: 5_000_000_000n * 10n ** 18n, additionalBps: 800 },
    boostStaking: { initialCap: 10_000_000_000n * 10n ** 18n, additionalBps: 1200 },
    cyGovYieldStaking: { initialCap: 15_000_000_000n * 10n ** 18n, additionalBps: 3000 },
    governanceStaking: { initialCap: 20_000_000_000n * 10n ** 18n, additionalBps: 3000 }
  };
  let totalInitial = 0n;
  let totalAdditionalBps = 0;
  for (const [key, expected] of Object.entries(expectedAllocations)) {
    const allocation = allocations[key] || {};
    let initialCap;
    try {
      initialCap = BigInt(allocation.initialCap);
    } catch {
      throw new Error(`governanceMinting.allocations.${key}.initialCap must be an integer string`);
    }
    const additionalBps = integerInRange(
      `governanceMinting.allocations.${key}.additionalBps`,
      allocation.additionalBps,
      0,
      10000
    );
    if (initialCap !== expected.initialCap || additionalBps !== expected.additionalBps) {
      throw new Error(`governanceMinting.allocations.${key} does not match the approved V18.9 original quota`);
    }
    totalInitial += initialCap;
    totalAdditionalBps += additionalBps;
  }
  if (totalInitial > 200_000_000_000n * 10n ** 18n || totalAdditionalBps > 10000) {
    throw new Error("governance mint allocations exceed the token-level aggregate limits");
  }

  for (const key of ["revenueStaking", "boostStaking", "governanceStaking"]) {
    const schedule = minting[key] || {};
    let amount;
    try {
      amount = BigInt(schedule.periodicAmount || "0");
    } catch {
      throw new Error(`governanceMinting.${key}.periodicAmount must be an integer string`);
    }
    const interval = Number(schedule.periodicIntervalSeconds || 0);
    if (!Number.isSafeInteger(interval) || interval < 0) {
      throw new Error(`governanceMinting.${key}.periodicIntervalSeconds must be a non-negative safe integer`);
    }
    if ((amount === 0n) !== (interval === 0)) {
      throw new Error(`governanceMinting.${key} amount and interval must both be zero or both be non-zero`);
    }
  }

  return { config: c, configPath: resolved };
}

function artifactPath(name) {
  return path.join(ROOT, "artifacts-v18", "contracts", `${name}.sol`, `${name}.json`);
}

function loadArtifact(name) {
  const artifactFile = artifactPath(name);
  if (!fs.existsSync(artifactFile)) {
    throw new Error(`Missing artifact ${artifactFile}. Run npm run compile:v18 first.`);
  }
  const artifact = readJson(artifactFile);
  if (!artifact.bytecode || artifact.bytecode === "0x") {
    throw new Error(`Artifact ${name} has no deployable bytecode`);
  }
  return artifact;
}

function statePath(chainId, tag = "live") {
  return path.join(ROOT, "deployment-output-v18", `deployment-state-v18-${tag}-${chainId}.json`);
}

function loadState(file, chainId, deployer) {
  if (fs.existsSync(file)) return readJson(file);
  return {
    version: 18,
    chainId: String(chainId),
    deployer,
    phase: "new",
    contracts: {},
    transactions: [],
    gasUsed: "0"
  };
}

function saveState(file, state) {
  writeJson(file, state);
}

function gasLimit(estimate, bps) {
  return estimate * BigInt(bps || 12000) / 10000n + 25000n;
}

async function pendingNonce(ctx) {
  const value = await ctx.provider.send(
    "eth_getTransactionCount",
    [ctx.wallet.address, "pending"]
  );
  return Number(value);
}

async function codeExists(provider, address) {
  return (await provider.getCode(address)) !== "0x";
}

async function recordReceipt(state, label, receipt) {
  const used = receipt.gasUsed || 0n;
  state.gasUsed = (BigInt(state.gasUsed || "0") + used).toString();
  state.transactions.push({
    label,
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: used.toString(),
    status: receipt.status
  });
}

async function deployOne(ctx, key, name, args) {
  const existing = ctx.state.contracts[key];
  if (existing && await codeExists(ctx.provider, existing.address)) {
    return new ethers.Contract(existing.address, loadArtifact(name).abi, ctx.wallet);
  }
  const artifact = loadArtifact(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, ctx.wallet);
  const txRequest = await factory.getDeployTransaction(...args);
  const estimate = await ctx.provider.estimateGas({ ...txRequest, from: ctx.wallet.address });
  const nonce = await pendingNonce(ctx);
  const deployed = await factory.deploy(...args, {
    gasLimit: gasLimit(estimate, ctx.config.deployment.gasLimitMultiplierBps),
    nonce
  });
  const receipt = await deployed.deploymentTransaction().wait(ctx.confirmations);
  const address = await deployed.getAddress();
  ctx.state.contracts[key] = {
    name,
    address,
    constructorArgs: args.map(String),
    deploymentTx: receipt.hash,
    deploymentGas: receipt.gasUsed.toString()
  };
  await recordReceipt(ctx.state, `deploy:${name}`, receipt);
  saveState(ctx.stateFile, ctx.state);
  console.log(`deployed ${name} ${address} gas=${receipt.gasUsed}`);
  return deployed;
}

async function send(ctx, label, target, method, args = []) {
  const populated = await target[method].populateTransaction(...args);
  const estimate = await ctx.provider.estimateGas({ ...populated, from: ctx.wallet.address });
  const nonce = await pendingNonce(ctx);
  const tx = await target[method](...args, {
    gasLimit: gasLimit(estimate, ctx.config.deployment.gasLimitMultiplierBps),
    nonce
  });
  const receipt = await tx.wait(ctx.confirmations);
  await recordReceipt(ctx.state, label, receipt);
  saveState(ctx.stateFile, ctx.state);
  console.log(`${label} gas=${receipt.gasUsed} tx=${receipt.hash}`);
  return receipt;
}

async function makeContext({
  configPath,
  rpcUrl,
  privateKey,
  tag = "live",
  confirmations,
  stateFile,
  allowWalletMismatch = false
} = {}) {
  const { config } = loadConfig(configPath);
  if (!rpcUrl) throw new Error("RPC URL required");
  if (!privateKey) throw new Error("private key required");
  const provider = new ethers.JsonRpcProvider(
    rpcUrl,
    config.chainId,
    { staticNetwork: true, batchMaxCount: 1 }
  );
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error(`wrong chain: ${network.chainId}, expected ${config.chainId}`);
  }
  const file = stateFile || statePath(network.chainId, tag);
  const state = loadState(file, network.chainId, wallet.address);
  if (!allowWalletMismatch && ethers.getAddress(state.deployer) !== wallet.address) {
    throw new Error("state deployer differs from current wallet");
  }
  return {
    config,
    provider,
    wallet,
    state,
    stateFile: file,
    confirmations: confirmations ?? config.deployment.confirmations
  };
}

function contract(ctx, key, signer = ctx.wallet) {
  const pair = DEPLOYABLES.find(([candidate]) => candidate === key);
  if (!pair || !ctx.state.contracts[key]) throw new Error(`missing deployed contract ${key}`);
  return new ethers.Contract(ctx.state.contracts[key].address, loadArtifact(pair[1]).abi, signer);
}

async function assertExternalDependencies(provider, config) {
  for (const [label, address] of Object.entries(config.stakeDao)) {
    if (!await codeExists(provider, address)) throw new Error(`${label} has no code: ${address}`);
  }
  const usdcDistributor = new ethers.Contract(
    config.stakeDao.vlSdtFeeDistributorUsdc,
    ["function REWARD_TOKEN() view returns (address)"],
    provider
  );
  const sdtDistributor = new ethers.Contract(
    config.stakeDao.vlSdtFeeDistributorSdt,
    ["function REWARD_TOKEN() view returns (address)"],
    provider
  );
  const usdc = requireAddress(
    "vlSdtFeeDistributorUsdc.REWARD_TOKEN",
    await usdcDistributor.REWARD_TOKEN()
  );
  const sdt = requireAddress(
    "vlSdtFeeDistributorSdt.REWARD_TOKEN",
    await sdtDistributor.REWARD_TOKEN()
  );
  if (!await codeExists(provider, usdc)) {
    throw new Error(`USDC fee distributor reward token has no code: ${usdc}`);
  }
  if (!await codeExists(provider, sdt)) {
    throw new Error(`SDT fee distributor reward token has no code: ${sdt}`);
  }
  if (sdt !== config.stakeDao.sdt) {
    throw new Error(`SDT fee distributor reward token mismatch: ${sdt}`);
  }
  return { usdc, sdt, all: [usdc, sdt] };
}

async function assertOwner(target, expected, label) {
  const actual = ethers.getAddress(await target.owner());
  if (actual !== ethers.getAddress(expected)) {
    throw new Error(`${label}.owner=${actual}, expected ${expected}`);
  }
}

module.exports = {
  ROOT,
  EXPECTED_FINAL_OWNER,
  DEPLOYABLES,
  OWNABLE_CONTRACTS,
  ethers,
  readJson,
  writeJson,
  requireAddress,
  optionalAddress,
  loadConfig,
  loadArtifact,
  statePath,
  loadState,
  saveState,
  gasLimit,
  codeExists,
  recordReceipt,
  deployOne,
  send,
  makeContext,
  contract,
  assertExternalDependencies,
  assertOwner
};
