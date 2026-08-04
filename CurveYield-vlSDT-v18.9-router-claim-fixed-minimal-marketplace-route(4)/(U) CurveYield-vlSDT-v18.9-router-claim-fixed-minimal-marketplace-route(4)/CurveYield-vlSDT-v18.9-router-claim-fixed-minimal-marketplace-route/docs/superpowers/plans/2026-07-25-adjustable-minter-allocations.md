# Adjustable Minter Allocations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the owner to reduce or restore each configured staking module's governance-token allocation between 30% and 100% of its original deployment allocation without undercutting minted or reserved obligations.

**Architecture:** The governance token records an immutable post-setup baseline for each configured module. During the first seven days, allocation configuration applies immediately and updates that baseline. Afterwards, changes require a 14-day queue and must remain within 30%-100% of both original initial and ongoing allocations; proposal and execution both verify the module's minted plus reserved usage fits under the proposed live allowance.

**Tech Stack:** Solidity 0.8.28, OpenZeppelin Contracts 5.4.0, Hardhat JavaScript tests and deployment scripts.

## Global Constraints

- Do not compile Solidity or run Hardhat tests in this handoff session.
- Preserve the supplied `CurveYieldGovernanceBoostStrategy.sol` byte-for-byte.
- Keep the seven-day initial configuration period.
- Use a fourteen-day allocation-change delay after initial configuration.
- Module allocations may not fall below 30% or exceed 100% of their original configured initial and ongoing values.
- A decrease must satisfy `mintedByMinter + reservedByMinter <= proposed live allowance` at proposal and execution.

---

### Task 1: Token allocation baselines and range enforcement

**Files:**
- Modify: `contracts/CurveYieldGovernanceToken.sol`
- Test: `test/v18/GovernanceMintControlsV18.test.js`

**Interfaces:**
- Produces: `originalMinterAllocation(address)`, `minimumMinterAllocation(address)`, and the existing queued `setMinterAllocation` / `executeMinterAllocation` flow with 30%-100% bounds.

- [x] Record the latest setup-window allocation as the module's original baseline.
- [x] Require post-setup proposals to stay between 30% and 100% of each baseline component.
- [x] Replace the blanket active-reservation prohibition with a minted-plus-reserved solvency check.
- [x] Re-run the same range and solvency checks when executing after 14 days.
- [x] Add regression tests for safe reduction, restoration, range rejection, timelock enforcement, and conflicting usage rejection.

### Task 2: Deployment, verification, and documentation

**Files:**
- Modify: `deployment-v18/deploy-configure-v18.js`
- Modify: `deployment-v18/verify-deployment-v18.js`
- Modify: `scripts/check-governance-mint-controls-v18.js`
- Modify: `config-mainnet-v18.json`
- Modify: `README-v18.md`
- Modify: `CHANGELOG-v18.md`
- Modify: `CODEX-AGENT-HANDOFF-v18.md`
- Modify: `DEPLOYMENT-RUNBOOK-v18.md`
- Modify: `STATIC-VERIFICATION-REPORT-v18.md`
- Modify: `UNCOMPILED-STATUS-v18.md`
- Modify: `DELIVERY-NOTE-v18.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: token baseline and minimum-allocation getters from Task 1.
- Produces: V18.5 deployment metadata and static verification coverage.

- [x] Configure the original module allocations only during the setup window and avoid silently restoring owner-reduced allocations on later deployment-script reruns.
- [x] Verify original baselines against config while accepting any live allocation within the permitted range.
- [x] Add static checks for the 30% floor, 14-day delay, and usage-aware reduction rule.
- [x] Update package metadata and operator documentation to V18.5.
- [x] Regenerate the source manifest and ZIP after static verification.
