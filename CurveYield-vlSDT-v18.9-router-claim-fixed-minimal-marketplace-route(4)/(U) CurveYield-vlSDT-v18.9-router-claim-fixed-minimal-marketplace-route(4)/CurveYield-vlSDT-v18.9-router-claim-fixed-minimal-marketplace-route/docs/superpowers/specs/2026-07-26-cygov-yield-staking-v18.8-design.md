# cyGOV Yield Staking V18.8 Design

## Purpose

Add a dedicated contract where users stake cyvlSDT and receive only cyGOV. The contract targets a configured cyGOV-per-cyvlSDT daily yield, but total daily rewards cannot exceed a configured `maxMintRate` backed by thirty days of free cyGOV inventory and protected mint capacity.

## Token allocations

| Minter | Initial cap | Maximum ongoing allocation |
|---|---:|---:|
| Revenue Staking | 5B cyGOV | 8% |
| vlBoost Staking | 10B cyGOV | 12% |
| cyGOV Yield Staking | 15B cyGOV | 30% |
| Governance Staking Mint Controller | 20B cyGOV | 30% |

All allocations retain the Governance Token's post-setup adjustable floor of 30% of the original component.

## Reward rate

`targetYield` uses 1e18 precision and means cyGOV paid per 1e18 cyvlSDT per day. The desired daily reward is:

`targetYield * totalEffectiveCyvlSdtStake / 1e18`.

Actual daily rewards are the lower of desired rewards and `effectiveMaxMintRate`.

## maxMintRate backing

Applying `maxMintRate` atomically reserves:

`max(0, maxMintRate * 30 - freeHeldCyGov)`.

Free held cyGOV excludes already accrued user liabilities. The protected reservation counts against `reservedByMinter`, so Governance Token allocation reductions cannot reduce the minter below the active backing commitment.

Rewards become fully funded liabilities at global checkpoint time. Funding uses free held cyGOV first and mints from the protected reservation only for the shortfall. Interactions attempt to replenish consumed reservation from newly unlocked and unused minter capacity. The effective rate is always the lower of configured `maxMintRate` and currently remaining free held inventory plus locked reserve divided by thirty.

Lowering `maxMintRate` releases excess reservation only when the delayed configuration executes. Increasing it requires the additional reservation to fit atomically.

## Initial inventory minting

The owner may mint any still-unused part of the original 15B Yield Staking initial allocation directly into the contract. All prior mints by the contract consume this original allowance first for accounting purposes. Ongoing allocation cannot be minted into idle storage; it is consumed only through funded reward liabilities.

## Principal and decay

Stakes are represented by non-transferable internal shares. A global principal index applies lazy linear decay on ordinary state-changing interactions.

`dailyDecayRate` ranges from 0 to 10. One unit is 0.01% per completed 24-hour period. The deduction is linear:

`accountedPrincipal * completedDays * dailyDecayRate / 10_000`.

The deduction is capped at remaining accounted principal and transferred to Treasury. Partial days remain uncharged until a full day completes. No keeper or daily transaction is required.

## Withdrawals and fees

The withdrawal fee is configurable from 0% to 4%, starts at 2%, and is transferred to Treasury. All protocol fees in the suite use Treasury. Revenue Strategy's withdrawal and performance fees use Treasury; caller incentives still go to the harvest caller.

Revenue Staking yield above its supplied benchmark is split 40% Treasury fee and 10% admin fee, for 50% total excess fees. The 40% Treasury amount is transferred to Treasury; the 10% admin amount is transferred only to the current Revenue Staking `admin` role address and is the sole non-Treasury fee in the suite. Queued-stake benchmark value continues to be directed to Treasury separately.

## Configuration timing

`targetYield`, `maxMintRate`, withdrawal fee, and daily decay rate apply immediately during the first seven days after deployment. Thereafter each change is queued for fourteen days. Pending changes may be cancelled by the owner.

## Safety invariants

- Accrued rewards are never counted as free backing.
- Reward liabilities are funded before being credited.
- Held cyGOV funds rewards before mint reservations are consumed.
- Allocation reductions cannot undercollateralize protected reservations.
- Actual daily rewards never exceed target-demand, configured max rate, or remaining backed resources.
- Decay never underflows user principal.
- No user iteration is required for reward or decay accounting.
- All protocol fees are paid to Treasury except Revenue Staking's 10% excess-yield admin fee, which follows the current `admin` role address.
