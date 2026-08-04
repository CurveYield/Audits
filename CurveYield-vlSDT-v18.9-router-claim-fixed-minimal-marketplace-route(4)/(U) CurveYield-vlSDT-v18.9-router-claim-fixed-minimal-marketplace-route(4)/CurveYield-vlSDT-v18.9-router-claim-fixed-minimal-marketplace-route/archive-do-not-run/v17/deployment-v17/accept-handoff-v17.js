#!/usr/bin/env node
"use strict";
const { ethers, loadConfig, readJson, statePath, loadArtifact, CONTRACTS, gasLimit, recordReceipt, saveState } = require("./lib-v17");
const { verifyDeployment } = require("./verify-deployment-v17");

async function acceptHandoff(options = {}) {
  const { config } = loadConfig(options.configPath || process.argv[2]);
  const rpcUrl = options.rpcUrl || process.env.RPC_URL;
  const privateKey = options.privateKey || process.env.FINAL_OWNER_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) throw new Error("RPC_URL and FINAL_OWNER_PRIVATE_KEY are required");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  if (wallet.address !== config.finalOwner) throw new Error(`final owner key resolves to ${wallet.address}, expected ${config.finalOwner}`);
  if (!options.simulation && process.env.CONFIRM_ACCEPT_OWNERSHIP !== `ACCEPT_${config.finalOwner}`) throw new Error(`Set CONFIRM_ACCEPT_OWNERSHIP=ACCEPT_${config.finalOwner}`);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== config.chainId) throw new Error(`wrong chain: ${net.chainId}, expected ${config.chainId}`);
  const tag = options.tag || process.env.DEPLOYMENT_TAG || "live";
  const file = statePath(net.chainId, tag);
  if (!require("fs").existsSync(file)) throw new Error(`missing deployment state ${file}`);
  const state = readJson(file);
  for (const [key, name] of CONTRACTS) {
    const address = state.contracts[key]?.address;
    if (!address) throw new Error(`missing ${key} in ${file}`);
    const c = new ethers.Contract(address, loadArtifact(name).abi, wallet);
    if ((await c.owner()).toLowerCase() === config.finalOwner.toLowerCase()) continue;
    if ((await c.pendingOwner()).toLowerCase() !== config.finalOwner.toLowerCase()) throw new Error(`${key} does not have final owner pending`);
    const populated = await c.acceptOwnership.populateTransaction();
    const estimate = await provider.estimateGas({ ...populated, from: wallet.address });
    const tx = await c.acceptOwnership({ gasLimit: gasLimit(estimate, config.deployment.gasLimitMultiplierBps) });
    const receipt = await tx.wait(config.deployment.confirmations);
    await recordReceipt(state, `handoff:${key}.acceptOwnership`, receipt);
    saveState(file, state);
  }
  state.phase = "ownership-accepted";
  saveState(file, state);
  await verifyDeployment({ configPath: options.configPath || process.argv[2], rpcUrl, privateKey, tag, expectedOwner: config.finalOwner, expectedAdmin: config.finalAdmin });
  console.log("ownership accepted and final state verified");
  return state;
}
if (require.main === module) acceptHandoff().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { acceptHandoff };
