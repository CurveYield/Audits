# sdFXS Fraxtal Yield Fix v8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live sdFXS page derive staking APR and vault APY without calling the nonexistent Fraxtal XChain `working_balances()` method, while keeping failures isolated and correcting Fraxtal wallet metadata.

**Architecture:** Mark sdFXS as an XChain uniform-reward gauge. Read per-token APR from the deployed BoostHubStaking receipt contract, convert token-denominated APRs to USD APR using live/API prices, and use the deployed strategy's harvested `estimatedTokenAprBps` for vault APY when available. XChain gauges report a neutral 1.00x multiplier because they do not implement per-account Curve working balances. Metadata/price failures remain field-level and fall back to configured/API metadata.

**Tech Stack:** Static ES modules, ethers v6, Node test runner, Python Playwright browser QA.

## Global Constraints

- Do not modify any smart contract.
- Preserve all approved v7 wallet, transaction, IPFS, offline-shell, Admin, and layout behavior.
- Version the release as v8 and move runtime URLs from `src-v7`/`styles-v7.css` to `src-v9`/`styles-v9.css`.
- Do not run synthetic background tests in production; all regression tests are local/release-time only.

---

### Task 1: Add failing sdFXS XChain yield tests

**Files:**
- Create: `tests/unit/sdfxs-xchain-v8.test.mjs`
- Create: `tests/e2e/sdfxs-live-path-v8.py`

**Interfaces:**
- Consumes: exported yield helpers from `src-v9/live-data.js` / `src-v9/yield-math.js`.
- Produces: regression coverage proving XChain does not require `working_balances`, uses receipt APR, keeps 1.00x multiplier, and preserves partial metadata failures.

- [ ] Write unit tests for XChain uniform-yield calculation and APR price conversion.
- [ ] Run tests and confirm they fail before implementation.
- [ ] Add browser fixture where `working_balances()` reverts and metadata reads partially fail.
- [ ] Confirm the sdFXS page currently fails or loses APR/APY under that fixture.

### Task 2: Implement XChain receipt-yield path

**Files:**
- Modify: `src-v9/config.js`
- Modify: `src-v9/abi.js`
- Modify: `src-v9/live-data.js`
- Modify: `src-v9/yield-math.js`
- Modify: `src-v9/stakedao-lockers.js`
- Modify: `src-v9/app.js`

**Interfaces:**
- Consumes: `BoostHubStaking.reward_token_apr_bps(address)`, StakeDAO reward prices, strategy `estimatedTokenAprBps()` / `aprLastUpdate()`.
- Produces: `boostModel`, `boostMultiplier=1`, `boostHubAprBps`, `vaultApyBps`, per-reward APRs for sdFXS.

- [ ] Mark sdFXS with `gaugeModel: "xchain-uniform"`.
- [ ] Add staking APR and strategy APR ABI reads.
- [ ] Skip `working_balances()` for XChain gauges.
- [ ] Convert receipt token APR to USD APR: `tokenAprBps * rewardPriceUsd / depositPriceUsd`.
- [ ] Sum available receipt reward APRs for sdFXS; fall back to StakeDAO per-reward APRs when receipt APR reads are unavailable.
- [ ] Set sdFXS default APR and BoostHub APR to the uniform current APR and multiplier to `1.0`.
- [ ] Prefer nonzero strategy harvested APR for vault APY; otherwise compound the current receipt APR.
- [ ] Update the multiplier helper text to explain the XChain uniform 1.00x model.

### Task 3: Make metadata fail-soft and correct Fraxtal currency

**Files:**
- Modify: `src-v9/config.js`
- Modify: `src-v9/live-data.js`
- Modify: `src-v9/stakedao-lockers.js`

**Interfaces:**
- Consumes: configured token metadata and StakeDAO API token prices.
- Produces: a complete locker result even when token symbol/decimals or price requests fail.

- [ ] Change Fraxtal native currency to `FRAX`.
- [ ] Return sdToken/token price fields from StakeDAO locker parsing.
- [ ] Convert reward metadata fan-out to settled/fail-soft reads and use configured/API fallback metadata.
- [ ] Record metadata failures in `fieldErrors` without aborting the locker refresh.

### Task 4: Version, browser-test, and package v8

**Files:**
- Modify: `index.html`, `service-worker.js`, `package.json`, release docs/readmes.
- Create: v8 manifests and archives.

**Interfaces:**
- Consumes: complete v8 tree.
- Produces: `curveyield-boosthub-source-v8.zip`, `curveyield-boosthub-ipfs-ready-v8.zip`, `curveyield-boosthub-qa-evidence-v8.zip`.

- [ ] Update runtime/static asset URLs and cache names to v8.
- [ ] Run syntax and unit suites.
- [ ] Run the dedicated sdFXS XChain browser test.
- [ ] Run the complete existing browser QA suite.
- [ ] Capture sdFXS mobile/desktop screenshots.
- [ ] Generate SHA-256 manifests and verify them.
- [ ] Smoke-test primary static routes.
- [ ] Verify ZIP integrity.
