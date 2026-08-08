// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

library BoostHubErrors {
    error ZeroAddress();
    error ZeroAmount();
    error InvalidPool();
    error AlreadySet();
    error PoolInactive();
    error StrategyNotApproved();
    error RewardTokenNotRegistered();
    error RewardTokenLimitExceeded();
    error DuplicateRewardToken();
    error DuplicateGauge();
    error InvalidGaugeAsset();
    error CheckpointFailed();
    error CheckpointSelectorNotSet();
    error InvalidFee();
    error NothingToClaim();
    error LengthMismatch();
    error ZeroSelector();
    error InvalidSnapshotSpace();
    error ClaimExecutorNotSet();
    error InvalidLockedCall();
}
