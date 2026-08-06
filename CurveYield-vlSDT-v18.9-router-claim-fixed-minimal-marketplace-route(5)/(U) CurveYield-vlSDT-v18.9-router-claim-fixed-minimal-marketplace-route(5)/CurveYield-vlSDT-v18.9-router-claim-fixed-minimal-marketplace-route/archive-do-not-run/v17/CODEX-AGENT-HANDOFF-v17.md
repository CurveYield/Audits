# Codex Agent Handoff V17

You are responsible for preparing and executing the CurveYield vlSDT Liquid Locker V17 Ethereum deployment. Work only from this package. Do not substitute older versions.

## Required operating rules

1. Do not make any Aragon DAO, Admin-plugin, proposal, or permission call.
2. Do not broadcast before compilation, all tests, and the complete Anvil fork preflight pass.
3. Do not put private keys in JSON, source files, logs, commits, or chat. Use environment variables only.
4. The deployer must remain owner during all deployment, configuration, and pre-handoff verification.
5. Do not run `propose-handoff-v17.js` until the configured system verifies under deployer ownership.
6. Do not run `accept-handoff-v17.js` unless controlling the exact final-owner wallet.
7. Final owner and every fee receiver must remain `0x9f2B20A772246960810045905B7daccf960eE288`.
8. Admin starts as deployer, then only admin self-transfers to `finalAdmin`. Owner must never change admin.
9. Admin rights are limited to changing admin, changing admin fee receiver, and allocating up to the fixed 5% vlBoost reserve.
10. Stop immediately on any mismatch. Do not “work around” a failed invariant.

## Execution sequence

```bash
npm ci
npm run check:package:v17
npm run clean
npm run compile:v17
npm test
ETHEREUM_RPC_URL=... DEPLOYER_PRIVATE_KEY=... npm run preflight:anvil:v17
```

After preflight, inspect the generated `deployment-output-v17/deployment-state-v17-anvil-*.json` and gas totals. Confirm all external StakeDAO addresses have bytecode and `FeeDistributor.REWARD_TOKEN()` resolves to a contract.

For live execution:

```bash
RPC_URL=... DEPLOYER_PRIVATE_KEY=... DEPLOYMENT_TAG=mainnet npm run deploy:configure:v17
RPC_URL=... DEPLOYER_PRIVATE_KEY=... DEPLOYMENT_TAG=mainnet npm run verify:deployment:v17
```

Pause for human review of every deployed address, transaction hash, constructor argument, gas total, and verification report. Then ownership handoff is two separate operations:

```bash
export CONFIRM_FINAL_HANDOFF=TRANSFER_TO_0x9f2B20A772246960810045905B7daccf960eE288
RPC_URL=... DEPLOYER_PRIVATE_KEY=... DEPLOYMENT_TAG=mainnet npm run handoff:propose:v17

export CONFIRM_ACCEPT_OWNERSHIP=ACCEPT_0x9f2B20A772246960810045905B7daccf960eE288
RPC_URL=... FINAL_OWNER_PRIVATE_KEY=... DEPLOYMENT_TAG=mainnet npm run handoff:accept:v17
```

Finally run verification with the final-owner key or with the deployer key in read-only use and `EXPECTED_OWNER` set to the final owner.

## Required report back

Return:

- compiler version and optimizer/viaIR settings;
- test counts and failures;
- Anvil fork block number;
- deployed addresses;
- constructor arguments;
- configuration transactions;
- total deployment/configuration/handoff gas;
- final owner/admin/fee receivers;
- any skipped optional integrations;
- exact unresolved risks.
