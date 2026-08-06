# CurveYield vlSDT Liquid Locker V18.9 — Verified Source Handoff

V18.9 resolves the two V18.8 audit findings without changing cyGOV reward top-up, reservation, or funding behavior.

## V18.9 changes

- Yield Staking decay now uses cumulative additive rate-seconds, producing the same principal for the same elapsed time regardless of checkpoint frequency.
- Reward accrual is time-weighted over that same linear principal path so decay-driven emissions are cadence-independent.
- Normal Revenue Strategy migration must claim, convert, and compound ordinary rewards or revert.
- A separate emergency upgrade uses the same proposed strategy and seven-day delay, skips broken harvesting, returns principal, and permanently pauses/retires the old strategy.
- Revenue Staking yield above benchmark now charges 33% to Treasury and 7% to the live admin-role address; 60% of excess remains in the staker flow.

## Unchanged V18.8 systems

- Held cyGOV is spent before reserved mint capacity.
- Protected 30-day `maxMintRate` backing and automatic reserve top-ups.
- 5B / 10B / 15B / 20B initial allocations and 8% / 12% / 30% / 30% ongoing allocations.
- Yield Staking 2% initial withdrawal fee, 4% cap, daily decay rate 0–10, and 7-day setup plus 14-day rate timelocks.
- Revenue Strategy 3.9% performance fee, 0.1% caller fee, and 0.1% withdrawal fee.
- All protocol fees go to Treasury except Revenue Staking's 7% excess-yield admin fee; caller incentives remain caller payments.

## Verification status

The source was clean-compiled with Solidity 0.8.28: 71 Solidity files compiled
successfully. All 14 deployable runtime bytecodes are below EIP-170; the largest,
`CurveYieldGovernanceStaking`, is 23,917 bytes (659 bytes below the 24,576-byte
limit).

A real Ethereum-mainnet Anvil fork deployed and configured all 14 contracts,
classified all 736 directly callable ABI signatures, and completed opening and
closing deposit → 15-day wait → harvest → withdrawal cycles for every applicable
staking/vault contract. The successful machine-readable and Markdown reports are
in `deployment-output-v18/`.

The full local suite is 72 passing with two unchanged baseline assertion failures:
`RevenueBenchmarkFeesV18.test.js` expects 635 tokens where the implementation
retains 700, and `RevenueVaultV18.test.js` has a one-wei checkpoint expectation.
Independent audit, ownership handoff, explorer verification, and production
deployment remain mandatory.

## Auditor entry point

1. `auditor/AUDITOR-README-v18.9.md`
2. `auditor/CHANGE-MAP-v18.8-to-v18.9.md`
3. `auditor/AUDIT-SCOPE-v18.9.md`
4. `auditor/THREAT-MODEL-v18.9.md`
5. `auditor/PRIVILEGE-MATRIX-v18.9.md`
6. `auditor/TEST-PLAN-v18.9.md`
7. `auditor/BYTE-SIZE-ESTIMATE-v18.9.md`
8. `auditor/KNOWN-UNVERIFIED-v18.9.md`
9. `auditor/STATIC-CHECK-OUTPUT-v18.9.txt`
10. `auditor/SOURCE-DIFF-v18.8-to-v18.9.patch`

Useful commands:

- `npm run compile:v18`
- `npm run size:v18`
- `npm run test:v18`
- `npm run check:static:v18`
- `ETHEREUM_RPC_URL=<rpc> npm run simulate:functions:v18`
