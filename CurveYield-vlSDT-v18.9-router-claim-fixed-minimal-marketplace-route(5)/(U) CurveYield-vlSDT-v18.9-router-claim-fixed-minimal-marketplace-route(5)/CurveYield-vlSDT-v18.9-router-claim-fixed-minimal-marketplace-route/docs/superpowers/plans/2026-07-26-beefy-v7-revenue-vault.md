# Beefy V7 Revenue Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic revenue compounder with a Beefy V7-derived vault, separate staking strategy, interchangeable converter, and automatic cyGOV distributor.

**Architecture:** The vault preserves Beefy V7's thin vault and delayed strategy upgrade flow. CurveYield-specific staking, fee, harvesting, conversion, and NAV-estimation behavior lives in the strategy; cyGOV accounting lives in a distributor; the initial converter stakes SDT through the locker.

**Tech Stack:** Solidity 0.8.28, OpenZeppelin Contracts 5.4, Hardhat 2.29, ethers 6.

## Global Constraints

- Keep the package uncompiled unless the existing local toolchain succeeds without troubleshooting.
- The initial converter supports SDT through Locker deposit only.
- cyGOV remains separately distributable.
- Standard deposits use economic NAV; standard withdrawals use realized NAV.
- Keep Beefy caller, performance, withdrawal fee, harvest-on-deposit, and delayed strategy-change models.
- Default fees are 3.9% performance, 0.1% caller, and 0.1% strategy withdrawal.
- Read the configurable Revenue Staking immediate withdrawal fee dynamically; net NAV and gross-up withdrawals must use the live value.

---

### Task 1: Define regression requirements

**Files:**
- Create: `scripts/check-beefy-revenue-vault-v18.js`
- Modify: `package.json`

**Interfaces:**
- Produces static assertions for the four new contracts and removal of the active monolithic compounder.

- [ ] Write assertions for Beefy strategy upgrade selectors, economic deposit pricing, strict deposit, distributor hook, converter timelock, fee caps, SDT-only initial converter, and cyGOV exclusion.
- [ ] Run the script and confirm it fails before the new sources exist.

### Task 2: Add shared interfaces

**Files:**
- Create: `contracts/interfaces/ICurveYieldRevenueVaultV7.sol`
- Create: `contracts/interfaces/ICurveYieldRevenueStrategyV7.sol`
- Create: `contracts/interfaces/ICurveYieldRevenueConverter.sol`
- Create: `contracts/interfaces/ICurveYieldCyGovDistributor.sol`

**Interfaces:**
- Strategy: `want`, `vault`, `beforeDeposit`, `beforeDepositStrict`, `deposit`, `withdraw`, `retireStrat`, `balanceOf`, `estimatedUnharvestedWant`, `pendingCyGov`, `claimCyGovToDistributor`.
- Converter: `outputToken`, `supportsToken`, `quote`, `convert`.
- Distributor: `checkpoint`, `sync`, `claim`, `earned`.

- [ ] Add the minimal interfaces used at each contract boundary.

### Task 3: Implement SDT locker converter

**Files:**
- Create: `contracts/CurveYieldSdtLockerConverter.sol`

**Interfaces:**
- Consumes SDT and Locker.
- Produces cyvlSDT to an explicit recipient.

- [ ] Require SDT input and cyvlSDT output.
- [ ] Pull the exact SDT amount, approve Locker, call `deposit`, clear approval, verify minimum output, and transfer/mint directly for the recipient.
- [ ] Return zero for unsupported quote requests.

### Task 4: Implement strategy

**Files:**
- Create: `contracts/CurveYieldRevenueStrategyV7.sol`

**Interfaces:**
- Consumes Revenue Staking, converter, vault, SDT, cyvlSDT, governance token, distributor.
- Produces the Beefy V7 strategy interface plus CurveYield NAV and strict-harvest extensions.

- [ ] Add staking and withdrawal behavior, including dynamic Revenue Staking fee preview, net-realizable NAV, and gross-up withdrawal requests.
- [ ] Add direct owner fee configuration with withdrawal max 250 bps and combined caller/performance max 1,000 bps.
- [ ] Add public harvest with caller fee and performance fee paid from newly converted cyvlSDT.
- [ ] Add best-effort and strict harvest paths.
- [ ] Add conservative unharvested-value estimation using converter quotes.
- [ ] Add 10-day converter replacement.
- [ ] Add `retireStrat` and cyGOV forwarding to distributor.

### Task 5: Implement cyGOV distributor

**Files:**
- Create: `contracts/CurveYieldCyGovDistributor.sol`

**Interfaces:**
- Consumes vault share balances, current vault strategy, Revenue Staking pending cyGOV, and Governance Staking.

- [ ] Index total lifetime cyGOV across current share supply.
- [ ] Checkpoint sender and receiver before every share change.
- [ ] Allow liquid claim and direct stake claim.
- [ ] Pull cyGOV through the active strategy only when distributor balance is insufficient.

### Task 6: Implement Beefy-derived vault

**Files:**
- Create: `contracts/CurveYieldRevenueVaultV7.sol`
- Archive: `contracts/CurveYieldRevenueCompounder.sol`

**Interfaces:**
- Consumes strategy and distributor interfaces.
- Produces Beefy V7 vault ABI plus `economicBalance` and `depositWithStrictHarvest`.

- [ ] Preserve Beefy V7 core vault functions and delayed strategy candidate flow.
- [ ] Add one-time initial strategy/distributor configuration for standalone deployment.
- [ ] Price standard deposits from economic NAV after best-effort pre-deposit behavior.
- [ ] Price strict deposits from realized NAV after strict harvest.
- [ ] Add automatic distributor checkpoint in `_update`.

### Task 7: Update deployment and verification

**Files:**
- Modify: `deployment-v18/deploy-configure-v18.js`
- Modify: `deployment-v18/verify-deployment-v18.js`
- Modify: `config-mainnet-v18.json`

**Interfaces:**
- Deployment order: vault shell, converter, strategy, distributor, vault initialization.

- [ ] Replace monolithic compounder deployment and configuration.
- [ ] Configure fees, harvest-on-deposit, keepers, converter, and strategy approval delay.
- [ ] Verify all cross-contract addresses and initial converter support.

### Task 8: Documentation and package verification

**Files:**
- Modify: `README-v18.md`, `CHANGELOG-v18.md`, `DELIVERY-NOTE-v18.md`, `DEPLOYMENT-RUNBOOK-v18.md`, `CODEX-AGENT-HANDOFF-v18.md`, `UNCOMPILED-STATUS-v18.md`, `STATIC-VERIFICATION-REPORT-v18.md`, `package.json`.

- [ ] Document the architecture and migration behavior.
- [ ] Run static checks, JavaScript syntax checks, Solidity delimiter checks, JSON parsing, strategy integrity, manifest verification, and ZIP integrity.
- [ ] Do not claim compilation or runtime-bytecode verification unless fresh artifacts exist.
