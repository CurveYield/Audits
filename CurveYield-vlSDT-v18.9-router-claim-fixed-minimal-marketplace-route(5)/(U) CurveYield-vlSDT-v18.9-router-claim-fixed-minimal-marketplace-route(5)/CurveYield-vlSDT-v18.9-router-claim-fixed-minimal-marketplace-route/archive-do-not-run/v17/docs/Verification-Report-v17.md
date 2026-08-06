# CurveYield vlSDT Liquid Locker V17 — Verification Report

## Status

**Source-only static verification completed. Solidity compilation and Hardhat execution were skipped.** V17 must not be treated as compiled, runtime-tested, audited, or production-ready.

## V17 behavior requiring runtime verification

- ordinary rewards accrue from current eligible active Governance Staking balance;
- participation rewards accrue from current cached participation working weight;
- stake additions enter reward supply only after old rewards are checkpointed;
- partial withdrawals settle the old balance and immediately reduce subsequent accrual;
- full withdrawals settle accrued rewards and immediately stop subsequent accrual;
- queued-withdrawal principal stops earning when the request burns the active staking balance;
- previously accrued rewards remain claimable after exit without granting the unvested remainder;
- crossing below the `10e18` ordinary-reward floor stops ordinary accrual prospectively;
- zero-supply emissions are deferred and restart as a new fourteen-day stream when active supply returns;
- overlapping streams vest independently and do not reset one another;
- the rolling fifteen-proposal participation system and blended direct/delegated multiplier remain unchanged;
- frontend-signed proposal registration and direct keeper registration remain unchanged.

## Static evidence completed

- modular and standalone Governance Staking contain both ordinary and participation cumulative reward accumulators;
- withdrawal ordering statically shows reward checkpointing before balance burn and working-weight reduction;
- ordinary user accrual reads current reward-eligible balance;
- participation user accrual reads current participation working weight;
- no Governance Reward Cycles manager, `setRewardCycleManager`, or snapshot-cycle manager reference remains in Governance Staking;
- the active-deposit arithmetic regression passed: full midpoint exit = 70/140, half midpoint exit = 105/140, no exit = 140/140;
- the blended participation static regression passed;
- the delegation-transition arithmetic regression passed;
- all JavaScript files passed `node --check`;
- all JSON files parsed successfully;
- all eight standalone Remix Solidity files contain no imports and exactly one SPDX declaration, pragma, and CurveYield component header;
- modular and standalone Governance Staking contract bodies match exactly;
- package and deployment configuration identify V17;
- source manifest and ZIP integrity are verified after packaging.

## Intentional Governance Staking ABI changes from V15

Removed:

- `setRewardCycleManager(address)`
- `claimDaoReward(address)`
- `daoClaimable(address)`

Added read surfaces:

- `getStream(address,uint256)`
- `getParticipationStream(address,uint256)`
- `pendingReward(address)`
- `pendingParticipationReward(address)`

## Required future verification sequence

```bash
node scripts/prepare-workspace-v17.js
npm ci
npm run clean
npm run compile
npm test
npm run build:remix
node scripts/verify-remix-standalone-v17.js
```

## Limitations

Static checks do not establish Solidity compilation, deployed bytecode size, runtime correctness, economic correctness under adversarial ordering, live EIP-712 behavior, mainnet-fork compatibility, or independent security review.
