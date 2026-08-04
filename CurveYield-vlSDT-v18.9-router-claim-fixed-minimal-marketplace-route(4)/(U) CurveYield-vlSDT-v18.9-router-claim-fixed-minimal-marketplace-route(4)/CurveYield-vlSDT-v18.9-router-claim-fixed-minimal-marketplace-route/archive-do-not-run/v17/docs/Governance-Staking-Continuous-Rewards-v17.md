# Governance Staking Continuous Active-Deposit Rewards V17

## Policy

Every reward distributed through `CurveYieldGovernanceStakingV17` accrues only while the account has an active earning weight during the fourteen-day stream.

- Ordinary rewards use the account's current eligible Governance Staking balance.
- Participation rewards use the account's current cached participation working weight.
- Ordinary eligibility retains the `10e18` minimum balance.
- Participation weight retains the rolling fifteen-proposal multiplier and community bonus.

## Balance changes

The contract checkpoints every reward token before minting or burning Governance Staking balances and before changing participation working weight.

- A new deposit earns only after it enters the active supply.
- Increasing a deposit increases future accrual from that checkpoint forward.
- A partial withdrawal reduces future accrual immediately.
- A full withdrawal stops future accrual immediately.
- A queued withdrawal stops earning when the active staking balance is burned at request time, not when the underlying tokens are later released.

Amounts accrued before a withdrawal remain claimable. The withdrawal does not preserve entitlement to rewards vesting afterward.

Example for one 140-token stream:

- 100 tokens remain deposited for all fourteen days: 140 reward tokens.
- 100 tokens are fully withdrawn after seven days: 70 reward tokens.
- 100 tokens are reduced to 50 after seven days: 105 reward tokens, assuming no other active deposits.

## Continuous accounting

Each reward token and weight class has a cumulative `rewardPerTokenStored` accumulator. Streams vest linearly and independently for fourteen days. User checkpoints store the accumulator already paid and the amount accrued so far.

No Governance Reward Cycles manager, prior-block entitlement snapshot, per-user historical cycle cursor, account synchronization batch, or cycle-finalization transaction is used.

If a weight class has zero active supply, rewards vesting during that interval are deferred. When active supply returns, the deferred amount starts a new fourteen-day stream rather than being allocated to inactive or withdrawn accounts.
