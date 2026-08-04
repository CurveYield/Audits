# CurveYield V17 Deployment Handoff — Delivery Note

V17 was created because the deployment requirements could not be satisfied by V16's immutable ownership/fee-recipient assumptions. Functional dependencies remain immutable where appropriate, including the ERC-4626 asset. Ownership and actual fee-recipient addresses are configurable.

Authority model:

- deployer owns every contract during deployment and configuration;
- final owner and every configured fee receiver are `0x9f2B20A772246960810045905B7daccf960eE288`;
- Revenue Staking admin is initially the deployer, then self-transfers to the configured final admin during handoff;
- only admin can change admin or admin fee receiver;
- admin additionally controls only the fixed 5% vlBoost allocation through Locker;
- owner controls the separate DAO/module boost allocations but cannot use or enlarge the admin reserve;
- no deployment script performs an Aragon call.

The handoff includes static checks, Hardhat sources/tests, an Anvil fork runner, resumable deployment/configuration, verification, gas accounting, two-step ownership transfer, and a Codex operating prompt.

Compilation was attempted in the packaging environment but the local dependency installation did not expose the Hardhat binary. Per instruction, no further environment repair was attempted. The Codex agent must run `npm ci`, compilation, tests, and Anvil preflight before live deployment.
