"use strict";

const { expect } = require("chai");
const {
  CoverageLedger,
  buildAbiInventory,
  canonicalSignature
} = require("../../deployment-v20/simulation-v20/coverage-v20");
const {
  CallExecutor,
  decodeRevert,
  serializeExecutionError
} = require("../../deployment-v20/simulation-v20/executor-v20");
const { ethers } = require("../../deployment-v20/lib-v20");
const { network, ethers: hardhatEthers } = require("hardhat");
const {
  FIFTEEN_DAYS_SECONDS,
  calculateCycleMetrics,
  rpcBlock,
  runYieldCycle
} = require("../../deployment-v20/simulation-v20/yield-cycles-v20");
const {
  synthesizeArguments,
  buildScenarioPlan,
  withSnapshot,
  runAbiProbes
} = require("../../deployment-v20/simulation-v20/scenarios-v20");
const {
  extractTransferRecipients,
  pendingImpersonatedOverrides,
  isRetryableForkTransportError
} = require("../../deployment-v20/simulation-v20/actors-v20");
const {
  LIFECYCLE_COMPONENTS,
  governanceBootstrapPrincipal,
  withSimulationStage,
  missingRewardRegistrations
} = require("../../deployment-v20/simulation-v20/contract-scenarios-v20");
const {
  buildSimulationReport,
  renderSimulationMarkdown
} = require("../../deployment-v20/simulation-v20/report-v20");

describe("V20 ABI function simulation harness", function () {
  it("builds the complete callable inventory with canonical signatures", function () {
    const inventory = buildAbiInventory();

    expect(inventory).to.have.length(743);
    expect(new Set(inventory.map(item => item.id)).size).to.equal(743);
    expect(inventory.some(item =>
      item.contractKey === "governanceStaking"
      && item.signature === "stakeWithProposalSync(uint256,uint256,uint256[],uint256,bytes)"
    )).to.equal(true);
  });

  it("canonicalizes tuple and array ABI inputs", function () {
    expect(canonicalSignature({
      name: "example",
      inputs: [
        { type: "tuple[]", components: [{ type: "address" }, { type: "uint256[]" }] },
        { type: "bytes32" }
      ]
    })).to.equal("example((address,uint256[])[],bytes32)");
  });

  it("rejects duplicate inventory entries", function () {
    const item = {
      id: "token:balanceOf(address)",
      contractKey: "token",
      signature: "balanceOf(address)"
    };

    expect(() => new CoverageLedger([item, item])).to.throw("duplicate ABI inventory id");
  });

  it("requires a terminal result for every ABI signature", function () {
    const inventory = [
      { id: "token:balanceOf(address)", contractKey: "token", signature: "balanceOf(address)" },
      { id: "token:transfer(address,uint256)", contractKey: "token", signature: "transfer(address,uint256)" }
    ];
    const ledger = new CoverageLedger(inventory);

    ledger.record(inventory[0].id, { status: "passed-success" });

    expect(() => ledger.assertComplete()).to.throw("missing ABI coverage: token:transfer(address,uint256)");
  });

  it("rejects unknown and non-terminal result statuses", function () {
    const item = {
      id: "token:balanceOf(address)",
      contractKey: "token",
      signature: "balanceOf(address)"
    };
    const ledger = new CoverageLedger([item]);

    expect(() => ledger.record(item.id, { status: "running" })).to.throw("invalid coverage status");
    expect(() => ledger.record("token:missing()", { status: "passed-success" })).to.throw("unknown ABI inventory id");
  });

  it("records successful calls and unexpected successes", async function () {
    const inventory = [
      { id: "token:value()", contractKey: "token", signature: "value()" },
      { id: "token:paused()", contractKey: "token", signature: "paused()" }
    ];
    const ledger = new CoverageLedger(inventory);
    const executor = new CallExecutor({ ledger });

    const success = await executor.execute({
      id: inventory[0].id,
      expected: "success",
      operation: async () => 42n
    });
    const unexpected = await executor.execute({
      id: inventory[1].id,
      expected: "revert",
      operation: async () => false
    });

    expect(success.status).to.equal("passed-success");
    expect(success.returnValue).to.equal("42");
    expect(unexpected.status).to.equal("failed-unexpected-success");
  });

  it("classifies an explicitly boundary-probed revert without hiding its error", async function () {
    const item = { id: "token:item(uint256)", contractKey: "token", signature: "item(uint256)" };
    const ledger = new CoverageLedger([item]);
    const executor = new CallExecutor({ ledger });
    const revertData = new ethers.Interface(["error Error(string)"])
      .encodeErrorResult("Error", ["index"]);

    const result = await executor.execute({
      id: item.id,
      expected: "success-or-revert",
      operation: async () => {
        const error = new Error("execution reverted");
        error.data = revertData;
        throw error;
      }
    });

    expect(result.status).to.equal("passed-expected-revert");
    expect(result.error.decoded).to.equal("Error(index)");
  });

  it("records expected and unexpected reverts without stopping later calls", async function () {
    const inventory = [
      { id: "token:first()", contractKey: "token", signature: "first()" },
      { id: "token:second()", contractKey: "token", signature: "second()" },
      { id: "token:third()", contractKey: "token", signature: "third()" }
    ];
    const ledger = new CoverageLedger(inventory);
    const executor = new CallExecutor({ ledger });
    const revertData = new ethers.Interface(["error Error(string)"])
      .encodeErrorResult("Error", ["denied"]);

    const expected = await executor.execute({
      id: inventory[0].id,
      expected: "revert",
      operation: async () => {
        const error = new Error("execution reverted");
        error.data = revertData;
        throw error;
      }
    });
    const unexpected = await executor.execute({
      id: inventory[1].id,
      expected: "success",
      operation: async () => {
        const error = new Error("execution reverted");
        error.data = revertData;
        throw error;
      }
    });
    const later = await executor.execute({
      id: inventory[2].id,
      expected: "success",
      operation: async () => "continued"
    });

    expect(expected.status).to.equal("passed-expected-revert");
    expect(expected.error.decoded).to.equal("Error(denied)");
    expect(unexpected.status).to.equal("failed-unexpected-revert");
    expect(later.status).to.equal("passed-success");
  });

  it("decodes panic and custom-error revert data", function () {
    const panic = new ethers.Interface(["error Panic(uint256)"])
      .encodeErrorResult("Panic", [0x11]);
    const customInterface = new ethers.Interface(["error Unauthorized(address)"]);
    const custom = customInterface.encodeErrorResult("Unauthorized", [
      "0x00000000000000000000000000000000000000A1"
    ]);

    expect(decodeRevert({ data: panic }).decoded).to.equal("Panic(17)");
    expect(decodeRevert({ data: custom }, customInterface).decoded)
      .to.equal("Unauthorized(0x00000000000000000000000000000000000000A1)");
  });

  it("preserves nested RPC error details and the lifecycle stage", function () {
    const error = new Error("could not coalesce error");
    error.code = "UNKNOWN_ERROR";
    error.simulationStage = "setup:mint-governance";
    error.info = {
      error: {
        code: -32000,
        message: "nonce too low",
        data: "0xdeadbeef"
      }
    };

    expect(serializeExecutionError(error)).to.deep.include({
      message: "could not coalesce error",
      code: "UNKNOWN_ERROR",
      stage: "setup:mint-governance",
      data: "0xdeadbeef",
      rpcCode: -32000,
      rpcMessage: "nonce too low"
    });
  });

  it("attaches the exact lifecycle stage when an operation fails", async function () {
    let caught;
    try {
      await withSimulationStage("seed:start-governance-cycle", async () => {
        throw new Error("boom");
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    expect(caught.simulationStage).to.equal("seed:start-governance-cycle");
  });

  it("calculates principal, reward, yield, and PPS cycle deltas", function () {
    const metrics = calculateCycleMetrics({
      before: { principal: "1000", rewards: "10", pps: "1000000000000000000" },
      afterDeposit: { principal: "800", rewards: "10", pps: "1000000000000000000" },
      beforeHarvest: { principal: "800", rewards: "35", pps: "1010000000000000000" },
      afterHarvest: { principal: "800", rewards: "45", pps: "1020000000000000000" },
      afterWithdrawal: { principal: "1007", rewards: "45", pps: "1020000000000000000" }
    });

    expect(metrics.depositedPrincipal).to.equal("200");
    expect(metrics.withdrawalProceeds).to.equal("207");
    expect(metrics.claimedRewards).to.equal("35");
    expect(metrics.principalDelta).to.equal("7");
    expect(metrics.netTokenYield).to.equal("42");
    expect(metrics.pps.beforeDeposit).to.equal("1000000000000000000");
    expect(metrics.pps.afterHarvest).to.equal("1020000000000000000");
  });

  it("keeps principal and reward yield separated when they use different assets", function () {
    const metrics = calculateCycleMetrics({
      before: {
        principal: "1000",
        principalAsset: "cyvlSDT",
        rewardBalances: { SDT: "10", GOV: "5" },
        pps: null
      },
      afterDeposit: {
        principal: "800",
        principalAsset: "cyvlSDT",
        rewardBalances: { SDT: "10", GOV: "5" },
        pps: null
      },
      beforeHarvest: {
        principal: "800",
        principalAsset: "cyvlSDT",
        rewardBalances: { SDT: "10", GOV: "5" },
        pps: null
      },
      afterHarvest: {
        principal: "800",
        principalAsset: "cyvlSDT",
        rewardBalances: { SDT: "45", GOV: "12" },
        pps: null
      },
      afterWithdrawal: {
        principal: "1007",
        principalAsset: "cyvlSDT",
        rewardBalances: { SDT: "45", GOV: "12" },
        pps: null
      }
    });

    expect(metrics.claimedRewardsByAsset).to.deep.equal({ SDT: "35", GOV: "7" });
    expect(metrics.netYieldByAsset).to.deep.equal({
      cyvlSDT: "7",
      SDT: "35",
      GOV: "7"
    });
    expect(metrics).not.to.have.property("netTokenYield");
  });

  it("marks PPS as not applicable when a staking adapter has no PPS", function () {
    const metrics = calculateCycleMetrics({
      before: { principal: "100", rewards: "0", pps: null },
      afterDeposit: { principal: "0", rewards: "0", pps: null },
      beforeHarvest: { principal: "0", rewards: "3", pps: null },
      afterHarvest: { principal: "0", rewards: "3", pps: null },
      afterWithdrawal: { principal: "100", rewards: "3", pps: null }
    });

    expect(metrics.pps.beforeDeposit).to.equal("not-applicable");
    expect(metrics.netTokenYield).to.equal("3");
  });

  it("uses one shared exact fifteen-day advance per yield cycle", async function () {
    const calls = [];
    const state = {
      alpha: { principal: 100n, rewards: 0n },
      beta: { principal: 200n, rewards: 0n }
    };
    const adapter = name => ({
      name,
      async measure() {
        return { ...state[name], pps: null };
      },
      async deposit() {
        calls.push(`${name}:deposit`);
        state[name].principal -= 10n;
      },
      async harvest() {
        calls.push(`${name}:harvest`);
        state[name].rewards += 2n;
      },
      async withdraw() {
        calls.push(`${name}:withdraw`);
        state[name].principal += 10n;
      }
    });
    const before = await network.provider.send("eth_getBlockByNumber", ["latest", false]);
    const report = await runYieldCycle({
      label: "openingCycle",
      provider: network.provider,
      components: [adapter("alpha"), adapter("beta")]
    });
    const after = await network.provider.send("eth_getBlockByNumber", ["latest", false]);

    expect(Number(BigInt(after.timestamp) - BigInt(before.timestamp))).to.equal(FIFTEEN_DAYS_SECONDS);
    expect(calls).to.deep.equal([
      "alpha:deposit",
      "beta:deposit",
      "alpha:harvest",
      "beta:harvest",
      "alpha:withdraw",
      "beta:withdraw"
    ]);
    expect(report.label).to.equal("openingCycle");
    expect(report.elapsedSeconds).to.equal(FIFTEEN_DAYS_SECONDS);
    expect(report.components).to.have.keys("alpha", "beta");
  });

  it("reads exact block timestamps through raw RPC without touching cached getBlock", async function () {
    const rawOnlyProvider = new Proxy(network.provider, {
      get(target, property) {
        if (property === "getBlock") {
          throw new Error("cached getBlock must not be accessed");
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });

    const block = await rpcBlock(rawOnlyProvider);
    expect(block.number).to.be.a("number");
    expect(block.timestamp).to.be.a("number");
  });

  it("synthesizes deterministic ABI arguments including nested tuples", function () {
    const actor = "0x00000000000000000000000000000000000000A1";
    const inputs = [
      { type: "address" },
      { type: "uint256" },
      { type: "bool" },
      { type: "bytes32" },
      { type: "bytes" },
      {
        type: "tuple",
        components: [
          { type: "address[]" },
          { type: "uint64" }
        ]
      }
    ];

    expect(synthesizeArguments(inputs, { defaultAddress: actor })).to.deep.equal([
      actor,
      0n,
      false,
      ethers.ZeroHash,
      "0x",
      [[], 0n]
    ]);
  });

  it("assigns a callable scenario to every ABI inventory entry", function () {
    const inventory = buildAbiInventory();
    const plan = buildScenarioPlan(inventory);

    expect(plan).to.have.length(743);
    expect(plan.filter(item => !item.scenario)).to.have.length(0);
    expect(plan.filter(item => item.scenario === "read-probe").length).to.be.greaterThan(0);
    expect(plan.filter(item => item.scenario === "state-probe").length).to.be.greaterThan(0);
  });

  it("runs real static probes and classifies each selected ABI signature", async function () {
    const [owner] = await hardhatEthers.getSigners();
    const factory = await hardhatEthers.getContractFactory("CurveYieldGovernanceToken");
    const token = await factory.deploy(owner.address, "Governance", "GOV");
    await token.waitForDeployment();
    const inventory = buildAbiInventory().filter(item =>
      item.contractKey === "governanceToken"
      && ["name()", "transfer(address,uint256)"].includes(item.signature)
    );
    const ledger = new CoverageLedger(inventory);
    const executor = new CallExecutor({ provider: hardhatEthers.provider, ledger });

    await runAbiProbes({
      inventory,
      contractsByKey: { governanceToken: token },
      signer: owner,
      defaultAddress: owner.address,
      executor
    });

    expect(ledger.assertPassing()).to.equal(true);
    expect(ledger.summary().classifiedCount).to.equal(2);
  });

  it("restores destructive scenario state from an Anvil snapshot", async function () {
    const before = await network.provider.send("eth_getBlockByNumber", ["latest", false]);
    await withSnapshot(network.provider, async () => {
      await network.provider.send("evm_setNextBlockTimestamp", [
        Number(BigInt(before.timestamp)) + 12345
      ]);
      await network.provider.send("evm_mine", []);
    });
    const after = await network.provider.send("eth_getBlockByNumber", ["latest", false]);

    expect(after.timestamp).to.equal(before.timestamp);
  });

  it("extracts and deduplicates real ERC-20 transfer recipients", function () {
    const topic = address => ethers.zeroPadValue(address, 32);
    const a = "0x00000000000000000000000000000000000000A1";
    const b = "0x00000000000000000000000000000000000000B2";
    const logs = [
      { topics: [ethers.id("Transfer(address,address,uint256)"), topic(ethers.ZeroAddress), topic(a)] },
      { topics: [ethers.id("Transfer(address,address,uint256)"), topic(a), topic(b)] },
      { topics: [ethers.id("Transfer(address,address,uint256)"), topic(b), topic(a)] }
    ];

    expect(extractTransferRecipients(logs)).to.deep.equal([
      ethers.getAddress(a),
      ethers.getAddress(b)
    ]);
  });

  it("pins impersonated transfers to the account's pending nonce", async function () {
    const [account] = await hardhatEthers.getSigners();
    const expected = await hardhatEthers.provider.getTransactionCount(
      account.address,
      "pending"
    );
    const overrides = await pendingImpersonatedOverrides(
      hardhatEthers.provider,
      account.address,
      150_000n
    );

    expect(overrides).to.deep.equal({
      gasLimit: 150_000n,
      nonce: expected
    });
  });

  it("retries only an upstream fork transport timeout, never a contract revert", function () {
    const timeout = new Error("could not coalesce error");
    timeout.error = {
      code: -32603,
      message: "Fork Error: Transport(HttpError { status: 408, body: Request timeout on the free plan })"
    };
    const revert = new Error("execution reverted");
    revert.code = "CALL_EXCEPTION";
    revert.data = "0xdeadbeef";

    expect(isRetryableForkTransportError(timeout)).to.equal(true);
    expect(isRetryableForkTransportError(revert)).to.equal(false);
  });

  it("defines both-cycle coverage for every applicable staking and vault contract", function () {
    expect(LIFECYCLE_COMPONENTS).to.deep.equal([
      "governanceStaking",
      "cyGovYieldStaking",
      "revenueStaking",
      "boostStaking",
      "revenueVault"
    ]);
  });

  it("stakes at least the governance reward-eligibility floor during setup", function () {
    expect(governanceBootstrapPrincipal(10n * 10n ** 18n)).to.equal(10n * 10n ** 18n);
    expect(governanceBootstrapPrincipal(25n * 10n ** 18n)).to.equal(25n * 10n ** 18n);
  });

  it("registers the lifecycle reward on both staking contracts when needed", function () {
    expect(missingRewardRegistrations(false, false)).to.deep.equal([
      "governanceStaking",
      "revenueStaking"
    ]);
    expect(missingRewardRegistrations(true, false)).to.deep.equal(["revenueStaking"]);
    expect(missingRewardRegistrations(true, true)).to.deep.equal([]);
  });

  it("renders coverage totals, both yield cycles, and decoded errors", function () {
    const inventory = [
      { id: "token:value()", contractKey: "token", signature: "value()" },
      { id: "token:restricted()", contractKey: "token", signature: "restricted()" }
    ];
    const ledger = new CoverageLedger(inventory);
    ledger.record(inventory[0].id, { status: "passed-success", returnValue: "1" });
    ledger.record(inventory[1].id, {
      status: "passed-expected-revert",
      error: { decoded: "Unauthorized(0x00000000000000000000000000000000000000A1)" }
    });
    const cycles = {
      openingCycle: { elapsedSeconds: FIFTEEN_DAYS_SECONDS, components: { alpha: { metrics: {} } } },
      closingCycle: { elapsedSeconds: FIFTEEN_DAYS_SECONDS, components: { alpha: { metrics: {} } } }
    };
    const report = buildSimulationReport({
      metadata: { forkBlock: 123, release: "20" },
      ledger,
      cycles
    });
    const markdown = renderSimulationMarkdown(report);

    expect(report.overallStatus).to.equal("passed");
    expect(report.coverage.inventoryCount).to.equal(2);
    expect(report.reverts).to.have.length(1);
    expect(markdown).to.include("ABI Coverage: 2 / 2");
    expect(markdown).to.include("Opening 15-Day Cycle");
    expect(markdown).to.include("Closing 15-Day Cycle");
    expect(markdown).to.include("Unauthorized");
  });
});
