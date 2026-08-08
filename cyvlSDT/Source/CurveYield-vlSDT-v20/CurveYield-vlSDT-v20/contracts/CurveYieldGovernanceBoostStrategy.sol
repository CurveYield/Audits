// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IAragonTokenVoting} from "./interfaces/IAragonTokenVoting.sol";
import {
    IGovernanceBoostStrategy,
    IGovernanceStakingSnapshots
} from "./interfaces/IGovernanceBoostStrategy.sol";

/// @notice Replaceable governance-participation policy and latest-fifteen proposal history.
/// @dev The staking owner manages policy, registrars submit finalized proposals, and staking
///      alone refreshes account participation history.
contract CurveYieldGovernanceBoostStrategy is IGovernanceBoostStrategy {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PROPOSAL_REGISTRATION_BATCH = 25;
    uint256 public constant PARTICIPATION_WINDOW = 15;
    uint256 public constant PARTICIPATION_THRESHOLD = 12;
    uint256 public constant BASE_GOVERNANCE_BOOST_BPS = 10_000;
    uint256 public constant MAX_BASE_GOVERNANCE_BOOST_BPS = 30_000;
    uint256 public constant MAX_COMMUNITY_BONUS_BPS = 15_000;
    uint256 public constant MAX_GOVERNANCE_BOOST_BPS = 45_000;
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant PROPOSAL_SYNC_TYPEHASH = keccak256(
        "ProposalSync(address caller,uint256 expectedStartIndex,bytes32 proposalIdsHash,uint256 deadline)"
    );
    bytes32 internal constant VERSION_HASH = keccak256("1");

    uint8 public constant PARTICIPATION_DIRECT = 1;
    uint8 public constant PARTICIPATION_DELEGATED = 2;
    uint8 public constant PARTICIPATION_MISSED = 3;

    struct ParticipationRecord {
        uint64 endDate;
        uint8 status;
    }

    struct CanonicalProposal {
        uint256 proposalId;
        uint64 endDate;
        uint64 snapshotTimepoint;
    }

    address public immutable override governanceStaking;
    address public immutable override previousStrategy;
    IAragonTokenVoting internal _aragonVotingPlugin;
    bytes32 internal immutable _stakingNameHash;
    CanonicalProposal[] internal _canonicalProposals;
    uint256 public override registeredProposalCount;
    uint64 public override lastRegisteredSnapshotTimepoint;

    mapping(address => ParticipationRecord[15]) internal _participationHistory;
    mapping(address => uint8) internal _participationHistoryCount;
    mapping(address => uint256) internal _processedProposalCount;
    mapping(address => bool) internal _accountMigrated;
    mapping(address => uint256) internal _communityBonusBps;
    mapping(address => bool) public override isProposalRegistrar;

    error OnlyGovernanceStaking();
    error OnlyGovernanceOwner();
    error ZeroAddress();
    error AragonVotingPluginNotSet();
    error ProposalStillOpen();
    error InvalidProposal();
    error ProposalRegistrationBatchTooLarge();
    error EmptyProposalBatch();
    error ProposalAlreadyRegistered();
    error ProposalRegistrationCursorMismatch(uint256 expected, uint256 actual);
    error NonCanonicalProposalOrder();
    error PluginChangeAfterRegistration();
    error InvalidPreviousStrategy();
    error NotProposalRegistrar();
    error ProposalSyncExpired();
    error InvalidProposalSyncSigner();
    error CommunityBonusTooHigh();

    event AragonVotingPluginSet(address indexed plugin);
    event ProposalRegistrarSet(address indexed registrar, bool allowed);
    event CommunityBonusSet(address indexed account, uint256 oldBonusBps, uint256 newBonusBps);

    modifier onlyGovernanceStaking() {
        if (msg.sender != governanceStaking) revert OnlyGovernanceStaking();
        _;
    }

    modifier onlyGovernanceOwner() {
        if (msg.sender != IGovernanceStakingSnapshots(governanceStaking).owner()) {
            revert OnlyGovernanceOwner();
        }
        _;
    }

    constructor(address governanceStaking_, address previousStrategy_) {
        if (governanceStaking_ == address(0)) revert ZeroAddress();
        governanceStaking = governanceStaking_;
        previousStrategy = previousStrategy_;
        _stakingNameHash = keccak256(bytes(IERC20Metadata(governanceStaking_).name()));

        if (previousStrategy_ != address(0)) {
            IGovernanceBoostStrategy previous = IGovernanceBoostStrategy(previousStrategy_);
            if (previous.governanceStaking() != governanceStaking_) revert InvalidPreviousStrategy();
            _aragonVotingPlugin = IAragonTokenVoting(previous.aragonVotingPlugin());
            registeredProposalCount = previous.registeredProposalCount();
            lastRegisteredSnapshotTimepoint = previous.lastRegisteredSnapshotTimepoint();
            uint256 count = previous.canonicalProposalWindowCount();
            for (uint256 i; i < count; ++i) {
                (uint256 proposalId, uint64 endDate, uint64 snapshotTimepoint) =
                    previous.canonicalProposals(i);
                _canonicalProposals.push(CanonicalProposal(proposalId, endDate, snapshotTimepoint));
            }
        }
    }

    function aragonVotingPlugin() external view override returns (address) {
        return address(_aragonVotingPlugin);
    }

    function canonicalProposalWindowCount() external view override returns (uint256) {
        return _canonicalProposals.length;
    }

    function canonicalProposals(uint256 index)
        external
        view
        override
        returns (uint256 proposalId, uint64 endDate, uint64 snapshotTimepoint)
    {
        CanonicalProposal memory proposal = _canonicalProposals[index];
        return (proposal.proposalId, proposal.endDate, proposal.snapshotTimepoint);
    }

    function processedProposalCount(address account) public view override returns (uint256) {
        if (!_accountMigrated[account] && previousStrategy != address(0)) {
            return IGovernanceBoostStrategy(previousStrategy).processedProposalCount(account);
        }
        return _processedProposalCount[account];
    }

    function participationHistoryCount(address account) public view override returns (uint8) {
        if (!_accountMigrated[account] && previousStrategy != address(0)) {
            return IGovernanceBoostStrategy(previousStrategy).participationHistoryCount(account);
        }
        return _participationHistoryCount[account];
    }

    function participationHistoryCurrent(address account) external view override returns (bool) {
        return processedProposalCount(account) == registeredProposalCount;
    }

    function participationRecord(address account, uint256 index)
        public
        view
        override
        returns (uint64 endDate, uint8 status)
    {
        if (!_accountMigrated[account] && previousStrategy != address(0)) {
            return IGovernanceBoostStrategy(previousStrategy).participationRecord(account, index);
        }
        if (index >= _participationHistoryCount[account]) return (0, 0);
        ParticipationRecord memory record = _participationHistory[account][index];
        return (record.endDate, record.status);
    }

    function participationStats(address account)
        public
        view
        override
        returns (uint256 count, uint256 directHits, uint256 delegatedHits, uint256 misses)
    {
        count = participationHistoryCount(account);
        for (uint256 i; i < count; ++i) {
            (, uint8 status) = participationRecord(account, i);
            if (status == PARTICIPATION_DIRECT) ++directHits;
            else if (status == PARTICIPATION_DELEGATED) ++delegatedHits;
            else ++misses;
        }
    }

    function baseGovernanceBoostBps(address account) public view override returns (uint256 multiplier) {
        (, uint256 directHits, uint256 delegatedHits,) = participationStats(account);
        uint256 directCount = directHits > PARTICIPATION_THRESHOLD ? PARTICIPATION_THRESHOLD : directHits;
        uint256 delegatedCount =
            delegatedHits > PARTICIPATION_THRESHOLD ? PARTICIPATION_THRESHOLD : delegatedHits;
        uint256 weightedParticipationPoints = directCount * 2 + delegatedCount;
        uint256 maxParticipationPoints = PARTICIPATION_THRESHOLD * 2;
        if (weightedParticipationPoints > maxParticipationPoints) {
            weightedParticipationPoints = maxParticipationPoints;
        }
        multiplier = BASE_GOVERNANCE_BOOST_BPS
            + Math.mulDiv(
                weightedParticipationPoints,
                MAX_BASE_GOVERNANCE_BOOST_BPS - BASE_GOVERNANCE_BOOST_BPS,
                maxParticipationPoints
            );
    }

    function communityBonusBps(address account) public view override returns (uint256) {
        if (!_accountMigrated[account] && previousStrategy != address(0)) {
            try IGovernanceBoostStrategy(previousStrategy).communityBonusBps(account)
                returns (uint256 previousBonus)
            {
                return previousBonus;
            } catch {}
        }
        return _communityBonusBps[account];
    }

    function governanceBoostBps(address account)
        public
        view
        override
        returns (uint256 multiplier)
    {
        multiplier = baseGovernanceBoostBps(account) + communityBonusBps(account);
        if (multiplier > MAX_GOVERNANCE_BOOST_BPS) {
            multiplier = MAX_GOVERNANCE_BOOST_BPS;
        }
    }

    function proposalStateHash() external view override returns (bytes32 hash) {
        hash = keccak256(
            abi.encode(
                address(_aragonVotingPlugin),
                registeredProposalCount,
                lastRegisteredSnapshotTimepoint,
                _canonicalProposals
            )
        );
    }

    function setProposalRegistrar(address registrar, bool allowed)
        external
        override
        onlyGovernanceOwner
    {
        if (registrar == address(0)) revert ZeroAddress();
        isProposalRegistrar[registrar] = allowed;
        emit ProposalRegistrarSet(registrar, allowed);
    }

    function setCommunityBonusBps(address account, uint256 bonusBps)
        external
        override
        onlyGovernanceOwner
    {
        if (account == address(0)) revert ZeroAddress();
        if (bonusBps > MAX_COMMUNITY_BONUS_BPS) revert CommunityBonusTooHigh();
        _migrateAccount(account);
        uint256 oldBonus = _communityBonusBps[account];
        _communityBonusBps[account] = bonusBps;
        IGovernanceStakingSnapshots(governanceStaking).syncCommunityBonus(account);
        emit CommunityBonusSet(account, oldBonus, bonusBps);
    }

    function registerFinalizedProposals(uint256 expectedStartIndex, uint256[] calldata proposalIds)
        external
        override
    {
        if (!isProposalRegistrar[msg.sender]) revert NotProposalRegistrar();
        _registerFinalizedProposals(expectedStartIndex, proposalIds);
    }

    function registerFinalizedProposalsWithSignature(
        address caller,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline,
        bytes calldata signature
    ) external override returns (address signer) {
        if (block.timestamp > deadline) revert ProposalSyncExpired();
        signer = ECDSA.recover(
            _proposalSyncDigest(caller, expectedStartIndex, proposalIds, deadline), signature
        );
        if (!isProposalRegistrar[signer]) revert InvalidProposalSyncSigner();
        _registerFinalizedProposals(expectedStartIndex, proposalIds);
    }

    function proposalSyncDigest(
        address caller,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline
    ) external view override returns (bytes32) {
        return _proposalSyncDigest(caller, expectedStartIndex, proposalIds, deadline);
    }

    function _proposalSyncDigest(
        address caller,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                PROPOSAL_SYNC_TYPEHASH,
                caller,
                expectedStartIndex,
                keccak256(abi.encode(proposalIds)),
                deadline
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                _stakingNameHash,
                VERSION_HASH,
                block.chainid,
                governanceStaking
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function setAragonVotingPlugin(address plugin) external override onlyGovernanceOwner {
        if (plugin == address(0)) revert ZeroAddress();
        if (registeredProposalCount != 0 && plugin != address(_aragonVotingPlugin)) {
            revert PluginChangeAfterRegistration();
        }
        _aragonVotingPlugin = IAragonTokenVoting(plugin);
        emit AragonVotingPluginSet(plugin);
    }

    function _registerFinalizedProposals(
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds
    ) internal {
        if (address(_aragonVotingPlugin) == address(0)) revert AragonVotingPluginNotSet();
        if (proposalIds.length == 0) revert EmptyProposalBatch();
        if (proposalIds.length > MAX_PROPOSAL_REGISTRATION_BATCH) {
            revert ProposalRegistrationBatchTooLarge();
        }
        uint256 currentCount = registeredProposalCount;
        if (expectedStartIndex != currentCount) {
            revert ProposalRegistrationCursorMismatch(expectedStartIndex, currentCount);
        }

        uint64 previousSnapshot = lastRegisteredSnapshotTimepoint;
        for (uint256 i; i < proposalIds.length; ++i) {
            uint256 proposalId = proposalIds[i];
            if (_proposalInCurrentWindow(proposalId)) revert ProposalAlreadyRegistered();
            for (uint256 j; j < i; ++j) {
                if (proposalIds[j] == proposalId) revert ProposalAlreadyRegistered();
            }

            (
                bool open,
                ,
                IAragonTokenVoting.ProposalParameters memory parameters,
                ,
                ,
                ,

            ) = _aragonVotingPlugin.getProposal(proposalId);
            if (parameters.endDate == 0 || parameters.snapshotTimepoint == 0) revert InvalidProposal();
            if (open || block.timestamp < parameters.endDate) revert ProposalStillOpen();
            if (parameters.snapshotTimepoint < previousSnapshot) revert NonCanonicalProposalOrder();

            CanonicalProposal memory proposal =
                CanonicalProposal(proposalId, parameters.endDate, parameters.snapshotTimepoint);
            if (_canonicalProposals.length < PARTICIPATION_WINDOW) {
                _canonicalProposals.push(proposal);
            } else {
                for (uint256 j; j + 1 < PARTICIPATION_WINDOW; ++j) {
                    _canonicalProposals[j] = _canonicalProposals[j + 1];
                }
                _canonicalProposals[PARTICIPATION_WINDOW - 1] = proposal;
            }

            IGovernanceStakingSnapshots(governanceStaking).emitCanonicalProposalRegistered(
                currentCount + i, proposalId, parameters.snapshotTimepoint, parameters.endDate
            );
            previousSnapshot = parameters.snapshotTimepoint;
        }

        registeredProposalCount = currentCount + proposalIds.length;
        lastRegisteredSnapshotTimepoint = previousSnapshot;
    }

    function refreshParticipationHistory(address account)
        external
        override
        onlyGovernanceStaking
        returns (uint256 evaluatedProposals)
    {
        _migrateAccount(account);
        if (_processedProposalCount[account] == registeredProposalCount) return 0;

        _participationHistoryCount[account] = 0;
        for (uint256 i; i < _canonicalProposals.length; ++i) {
            _processCanonicalProposal(i, account);
            unchecked {
                ++evaluatedProposals;
            }
        }
        _processedProposalCount[account] = registeredProposalCount;
    }

    function _migrateAccount(address account) internal {
        if (_accountMigrated[account]) return;
        _accountMigrated[account] = true;
        if (previousStrategy == address(0)) return;

        IGovernanceBoostStrategy previous = IGovernanceBoostStrategy(previousStrategy);
        try previous.communityBonusBps(account) returns (uint256 previousBonus) {
            _communityBonusBps[account] = previousBonus;
        } catch {}
        uint8 count = previous.participationHistoryCount(account);
        _participationHistoryCount[account] = count;
        for (uint256 i; i < count; ++i) {
            (uint64 endDate, uint8 status) = previous.participationRecord(account, i);
            _participationHistory[account][i] = ParticipationRecord(endDate, status);
        }
        _processedProposalCount[account] = previous.processedProposalCount(account);
    }

    function _proposalInCurrentWindow(uint256 proposalId) internal view returns (bool) {
        for (uint256 i; i < _canonicalProposals.length; ++i) {
            if (_canonicalProposals[i].proposalId == proposalId) return true;
        }
        return false;
    }

    function _processCanonicalProposal(uint256 index, address account) internal {
        CanonicalProposal memory proposal = _canonicalProposals[index];
        IGovernanceStakingSnapshots staking = IGovernanceStakingSnapshots(governanceStaking);
        uint256 accountBalance = staking.balanceAt(account, proposal.snapshotTimepoint);
        if (accountBalance == 0) {
            staking.emitProposalParticipationRecorded(
                proposal.proposalId, account, 0, address(0), governanceBoostBps(account)
            );
            return;
        }

        address votingDelegate = staking.delegateAt(account, proposal.snapshotTimepoint);
        uint8 status = PARTICIPATION_MISSED;
        if (votingDelegate == account) {
            if (
                _aragonVotingPlugin.getVoteOption(proposal.proposalId, account)
                    != IAragonTokenVoting.VoteOption.None
            ) status = PARTICIPATION_DIRECT;
        } else if (votingDelegate != address(0)) {
            if (
                _aragonVotingPlugin.getVoteOption(proposal.proposalId, votingDelegate)
                    != IAragonTokenVoting.VoteOption.None
            ) status = PARTICIPATION_DELEGATED;
        }

        _appendParticipationRecord(account, proposal.endDate, status);
        staking.emitProposalParticipationRecorded(
            proposal.proposalId, account, status, votingDelegate, governanceBoostBps(account)
        );
    }

    function _appendParticipationRecord(address account, uint64 endDate, uint8 status) internal {
        ParticipationRecord[15] storage records = _participationHistory[account];
        uint256 count = _participationHistoryCount[account];
        ParticipationRecord memory newRecord = ParticipationRecord(endDate, status);
        if (count < PARTICIPATION_WINDOW) {
            records[count] = newRecord;
            _participationHistoryCount[account] = uint8(count + 1);
            return;
        }
        for (uint256 i; i + 1 < PARTICIPATION_WINDOW; ++i) records[i] = records[i + 1];
        records[PARTICIPATION_WINDOW - 1] = newRecord;
    }
}
