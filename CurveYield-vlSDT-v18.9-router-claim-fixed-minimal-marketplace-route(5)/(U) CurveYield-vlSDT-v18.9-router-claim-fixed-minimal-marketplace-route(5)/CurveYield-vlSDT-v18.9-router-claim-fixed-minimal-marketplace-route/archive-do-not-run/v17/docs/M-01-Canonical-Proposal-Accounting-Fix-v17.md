# M-01 Canonical Proposal Accounting Fix V17

## Finding addressed

Earlier versions either allowed callers to choose favorable proposal IDs, required global account synchronization, or temporarily introduced a proposal-creation gateway. V17 leaves the Aragon governance plugin unchanged and uses its public `ProposalCreated` transaction-log history.

## V17 design

### 1. Shared transaction-log discovery

Both the official frontend and `scripts/proposal-participation-keeper-v17.js` index the configured TokenVoting plugin's indexed `ProposalCreated` logs. Logs are sorted by block number, transaction index, and log index. Proposal IDs are read directly from the indexed event field.

### 2. Keeper direct registration

An authorized registrar may directly call:

```solidity
registerFinalizedProposals(uint256 expectedStartIndex, uint256[] proposalIds)
```

This is the fallback automation path. The keeper reads `canonicalProposalCount()`, selects the next contiguous finalized suffix, and submits at most 25 IDs.

### 3. Signed frontend relay

The frontend may relay the same batch without possessing the registrar key. An authorized registrar signs the EIP-712 `ProposalSync` message containing the intended caller, expected cursor, hash of the proposal-ID array, and deadline. The user then calls one of:

- `stakeWithProposalSync`;
- `stakeForWithProposalSync`;
- `requestWithdrawalWithProposalSync`;
- `claimRewardsWithProposalSync`;
- `kickWithProposalSync`;
- or the standalone `registerFinalizedProposalsWithSignature`.

Governance Staking recovers the signer, requires the signer to remain authorized through `setProposalRegistrar`, registers the batch, refreshes the account, and completes the user action atomically. Cursor advancement prevents signature replay after successful registration.

### 4. On-chain validation and bounded storage

The contract validates cursor agreement, proposal existence, finalization, duplicate rejection, nondecreasing snapshot ordering, signature deadline, and registrar authorization. It stores:

- `registeredProposalCount`, the total event-history cursor;
- `lastRegisteredSnapshotTimepoint`, the ordering checkpoint;
- only the latest fifteen `CanonicalProposal` records;
- only the latest fifteen participation records per account.

The complete proposal history remains reconstructable from the public TokenVoting logs but is not duplicated in contract storage.

### 5. Proportional participation multiplier

The multiplier increases with every qualifying proposal and does not wait for a complete fifteen-record history:

- base: 1x;
- each direct self-vote adds `2x / 12`;
- each historical-delegate vote adds `1x / 12`;
- direct and delegated records are combined before division into one weighted score, using two points per direct vote and one point per delegated vote;
- every record uses the delegate checkpoint at that proposal's snapshot, so changing delegation does not rewrite or clear prior participation;
- the combined voting multiplier is capped at 3x before the community bonus;
- 12 direct votes reaches 3x, while 12 delegated votes reaches 2x.

Six direct votes therefore produces 2x, six delegated votes produces 1.5x, and a six-direct/six-delegated history produces 2.5x. Combining the weighted score before division avoids separate-rounding loss in mixed histories. Replacing delegated records with direct records increases the multiplier progressively; the reverse decreases it progressively. Community bonus and the 4.5x absolute cap are unchanged.

### 6. Curve-style cached working weights

Before an account's multiplier changes, reward accrual is settled at its old cached `participationWorkingWeight`. The latest fifteen records are then rebuilt and the future working weight is updated. Original interaction functions remain available, the official frontend uses the signed sync variants when needed, and anyone may permissionlessly `kick(account)`.

## Trust boundary

An EVM contract cannot independently search historical receipts or logs. Authorized registrars therefore attest that a signed or directly submitted batch is the exact contiguous event-ordered suffix. The keeper and frontend independently reconstruct the same public history, and every accepted proposal remains auditable through `CanonicalProposalRegistered` events.
