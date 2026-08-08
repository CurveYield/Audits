# CurveYield cysdCRV Manual Deployment and Write Calls v3

## Scope

This package deploys a replacement cysdCRV vault suite on Ethereum mainnet while reusing the existing BoostHub staking contract and the existing working CRV converter.

Deploy in this exact order:

1. Fixed crvUSD reward converter
2. New vault
3. New strategy
4. Initialize the vault with the strategy

No write call is required on the existing BoostHub or existing cysdCRV staking contract.

## Fixed live addresses

- sdCRV / strategy want token: `0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5`
- Existing cysdCRV BoostHub staking contract: `0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C`
- Existing BoostHub: `0xFbEF8941Da53EA724385B44E91ae9672061D0263`
- CurveYield treasury: `0x47623C62f281807D615eeb4A2CEee9d97F9D3C49`
- CRV: `0xD533a949740bb3306d119CC777fa900bA034cd52`
- crvUSD: `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E`
- Existing working CRV-to-sdCRV converter: `0x3C618Deb7659695C378170A032A1B8e61e17644E`
- Existing deployment owner used by the current suite: `0x11b78837cadC8E894F1c6e13fA9f3A085a75FA35`

The broken converter `0xf4b32155BeA17b075AEf88540e14F9835e16351B` must not be used.

---

# Step 1 — Deploy the fixed converter

Deploy contract:

`CysdCrvCrvUsdRewardConverterV1`

Flattened file:

`contracts/CysdCrvCrvUsdRewardConverterV1-flattened-v3.sol`

Constructor inputs:

**None.**

After deployment, record the result as:

`NEW_CONVERTER_ADDRESS`

The converter has the following fixed route internally:

- crvUSD → TriCRV → CRV → CRV/sdCRV → sdCRV
- First swap parameters: `[0, 2, 3]`
- Second swap parameters: `[0, 1, 1]`

No post-deployment write call is required on the converter.

---

# Step 2 — Deploy the new vault

Deploy contract:

`CurveYieldVaultV7`

Flattened file:

`contracts/CurveYieldVaultV7-cysdCRV-flattened-v3.sol`

Constructor inputs, in order:

1. `name_`
   - Type: `string`
   - Input: `CurveYield StakeDAO CRV Vault V3`

2. `symbol_`
   - Type: `string`
   - Input: `cysdCRV-V3`

3. `owner_`
   - Type: `address`
   - Input: `0x11b78837cadC8E894F1c6e13fA9f3A085a75FA35`

4. `decimals_`
   - Type: `uint8`
   - Input: `18`

After deployment, record the result as:

`NEW_VAULT_ADDRESS`

Important: the address entered as `owner_` must make the required vault initialization call in Step 4.

---

# Step 3 — Deploy the new strategy

Deploy contract:

`CurveYieldStakingStrategy`

Flattened file:

`contracts/CurveYieldStakingStrategy-cysdCRV-flattened-v3.sol`

Constructor inputs, in order:

1. `want_`
   - Type: `address`
   - Input: `0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5`

2. `vault_`
   - Type: `address`
   - Input: `NEW_VAULT_ADDRESS`

3. `staking_`
   - Type: `address`
   - Input: `0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C`

4. `treasury_`
   - Type: `address`
   - Input: `0x47623C62f281807D615eeb4A2CEee9d97F9D3C49`

5. `owner_`
   - Type: `address`
   - Input: `0x11b78837cadC8E894F1c6e13fA9f3A085a75FA35`

6. `initialRouteTokens`
   - Type: `address[]`
   - Input:

```text
[
  0xD533a949740bb3306d119CC777fa900bA034cd52,
  0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E
]
```

7. `initialRouteConverters`
   - Type: `address[]`
   - Input:

```text
[
  0x3C618Deb7659695C378170A032A1B8e61e17644E,
  NEW_CONVERTER_ADDRESS
]
```

8. `initialRouteMinAmounts`
   - Type: `uint256[]`
   - Input:

```text
[
  1,
  1
]
```

After deployment, record the result as:

`NEW_STRATEGY_ADDRESS`

The reward-token, converter, and minimum-amount arrays must remain in the same order:

- index 0: CRV → existing CRV converter → minimum 1
- index 1: crvUSD → new fixed converter → minimum 1

No `addRewardRoute` write call is needed because both routes are installed by the strategy constructor.

---

# Step 4 — Required post-deployment write call

Call the following function on `NEW_VAULT_ADDRESS` from the vault owner address:

`setInitialVaultConfig`

Inputs, in order:

1. `strategy_`
   - Type: `address`
   - Input: `NEW_STRATEGY_ADDRESS`

2. `withdrawFeeBps_`
   - Type: `uint16`
   - Input: `0`

3. `receiver`
   - Type: `address`
   - Input: `0xFbEF8941Da53EA724385B44E91ae9672061D0263`

4. `boostHubPid`
   - Type: `uint256`
   - Input: `0`

Plain one-line representation:

```text
setInitialVaultConfig(
  NEW_STRATEGY_ADDRESS,
  0,
  0xFbEF8941Da53EA724385B44E91ae9672061D0263,
  0
)
```

This is the only required post-deployment configuration write call.

Do not separately call `setStrategy` or `setWithdrawFeeConfig` after this. `setInitialVaultConfig` performs both actions in one transaction, and the strategy can only be installed once.

---

# Optional ownership handoff

Skip this section if `0x11b78837cadC8E894F1c6e13fA9f3A085a75FA35` will remain the owner.

Only perform ownership handoff after Step 4 and after all read checks pass.

## Vault ownership handoff

From the current vault owner, call on `NEW_VAULT_ADDRESS`:

```text
transferOwnership(FINAL_OWNER_ADDRESS)
```

Then, from `FINAL_OWNER_ADDRESS`, call on `NEW_VAULT_ADDRESS`:

```text
acceptOwnership()
```

## Strategy ownership handoff

From the current strategy owner, call on `NEW_STRATEGY_ADDRESS`:

```text
transferOwnership(FINAL_OWNER_ADDRESS)
```

Then, from `FINAL_OWNER_ADDRESS`, call on `NEW_STRATEGY_ADDRESS`:

```text
acceptOwnership()
```

For the first ownership-transfer initialization on each fresh contract, `acceptOwnership()` is not subject to the later ten-day repeat-transfer delay. Always confirm `pendingOwner()` before accepting.

The converter has no owner and requires no ownership handoff.

---

# Read-only checks before depositing funds

## Fixed converter reads

On `NEW_CONVERTER_ADDRESS`:

- `tokenIn()` must return `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E`
- `tokenOut()` must return `0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5`
- `router()` must return `0x99a58482BD75cbab83b27EC03CA68fF489b5788f`
- `swapParams()` first row must be `[0, 2, 3]`
- `swapParams()` second row must be `[0, 1, 1]`

## Vault reads

On `NEW_VAULT_ADDRESS`:

- `strategy()` must return `NEW_STRATEGY_ADDRESS`
- `want()` must return `0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5`
- `withdrawFeeBps()` must return `0`
- `withdrawFeeReceiver()` must return `0xFbEF8941Da53EA724385B44E91ae9672061D0263`
- `withdrawFeeBoostHubPid()` must return `0`
- `decimals()` must return `18`

## Strategy reads

On `NEW_STRATEGY_ADDRESS`:

- `want()` must return `0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5`
- `vault()` must return `NEW_VAULT_ADDRESS`
- `staking()` must return `0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C`
- `treasury()` must return `0x47623C62f281807D615eeb4A2CEee9d97F9D3C49`
- `maxSlippageBps()` must return `25`
- `rewardRoutesLength()` must return `2`

Call `rewardRoute(0xD533a949740bb3306d119CC777fa900bA034cd52)` and confirm:

- token = CRV
- converter = `0x3C618Deb7659695C378170A032A1B8e61e17644E`
- minimum amount = `1`
- enabled = `true`

Call `rewardRoute(0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E)` and confirm:

- token = crvUSD
- converter = `NEW_CONVERTER_ADDRESS`
- minimum amount = `1`
- enabled = `true`

## Safe first functional check

Before migrating meaningful funds:

1. Deposit a small amount of sdCRV into the new vault.
2. Confirm the vault shares are minted.
3. Confirm `balanceOfPool()` on the strategy increases.
4. Simulate `harvest()` on the strategy.
5. Only execute harvest after the simulation succeeds.
6. Confirm `getPricePerFullShare()` does not decrease from reward compounding, excluding rounding effects from extremely small test amounts.
