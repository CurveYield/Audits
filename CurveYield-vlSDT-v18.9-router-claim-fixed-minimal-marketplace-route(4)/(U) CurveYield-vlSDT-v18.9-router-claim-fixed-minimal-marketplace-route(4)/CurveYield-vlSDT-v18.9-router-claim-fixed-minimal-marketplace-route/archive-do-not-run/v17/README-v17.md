# CurveYield vlSDT Liquid Locker V17 — Codex Deployment Package

This package contains the V17 contracts plus a resumable deployment workflow for Ethereum mainnet. It is designed for a local Codex agent to compile, test, run a full Anvil fork simulation, deploy under the deployer wallet, configure the system, verify every required link, and only then hand ownership to:

`0x9f2B20A772246960810045905B7daccf960eE288`

## Non-negotiable deployment rules

- The deployment scripts make **no Aragon DAO, Admin-plugin, proposal, or permission calls**.
- Every contract is deployed with the deployer as initial owner.
- The deployer remains owner through all configuration and verification.
- Treasury and fee receivers are configured as the final owner address.
- Ownership handoff is a separate two-step process and requires explicit environment confirmations.
- Revenue Staking's admin is self-administered. Only the current admin can change the admin or admin fee receiver.
- The same admin may allocate up to the fixed 5% vlBoost reserve through Locker `delegateAdminBoost`. The owner cannot use that admin allocation or increase the 5% cap.
- The ERC-4626 vault asset and other functional dependencies remain immutable.

## Contract set

1. `CurveYieldGovernanceTokenV17`
2. `CurveYieldGovernanceStakingV17`
3. `CurveYieldVlSDTTokenV17`
4. `CurveYieldVlSDTLockerV17`
5. `CurveYieldVlSDTRevenueStakingV17`
6. `CurveYieldVlSDTBoostStakingV17`
7. `CurveYieldVlSDTBoostMerchantV17`
8. `CurveYieldRevenueCompounderV17`

Governance Staking uses continuous 14-day active-deposit accounting for every reward token. Reducing or withdrawing stake immediately reduces or stops future accrual; amounts accrued before the balance change remain claimable.

## Start here

1. Read `CODEX-AGENT-HANDOFF-v17.md`.
2. Review and complete `config-mainnet-v17.json`.
3. Copy `.env.example-v17` to a local untracked environment file or set the variables in the shell.
4. Run the static package checks.
5. Install dependencies and compile.
6. Run the full test suite.
7. Run the Anvil fork preflight.
8. Review the generated gas/state reports.
9. Run live deployment/configuration.
10. Verify under deployer ownership.
11. Propose ownership handoff.
12. Accept ownership from the final-owner wallet.
13. Run final verification.

Exact commands and stop conditions are in `DEPLOYMENT-RUNBOOK-v17.md`.

## Gas minimization used

- Existing state is read before every configurable write, so resumptions skip completed operations.
- Existing array setters are used for minters and notifiers instead of one transaction per address.
- Constructor values set final fee receivers immediately, avoiding redundant post-deployment writes.
- Default-zero/default-range settings are skipped when already correct.
- Deployment order follows constructor dependencies and does not deploy a temporary coordinator contract.
- Gas estimation is performed per transaction with a configurable safety multiplier; the multiplier changes the limit, not actual gas consumed.
- A persistent state file makes every phase resumable without redeploying contracts that already contain code.

See `GAS-OPTIMIZATION-NOTES-v17.md` for tradeoffs.

## Verification status

The package received dependency-free static checks and JavaScript syntax checks. Solidity compilation, Hardhat execution, and Anvil fork execution must be completed by the Codex agent before any live broadcast. This package is not an audit and is not production approval.
