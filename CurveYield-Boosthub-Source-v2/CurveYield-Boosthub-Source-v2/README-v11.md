# CurveYield BoostHub Source Package v2

Static, IPFS-compatible CurveYield BoostHub frontend using the approved white/gold CurveYield design and shared Cloudflare historical-yield indexing.

This v2 audit-source package is derived from the supplied frontend v11 tree and is scoped to the active sdCRV, sdFXN, and sdFXS BoostHub surfaces only. Runtime module version labels remain v11 where they describe the underlying application release.

## v11 historical yield integration

Each active locker chart has exactly two series:

1. **StakeDAO Default Staking APR** — the current StakeDAO default/minimum APR. This also defines the sdFXS/XChain first series.
2. **BoostHub Vault APY** — the actual BoostHub vault APY path used by the frontend.

Primary history source:

`https://boosthub-data.curveyield.online`

The DApp requests shared D1 history for 7D, 30D, 90D, 1Y, and All ranges. When the shared indexer is unavailable or has fewer than two real points, v11 falls back to the existing local IndexedDB real-observation history. Synthetic backfill remains disabled.

## Existing white redesign retained

- White CurveYield visual system with desktop sidebar, mobile drawer, gold actions, light panels, and responsive layouts.
- Home aggregate metrics remain Delegated vlSDT, Highest Boosted Staking APR, Highest Vault APY, and Live Reward Streams.
- Home locker cards retain independent Staking Rewards and Vault Rewards columns.
- Locker top metrics remain Default APR, BoostHub APY, Boost Multiplier, and Yield Boosting Tokens.
- Staking and Compounding Vault actions, three equal contract cards, Your Position, Historical Yield, and Recent Activity remain intact.

## Contract interaction correctness preserved

v11 does not rewrite wallet transaction paths. The history integration is read-only analytics. v11 also repairs displayed yield/accounting reads without changing wallet transaction destinations or calldata semantics.

- sdCRV vault reads, approval spender, deposit target, and withdrawal target remain `0xdB6AA572243b9617C4b39FB20468843b2CB97bA5`.
- sdCRV strategy remains `0x93DFEfeFd5D3736381086eFa5A8810F278138ADf`.
- sdFXS never calls unavailable XChain `working_balances()`.
- sdFXS Default APR uses the StakeDAO minimum/default APR and the displayed BoostHub yield applies the retained Yield Boosting Token factor without using lagging strategy/receipt APR as the primary current-yield source.
- No smart contracts are modified by v11.

## v11 production repairs

- Effective BoostHub yield now accounts for retained Yield Boosting Tokens by comparing the external gauge position with BoostHub accounted user principal.
- sdFXS follows the same user-return model while preserving its XChain capability difference; no unsupported working-balance call or unsolicited explanatory filler is shown.
- Admin direct pool rewards read external gauge claimables. A separately configured StakeDAO claim executor, when compatible, is surfaced as a distinct vote-incentive/airdrop bucket.
- Unknown/empty TOKEN placeholders are not rendered in Admin.
- Contract Information is the final row on locker pages.
- crvUSD and Home aggregate metric icon assets were corrected/refined.

## Runtime / release safety

- Runtime modules: `src-v11/`
- Styles: `styles-v11.css`
- Service-worker shell: `curveyield-boosthub-shell-v11`
- Service-worker registration: `updateViaCache: "none"`
- Snapshot schema and local cache key: v16
- Mutable runtime JS/CSS remain network-first.

## Run locally

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/`.

## Test

```bash
npm test
npm run test:browser
```

See `VERIFICATION-v11.md` for evidence classification and limitations.

## WalletConnect

Set the public Reown project ID in `src-v11/runtime-config.js`; see `WALLETCONNECT_SETUP-v11.md`.
