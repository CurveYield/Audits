# Change Map: V18.7 → V18.8

## New

- `CurveYieldCyGovYieldStaking.sol`
- Yield Staking design and implementation plan documents.
- Static checks for Yield Staking and Revenue Staking benchmark fees.

## Governance Token

- Added `replaceMintReservation(id,newAmount,executableAt)`.
- Existing reservation is cancelled and exact replacement is created in one reverting transaction.
- Replacement-created Yield Staking reservations are protected from direct Governance Token owner cancellation.
- Automatic reserve creation after a held-only backing period uses the protected replacement path.
- Allocation reductions continue to validate against minted plus reserved usage.

## Allocations

- Revenue: 10B/15% → 5B/8%.
- vlBoost: 15B/30% → 10B/12%.
- Governance Staking Controller: 25B/40% → 20B/30%.
- New Yield Staking: 15B/30%.
- Aggregate ongoing allocation: 85% → 80%.

## Fee routing

- Revenue Strategy's 3.9% performance fee and 0.1% withdrawal fee now go to Treasury.
- Revenue Staking's separate admin-fee receiver was removed.
- Revenue Staking yield above benchmark changed from 33% DAO + 12% admin to 40% Treasury + 10% admin.
- The 40% portion goes to Treasury; the 10% portion goes only to the current Revenue Staking `admin` role and is the suite's sole non-Treasury protocol fee.

## Deployment

- Added Yield Staking deployment, original allocation, minter enablement, setup configuration, ownership handoff, and live verification.
- Updated aggregate allocation verification from 8,500 to 8,000 bps.
