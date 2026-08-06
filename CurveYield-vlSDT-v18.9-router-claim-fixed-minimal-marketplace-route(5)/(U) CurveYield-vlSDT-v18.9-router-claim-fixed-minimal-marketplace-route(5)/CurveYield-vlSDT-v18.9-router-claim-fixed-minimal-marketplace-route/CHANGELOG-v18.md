# V18.9

- Fixed M-01 by replacing checkpoint-compounded decay with cumulative additive rate-seconds.
- Added time-weighted reward integration over the same linear principal schedule without changing reward top-ups or mint funding.
- Fixed M-02 by requiring normal strategy retirement to harvest/compound or revert.
- Added seven-day delayed emergency strategy upgrade that skips failed harvest, returns principal, and permanently retires the old strategy.
- Changed excess-yield fees to 33% Treasury plus 7% live admin, 40% total.
- Added regression tests, verifier checks, threat model, test plan, size estimates, and V18.8→V18.9 source diff.

---
# V18.8

## cyGOV Yield Staking

- Added `CurveYieldCyGovYieldStaking` for cyvlSDT deposits and cyGOV-only rewards.
- Added target-yield emissions capped by a configured daily max rate.
- Added atomic 30-day max-rate backing through free held cyGOV plus a protected mint reservation.
- Added held-first reward funding and fully funded accrued liabilities.
- Ensured the first automatic reservation created after held-only backing is consumed is also protected.
- Added owner inventory minting limited to the unused part of the original 15B initial allocation.
- Added a 2% initial withdrawal fee with a 4% cap, paid to Treasury.
- Added lazy linear daily decay, initial rate 3 and range 0–10, paid to Treasury.
- Added seven-day setup configuration followed by 14-day rate-change timelocks.

## Governance Token and allocations

- Added atomic exact replacement of a caller-owned quota-controlled mint reservation.
- Protected replacement-created Yield Staking reservations from direct Governance Token owner cancellation; immediate minter revocation remains an auditor-review emergency surface.
- Added Yield Staking as a governance minter.
- Changed original allocations to Revenue 5B/8%, vlBoost 10B/12%, Yield Staking 15B/30%, Governance Staking Controller 20B/30%.

## Fee routing and benchmark split

- Revenue Strategy performance and withdrawal fees now always go to Treasury.
- Compounding-vault withdrawal fees therefore leave the strategy for Treasury rather than remaining invested.
- Revenue Staking has no separate admin-fee receiver: its 10% excess-yield admin fee follows the current `admin` role address and is the suite's sole non-Treasury fee.
- Yield over benchmark now charges 40% Treasury plus 10% admin, 50% total.

## Deployment and audit package

- Added Yield Staking deployment, minter allocation, initial configuration, ownership handoff, and verification.
- Added static arithmetic/regression checks for backing, held-first funding, linear decay, allocations, Treasury routing, the admin-role exception, and benchmark fees.
- Updated auditor scope, threat model, privilege matrix, test plan, size estimates, and V18.7→V18.8 source diff.

# V18.7

Introduced the auditor-focused Beefy V7 revenue stack, immediate internal converter routes, seven-day strategy migration, Governance Staking slimming, external Mint Controller, and proposal synchronization in the Governance Boost Strategy.
