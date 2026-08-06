# vlSDT Locker Stake DAO Router Claim Fix

## Corrected Root Cause

The previous single-distributor design was incomplete. Transaction
`0x3425eec83e947f143cc147635e14de06166e6e6658b2ceb2b88d6541b90c59ea`
proves the current production claim path is:

1. call Stake DAO Router
   `0x0f542fA75c871EB1b93Ef881b73e46acF733392f`;
2. invoke `execute(bytes[] calls)` (`0x44471415`);
3. module `0x0c` claims for the caller from both vlSDT FeeDistributors;
4. module `0x07` sweeps both reward tokens from the Router to the caller.

The traced internal calls were:

- USDC FeeDistributor
  `0xCa94395469a88E9cAC0D5E5e308910E298270d30`:
  `claim(user, router)`;
- SDT FeeDistributor
  `0x6d57d34259F6dc31C9a241c199822861940d38f9`:
  `claim(user, router)`;
- Router transfers USDC and SDT to the original caller.

The Router is the authorized operator. A locker call to the Router makes the
locker the `user` and final reward receiver.

## Required Production Behavior

`claimVlSDTRewards()` must:

1. snapshot locker USDC and SDT balances;
2. construct the exact verified Router calls:
   - `0x0c || 0xb38aab9d || abi.encode(address[2] distributors)`;
   - `0x07 || 0x780469bb || abi.encode(address[2] rewardTokens)`;
3. call `STAKE_DAO_ROUTER.execute(calls)`;
4. calculate independent USDC and SDT balance deltas;
5. revert only when both deltas are zero;
6. calculate and notify Revenue Staking separately for every nonzero token;
7. reset every approval and emit one `VlSDTRewardClaimed` event per token.

The function returns both claimed amounts.

## Deployment and Configuration

The mainnet configuration must include:

- Stake DAO Router;
- vlSDT USDC FeeDistributor;
- vlSDT SDT FeeDistributor.

The canonical deployment procedure must pass all three addresses into the
locker, register both derived reward tokens in Revenue Staking, and verify all
wiring.

## Regression Requirements

Tests must prove:

- the two `bytes[]` entries exactly match the verified live calldata structure;
- the Router internally claims on behalf of the locker from both distributors;
- both reward tokens are swept to the locker;
- both nonzero rewards are forwarded to Revenue Staking with independent
  accounting;
- one zero reward does not block the other;
- both zero rewards revert with `NoRewardClaimed`;
- no direct `claim()` shortcut remains in the locker bytecode or interface.

## Scope

This change replaces the superseded single-USDC claim implementation. It does
not change deposit, withdrawal, boost, reward-split, or vault economics.
