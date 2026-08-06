#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawn } = require("child_process");
const {
  ROOT,
  DEPLOYABLES,
  ethers,
  loadConfig,
  statePath,
  contract
} = require("./lib-v18");
const { deployAndConfigure } = require("./deploy-configure-v18");
const {
  buildAbiInventory,
  CoverageLedger
} = require("./simulation-v18/coverage-v18");
const {
  CallExecutor,
  serializeExecutionError
} = require("./simulation-v18/executor-v18");
const { runAbiProbes } = require("./simulation-v18/scenarios-v18");
const {
  prepareYieldEnvironment,
  seedCycleRewards,
  createYieldAdapters
} = require("./simulation-v18/contract-scenarios-v18");
const { runYieldCycle } = require("./simulation-v18/yield-cycles-v18");
const {
  buildSimulationReport,
  writeSimulationReports
} = require("./simulation-v18/report-v18");

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForRpc(url, child, stderrTail) {
  const provider = new ethers.JsonRpcProvider(
    url,
    1,
    { staticNetwork: true, batchMaxCount: 1 }
  );
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Anvil exited with ${child.exitCode}: ${stderrTail.join("")}`);
    }
    try {
      await provider.getBlockNumber();
      return provider;
    } catch (_) {
      await sleep(500);
    }
  }
  throw new Error(`Anvil did not become ready: ${stderrTail.join("")}`);
}

function anvilArguments(config, forkUrl, port) {
  const args = [
    "--fork-url",
    forkUrl,
    "--port",
    String(port),
    "--chain-id",
    String(config.chainId),
    "--silent"
  ];
  if (
    config.deployment.anvilForkBlockNumber !== null
    && config.deployment.anvilForkBlockNumber !== undefined
  ) {
    args.push("--fork-block-number", String(config.deployment.anvilForkBlockNumber));
  }
  return args;
}

async function runSimulation(options = {}) {
  const configPath = options.configPath || process.argv[2] || "config-mainnet-v18.json";
  const { config } = loadConfig(configPath);
  const forkUrl = options.forkUrl || process.env.ETHEREUM_RPC_URL;
  if (!forkUrl) throw new Error("ETHEREUM_RPC_URL is required");

  const port = Number(options.port || config.deployment.anvilPort || 8545);
  const localUrl = `http://127.0.0.1:${port}`;
  const stderrTail = [];
  const anvil = spawn(
    options.anvilPath || process.env.ANVIL_PATH || "anvil",
    anvilArguments(config, forkUrl, port),
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  anvil.stderr.on("data", chunk => {
    stderrTail.push(String(chunk));
    if (stderrTail.length > 20) stderrTail.shift();
  });
  let spawnError = null;
  anvil.on("error", error => {
    spawnError = error;
  });

  const inventory = buildAbiInventory();
  const ledger = new CoverageLedger(inventory);
  const cycles = {};
  const phaseErrors = [];
  let provider;
  let ctx;
  let environment;
  let forkBlock = null;
  let reportPaths = null;
  const tag = `abi-simulation-${Date.now()}`;

  try {
    await sleep(50);
    if (spawnError) throw spawnError;
    provider = await waitForRpc(localUrl, anvil, stderrTail);
    forkBlock = await provider.getBlockNumber();

    const deployer = ethers.Wallet.createRandom();
    await provider.send("anvil_setBalance", [
      deployer.address,
      ethers.toBeHex(BigInt(config.deployment.anvilBalanceWei))
    ]);
    await provider.send("anvil_setBalance", [
      config.finalOwner,
      ethers.toBeHex(BigInt(config.deployment.anvilBalanceWei))
    ]);

    const stateFile = statePath(BigInt(config.chainId), tag);
    ctx = await deployAndConfigure({
      configPath,
      rpcUrl: localUrl,
      privateKey: deployer.privateKey,
      tag,
      confirmations: 1,
      stateFile
    });
    const executor = new CallExecutor({ provider, ledger });

    try {
      environment = await prepareYieldEnvironment({ ctx, executor });
      environment.openingSeed = await seedCycleRewards(environment, "openingCycle");
      cycles.openingCycle = await runYieldCycle({
        label: "openingCycle",
        provider,
        components: createYieldAdapters(environment, "openingCycle")
      });
    } catch (error) {
      phaseErrors.push({
        phase: "openingCycle",
        ...serializeExecutionError(error)
      });
    }

    try {
      const contractsByKey = {};
      for (const [key] of DEPLOYABLES) contractsByKey[key] = contract(ctx, key);
      const probeAddress = environment
        ? environment.actors.probe.address
        : ethers.Wallet.createRandom().address;
      await runAbiProbes({
        inventory,
        contractsByKey,
        signer: ctx.wallet,
        defaultAddress: probeAddress,
        executor
      });
    } catch (error) {
      phaseErrors.push({
        phase: "abiProbes",
        ...serializeExecutionError(error)
      });
    }

    if (environment) {
      try {
        environment.closingSeed = await seedCycleRewards(environment, "closingCycle");
        cycles.closingCycle = await runYieldCycle({
          label: "closingCycle",
          provider,
          components: createYieldAdapters(environment, "closingCycle")
        });
      } catch (error) {
        phaseErrors.push({
          phase: "closingCycle",
          ...serializeExecutionError(error)
        });
      }
    }

    const report = buildSimulationReport({
      metadata: {
        release: config.release,
        chainId: config.chainId,
        forkBlock,
        finalLocalBlock: await provider.getBlockNumber(),
        deployedContracts: ctx ? Object.keys(ctx.state.contracts).length : 0,
        phaseErrors
      },
      ledger,
      cycles,
      setup: environment
        ? {
          externalFunding: environment.funding,
          openingSeed: environment.openingSeed,
          closingSeed: environment.closingSeed
        }
        : null
    });
    if (phaseErrors.length) report.overallStatus = "failed";
    reportPaths = writeSimulationReports({
      outputDir: path.join(ROOT, "deployment-output-v18"),
      tag,
      report
    });

    console.log(
      `ABI FUNCTION SIMULATION ${report.overallStatus.toUpperCase()} `
      + `coverage=${report.coverage.classifiedCount}/${report.coverage.inventoryCount} `
      + `failures=${report.coverage.failureCount} forkBlock=${forkBlock} `
      + `report=${reportPaths.jsonPath}`
    );
    if (report.overallStatus !== "passed") {
      const error = new Error(`ABI function simulation failed; see ${reportPaths.jsonPath}`);
      error.reportPaths = reportPaths;
      throw error;
    }
    return { report, reportPaths };
  } finally {
    if (provider && typeof provider.destroy === "function") provider.destroy();
    if (anvil.exitCode === null) anvil.kill("SIGTERM");
  }
}

if (require.main === module) {
  runSimulation().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  anvilArguments,
  waitForRpc,
  runSimulation
};
