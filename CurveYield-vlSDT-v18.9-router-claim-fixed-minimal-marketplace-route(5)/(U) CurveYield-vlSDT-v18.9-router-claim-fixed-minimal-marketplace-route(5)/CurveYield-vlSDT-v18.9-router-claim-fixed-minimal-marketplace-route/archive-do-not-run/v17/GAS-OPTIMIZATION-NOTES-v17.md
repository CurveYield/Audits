# Gas Optimization Notes V17

The deployment package minimizes live gas without introducing a temporary deployment coordinator or additional privileged contract.

## Implemented

- Constructor dependency ordering avoids redeployment and duplicate wiring.
- Final fee recipients are passed at construction, eliminating later receiver writes.
- Every setter is preceded by a state comparison and is skipped when unnecessary.
- `setMinters` and `setNotifiers` batch multiple addresses in one storage transaction.
- `configureSystem` wires three Locker dependencies in one call.
- Default values are not rewritten.
- Deployment state is resumable and checks bytecode before redeploying.
- Gas is estimated immediately before each transaction and recorded per step and cumulatively.

## Deliberately not used

- No generic multicall: external self-calls would change `msg.sender` and fail `onlyOwner`; a delegatecall batcher would materially increase audit risk.
- No temporary deployment factory/coordinator: it adds bytecode and authorization complexity and does not reliably reduce total gas for this dependency graph.
- No CREATE2 requirement: deterministic addresses are not needed and the extra factory path increases operational risk.
- No parallel broadcasts: contract addresses and constructor arguments depend on earlier deployments.

## Optional future contract-level optimization

Large lists of merchant payment tokens, compounder keepers, or reward adapters still require one transaction per item because the production contracts do not expose batch setters for those lists. Adding batch setters could reduce configuration gas but would change contract code and audit surface; it is intentionally outside this deployment-only optimization.
