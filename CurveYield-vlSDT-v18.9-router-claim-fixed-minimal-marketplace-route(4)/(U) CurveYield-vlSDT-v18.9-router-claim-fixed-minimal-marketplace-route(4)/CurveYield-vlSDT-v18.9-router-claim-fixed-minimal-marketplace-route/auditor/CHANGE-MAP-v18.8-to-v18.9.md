# Change Map: V18.8 → V18.9

## M-01 — Yield Staking checkpoint economics

- Replaced multiplicative checkpoint decay with cumulative additive `rate-seconds` accounting.
- Decay is still lazy and transferred to Treasury only during a state-changing checkpoint interaction.
- Added a deterministic principal preview from cumulative elapsed time.
- Integrated cyGOV accrual across the same linear principal path, with a constant-cap crossing calculation.
- Added annual-versus-daily authored regression coverage and static arithmetic checks at 3 and 10 bps/day.
- Did not change mint-reserve top-ups, held-first funding, reservation use, or allocation mechanics.

## M-02 — Strategy migration rewards

- Normal strategy retirement now calls `_harvest(address(0))` and reverts on any claim, conversion, or compound failure.
- Added `retireStratEmergency()` to skip broken reward harvesting and return principal.
- Added permanent `retired` state and pause enforcement so obsolete strategies cannot later publicly harvest and restake.
- Added `emergencyUpgradeStrat()` to the vault using the same candidate validation and seven-day delay.
- Added authored tests for strict harvest, normal migration revert, emergency principal migration, permanent pause, and blocked unpause.

## Revenue Staking fees

- Treasury excess-yield fee: 40% → 33%.
- Admin excess-yield fee: 10% → 7%.
- Total excess fee: 50% → 40%.
- Admin fee remains payable only to the current Revenue Staking `admin` role and remains the sole non-Treasury protocol fee.
