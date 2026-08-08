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
import {
    ICurveYieldVlSDTLocker,
    ICurveYieldGovernanceToken
} from "./interfaces/ICurveYield.sol";

contract CurveYieldVlSDTBoostStaking is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant WEEK = 7 days;
    uint256 public constant PRECISION = 1e18;
    uint256 public constant REWARD_PRECISION = 1e27;
    uint256 public constant ABSOLUTE_MIN_MULTIPLIER = 2e18;
    uint256 public constant ABSOLUTE_MAX_MULTIPLIER = 10e18;
    uint256 public constant MAX_DURATION_WEEKS = 52;
    uint256 public constant MINT_TIMELOCK_ACTIVATION_DELAY = 7 days;
    uint256 public constant MINT_APPROVAL_DELAY = 7 days;

    struct Delegation {
        address owner;
        address recipient;
        uint128 boostAmount;
        uint128 reservedCyvlSDT;
        uint64 endtime;
        uint64 unlockTime;
        uint256 lockerCommitmentId;
        bool active;
    }

    IERC20 public immutable CYVLSDT;
    ICurveYieldVlSDTLocker public immutable LOCKER;
    ICurveYieldGovernanceToken public immutable GOVERNANCE_TOKEN;

    mapping(address => uint256) public depositedBalance;
    mapping(address => uint256) public reservedBalance;
    uint256 public totalDeposited;
    uint256 public nextDelegationId = 1;
    mapping(uint256 => Delegation) public delegations;

    uint256 public minimumMultiplier = 2e18;
    uint256 public maximumMultiplier = 10e18;

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

    error ZeroAddress();
    error ZeroAmount();
    error InvalidDuration();
    error InsufficientFreeBalance();
    error InsufficientBoostCapacity();
    error InvalidDelegation();
    error NotInRedelegationWindow();
    error CooldownNotComplete();
    error ValueTooLarge();
    error InvalidMultiplierRange();
    error MintApprovalNotPending();
    error MintApprovalNotReady();
    error PeriodicMintNotReady();
    error InvalidPeriodicMintConfig();
    error MintApprovalAlreadyPending();
    error PeriodicMintReservationMissing();

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, address indexed receiver, uint256 amount);
    event BoostDelegated(
        uint256 indexed id,
        address indexed owner,
        address indexed recipient,
        uint256 boostAmount,
        uint256 reservedCyvlSDT,
        uint256 multiplier,
        uint256 endtime,
        uint256 unlockTime
    );
    event BoostRedelegated(
        uint256 indexed id,
        address indexed recipient,
        uint256 boostAmount,
        uint256 reservedCyvlSDT
    );
    event DelegationReleased(uint256 indexed id, address indexed owner, uint256 reservedCyvlSDT);
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
    event MultiplierRangeSet(uint256 oldMinimum, uint256 oldMaximum, uint256 newMinimum, uint256 newMaximum);
    event GovernanceRewardClaimed(address indexed user, address indexed receiver, uint256 amount);

    constructor(address initialOwner_, address cyvlSdt_, address locker_, address governanceToken_) Ownable(initialOwner_) {
        if (
            initialOwner_ == address(0) || cyvlSdt_ == address(0) || locker_ == address(0)
                || governanceToken_ == address(0)
        ) revert ZeroAddress();
        CYVLSDT = IERC20(cyvlSdt_);
        LOCKER = ICurveYieldVlSDTLocker(locker_);
        GOVERNANCE_TOKEN = ICurveYieldGovernanceToken(governanceToken_);
        governanceLastUpdate = block.timestamp;
        mintTimelocksActiveAt = uint64(block.timestamp + MINT_TIMELOCK_ACTIVATION_DELAY);
    }

    function setMultiplierRange(uint256 newMinimum, uint256 newMaximum) external onlyOwner {
        if (
            newMinimum < ABSOLUTE_MIN_MULTIPLIER || newMaximum > ABSOLUTE_MAX_MULTIPLIER
                || newMinimum > newMaximum
        ) revert InvalidMultiplierRange();
        emit MultiplierRangeSet(minimumMultiplier, maximumMultiplier, newMinimum, newMaximum);
        minimumMultiplier = newMinimum;
        maximumMultiplier = newMaximum;
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
        uint256 supply = totalDeposited;
        if (supply == 0) {
            queuedFundedGovernanceRewards += amount;
        } else {
            uint256 scaled = amount * REWARD_PRECISION + fundedGovernanceScaledRemainder;
            fundedGovernanceRewardPerTokenStored += scaled / supply;
            fundedGovernanceScaledRemainder = scaled % supply;
        }
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _checkpointGovernance(msg.sender);
        _checkpointFundedGovernance(msg.sender);
        CYVLSDT.safeTransferFrom(msg.sender, address(this), amount);
        depositedBalance[msg.sender] += amount;
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount, address receiver) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointGovernance(msg.sender);
        _checkpointFundedGovernance(msg.sender);
        if (amount > depositedBalance[msg.sender] - reservedBalance[msg.sender]) {
            revert InsufficientFreeBalance();
        }
        depositedBalance[msg.sender] -= amount;
        totalDeposited -= amount;
        CYVLSDT.safeTransfer(receiver, amount);
        emit Withdrawn(msg.sender, receiver, amount);
    }

    function claimGovernance(address receiver) external nonReentrant returns (uint256 amount) {
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointGovernance(msg.sender);
        _checkpointFundedGovernance(msg.sender);

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

    function earnedGovernance(address user) external view returns (uint256) {
        uint256 rewardPerToken = _previewGovernanceRewardPerToken();
        uint256 fundedRewardPerToken = _previewFundedGovernanceRewardPerToken();
        return accruedGovernance[user]
            + Math.mulDiv(
                depositedBalance[user],
                rewardPerToken - userGovernanceRewardPerTokenPaid[user],
                REWARD_PRECISION
            )
            + accruedFundedGovernance[user]
            + Math.mulDiv(
                depositedBalance[user],
                fundedRewardPerToken - userFundedGovernanceRewardPerTokenPaid[user],
                REWARD_PRECISION
            );
    }

    function currentMultiplier() public view returns (uint256 multiplier) {
        uint256 capacity = LOCKER.boostStakingBoostCapacity();
        if (capacity == 0) return minimumMultiplier;
        uint256 available = LOCKER.boostStakingDelegableBoost();
        if (available > capacity) available = capacity;
        multiplier = minimumMultiplier
            + Math.mulDiv(maximumMultiplier - minimumMultiplier, available, capacity);
    }

    function requiredCyvlSDT(uint256 boostAmount) public view returns (uint256) {
        return Math.ceilDiv(boostAmount * PRECISION, currentMultiplier());
    }

    function delegate(uint256 boostAmount, uint256 durationWeeks, address recipient)
        external
        nonReentrant
        returns (uint256 id, uint256 endtime)
    {
        return _delegateNew(msg.sender, boostAmount, durationWeeks, recipient);
    }

    function redelegate(uint256 id, uint256 boostAmount, uint256 durationWeeks, address recipient)
        external
        nonReentrant
        returns (uint256 endtime)
    {
        Delegation storage oldDelegation = delegations[id];
        if (!oldDelegation.active || oldDelegation.owner != msg.sender) revert InvalidDelegation();
        if (block.timestamp < oldDelegation.endtime || block.timestamp >= oldDelegation.unlockTime) {
            revert NotInRedelegationWindow();
        }
        if (recipient == address(0)) revert ZeroAddress();
        if (boostAmount == 0) revert ZeroAmount();

        uint256 oldReserved = oldDelegation.reservedCyvlSDT;
        reservedBalance[msg.sender] -= oldReserved;
        _releaseLockerCommitment(oldDelegation.lockerCommitmentId);

        uint256 multiplier = currentMultiplier();
        uint256 newReserved = _required(boostAmount, multiplier);
        if (newReserved > depositedBalance[msg.sender] - reservedBalance[msg.sender]) {
            revert InsufficientFreeBalance();
        }
        if (boostAmount > LOCKER.boostStakingDelegableBoost()) revert InsufficientBoostCapacity();

        endtime = _alignedEndtime(durationWeeks);
        uint256 unlockTime = endtime + WEEK;
        if (boostAmount > type(uint128).max || newReserved > type(uint128).max) revert ValueTooLarge();

        reservedBalance[msg.sender] += newReserved;
        oldDelegation.recipient = recipient;
        oldDelegation.boostAmount = uint128(boostAmount);
        oldDelegation.reservedCyvlSDT = uint128(newReserved);
        oldDelegation.endtime = uint64(endtime);
        oldDelegation.unlockTime = uint64(unlockTime);

        oldDelegation.lockerCommitmentId = LOCKER.delegateBoost(boostAmount, endtime, recipient);
        emit BoostRedelegated(id, recipient, boostAmount, newReserved);
    }

    function releaseDelegation(uint256 id) external {
        Delegation storage delegation = delegations[id];
        if (!delegation.active) revert InvalidDelegation();
        if (block.timestamp < delegation.unlockTime) revert CooldownNotComplete();
        delegation.active = false;
        reservedBalance[delegation.owner] -= delegation.reservedCyvlSDT;
        _releaseLockerCommitment(delegation.lockerCommitmentId);
        emit DelegationReleased(id, delegation.owner, delegation.reservedCyvlSDT);
    }

    function _delegateNew(address user, uint256 boostAmount, uint256 durationWeeks, address recipient)
        internal
        returns (uint256 id, uint256 endtime)
    {
        if (boostAmount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        uint256 multiplier = currentMultiplier();
        uint256 reserve = _required(boostAmount, multiplier);
        if (reserve > depositedBalance[user] - reservedBalance[user]) revert InsufficientFreeBalance();
        if (boostAmount > LOCKER.boostStakingDelegableBoost()) revert InsufficientBoostCapacity();

        endtime = _alignedEndtime(durationWeeks);
        uint256 unlockTime = endtime + WEEK;
        if (boostAmount > type(uint128).max || reserve > type(uint128).max) revert ValueTooLarge();

        uint256 lockerCommitmentId = LOCKER.delegateBoost(boostAmount, endtime, recipient);

        id = nextDelegationId++;
        reservedBalance[user] += reserve;
        delegations[id] = Delegation(
            user,
            recipient,
            uint128(boostAmount),
            uint128(reserve),
            uint64(endtime),
            uint64(unlockTime),
            lockerCommitmentId,
            true
        );
        emit BoostDelegated(id, user, recipient, boostAmount, reserve, multiplier, endtime, unlockTime);
    }

    function _releaseLockerCommitment(uint256 commitmentId) internal {
        try LOCKER.releaseModuleBoostCommitment(commitmentId) {} catch {}
    }

    function _checkpointGovernance(address account) internal {
        uint256 current = governanceRewardPerTokenStored;
        uint256 timestamp = block.timestamp;
        uint256 supply = totalDeposited;
        if (timestamp != governanceLastUpdate && supply != 0 && governanceEmissionRate != 0) {
            uint256 requested = governanceEmissionRate * (timestamp - governanceLastUpdate);
            (uint256 reservationId, uint256 reservedAmount) = GOVERNANCE_TOKEN
                .increaseMintReservationUpTo(
                    governanceEmissionReservationId, requested, timestamp
                );
            if (reservationId != 0) governanceEmissionReservationId = reservationId;
            if (reservedAmount != 0) {
                current += Math.mulDiv(reservedAmount, REWARD_PRECISION, supply);
            }
        }
        governanceRewardPerTokenStored = current;
        governanceLastUpdate = timestamp;
        if (account != address(0)) {
            uint256 paid = userGovernanceRewardPerTokenPaid[account];
            if (current != paid) {
                accruedGovernance[account] += Math.mulDiv(
                    depositedBalance[account], current - paid, REWARD_PRECISION
                );
                userGovernanceRewardPerTokenPaid[account] = current;
            }
        }
    }

    function _previewGovernanceRewardPerToken() internal view returns (uint256 rewardPerToken) {
        rewardPerToken = governanceRewardPerTokenStored;
        uint256 supply = totalDeposited;
        if (block.timestamp == governanceLastUpdate || supply == 0 || governanceEmissionRate == 0) {
            return rewardPerToken;
        }
        uint256 requested = governanceEmissionRate * (block.timestamp - governanceLastUpdate);
        uint256 available = GOVERNANCE_TOKEN.availableMintableFor(address(this));
        uint256 emitted = requested > available ? available : requested;
        rewardPerToken += Math.mulDiv(emitted, REWARD_PRECISION, supply);
    }

    function _checkpointFundedGovernance(address account) internal {
        uint256 supply = totalDeposited;
        if (supply != 0 && queuedFundedGovernanceRewards != 0) {
            uint256 scaled = queuedFundedGovernanceRewards * REWARD_PRECISION
                + fundedGovernanceScaledRemainder;
            fundedGovernanceRewardPerTokenStored += scaled / supply;
            fundedGovernanceScaledRemainder = scaled % supply;
            queuedFundedGovernanceRewards = 0;
        }
        if (account != address(0)) {
            uint256 current = fundedGovernanceRewardPerTokenStored;
            uint256 paid = userFundedGovernanceRewardPerTokenPaid[account];
            if (current != paid) {
                accruedFundedGovernance[account] += Math.mulDiv(
                    depositedBalance[account], current - paid, REWARD_PRECISION
                );
                userFundedGovernanceRewardPerTokenPaid[account] = current;
            }
        }
    }

    function _previewFundedGovernanceRewardPerToken() internal view returns (uint256 rewardPerToken) {
        rewardPerToken = fundedGovernanceRewardPerTokenStored;
        if (totalDeposited != 0 && queuedFundedGovernanceRewards != 0) {
            rewardPerToken += (queuedFundedGovernanceRewards * REWARD_PRECISION
                + fundedGovernanceScaledRemainder) / totalDeposited;
        }
    }

    function governanceMintCapacity() external view returns (uint256) {
        return GOVERNANCE_TOKEN.availableMintableFor(address(this));
    }

    function _required(uint256 boostAmount, uint256 multiplier) internal pure returns (uint256) {
        return Math.ceilDiv(boostAmount * PRECISION, multiplier);
    }

    function _alignedEndtime(uint256 durationWeeks) internal view returns (uint256 endtime) {
        if (durationWeeks == 0 || durationWeeks > MAX_DURATION_WEEKS) revert InvalidDuration();
        endtime = Math.ceilDiv(block.timestamp + durationWeeks * WEEK, WEEK) * WEEK;
    }
}
