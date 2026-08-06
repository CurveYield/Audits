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
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICurveYieldGovernanceToken} from "./interfaces/ICurveYield.sol";

contract CurveYieldVlSDTRevenueStaking is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant STREAM_DURATION = 14 days;
    uint256 public constant REWARD_CYCLE_INTERVAL = 1 days;
    uint256 public constant WITHDRAWAL_DELAY = 7 days;
    uint256 public constant MAX_IMMEDIATE_WITHDRAW_FEE_BPS = 250;
    uint256 public constant EXCESS_TREASURY_BPS = 3_300;
    uint256 public constant EXCESS_ADMIN_BPS = 700;
    uint256 public constant BPS = 10_000;
    uint256 public constant PRECISION = 1e27;
    uint256 public constant BASE_PRECISION = 1e18;
    uint256 public constant MAX_REWARD_TOKENS = 8;
    uint256 public constant MAX_ACTIVE_STREAMS_PER_TOKEN = 32;
    uint256 public constant MINT_TIMELOCK_ACTIVATION_DELAY = 7 days;
    uint256 public constant MINT_APPROVAL_DELAY = 7 days;

    struct Stream {
        uint256 amount;
        uint64 start;
        uint64 end;
    }

    struct RewardData {
        uint256 rewardPerActiveStored;
        uint256 pendingUserRewards;
        uint256 scaledRemainder;
        uint64 lastUpdate;
        uint64 pendingSince;
        uint64 lastCycleStart;
        uint64 streamHead;
        Stream[] streams;
    }

    struct WithdrawalRequest {
        address owner;
        uint128 amount;
        uint64 unlockTime;
        bool completed;
    }

    IERC20 public immutable CYVLSDT;
    ICurveYieldGovernanceToken public immutable GOVERNANCE_TOKEN;
    address public treasuryReceiver;
    address public admin;
    uint16 public immediateWithdrawFeeBps = 50;

    address[] public rewardTokens;
    mapping(address => bool) public isRewardToken;
    mapping(address => bool) public isNotifier;
    mapping(address => RewardData) internal _rewardData;

    uint256 public totalActiveStake;
    uint256 public totalQueuedStake;
    mapping(address => uint256) public activeBalance;
    mapping(address => uint256) public queuedBalance;
    mapping(address => mapping(address => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(address => uint256)) public accruedRewards;

    uint64 public immutable mintTimelocksActiveAt;

    uint256 public governanceEmissionRate;
    uint256 public governanceLastUpdate;
    uint256 public governanceRewardPerTokenStored;
    uint256 public governanceEmissionReservationId;
    mapping(address => uint256) public userGovernanceRewardPerTokenPaid;
    mapping(address => uint256) public accruedGovernance;

    uint256 public fundedGovernanceRewardPerTokenStored;
    uint256 public fundedGovernanceScaledRemainder;
    uint256 public queuedFundedGovernanceRewards;
    mapping(address => uint256) public userFundedGovernanceRewardPerTokenPaid;
    mapping(address => uint256) public accruedFundedGovernance;

    uint256 public pendingGovernanceEmissionRate;
    uint256 public governanceEmissionRateReadyAt;
    uint256 public pendingOneTimeGovernanceMint;
    uint256 public oneTimeGovernanceMintReadyAt;
    uint256 public oneTimeGovernanceMintReservationId;
    uint256 public periodicGovernanceMintAmount;
    uint256 public periodicGovernanceMintInterval;
    uint256 public nextPeriodicGovernanceMintAt;
    uint256 public pendingPeriodicGovernanceMintAmount;
    uint256 public pendingPeriodicGovernanceMintInterval;
    uint256 public periodicGovernanceMintConfigReadyAt;
    uint256 public periodicGovernanceMintReservationId;
    uint256 public pendingPeriodicGovernanceMintReservationId;

    uint256 public nextWithdrawalId = 1;
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    error ZeroAddress();
    error ZeroAmount();
    error RewardTokenAlreadyAdded();
    error RewardTokenLimit();
    error NotNotifier();
    error UnsupportedRewardToken();
    error InsufficientStake();
    error InvalidWithdrawalRequest();
    error WithdrawalNotReady();
    error ValueTooLarge();
    error NonExactRewardTransfer(uint256 expected, uint256 received);
    error ActiveStreamLimit();
    error NoPendingRewards();
    error NoActiveStake();
    error CycleNotReady(uint256 readyAt);
    error OnlyAdmin();
    error MintApprovalNotPending();
    error MintApprovalNotReady();
    error PeriodicMintNotReady();
    error InvalidPeriodicMintConfig();
    error MintApprovalAlreadyPending();
    error PeriodicMintReservationMissing();
    error InvalidImmediateWithdrawFee();

    event RewardTokenAdded(address indexed token);
    event NotifierSet(address indexed notifier, bool allowed);
    event Staked(address indexed user, uint256 amount);
    event ImmediateWithdrawal(address indexed user, address indexed receiver, uint256 amount, uint256 fee);
    event WithdrawalRequested(uint256 indexed id, address indexed user, uint256 amount, uint256 unlockTime);
    event QueuedWithdrawalCompleted(uint256 indexed id, address indexed user, address indexed receiver, uint256 amount);
    event RewardQueued(
        address indexed token,
        uint256 grossAmount,
        uint256 userAmount,
        uint256 treasuryAmount,
        uint256 adminAmount,
        uint256 baseRewardPerVlSDT,
        uint256 readyAt
    );
    event RewardCycleStarted(address indexed token, uint256 amount, uint256 startTime, uint256 endTime);
    event RewardRequeued(address indexed token, uint256 amount, uint256 readyAt);
    event RewardClaimed(address indexed user, address indexed token, address indexed receiver, uint256 amount);
    event ImmediateTreasuryReward(address indexed token, uint256 amount);
    event ImmediateAdminReward(address indexed token, address indexed receiver, uint256 amount);
    event GovernanceEmissionRateSet(uint256 oldRate, uint256 newRate);
    event GovernanceEmissionRateQueued(uint256 newRate, uint256 readyAt);
    event GovernanceEmissionRateCancelled(uint256 newRate);
    event OneTimeGovernanceMintQueued(uint256 amount, uint256 readyAt);
    event OneTimeGovernanceMintCancelled(uint256 amount);
    event OneTimeGovernanceMintExecuted(uint256 amount);
    event PeriodicGovernanceMintConfigQueued(uint256 amount, uint256 interval, uint256 readyAt);
    event PeriodicGovernanceMintConfigCancelled(uint256 amount, uint256 interval);
    event PeriodicGovernanceMintConfigSet(uint256 amount, uint256 interval, uint256 nextMintAt);
    event PeriodicGovernanceMintExecuted(uint256 amount, uint256 nextMintAt);
    event PeriodicGovernanceMintReservationUnavailable(uint256 amount, uint256 nextMintAt);
    event GovernanceRewardClaimed(address indexed user, address indexed receiver, uint256 amount);
    event TreasuryReceiverSet(address indexed oldReceiver, address indexed newReceiver);
    event AdminSet(address indexed oldAdmin, address indexed newAdmin);
    event ImmediateWithdrawFeeSet(uint256 oldFeeBps, uint256 newFeeBps);

    constructor(
        address initialOwner_,
        address initialAdmin_,
        address initialTreasuryReceiver_,
        address cyvlSdt_,
        address governanceToken_
    ) Ownable(initialOwner_) {
        if (
            initialOwner_ == address(0) || initialAdmin_ == address(0)
                || initialTreasuryReceiver_ == address(0)
                || cyvlSdt_ == address(0) || governanceToken_ == address(0)
        ) revert ZeroAddress();
        treasuryReceiver = initialTreasuryReceiver_;
        admin = initialAdmin_;
        CYVLSDT = IERC20(cyvlSdt_);
        GOVERNANCE_TOKEN = ICurveYieldGovernanceToken(governanceToken_);
        governanceLastUpdate = block.timestamp;
        mintTimelocksActiveAt = uint64(block.timestamp + MINT_TIMELOCK_ACTIVATION_DELAY);
        emit TreasuryReceiverSet(address(0), initialTreasuryReceiver_);
        emit AdminSet(address(0), initialAdmin_);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    function setTreasuryReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        emit TreasuryReceiverSet(treasuryReceiver, newReceiver);
        treasuryReceiver = newReceiver;
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminSet(admin, newAdmin);
        admin = newAdmin;
    }

    function setImmediateWithdrawFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_IMMEDIATE_WITHDRAW_FEE_BPS) revert InvalidImmediateWithdrawFee();
        emit ImmediateWithdrawFeeSet(immediateWithdrawFeeBps, newFeeBps);
        immediateWithdrawFeeBps = newFeeBps;
    }

    function previewImmediateWithdrawal(uint256 amount) public view returns (uint256 received) {
        received = amount - Math.mulDiv(amount, immediateWithdrawFeeBps, BPS);
    }

    function addRewardToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (isRewardToken[token]) revert RewardTokenAlreadyAdded();
        if (rewardTokens.length >= MAX_REWARD_TOKENS) revert RewardTokenLimit();
        isRewardToken[token] = true;
        rewardTokens.push(token);
        _rewardData[token].lastUpdate = uint64(block.timestamp);
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

    function setGovernanceEmissionRate(uint256 newRate) external onlyOwner {
        if (block.timestamp < mintTimelocksActiveAt) {
            _applyGovernanceEmissionRate(newRate);
            return;
        }
        pendingGovernanceEmissionRate = newRate;
        governanceEmissionRateReadyAt = block.timestamp + MINT_APPROVAL_DELAY;
        emit GovernanceEmissionRateQueued(newRate, governanceEmissionRateReadyAt);
    }

    function executeGovernanceEmissionRate() external {
        uint256 readyAt = governanceEmissionRateReadyAt;
        if (readyAt == 0) revert MintApprovalNotPending();
        if (block.timestamp < readyAt) revert MintApprovalNotReady();
        uint256 newRate = pendingGovernanceEmissionRate;
        delete pendingGovernanceEmissionRate;
        delete governanceEmissionRateReadyAt;
        _applyGovernanceEmissionRate(newRate);
    }

    function cancelGovernanceEmissionRate() external onlyOwner {
        if (governanceEmissionRateReadyAt == 0) revert MintApprovalNotPending();
        uint256 cancelled = pendingGovernanceEmissionRate;
        delete pendingGovernanceEmissionRate;
        delete governanceEmissionRateReadyAt;
        emit GovernanceEmissionRateCancelled(cancelled);
    }

    function _applyGovernanceEmissionRate(uint256 newRate) internal {
        _checkpointGovernance(address(0));
        emit GovernanceEmissionRateSet(governanceEmissionRate, newRate);
        governanceEmissionRate = newRate;
    }

    function proposeOneTimeGovernanceMint(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp < mintTimelocksActiveAt) {
            _executeFundedGovernanceMint(amount, 0);
            emit OneTimeGovernanceMintExecuted(amount);
            return;
        }
        if (oneTimeGovernanceMintReadyAt != 0) revert MintApprovalAlreadyPending();
        uint256 readyAt = block.timestamp + MINT_APPROVAL_DELAY;
        uint256 reservationId = GOVERNANCE_TOKEN.reserveMint(amount, readyAt);
        pendingOneTimeGovernanceMint = amount;
        oneTimeGovernanceMintReadyAt = readyAt;
        oneTimeGovernanceMintReservationId = reservationId;
        emit OneTimeGovernanceMintQueued(amount, readyAt);
    }

    function executeOneTimeGovernanceMint() external {
        uint256 readyAt = oneTimeGovernanceMintReadyAt;
        if (readyAt == 0) revert MintApprovalNotPending();
        if (block.timestamp < readyAt) revert MintApprovalNotReady();
        uint256 amount = pendingOneTimeGovernanceMint;
        uint256 reservationId = oneTimeGovernanceMintReservationId;
        _executeFundedGovernanceMint(amount, reservationId);
        delete pendingOneTimeGovernanceMint;
        delete oneTimeGovernanceMintReadyAt;
        delete oneTimeGovernanceMintReservationId;
        emit OneTimeGovernanceMintExecuted(amount);
    }

    function cancelOneTimeGovernanceMint() external onlyOwner {
        if (oneTimeGovernanceMintReadyAt == 0) revert MintApprovalNotPending();
        uint256 amount = pendingOneTimeGovernanceMint;
        GOVERNANCE_TOKEN.cancelMintReservation(oneTimeGovernanceMintReservationId);
        delete pendingOneTimeGovernanceMint;
        delete oneTimeGovernanceMintReadyAt;
        delete oneTimeGovernanceMintReservationId;
        emit OneTimeGovernanceMintCancelled(amount);
    }

    function proposePeriodicGovernanceMint(uint256 amount, uint256 interval) external onlyOwner {
        _validatePeriodicMintConfig(amount, interval);
        if (block.timestamp < mintTimelocksActiveAt) {
            _applyPeriodicGovernanceMintConfig(amount, interval, 0);
            return;
        }
        if (periodicGovernanceMintConfigReadyAt != 0) revert MintApprovalAlreadyPending();
        uint256 readyAt = block.timestamp + MINT_APPROVAL_DELAY;
        uint256 reservationId;
        if (amount != 0) reservationId = GOVERNANCE_TOKEN.reserveMint(amount, readyAt + interval);
        pendingPeriodicGovernanceMintAmount = amount;
        pendingPeriodicGovernanceMintInterval = interval;
        pendingPeriodicGovernanceMintReservationId = reservationId;
        periodicGovernanceMintConfigReadyAt = readyAt;
        emit PeriodicGovernanceMintConfigQueued(amount, interval, readyAt);
    }

    function executePeriodicGovernanceMintConfig() external {
        uint256 readyAt = periodicGovernanceMintConfigReadyAt;
        if (readyAt == 0) revert MintApprovalNotPending();
        if (block.timestamp < readyAt) revert MintApprovalNotReady();
        uint256 amount = pendingPeriodicGovernanceMintAmount;
        uint256 interval = pendingPeriodicGovernanceMintInterval;
        uint256 reservationId = pendingPeriodicGovernanceMintReservationId;
        delete pendingPeriodicGovernanceMintAmount;
        delete pendingPeriodicGovernanceMintInterval;
        delete pendingPeriodicGovernanceMintReservationId;
        delete periodicGovernanceMintConfigReadyAt;
        _applyPeriodicGovernanceMintConfig(amount, interval, reservationId);
    }

    function cancelPeriodicGovernanceMintConfig() external onlyOwner {
        if (periodicGovernanceMintConfigReadyAt == 0) revert MintApprovalNotPending();
        uint256 amount = pendingPeriodicGovernanceMintAmount;
        uint256 interval = pendingPeriodicGovernanceMintInterval;
        uint256 reservationId = pendingPeriodicGovernanceMintReservationId;
        if (reservationId != 0) GOVERNANCE_TOKEN.cancelMintReservation(reservationId);
        delete pendingPeriodicGovernanceMintAmount;
        delete pendingPeriodicGovernanceMintInterval;
        delete pendingPeriodicGovernanceMintReservationId;
        delete periodicGovernanceMintConfigReadyAt;
        emit PeriodicGovernanceMintConfigCancelled(amount, interval);
    }

    function executePeriodicGovernanceMint() external returns (uint256 amount) {
        amount = periodicGovernanceMintAmount;
        if (amount == 0 || block.timestamp < nextPeriodicGovernanceMintAt) {
            revert PeriodicMintNotReady();
        }
        uint256 reservationId = periodicGovernanceMintReservationId;
        if (reservationId == 0) revert PeriodicMintReservationMissing();
        uint256 nextMintAt = block.timestamp + periodicGovernanceMintInterval;
        uint256 nextReservationId = GOVERNANCE_TOKEN.mintReservedAndReserveNext(
            reservationId, address(this), amount, nextMintAt
        );
        periodicGovernanceMintReservationId = nextReservationId;
        nextPeriodicGovernanceMintAt = nextMintAt;
        _distributeFundedGovernance(amount);
        if (nextReservationId == 0) {
            emit PeriodicGovernanceMintReservationUnavailable(amount, nextMintAt);
        }
        emit PeriodicGovernanceMintExecuted(amount, nextMintAt);
    }

    function reserveNextPeriodicGovernanceMint() external returns (uint256 reservationId) {
        uint256 amount = periodicGovernanceMintAmount;
        if (amount == 0) revert InvalidPeriodicMintConfig();
        if (periodicGovernanceMintReservationId != 0) return periodicGovernanceMintReservationId;
        uint256 executableAt = nextPeriodicGovernanceMintAt > block.timestamp
            ? nextPeriodicGovernanceMintAt
            : block.timestamp;
        reservationId = GOVERNANCE_TOKEN.reserveMint(amount, executableAt);
        periodicGovernanceMintReservationId = reservationId;
    }

    function _validatePeriodicMintConfig(uint256 amount, uint256 interval) internal pure {
        if ((amount == 0) != (interval == 0)) revert InvalidPeriodicMintConfig();
    }

    function _applyPeriodicGovernanceMintConfig(
        uint256 amount,
        uint256 interval,
        uint256 suppliedReservationId
    ) internal {
        uint256 oldReservationId = periodicGovernanceMintReservationId;
        if (oldReservationId != 0 && oldReservationId != suppliedReservationId) {
            GOVERNANCE_TOKEN.cancelMintReservation(oldReservationId);
        }
        periodicGovernanceMintAmount = amount;
        periodicGovernanceMintInterval = interval;
        nextPeriodicGovernanceMintAt = amount == 0 ? 0 : block.timestamp + interval;
        uint256 reservationId = suppliedReservationId;
        if (amount != 0 && reservationId == 0) {
            reservationId = GOVERNANCE_TOKEN.reserveMint(amount, nextPeriodicGovernanceMintAt);
        }
        periodicGovernanceMintReservationId = reservationId;
        emit PeriodicGovernanceMintConfigSet(amount, interval, nextPeriodicGovernanceMintAt);
    }

    function _executeFundedGovernanceMint(uint256 amount, uint256 reservationId) internal {
        if (reservationId == 0) {
            GOVERNANCE_TOKEN.mint(address(this), amount);
        } else {
            GOVERNANCE_TOKEN.mintReserved(reservationId, address(this), amount);
        }
        _distributeFundedGovernance(amount);
    }

    function _distributeFundedGovernance(uint256 amount) internal {
        _checkpointFundedGovernance(address(0));
        uint256 supply = totalActiveStake;
        if (supply == 0) {
            queuedFundedGovernanceRewards += amount;
        } else {
            uint256 scaled = amount * PRECISION + fundedGovernanceScaledRemainder;
            fundedGovernanceRewardPerTokenStored += scaled / supply;
            fundedGovernanceScaledRemainder = scaled % supply;
        }
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

    function pendingUserRewards(address token) external view returns (uint256) {
        return _rewardData[token].pendingUserRewards;
    }

    function nextCycleReadyAt(address token) public view returns (uint256) {
        uint256 since = _rewardData[token].pendingSince;
        return since == 0 ? 0 : since + REWARD_CYCLE_INTERVAL;
    }

    function canStartRewardCycle(address token) external view returns (bool) {
        RewardData storage data = _rewardData[token];
        return isRewardToken[token] && data.pendingUserRewards != 0 && totalActiveStake != 0
            && block.timestamp >= uint256(data.pendingSince) + REWARD_CYCLE_INTERVAL;
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _checkpointAll(msg.sender);
        CYVLSDT.safeTransferFrom(msg.sender, address(this), amount);
        activeBalance[msg.sender] += amount;
        totalActiveStake += amount;
        _startReadyCycles();
        emit Staked(msg.sender, amount);
    }

    function withdrawImmediate(uint256 amount, address receiver)
        external
        nonReentrant
        returns (uint256 received)
    {
        if (amount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointAll(msg.sender);
        if (activeBalance[msg.sender] < amount) revert InsufficientStake();

        activeBalance[msg.sender] -= amount;
        totalActiveStake -= amount;
        received = previewImmediateWithdrawal(amount);
        uint256 fee = amount - received;
        if (fee != 0) CYVLSDT.safeTransfer(treasuryReceiver, fee);
        CYVLSDT.safeTransfer(receiver, received);
        _startReadyCycles();
        emit ImmediateWithdrawal(msg.sender, receiver, amount, fee);
    }

    function requestWithdrawal(uint256 amount) external nonReentrant returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        _checkpointAll(msg.sender);
        if (activeBalance[msg.sender] < amount) revert InsufficientStake();

        activeBalance[msg.sender] -= amount;
        totalActiveStake -= amount;
        queuedBalance[msg.sender] += amount;
        totalQueuedStake += amount;

        if (amount > type(uint128).max) revert ValueTooLarge();
        id = nextWithdrawalId++;
        uint64 unlockTime = uint64(block.timestamp + WITHDRAWAL_DELAY);
        withdrawalRequests[id] = WithdrawalRequest(msg.sender, uint128(amount), unlockTime, false);
        _startReadyCycles();
        emit WithdrawalRequested(id, msg.sender, amount, unlockTime);
    }

    function completeQueuedWithdrawal(uint256 id, address receiver)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (receiver == address(0)) revert ZeroAddress();
        WithdrawalRequest storage request = withdrawalRequests[id];
        if (request.owner != msg.sender || request.completed || request.amount == 0) {
            revert InvalidWithdrawalRequest();
        }
        if (block.timestamp < request.unlockTime) revert WithdrawalNotReady();

        _checkpointAll(msg.sender);
        request.completed = true;
        amount = request.amount;
        queuedBalance[msg.sender] -= amount;
        totalQueuedStake -= amount;
        CYVLSDT.safeTransfer(receiver, amount);
        _startReadyCycles();
        emit QueuedWithdrawalCompleted(id, msg.sender, receiver, amount);
    }

    function notifyReward(address token, uint256 amount, uint256 baseRewardPerVlSDT) external nonReentrant {
        if (!isNotifier[msg.sender]) revert NotNotifier();
        if (!isRewardToken[token]) revert UnsupportedRewardToken();
        if (amount == 0) revert ZeroAmount();

        _checkpointReward(token);

        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert NonExactRewardTransfer(amount, received);

        (uint256 userAmount, uint256 treasuryAmount, uint256 adminAmount) =
            _splitIncomingReward(amount, baseRewardPerVlSDT);

        RewardData storage data = _rewardData[token];
        if (userAmount != 0) {
            data.pendingUserRewards += userAmount;
            if (data.pendingSince == 0) data.pendingSince = uint64(block.timestamp);
        }

        if (treasuryAmount != 0) {
            IERC20(token).safeTransfer(treasuryReceiver, treasuryAmount);
            emit ImmediateTreasuryReward(token, treasuryAmount);
        }
        if (adminAmount != 0) {
            IERC20(token).safeTransfer(admin, adminAmount);
            emit ImmediateAdminReward(token, admin, adminAmount);
        }

        emit RewardQueued(
            token,
            amount,
            userAmount,
            treasuryAmount,
            adminAmount,
            baseRewardPerVlSDT,
            userAmount == 0 ? 0 : uint256(data.pendingSince) + REWARD_CYCLE_INTERVAL
        );
    }

    function startRewardCycle(address token) external nonReentrant returns (uint256 amount) {
        if (!isRewardToken[token]) revert UnsupportedRewardToken();
        _checkpointReward(token);
        amount = _startRewardCycle(token, true);
    }

    function claimRewards(address receiver) external nonReentrant {
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointAll(msg.sender);
        _startReadyCycles();
        for (uint256 i; i < rewardTokens.length; ++i) {
            address token = rewardTokens[i];
            uint256 amount = accruedRewards[msg.sender][token];
            if (amount == 0) continue;
            accruedRewards[msg.sender][token] = 0;
            IERC20(token).safeTransfer(receiver, amount);
            emit RewardClaimed(msg.sender, token, receiver, amount);
        }
    }

    function claimGovernance(address receiver) external nonReentrant returns (uint256 amount) {
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointAll(msg.sender);
        _startReadyCycles();

        uint256 emissionAmount = accruedGovernance[msg.sender];
        uint256 fundedAmount = accruedFundedGovernance[msg.sender];

        accruedGovernance[msg.sender] = 0;
        accruedFundedGovernance[msg.sender] = 0;
        if (emissionAmount != 0) {
            GOVERNANCE_TOKEN.mintReserved(
                governanceEmissionReservationId, receiver, emissionAmount
            );
        }
        if (fundedAmount != 0) {
            IERC20(address(GOVERNANCE_TOKEN)).safeTransfer(receiver, fundedAmount);
        }
        amount = emissionAmount + fundedAmount;
        emit GovernanceRewardClaimed(msg.sender, receiver, amount);
    }

    function earned(address user, address token) external view returns (uint256) {
        if (!isRewardToken[token]) return 0;
        uint256 rewardPerToken = _previewRewardPerToken(token);
        return accruedRewards[user][token]
            + Math.mulDiv(activeBalance[user], rewardPerToken - userRewardPerTokenPaid[user][token], PRECISION);
    }

    function earnedGovernance(address user) external view returns (uint256) {
        uint256 rewardPerToken = _previewGovernanceRewardPerToken();
        uint256 fundedRewardPerToken = _previewFundedGovernanceRewardPerToken();
        return accruedGovernance[user]
            + Math.mulDiv(activeBalance[user], rewardPerToken - userGovernanceRewardPerTokenPaid[user], PRECISION)
            + accruedFundedGovernance[user]
            + Math.mulDiv(
                activeBalance[user],
                fundedRewardPerToken - userFundedGovernanceRewardPerTokenPaid[user],
                PRECISION
            );
    }

    function _checkpointAll(address account) internal {
        _checkpointGovernance(account);
        _checkpointFundedGovernance(account);
        for (uint256 i; i < rewardTokens.length; ++i) {
            address token = rewardTokens[i];
            _checkpointReward(token);
            if (account != address(0)) _checkpointUser(account, token);
        }
    }

    function _checkpointGovernance(address account) internal {
        uint256 current = governanceRewardPerTokenStored;
        uint256 timestamp = block.timestamp;
        uint256 supply = totalActiveStake;
        if (timestamp != governanceLastUpdate && supply != 0 && governanceEmissionRate != 0) {
            uint256 requested = governanceEmissionRate * (timestamp - governanceLastUpdate);
            (uint256 reservationId, uint256 reservedAmount) = GOVERNANCE_TOKEN
                .increaseMintReservationUpTo(
                    governanceEmissionReservationId, requested, timestamp
                );
            if (reservationId != 0) governanceEmissionReservationId = reservationId;
            if (reservedAmount != 0) {
                current += Math.mulDiv(reservedAmount, PRECISION, supply);
            }
        }
        governanceRewardPerTokenStored = current;
        governanceLastUpdate = timestamp;
        if (account != address(0)) {
            uint256 paid = userGovernanceRewardPerTokenPaid[account];
            if (current != paid) {
                accruedGovernance[account] += Math.mulDiv(
                    activeBalance[account], current - paid, PRECISION
                );
                userGovernanceRewardPerTokenPaid[account] = current;
            }
        }
    }

    function _previewGovernanceRewardPerToken() internal view returns (uint256 rewardPerToken) {
        rewardPerToken = governanceRewardPerTokenStored;
        uint256 supply = totalActiveStake;
        if (block.timestamp == governanceLastUpdate || supply == 0 || governanceEmissionRate == 0) {
            return rewardPerToken;
        }
        uint256 requested = governanceEmissionRate * (block.timestamp - governanceLastUpdate);
        uint256 available = GOVERNANCE_TOKEN.availableMintableFor(address(this));
        uint256 emitted = requested > available ? available : requested;
        rewardPerToken += Math.mulDiv(emitted, PRECISION, supply);
    }

    function _checkpointFundedGovernance(address account) internal {
        uint256 supply = totalActiveStake;
        if (supply != 0 && queuedFundedGovernanceRewards != 0) {
            uint256 scaled = queuedFundedGovernanceRewards * PRECISION + fundedGovernanceScaledRemainder;
            fundedGovernanceRewardPerTokenStored += scaled / supply;
            fundedGovernanceScaledRemainder = scaled % supply;
            queuedFundedGovernanceRewards = 0;
        }
        if (account != address(0)) {
            uint256 current = fundedGovernanceRewardPerTokenStored;
            uint256 paid = userFundedGovernanceRewardPerTokenPaid[account];
            if (current != paid) {
                accruedFundedGovernance[account] += Math.mulDiv(
                    activeBalance[account], current - paid, PRECISION
                );
                userFundedGovernanceRewardPerTokenPaid[account] = current;
            }
        }
    }

    function _previewFundedGovernanceRewardPerToken() internal view returns (uint256 rewardPerToken) {
        rewardPerToken = fundedGovernanceRewardPerTokenStored;
        if (totalActiveStake != 0 && queuedFundedGovernanceRewards != 0) {
            rewardPerToken += (queuedFundedGovernanceRewards * PRECISION + fundedGovernanceScaledRemainder)
                / totalActiveStake;
        }
    }

    function governanceMintCapacity() external view returns (uint256) {
        return GOVERNANCE_TOKEN.availableMintableFor(address(this));
    }

    function _checkpointUser(address account, address token) internal {
        RewardData storage data = _rewardData[token];
        uint256 paid = userRewardPerTokenPaid[account][token];
        uint256 current = data.rewardPerActiveStored;
        if (current != paid) {
            accruedRewards[account][token] += Math.mulDiv(activeBalance[account], current - paid, PRECISION);
            userRewardPerTokenPaid[account][token] = current;
        }
    }

    function _checkpointReward(address token) internal {
        RewardData storage data = _rewardData[token];
        uint256 from = data.lastUpdate;
        uint256 to = block.timestamp;
        if (from == 0) {
            data.lastUpdate = uint64(to);
            return;
        }
        if (to == from) return;

        uint256 gross = _streamedBetween(data, from, to);
        if (gross != 0) {
            uint256 active = totalActiveStake;
            if (active == 0) {
                data.pendingUserRewards += gross;
                if (data.pendingSince == 0) data.pendingSince = uint64(to);
                emit RewardRequeued(token, gross, uint256(data.pendingSince) + REWARD_CYCLE_INTERVAL);
            } else {
                uint256 scaled = gross * PRECISION + data.scaledRemainder;
                uint256 delta = scaled / active;
                data.scaledRemainder = scaled % active;
                data.rewardPerActiveStored += delta;
            }
        }
        data.lastUpdate = uint64(to);

        uint256 head = data.streamHead;
        while (head < data.streams.length && data.streams[head].end <= to) ++head;
        data.streamHead = uint64(head);
    }

    function _previewRewardPerToken(address token) internal view returns (uint256 rewardPerToken) {
        RewardData storage data = _rewardData[token];
        rewardPerToken = data.rewardPerActiveStored;
        if (data.lastUpdate == 0 || data.lastUpdate == block.timestamp || totalActiveStake == 0) {
            return rewardPerToken;
        }
        uint256 gross = _streamedBetween(data, data.lastUpdate, block.timestamp);
        if (gross == 0) return rewardPerToken;
        return rewardPerToken + (gross * PRECISION + data.scaledRemainder) / totalActiveStake;
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

    function _splitIncomingReward(uint256 amount, uint256 baseRewardPerVlSDT)
        internal
        view
        returns (uint256 userAmount, uint256 treasuryAmount, uint256 adminAmount)
    {
        uint256 active = totalActiveStake;
        uint256 queued = totalQueuedStake;
        if (active == 0) return (0, amount, 0);

        uint256 baseActive = Math.mulDiv(baseRewardPerVlSDT, active, BASE_PRECISION);
        uint256 baseQueued = Math.mulDiv(baseRewardPerVlSDT, queued, BASE_PRECISION);
        uint256 represented = baseActive + baseQueued;
        if (represented > amount) {
            uint256 totalRepresentedStake = active + queued;
            baseActive = Math.mulDiv(amount, active, totalRepresentedStake);
            baseQueued = amount - baseActive;
            represented = amount;
        }

        uint256 excess = amount - represented;
        treasuryAmount = baseQueued + Math.mulDiv(excess, EXCESS_TREASURY_BPS, BPS);
        adminAmount = Math.mulDiv(excess, EXCESS_ADMIN_BPS, BPS);
        userAmount = amount - treasuryAmount - adminAmount;
    }

    function _startReadyCycles() internal {
        for (uint256 i; i < rewardTokens.length; ++i) {
            _startRewardCycle(rewardTokens[i], false);
        }
    }

    function _startRewardCycle(address token, bool strict) internal returns (uint256 amount) {
        RewardData storage data = _rewardData[token];
        amount = data.pendingUserRewards;
        if (amount == 0) {
            if (strict) revert NoPendingRewards();
            return 0;
        }
        if (totalActiveStake == 0) {
            if (strict) revert NoActiveStake();
            return 0;
        }

        uint256 readyAt = uint256(data.pendingSince) + REWARD_CYCLE_INTERVAL;
        if (block.timestamp < readyAt) {
            if (strict) revert CycleNotReady(readyAt);
            return 0;
        }
        if (data.streams.length - uint256(data.streamHead) >= MAX_ACTIVE_STREAMS_PER_TOKEN) {
            if (strict) revert ActiveStreamLimit();
            return 0;
        }

        data.pendingUserRewards = 0;
        data.pendingSince = 0;
        uint64 start = uint64(block.timestamp);
        uint64 end = uint64(block.timestamp + STREAM_DURATION);
        data.lastCycleStart = start;
        data.streams.push(Stream(amount, start, end));
        emit RewardCycleStarted(token, amount, start, end);
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
}
