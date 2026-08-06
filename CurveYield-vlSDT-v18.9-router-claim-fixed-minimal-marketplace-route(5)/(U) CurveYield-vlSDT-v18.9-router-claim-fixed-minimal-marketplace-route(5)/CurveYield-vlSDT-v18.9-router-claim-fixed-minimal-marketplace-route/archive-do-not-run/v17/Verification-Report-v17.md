# CurveYield V17 Deployment Package — Verification Report

## Completed here

- V17 authority/fee-recipient source assertions.
- Governance active-deposit reward source assertions.
- Blended 15-proposal participation math assertions.
- Deployment package assertions, including no Aragon execution logic.
- JavaScript syntax checks.
- JSON parsing and configuration-address validation.
- Source manifest and ZIP integrity checks after final packaging.

## Not completed here

Solidity compilation and Hardhat tests were not completed because the packaging environment did not provide a usable local Hardhat installation. Anvil fork simulation was therefore also not run here. These are mandatory Codex-agent gates, not optional recommendations.

## Mandatory pre-live gates

```bash
npm ci
npm run check:package:v17
npm run compile:v17
npm test
npm run preflight:anvil:v17
```

The Codex agent must stop on any failed command, contract-size violation, failed external-address check, simulation revert, unexpected ownership/admin state, or verification mismatch.

## Authority invariants to verify

- Every contract owner is the deployer before handoff.
- All configured treasury/admin fee receivers equal `0x9f2B20A772246960810045905B7daccf960eE288`.
- Revenue Staking admin is the deployer before handoff and the final admin afterward.
- Only the Revenue Staking admin can call `setAdmin` and `setAdminFeeReceiver`.
- Locker admin resolves from Revenue Staking and is the only caller authorized for `delegateAdminBoost`.
- `ADMIN_BOOST_BPS` is fixed at 500 and cannot be increased by owner or admin.
- The owner cannot call `delegateAdminBoost`.
- No script calls an Aragon DAO or Admin plugin.
