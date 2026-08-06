# Governance Staking v18 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Produce an archive-isolated, uncompiled v18 handoff that uses the supplied governance boost strategy and implements the approved withdrawal and stream changes.

**Architecture:** Governance Staking delegates proposal history and base boost calculation to a replaceable strategy while retaining reward checkpointing and community bonus composition. Active Hardhat paths contain only unversioned public contracts; V17 remains under `archive-do-not-run/v17`.

**Tech Stack:** Solidity 0.8.28, OpenZeppelin Contracts, Hardhat, JavaScript deployment scripts, Python static source checks.

## Global Constraints

- Do not compile, run Solidity tests, deploy, or verify.
- Active public contract names and filenames are unversioned.
- The supplied `CurveYieldGovernanceBoostStrategy.sol` is used, not recreated.
- Historical V17 files remain under `archive-do-not-run/v17` and are excluded from discovery.

---

### Task 1: Static regression specification
- [x] Add source-level assertions for strategy delegation, withdrawal formulas, reward queues, public names, deployment consistency, and archive isolation.
- [x] Run the assertions and confirm they fail before active implementation exists.

### Task 2: Active unversioned source tree
- [x] Create active unversioned copies of the seven system contracts, interfaces, and mocks.
- [x] Add the supplied boost strategy and its interfaces.
- [x] Remove V17 imports and symbols from active Solidity.

### Task 3: Governance Staking refactor
- [x] Remove duplicate proposal/history storage and evaluation logic.
- [x] Add configurable strategy validation; read proposal/history getters directly from the strategy.
- [x] Preserve reward checkpoint-before-weight-refresh ordering.

### Task 4: Withdrawal logic
- [x] Add 15% standard fee cap, 3% base fee cap, and 150-day delay cap.
- [x] Snapshot all queue terms.
- [x] Add base-only mature completion and owner-only early completion with linear 50% standard-fee reduction.
- [x] Add first-week direct configuration and later seven-day delayed configuration.

### Task 5: Reward cycle logic
- [x] Limit active streams to 14 per token and reward class.
- [x] Batch pending rewards for 24 hours.
- [x] Add permissionless and automatic ready-cycle starts.
- [x] Requeue zero-supply streamed rewards.

### Task 6: Deployment and handoff
- [x] Deploy staking, deploy supplied strategy bound to staking, then configure the strategy.
- [x] Update config defaults to 300 standard-fee bps, 0 base-fee bps, and 14 days.
- [x] Create v18 docs, manifest, static report, and final ZIP.
