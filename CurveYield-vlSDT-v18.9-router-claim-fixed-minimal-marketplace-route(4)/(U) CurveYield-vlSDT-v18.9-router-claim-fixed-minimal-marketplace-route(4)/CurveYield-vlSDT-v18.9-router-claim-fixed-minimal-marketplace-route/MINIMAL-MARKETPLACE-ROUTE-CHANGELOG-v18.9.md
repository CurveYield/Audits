# V18.9 Minimal Marketplace Forwarding and USDC Route Changes

This package starts from the exact recovered Router-claim-fixed V18.9 source and makes only the following functional additions:

1. `CurveYieldVlSDTLocker.forwardMarketplaceRevenue(address)` is permissionless and forwards the Locker's entire balance of the selected payment token directly to Revenue Staking through the existing `_forwardRevenue` helper.
2. `CurveYieldUsdcToSdtConverter` converts USDC to wrapped WETH through TricryptoUSDC and then wrapped WETH to SDT through the SDT/WETH pool. It returns SDT to the central RevenueConverter.
3. The existing RevenueConverter USDC branch now treats its configured USDC adapter as a USDC-to-SDT route, receives the SDT itself, and passes the received SDT through its unchanged `_convertSdt` path to produce cyvlSDT for the compounder.
4. `simulate-marketplace-revenue-cycle-v18.9.js` deploys the canonical 14-contract suite, completes ownership handoff and verification, deploys the fixed route as contract 15, configures it through the existing `setUsdcRoute`, and checks the marketplace-forwarding and compounder-harvest lifecycle.

The required flow is preserved:

- Incoming Stake DAO and marketplace USDC/SDT rewards go directly to Revenue Staking without conversion.
- Direct stakers receive raw reward tokens.
- Only the compounder strategy calls RevenueConverter after claiming its share.

No generic route registry, route timelock, governance-economic change, staking-accounting change, boost change, fee change, emissions change, or canonical production deployment-topology change is included.

## Verification status

Completed in this environment:

- dependency-free static V18.9 check suite;
- targeted minimal marketplace-route source check;
- JavaScript syntax checks;
- source-manifest verification;
- preservation of the reviewed 30-day simulation SHA-256.

Not completed in this environment:

- Solidity compilation;
- Hardhat tests;
- live Ethereum mainnet-fork execution.

The npm dependency installation could not complete because the configured package registry was unavailable. These unexecuted checks remain mandatory before deployment.
