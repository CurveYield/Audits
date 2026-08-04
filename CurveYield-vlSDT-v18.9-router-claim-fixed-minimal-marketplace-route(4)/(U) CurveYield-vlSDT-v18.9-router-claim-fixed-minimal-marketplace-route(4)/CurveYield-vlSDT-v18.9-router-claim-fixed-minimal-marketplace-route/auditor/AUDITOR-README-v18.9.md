# Auditor README V18.9

This is an uncompiled source handoff resolving the two reported V18.8 findings. Begin with `CHANGE-MAP-v18.8-to-v18.9.md` and `SOURCE-DIFF-v18.8-to-v18.9.patch`.

## M-01 resolution: checkpoint-independent decay

`CurveYieldCyGovYieldStaking` no longer multiplies each checkpoint's remaining principal by a fresh daily factor. It tracks cumulative `rate-seconds` and derives the principal index from the epoch's original index:

`principalIndex = INDEX_PRECISION * (DECAY_DENOMINATOR - cumulativeDecayUnits) / DECAY_DENOMINATOR`.

This makes principal decay additive and independent of checkpoint frequency. At 10 bps/day, 1,000 cyvlSDT becomes 635 cyvlSDT after 365 days whether checkpointed daily or once annually. Reward accrual is integrated over the same linear principal path, including a cap-crossing branch, so decay-driven emissions do not depend on checkpoint cadence.

**Unchanged:** held-first reward funding, mint reservations, protected 30-day backing, reserve consumption, and `_topUpMintReserve()` ordering.

## M-02 resolution: strategy migration

Normal `upgradeStrat()` now calls `retireStrat()`, which must complete `_harvest(address(0))`, compound ordinary rewards, forward cyGOV, withdraw principal, and return WANT to the vault. Any harvest/conversion failure reverts the migration.

`emergencyUpgradeStrat()` uses the same proposed candidate and seven-day delay but calls `retireStratEmergency()`. The emergency path skips reward claims, permanently marks and pauses the old strategy, withdraws principal, and returns WANT. Public harvest and unpause remain disabled on the retired strategy, preventing obsolete-strategy restaking.

## Final benchmark fee split

Yield above the notifier benchmark is split 33% to Treasury and 7% to the live Revenue Staking `admin` role. The remaining 60% of excess stays in the staker reward flow. The 7% admin fee remains the sole protocol-fee exception to Treasury routing.

## Mandatory auditor gates

- Compile all active contracts with Solidity 0.8.28 and the package optimizer settings.
- Run all Hardhat tests, including the new daily-versus-annual cadence and migration-failure tests.
- Measure exact creation/runtime bytecode.
- Fuzz rate changes, cap crossings, epoch extinction, migration reverts, and emergency migration.
- Confirm no active deployable imports from `archive-do-not-run/`.
