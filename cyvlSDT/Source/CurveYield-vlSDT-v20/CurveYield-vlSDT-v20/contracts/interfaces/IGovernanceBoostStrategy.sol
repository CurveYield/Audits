// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

interface IGovernanceBoostStrategy {
    function governanceStaking() external view returns (address);
    function previousStrategy() external view returns (address);
    function aragonVotingPlugin() external view returns (address);
    function registeredProposalCount() external view returns (uint256);
    function lastRegisteredSnapshotTimepoint() external view returns (uint64);
    function canonicalProposalWindowCount() external view returns (uint256);
    function canonicalProposals(uint256 index)
        external
        view
        returns (uint256 proposalId, uint64 endDate, uint64 snapshotTimepoint);
    function processedProposalCount(address account) external view returns (uint256);
    function participationHistoryCount(address account) external view returns (uint8);
    function participationHistoryCurrent(address account) external view returns (bool);
    function participationRecord(address account, uint256 index)
        external
        view
        returns (uint64 endDate, uint8 status);
    function participationStats(address account)
        external
        view
        returns (uint256 count, uint256 directHits, uint256 delegatedHits, uint256 misses);
    function baseGovernanceBoostBps(address account) external view returns (uint256 multiplier);
    function governanceBoostBps(address account) external view returns (uint256 multiplier);
    function communityBonusBps(address account) external view returns (uint256);
    function proposalStateHash() external view returns (bytes32 hash);
    function setAragonVotingPlugin(address plugin) external;
    function isProposalRegistrar(address registrar) external view returns (bool);
    function setProposalRegistrar(address registrar, bool allowed) external;
    function setCommunityBonusBps(address account, uint256 bonusBps) external;
    function registerFinalizedProposals(uint256 expectedStartIndex, uint256[] calldata proposalIds)
        external;
    function registerFinalizedProposalsWithSignature(
        address caller,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline,
        bytes calldata signature
    ) external returns (address signer);
    function proposalSyncDigest(
        address caller,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline
    ) external view returns (bytes32);
    function refreshParticipationHistory(address account)
        external
        returns (uint256 evaluatedProposals);
}

interface IGovernanceStakingSnapshots {
    function owner() external view returns (address);
    function balanceAt(address account, uint256 timepoint) external view returns (uint256);
    function delegateAt(address account, uint256 timepoint) external view returns (address);
    function syncCommunityBonus(address account) external;
    function emitCanonicalProposalRegistered(
        uint256 globalIndex,
        uint256 proposalId,
        uint64 snapshotTimepoint,
        uint64 endDate
    ) external;
    function emitProposalParticipationRecorded(
        uint256 proposalId,
        address account,
        uint8 status,
        address votingDelegate,
        uint256 newMultiplierBps
    ) external;
}
