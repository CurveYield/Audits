#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_FINAL_OWNER = "0x9f2B20A772246960810045905B7daccf960eE288";
const CONTRACTS = [
  ["governanceToken", "CurveYieldGovernanceTokenV17"],
  ["governanceStaking", "CurveYieldGovernanceStakingV17"],
  ["cyvlSdt", "CurveYieldVlSDTTokenV17"],
  ["locker", "CurveYieldVlSDTLockerV17"],
  ["revenueStaking", "CurveYieldVlSDTRevenueStakingV17"],
  ["boostStaking", "CurveYieldVlSDTBoostStakingV17"],
  ["boostMerchant", "CurveYieldVlSDTBoostMerchantV17"],
  ["compounder", "CurveYieldRevenueCompounderV17"]
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
}
function requireAddress(label, value) {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) throw new Error(`${label} must be a non-zero address`);
  return ethers.getAddress(value);
}
function loadConfig(configPath) {
  const resolved = path.resolve(configPath || path.join(ROOT, "config-mainnet-v17.json"));
  const c = readJson(resolved);
  if (c.version !== 17 || c.chainId !== 1) throw new Error("V17 Ethereum-mainnet config required");
  c.finalOwner = requireAddress("finalOwner", c.finalOwner);
  c.finalAdmin = requireAddress("finalAdmin", c.finalAdmin);
  c.feeReceivers.treasury = requireAddress("feeReceivers.treasury", c.feeReceivers.treasury);
  c.feeReceivers.admin = requireAddress("feeReceivers.admin", c.feeReceivers.admin);
  if (c.finalOwner !== ethers.getAddress(EXPECTED_FINAL_OWNER)) throw new Error(`finalOwner must be ${EXPECTED_FINAL_OWNER}`);
  if (c.feeReceivers.treasury !== c.finalOwner || c.feeReceivers.admin !== c.finalOwner) {
    throw new Error("all fee receivers must equal finalOwner");
  }
  for (const [k, v] of Object.entries(c.stakeDao)) c.stakeDao[k] = requireAddress(`stakeDao.${k}`, v);
  const gs = c.governanceStaking;
  if (!Number.isInteger(gs.initialWithdrawTaxBps) || gs.initialWithdrawTaxBps < 0 || gs.initialWithdrawTaxBps > 500) {
    throw new Error("governanceStaking.initialWithdrawTaxBps must be 0..500");
  }
  if (!Number.isInteger(gs.initialWithdrawHoldTimeSeconds) || gs.initialWithdrawHoldTimeSeconds < 0 || gs.initialWithdrawHoldTimeSeconds > 30 * 86400) {
    throw new Error("governanceStaking.initialWithdrawHoldTimeSeconds must be 0..30 days");
  }
  c.governanceStaking.rewardTokens = (gs.rewardTokens || []).map((x, i) => requireAddress(`governanceStaking.rewardTokens[${i}]`, x));
  c.governanceStaking.notifiers = (gs.notifiers || []).map((x, i) => requireAddress(`governanceStaking.notifiers[${i}]`, x));
  c.compounder.keepers = (c.compounder.keepers || []).map((x, i) => requireAddress(`compounder.keepers[${i}]`, x));
  return { config: c, configPath: resolved };
}
function artifactPath(name) {
  return path.join(ROOT, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
}
function loadArtifact(name) {
  const p = artifactPath(name);
  if (!fs.existsSync(p)) throw new Error(`Missing artifact ${p}. Run npm run compile:v17 first.`);
  const a = readJson(p);
  if (!a.bytecode || a.bytecode === "0x") throw new Error(`Artifact ${name} has no deployable bytecode`);
  return a;
}
function statePath(chainId, tag = "live") {
  return path.join(ROOT, "deployment-output-v17", `deployment-state-v17-${tag}-${chainId}.json`);
}
function loadState(file, chainId, deployer) {
  if (fs.existsSync(file)) return readJson(file);
  return { version: 17, chainId: String(chainId), deployer, phase: "new", contracts: {}, transactions: [], gasUsed: "0" };
}
function saveState(file, state) { writeJson(file, state); }
function gasLimit(estimate, bps) { return estimate * BigInt(bps || 12000) / 10000n + 25000n; }
async function codeExists(provider, address) { return (await provider.getCode(address)) !== "0x"; }
async function recordReceipt(state, label, receipt) {
  const used = receipt.gasUsed || 0n;
  state.gasUsed = (BigInt(state.gasUsed || "0") + used).toString();
  state.transactions.push({ label, hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: used.toString(), status: receipt.status });
}
async function deployOne(ctx, key, name, args) {
  const existing = ctx.state.contracts[key];
  if (existing && await codeExists(ctx.provider, existing.address)) {
    return new ethers.Contract(existing.address, loadArtifact(name).abi, ctx.wallet);
  }
  const artifact = loadArtifact(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, ctx.wallet);
  const txReq = await factory.getDeployTransaction(...args);
  const estimate = await ctx.provider.estimateGas({ ...txReq, from: ctx.wallet.address });
  const contract = await factory.deploy(...args, { gasLimit: gasLimit(estimate, ctx.config.deployment.gasLimitMultiplierBps) });
  const deploymentTx = contract.deploymentTransaction();
  const receipt = await deploymentTx.wait(ctx.confirmations);
  const address = await contract.getAddress();
  ctx.state.contracts[key] = { name, address, constructorArgs: args.map(String), deploymentTx: receipt.hash, deploymentGas: receipt.gasUsed.toString() };
  await recordReceipt(ctx.state, `deploy:${name}`, receipt);
  saveState(ctx.stateFile, ctx.state);
  console.log(`deployed ${name} ${address} gas=${receipt.gasUsed}`);
  return contract;
}
async function send(ctx, label, contract, method, args = []) {
  const populated = await contract[method].populateTransaction(...args);
  const estimate = await ctx.provider.estimateGas({ ...populated, from: ctx.wallet.address });
  const tx = await contract[method](...args, { gasLimit: gasLimit(estimate, ctx.config.deployment.gasLimitMultiplierBps) });
  const receipt = await tx.wait(ctx.confirmations);
  await recordReceipt(ctx.state, label, receipt);
  saveState(ctx.stateFile, ctx.state);
  console.log(`${label} gas=${receipt.gasUsed} tx=${receipt.hash}`);
  return receipt;
}
async function makeContext({ configPath, rpcUrl, privateKey, tag = "live", confirmations, stateFile, allowWalletMismatch = false } = {}) {
  const { config } = loadConfig(configPath);
  if (!rpcUrl) throw new Error("RPC URL required");
  if (!privateKey) throw new Error("private key required");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) throw new Error(`wrong chain: ${network.chainId}, expected ${config.chainId}`);
  const file = stateFile || statePath(network.chainId, tag);
  const state = loadState(file, network.chainId, wallet.address);
  if (!allowWalletMismatch && ethers.getAddress(state.deployer) !== wallet.address) throw new Error("state deployer differs from current wallet");
  return { config, provider, wallet, state, stateFile: file, confirmations: confirmations ?? config.deployment.confirmations };
}
function contract(ctx, key, signer = ctx.wallet) {
  const pair = CONTRACTS.find(([k]) => k === key);
  if (!pair || !ctx.state.contracts[key]) throw new Error(`missing deployed contract ${key}`);
  return new ethers.Contract(ctx.state.contracts[key].address, loadArtifact(pair[1]).abi, signer);
}
async function assertExternalDependencies(provider, config) {
  for (const [label, address] of Object.entries(config.stakeDao)) {
    if (!await codeExists(provider, address)) throw new Error(`${label} has no code: ${address}`);
  }
  const fd = new ethers.Contract(config.stakeDao.feeDistributor, ["function REWARD_TOKEN() view returns (address)"], provider);
  const rewardToken = requireAddress("feeDistributor.REWARD_TOKEN", await fd.REWARD_TOKEN());
  if (!await codeExists(provider, rewardToken)) throw new Error(`fee distributor reward token has no code: ${rewardToken}`);
  return rewardToken;
}
async function assertOwner(c, expected, label) {
  const actual = ethers.getAddress(await c.owner());
  if (actual !== ethers.getAddress(expected)) throw new Error(`${label}.owner=${actual}, expected ${expected}`);
}
module.exports = {
  ROOT, EXPECTED_FINAL_OWNER, CONTRACTS, ethers, readJson, writeJson, requireAddress, loadConfig,
  loadArtifact, statePath, loadState, saveState, gasLimit, codeExists, recordReceipt, deployOne, send,
  makeContext, contract, assertExternalDependencies, assertOwner
};
