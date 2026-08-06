# CurveYield vlSDT Liquid Locker Design V17

## Architecture

V17 consists of nine DAO-owned primary contracts. It has no Treasury contract. Treasury assets and external actions belong directly to the supplied Aragon DAO.

The self-administered admin receives 12% of Revenue Staking yield above the standard vlSDT benchmark and has exclusive control of 5% of Locker boost. The owner cannot replace the admin; only the current admin can or change those percentages.

## Locker and cyvlSDT

SDT deposits are staked through the live vlSDT `stake(amount, recipient)` function. Successful deposits mint cyvlSDT one-for-one. cyvlSDT is freely transferable and permissionlessly burnable, but burning never redeems SDT.

The Locker includes a temporary emergency route: users transfer and burn cyvlSDT, the Locker creates the matching native vlSDT unstake request, and SDT is delivered after StakeDAO's native delay. The DAO can irreversibly disable new requests; already-created requests remain completable.

## Revenue Staking

Reward intake and user vesting are deliberately separated.

For each reward notification, Revenue Staking snapshots the current active and queued cyvlSDT balances and applies the Locker-provided benchmark reward-per-vlSDT. The queued benchmark amount and 33% DAO share of excess yield are transferred to the DAO immediately. The admin fee receiver's 12% excess share is transferred immediately to `ADMIN_FEE_RECEIVER`. Only the remaining user amount is retained for time-based distribution.

User amounts do not create a stream on every transfer. They accumulate by reward token in a pending bucket. The bucket is eligible to become one new fourteen-day cycle after one day has elapsed from its first pending deposit. `startRewardCycle(token)` is permissionless, and stake, immediate withdrawal, queued-withdrawal request/completion, reward claim, and governance claim automatically start ready cycles.

Each cycle is independent. New cycles do not restart older cycles. A cycle requires active stake. If all active stake disappears during a cycle, the user emissions vesting during that zero-stake interval are requeued for a later user cycle rather than paid to the DAO or admin.

Users can exit immediately with a fixed 0.5% principal fee to the DAO or enter a seven-day no-fee queue. Queued stake stops earning user-stream rewards. Its standard benchmark entitlement is included in the immediate DAO allocation when new distributor rewards arrive.

## Shared boost capacity

Total Locker boost is partitioned:

- 20% protected DAO reserve;
- 5% protected immutable-admin reserve;
- 75% base shared module pool.

The DAO may lend an exact unused amount from its protected reserve to the shared module pool. Released capacity cannot be reclaimed while live module delegations plus unfilled Merchant marketplace listings exceed the reduced cap.

Shared usage is attributed separately to Boost Staking and Merchant. Merchant usage includes direct leases, accepted buy offers, marketplace-filled delegations, and unfilled Locker sell listings. Boost Staking usage includes its direct delegation commitments.

The DAO can configure two reserve layers:

- standing BPS reserves, calculated from the entire current shared pool;
- absolute reserve floors created by allocating exact vlBoost amounts from currently free, unreserved capacity.

The effective reserve for each module is the larger of its standing BPS reserve and absolute floor. Each module may use its reserve plus common unreserved capacity, but it cannot consume the other module's unused reserve.

Boost Staking's hard configuration range is 2x to 10x. Its linear multiplier uses its own accessible capacity after Merchant reserves. Merchant's quadratic price uses its own accessible capacity after Boost Staking reserves and remains bounded by the DAO-configured per-token minimum and maximum price.

At one module's access limit, only that module is blocked; the other may continue using its protected remainder. Complete shared utilization blocks both.

## Governance token and voting stake

The transferable governance token has an immutable cap of 1,000,000,000,000 tokens. DAO-authorized minters include Revenue Staking and Boost Staking for on-demand emissions.

Governance Staking is the non-transferable OpenZeppelin `ERC20Votes` position. Deposit, voting-token issuance, yield stake, and voting-power creation occur in one transaction. Delegation remains available through standard Votes functions.

All Governance Staking rewards use continuous fourteen-day cumulative accumulators inside `CurveYieldGovernanceStakingV17`. Ordinary rewards use the account's current eligible active balance, while participation rewards use its current cached working weight. Every balance or weight change checkpoints accrued rewards first, so adding stake begins earning prospectively and reducing or fully withdrawing stake immediately reduces or stops future accrual. Accrued rewards remain claimable, but withdrawn principal has no entitlement to the unvested remainder. No external reward-cycle manager, historical user-cycle scan, or cycle keeper exists.

Participation weights are modeled after Curve gauges. The contract checkpoints reward integrals and settles an account at its old weight before evaluating the latest canonical Aragon proposal window and updating that account's working weight. Stake, withdrawal request, claim, and community-bonus changes refresh automatically. Anyone can permissionlessly `kick(account)` for inactive stale accounts.

Proposal IDs come from the TokenVoting plugin's indexed `ProposalCreated` transaction logs. The frontend and keeper preserve block/transaction/log order. The keeper submits directly, while the frontend relays a registrar-signed batch inside an atomic sync-enabled user interaction. Governance Staking retains only the latest fifteen proposal records plus the total cursor and last snapshot checkpoint, avoiding an ever-growing proposal array. Registration validates cursor agreement, closure, duplicate IDs within the retained/submitted window, and nondecreasing snapshot order, and accepts at most 25 proposal IDs per transaction. That limit applies only to proposal IDs. Proposal registration remains available during active reward streams, and no global all-staker gate exists.

Participation multiplier over the rolling latest-fifteen window:

- 1x base;
- `2x / 12` added for every qualifying direct self-vote;
- `1x / 12` added for every qualifying historical-delegate vote;
- a single mixed-history weighted score using two points per direct record and one point per delegated record, capped at 3x before the community bonus;
- proposal classification uses historical delegation checkpoints, so self/delegate transitions change the rolling average instead of resetting it;
- 12 direct votes reaches 3x and 12 delegated votes reaches 2x;
- DAO community bonus up to +1.5x;
- 4.5x final cap.

## Revenue Compounder

The Compounder inherits OpenZeppelin Contracts 5.4.0 ERC-4626. cyvlSDT is the asset and cycvlSDT is the transferable vault share.

The complete standard ERC-4626 surface is present. Immediate withdrawals gross up Revenue Staking principal for the fixed 0.5% fee; queued exits use the separate no-fee path.

Ordinary reward tokens follow DAO-approved reward-to-SDT adapters. SDT then follows whichever route returns more cyvlSDT subject to a DAO-set market-advantage threshold: direct one-for-one Locker minting or a reviewed underpeg market adapter. Governance rewards remain distributable to vault shareholders and are never compounded away.

## Configuration lifecycle

Initial constructors use only pre-existing addresses. Governance Staking contains its own continuous reward accounting and requires no separate reward-cycle manager or manager-wiring action. Aragon plugin, proposal registrar, Curve pool, gauge, bribe target, swap routes, Merchant payment ranges, DAO capacity release, and community bonuses are post-deployment actions.

The event-indexing keeper uses the TokenVoting plugin deployment block as its start, registers only the contiguous finalized proposal prefix, and may optionally kick named stale accounts. Governance rewards need no cycle keeper and no historical account processing.