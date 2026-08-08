# Audit Scope v1

## In scope

1. Ethereum and Fraxtal BoostHub deployments.
2. Current Ethereum sdCRV, sdFXN, and sdYB CurveYield staking/vault/strategy/converter components.
3. Current Fraxtal sdFXS CurveYield staking/vault/strategy/converter components.
4. Current sdYB helper contracts recovered from the deployed strategy constructor.
5. The source-version differences that exist among those live deployments.
6. Cross-contract assumptions involving the external gauges, LP/reward tokens, and pools listed in `manifests/EXTERNAL_DEPENDENCIES-v1.json`.

## Not first-party source targets

StakeDAO gauges, Curve pools, CRV/crvUSD/wstETH/WFRAX/SDT/YB/FXN and LP/token contracts are external dependencies. Their behavior may be analyzed where the BoostHub suite relies on it, but their complete codebases are not presented as CurveYield audit source.

## Deliberately excluded

The hidden legacy `sdYB-old` deployment is excluded because the supplied current frontend-v7 inventory explicitly excludes it from the current active suite.

## Exact-source warning

Do not collapse all addresses onto one repository snapshot. The current live suite contains multiple source releases. Use `SOURCE_VERSION_MANIFEST-v1.json` and preserve the per-address bindings.
