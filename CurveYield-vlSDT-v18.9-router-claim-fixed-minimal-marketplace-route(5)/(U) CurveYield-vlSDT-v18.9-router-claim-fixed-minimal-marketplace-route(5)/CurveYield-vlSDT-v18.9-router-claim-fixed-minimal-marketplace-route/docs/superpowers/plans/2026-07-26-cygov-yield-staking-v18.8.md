# cyGOV Yield Staking V18.8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a cyvlSDT staking contract that pays only cyGOV, uses target-yield emissions with fully reserved 30-day max-rate backing, applies lazy linear daily decay, and updates the suite’s initial and ongoing mint allocations.

**Architecture:** `CurveYieldCyGovYieldStaking` maintains non-transferable staking shares, global reward-per-share accounting, a lazy principal index for linear interaction-triggered decay, and a reusable governance-token mint reservation backing `maxMintRate`. Reward liabilities are funded at checkpoint using free cyGOV inventory first and reserved mint capacity second. The governance token remains the global allocation and reservation authority. All protocol fees route to Treasury except Revenue Staking's 10% yield-over-benchmark admin fee, which follows the live `admin` role; harvest caller incentives remain caller payments rather than protocol fees.

**Tech Stack:** Solidity 0.8.28, OpenZeppelin Contracts 5.4.0, Hardhat package structure, Node.js static regression scripts. No Solidity compilation in this handoff.

## Global Constraints

- Do not run Solidity compilation.
- Initial allocations: Revenue 5B; vlBoost 10B; cyGOV Yield 15B; Governance Staking 20B.
- Ongoing maximum allocations: Revenue 8%; vlBoost 12%; cyGOV Yield 30%; Governance Staking 30%.
- `targetYield` is cyGOV per cyvlSDT per day using 1e18 precision.
- `maxMintRate` is cyGOV per day and must be backed by 30 days of free held cyGOV plus locked unused mint reservation.
- Held cyGOV funds accrued rewards before reserved mint capacity.
- Owner may mint only the unused portion of the original 15B allocation directly into contract storage.
- Withdrawal fee range 0–4%, initial 2%, paid to Treasury.
- `dailyDecayRate` range 0–10, initial 3, where one unit is 0.01% per completed day.
- Decay is linear across completed days at each standard interaction and paid to Treasury.
- Rate changes are immediate during the first 7 days, then require a 14-day timelock.
- Revenue vault strategy withdrawal and performance fees go to Treasury; harvest caller incentive remains paid to the caller.
- Revenue Staking yield above benchmark charges 40% Treasury + 10% admin, 50% total; the 10% portion goes only to the current Revenue Staking `admin` role address and is the sole non-Treasury fee.

---

### Task 1: Static requirement tests

**Files:**
- Create: `scripts/check-cygov-yield-staking-v18.js`
- Modify: `scripts/check-source-layout-v18.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: approved V18.8 requirements.
- Produces: a static regression command included in `check:static:v18`.

- [x] Write assertions for contract presence, constants, reservation backing, held-first funding, linear decay, Treasury fee routing, new allocations, and deployment wiring.
- [x] Run the new script and confirm it fails before production implementation.

### Task 2: Governance-token reservation support

**Files:**
- Modify: `contracts/CurveYieldGovernanceToken.sol`
- Modify: `contracts/interfaces/ICurveYield.sol`

**Interfaces:**
- Produces: reservation amount getter through the existing public mapping ABI and safe reservation replacement/resize support used by Yield Staking.

- [x] Add only the minimal reservation API needed to resize a minter-owned reservation atomically.
- [x] Preserve allocation-reduction protection through `reservedByMinter` usage checks.

### Task 3: cyGOV Yield Staking contract

**Files:**
- Create: `contracts/CurveYieldCyGovYieldStaking.sol`

**Interfaces:**
- Consumes: `ICurveYieldGovernanceToken` reservation and mint APIs.
- Produces: `stake`, `withdraw`, `claim`, `earned`, `setTargetYield`, `setMaxMintRate`, withdrawal-fee and decay configuration, direct initial-inventory minting, and reserve-rebalancing views/actions.

- [x] Implement global staking-share accounting and lazy linear decay.
- [x] Implement fully funded reward accrual and held-first payment sourcing.
- [x] Implement 30-day max-rate reservation locking and automatic top-up attempts.
- [x] Implement setup-window and post-setup timelocks.
- [x] Route all cyvlSDT fees to Treasury.

### Task 4: Suite fee routing and allocations

**Files:**
- Modify: `contracts/CurveYieldRevenueStrategyV7.sol`
- Modify: `contracts/CurveYieldVlSDTRevenueStaking.sol`
- Modify: `config-mainnet-v18.json`
- Modify: `deployment-v18/lib-v18.js`
- Modify: `deployment-v18/deploy-configure-v18.js`
- Modify: `deployment-v18/verify-deployment-v18.js`

**Interfaces:**
- Produces: new Yield Staking deployment/minter wiring, Treasury fee routing, and the sole Revenue Staking admin-role fee exception.

- [x] Route Revenue Strategy performance and withdrawal fees to Treasury.
- [x] Route Revenue Staking's 10% admin reward fee only to its current `admin` role address.
- [x] Deploy and configure Yield Staking as a governance-token minter with 15B/30% allocation.
- [x] Replace the other three allocations with 5B/8%, 10B/12%, and 20B/30%.

### Task 5: Auditor documentation and package verification

**Files:**
- Modify: release/readme/changelog/runbook/auditor documents and manifest.
- Create: V18.8 source diff and byte-size estimate.

**Interfaces:**
- Produces: an uncompiled auditor ZIP with independently verified static checks and source manifest.

- [x] Update all release metadata to 18.8.
- [x] Document uncompiled status and conservative byte-size estimates.
- [x] Run all static checks, regenerate manifest, archive, extract independently, and rerun checks.
