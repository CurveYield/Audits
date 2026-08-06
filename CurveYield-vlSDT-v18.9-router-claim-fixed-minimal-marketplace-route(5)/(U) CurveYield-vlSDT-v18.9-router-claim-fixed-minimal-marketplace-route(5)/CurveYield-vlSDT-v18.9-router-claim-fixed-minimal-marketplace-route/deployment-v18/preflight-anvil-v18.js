#!/usr/bin/env node
"use strict";
const { spawn } = require("child_process");
const { ethers, loadConfig, statePath, OWNABLE_CONTRACTS, loadArtifact } = require("./lib-v18");
const { deployAndConfigure } = require("./deploy-configure-v18");
const { verifyDeployment } = require("./verify-deployment-v18");
const { proposeHandoff } = require("./propose-handoff-v18");

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitRpc(url, child) {
  const provider = new ethers.JsonRpcProvider(url);
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`anvil exited with ${child.exitCode}`);
    try { await provider.getBlockNumber(); return provider; } catch (_) { await sleep(500); }
  }
  throw new Error("anvil did not become ready");
}
async function runPreflight(options = {}) {
  const { config } = loadConfig(options.configPath || process.argv[2]);
  const forkUrl = options.forkUrl || process.env.ETHEREUM_RPC_URL;
  const deployerKey = options.privateKey || process.env.DEPLOYER_PRIVATE_KEY;
  if (!forkUrl || !deployerKey) throw new Error("ETHEREUM_RPC_URL and DEPLOYER_PRIVATE_KEY are required");
  const port = Number(config.deployment.anvilPort || 8545);
  const args = ["--fork-url", forkUrl, "--port", String(port), "--chain-id", "1", "--silent"];
  if (config.deployment.anvilForkBlockNumber !== null && config.deployment.anvilForkBlockNumber !== undefined) args.push("--fork-block-number", String(config.deployment.anvilForkBlockNumber));
  if (Number(config.deployment.anvilBlockTimeSeconds || 0) > 0) args.push("--block-time", String(config.deployment.anvilBlockTimeSeconds));
  const anvil = spawn("anvil", args, { stdio: ["ignore", "inherit", "inherit"] });
  const url = `http://127.0.0.1:${port}`;
  try {
    const provider = await waitRpc(url, anvil);
    const deployer = new ethers.Wallet(deployerKey).address;
    await provider.send("anvil_setBalance", [deployer, ethers.toBeHex(BigInt(config.deployment.anvilBalanceWei))]);
    await provider.send("anvil_setBalance", [config.finalOwner, ethers.toBeHex(BigInt(config.deployment.anvilBalanceWei))]);
    const tag = `anvil-${Date.now()}`;
    const state = statePath(1n, tag);
    const ctx = await deployAndConfigure({ configPath: options.configPath || process.argv[2], rpcUrl: url, privateKey: deployerKey, tag, confirmations: 1, stateFile: state });
    await verifyDeployment({ configPath: options.configPath || process.argv[2], rpcUrl: url, privateKey: deployerKey, tag, expectedOwner: deployer });
    await proposeHandoff({
      configPath: options.configPath || process.argv[2],
      rpcUrl: url,
      privateKey: deployerKey,
      tag,
      confirmations: 1,
      simulation: true
    });
    await provider.send("anvil_impersonateAccount", [config.finalOwner]);
    const finalSigner = await provider.getSigner(config.finalOwner);
    for (const [key, name] of OWNABLE_CONTRACTS) {
      const entry = ctx.state.contracts[key];
      if (!entry) throw new Error(`missing ${key} from deployment state`);
      const c = new ethers.Contract(entry.address, loadArtifact(name).abi, finalSigner);
      if ((await c.owner()).toLowerCase() !== config.finalOwner.toLowerCase()) {
        await (await c.acceptOwnership()).wait();
      }
    }
    await provider.send("anvil_stopImpersonatingAccount", [config.finalOwner]);
    await verifyDeployment({ configPath: options.configPath || process.argv[2], rpcUrl: url, privateKey: deployerKey, tag, expectedOwner: config.finalOwner });
    const forkBlock = await provider.getBlockNumber();
    console.log(`ANVIL PREFLIGHT PASSED forkBlock=${forkBlock} gasUsed=${ctx.state.gasUsed} state=${state}`);
  } finally {
    anvil.kill("SIGTERM");
  }
}
if (require.main === module) runPreflight().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { runPreflight };
