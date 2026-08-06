# Beefy V7 Revenue Vault Design

## Goal

Replace the monolithic `CurveYieldRevenueCompounder` with a thin vault derived directly from Beefy's canonical `BeefyVaultV7` flow and separate strategy, converter, and cyGOV distributor contracts.

## Global constraints

- Preserve Beefy V7 deposit, `earn`, withdrawal, `proposeStrat`, `upgradeStrat`, and `retireStrat` architecture wherever CurveYield-specific safety does not require a change.
- Do not add Beefy factory, fee-configurator, strategist-manager, swapper, oracle, or proxy-controller contracts.
- Keep CurveYield-specific behavior in the strategy whenever possible.
- Ordinary deposits must not capture rewards earned before entry.
- cyGOV is distributed separately and never included in vault PPS or converted.
- Standard exits are backed only by realized cyvlSDT.
- Initial conversion supports SDT to cyvlSDT only through `CurveYieldVlSDTLocker.deposit`.
- The strategy converter is replaceable after a timelock so USDC and market routes can be added later.

## Contracts

### `CurveYieldRevenueVaultV7`

The vault begins from Beefy's canonical `BeefyVaultV7` logic. It remains the user-facing share token and owns the delayed strategy-change process.

Necessary changes to the canonical base:

1. Standalone constructor deployment replaces Beefy's proxy initializer while retaining the same state and flow.
2. A one-time initial strategy setter resolves the standalone deployment address cycle.
3. `economicBalance()` adds the strategy's conservative unharvested-want estimate to realized balance for deposit pricing only.
4. Standard `deposit` calls `strategy.beforeDeposit()`, snapshots economic NAV, measures the actual received want amount, calls `earn`, and mints shares against the pre-deposit economic NAV.
5. `depositWithStrictHarvest` calls `strategy.beforeDepositStrict()`, prices with realized balance only, and enforces `minimumShares`.
6. `withdraw` keeps Beefy's realized-balance path and relies on the strategy to apply its configured withdrawal fee.
7. The ERC-20 `_update` hook calls one distributor checkpoint before mint, burn, or transfer. No user or keeper checkpoint transaction is required.

### `CurveYieldRevenueStrategyV7`

The strategy owns all active-position and fee behavior:

- Stakes cyvlSDT into Revenue Staking.
- Withdraws cyvlSDT for the vault.
- Claims ordinary Revenue Staking rewards.
- Sends supported ordinary rewards to the active converter.
- Restakes returned cyvlSDT.
- Maintains owner-configurable withdrawal, performance, and caller fees with a combined harvest-fee cap.
- Maintains an owner-configurable `harvestOnDeposit` toggle.
- Exposes best-effort and strict pre-deposit harvest paths.
- Exposes conservative `estimatedUnharvestedWant()` for deposit NAV.
- Supports public caller-paid harvests.
- Supports delayed converter replacement.
- Supports Beefy `retireStrat()` migration and transfers all realized want back to the vault.
- Claims cyGOV only to the distributor and never converts it.

### `CurveYieldSdtLockerConverter`

The initial converter supports only SDT input and uses `CurveYieldVlSDTLocker.deposit` to mint cyvlSDT for the requested recipient. It exposes the common converter interface so a later converter can add USDC and market routes without replacing the vault.

### `CurveYieldCyGovDistributor`

The distributor indexes cyGOV across transferable vault shares:

- `checkpoint(from,to)` is callable only by the vault and runs automatically before share balances change.
- Global indexing includes cyGOV already held by the distributor plus cyGOV pending to the active strategy in Revenue Staking.
- Claims ask the active strategy to pull cyGOV to the distributor when needed.
- Users may claim liquid cyGOV or stake it through Governance Staking.
- No shareholder iteration, user registration, or keeper checkpoint is used.

## Fee model

- Strategy withdrawal fee: defaults to 0.1%, owner configurable up to 2.5%, and deducted after satisfying the vault's net request.
- Revenue Staking immediate withdrawal fee: defaults to 0.5%, owner configurable up to 2.5%, and dynamically read by the strategy.
- Active stake and estimated ordinary rewards are valued net of the current Revenue Staking withdrawal fee.
- The strategy gross-ups Revenue Staking withdrawals so the external fee does not cause an additional shortfall beyond the strategy withdrawal fee.
- Performance fee: defaults to 3.9% and remains owner configurable.
- Caller fee: defaults to 0.1%, remains owner configurable, and is paid to the harvest caller.
- Performance plus caller fee cannot exceed 10% of harvested cyvlSDT.
- Fee updates are direct owner configuration, matching the requested Beefy-style model.

## Converter replacement

The strategy has one active converter and a pending converter. The owner proposes a replacement; execution is permissionless after 10 days. The strategy verifies the replacement returns the same cyvlSDT output token. The initial converter handles only SDT; unsupported rewards remain unconverted and contribute zero to economic NAV until a compatible converter is installed.

## Strategy migration

The vault keeps Beefy's candidate strategy and approval delay. On upgrade:

1. Old strategy claims cyGOV to the distributor.
2. Old strategy withdraws all cyvlSDT from Revenue Staking and transfers it to the vault.
3. Vault switches to the candidate strategy.
4. Vault calls `earn()` to deposit the returned cyvlSDT into the new strategy.

The candidate must report the same vault and want token.
