# BoostHub White Redesign v9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution. Steps use checkbox syntax for tracking.

**Goal:** Redesign the existing BoostHub v8 static/IPFS DApp into the approved white/gold CurveYield interface without changing production contract targets, while adding truthful historical yield and recent-activity widgets.

**Architecture:** Preserve the v8 Web3/runtime architecture and contract registry. Replace only presentation structure/styles plus local-only analytics persistence. Historical charts use real observations collected from live reads; no synthetic APR/APY points are permitted. Recent activity records confirmed transactions submitted through the DApp for the connected account.

**Tech Stack:** Static HTML/CSS/ES modules, ethers v6 UMD, IndexedDB, existing deterministic Playwright harness.

## Global Constraints

- Release version is v9; do not overwrite v8 artifacts.
- Keep all active contract addresses and transaction targets unchanged from v8.
- Preserve sdCRV vault `0xdB6AA572243b9617C4b39FB20468843b2CB97bA5` and strategy `0x93DFEfeFd5D3736381086eFa5A8810F278138ADf`.
- Homepage aggregate cards may not use TVL or active-locker count.
- Homepage aggregate cards: Delegated vlSDT, Highest Staking APR, Highest Vault APY, Live Reward Streams.
- Locker top metrics remain the existing v8 metrics: Default APR, BoostHub APY, Boost Multiplier, Yield Boosting Tokens.
- Homepage staking and vault rewards remain two actual columns; staking tokens stack vertically.
- Locker contract cards are three equal desktop columns and equal-width stacked cards on mobile.
- Historical chart must never fabricate data; insufficient history displays an explicit real-data empty state.
- Recent activity contains only confirmed DApp transactions persisted locally for the current account.
- Runtime JS/CSS and service-worker cache advance to v9; snapshot schema/key advance together.
- No smart-contract changes and no deployment.

---

### Task 1: Release shell and regression gates
- [ ] Add failing v9 source-regression tests for versioned runtime paths, white layout structure, aggregate-stat labels, and unchanged contract targets.
- [ ] Run the tests and verify RED.
- [ ] Rename runtime/styles/tests to v9 and advance package/app/footer/service-worker versions.
- [ ] Run source tests to GREEN.

### Task 2: White/gold responsive redesign
- [ ] Replace desktop topbar-only shell with persistent white sidebar plus compact main header; preserve hamburger mobile navigation.
- [ ] Use the supplied white CurveYield logo asset.
- [ ] Redesign Home locker cards and four meaningful aggregate cards.
- [ ] Redesign locker title, metric cards, action modules, rewards, and contract information to match the approved white mock.
- [ ] Preserve two reward columns on Home with vertical staking reward stacks.
- [ ] Add responsive rules for 320px through large desktop and 200% text.

### Task 3: Real yield history and recent activity
- [ ] Add IndexedDB-backed `history-store.js` for hourly real live-yield observations.
- [ ] Add pure chart normalization/downsampling tests and verify RED/GREEN.
- [ ] Record successful live reads and render an SVG history chart only from recorded observations.
- [ ] Add range controls 7D/30D/90D/1Y/All; insufficient points show an honest empty state.
- [ ] Add IndexedDB-backed `activity-store.js` scoped by chain/account/locker.
- [ ] Record confirmed deposit/withdraw/claim transactions and render Recent Activity without invented events.

### Task 4: Cache/service-worker and runtime integrity
- [ ] Advance snapshot version/key together.
- [ ] Cache v9 runtime/history/activity modules and white-logo asset.
- [ ] Keep scripts/styles network-first and old shell caches deleted during activation.
- [ ] Verify service-worker registration uses v9 and `updateViaCache: "none"`.

### Task 5: Full QA and packaging
- [ ] Run syntax/unit suites.
- [ ] Run the complete legacy browser regression against v9.
- [ ] Run dedicated white-layout/history/activity/contract-target browser tests.
- [ ] Capture Home and sdCRV screenshots at desktop/mobile without generating new mock images.
- [ ] Verify responsive overflow and 200% text.
- [ ] Generate source/IPFS SHA-256 manifests, smoke-test routes, and ZIP both exact tested trees.
