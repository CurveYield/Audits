# Audit Scope V20

## Primary changed contracts

- `contracts/CurveYieldCyGovYieldStaking.sol` — additive rate-seconds decay and time-weighted reward integration.
- `contracts/CurveYieldRevenueStrategyV20.sol` — strict harvest-before-retire, permanent retirement state, emergency retirement.
- `contracts/CurveYieldRevenueVaultV20.sol` — delayed `emergencyUpgradeStrat()` path.
- `contracts/interfaces/ICurveYieldRevenueStrategyV20.sol` — emergency retirement interface.
- `contracts/CurveYieldVlSDTRevenueStaking.sol` — 33% Treasury / 7% admin excess-yield split.

## Regression test sources

- `test/v20/CyGovYieldStakingV20.test.js`
- `test/v20/RevenueVaultV20.test.js`
- `test/v20/RevenueBenchmarkFeesV20.test.js`

All active contracts remain in scope for integration, access-control, fee-routing, and byte-size review. `archive-do-not-run/` is reference-only and must not be compiled or deployed.
