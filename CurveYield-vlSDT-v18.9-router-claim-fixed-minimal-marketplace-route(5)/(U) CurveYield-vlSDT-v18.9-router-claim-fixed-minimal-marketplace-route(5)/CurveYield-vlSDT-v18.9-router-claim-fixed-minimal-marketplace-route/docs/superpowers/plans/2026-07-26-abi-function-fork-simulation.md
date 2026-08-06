# ABI Function Fork Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build and run a no-mock, real-mainnet-fork harness that calls and classifies every public/external ABI function across the 14 deployed CurveYield contracts, with opening and closing 15-day yield cycles.

**Architecture:** A single entry point owns Anvil and deployment lifecycle. Small simulation modules provide ABI inventory/coverage enforcement, call execution/error decoding, real-fork actors and funding, contract scenarios, two 15-day yield cycles, snapshots, and JSON/Markdown reporting.

**Tech Stack:** Node.js, Ethers 6.17.0, Hardhat artifacts, Anvil mainnet fork, Mocha/Chai.

## Global Constraints

- Cover every directly callable public/external ABI entry generated from `DEPLOYABLES`.
- Exclude internal/private functions and `archive-do-not-run/`.
- Never deploy mocks or replace external mainnet code.
- Start one fork and deploy/configure once.
- Opening and closing cycles each advance time exactly 15 days once.
- Every unexpected revert records decoded error data and trace context.
- Missing, failed, or blocked coverage makes the harness exit nonzero.
- Never store the supplied RPC URL or ephemeral private keys.

---

### Task 1: ABI Inventory and Coverage Ledger

**Files:**
- Create: `deployment-v18/simulation-v18/coverage-v18.js`
- Create: `test/v18/FunctionSimulationHarnessV18.test.js`

- [x] Write failing tests for canonical signatures, 743-entry inventory, duplicate rejection, valid terminal statuses, and missing-signature failure.
- [x] Run the focused test and confirm failure because the coverage module is absent.
- [x] Implement inventory generation and the coverage ledger.
- [x] Run the focused test and confirm the inventory/ledger tests pass.

### Task 2: Call Executor and Error Reports

**Files:**
- Create: `deployment-v18/simulation-v18/executor-v18.js`
- Modify: `test/v18/FunctionSimulationHarnessV18.test.js`

- [x] Add failing tests for success records, expected reverts, unexpected reverts, panic/custom-error decoding, and continued execution after failure.
- [x] Run the focused test and confirm the new cases fail.
- [x] Implement the common call executor and serializable error decoder.
- [x] Run the focused test and confirm all executor cases pass.

### Task 3: Fifteen-Day Cycle Accounting

**Files:**
- Create: `deployment-v18/simulation-v18/yield-cycles-v18.js`
- Modify: `test/v18/FunctionSimulationHarnessV18.test.js`

- [x] Add failing tests proving one shared 1,296,000-second time advance, opening/closing report separation, PPS not-applicable handling, and principal/reward/yield deltas.
- [x] Run the focused test and confirm failure.
- [x] Implement cycle orchestration and accounting helpers.
- [x] Run the focused test and confirm cycle tests pass.

### Task 4: Real-Fork Actors and Scenario Registry

**Files:**
- Create: `deployment-v18/simulation-v18/actors-v18.js`
- Create: `deployment-v18/simulation-v18/scenarios-v18.js`
- Create: `deployment-v18/simulation-v18/contract-scenarios-v18.js`
- Modify: `test/v18/FunctionSimulationHarnessV18.test.js`

- [x] Add failing tests for ABI argument synthesis, per-signature scenario assignment, snapshot isolation, and zero unclassified signatures.
- [x] Implement deterministic ephemeral actors, bounded real-holder discovery, impersonation, argument synthesis, generic read/write probes, and specialized deployment/lifecycle coverage.
- [x] Run focused tests and require every compiled ABI signature to receive at least one scenario.

### Task 5: Entry Point and Reports

**Files:**
- Create: `deployment-v18/simulation-v18/report-v18.js`
- Create: `deployment-v18/simulate-all-functions-v18.js`
- Modify: `package.json`
- Modify: `scripts/check-javascript-v18.js` only if its file discovery requires explicit inclusion

- [x] Add failing tests for JSON/Markdown totals, error sections, cycle tables, and nonzero overall status.
- [x] Implement Anvil startup, fork pinning, deployment/configuration, opening cycle, ABI scenarios, restored canonical state, closing cycle, reports, and exit status.
- [x] Add `simulate:functions:v18` npm command.
- [x] Run focused harness tests and JavaScript checks.

### Task 6: Full Verification and Live Fork

**Files:**
- Create during execution only: `deployment-output-v18/function-simulation-*.json`
- Create during execution only: `deployment-output-v18/function-simulation-*.md`
- Modify after verification: `Source-Manifest-v18.sha256`

- [x] Clean-compile 71 Solidity files.
- [x] Run focused harness tests, existing focused Strategy tests, and all static checks.
- [x] Run the harness once against the supplied RPC-backed mainnet Anvil fork.
- [x] Require 100% ABI classification, zero missing/blocked/failed entries, and two completed 15-day cycles per applicable staking/vault contract.
- [x] Remove ephemeral fork state and failed diagnostic reports; retain the successful JSON/Markdown reports.
- [x] Regenerate and verify the source manifest.
- [x] Package and save the corrected v18.9 source separately from prior archives.
