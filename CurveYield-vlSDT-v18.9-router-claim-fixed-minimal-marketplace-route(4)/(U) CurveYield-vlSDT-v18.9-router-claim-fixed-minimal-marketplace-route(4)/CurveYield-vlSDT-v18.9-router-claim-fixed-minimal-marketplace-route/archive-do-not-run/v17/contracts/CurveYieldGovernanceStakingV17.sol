// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/**
 * @title CurveYield System Component
 * @notice CurveYield is a decentralized NGO building optimized DeFi systems for the good of all.
 *
 * @dev CurveYield integrates specialized AMM infrastructure, tokenized yield strategies, credit
 * markets, and protocol-owned liquidity into a unified, capital-efficient liquidity stack governed
 * by an open, international DAO community.
 *
 * Protocol operations are enhanced by cross-chain bridging and messaging, MEV capture systems,
 * off-chain to on-chain automation, and peer-to-peer data networks.
 *
 * This contract is one component of the CurveYield system.
 *
 * CurveYield uses proven DeFi primitives where possible and adds targeted coordination and
 * capital-efficiency-enhancing contracts where needed. Users and integrators must review
 * CurveYield documentation before use.
 *
 * Learn more:
 * Documentation: https://docs.curveyield.com
 * dApp: https://curveyield.online
 * GitHub: https://github.com/curveyield
 *
 * Decentralized links may have limited or delayed availability during periods of high network activity:
 * https://curveyield.eth.limo
 * https://curveyield.dao
 *
 * Note: curveyield.dao may require a Brave Browser or an Unstoppable Domains browser plugin to use.
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {IAragonTokenVotingV17} from "./interfaces/IAragonTokenVotingV17.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract CurveYieldGovernanceStakingV17 is ERC20Votes, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Checkpoints for Checkpoints.Trace208;
    using Checkpoints for Checkpoints.Trace160;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_WITHDRAW_TAX_BPS = 500;
    uint256 public constant MAX_WITHDRAW_HOLD_TIME = 30 days;
    uint256 public constant STREAM_DURATION = 14 days;
    uint256 public constant PRECISION = 1e27;
    uint256 public constant MAX_REWARD_TOKENS = 8;
    uint256 public constant MAX_ACTIVE_STREAMS_PER_TOKEN = 256;
    uint256 public constant MIN_REWARD_ELIGIBLE_BALANCE = 10 ether;
    uint256 public constant MAX_PROPOSAL_REGISTRATION_BATCH = 25;
    uint256 public constant PARTICIPATION_WINDOW = 15;
    uint256 public constant PARTICIPATION_THRESHOLD = 12;
    uint256 public constant BASE_PARTICIPATION_MULTIPLIER_BPS = 10_000;
    uint256 public constant DELEGATED_PARTICIPATION_MULTIPLIER_BPS = 20_000;
    uint256 public constant DIRECT_PARTICIPATION_MULTIPLIER_BPS = 30_000;
    uint256 public constant MAX_COMMUNITY_BONUS_BPS = 15_000;
    uint256 public constant MAX_PARTICIPATION_MULTIPLIER_BPS = 45_000;
    bytes32 public constant PROPOSAL_SYNC_TYPEHASH = keccak256(
        "ProposalSync(address caller,uint256 expectedStartIndex,bytes32 proposalIdsHash,uint256 deadline)"
    );

    uint8 public constant PARTICIPATION_DIRECT = 1;
    uint8 public constant PARTICIPATION_DELEGATED = 2;
    uint8 public constant PARTICIPATION_MISSED = 3;

    struct Stream {
        uint256 amount;
        uint64 start;
        uint64 end;
    }

    /// @notice Continuous fourteen-day reward accounting for one reward token and one weight class.
    struct RewardData {
        uint256 rewardPerTokenStored;
        uint256 pendingRewards;
        uint256 scaledRemainder;
        uint64 lastUpdate;
        uint64 streamHead;
        Stream[] streams;
    }

    struct WithdrawalRequest {
        address owner;
        address receiver;
        uint128 amount;
        uint128 tax;
        uint64 unlockTime;
        bool completed;
    }

    struct ParticipationRecord {
        uint64 endDate;
        uint8 status;
    }

    struct CanonicalProposal {
        uint256 proposalId;
        uint64 endDate;
        uint64 snapshotTimepoint;
    }

    IERC20 public immutable GOVERNANCE_TOKEN;
    address public treasuryReceiver;

    uint256 public withdrawTaxBps;
    uint256 public withdrawHoldTime;
    uint256 public nextWithdrawalId = 1;

    address[] public rewardTokens;
    mapping(address => bool) public isRewardToken;
    mapping(address => bool) public isNotifier;
    /// @dev Ordinary rewards use current reward-eligible stake; participation rewards use current working weight.
    mapping(address => RewardData) internal _rewardData;
    mapping(address => RewardData) internal _participationRewardData;
    mapping(address => mapping(address => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(address => uint256)) public userParticipationRewardPerWeightPaid;
    mapping(address => mapping(address => uint256)) public accruedRewards;
    mapping(address => mapping(address => uint256)) public accruedParticipationRewards;
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    IAragonTokenVotingV17 public aragonVotingPlugin;
    uint256 public totalParticipationWeight;
    mapping(address => uint256) public communityBonusBps;
    mapping(address => ParticipationRecord[15]) internal _participationHistory;
    mapping(address => uint8) public participationHistoryCount;

    /// @notice Rolling latest-fifteen finalized proposal window used for participation multipliers.
    CanonicalProposal[] public canonicalProposals;
    /// @notice Total number of event-ordered proposals accepted from the TokenVoting transaction history.
    uint256 public registeredProposalCount;
    uint64 public lastRegisteredSnapshotTimepoint;
    mapping(address => bool) public isProposalRegistrar;
    mapping(address => uint256) public processedProposalCount;
    mapping(address => uint256) public participationWorkingWeight;
    uint256 public activeStakerCount;
    mapping(address => bool) public hasEverStaked;
    address[] internal _governanceStakers;
    uint256 public totalRewardEligibleSupply;

    mapping(address => Checkpoints.Trace208) internal _balanceCheckpoints;
    Checkpoints.Trace208 internal _rewardEligibleSupplyCheckpoints;
    mapping(address => Checkpoints.Trace160) internal _delegateCheckpoints;

    error ZeroAddress();
    error ZeroAmount();
    error NonTransferable();
    error InvalidWithdrawalConfig();
    error InsufficientStake();
    error InvalidWithdrawalRequest();
    error WithdrawalNotReady();
    error UnsupportedRewardToken();
    error RewardTokenAlreadyAdded();
    error RewardTokenLimit();
    error NotNotifier();
    error ValueTooLarge();
    error ActiveStreamLimit();
    error UnderlyingCannotBeReward();
    error NonExactRewardTransfer(uint256 expected, uint256 received);
    error AragonVotingPluginNotSet();
    error ProposalStillOpen();
    error InvalidProposal();
    error CommunityBonusTooHigh();
    error ProposalRegistrationBatchTooLarge();
    error NotProposalRegistrar();
    error EmptyProposalBatch();
    error ProposalAlreadyRegistered();
    error ProposalRegistrationCursorMismatch(uint256 expected, uint256 actual);
    error NonCanonicalProposalOrder();
    error PluginChangeAfterRegistration();
    error ProposalSyncExpired();
    error InvalidProposalSyncSigner();

    event Staked(address indexed caller, address indexed recipient, uint256 amount);
    event TreasuryReceiverSet(address indexed oldReceiver, address indexed newReceiver);
    event WithdrawalConfigSet(uint256 taxBps, uint256 holdTime);
    event WithdrawalRequested(
        uint256 indexed id,
        address indexed owner,
        address indexed receiver,
        uint256 grossAmount,
        uint256 taxAmount,
        uint256 unlockTime
    );
    event WithdrawalCompleted(
        uint256 indexed id,
        address indexed owner,
        address indexed receiver,
        uint256 netAmount,
        uint256 taxAmount
    );
    event RewardTokenAdded(address indexed token);
    event NotifierSet(address indexed notifier, bool allowed);
    event RewardNotified(address indexed token, uint256 amount, uint256 endTime);
    event RewardDeferred(address indexed token, uint256 amount, bool indexed participationReward);
    event RewardClaimed(address indexed user, address indexed token, address indexed receiver, uint256 amount);
    event AragonVotingPluginSet(address indexed plugin);
    event ProposalRegistrarSet(address indexed registrar, bool allowed);
    event ProposalSyncRelayed(
        address indexed caller,
        address indexed signer,
        uint256 indexed expectedStartIndex,
        uint256 proposalCount
    );
    event CanonicalProposalRegistered(
        uint256 indexed globalIndex,
        uint256 indexed proposalId,
        uint64 snapshotTimepoint,
        uint64 endDate
    );
    event CommunityBonusSet(address indexed account, uint256 oldBonusBps, uint256 newBonusBps);
    event ProposalParticipationRecorded(
        uint256 indexed proposalId,
        address indexed account,
        uint8 status,
        address votingDelegate,
        uint256 newMultiplierBps
    );
    event ParticipationRewardNotified(address indexed token, uint256 amount, uint256 endTime);
    event ParticipationWorkingWeightUpdated(
        address indexed account, uint256 oldWeight, uint256 newWeight, uint256 totalWorkingWeight
    );
    event ParticipationAccountKicked(
        address indexed caller, address indexed account, uint256 evaluatedProposals
    );

    constructor(
        address initialOwner_,
        address governanceToken_,
        address initialTreasuryReceiver_,
        string memory name_,
        string memory symbol_,
        uint256 initialWithdrawTaxBps_,
        uint256 initialWithdrawHoldTime_
    ) ERC20(name_, symbol_) EIP712(name_, "1") Ownable(initialOwner_) {
        if (
            initialOwner_ == address(0) || governanceToken_ == address(0)
                || initialTreasuryReceiver_ == address(0)
        ) revert ZeroAddress();
        GOVERNANCE_TOKEN = IERC20(governanceToken_);
        treasuryReceiver = initialTreasuryReceiver_;
        isProposalRegistrar[initialOwner_] = true;
        emit ProposalRegistrarSet(initialOwner_, true);
        emit TreasuryReceiverSet(address(0), initialTreasuryReceiver_);
        _setWithdrawalConfig(initialWithdrawTaxBps_, initialWithdrawHoldTime_);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert NonTransferable();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert NonTransferable();
    }

    function approve(address, uint256) public pure override returns (bool) {
        revert NonTransferable();
    }

    function setWithdrawalConfig(uint256 taxBps, uint256 holdTime) external onlyOwner {
        _setWithdrawalConfig(taxBps, holdTime);
    }

    function setTreasuryReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        emit TreasuryReceiverSet(treasuryReceiver, newReceiver);
        treasuryReceiver = newReceiver;
    }

    function _setWithdrawalConfig(uint256 taxBps, uint256 holdTime) internal {
        if (taxBps > MAX_WITHDRAW_TAX_BPS || holdTime > MAX_WITHDRAW_HOLD_TIME) {
            revert InvalidWithdrawalConfig();
        }
        withdrawTaxBps = taxBps;
        withdrawHoldTime = holdTime;
        emit WithdrawalConfigSet(taxBps, holdTime);
    }

    function addRewardToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (token == address(GOVERNANCE_TOKEN)) revert UnderlyingCannotBeReward();
        if (isRewardToken[token]) revert RewardTokenAlreadyAdded();
        if (rewardTokens.length >= MAX_REWARD_TOKENS) revert RewardTokenLimit();
        isRewardToken[token] = true;
        rewardTokens.push(token);
        _rewardData[token].lastUpdate = uint64(block.timestamp);
        _participationRewardData[token].lastUpdate = uint64(block.timestamp);
        emit RewardTokenAdded(token);
    }

    function setNotifier(address notifier, bool allowed) external onlyOwner {
        _setNotifier(notifier, allowed);
    }

    function setNotifiers(address[] calldata notifiers, bool allowed) external onlyOwner {
        uint256 length = notifiers.length;
        for (uint256 i; i < length;) {
            _setNotifier(notifiers[i], allowed);
            unchecked { ++i; }
        }
    }

    function _setNotifier(address notifier, bool allowed) internal {
        if (notifier == address(0)) revert ZeroAddress();
        isNotifier[notifier] = allowed;
        emit NotifierSet(notifier, allowed);
    }


    function rewardTokenCount() external view returns (uint256) {
        return rewardTokens.length;
    }

    function streamCount(address token) external view returns (uint256) {
        return _rewardData[token].streams.length;
    }

    function getStream(address token, uint256 index) external view returns (Stream memory) {
        return _rewardData[token].streams[index];
    }

    function getParticipationStream(address token, uint256 index) external view returns (Stream memory) {
        return _participationRewardData[token].streams[index];
    }

    function pendingReward(address token) external view returns (uint256) {
        return _rewardData[token].pendingRewards;
    }

    function pendingParticipationReward(address token) external view returns (uint256) {
        return _participationRewardData[token].pendingRewards;
    }

    function governanceStakerCount() external view returns (uint256) {
        return _governanceStakers.length;
    }

    function governanceStakerAt(uint256 index) external view returns (address) {
        return _governanceStakers[index];
    }

    function rewardEligibleSupplyAt(uint256 timepoint) external view returns (uint256) {
        return _rewardEligibleSupplyCheckpoints.upperLookup(SafeCast.toUint48(timepoint));
    }

    function participationStreamCount(address token) external view returns (uint256) {
        return _participationRewardData[token].streams.length;
    }

    function participationMultiplierBps(address account) public view returns (uint256 multiplier) {
        (, uint256 directHits, uint256 delegatedHits,) = participationStats(account);
        uint256 directCount = directHits > PARTICIPATION_THRESHOLD ? PARTICIPATION_THRESHOLD : directHits;
        uint256 delegatedCount =
            delegatedHits > PARTICIPATION_THRESHOLD ? PARTICIPATION_THRESHOLD : delegatedHits;

        // A direct vote carries two participation points and a delegated vote carries one.
        // Combining the points before Math.mulDiv keeps mixed histories smooth and avoids
        // the one-basis-point rounding loss produced by separately rounded contributions.
        uint256 weightedParticipationPoints = directCount * 2 + delegatedCount;
        uint256 maxParticipationPoints = PARTICIPATION_THRESHOLD * 2;
        if (weightedParticipationPoints > maxParticipationPoints) {
            weightedParticipationPoints = maxParticipationPoints;
        }

        multiplier = BASE_PARTICIPATION_MULTIPLIER_BPS;
        multiplier += Math.mulDiv(
            weightedParticipationPoints,
            DIRECT_PARTICIPATION_MULTIPLIER_BPS - BASE_PARTICIPATION_MULTIPLIER_BPS,
            maxParticipationPoints
        );

        multiplier += communityBonusBps[account];
        if (multiplier > MAX_PARTICIPATION_MULTIPLIER_BPS) {
            multiplier = MAX_PARTICIPATION_MULTIPLIER_BPS;
        }
    }

    function participationWeight(address account) public view returns (uint256) {
        return participationWorkingWeight[account];
    }

    function previewParticipationWeight(address account) public view returns (uint256) {
        return _weightForBalance(account, balanceOf(account));
    }

    function participationStats(address account)
        public
        view
        returns (uint256 count, uint256 directHits, uint256 delegatedHits, uint256 misses)
    {
        count = participationHistoryCount[account];
        for (uint256 i; i < count; ++i) {
            uint8 status = _participationHistory[account][i].status;
            if (status == PARTICIPATION_DIRECT) ++directHits;
            else if (status == PARTICIPATION_DELEGATED) ++delegatedHits;
            else ++misses;
        }
    }

    function participationRecord(address account, uint256 index)
        external
        view
        returns (uint64 endDate, uint8 status)
    {
        if (index >= participationHistoryCount[account]) return (0, 0);
        ParticipationRecord memory record = _participationHistory[account][index];
        return (record.endDate, record.status);
    }

    function balanceAt(address account, uint256 timepoint) public view returns (uint256) {
        return _balanceCheckpoints[account].upperLookup(SafeCast.toUint48(timepoint));
    }

    function delegateAt(address account, uint256 timepoint) public view returns (address) {
        return address(_delegateCheckpoints[account].upperLookup(SafeCast.toUint96(timepoint)));
    }

    function setAragonVotingPlugin(address plugin) external onlyOwner {
        if (plugin == address(0)) revert ZeroAddress();
        if (registeredProposalCount != 0 && plugin != address(aragonVotingPlugin)) {
            revert PluginChangeAfterRegistration();
        }
        aragonVotingPlugin = IAragonTokenVotingV17(plugin);
        emit AragonVotingPluginSet(plugin);
    }

    function setProposalRegistrar(address registrar, bool allowed) external onlyOwner {
        if (registrar == address(0)) revert ZeroAddress();
        isProposalRegistrar[registrar] = allowed;
        emit ProposalRegistrarSet(registrar, allowed);
    }

    function canonicalProposalCount() external view returns (uint256) {
        return registeredProposalCount;
    }

    function canonicalProposalWindowCount() external view returns (uint256) {
        return canonicalProposals.length;
    }

    function participationHistoryCurrent(address account) public view returns (bool) {
        return processedProposalCount[account] == registeredProposalCount;
    }

    function participationStreamActive() public view returns (bool) {
        for (uint256 i; i < rewardTokens.length; ++i) {
            RewardData storage data = _participationRewardData[rewardTokens[i]];
            for (uint256 j = data.streamHead; j < data.streams.length; ++j) {
                if (data.streams[j].end > block.timestamp) return true;
            }
        }
        return false;
    }

    /// @notice Appends the next event-ordered batch of finalized Aragon proposals.
    /// @dev The authorized keeper indexes ProposalCreated receipt logs from the configured TokenVoting plugin,
    ///      sorts them by block/transaction/log position, and submits the contiguous suffix beginning at
    ///      `expectedStartIndex`. Only the latest fifteen proposal records are retained on-chain.
    function registerFinalizedProposals(uint256 expectedStartIndex, uint256[] calldata proposalIds)
        external
        nonReentrant
    {
        if (!isProposalRegistrar[msg.sender]) revert NotProposalRegistrar();
        _registerFinalizedProposals(expectedStartIndex, proposalIds);
    }

    /// @notice Relays a registrar-authorized proposal batch, allowing the frontend to synchronize proposal data.
    function registerFinalizedProposalsWithSignature(
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (address signer) {
        signer = _registerFinalizedProposalsWithSignature(
            expectedStartIndex, proposalIds, deadline, signature
        );
    }

    /// @notice Returns the EIP-712 digest a proposal registrar signs for frontend relay.
    function proposalSyncDigest(
        address caller,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline
    ) external view returns (bytes32) {
        return _proposalSyncDigest(caller, expectedStartIndex, proposalIds, deadline);
    }

    function _registerFinalizedProposalsWithSignature(
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline,
        bytes calldata signature
    ) internal returns (address signer) {
        if (block.timestamp > deadline) revert ProposalSyncExpired();
        signer = ECDSA.recover(
            _proposalSyncDigest(msg.sender, expectedStartIndex, proposalIds, deadline), signature
        );
        if (!isProposalRegistrar[signer]) revert InvalidProposalSyncSigner();
        _registerFinalizedProposals(expectedStartIndex, proposalIds);
        emit ProposalSyncRelayed(msg.sender, signer, expectedStartIndex, proposalIds.length);
    }

    function _proposalSyncDigest(
        address caller,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 proposalIdsHash = keccak256(abi.encode(proposalIds));
        bytes32 structHash = keccak256(
            abi.encode(PROPOSAL_SYNC_TYPEHASH, caller, expectedStartIndex, proposalIdsHash, deadline)
        );
        return _hashTypedDataV4(structHash);
    }

    function _registerFinalizedProposals(
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds
    ) internal {
        if (address(aragonVotingPlugin) == address(0)) revert AragonVotingPluginNotSet();
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
                IAragonTokenVotingV17.ProposalParameters memory parameters,
                ,
                ,
                ,

            ) = aragonVotingPlugin.getProposal(proposalId);
            if (parameters.endDate == 0 || parameters.snapshotTimepoint == 0) revert InvalidProposal();
            if (open || block.timestamp < parameters.endDate) revert ProposalStillOpen();
            if (parameters.snapshotTimepoint < previousSnapshot) revert NonCanonicalProposalOrder();

            CanonicalProposal memory proposal =
                CanonicalProposal(proposalId, parameters.endDate, parameters.snapshotTimepoint);
            if (canonicalProposals.length < PARTICIPATION_WINDOW) {
                canonicalProposals.push(proposal);
            } else {
                for (uint256 j; j + 1 < PARTICIPATION_WINDOW; ++j) {
                    canonicalProposals[j] = canonicalProposals[j + 1];
                }
                canonicalProposals[PARTICIPATION_WINDOW - 1] = proposal;
            }

            emit CanonicalProposalRegistered(
                currentCount + i, proposalId, parameters.snapshotTimepoint, parameters.endDate
            );
            previousSnapshot = parameters.snapshotTimepoint;
        }

        registeredProposalCount = currentCount + proposalIds.length;
        lastRegisteredSnapshotTimepoint = previousSnapshot;
    }

    function _proposalInCurrentWindow(uint256 proposalId) internal view returns (bool) {
        for (uint256 i; i < canonicalProposals.length; ++i) {
            if (canonicalProposals[i].proposalId == proposalId) return true;
        }
        return false;
    }

    /// @notice Permissionlessly checkpoints and refreshes one account, equivalent to a Curve gauge kick.
    /// @dev Reward accrual is settled at the old cached weight before the latest decisive proposal window is evaluated.
    function kick(address account) external nonReentrant returns (uint256 evaluatedProposals) {
        return _kick(account);
    }

    /// @notice Registers a signed frontend proposal batch and refreshes one account atomically.
    function kickWithProposalSync(
        address account,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (uint256 evaluatedProposals) {
        _registerFinalizedProposalsWithSignature(expectedStartIndex, proposalIds, deadline, signature);
        return _kick(account);
    }

    function _kick(address account) internal returns (uint256 evaluatedProposals) {
        if (account == address(0)) revert ZeroAddress();
        _checkpointAllRewards(account);
        evaluatedProposals = _refreshParticipationHistory(account);
        _setParticipationWorkingWeight(account);
        _startDeferredStreams();
        emit ParticipationAccountKicked(msg.sender, account, evaluatedProposals);
    }

    function setCommunityBonusBps(address account, uint256 bonusBps) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (bonusBps > MAX_COMMUNITY_BONUS_BPS) revert CommunityBonusTooHigh();
        _checkpointAllRewards(account);
        _refreshParticipationHistory(account);
        uint256 oldBonus = communityBonusBps[account];
        communityBonusBps[account] = bonusBps;
        _setParticipationWorkingWeight(account);
        _startDeferredStreams();
        emit CommunityBonusSet(account, oldBonus, bonusBps);
    }

    function stake(uint256 amount) external nonReentrant returns (uint256 votingTokensMinted) {
        return _stakeFor(msg.sender, msg.sender, amount);
    }

    function stakeFor(address recipient, uint256 amount) public nonReentrant returns (uint256 votingTokensMinted) {
        return _stakeFor(msg.sender, recipient, amount);
    }

    function stakeWithProposalSync(
        uint256 amount,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (uint256 votingTokensMinted) {
        _registerFinalizedProposalsWithSignature(expectedStartIndex, proposalIds, deadline, signature);
        return _stakeFor(msg.sender, msg.sender, amount);
    }

    function stakeForWithProposalSync(
        address recipient,
        uint256 amount,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (uint256 votingTokensMinted) {
        _registerFinalizedProposalsWithSignature(expectedStartIndex, proposalIds, deadline, signature);
        return _stakeFor(msg.sender, recipient, amount);
    }

    function _stakeFor(address caller, address recipient, uint256 amount)
        internal
        returns (uint256 votingTokensMinted)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        _checkpointAllRewards(recipient);
        _refreshParticipationHistory(recipient);
        GOVERNANCE_TOKEN.safeTransferFrom(caller, address(this), amount);
        _mint(recipient, amount);
        if (delegates(recipient) == address(0)) {
            _delegate(recipient, recipient);
        }
        _setParticipationWorkingWeight(recipient);
        _startDeferredStreams();
        emit Staked(caller, recipient, amount);
        return amount;
    }

    function requestWithdrawal(uint256 amount, address receiver) external nonReentrant returns (uint256 id) {
        return _requestWithdrawal(msg.sender, amount, receiver);
    }

    function requestWithdrawalWithProposalSync(
        uint256 amount,
        address receiver,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (uint256 id) {
        _registerFinalizedProposalsWithSignature(expectedStartIndex, proposalIds, deadline, signature);
        return _requestWithdrawal(msg.sender, amount, receiver);
    }

    function _requestWithdrawal(address account, uint256 amount, address receiver)
        internal
        returns (uint256 id)
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (balanceOf(account) < amount) revert InsufficientStake();

        _checkpointAllRewards(account);
        _refreshParticipationHistory(account);
        _burn(account, amount);
        _setParticipationWorkingWeight(account);
        _startDeferredStreams();

        uint256 tax = Math.mulDiv(amount, withdrawTaxBps, BPS);
        uint256 holdTime = withdrawHoldTime;
        if (holdTime == 0) {
            if (tax != 0) GOVERNANCE_TOKEN.safeTransfer(treasuryReceiver, tax);
            GOVERNANCE_TOKEN.safeTransfer(receiver, amount - tax);
            emit WithdrawalCompleted(0, account, receiver, amount - tax, tax);
            return 0;
        }

        if (amount > type(uint128).max || tax > type(uint128).max) revert ValueTooLarge();
        id = nextWithdrawalId++;
        uint64 unlockTime = uint64(block.timestamp + holdTime);
        withdrawalRequests[id] = WithdrawalRequest(
            account,
            receiver,
            uint128(amount),
            uint128(tax),
            unlockTime,
            false
        );
        emit WithdrawalRequested(id, account, receiver, amount, tax, unlockTime);
    }

    function completeWithdrawal(uint256 id) external nonReentrant returns (uint256 netAmount) {
        WithdrawalRequest storage request = withdrawalRequests[id];
        if (request.owner == address(0) || request.completed) revert InvalidWithdrawalRequest();
        if (block.timestamp < request.unlockTime) revert WithdrawalNotReady();

        request.completed = true;
        uint256 tax = request.tax;
        netAmount = uint256(request.amount) - tax;
        if (tax != 0) GOVERNANCE_TOKEN.safeTransfer(treasuryReceiver, tax);
        GOVERNANCE_TOKEN.safeTransfer(request.receiver, netAmount);
        emit WithdrawalCompleted(id, request.owner, request.receiver, netAmount, tax);
    }

    /// @notice Starts an ordinary fourteen-day stream allocated continuously by current eligible stake.
    function notifyReward(address token, uint256 amount) external nonReentrant {
        if (msg.sender != owner() && !isNotifier[msg.sender]) revert NotNotifier();
        if (!isRewardToken[token]) revert UnsupportedRewardToken();
        if (amount == 0) revert ZeroAmount();

        _checkpointReward(token);
        RewardData storage data = _rewardData[token];
        uint256 supply = totalRewardEligibleSupply;
        if (supply != 0 && data.streams.length - uint256(data.streamHead) >= MAX_ACTIVE_STREAMS_PER_TOKEN) {
            revert ActiveStreamLimit();
        }

        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert NonExactRewardTransfer(amount, received);

        uint256 endTime = _queueOrStartStream(data, token, amount, supply, false);
        emit RewardNotified(token, amount, endTime);
    }

    /// @notice Starts a participation-weighted fourteen-day stream using the current cached working weights.
    function notifyParticipationReward(address token, uint256 amount) external nonReentrant {
        if (msg.sender != owner() && !isNotifier[msg.sender]) revert NotNotifier();
        if (!isRewardToken[token]) revert UnsupportedRewardToken();
        if (amount == 0) revert ZeroAmount();

        _checkpointParticipationReward(token);
        RewardData storage data = _participationRewardData[token];
        uint256 supply = totalParticipationWeight;
        if (supply != 0 && data.streams.length - uint256(data.streamHead) >= MAX_ACTIVE_STREAMS_PER_TOKEN) {
            revert ActiveStreamLimit();
        }

        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert NonExactRewardTransfer(amount, received);

        uint256 endTime = _queueOrStartStream(data, token, amount, supply, true);
        emit ParticipationRewardNotified(token, amount, endTime);
    }

    function claimRewards(address receiver) external nonReentrant {
        _claimRewards(msg.sender, receiver);
    }

    function claimRewardsWithProposalSync(
        address receiver,
        uint256 expectedStartIndex,
        uint256[] calldata proposalIds,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        _registerFinalizedProposalsWithSignature(expectedStartIndex, proposalIds, deadline, signature);
        _claimRewards(msg.sender, receiver);
    }

    function _claimRewards(address account, address receiver) internal {
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointAllRewards(account);
        _refreshParticipationHistory(account);
        _setParticipationWorkingWeight(account);
        _startDeferredStreams();

        for (uint256 i; i < rewardTokens.length; ++i) {
            address token = rewardTokens[i];
            uint256 amount = accruedRewards[account][token] + accruedParticipationRewards[account][token];
            if (amount == 0) continue;
            accruedRewards[account][token] = 0;
            accruedParticipationRewards[account][token] = 0;
            IERC20(token).safeTransfer(receiver, amount);
            emit RewardClaimed(account, token, receiver, amount);
        }
    }

    function earned(address user, address token) external view returns (uint256 amount) {
        if (!isRewardToken[token]) return 0;

        uint256 ordinaryRewardPerToken = _previewReward(token);
        amount = accruedRewards[user][token]
            + Math.mulDiv(
                _rewardEligibleBalance(user),
                ordinaryRewardPerToken - userRewardPerTokenPaid[user][token],
                PRECISION
            );

        uint256 participationRewardPerWeight = _previewParticipationReward(token);
        amount += accruedParticipationRewards[user][token]
            + Math.mulDiv(
                participationWeight(user),
                participationRewardPerWeight - userParticipationRewardPerWeightPaid[user][token],
                PRECISION
            );
    }

    function _checkpointRewardUser(address account, address token) internal {
        RewardData storage data = _rewardData[token];
        uint256 current = data.rewardPerTokenStored;
        uint256 paid = userRewardPerTokenPaid[account][token];
        if (current != paid) {
            accruedRewards[account][token] += Math.mulDiv(
                _rewardEligibleBalance(account), current - paid, PRECISION
            );
            userRewardPerTokenPaid[account][token] = current;
        }
    }

    function _checkpointParticipationUser(address account, address token) internal {
        RewardData storage data = _participationRewardData[token];
        uint256 current = data.rewardPerTokenStored;
        uint256 paid = userParticipationRewardPerWeightPaid[account][token];
        if (current != paid) {
            accruedParticipationRewards[account][token] += Math.mulDiv(
                participationWorkingWeight[account], current - paid, PRECISION
            );
            userParticipationRewardPerWeightPaid[account][token] = current;
        }
    }

    function _checkpointAllRewards(address account) internal {
        for (uint256 i; i < rewardTokens.length; ++i) {
            address token = rewardTokens[i];
            _checkpointReward(token);
            _checkpointParticipationReward(token);
            if (account != address(0)) {
                _checkpointRewardUser(account, token);
                _checkpointParticipationUser(account, token);
            }
        }
    }

    function _checkpointReward(address token) internal {
        _checkpointRewardData(_rewardData[token], token, totalRewardEligibleSupply, false);
    }

    function _checkpointParticipationReward(address token) internal {
        _checkpointRewardData(_participationRewardData[token], token, totalParticipationWeight, true);
    }

    function _checkpointRewardData(
        RewardData storage data,
        address token,
        uint256 supply,
        bool participationReward
    ) internal {
        uint256 from = data.lastUpdate;
        uint256 to = block.timestamp;
        if (from == 0) {
            data.lastUpdate = uint64(to);
            return;
        }
        if (to == from) return;

        uint256 gross = _streamedBetween(data, from, to);
        if (gross != 0) {
            if (supply == 0) {
                data.pendingRewards += gross;
                emit RewardDeferred(token, gross, participationReward);
            } else {
                uint256 scaled = gross * PRECISION + data.scaledRemainder;
                data.rewardPerTokenStored += scaled / supply;
                data.scaledRemainder = scaled % supply;
            }
        }
        data.lastUpdate = uint64(to);

        uint256 head = data.streamHead;
        while (head < data.streams.length && data.streams[head].end <= to) ++head;
        data.streamHead = uint64(head);
    }

    function _previewReward(address token) internal view returns (uint256) {
        return _previewRewardData(_rewardData[token], totalRewardEligibleSupply);
    }

    function _previewParticipationReward(address token) internal view returns (uint256) {
        return _previewRewardData(_participationRewardData[token], totalParticipationWeight);
    }

    function _previewRewardData(RewardData storage data, uint256 supply)
        internal
        view
        returns (uint256 rewardPerToken)
    {
        rewardPerToken = data.rewardPerTokenStored;
        if (data.lastUpdate == 0 || data.lastUpdate == block.timestamp || supply == 0) {
            return rewardPerToken;
        }
        uint256 gross = _streamedBetween(data, data.lastUpdate, block.timestamp);
        if (gross == 0) return rewardPerToken;
        return rewardPerToken + (gross * PRECISION + data.scaledRemainder) / supply;
    }

    function _streamedBetween(RewardData storage data, uint256 from, uint256 to)
        internal
        view
        returns (uint256 gross)
    {
        for (uint256 i = data.streamHead; i < data.streams.length; ++i) {
            Stream storage stream = data.streams[i];
            if (stream.start >= to) break;
            gross += _vested(stream.amount, stream.start, stream.end, to)
                - _vested(stream.amount, stream.start, stream.end, from);
        }
    }

    function _queueOrStartStream(
        RewardData storage data,
        address token,
        uint256 amount,
        uint256 supply,
        bool participationReward
    ) internal returns (uint256 endTime) {
        if (supply == 0) {
            data.pendingRewards += amount;
            emit RewardDeferred(token, amount, participationReward);
            return 0;
        }

        uint64 start = uint64(block.timestamp);
        uint64 end = uint64(block.timestamp + STREAM_DURATION);
        data.streams.push(Stream(amount, start, end));
        return end;
    }

    function _startDeferredStreams() internal {
        for (uint256 i; i < rewardTokens.length; ++i) {
            address token = rewardTokens[i];
            _startDeferredStream(_rewardData[token], token, totalRewardEligibleSupply, false);
            _startDeferredStream(
                _participationRewardData[token], token, totalParticipationWeight, true
            );
        }
    }

    function _startDeferredStream(
        RewardData storage data,
        address token,
        uint256 supply,
        bool participationReward
    ) internal {
        uint256 amount = data.pendingRewards;
        if (amount == 0 || supply == 0) return;
        if (data.streams.length - uint256(data.streamHead) >= MAX_ACTIVE_STREAMS_PER_TOKEN) return;

        data.pendingRewards = 0;
        uint64 start = uint64(block.timestamp);
        uint64 end = uint64(block.timestamp + STREAM_DURATION);
        data.streams.push(Stream(amount, start, end));
        if (participationReward) {
            emit ParticipationRewardNotified(token, amount, end);
        } else {
            emit RewardNotified(token, amount, end);
        }
    }

    function _rewardEligibleBalance(address account) internal view returns (uint256 balance) {
        balance = balanceOf(account);
        if (balance < MIN_REWARD_ELIGIBLE_BALANCE) return 0;
    }

    function _processCanonicalProposal(uint256 globalIndex, address account) internal {
        CanonicalProposal memory proposal = canonicalProposals[globalIndex];
        uint256 accountBalance = balanceAt(account, proposal.snapshotTimepoint);
        if (accountBalance == 0) {
            emit ProposalParticipationRecorded(
                proposal.proposalId,
                account,
                0,
                address(0),
                participationMultiplierBps(account)
            );
            return;
        }

        // Historical delegation is evaluated at this proposal's snapshot. A later switch between
        // self-delegation and third-party delegation cannot rewrite or clear this proposal record.
        address votingDelegate = delegateAt(account, proposal.snapshotTimepoint);
        uint8 status = PARTICIPATION_MISSED;
        if (votingDelegate == account) {
            if (
                aragonVotingPlugin.getVoteOption(proposal.proposalId, account)
                    != IAragonTokenVotingV17.VoteOption.None
            ) {
                status = PARTICIPATION_DIRECT;
            }
        } else if (votingDelegate != address(0)) {
            if (
                aragonVotingPlugin.getVoteOption(proposal.proposalId, votingDelegate)
                    != IAragonTokenVotingV17.VoteOption.None
            ) {
                status = PARTICIPATION_DELEGATED;
            }
        }

        _appendParticipationRecord(account, proposal.endDate, status);
        emit ProposalParticipationRecorded(
            proposal.proposalId, account, status, votingDelegate, participationMultiplierBps(account)
        );
    }

    function _appendParticipationRecord(address account, uint64 endDate, uint8 status) internal {
        ParticipationRecord[15] storage records = _participationHistory[account];
        uint256 count = participationHistoryCount[account];
        ParticipationRecord memory newRecord = ParticipationRecord(endDate, status);

        if (count < PARTICIPATION_WINDOW) {
            records[count] = newRecord;
            participationHistoryCount[account] = uint8(count + 1);
            return;
        }

        for (uint256 i; i + 1 < PARTICIPATION_WINDOW; ++i) {
            records[i] = records[i + 1];
        }
        records[PARTICIPATION_WINDOW - 1] = newRecord;
    }

    function _refreshParticipationHistory(address account)
        internal
        returns (uint256 evaluatedProposals)
    {
        uint256 totalRegistered = registeredProposalCount;
        if (processedProposalCount[account] == totalRegistered) return 0;

        participationHistoryCount[account] = 0;
        for (uint256 i; i < canonicalProposals.length; ++i) {
            _processCanonicalProposal(i, account);
            unchecked {
                ++evaluatedProposals;
            }
        }
        processedProposalCount[account] = totalRegistered;
    }

    function _setParticipationWorkingWeight(address account) internal {
        uint256 oldWeight = participationWorkingWeight[account];
        uint256 newWeight = _weightForBalance(account, balanceOf(account));
        if (oldWeight == newWeight) return;
        participationWorkingWeight[account] = newWeight;
        totalParticipationWeight = totalParticipationWeight - oldWeight + newWeight;
        emit ParticipationWorkingWeightUpdated(
            account, oldWeight, newWeight, totalParticipationWeight
        );
    }

    function _weightForBalance(address account, uint256 balance) internal view returns (uint256) {
        return Math.mulDiv(balance, participationMultiplierBps(account), BPS);
    }

    function _vested(uint256 amount, uint256 start, uint256 end, uint256 timestamp)
        internal
        pure
        returns (uint256)
    {
        if (timestamp <= start) return 0;
        if (timestamp >= end) return amount;
        return Math.mulDiv(amount, timestamp - start, end - start);
    }

    function _delegate(address account, address delegatee) internal override {
        super._delegate(account, delegatee);
        _delegateCheckpoints[account].push(uint96(clock()), uint160(delegatee));
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert NonTransferable();
        uint256 oldFromBalance = from == address(0) ? 0 : balanceOf(from);
        uint256 oldToBalance = to == address(0) ? 0 : balanceOf(to);

        super._update(from, to, value);
        uint48 timepoint = clock();

        if (from != address(0)) {
            uint256 newFromBalance = balanceOf(from);
            _balanceCheckpoints[from].push(timepoint, SafeCast.toUint208(newFromBalance));
            if (oldFromBalance != 0 && newFromBalance == 0) {
                unchecked {
                    --activeStakerCount;
                }
            }
        }

        if (to != address(0)) {
            uint256 newToBalance = balanceOf(to);
            _balanceCheckpoints[to].push(timepoint, SafeCast.toUint208(newToBalance));
            if (oldToBalance == 0 && newToBalance != 0) {
                unchecked {
                    ++activeStakerCount;
                }
                if (!hasEverStaked[to]) {
                    hasEverStaked[to] = true;
                    _governanceStakers.push(to);
                    processedProposalCount[to] = registeredProposalCount;
                }
            }
        }

        _updateRewardEligibleSupply(from, to, oldFromBalance, oldToBalance, timepoint);
    }

    function _updateRewardEligibleSupply(
        address from,
        address to,
        uint256 oldFromBalance,
        uint256 oldToBalance,
        uint48 timepoint
    ) internal {
        uint256 oldSupply = totalRewardEligibleSupply;
        if (from != address(0)) {
            uint256 oldEligible = oldFromBalance >= MIN_REWARD_ELIGIBLE_BALANCE ? oldFromBalance : 0;
            uint256 newBalance = balanceOf(from);
            uint256 newEligible = newBalance >= MIN_REWARD_ELIGIBLE_BALANCE ? newBalance : 0;
            totalRewardEligibleSupply = totalRewardEligibleSupply - oldEligible + newEligible;
        }
        if (to != address(0)) {
            uint256 oldEligible = oldToBalance >= MIN_REWARD_ELIGIBLE_BALANCE ? oldToBalance : 0;
            uint256 newBalance = balanceOf(to);
            uint256 newEligible = newBalance >= MIN_REWARD_ELIGIBLE_BALANCE ? newBalance : 0;
            totalRewardEligibleSupply = totalRewardEligibleSupply - oldEligible + newEligible;
        }
        if (totalRewardEligibleSupply != oldSupply) {
            _rewardEligibleSupplyCheckpoints.push(timepoint, SafeCast.toUint208(totalRewardEligibleSupply));
        }
    }
}
