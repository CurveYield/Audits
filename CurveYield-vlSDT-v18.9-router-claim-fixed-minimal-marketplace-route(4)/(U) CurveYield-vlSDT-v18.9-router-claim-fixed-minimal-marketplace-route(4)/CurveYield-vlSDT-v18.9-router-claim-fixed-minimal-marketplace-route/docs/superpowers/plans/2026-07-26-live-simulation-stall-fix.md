# V18.9 Live Simulation Stall Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagnose and minimally fix the unbounded post-configuration stall in the V18.9 live mainnet-fork simulation.

**Architecture:** Preserve the approved runner and instrument a disposable copy at the provider boundary. Convert the proven failure into a focused regression test, then apply one minimal change to a separately named fixed runner or existing simulation helper.

**Tech Stack:** Node.js 24, Ethers 6.17, Hardhat 2.29, Solidity 0.8.28, Anvil 1.7.1.

## Global Constraints

- Preserve the approved script SHA-256 `213825aadf4074383d4a91d5a8c79de2ff93fc625979e93217906a54319780d3`.
- Never write or log the RPC URL.
- Never fabricate SDT, cyvlSDT, rewards, or time cycles.
- Make no contract or production-configuration changes unless trace evidence proves they are required.

---

### Task 1: Locate the Stall

**Files:**
- Create: `deployment-v18/simulate-live-deployment-30d-v18.9-diagnostic.js`
- Preserve: `deployment-v18/simulate-live-deployment-30d-v18.9.js`
- Produce: `deployment-output-v18/execution-logs-v18.9/08-live-30d-diagnostic.log`

**Interfaces:**
- Consumes: the reviewed runner and its existing `runLiveDeploymentSimulation` flow.
- Produces: stage and JSON-RPC request/response markers proving the last unresolved operation.

- [ ] Copy the reviewed runner and verify both files initially have the approved hash.
- [ ] Add provider debug markers only to the diagnostic copy after canonical deployment.
- [ ] Add major stage markers around wiring, metadata, funding, deposits, keeper, harvest, and withdrawal phases.
- [ ] Run the diagnostic copy against the same RPC with a host-level execution bound.
- [ ] Record the exact last request or stage and its elapsed time.

### Task 2: Regression Test

**Files:**
- Create or modify: `test/v18/LiveSimulationStallV18.test.js`
- Test: `test/v18/LiveSimulationStallV18.test.js`

**Interfaces:**
- Consumes: the exact function or helper proven to stall.
- Produces: a deterministic failing test that detects the missing bound or incorrect async behavior.

- [ ] Write one focused test for the proven failure.
- [ ] Run `npx hardhat test test/v18/LiveSimulationStallV18.test.js` and confirm the expected failure.
- [ ] Record the failing assertion and exclude unrelated behavior.

### Task 3: Minimal Fix

**Files:**
- Create: `deployment-v18/simulate-live-deployment-30d-v18.9-fixed.js`, or modify the exact shared helper proven responsible.
- Preserve: `deployment-v18/simulate-live-deployment-30d-v18.9.js`

**Interfaces:**
- Consumes: the regression test and proven root cause.
- Produces: a bounded, non-duplicating execution path with explicit error evidence.

- [ ] Implement the smallest change that resolves the proven cause.
- [ ] Run the focused test and confirm it passes.
- [ ] Re-run the test with the fix temporarily reverted and confirm it fails.
- [ ] Restore the fix and confirm the test passes again.

### Task 4: Full Verification

**Files:**
- Produce: `deployment-output-v18/execution-logs-v18.9/09-live-30d-fixed.log`
- Produce: fixed-run JSON and Markdown reports.

**Interfaces:**
- Consumes: the fixed runner, real Ethereum fork, and production configuration.
- Produces: final deployment, deposit, time-warp, harvest, withdrawal, reward, and failure evidence.

- [ ] Run `node --check` on reviewed, diagnostic, and fixed runners.
- [ ] Run the focused regression test and the existing V18 test suite.
- [ ] Run `npm run compile:v18`.
- [ ] Run the fixed 30-day fork simulation with the RPC held only in memory.
- [ ] Verify report JSON parses and contains all required stage results.
- [ ] Verify the RPC secret is absent from every deliverable.
- [ ] Re-hash the approved reviewed script and confirm it remains unchanged.

