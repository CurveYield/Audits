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
    ICurveYieldVlSDTLockerV17,
    ICurveYieldGovernanceTokenV17
} from "./interfaces/ICurveYieldV17.sol";

contract CurveYieldVlSDTBoostStakingV17 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant WEEK = 7 days;
    uint256 public constant PRECISION = 1e18;
    uint256 public constant REWARD_PRECISION = 1e27;
    uint256 public constant ABSOLUTE_MIN_MULTIPLIER = 2e18;
    uint256 public constant ABSOLUTE_MAX_MULTIPLIER = 10e18;
    uint256 public constant MAX_DURATION_WEEKS = 52;

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
    ICurveYieldVlSDTLockerV17 public immutable LOCKER;
    ICurveYieldGovernanceTokenV17 public immutable GOVERNANCE_TOKEN;

    mapping(address => uint256) public depositedBalance;
    mapping(address => uint256) public reservedBalance;
    uint256 public totalDeposited;
    uint256 public nextDelegationId = 1;
    mapping(uint256 => Delegation) public delegations;

    uint256 public minimumMultiplier = 2e18;
    uint256 public maximumMultiplier = 10e18;

    uint256 public governanceEmissionRate;
    uint256 public governanceLastUpdate;
    uint256 public governanceRewardPerTokenStored;
    mapping(address => uint256) public userGovernanceRewardPerTokenPaid;
    mapping(address => uint256) public accruedGovernance;

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
    event MultiplierRangeSet(uint256 oldMinimum, uint256 oldMaximum, uint256 newMinimum, uint256 newMaximum);
    event GovernanceRewardClaimed(address indexed user, address indexed receiver, uint256 amount);

    constructor(address initialOwner_, address cyvlSdt_, address locker_, address governanceToken_) Ownable(initialOwner_) {
        if (
            initialOwner_ == address(0) || cyvlSdt_ == address(0) || locker_ == address(0)
                || governanceToken_ == address(0)
        ) revert ZeroAddress();
        CYVLSDT = IERC20(cyvlSdt_);
        LOCKER = ICurveYieldVlSDTLockerV17(locker_);
        GOVERNANCE_TOKEN = ICurveYieldGovernanceTokenV17(governanceToken_);
        governanceLastUpdate = block.timestamp;
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
        _checkpointGovernance(address(0));
        emit GovernanceEmissionRateSet(governanceEmissionRate, newRate);
        governanceEmissionRate = newRate;
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _checkpointGovernance(msg.sender);
        CYVLSDT.safeTransferFrom(msg.sender, address(this), amount);
        depositedBalance[msg.sender] += amount;
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount, address receiver) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointGovernance(msg.sender);
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
        amount = accruedGovernance[msg.sender];
        accruedGovernance[msg.sender] = 0;
        if (amount != 0) GOVERNANCE_TOKEN.mint(receiver, amount);
        emit GovernanceRewardClaimed(msg.sender, receiver, amount);
    }

    function earnedGovernance(address user) external view returns (uint256) {
        uint256 rewardPerToken = _previewGovernanceRewardPerToken();
        return accruedGovernance[user]
            + Math.mulDiv(
                depositedBalance[user],
                rewardPerToken - userGovernanceRewardPerTokenPaid[user],
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
        uint256 current = _previewGovernanceRewardPerToken();
        governanceRewardPerTokenStored = current;
        governanceLastUpdate = block.timestamp;

        if (account != address(0)) {
            uint256 paid = userGovernanceRewardPerTokenPaid[account];
            if (current != paid) {
                accruedGovernance[account] +=
                    Math.mulDiv(depositedBalance[account], current - paid, REWARD_PRECISION);
                userGovernanceRewardPerTokenPaid[account] = current;
            }
        }
    }

    function _previewGovernanceRewardPerToken() internal view returns (uint256 rewardPerToken) {
        rewardPerToken = governanceRewardPerTokenStored;
        if (block.timestamp == governanceLastUpdate || totalDeposited == 0) return rewardPerToken;
        uint256 emitted = governanceEmissionRate * (block.timestamp - governanceLastUpdate);
        rewardPerToken += Math.mulDiv(emitted, REWARD_PRECISION, totalDeposited);
    }

    function _required(uint256 boostAmount, uint256 multiplier) internal pure returns (uint256) {
        return Math.ceilDiv(boostAmount * PRECISION, multiplier);
    }

    function _alignedEndtime(uint256 durationWeeks) internal view returns (uint256 endtime) {
        if (durationWeeks == 0 || durationWeeks > MAX_DURATION_WEEKS) revert InvalidDuration();
        endtime = Math.ceilDiv(block.timestamp + durationWeeks * WEEK, WEEK) * WEEK;
    }
}
