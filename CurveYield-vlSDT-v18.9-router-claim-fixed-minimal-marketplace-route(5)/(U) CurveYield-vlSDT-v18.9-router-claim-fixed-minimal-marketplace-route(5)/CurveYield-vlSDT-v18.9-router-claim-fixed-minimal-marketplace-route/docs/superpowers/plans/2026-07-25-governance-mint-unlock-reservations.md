# Governance Mint Unlock and Reservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the finalized 200B-to-4B-floor time-based mint unlock schedule, per-module quotas, and token-level reservations that prevent approved mint obligations across contracts from overbooking global or module capacity.

**Architecture:** The governance token is the sole source of truth for unlocked supply, per-minter allocation, minted amounts, and reservations. Revenue Staking, Boost Staking, Governance Staking, and owner mint requests reserve capacity before delayed approvals or future periodic executions; continuous emissions reserve only amounts actually accrued before indexing them to users.

**Tech Stack:** Solidity 0.8.28, OpenZeppelin Contracts 5.4.0, Hardhat 2.29.0, ethers 6.17.0.

## Global Constraints

- Do not modify `CurveYieldGovernanceBoostStrategy.sol`.
- Do not compile, run Solidity tests, deploy, broadcast, or verify.
- Preserve the one-trillion hard cap.
- Initial unlocked supply is 200 billion tokens.
- Monthly unlocks begin 30 days after deployment at 20B, decline 500M each month through 10B, then decline 200M each month through 4B, then remain at 4B monthly.
- Revenue Staking quota: 10B initial plus 15% of additional unlocked supply.
- Boost Staking quota: 15B initial plus 30% of additional unlocked supply.
- Governance Staking quota: 25B initial plus 40% of additional unlocked supply.
- All mint paths must respect hard cap, currently unlocked supply, global reservations, and the caller's module quota. Future execution timestamps may not borrow from later monthly unlocks.
- Pending owner mints, delayed one-time mints, the next periodic installment, and accrued continuous emissions must reserve centrally so contracts cannot approve conflicting obligations.

---

### Task 1: Governance token schedule, quotas, and reservations

**Files:**
- Modify: `contracts/CurveYieldGovernanceToken.sol`
- Modify: `contracts/interfaces/ICurveYield.sol`
- Test: `test/v18/GovernanceMintControlsV18.test.js`

- [ ] Add schedule views and enforce current unlocked supply.
- [ ] Add timelocked minter allocation configuration and aggregate allocation limits.
- [ ] Add exact and best-effort reservation APIs, partial reservation consumption, cancellation, and periodic roll-forward.
- [ ] Route direct minter and owner minting through global and module availability checks.

### Task 2: Revenue and Boost mint reservations

**Files:**
- Modify: `contracts/CurveYieldVlSDTRevenueStaking.sol`
- Modify: `contracts/CurveYieldVlSDTBoostStaking.sol`
- Test: `test/v18/GovernanceMintControlsV18.test.js`

- [ ] Reserve delayed one-time approvals.
- [ ] Reserve pending and active next periodic installments.
- [ ] Reserve continuous emissions before recording reward-per-token accrual.
- [ ] Mint claims from their emission reservation instead of unreserved supply.

### Task 3: Governance Staking mint reservations

**Files:**
- Modify: `contracts/CurveYieldGovernanceStaking.sol`
- Test: `test/v18/GovernanceMintControlsV18.test.js`

- [ ] Reserve delayed one-time approvals.
- [ ] Reserve the next periodic installment and roll it after execution.
- [ ] Mint only from exact reservations before adding rewards to the next participation-eligible cycle.

### Task 4: Deployment, static checks, and handoff

**Files:**
- Modify: `config-mainnet-v18.json`
- Modify: `deployment-v18/deploy-configure-v18.js`
- Modify: `deployment-v18/verify-deployment-v18.js`
- Modify: `scripts/check-governance-mint-controls-v18.js`
- Modify: handoff Markdown files and manifests

- [ ] Configure 10B/15%, 15B/30%, and 25B/40% allocations before enabling minters.
- [ ] Add static assertions for schedule constants, reservation APIs, and all module integrations.
- [ ] Run only JavaScript, JSON, source-layout, strategy-integrity, manifest, and ZIP checks.
