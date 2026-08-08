# CurveYield vlSDT Liquid Locker V20 — Audit Source Handoff

V20 is the normalized current audit handoff. The active source behavior is unchanged by this packaging cleanup.

## Current behavior and audit-relevant changes

- Yield Staking decay now uses cumulative additive rate-seconds, producing the same principal for the same elapsed time regardless of checkpoint frequency.
- Reward accrual is time-weighted over that same linear principal path so decay-driven emissions are cadence-independent.
- Normal Revenue Strategy migration must claim, convert, and compound ordinary rewards or revert.
- A separate emergency upgrade uses the same proposed strategy and seven-day delay, skips broken harvesting, returns principal, and permanently pauses/retires the old strategy.
- Revenue Staking yield above benchmark now charges 33% to Treasury and 7% to the live admin-role address; 60% of excess remains in the staker flow.

## Additional active systems

- Held cyGOV is spent before reserved mint capacity.
- Protected 30-day `maxMintRate` backing and automatic reserve top-ups.
- 5B / 10B / 15B / 20B initial allocations and 8% / 12% / 30% / 30% ongoing allocations.
- Yield Staking 2% initial withdrawal fee, 4% cap, daily decay rate 0–10, and 7-day setup plus 14-day rate timelocks.
- Revenue Strategy 3.9% performance fee, 0.1% caller fee, and 0.1% withdrawal fee.
- All protocol fees go to Treasury except Revenue Staking's 7% excess-yield admin fee; caller incentives remain caller payments.

## Verification status

Prior verification evidence reports successful Solidity 0.8.28 compilation and runtime-size checks. This V20 packaging pass did not compile or re-run those checks; auditors must independently verify them.

Prior verification evidence reports Ethereum-mainnet fork deployment and function simulation. Those results were not re-run during this V20 packaging pass.

Prior verification records report 72 passing tests with two baseline assertion failures:
`RevenueBenchmarkFeesV20.test.js` expects 635 tokens where the implementation
retains 700, and `RevenueVaultV20.test.js` has a one-wei checkpoint expectation.
Independent audit, ownership handoff, explorer verification, and production
deployment remain mandatory.

## Auditor entry point

1. `auditor/AUDITOR-README-v20.md`
2. `auditor/AUDIT-SCOPE-v20.md`
3. `auditor/THREAT-MODEL-v20.md`
4. `auditor/PRIVILEGE-MATRIX-v20.md`
5. `auditor/TEST-PLAN-v20.md`
6. `auditor/BYTE-SIZE-ESTIMATE-v20.md`
7. `auditor/KNOWN-UNVERIFIED-v20.md`
8. `auditor/STATIC-CHECK-OUTPUT-v20.txt`
9. `auditor/M01-AND-WITHDRAW-HARVEST-REMEDIATION-v20.md`

Useful commands:

- `npm run compile:v20`
- `npm run size:v20`
- `npm run test:v20`
- `npm run check:static:v20`
- `ETHEREUM_RPC_URL=<rpc> npm run simulate:functions:v20`
