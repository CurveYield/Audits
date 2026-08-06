# Governance Staking v18 Design

The active Governance Staking contract keeps staking, withdrawal, voting checkpoints, reward accounting, community bonus configuration, signed proposal relay, and cached working weights. Canonical proposal storage, participation history, direct/delegated vote classification, migration, and the base multiplier calculation are delegated to the supplied `CurveYieldGovernanceBoostStrategy` contract.

The boost strategy selected by Governance Staking remains owner-configurable. Each replacement strategy must be permanently bound to the staking contract and must identify the current strategy as its `previousStrategy`, preserving proposal and account-history continuity.

Withdrawal terms are snapshotted per request. The standard fee is capped at 15%, the base fee at 3%, and the delay at 150 days. A delayed request can be completed early by its owner; the standard portion declines linearly by 50% over the snapshotted delay, while the base fee remains constant. Waiting through unlock charges only the snapshotted base fee. Withdrawal configuration is immediately adjustable during the first seven days after deployment and thereafter uses a seven-day proposal delay.

Ordinary and participation rewards use independent pending buckets and independent fourteen-day streams. No more than fourteen active streams may exist per token and reward class. Pending rewards are batched for at least twenty-four hours and new streams are started permissionlessly or automatically during normal staking, withdrawal, kick, and claim interactions. Streamed rewards that accrue while supply is zero are requeued rather than lost.

The active source and tests live outside `archive-do-not-run/`. Compilation and runtime tests are intentionally skipped for this handoff; only static source checks are executed.
