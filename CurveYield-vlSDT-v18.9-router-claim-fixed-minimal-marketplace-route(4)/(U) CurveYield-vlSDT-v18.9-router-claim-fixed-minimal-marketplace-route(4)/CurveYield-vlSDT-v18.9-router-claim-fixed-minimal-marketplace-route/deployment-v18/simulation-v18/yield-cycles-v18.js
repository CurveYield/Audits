"use strict";

const { serializable } = require("./executor-v18");

const FIFTEEN_DAYS_SECONDS = 15 * 24 * 60 * 60;

function amount(value) {
  if (value === null || value === undefined) return 0n;
  return BigInt(value);
}

function pps(value) {
  return value === null || value === undefined ? "not-applicable" : String(value);
}

function rewardBalances(state) {
  return Object.fromEntries(
    Object.entries(state.rewardBalances || {}).map(([asset, value]) => [asset, amount(value)])
  );
}

function assetDelta(before, after) {
  const assets = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...assets].map(asset => [
    asset,
    (amount(after[asset]) - amount(before[asset])).toString()
  ]));
}

function calculateCycleMetrics(states) {
  const depositedPrincipal = amount(states.before.principal) - amount(states.afterDeposit.principal);
  const withdrawalProceeds = amount(states.afterWithdrawal.principal) - amount(states.afterDeposit.principal);
  const principalDelta = amount(states.afterWithdrawal.principal) - amount(states.before.principal);
  const metrics = {
    depositedPrincipal: depositedPrincipal.toString(),
    withdrawalProceeds: withdrawalProceeds.toString(),
    principalDelta: principalDelta.toString(),
    pps: {
      beforeDeposit: pps(states.before.pps),
      afterDeposit: pps(states.afterDeposit.pps),
      beforeHarvest: pps(states.beforeHarvest.pps),
      afterHarvest: pps(states.afterHarvest.pps),
      afterWithdrawal: pps(states.afterWithdrawal.pps)
    }
  };

  const assetAware = states.before.principalAsset !== undefined
    || states.before.rewardBalances !== undefined;
  if (!assetAware) {
    const claimedRewards = amount(states.afterWithdrawal.rewards) - amount(states.before.rewards);
    const accruedRewards = amount(states.beforeHarvest.rewards) - amount(states.before.rewards);
    const harvestOutput = amount(states.afterHarvest.rewards) - amount(states.beforeHarvest.rewards);
    return {
      ...metrics,
      accruedRewards: accruedRewards.toString(),
      harvestOutput: harvestOutput.toString(),
      claimedRewards: claimedRewards.toString(),
      netTokenYield: (principalDelta + claimedRewards).toString()
    };
  }

  const principalAsset = states.before.principalAsset || "principal";
  const claimedRewardsByAsset = assetDelta(
    rewardBalances(states.before),
    rewardBalances(states.afterWithdrawal)
  );
  const netYield = { [principalAsset]: principalDelta };
  for (const [asset, value] of Object.entries(claimedRewardsByAsset)) {
    netYield[asset] = (amount(netYield[asset]) + amount(value));
  }
  return {
    ...metrics,
    principalAsset,
    claimedRewardsByAsset,
    netYieldByAsset: Object.fromEntries(
      Object.entries(netYield).map(([asset, value]) => [asset, value.toString()])
    )
  };
}

async function rpcBlock(provider) {
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  return {
    number: Number(BigInt(block.number)),
    timestamp: Number(BigInt(block.timestamp))
  };
}

async function advanceFifteenDays(provider) {
  const before = await rpcBlock(provider);
  const target = before.timestamp + FIFTEEN_DAYS_SECONDS;
  await provider.send("evm_setNextBlockTimestamp", [target]);
  await provider.send("evm_mine", []);
  const after = await rpcBlock(provider);
  if (after.timestamp - before.timestamp !== FIFTEEN_DAYS_SECONDS) {
    throw new Error(
      `incorrect yield-cycle time advance: ${after.timestamp - before.timestamp}, expected ${FIFTEEN_DAYS_SECONDS}`
    );
  }
  return { before, after, elapsedSeconds: FIFTEEN_DAYS_SECONDS };
}

async function measureAll(components) {
  const measured = {};
  for (const component of components) {
    try {
      measured[component.name] = await component.measure();
    } catch (error) {
      if (error && !error.simulationStage) error.simulationStage = `${component.name}:measure`;
      throw error;
    }
  }
  return measured;
}

async function actAll(components, method) {
  const results = {};
  for (const component of components) {
    if (typeof component[method] !== "function") {
      throw new Error(`${component.name} cycle adapter is missing ${method}()`);
    }
    try {
      results[component.name] = serializable(await component[method]());
    } catch (error) {
      if (error && !error.simulationStage) {
        error.simulationStage = `${component.name}:${method}`;
      }
      throw error;
    }
  }
  return results;
}

async function runYieldCycle({ label, provider, components }) {
  if (!label) throw new Error("yield cycle label required");
  if (!components || components.length === 0) throw new Error("yield cycle components required");
  const names = new Set();
  for (const component of components) {
    if (!component.name || names.has(component.name)) {
      throw new Error(`invalid or duplicate yield cycle component: ${component.name}`);
    }
    names.add(component.name);
  }

  const before = await measureAll(components);
  const depositResults = await actAll(components, "deposit");
  const afterDeposit = await measureAll(components);
  const time = await advanceFifteenDays(provider);
  const beforeHarvest = await measureAll(components);
  const harvestResults = await actAll(components, "harvest");
  const afterHarvest = await measureAll(components);
  const withdrawalResults = await actAll(components, "withdraw");
  const afterWithdrawal = await measureAll(components);

  const report = {
    label,
    startBlock: time.before.number,
    endBlock: time.after.number,
    startTimestamp: time.before.timestamp,
    endTimestamp: time.after.timestamp,
    elapsedSeconds: time.elapsedSeconds,
    components: {}
  };

  for (const component of components) {
    const name = component.name;
    const states = {
      before: serializable(before[name]),
      afterDeposit: serializable(afterDeposit[name]),
      beforeHarvest: serializable(beforeHarvest[name]),
      afterHarvest: serializable(afterHarvest[name]),
      afterWithdrawal: serializable(afterWithdrawal[name])
    };
    report.components[name] = {
      states,
      actions: {
        deposit: depositResults[name],
        harvest: harvestResults[name],
        withdraw: withdrawalResults[name]
      },
      metrics: calculateCycleMetrics(states)
    };
  }
  return report;
}

module.exports = {
  FIFTEEN_DAYS_SECONDS,
  calculateCycleMetrics,
  rpcBlock,
  advanceFifteenDays,
  runYieldCycle
};
