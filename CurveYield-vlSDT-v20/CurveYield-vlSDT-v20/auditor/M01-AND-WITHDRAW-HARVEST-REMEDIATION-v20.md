# M-01 Reservation + Withdrawal Harvest Remediation v20

## Scope

This patch is intentionally narrow:

1. Recover protected quota-controlled mint reservations only after their recorded minter has been removed.
2. Attempt ordinary reward harvest before vault withdrawal pricing without allowing harvest failure to block withdrawal.

## Pre-fix reproduction / source evidence

### Stranded minter reservation

The original token had two simultaneous conditions:

- `cancelMintReservation` rejected owner/governance cancellation whenever `protectedMintReservation[id]` was true and the caller was not the reservation minter.
- `_consumeReservation` rejected a quota-controlled reservation when `isMinter[reservation.minter]` was false.

Therefore, once governance removed the minter, a protected reservation could remain open and continue consuming both `totalReservedMint` and `reservedByMinter`, while governance could not cancel it and the removed minter could not consume it.

### Withdrawal reward capture

The original vault `withdraw()` calculated assets from realized `balance()` and did not call any harvest hook first. Ordinary pending rewards were therefore not necessarily realized for the withdrawing holder. A final holder could exit while pending ordinary rewards remained associated with the strategy; a later sole depositor could then benefit when those rewards were subsequently harvested.

## Implemented reservation fix

`cancelRemovedMinterReservation(uint256 id)` is `onlyOwner` and requires all of the following:

- reservation is open;
- reservation is quota-controlled;
- reservation is protected;
- recorded minter is no longer authorized.

It calls `_cancelReservationInternal(id)` so the same accounting routine zeroes the reservation, closes it, clears protection, decrements `totalReservedMint`, decrements `reservedByMinter`, and emits the existing cancellation event.

The normal owner path remains unable to cancel a protected reservation while its minter is active.

## Implemented withdrawal fix

`CurveYieldRevenueVaultV7.withdraw()` now calls `strategy.beforeWithdraw()` before pricing the withdrawal.

`CurveYieldRevenueStrategyV7.beforeWithdraw()`:

- returns without harvesting if the strategy is paused;
- otherwise externally self-calls `harvestBeforeWithdraw()`;
- catches every harvest/conversion failure and returns normally.

A successful attempt realizes ordinary reward output before `balance()` is used for withdrawal pricing. A failed attempt never blocks the withdrawal.

## Residual behavior intentionally retained

If the pre-withdraw harvest fails on the final withdrawal, the user requirement to keep withdrawal live means unharvested rewards may remain after total supply reaches zero. The patch does not confiscate those rewards, block the withdrawal, or add a broader empty-vault policy. The normal successful-harvest path removes the reported capture condition; the failed-harvest case remains availability-first by explicit requirement.

## Tests added

### Governance reservation regression

`test/v20/CyGovYieldStakingV20.test.js` now checks:

- exact protected reservation accounting before removal;
- governance recovery rejects while minter is active;
- legacy owner cancellation remains blocked by protection;
- removed minter cannot consume;
- non-owner cannot use recovery;
- owner recovery releases exact global/per-minter reservation accounting;
- reservation closes and protection clears;
- repeat recovery reverts;
- closed reservation cannot be consumed or replaced after reauthorization.

### Vault regression

`test/v20/RevenueVaultV20.test.js` now checks:

- pending ordinary rewards are harvested before withdrawal pricing and paid into the exiting holder's realized vault value;
- forced reward-claim failure is swallowed and withdrawal still completes with realized principal while the reward remains pending.

## Verification performed

Dynamic Hardhat tests were not executed because this source handoff intentionally omits compiler artifacts and the task prohibited Solidity compilation and dependency downloads.

Executed without compilation or dependency installation:

- JavaScript syntax checks for both edited regression files and both edited static-check scripts.
- `node scripts/check-governance-mint-controls-v20.js` — PASS.
- `node scripts/check-beefy-revenue-vault-v20.js` — PASS.
- `npm run check:static:v20` — PASS across the complete existing static bundle, including source layout, Solidity structural scan, JS syntax, mint math/controls, vault checks, governance staking checks, cyGOV yield staking checks, benchmark fee checks, and minimal marketplace route checks.

The newly added executable regressions therefore remain pending a permitted compile/test environment.
