# Deployment Runbook V17

## 1. Requirements

- Node.js 20+
- npm
- Anvil available on `PATH`
- Ethereum archive-capable RPC endpoint
- funded deployer wallet
- separate access to final-owner wallet for the acceptance phase

Copy `.env.example-v17` values into the shell. Never commit the populated values.

## 2. Review configuration

Edit `config-mainnet-v17.json`. Empty arrays and zero values intentionally disable optional configuration. Confirm every StakeDAO address against Ethereum mainnet before continuing.

## 3. Static, compile, and test gates

```bash
npm ci
npm run check:package:v17
npm run clean
npm run compile:v17
npm test
```

Stop on any failure. Record deployed bytecode sizes and ensure every production contract is below the EIP-170 runtime limit.

## 4. Anvil preflight

```bash
ETHEREUM_RPC_URL="$ETHEREUM_RPC_URL" \
DEPLOYER_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" \
npm run preflight:anvil:v17
```

The preflight forks mainnet, funds the deployer and final owner only inside Anvil, deploys/configures, verifies deployer ownership, proposes handoff, impersonates the final owner for acceptance, and verifies final ownership. It does not broadcast to Ethereum.

## 5. Live deploy and configure

```bash
RPC_URL="$ETHEREUM_RPC_URL" \
DEPLOYER_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" \
DEPLOYMENT_TAG=mainnet \
npm run deploy:configure:v17
```

The state file is resumable. Re-running skips contracts with bytecode at recorded addresses and skips configuration already equal to the target state. Never delete the state file during an active deployment.

## 6. Verify before handoff

```bash
RPC_URL="$ETHEREUM_RPC_URL" \
DEPLOYER_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" \
DEPLOYMENT_TAG=mainnet \
npm run verify:deployment:v17
```

Review `deployment-output-v17/verification-v17-mainnet.json`. Confirm owner=deployer, admin=deployer, fee receivers=final owner, dependency wiring, minters, notifiers, registrar state, and fixed admin boost cap.

## 7. Propose two-step ownership transfer

```bash
export CONFIRM_FINAL_HANDOFF=TRANSFER_TO_0x9f2B20A772246960810045905B7daccf960eE288
RPC_URL="$ETHEREUM_RPC_URL" DEPLOYER_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" DEPLOYMENT_TAG=mainnet npm run handoff:propose:v17
```

This also self-transfers Revenue Staking admin from deployer to `finalAdmin` before proposing ownership. It makes no Aragon call.

## 8. Accept ownership

```bash
export CONFIRM_ACCEPT_OWNERSHIP=ACCEPT_0x9f2B20A772246960810045905B7daccf960eE288
RPC_URL="$ETHEREUM_RPC_URL" FINAL_OWNER_PRIVATE_KEY="$FINAL_OWNER_PRIVATE_KEY" DEPLOYMENT_TAG=mainnet npm run handoff:accept:v17
```

## 9. Final verification

Confirm every `owner()` equals the final owner, every `pendingOwner()` is zero, Revenue Staking `admin()` equals finalAdmin, every fee receiver equals final owner, and no deployer registrar permission remains.
