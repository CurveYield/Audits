# CurveYield BoostHub Corrective Audit v7

## Scope

This revision corrects two user-visible defects and one deployment/runtime defect:

1. The sdCRV vault widget must read from, approve, deposit into, and withdraw from `0xdB6AA572243b9617C4b39FB20468843b2CB97bA5`.
2. Home must render genuine independent **Staking Rewards** and **Vault Rewards** columns, with staking reward tokens stacked vertically.
3. A previously installed offline shell must not serve stale transaction JavaScript after an IPNS/gateway update.

## Root cause

The source configuration in v6 contained the replacement vault, but the offline service worker served scripts and styles cache-first. A browser under the same IPNS/gateway scope could therefore load stale transaction modules. The v6 layout also nested two pseudo-columns inside one combined reward cell rather than providing two real table columns. During the v7 audit, the snapshot schema was found at version 12 while its localStorage key still used `v11`.

## Corrections

- Runtime modules moved to the versioned `src-v7/` URL and the stylesheet to `styles-v7.css`.
- Service-worker script/style handling is network-first with `cache: "no-store"`; old CurveYield shell caches are removed during activation.
- Vault address resolution is centralized in `src-v7/contract-targets.js` and used by live reads, allowance reads, approvals, deposits, withdrawals, PPS, APY, balances, strategy lookup, links, and Admin displays.
- The snapshot version and localStorage cache key both use version 12.
- Home has six actual table columns: Vault, Default APR, BoostHub APY, Boost Multiplier, Staking Rewards, and Vault Rewards.
- Staking reward tokens stack vertically inside the staking column at desktop and mobile widths.

## Transaction proof

The browser regression suite verifies:

- `balanceOf` and `getPricePerFullShare` reads target the replacement vault.
- The sdCRV allowance query encodes the replacement vault as spender.
- The unlimited approval calldata encodes the replacement vault as spender.
- The signed deposit transaction target is the replacement vault.
- The signed withdrawal transaction target is the replacement vault.

No smart contract code was modified.
