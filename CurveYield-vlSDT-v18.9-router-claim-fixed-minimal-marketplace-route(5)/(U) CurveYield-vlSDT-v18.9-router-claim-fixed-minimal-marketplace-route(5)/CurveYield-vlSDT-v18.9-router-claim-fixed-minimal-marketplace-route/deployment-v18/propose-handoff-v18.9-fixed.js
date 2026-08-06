#!/usr/bin/env node
"use strict";
const { makeContext, contract, send, OWNABLE_CONTRACTS, saveState } = require("./lib-v18");
const { verifyDeployment } = require("./verify-deployment-v18");

async function proposeHandoff(options = {}) {
  const ctx = await makeContext({
    configPath: options.configPath || process.argv[2],
    rpcUrl: options.rpcUrl || process.env.RPC_URL,
    privateKey: options.privateKey || process.env.DEPLOYER_PRIVATE_KEY,
    tag: options.tag || process.env.DEPLOYMENT_TAG || "live",
    confirmations: options.confirmations,
    stateFile: options.stateFile
  });
  if (ctx.state.phase !== "configured") throw new Error(`deployment phase must be configured, got ${ctx.state.phase}`);
  await verifyDeployment({ configPath: options.configPath || process.argv[2], rpcUrl: options.rpcUrl || process.env.RPC_URL, privateKey: options.privateKey || process.env.DEPLOYER_PRIVATE_KEY, tag: options.tag || process.env.DEPLOYMENT_TAG || "live", expectedOwner: ctx.wallet.address, expectedAdmin: ctx.wallet.address });
  const literal = `TRANSFER_TO_${ctx.config.finalOwner}`;
  if (!options.simulation && process.env.CONFIRM_FINAL_HANDOFF !== literal) throw new Error(`Set CONFIRM_FINAL_HANDOFF=${literal}`);
  const rev = contract(ctx, "revenueStaking");
  if ((await rev.admin()).toLowerCase() !== ctx.config.finalAdmin.toLowerCase()) await send(ctx, "handoff:revenueStaking.setAdmin", rev, "setAdmin", [ctx.config.finalAdmin]);
  for (const [key] of OWNABLE_CONTRACTS) {
    const c = contract(ctx, key);
    const owner = (await c.owner()).toLowerCase();
    if (owner === ctx.config.finalOwner.toLowerCase()) continue;
    const pending = (await c.pendingOwner()).toLowerCase();
    if (pending !== ctx.config.finalOwner.toLowerCase()) await send(ctx, `handoff:${key}.transferOwnership`, c, "transferOwnership", [ctx.config.finalOwner]);
  }
  ctx.state.phase = "ownership-proposed";
  saveState(ctx.stateFile, ctx.state);
  console.log("ownership proposed; final owner must run accept-handoff-v18.js");
  return ctx;
}
if (require.main === module) proposeHandoff().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { proposeHandoff };
