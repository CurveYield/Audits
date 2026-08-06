# Audit Scope V18.9

## Primary changed contracts

- `contracts/CurveYieldCyGovYieldStaking.sol` — additive rate-seconds decay and time-weighted reward integration.
- `contracts/CurveYieldRevenueStrategyV7.sol` — strict harvest-before-retire, permanent retirement state, emergency retirement.
- `contracts/CurveYieldRevenueVaultV7.sol` — delayed `emergencyUpgradeStrat()` path.
- `contracts/interfaces/ICurveYieldRevenueStrategyV7.sol` — emergency retirement interface.
- `contracts/CurveYieldVlSDTRevenueStaking.sol` — 33% Treasury / 7% admin excess-yield split.

## Regression test sources

- `test/v18/CyGovYieldStakingV18.test.js`
- `test/v18/RevenueVaultV18.test.js`
- `test/v18/RevenueBenchmarkFeesV18.test.js`

All active contracts remain in scope for integration, access-control, fee-routing, and byte-size review. `archive-do-not-run/` is reference-only and must not be compiled or deployed.
