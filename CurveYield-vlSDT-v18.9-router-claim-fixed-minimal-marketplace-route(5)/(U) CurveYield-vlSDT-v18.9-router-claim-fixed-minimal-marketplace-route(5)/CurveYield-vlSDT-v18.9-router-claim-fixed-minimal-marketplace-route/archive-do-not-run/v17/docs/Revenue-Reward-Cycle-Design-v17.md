# Revenue Staking Immediate Split and Daily User Cycles V17

## Intake split

`notifyReward(token, amount, baseRewardPerVlSDT)` checkpoints existing user streams, pulls the exact reward amount, and computes the batch split from the current active and queued cyvlSDT balances.

- Queued benchmark entitlement is transferred immediately to the Aragon DAO.
- 33% of reward yield above the represented benchmark is transferred immediately to the Aragon DAO.
- 12% of reward yield above the represented benchmark is transferred immediately to the admin fee receiver.
- The remaining amount is added to the token's pending user-reward bucket.

When no active stake exists, the entire incoming reward is transferred to the DAO and no user cycle is created.

## Batching

The first user amount entering an empty pending bucket sets `pendingSince`. Later notifications add to the same bucket without resetting that timestamp. The bucket becomes eligible after `REWARD_CYCLE_INTERVAL`, fixed at one day.

`startRewardCycle(token)` is permissionless and starts the complete pending amount as one new fourteen-day linear stream. It reverts when:

- the reward token is unsupported;
- the pending bucket is empty;
- no active stake exists;
- the one-day interval has not elapsed;
- the active-stream safety limit is reached.

## Automatic cycle startup

The contract attempts to start all ready token cycles after:

- `stake`;
- `withdrawImmediate`;
- `requestWithdrawal`;
- `completeQueuedWithdrawal`;
- `claimRewards`;
- `claimGovernance`.

The optional keeper merely provides regular execution when user activity is low. It has no protocol role.

## Independent streams

Every cycle has its own start and end timestamps. A new cycle does not merge with, restart, extend, or carry the unvested balance of an existing cycle.

At a daily cadence, a token normally has no more than fourteen concurrently active cycles. The contract's hard limit is 32 active cycles per token.

## Zero-active-stake handling

If a user cycle vests while `totalActiveStake == 0`, that interval's user reward is placed back into the pending user bucket. It is not transferred to either the DAO or admin. A later cycle can distribute it once active stake returns and the batching interval has elapsed.
