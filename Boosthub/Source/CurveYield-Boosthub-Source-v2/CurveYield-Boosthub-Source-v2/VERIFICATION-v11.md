# CurveYield BoostHub Frontend Verification v11

## v2 package verification

The v2 packaging pass is a scope-trim and integrity pass over the supplied frontend v11 source tree. Prior aggregate v11 test counts are not carried forward as v2 evidence because the scoped source and regression fixtures changed. The final archive is instead checked for zero removed-route references, complete checksum-manifest coverage, and reproducible archive SHA-256.

## Yield repair proof

v11 corrects the user-return denominator used by displayed BoostHub yield:

- retained Yield Boosting Tokens are staked in the external gauge and now increase return per accounted user principal;
- sdCRV and sdFXN apply the normal StakeDAO min/max vote-boost interpolation and then the retained-stake factor;
- sdFXS uses the current StakeDAO default/minimum APR as its base and applies the retained-stake factor without calling unsupported XChain `working_balances()`;

The deterministic sdFXS regression fixture proves a **1.93x** retained-stake multiplier, **9.01%** StakeDAO default APR, and **18.99%** resulting fixture vault APY. Those fixture values prove behavior; they are not a claim about the live value at packaging time.

## Admin pending-reward repair

Direct BoostHub pool pending rewards now read each external StakeDAO gauge's `claimable_reward(BoostHub, token)` values. This is the pre-harvest reward path that BoostHub's `harvest()` consumes. The StakeDAO gauge ABI explicitly includes `claimable_reward(address,address)`, and a regression test prevents that method from silently disappearing again.

StakeDAO **vote incentives and airdrops** remain a separate reward mechanism. v11 dynamically reads the live BoostHub `stakeDaoClaimExecutor()` address and, when that configured executor supports the finalized pending-claim views, reads its `pendingTokens(pid)` and `getClaim(token)` state as a separate Admin bucket. No executor address or incentive amount is invented or hard-coded. If no compatible executor is configured, that bucket stays unavailable rather than being reported as zero.

Admin filters blank or unknown `TOKEN` placeholder rows. The direct gauge and vote-incentive USD values are kept separately and only summed for the Admin total when both are actually discoverable.

## Shared historical-yield evidence

The shared-history browser test injects a faithful Worker API response and proves that:

- remote D1 history replaces the local fallback when at least two observations are available;
- chart labels are exactly **BoostHub Vault APY** and **StakeDAO Default APR**;
- both independent line-series paths render;
- local IndexedDB remains a fail-soft real-observation fallback.

Worker v2 is required for corrected new history. Historical rows written by Worker v1 used the superseded vault-yield formula and must be cleared before v2 begins collecting.

Worker v2 also renames the ambiguous health field `points` to `observations` and exposes the latest APR and APY values explicitly. Thus a value such as `observations: 20` means twenty stored snapshots, not twenty basis points.

## sdCRV transaction proof

The deterministic EIP-1193 suite verifies actual prepared transaction data, not only rendered labels:

- vault balance/PPS reads target `0xdB6AA572243b9617C4b39FB20468843b2CB97bA5`;
- allowance reads encode that vault as spender;
- unlimited approval calldata encodes that vault as spender;
- deposit transaction `to` is that vault;
- withdrawal transaction `to` is that vault.

No mainnet transaction is broadcast by the test suite.

## UI repair proof

- Contract Information is the final locker row.
- The unsolicited sdFXS XChain explanatory sentence is removed and no replacement filler copy is added.
- crvUSD uses Curve's current Ethereum token icon from `curvefi/curve-assets` as the primary source, with a clean bundled image retained as offline/network-failure fallback.
- Delegated vlSDT uses the StakeDAO elephant mark.
- The other Home aggregate metrics use dedicated contained SVG metric icons rather than generic text/glyph placeholders.
- Home aggregate icons remain fully inside their cards at desktop and responsive widths.
- Snapshot schema and local cache key are **v16**, invalidating stale v10 yield snapshots.

## Evidence classification

### Deterministic / mock browser

UI rendering, responsive behavior, wallet state, Admin diagnostics, transaction target/calldata, shared-history response handling, and deterministic yield fixtures.

### Contract-interface integration

Production addresses/ABI paths, Admin direct-gauge pending-reward path, configured-executor discovery path, and unsupported XChain capability negative tests.

### Live external data

The user separately confirmed the deployed Worker v1 `/health` endpoint was live and collecting twenty observations per locker. Worker v2 and BoostHub v11 still require deployment and post-deployment verification of their corrected live values. Deterministic fixtures are not described as live production evidence.
