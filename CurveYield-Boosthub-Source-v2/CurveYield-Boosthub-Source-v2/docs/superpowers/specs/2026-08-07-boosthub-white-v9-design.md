# BoostHub White v9 Design Specification

## Goal

Redesign the existing CurveYield BoostHub static/IPFS DApp into a bright white/gold CurveYield interface that feels familiar to StakeDAO users while preserving every working contract integration and transaction target.

## Visual system

- White page background and panels, soft neutral dividers, restrained shadows, dark navy/charcoal type, and gold primary accents derived from the supplied CurveYield white-background logo.
- Desktop uses a persistent left sidebar; mobile uses a compact topbar/drawer.
- Existing token artwork remains the locker identity system.
- Do not introduce decorative data, fake statistics, or fabricated historical charts.

## Home

Top aggregate cards show live-derived protocol information:
1. Delegated vlSDT
2. Highest Boosted Staking APR
3. Highest Vault APY
4. Live Reward Streams

Do not use aggregate TVL or active-locker count as headline statistics.

Each locker card shows identity, Default APR, BoostHub APY, Boost, a Staking Rewards column, a Vault Rewards column, and View Locker. Reward tokens stack vertically inside Staking Rewards. Staking and Vault Rewards remain separate columns even on narrow mobile layouts when readable.

## Locker pages

Keep the existing production metric semantics in the top row:
- Default APR
- BoostHub APY
- Boost Multiplier
- Yield Boosting Tokens

Below: Staking action, Compounding Vault action, separate reward panels, three equal contract-information cards, Your Position, Historical Yield, and Recent Activity.

Desktop contract cards are equal-width side by side; mobile stacks all three at equal width.

## Historical Yield

Historical Yield must represent real observations only. Record fresh Default APR and BoostHub APY values from deployed runtime reads into IndexedDB. Never interpolate/backfill invented history. Render an honest insufficient-history state until at least two real points exist. Provide 7D/30D/90D/1Y/All filtering over stored real observations.

## Recent Activity

Show only confirmed Deposit, Withdraw, and Claim transactions submitted through this DApp in the same browser. Scope history by account, chain, locker, and transaction hash. Do not fabricate or infer transactions not observed by the DApp.

## Contract invariants

No smart-contract changes. In particular sdCRV must remain bound to vault `0xdB6AA572243b9617C4b39FB20468843b2CB97bA5` and strategy `0x93DFEfeFd5D3736381086eFa5A8810F278138ADf` across reads, allowance spender, approval calldata, deposits, withdrawals, contract links, and diagnostics.

## Release / cache safety

Use versioned v9 runtime URLs, network-first JavaScript/CSS, a v9 service-worker shell, `updateViaCache: "none"`, and a synchronized v14 snapshot schema/key. An old mutable-IPNS service worker must not be able to pair a new page with stale transaction code.

## Acceptance

The release is blocked on syntax/unit/integration tests, full rendered browser QA, all required responsive widths including 320px at 200% text, explicit sdCRV transaction-target proof, sdFXS XChain regression proof, manifest verification, static-route smoke tests, and ZIP integrity.
