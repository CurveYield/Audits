# Governance Mint Controls V18.3 Implementation Plan

**Goal:** Add delayed minter administration, delayed owner minting, governance-staking minter wiring, cap-headroom checks, and one-time/periodic governance reward mint approvals across Revenue Staking, Boost Staking, and Governance Staking.

**Excluded:** The unfinished time-based global unlock curve and all per-contract percentage/allotment caps that depend on that curve.

- Update `CurveYieldGovernanceToken.sol` with a seven-day deployment setup window, fourteen-day delayed minter additions after setup, seven-day delayed owner mint requests after setup, immediate minter revocation, and retained hard-cap enforcement.
- Update the governance-token interface with `remainingMintableSupply()`.
- Update Revenue and Boost Staking with explicit mint-headroom validation, delayed emission-rate changes, one-time governance reward mint approvals, periodic governance reward mint schedules, and funded reward accounting.
- Update Governance Staking with one-time and periodic governance mint approvals that mint to itself and queue the tokens into the next participation-multiplier reward cycle.
- Add Governance Staking to deployment minter configuration and verification.
- Add focused future tests and update documentation/manifests without compiling or running Solidity tests.
