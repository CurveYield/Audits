# Governance Staking Size Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce `CurveYieldGovernanceStaking` below the EIP-170 runtime limit while preserving its atomic proposal-sync actions and moving governance policy into `CurveYieldGovernanceBoostStrategy`.

**Architecture:** Strategy administration, proposal registration, proposal-digest reads, and community-bonus policy move to the replaceable Strategy. Staking retains accounting, reward checkpointing, snapshots, atomic `WithProposalSync` actions, and Strategy-only callbacks needed to update working weight safely.

**Tech Stack:** Solidity 0.8.28, Hardhat 2.29.0, Ethers 6.17.0, Mocha/Chai.

## Global Constraints

- Keep every operational constant `public`.
- Preserve all five atomic `WithProposalSync` entry points.
- Never edit or compile `archive-do-not-run/`.
- Do not bundle unrelated fixes for benchmark-fee or one-wei vault assertions.
- Compile Governance Staking with legacy code generation, optimizer enabled at runs `0`, and metadata CBOR/hash disabled.

---

### Task 1: Strategy Authority and Community Bonus

**Files:**
- Modify: `contracts/CurveYieldGovernanceBoostStrategy.sol`
- Modify: `contracts/interfaces/IGovernanceBoostStrategy.sol`
- Modify: `contracts/CurveYieldGovernanceStaking.sol`
- Test: `test/v18/GovernanceBoostStrategyV18.test.js`

**Interfaces:**
- Strategy produces `governanceBoostBps(address)`, `communityBonusBps(address)`, and `setCommunityBonusBps(address,uint256)`.
- Staking produces `syncCommunityBonus(address)` callable only by the active Strategy.

- [x] Add failing tests proving the Staking owner can administer the Strategy directly, unauthorized callers revert, community bonuses update Staking working weight atomically, and old Strategy bonuses remain readable after Strategy replacement.
- [x] Run the focused test and confirm failure because the direct Strategy APIs do not yet exist.
- [x] Implement dynamic Staking-owner authorization, lazy previous-Strategy bonus fallback, and the Strategy-to-Staking synchronization callback.
- [x] Run the focused test and confirm it passes.

### Task 2: Remove Redundant Staking Surface

**Files:**
- Modify: `contracts/CurveYieldGovernanceStaking.sol`
- Modify: `test/v18/GovernanceRewardBatchingV18.test.js`
- Modify: `test/v18/GovernanceWithdrawalV18.test.js`
- Modify: deployment/static scripts that call removed proxies

- [x] Add ABI assertions proving removed overloads/proxies are absent and retained functions remain.
- [x] Remove the five standalone Strategy proxies, `startRewardCycle(address)`, `setNotifiers`, `participationStreamActive`, and the two-argument `setWithdrawalConfig`.
- [x] Route deployment and verification calls directly to the Strategy.
- [x] Run focused governance tests.

### Task 3: Size Configuration and Verification

**Files:**
- Modify: `hardhat.config.js`
- Modify: `scripts/check-contract-size-v18.js`
- Modify: `Source-Manifest-v18.sha256`

- [x] Configure the Governance Staking override with `viaIR: false`, optimizer runs `0`, and disabled metadata CBOR/hash.
- [x] Clean compile and require Governance Staking runtime below 24,576 bytes.
- [x] Run the complete Hardhat suite, static checks, and size checks.
- [x] Update source-manifest hashes only after verification.
- [x] Package source without dependencies, cache, or generated artifacts.

Verification result: 71 Solidity files compile; Governance Staking runtime is
23,917 bytes (659 bytes below EIP-170); focused Strategy tests and all static
checks pass; the full suite is 45 passing with two unchanged pre-existing
assertion failures. The real mainnet-fork Anvil deployment, configuration,
ownership handoff, and final verification preflight passed.
