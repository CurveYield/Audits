CurveYield BoostHub Frontend v11 — IPFS upload notes

Upload the contents of the IPFS-ready v11 directory as one immutable release.

Before production upload:
1. Deploy and verify the separate boosthub-yield-indexer Worker if shared historical charts are desired immediately.
2. Add the public Reown WalletConnect project ID in src-v11/runtime-config.js if WalletConnect is required.
3. Regenerate MANIFEST-v2.sha256 after any change.
4. Upload the entire directory without flattening src-v11, assets, vendor, or route folders.
5. Test the resulting CID/IPNS path on desktop and mobile.
6. Confirm an upgrade from the previous mutable IPNS/gateway deployment loads v11 runtime assets rather than an older service-worker shell.

Runtime: src-v11/app.js
Styles: styles-v11.css
Offline shell: curveyield-boosthub-shell-v11
Snapshot schema/cache key: v16
Shared history API: https://boosthub-data.curveyield.online
Chart series: StakeDAO Default Staking APR + BoostHub Vault APY
Local fallback: real IndexedDB observations only; no synthetic backfill
Recent Activity: confirmed transactions submitted through this DApp/browser only

Worker requirement: deploy boosthub-yield-indexer single-file v2 and clear the superseded Worker-v1 history rows before collecting corrected history.
