# CurveYield BoostHub Live Audit Source Package v1

## Purpose

This ZIP is a **source-freeze intake package** for the current Deep Assurance v6 controller workflow and the `CurveYield/audit-controller` orchestration process. It is built around the already-deployed BoostHub suite on Ethereum and Fraxtal.

The attached frontend-v7 current-contract inventory is the canonical address scope. It explicitly excludes the hidden legacy `sdYB-old` deployment, so this package does too.

## What is included

- **24 first-party/live-relevant deployment targets** mapped by chain, address, role, source family, and source file.
- Three distinct source families:
  1. `standard-v1` — BoostHub, receipt staking, standard V7 vaults/strategies, and standard converters.
  2. `sdcrv-current-v3-v1` — current cysdCRV replacement vault/strategy plus fixed crvUSD converter.
  3. `sdyb-live-v22-source-v1` — live V17-named sdYB hybrid source bundle from the v22 source release.
- External gauges, LP tokens, reward tokens, and pools in a separate dependency manifest.
- Source provenance, hashes, current live-source observations, and controller Phase-0 import metadata.

## Important source/version distinctions

### Current sdCRV

The current vault `0xdB6A…7bA5` and strategy `0x93DF…38ADf` are newer than the older standard sdCRV vault/strategy in the historical `CurveYield/Contracts` verification snapshot. Their source is therefore taken from the cysdCRV manual-deployment **v3** release, not from the older standard files.

The attached current inventory lists `0xf4b3…351B` as Converter 2. The current strategy constructor instead selects `0x78ff…5e82` for the crvUSD route. Both are retained in the deployment manifest: the inventory-listed address is preserved, and the current constructor-selected converter is added so the audit cannot miss the live route.

### Current sdYB

The current sdYB vault/strategy are the hybrid contracts at `0x8582…cCe3` and `0x3004…B0e3`, not the older standard sdYB vault/strategy found in historical standard deployment records. The verified main-contract source bundle contains eight Solidity files. Five separate helper addresses were recovered from the live strategy constructor and are included as targets.

The five helper addresses had bytecode but were **unverified** on Ethereum Blockscout when this package was assembled. Their candidate source files are included from the verified bundle, but the package deliberately marks exact helper address-to-source binding as unproven audit work.

## Deep Assurance v6 / audit-controller use

The current v6 Phase-0 protocol expects one untouched source ZIP plus its exact extraction to be committed atomically to `CurveYield/Audits`. For this package, the source-freeze commit created by Phase 0 should become the campaign's exact `sourceRepository + sourceCommit` identity.

Do **not** use `CurveYield/Contracts@5464d13029cfbdc7d46ca28f93ee577454b89d9e` as the universal audit source commit. That commit is valid provenance for the standard source family only; the current sdCRV and sdYB deployments come from separate later source releases included here.

See:
- `controller/CONTROLLER_IMPORT-v1.json`
- `controller/CONTROLLER_IMPORT-v1.md`
- `manifests/DEPLOYMENT_MANIFEST-v1.json`
- `manifests/SOURCE_VERSION_MANIFEST-v1.json`

## Packaging constraints

- No Solidity or Vyper compilation was performed.
- No dependencies were downloaded or installed.
- No deployment or contract write was performed.
- Source filenames inside versioned source-family directories are kept canonical so imports/source identity are not altered.
- All package-level authored metadata files use explicit versioned filenames.
