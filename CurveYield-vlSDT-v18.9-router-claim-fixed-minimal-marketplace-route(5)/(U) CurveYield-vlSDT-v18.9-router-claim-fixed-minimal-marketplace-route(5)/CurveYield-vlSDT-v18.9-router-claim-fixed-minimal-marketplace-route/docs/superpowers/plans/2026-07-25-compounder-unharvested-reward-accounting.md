# Compounder Unharvested Reward Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Protect existing compounder shareholders from deposit dilution caused by unharvested ordinary rewards while ensuring withdrawals pay only realized cyvlSDT.

**Architecture:** `totalAssets()` includes realized cyvlSDT plus a best-effort estimate of ordinary rewards attributable to the compounder. Deposits optionally attempt the already-configurable harvest before ERC-4626 share pricing. Standard exits use a separate realized-asset conversion, while `redeemWithHarvest` first attempts a configured harvest and then redeems against the resulting realized assets.

**Tech Stack:** Solidity 0.8.28, OpenZeppelin Contracts 5.4.0 ERC-4626/ERC-20, Hardhat JavaScript tests.

## Global Constraints

- Governance-token rewards remain excluded from compounder NAV and remain separately claimable.
- Missing or reverting reward quotes contribute zero estimated value and must not make deposits revert.
- Standard withdraw, redeem, and queued withdrawal paths must exclude all quoted/unrealized rewards.
- Harvest-assisted exit must calculate payout only after rewards have actually become cyvlSDT.
- Preserve the existing external strict harvest function and its caller-provided minimum outputs.
- Do not compile or execute Solidity tests in this source-only handoff.

---

### Task 1: Extend Revenue Staking Read Interface

**Files:**
- Modify: `contracts/interfaces/ICurveYield.sol`

**Interfaces:**
- Produces: `rewardTokenCount()`, `rewardTokens(uint256)`, and `earned(address,address)` reads.

- [x] Add the three read functions used for reward discovery and claimable balances.
- [x] Confirm signatures match the public array getter and existing Revenue Staking implementation.

### Task 2: Add Economic and Realized Asset Accounting

**Files:**
- Modify: `contracts/CurveYieldRevenueCompounder.sol`

**Interfaces:**
- Produces: `realizedAssets()`, `estimatedUnharvestedRewards()`, economic `totalAssets()`, and realized withdrawal conversion helpers.

- [x] Count idle and staked cyvlSDT as realized assets.
- [x] Value held plus earned SDT one-for-one in cyvlSDT terms.
- [x] Value earned cyvlSDT directly without double-counting idle cyvlSDT.
- [x] Quote held plus earned non-governance rewards through configured reward-to-SDT adapters.
- [x] Catch missing/reverting/zero quotes and contribute zero rather than reverting.
- [x] Route all existing withdrawal previews and queued requests through realized-only conversions.

### Task 3: Restore Harvest-on-Deposit Ordering

**Files:**
- Modify: `contracts/CurveYieldRevenueCompounder.sol`
- Modify: `deployment-v18/deploy-configure-v18.js`
- Modify: `config-mainnet-v18.json`

**Interfaces:**
- Produces: `harvestOnDeposit`, `setHarvestOnDeposit(bool)`, and a best-effort configured harvest helper.

- [x] Restore the owner-controlled toggle.
- [x] When enabled, attempt configured ordinary-reward harvesting before calling ERC-4626 `deposit` or `mint`.
- [x] Keep the existing external strict `harvest(...)` API unchanged.
- [x] Use configured adapters and live adapter quotes as minimum outputs for automatic harvesting.
- [x] Skip missing or failing optional routes without blocking deposits.
- [x] Add deployment configuration for the toggle.

### Task 4: Add Realized Harvest-Assisted Exit

**Files:**
- Modify: `contracts/CurveYieldRevenueCompounder.sol`
- Create: `test/v18/RevenueCompounderAccountingV18.test.js`

**Interfaces:**
- Produces: `redeemWithHarvest(uint256,address,address)`.

- [x] Attempt configured harvesting before determining the redeem payout.
- [x] Calculate the payout from realized assets after the attempt.
- [x] Never transfer an adapter quote or unclaimed reward estimate.
- [x] Preserve ERC-20 allowance handling through the existing ERC-4626 `_withdraw` path.
- [x] Add focused future tests for deposit dilution protection, non-reverting quote failure, realized-only standard exit, and post-harvest realized exit.

### Task 5: Documentation and Static Packaging

**Files:**
- Modify: `README-v18.md`
- Modify: `CHANGELOG-v18.md`
- Modify: `UNCOMPILED-STATUS-v18.md`
- Modify: `STATIC-VERIFICATION-REPORT-v18.md`
- Regenerate: `Source-Manifest-v18.sha256`

- [x] Document economic NAV versus realized exit NAV.
- [x] Document harvest-on-deposit ordering and `redeemWithHarvest`.
- [x] Run JavaScript syntax and active-source static checks only.
- [x] Regenerate source hashes and package as an explicitly uncompiled V18.2 handoff.

### Task 6: Strict Pre-Mint Harvest Deposit

**Files:**
- Modify: `contracts/CurveYieldRevenueCompounder.sol`
- Modify: `test/v18/RevenueCompounderAccountingV18.test.js`

**Interfaces:**
- Produces: `depositWithStrictHarvest(uint256,address)`.

- [x] Claim and convert all configured ordinary rewards before accepting depositor assets.
- [x] Revert atomically if a required claim or conversion cannot complete.
- [x] Calculate shares from realized cyvlSDT after harvesting.
- [x] Do not call economic NAV or unrealized reward estimation in this path.
- [x] Add focused future tests for successful strict harvesting and atomic failure.
