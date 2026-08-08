// SPDX-License-Identifier: UNLICENSED
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
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBoostHub} from "./interfaces/IBoostHub.sol";
import {IStakeDaoGauge} from "./interfaces/IStakeDaoGauge.sol";
import {ISnapshotDelegateRegistry} from "./interfaces/ISnapshotDelegateRegistry.sol";
import {IvlBoost} from "./interfaces/IvlBoost.sol";
import {BoostHubErrors as Errors} from "./libraries/BoostHubErrors.sol";

interface IStakeDaoClaimExecutor {
    function execute(bytes[] calldata calls) external;
}

contract BoostHub is IBoostHub, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant ACC_PRECISION = 1e18;
    uint256 internal constant MAX_REWARD_TOKENS = 8;
    uint256 internal constant FEE_DENOMINATOR = 10_000;
    uint256 internal constant MAX_TOTAL_FEE_BPS = 2_500;
    uint256 internal constant MAX_RETENTION_FEE_BPS = 1_000;
    uint256 public constant CONFIG_CHANGE_DELAY = 10 days;
    bytes4 internal constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID = 0xffffffff;
    bytes32 internal constant SNAPSHOT_DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version)");
    bytes32 internal constant SNAPSHOT_NAME_HASH = keccak256("snapshot");
    bytes32 internal constant SNAPSHOT_VERSION_HASH = keccak256("0.1.4");
    bytes32 internal constant SNAPSHOT_VOTE_UINT32_TYPEHASH =
        keccak256("Vote(string from,string space,uint64 timestamp,string proposal,uint32 choice,string reason,string app,string metadata)");
    bytes32 internal constant SNAPSHOT_VOTE_STRING_TYPEHASH =
        keccak256("Vote(string from,string space,uint64 timestamp,string proposal,string choice,string reason,string app,string metadata)");
    bytes32 internal constant SNAPSHOT_VOTE_UINT32_ARRAY_TYPEHASH =
        keccak256("Vote(string from,string space,uint64 timestamp,string proposal,uint32[] choice,string reason,string app,string metadata)");
    bytes32 internal constant SNAPSHOT_VOTE_FORMAT_UINT32 = keccak256("SNAPSHOT_VOTE_UINT32");
    bytes32 internal constant SNAPSHOT_VOTE_FORMAT_STRING = keccak256("SNAPSHOT_VOTE_STRING");
    bytes32 internal constant SNAPSHOT_VOTE_FORMAT_UINT32_ARRAY = keccak256("SNAPSHOT_VOTE_UINT32_ARRAY");


    struct Pool {
        address asset;
        address gauge;
        bool active;
        uint256 totalStaked;
        address[] rewardTokens;
    }

    struct Position {
        uint256 principal;
        mapping(address => uint256) rewardDebt;
        mapping(address => uint256) claimable;
    }

    struct FeeConfig {
        uint16 platformFeeBps;
        uint16 vlSdtReserveFeeBps;
        address platformFeeRecipient;
        address vlSdtReserveRecipient;
    }

    struct PendingFeeConfig {
        FeeConfig config;
        uint256 readyAt;
        bool exists;
    }

    struct PendingRetentionFeeConfig {
        uint16 retentionFeeBps;
        uint256 readyAt;
        bool exists;
    }

    struct PendingYieldBoostingTokenWithdrawal {
        uint256 amount;
        address receiver;
        uint256 readyAt;
        bool exists;
    }

    struct PendingSnapshotSpace {
        uint256 readyAt;
        bool exists;
    }

    struct PendingSnapshotVoteFormat {
        uint256 readyAt;
        bool exists;
    }

    Pool[] internal pools;
    address public vlBoost;
    address public stakeDaoClaimExecutor;
    address public pendingStakeDaoClaimExecutor;
    uint256 public pendingStakeDaoClaimExecutorReadyAt;
    bool public arbitraryCallsLocked;
    uint256 public ownershipTransferReadyAt;
    bool public ownershipTransferDelayInitialized;
    bool public stakeDaoClaimExecutorDelayInitialized;
    bool public snapshotVotingEnabled = true;
    bool public snapshotVoteFormatApprovalLocked;

    mapping(uint256 => FeeConfig) public poolFeeConfig;
    mapping(uint256 => PendingFeeConfig) public pendingPoolFeeConfig;
    mapping(uint256 => bool) public poolFeeConfigSet;
    mapping(uint256 => bool) public poolFeeConfigDelayInitialized;
    mapping(uint256 => uint16) public poolRetentionFeeBps;
    mapping(uint256 => PendingRetentionFeeConfig) public pendingPoolRetentionFeeConfig;
    mapping(uint256 => bool) public poolRetentionFeeDelayInitialized;
    mapping(uint256 => uint256) public retainedStakingToken;
    mapping(uint256 => PendingYieldBoostingTokenWithdrawal) public pendingYieldBoostingTokenWithdrawal;
    mapping(uint256 => bool) public yieldBoostingTokenWithdrawalDelayInitialized;
    mapping(uint256 => bytes4) public poolCheckpointSelector;
    mapping(uint256 => address) public poolDepositor;
    mapping(uint256 => bool) public poolDepositorLocked;
    mapping(address => bool) public gaugeAdded;
    mapping(uint256 => mapping(address => Position)) internal positions;
    mapping(uint256 => mapping(address => uint256)) public accRewardPerShare;
    mapping(bytes32 => bool) public lockedArbitraryCall;
    mapping(bytes32 => bool) public approvedSnapshotVoteHash;
    mapping(bytes32 => bool) public approvedSnapshotSpace;
    mapping(bytes32 => PendingSnapshotSpace) public pendingSnapshotSpace;
    mapping(bytes32 => bool) public approvedSnapshotVoteFormat;
    mapping(bytes32 => PendingSnapshotVoteFormat) public pendingSnapshotVoteFormat;
    mapping(address => bool) private voters;

    event PoolAdded(uint256 indexed pid, address indexed asset, address indexed gauge);
    event PoolActiveSet(uint256 indexed pid, bool active);
    event PoolDepositorSet(uint256 indexed pid, address indexed depositor);
    event PoolDepositorLocked(uint256 indexed pid, address indexed depositor);
    event PoolFeesSet(
        uint256 indexed pid,
        uint16 platformFeeBps,
        uint16 vlSdtReserveFeeBps,
        address platformFeeRecipient,
        address vlSdtReserveRecipient
    );
    event PoolFeesQueued(
        uint256 indexed pid,
        uint16 platformFeeBps,
        uint16 vlSdtReserveFeeBps,
        address platformFeeRecipient,
        address vlSdtReserveRecipient,
        uint256 readyAt
    );
    event PoolCheckpointSelectorSet(uint256 indexed pid, bytes4 selector);
    event PoolRewardTokenAdded(uint256 indexed pid, address indexed rewardToken);
    event PoolRetentionFeeSet(uint256 indexed pid, uint16 retentionFeeBps);
    event PoolRetentionFeeQueued(uint256 indexed pid, uint16 retentionFeeBps, uint256 readyAt);
    event YieldBoostingTokensDonated(uint256 indexed pid, address indexed donor, uint256 amount);
    event YieldBoostingTokensRetained(uint256 indexed pid, uint256 amount);
    event YieldBoostingTokensWithdrawn(uint256 indexed pid, address indexed receiver, uint256 amount);
    event YieldBoostingTokenWithdrawalQueued(uint256 indexed pid, address indexed receiver, uint256 amount, uint256 readyAt);
    event GaugeCheckpointed(uint256 indexed pid);
    event BoostCheckpointed(address indexed account);
    event StakeDaoAddressesSet(address indexed vlBoost);
    event StakeDaoClaimExecutorSet(address indexed executor);
    event StakeDaoClaimExecutorQueued(address indexed executor, uint256 readyAt);
    event StakeDaoAggregateClaimed(uint256 indexed pid, address indexed executor);
    event VotingPowerDelegated(address indexed registry, bytes32 indexed spaceId, string space, address indexed delegate);
    event VotingPowerDelegateCleared(address indexed registry, bytes32 indexed spaceId, string space);
    event SnapshotVoteHashApproved(bytes32 indexed hash, bytes32 indexed spaceId);
    event SnapshotVoteHashRevoked(bytes32 indexed hash);
    event SnapshotVotingEnabledSet(bool enabled);
    event SnapshotSpaceApproved(bytes32 indexed spaceId, string space);
    event SnapshotSpaceQueued(bytes32 indexed spaceId, string space, uint256 readyAt);
    event SnapshotSpaceRemoved(bytes32 indexed spaceId, string space);
    event SnapshotVoteFormatApproved(bytes32 indexed formatId, string label);
    event SnapshotVoteFormatQueued(bytes32 indexed formatId, string label, uint256 readyAt);
    event SnapshotVoteFormatRemoved(bytes32 indexed formatId, string label);
    event SnapshotVoteFormatApprovalLocked();
    event VoterSet(address indexed voter, bool approved);

    error TimelockNotReady();
    error NoPendingChange();
    error NotVoter();
    error SnapshotSpaceNotApproved();
    error SnapshotVoteFormatNotApproved();
    error SnapshotVoteFormatApprovalPermanentlyLocked();
    error InvalidSnapshotVoteFormat();
    error ZeroSnapshotVoteHash();

    modifier onlyVoter() {
        if (!isValidVoter(msg.sender)) revert NotVoter();
        _;
    }

    constructor(address owner_) Ownable(owner_) {
        _approveSnapshotSpace("sdcrv.eth");
        _approveSnapshotSpace("sdcrv-gov.eth");
        _approveSnapshotSpace("sd-yieldbasis.eth");
        _approveSnapshotSpace("sdfxn.eth");
        _approveSnapshotSpace("sdfxs.eth");
        _approveSnapshotSpace("stakedao.eth");
        _approveSnapshotSpace("crvbonds.eth");
        _approveSnapshotVoteFormat(SNAPSHOT_VOTE_FORMAT_UINT32, "Snapshot Vote uint32 choice");
        _approveSnapshotVoteFormat(SNAPSHOT_VOTE_FORMAT_STRING, "Snapshot Vote string choice");
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        super.transferOwnership(newOwner);
        if (!ownershipTransferDelayInitialized) {
            ownershipTransferDelayInitialized = true;
            ownershipTransferReadyAt = 0;
        } else {
            ownershipTransferReadyAt = newOwner == address(0) ? 0 : block.timestamp + CONFIG_CHANGE_DELAY;
        }
    }

    function acceptOwnership() public override {
        if (block.timestamp < ownershipTransferReadyAt) revert TimelockNotReady();
        super.acceptOwnership();
        ownershipTransferReadyAt = 0;
    }

    function setVoter(address voter, bool approved) external onlyOwner {
        if (voter == address(0)) revert Errors.ZeroAddress();
        voters[voter] = approved;
        emit VoterSet(voter, approved);
    }

    function isValidVoter(address voter) public view returns (bool) {
        return voter == owner() || voters[voter];
    }

    function setSnapshotVotingEnabled(bool enabled) external onlyOwner {
        snapshotVotingEnabled = enabled;
        emit SnapshotVotingEnabledSet(enabled);
    }

    function revokeSnapshotVoteHash(bytes32 hash) external onlyOwner {
        approvedSnapshotVoteHash[hash] = false;
        emit SnapshotVoteHashRevoked(hash);
    }

    function setStakeDaoAddresses(address vlBoost_) external onlyOwner {
        if (vlBoost_ == address(0)) revert Errors.ZeroAddress();
        if (vlBoost != address(0)) revert Errors.AlreadySet();
        vlBoost = vlBoost_;
        emit StakeDaoAddressesSet(vlBoost_);
    }

    function setStakeDaoClaimExecutor(address executor) external onlyOwner {
        if (executor == address(0)) revert Errors.ZeroAddress();
        if (!stakeDaoClaimExecutorDelayInitialized) {
            stakeDaoClaimExecutorDelayInitialized = true;
            stakeDaoClaimExecutor = executor;
            emit StakeDaoClaimExecutorSet(executor);
        } else {
            pendingStakeDaoClaimExecutor = executor;
            pendingStakeDaoClaimExecutorReadyAt = block.timestamp + CONFIG_CHANGE_DELAY;
            emit StakeDaoClaimExecutorQueued(executor, pendingStakeDaoClaimExecutorReadyAt);
        }
    }

    function applyStakeDaoClaimExecutor() external {
        if (pendingStakeDaoClaimExecutor == address(0)) revert NoPendingChange();
        if (block.timestamp < pendingStakeDaoClaimExecutorReadyAt) revert TimelockNotReady();
        stakeDaoClaimExecutor = pendingStakeDaoClaimExecutor;
        delete pendingStakeDaoClaimExecutor;
        delete pendingStakeDaoClaimExecutorReadyAt;
        emit StakeDaoClaimExecutorSet(stakeDaoClaimExecutor);
    }

    function executeArbitraryCall(address target, bytes calldata data)
        external
        onlyOwner
        nonReentrant
    {
        if (target == address(0)) revert Errors.ZeroAddress();
        bytes4 selector = bytes4(0);
        if (data.length >= 4) selector = _calldataSelector(data);
        if (arbitraryCallsLocked) {
            if (!lockedArbitraryCall[keccak256(abi.encodePacked(target, selector))]) revert Errors.InvalidLockedCall();
        }
        (bool success,) = target.call(data);
        if (!success) revert Errors.InvalidLockedCall();
    }

    function lockArbitraryCalls(bytes32[] calldata callKeys) external onlyOwner {
        if (arbitraryCallsLocked) revert Errors.AlreadySet();
        for (uint256 i; i < callKeys.length; i++) {
            lockedArbitraryCall[callKeys[i]] = true;
        }
        arbitraryCallsLocked = true;
    }

    function addPoolsBatch(
        address[] calldata assets,
        address[] calldata gauges,
        address[][] calldata rewardTokens
    ) external onlyOwner returns (uint256[] memory pids) {
        uint256 length = assets.length;
        if (length != gauges.length || length != rewardTokens.length) revert Errors.LengthMismatch();
        pids = new uint256[](length);
        for (uint256 i; i < length; ++i) {
            pids[i] = _addPool(assets[i], gauges[i], rewardTokens[i]);
        }
    }

    function _addPool(address asset, address gauge, address[] calldata rewardTokens) internal returns (uint256 pid) {
        if (asset == address(0) || gauge == address(0)) revert Errors.ZeroAddress();
        if (gaugeAdded[gauge]) revert Errors.DuplicateGauge();
        if (IStakeDaoGauge(gauge).staking_token() != asset) revert Errors.InvalidGaugeAsset();
        if (rewardTokens.length > MAX_REWARD_TOKENS) revert Errors.RewardTokenLimitExceeded();

        for (uint256 i; i < rewardTokens.length; i++) {
            if (rewardTokens[i] == address(0)) revert Errors.ZeroAddress();
            for (uint256 j; j < i; j++) {
                if (rewardTokens[i] == rewardTokens[j]) revert Errors.DuplicateRewardToken();
            }
        }

        pid = pools.length;
        pools.push();
        Pool storage pool = pools[pid];
        pool.asset = asset;
        pool.gauge = gauge;
        pool.active = true;
        gaugeAdded[gauge] = true;

        for (uint256 i; i < rewardTokens.length; i++) {
            _addRewardToken(pool, pid, rewardTokens[i]);
        }

        IERC20(asset).forceApprove(gauge, type(uint256).max);

        emit PoolAdded(pid, asset, gauge);
    }

    function setPoolActive(uint256 pid, bool active) external onlyOwner {
        Pool storage pool = _pool(pid);
        pool.active = active;
        emit PoolActiveSet(pid, active);
    }

    function lockPoolDepositor(uint256 pid) external onlyOwner {
        _pool(pid);
        address depositor = poolDepositor[pid];
        if (depositor == address(0)) revert Errors.ZeroAddress();
        if (poolDepositorLocked[pid]) revert Errors.AlreadySet();
        poolDepositorLocked[pid] = true;
        emit PoolDepositorLocked(pid, depositor);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setPoolFeeConfigs(uint256[] calldata pids, FeeConfig[] calldata configs) external onlyOwner {
        if (pids.length != configs.length) revert Errors.LengthMismatch();
        for (uint256 i; i < pids.length; ++i) {
            _setPoolFees(pids[i], configs[i]);
        }
    }

    function setPoolRetentionFeeBps(uint256 pid, uint16 retentionFeeBps) external onlyOwner {
        _setPoolRetentionFeeBps(pid, retentionFeeBps);
    }

    function applyPoolRetentionFeeBps(uint256 pid) external {
        _pool(pid);
        PendingRetentionFeeConfig memory pending = pendingPoolRetentionFeeConfig[pid];
        if (!pending.exists) revert NoPendingChange();
        if (block.timestamp < pending.readyAt) revert TimelockNotReady();

        poolRetentionFeeBps[pid] = pending.retentionFeeBps;
        delete pendingPoolRetentionFeeConfig[pid];
        emit PoolRetentionFeeSet(pid, pending.retentionFeeBps);
    }

    function applyPoolFees(uint256 pid) external {
        _pool(pid);
        PendingFeeConfig memory pending = pendingPoolFeeConfig[pid];
        if (!pending.exists) revert NoPendingChange();
        if (block.timestamp < pending.readyAt) revert TimelockNotReady();

        poolFeeConfig[pid] = pending.config;
        poolFeeConfigSet[pid] = true;
        delete pendingPoolFeeConfig[pid];
        emit PoolFeesSet(
            pid,
            pending.config.platformFeeBps,
            pending.config.vlSdtReserveFeeBps,
            pending.config.platformFeeRecipient,
            pending.config.vlSdtReserveRecipient
        );
    }

    function setPoolRuntimeConfigs(
        uint256[] calldata pids,
        uint16[] calldata retentionFeeBps,
        address[] calldata depositors,
        bytes4[] calldata checkpointSelectors
    ) external onlyOwner {
        uint256 length = pids.length;
        if (length != retentionFeeBps.length || length != depositors.length || length != checkpointSelectors.length) {
            revert Errors.LengthMismatch();
        }

        for (uint256 i; i < length; ++i) {
            _setPoolRetentionFeeBps(pids[i], retentionFeeBps[i]);
            _setPoolDepositor(pids[i], depositors[i]);
            if (checkpointSelectors[i] != bytes4(0)) {
                _setPoolCheckpointSelector(pids[i], checkpointSelectors[i]);
            }
        }
    }

    function checkpointGauge(uint256 pid) external returns (bool) {
        Pool storage pool = _pool(pid);
        bytes4 selector = poolCheckpointSelector[pid];
        if (selector == bytes4(0)) revert Errors.CheckpointSelectorNotSet();
        bool success = _checkpointGauge(pool.gauge, selector);
        if (!success) revert Errors.CheckpointFailed();
        emit GaugeCheckpointed(pid);
        return success;
    }

    function checkpointBoost() external {
        if (vlBoost == address(0)) revert Errors.ZeroAddress();
        IvlBoost(vlBoost).checkpointUser(address(this));
        emit BoostCheckpointed(address(this));
    }

    function yieldBoostingTokens(uint256 pid) external view returns (address token, uint256 amount) {
        Pool storage pool = _pool(pid);
        token = pool.asset;
        amount = retainedStakingToken[pid];
    }

    function vlsdtDelegated() external view returns (uint256 amount) {
        address registry = vlBoost;
        if (registry == address(0)) return 0;
        try IvlBoost(registry).delegatedIn(address(this)) returns (uint256 delegated) {
            amount = delegated;
        } catch {
            amount = 0;
        }
    }

    function donateYieldBoostingTokens(uint256 pid, uint256 amount) external nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();
        Pool storage pool = _pool(pid);
        IERC20(pool.asset).safeTransferFrom(msg.sender, address(this), amount);
        _stakeYieldBoostingTokens(pid, pool, amount);
        emit YieldBoostingTokensDonated(pid, msg.sender, amount);
    }

    function emergencyWithdrawYieldBoostingTokens(uint256 pid, uint256 amount, address receiver)
        external
        onlyOwner
        nonReentrant
    {
        _pool(pid);
        if (amount == 0) revert Errors.ZeroAmount();
        if (receiver == address(0)) revert Errors.ZeroAddress();

        if (!yieldBoostingTokenWithdrawalDelayInitialized[pid]) {
            yieldBoostingTokenWithdrawalDelayInitialized[pid] = true;
            _executeYieldBoostingTokenWithdrawal(pid, amount, receiver);
        } else {
            pendingYieldBoostingTokenWithdrawal[pid] = PendingYieldBoostingTokenWithdrawal({
                amount: amount,
                receiver: receiver,
                readyAt: block.timestamp + CONFIG_CHANGE_DELAY,
                exists: true
            });
            emit YieldBoostingTokenWithdrawalQueued(pid, receiver, amount, pendingYieldBoostingTokenWithdrawal[pid].readyAt);
        }
    }

    function applyEmergencyWithdrawYieldBoostingTokens(uint256 pid) external onlyOwner nonReentrant {
        PendingYieldBoostingTokenWithdrawal memory pending = pendingYieldBoostingTokenWithdrawal[pid];
        if (!pending.exists) revert NoPendingChange();
        if (block.timestamp < pending.readyAt) revert TimelockNotReady();
        delete pendingYieldBoostingTokenWithdrawal[pid];
        _executeYieldBoostingTokenWithdrawal(pid, pending.amount, pending.receiver);
    }

    function delegateVotingPowerBatch(address registry, string[] calldata spaces, address delegate) external onlyOwner {
        if (spaces.length == 0) revert Errors.LengthMismatch();
        for (uint256 i; i < spaces.length; ++i) {
            _delegateVotingPower(registry, spaces[i], delegate);
        }
    }

    function clearVotingPowerDelegate(address registry, string calldata space) external onlyOwner {
        if (registry == address(0)) revert Errors.ZeroAddress();
        bytes32 spaceId = _snapshotSpaceId(space);
        ISnapshotDelegateRegistry(registry).clearDelegate(spaceId);
        emit VotingPowerDelegateCleared(registry, spaceId, space);
    }

    function queueSnapshotSpace(string calldata space) external onlyOwner {
        bytes32 spaceId = _snapshotSpaceId(space);
        if (approvedSnapshotSpace[spaceId]) revert Errors.AlreadySet();
        uint256 readyAt = block.timestamp + CONFIG_CHANGE_DELAY;
        pendingSnapshotSpace[spaceId] = PendingSnapshotSpace({readyAt: readyAt, exists: true});
        emit SnapshotSpaceQueued(spaceId, space, readyAt);
    }

    function approveQueuedSnapshotSpace(string calldata space) external {
        bytes32 spaceId = _snapshotSpaceId(space);
        PendingSnapshotSpace memory pending = pendingSnapshotSpace[spaceId];
        if (!pending.exists) revert NoPendingChange();
        if (block.timestamp < pending.readyAt) revert TimelockNotReady();
        delete pendingSnapshotSpace[spaceId];
        _approveSnapshotSpace(space);
    }

    function removeSnapshotSpace(string calldata space) external onlyOwner {
        bytes32 spaceId = _snapshotSpaceId(space);
        approvedSnapshotSpace[spaceId] = false;
        delete pendingSnapshotSpace[spaceId];
        emit SnapshotSpaceRemoved(spaceId, space);
    }

    function isApprovedSnapshotSpace(string calldata space) external view returns (bool) {
        return approvedSnapshotSpace[_snapshotSpaceId(space)];
    }

    function queueSnapshotVoteFormat(bytes32 formatId, string calldata label) external onlyOwner {
        if (snapshotVoteFormatApprovalLocked) revert SnapshotVoteFormatApprovalPermanentlyLocked();
        if (formatId == bytes32(0)) revert InvalidSnapshotVoteFormat();
        if (approvedSnapshotVoteFormat[formatId]) revert Errors.AlreadySet();
        uint256 readyAt = block.timestamp + CONFIG_CHANGE_DELAY;
        pendingSnapshotVoteFormat[formatId] = PendingSnapshotVoteFormat({readyAt: readyAt, exists: true});
        emit SnapshotVoteFormatQueued(formatId, label, readyAt);
    }

    function approveQueuedSnapshotVoteFormat(bytes32 formatId, string calldata label) external {
        if (snapshotVoteFormatApprovalLocked) revert SnapshotVoteFormatApprovalPermanentlyLocked();
        PendingSnapshotVoteFormat memory pending = pendingSnapshotVoteFormat[formatId];
        if (!pending.exists) revert NoPendingChange();
        if (block.timestamp < pending.readyAt) revert TimelockNotReady();
        delete pendingSnapshotVoteFormat[formatId];
        _approveSnapshotVoteFormat(formatId, label);
    }

    function removeSnapshotVoteFormat(bytes32 formatId, string calldata label) external onlyOwner {
        if (formatId == bytes32(0)) revert InvalidSnapshotVoteFormat();
        approvedSnapshotVoteFormat[formatId] = false;
        delete pendingSnapshotVoteFormat[formatId];
        emit SnapshotVoteFormatRemoved(formatId, label);
    }

    function lockSnapshotVoteFormatApproval() external onlyOwner {
        snapshotVoteFormatApprovalLocked = true;
        emit SnapshotVoteFormatApprovalLocked();
    }

    function isApprovedSnapshotVoteFormat(bytes32 formatId) external view returns (bool) {
        return approvedSnapshotVoteFormat[formatId];
    }

    function approveSnapshotVoteUint32(
        string calldata from,
        string calldata space,
        uint64 timestamp,
        string calldata proposal,
        uint32 choice,
        string calldata reason,
        string calldata app,
        string calldata metadata
    ) external onlyVoter returns (bytes32 hash) {
        _requireApprovedSnapshotVoteFormat(SNAPSHOT_VOTE_FORMAT_UINT32);
        bytes32 spaceId = _requireApprovedSnapshotSpace(space);
        bytes32 structHash = keccak256(abi.encode(
            SNAPSHOT_VOTE_UINT32_TYPEHASH,
            keccak256(bytes(from)),
            keccak256(bytes(space)),
            timestamp,
            keccak256(bytes(proposal)),
            choice,
            keccak256(bytes(reason)),
            keccak256(bytes(app)),
            keccak256(bytes(metadata))
        ));
        hash = _snapshotTypedDataHash(structHash);
        _approveSnapshotVoteHash(hash, spaceId);
    }

    function approveSnapshotVoteString(
        string calldata from,
        string calldata space,
        uint64 timestamp,
        string calldata proposal,
        string calldata choice,
        string calldata reason,
        string calldata app,
        string calldata metadata
    ) external onlyVoter returns (bytes32 hash) {
        _requireApprovedSnapshotVoteFormat(SNAPSHOT_VOTE_FORMAT_STRING);
        bytes32 spaceId = _requireApprovedSnapshotSpace(space);
        bytes32 structHash = keccak256(abi.encode(
            SNAPSHOT_VOTE_STRING_TYPEHASH,
            keccak256(bytes(from)),
            keccak256(bytes(space)),
            timestamp,
            keccak256(bytes(proposal)),
            keccak256(bytes(choice)),
            keccak256(bytes(reason)),
            keccak256(bytes(app)),
            keccak256(bytes(metadata))
        ));
        hash = _snapshotTypedDataHash(structHash);
        _approveSnapshotVoteHash(hash, spaceId);
    }

    function approveSnapshotVoteUint32Array(
        string calldata from,
        string calldata space,
        uint64 timestamp,
        string calldata proposal,
        uint32[] calldata choice,
        string calldata reason,
        string calldata app,
        string calldata metadata
    ) external onlyVoter returns (bytes32 hash) {
        _requireApprovedSnapshotVoteFormat(SNAPSHOT_VOTE_FORMAT_UINT32_ARRAY);
        bytes32 spaceId = _requireApprovedSnapshotSpace(space);
        bytes32 structHash = keccak256(abi.encode(
            SNAPSHOT_VOTE_UINT32_ARRAY_TYPEHASH,
            keccak256(bytes(from)),
            keccak256(bytes(space)),
            timestamp,
            keccak256(bytes(proposal)),
            _hashUint32Array(choice),
            keccak256(bytes(reason)),
            keccak256(bytes(app)),
            keccak256(bytes(metadata))
        ));
        hash = _snapshotTypedDataHash(structHash);
        _approveSnapshotVoteHash(hash, spaceId);
    }

    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        if (!snapshotVotingEnabled) return ERC1271_INVALID;
        return approvedSnapshotVoteHash[hash] ? ERC1271_MAGICVALUE : ERC1271_INVALID;
    }

    function poolInfo(uint256 pid) external view returns (PoolView memory view_) {
        Pool storage pool = _pool(pid);
        view_ = PoolView({
            asset: pool.asset,
            gauge: pool.gauge,
            active: pool.active,
            totalStaked: pool.totalStaked,
            rewardTokens: pool.rewardTokens
        });
    }

    function poolLength() external view returns (uint256) {
        return pools.length;
    }

    function isRewardToken(uint256 pid, address rewardToken) external view returns (bool) {
        Pool storage pool = _pool(pid);
        return _isRewardToken(pool, rewardToken);
    }

    function deposit(uint256 pid, uint256 amount) external virtual override nonReentrant whenNotPaused {
        if (amount == 0) revert Errors.ZeroAmount();

        Pool storage pool = _pool(pid);
        if (msg.sender != poolDepositor[pid]) revert Errors.StrategyNotApproved();
        if (!pool.active) revert Errors.PoolInactive();

        _harvest(pid, pool);
        _checkpoint(pid, msg.sender);

        IERC20(pool.asset).safeTransferFrom(msg.sender, address(this), amount);
        IStakeDaoGauge(pool.gauge).deposit(amount, address(this));

        pool.totalStaked += amount;
        positions[pid][msg.sender].principal += amount;
        _syncRewardDebt(pid, msg.sender);
    }

    function withdraw(uint256 pid, uint256 amount) external virtual override nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();

        Pool storage pool = _pool(pid);
        Position storage position = positions[pid][msg.sender];

        _checkpoint(pid, msg.sender);

        position.principal -= amount;
        pool.totalStaked -= amount;
        _syncRewardDebt(pid, msg.sender);

        IStakeDaoGauge(pool.gauge).withdraw(amount, false);
        IERC20(pool.asset).safeTransfer(msg.sender, amount);
    }

    function harvest(uint256 pid)
        external
        virtual
        override
        nonReentrant
        whenNotPaused
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        Pool storage pool = _pool(pid);
        (tokens, amounts) = _harvest(pid, pool);
    }

    function claimStakeDaoRewards(uint256 pid, bytes[] calldata calls)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        address executor = stakeDaoClaimExecutor;
        if (executor == address(0)) revert Errors.ClaimExecutorNotSet();

        Pool storage pool = _pool(pid);
        _syncGaugeRewards(pid, pool);
        tokens = pool.rewardTokens;
        amounts = new uint256[](tokens.length);

        if (pool.totalStaked == 0) revert Errors.ZeroAmount();

        uint256[] memory beforeBalances = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            beforeBalances[i] = IERC20(tokens[i]).balanceOf(address(this));
        }

        IStakeDaoClaimExecutor(executor).execute(calls);

        for (uint256 i; i < tokens.length; i++) {
            uint256 harvested = IERC20(tokens[i]).balanceOf(address(this)) - beforeBalances[i];
            uint256 net = _chargeFees(pid, tokens[i], harvested);
            net = _retainYieldBoostingTokens(pid, pool, tokens[i], net);
            amounts[i] = net;
            if (net > 0) {
                accRewardPerShare[pid][tokens[i]] += net * ACC_PRECISION / pool.totalStaked;
            }
        }

        emit StakeDaoAggregateClaimed(pid, executor);
    }

    function _harvest(uint256 pid, Pool storage pool) internal returns (address[] memory tokens, uint256[] memory amounts) {
        _syncGaugeRewards(pid, pool);
        tokens = pool.rewardTokens;
        amounts = new uint256[](tokens.length);

        if (pool.totalStaked == 0) return (tokens, amounts);
        if (!_hasClaimableRewards(pool.gauge, tokens)) return (tokens, amounts);

        uint256[] memory beforeBalances = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            beforeBalances[i] = IERC20(tokens[i]).balanceOf(address(this));
        }

        IStakeDaoGauge(pool.gauge).claim_rewards(address(this), address(this));

        for (uint256 i; i < tokens.length; i++) {
            uint256 harvested = IERC20(tokens[i]).balanceOf(address(this)) - beforeBalances[i];
            uint256 net = _chargeFees(pid, tokens[i], harvested);
            net = _retainYieldBoostingTokens(pid, pool, tokens[i], net);
            amounts[i] = net;
            if (net > 0) {
                accRewardPerShare[pid][tokens[i]] += net * ACC_PRECISION / pool.totalStaked;
            }
        }
    }

    function _hasClaimableRewards(address gauge, address[] memory tokens) internal view returns (bool) {
        for (uint256 i; i < tokens.length; i++) {
            if (IStakeDaoGauge(gauge).claimable_reward(address(this), tokens[i]) != 0) {
                return true;
            }
        }
        return false;
    }

    function _checkpointGauge(address gauge, bytes4 selector) internal returns (bool) {
        (bool checkpointSuccess, bytes memory checkpointResult) =
            gauge.call(abi.encodeWithSelector(selector, address(this)));
        if (!checkpointSuccess) return false;
        if (selector != IStakeDaoGauge.user_checkpoint.selector) return true;
        if (checkpointResult.length < 32) return false;
        return abi.decode(checkpointResult, (bool));
    }

    function _calldataSelector(bytes calldata data) internal pure returns (bytes4 selector) {
        assembly ("memory-safe") {
            selector := calldataload(data.offset)
        }
    }

    function _approveSnapshotSpace(string memory space) internal {
        bytes32 spaceId = _snapshotSpaceId(space);
        approvedSnapshotSpace[spaceId] = true;
        emit SnapshotSpaceApproved(spaceId, space);
    }

    function _requireApprovedSnapshotSpace(string memory space) internal view returns (bytes32 spaceId) {
        spaceId = _snapshotSpaceId(space);
        if (!approvedSnapshotSpace[spaceId]) revert SnapshotSpaceNotApproved();
    }

    function _approveSnapshotVoteFormat(bytes32 formatId, string memory label) internal {
        if (formatId == bytes32(0)) revert InvalidSnapshotVoteFormat();
        approvedSnapshotVoteFormat[formatId] = true;
        emit SnapshotVoteFormatApproved(formatId, label);
    }

    function _requireApprovedSnapshotVoteFormat(bytes32 formatId) internal view {
        if (!approvedSnapshotVoteFormat[formatId]) revert SnapshotVoteFormatNotApproved();
    }

    function _approveSnapshotVoteHash(bytes32 hash, bytes32 spaceId) internal {
        if (hash == bytes32(0)) revert ZeroSnapshotVoteHash();
        approvedSnapshotVoteHash[hash] = true;
        emit SnapshotVoteHashApproved(hash, spaceId);
    }

    function _hashUint32Array(uint32[] calldata values) internal pure returns (bytes32 hash) {
        bytes memory encoded = new bytes(values.length * 32);
        for (uint256 i; i < values.length; i++) {
            uint32 value = values[i];
            assembly ("memory-safe") {
                mstore(add(add(encoded, 32), mul(i, 32)), value)
            }
        }
        hash = keccak256(encoded);
    }

    function _snapshotDomainSeparator() internal pure returns (bytes32) {
        return keccak256(abi.encode(SNAPSHOT_DOMAIN_TYPEHASH, SNAPSHOT_NAME_HASH, SNAPSHOT_VERSION_HASH));
    }

    function _setPoolDepositor(uint256 pid, address depositor) internal {
        if (depositor == address(0)) revert Errors.ZeroAddress();
        _pool(pid);
        if (poolDepositorLocked[pid]) revert Errors.AlreadySet();
        poolDepositor[pid] = depositor;
        emit PoolDepositorSet(pid, depositor);
    }

    function _setPoolFees(uint256 pid, FeeConfig calldata config) internal {
        _pool(pid);
        _validateFeeConfig(config);

        if (!poolFeeConfigDelayInitialized[pid]) {
            poolFeeConfigDelayInitialized[pid] = true;
            poolFeeConfig[pid] = config;
            poolFeeConfigSet[pid] = true;
            emit PoolFeesSet(
                pid,
                config.platformFeeBps,
                config.vlSdtReserveFeeBps,
                config.platformFeeRecipient,
                config.vlSdtReserveRecipient
            );
        } else {
            pendingPoolFeeConfig[pid] =
                PendingFeeConfig({config: config, readyAt: block.timestamp + CONFIG_CHANGE_DELAY, exists: true});
            emit PoolFeesQueued(
                pid,
                config.platformFeeBps,
                config.vlSdtReserveFeeBps,
                config.platformFeeRecipient,
                config.vlSdtReserveRecipient,
                pendingPoolFeeConfig[pid].readyAt
            );
        }
    }

    function _setPoolRetentionFeeBps(uint256 pid, uint16 retentionFeeBps) internal {
        _pool(pid);
        if (retentionFeeBps > MAX_RETENTION_FEE_BPS) revert Errors.InvalidFee();

        if (!poolRetentionFeeDelayInitialized[pid]) {
            poolRetentionFeeDelayInitialized[pid] = true;
            poolRetentionFeeBps[pid] = retentionFeeBps;
            emit PoolRetentionFeeSet(pid, retentionFeeBps);
        } else {
            pendingPoolRetentionFeeConfig[pid] = PendingRetentionFeeConfig({
                retentionFeeBps: retentionFeeBps,
                readyAt: block.timestamp + CONFIG_CHANGE_DELAY,
                exists: true
            });
            emit PoolRetentionFeeQueued(pid, retentionFeeBps, pendingPoolRetentionFeeConfig[pid].readyAt);
        }
    }

    function _setPoolCheckpointSelector(uint256 pid, bytes4 selector) internal {
        _pool(pid);
        if (selector == bytes4(0)) revert Errors.ZeroSelector();
        poolCheckpointSelector[pid] = selector;
        emit PoolCheckpointSelectorSet(pid, selector);
    }

    function _delegateVotingPower(address registry, string calldata space, address delegate) internal {
        if (registry == address(0) || delegate == address(0)) revert Errors.ZeroAddress();
        bytes32 spaceId = _snapshotSpaceId(space);
        ISnapshotDelegateRegistry(registry).setDelegate(spaceId, delegate);
        emit VotingPowerDelegated(registry, spaceId, space, delegate);
    }

    function _snapshotTypedDataHash(bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _snapshotDomainSeparator(), structHash));
    }

    function _snapshotSpaceId(string memory space) internal pure returns (bytes32 spaceId) {
        bytes memory spaceBytes = bytes(space);
        if (spaceBytes.length > 31) revert Errors.InvalidSnapshotSpace();
        assembly {
            spaceId := mload(add(spaceBytes, 32))
        }
    }

    function _syncGaugeRewards(uint256 pid, Pool storage pool) internal {
        for (uint256 i; i < MAX_REWARD_TOKENS; i++) {
            address rewardToken = IStakeDaoGauge(pool.gauge).reward_tokens(i);
            if (rewardToken == address(0)) return;
            if (!_isRewardToken(pool, rewardToken)) {
                _addRewardToken(pool, pid, rewardToken);
            }
        }
    }

    function _addRewardToken(Pool storage pool, uint256 pid, address rewardToken) internal {
        if (rewardToken == address(0)) revert Errors.ZeroAddress();
        if (pool.rewardTokens.length >= MAX_REWARD_TOKENS) revert Errors.RewardTokenLimitExceeded();
        if (_isRewardToken(pool, rewardToken)) revert Errors.DuplicateRewardToken();
        pool.rewardTokens.push(rewardToken);
        emit PoolRewardTokenAdded(pid, rewardToken);
    }

    function _isRewardToken(Pool storage pool, address rewardToken) internal view returns (bool) {
        for (uint256 i; i < pool.rewardTokens.length; i++) {
            if (pool.rewardTokens[i] == rewardToken) return true;
        }
        return false;
    }

    function claim(uint256 pid, address receiver)
        external
        virtual
        override
        nonReentrant
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        if (receiver == address(0)) revert Errors.ZeroAddress();
        if (!_canClaim(pid, msg.sender)) revert Errors.StrategyNotApproved();

        _checkpoint(pid, msg.sender);

        Pool storage pool = _pool(pid);
        Position storage position = positions[pid][msg.sender];
        tokens = pool.rewardTokens;
        amounts = new uint256[](tokens.length);

        for (uint256 i; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 amount = position.claimable[token];
            amounts[i] = amount;
            if (amount == 0) continue;
            position.claimable[token] = 0;
            IERC20(token).safeTransfer(receiver, amount);
        }
    }

    function claimReward(uint256 pid, address rewardToken, address receiver)
        external
        virtual
        override
        nonReentrant
        returns (uint256 amount)
    {
        if (receiver == address(0)) revert Errors.ZeroAddress();
        Pool storage pool = _pool(pid);
        if (!_isRewardToken(pool, rewardToken)) revert Errors.RewardTokenNotRegistered();
        if (!_canClaim(pid, msg.sender)) revert Errors.StrategyNotApproved();

        _checkpoint(pid, msg.sender);

        Position storage position = positions[pid][msg.sender];
        amount = position.claimable[rewardToken];
        if (amount == 0) return 0;
        position.claimable[rewardToken] = 0;
        IERC20(rewardToken).safeTransfer(receiver, amount);
    }

    function balanceOf(uint256 pid, address strategy) external view virtual override returns (uint256) {
        return positions[pid][strategy].principal;
    }

    function pendingRewards(uint256 pid, address strategy)
        external
        view
        virtual
        override
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        Pool storage pool = _pool(pid);
        Position storage position = positions[pid][strategy];
        tokens = pool.rewardTokens;
        amounts = new uint256[](tokens.length);

        for (uint256 i; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 accumulated = position.principal * accRewardPerShare[pid][token] / ACC_PRECISION;
            uint256 pending = accumulated > position.rewardDebt[token] ? accumulated - position.rewardDebt[token] : 0;
            amounts[i] = position.claimable[token] + pending;
        }
    }

    function _pool(uint256 pid) internal view returns (Pool storage pool) {
        if (pid >= pools.length) revert Errors.InvalidPool();
        pool = pools[pid];
    }

    function _checkpoint(uint256 pid, address strategy) internal {
        Pool storage pool = _pool(pid);
        Position storage position = positions[pid][strategy];
        uint256 principal = position.principal;

        for (uint256 i; i < pool.rewardTokens.length; i++) {
            address token = pool.rewardTokens[i];
            uint256 accumulated = principal * accRewardPerShare[pid][token] / ACC_PRECISION;
            uint256 debt = position.rewardDebt[token];
            if (accumulated > debt) {
                position.claimable[token] += accumulated - debt;
            }
            position.rewardDebt[token] = position.principal * accRewardPerShare[pid][token] / ACC_PRECISION;
        }
    }

    function _syncRewardDebt(uint256 pid, address strategy) internal {
        Pool storage pool = _pool(pid);
        Position storage position = positions[pid][strategy];
        for (uint256 i; i < pool.rewardTokens.length; i++) {
            address token = pool.rewardTokens[i];
            position.rewardDebt[token] = position.principal * accRewardPerShare[pid][token] / ACC_PRECISION;
        }
    }

    function _canClaim(uint256 pid, address strategy) internal view returns (bool) {
        Pool storage pool = _pool(pid);
        Position storage position = positions[pid][strategy];
        if (poolDepositor[pid] == strategy || position.principal > 0) return true;

        for (uint256 i; i < pool.rewardTokens.length; i++) {
            if (position.claimable[pool.rewardTokens[i]] > 0) return true;
        }

        return false;
    }

    function approvedStrategy(uint256 pid, address strategy) external view returns (bool) {
        _pool(pid);
        return poolDepositor[pid] == strategy;
    }

    function _validateFeeConfig(FeeConfig calldata config) internal pure {
        uint256 totalFeeBps = config.platformFeeBps + config.vlSdtReserveFeeBps;
        if (totalFeeBps > MAX_TOTAL_FEE_BPS) revert Errors.InvalidFee();
        if (config.platformFeeBps > 0 && config.platformFeeRecipient == address(0)) revert Errors.ZeroAddress();
        if (config.vlSdtReserveFeeBps > 0 && config.vlSdtReserveRecipient == address(0)) revert Errors.ZeroAddress();
    }

    function _chargeFees(uint256 pid, address token, uint256 amount) internal returns (uint256 net) {
        if (!poolFeeConfigSet[pid]) revert Errors.InvalidFee();
        FeeConfig memory config = poolFeeConfig[pid];
        uint256 totalFeeBps = config.platformFeeBps + config.vlSdtReserveFeeBps;
        if (amount == 0 || totalFeeBps == 0) return amount;

        uint256 platformFee = amount * config.platformFeeBps / FEE_DENOMINATOR;
        uint256 reserveFee = amount * config.vlSdtReserveFeeBps / FEE_DENOMINATOR;

        if (platformFee > 0 && config.platformFeeRecipient != address(0)) {
            IERC20(token).safeTransfer(config.platformFeeRecipient, platformFee);
        }
        if (reserveFee > 0 && config.vlSdtReserveRecipient != address(0)) {
            IERC20(token).safeTransfer(config.vlSdtReserveRecipient, reserveFee);
        }

        net = amount - platformFee - reserveFee;
    }

    function _retainYieldBoostingTokens(uint256 pid, Pool storage pool, address token, uint256 amount)
        internal
        returns (uint256 net)
    {
        uint16 retentionBps = poolRetentionFeeBps[pid];
        if (amount == 0 || retentionBps == 0 || token != pool.asset) return amount;

        uint256 retainAmount = amount * retentionBps / FEE_DENOMINATOR;
        if (retainAmount == 0) return amount;

        _stakeYieldBoostingTokens(pid, pool, retainAmount);
        emit YieldBoostingTokensRetained(pid, retainAmount);
        return amount - retainAmount;
    }

    function _stakeYieldBoostingTokens(uint256 pid, Pool storage pool, uint256 amount) internal {
        retainedStakingToken[pid] += amount;
        IStakeDaoGauge(pool.gauge).deposit(amount, address(this));
    }

    function _executeYieldBoostingTokenWithdrawal(uint256 pid, uint256 amount, address receiver) internal {
        Pool storage pool = _pool(pid);
        uint256 retained = retainedStakingToken[pid];
        if (amount > retained) revert Errors.ZeroAmount();

        retainedStakingToken[pid] = retained - amount;
        IStakeDaoGauge(pool.gauge).withdraw(amount, false);
        IERC20(pool.asset).safeTransfer(receiver, amount);
        emit YieldBoostingTokensWithdrawn(pid, receiver, amount);
    }


}

