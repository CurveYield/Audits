// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICurveYieldGovernanceToken} from "./interfaces/ICurveYield.sol";

/// @notice Stakes cyvlSDT for cyGOV-only yield with resource-backed emissions.
/// @dev User principal is represented by non-transferable shares. The principal index is reduced
/// lazily by an additive linear rate-seconds schedule whenever a standard state-changing interaction occurs.
contract CurveYieldCyGovYieldStaking is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant DECAY_DENOMINATOR = BPS * 1 days;
    uint256 public constant INDEX_PRECISION = 1e27;
    uint256 public constant TARGET_YIELD_PRECISION = 1e18;
    uint256 public constant BACKING_DAYS = 30;
    uint256 public constant INITIAL_DIRECT_MINT_CAP = 15_000_000_000 ether;
    uint256 public constant MAX_WITHDRAW_FEE_BPS = 400;
    uint256 public constant DEFAULT_WITHDRAW_FEE_BPS = 200;
    uint256 public constant MAX_DAILY_DECAY_RATE = 10;
    uint256 public constant DEFAULT_DAILY_DECAY_RATE = 3;
    uint256 public constant CONFIG_TIMELOCK_ACTIVATION_DELAY = 7 days;
    uint256 public constant CONFIG_CHANGE_DELAY = 14 days;

    uint8 internal constant CONFIG_TARGET_YIELD = 1;
    uint8 internal constant CONFIG_MAX_MINT_RATE = 2;
    uint8 internal constant CONFIG_WITHDRAW_FEE = 3;
    uint8 internal constant CONFIG_DAILY_DECAY = 4;

    struct PendingConfig {
        uint256 value;
        uint64 readyAt;
        bool pending;
    }

    IERC20 public immutable CYVLSDT;
    ICurveYieldGovernanceToken public immutable GOVERNANCE_TOKEN;
    uint64 public immutable deploymentTimestamp;
    uint64 public immutable configTimelocksActiveAt;

    address public treasuryReceiver;
    uint256 public targetYield;
    uint256 public maxMintRate;
    uint16 public withdrawFeeBps = uint16(DEFAULT_WITHDRAW_FEE_BPS);
    uint8 public dailyDecayRate = uint8(DEFAULT_DAILY_DECAY_RATE);

    uint256 public principalIndex = INDEX_PRECISION;
    uint256 public cumulativeDecayUnits;
    uint256 public totalShares;
    uint256 public stakeEpoch;
    uint64 public lastDecayCheckpoint;
    mapping(address => uint256) public userShares;
    mapping(address => uint256) public userStakeEpoch;

    uint256 public rewardPerShareStored;
    uint256 public rewardScaledRemainder;
    uint64 public rewardLastUpdate;
    uint256 public totalRewardLiability;
    mapping(address => uint256) public userRewardPerSharePaid;
    mapping(address => uint256) public accruedRewards;
    mapping(uint256 => uint256) public epochFinalRewardPerShare;

    uint256 public mintReservationId;
    uint256 public lockedMintReserveAmount;
    uint256 public initialInventoryMinted;
    mapping(uint8 => PendingConfig) public pendingConfig;

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientStake();
    error InvalidFee();
    error InvalidDecayRate();
    error InvalidConfigType();
    error ConfigNotPending();
    error ConfigNotReady();
    error InsufficientMintBacking(uint256 required, uint256 available);
    error InitialInventoryCapExceeded(uint256 requested, uint256 remaining);
    error RewardFundingInvariant();
    error ValueTooLarge();

    event Staked(address indexed user, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, address indexed receiver, uint256 grossAmount, uint256 fee);
    event RewardClaimed(address indexed user, address indexed receiver, uint256 amount);
    event RewardsAccrued(uint256 amount, uint256 dailyRate, uint256 elapsed);
    event DecaySettled(uint256 elapsedSeconds, uint256 rate, uint256 amount);
    event StakeEpochClosed(uint256 indexed epoch, uint256 finalRewardPerShare);
    event TreasuryReceiverSet(address indexed oldReceiver, address indexed newReceiver);
    event ConfigQueued(uint8 indexed configType, uint256 value, uint256 readyAt);
    event ConfigApplied(uint8 indexed configType, uint256 oldValue, uint256 newValue);
    event ConfigCancelled(uint8 indexed configType, uint256 value);
    event MintReserveRebalanced(uint256 indexed reservationId, uint256 lockedAmount, uint256 requiredAmount);
    event InitialInventoryMinted(uint256 amount, uint256 cumulativeAmount);

    constructor(
        address initialOwner_,
        address cyvlSdt_,
        address governanceToken_,
        address initialTreasuryReceiver_
    ) Ownable(initialOwner_) {
        if (
            initialOwner_ == address(0) || cyvlSdt_ == address(0)
                || governanceToken_ == address(0) || initialTreasuryReceiver_ == address(0)
        ) revert ZeroAddress();
        CYVLSDT = IERC20(cyvlSdt_);
        GOVERNANCE_TOKEN = ICurveYieldGovernanceToken(governanceToken_);
        treasuryReceiver = initialTreasuryReceiver_;
        deploymentTimestamp = uint64(block.timestamp);
        configTimelocksActiveAt = uint64(block.timestamp + CONFIG_TIMELOCK_ACTIVATION_DELAY);
        lastDecayCheckpoint = uint64(block.timestamp);
        rewardLastUpdate = uint64(block.timestamp);
        emit TreasuryReceiverSet(address(0), initialTreasuryReceiver_);
    }

    function setTreasuryReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        emit TreasuryReceiverSet(treasuryReceiver, newReceiver);
        treasuryReceiver = newReceiver;
    }

    /// @notice cyGOV paid per 1e18 cyvlSDT per day, expressed with 1e18 precision.
    function setTargetYield(uint256 newTargetYield) external onlyOwner nonReentrant {
        _checkpointGlobal();
        _setOrQueue(CONFIG_TARGET_YIELD, newTargetYield);
    }

    /// @notice Preferred upper bound for total cyGOV distributed each day.
    /// @dev Applying this setting atomically locks enough mint capacity to provide 30 days of
    /// backing after counting free cyGOV inventory already held by the contract.
    function setMaxMintRate(uint256 newMaxMintRate) external onlyOwner nonReentrant {
        _checkpointGlobal();
        _setOrQueue(CONFIG_MAX_MINT_RATE, newMaxMintRate);
    }

    function setWithdrawFeeBps(uint256 newFeeBps) external onlyOwner nonReentrant {
        if (newFeeBps > MAX_WITHDRAW_FEE_BPS) revert InvalidFee();
        _checkpointGlobal();
        _setOrQueue(CONFIG_WITHDRAW_FEE, newFeeBps);
    }

    function setDailyDecayRate(uint256 newDailyDecayRate) external onlyOwner nonReentrant {
        if (newDailyDecayRate > MAX_DAILY_DECAY_RATE) revert InvalidDecayRate();
        _checkpointGlobal();
        _setOrQueue(CONFIG_DAILY_DECAY, newDailyDecayRate);
    }

    function executeConfig(uint8 configType) external nonReentrant {
        PendingConfig memory pending = pendingConfig[configType];
        if (!pending.pending) revert ConfigNotPending();
        if (block.timestamp < pending.readyAt) revert ConfigNotReady();
        _checkpointGlobal();
        _applyConfig(configType, pending.value);
        delete pendingConfig[configType];
    }

    function cancelConfig(uint8 configType) external onlyOwner {
        PendingConfig memory pending = pendingConfig[configType];
        if (!pending.pending) revert ConfigNotPending();
        delete pendingConfig[configType];
        emit ConfigCancelled(configType, pending.value);
    }

    /// @notice Mints still-unused original 15B allocation into reward inventory.
    /// @dev All minted rewards count against the same original allowance first. This prevents an
    /// inventory mint from silently consuming the contract's later ongoing allocation.
    function mintInitialInventory(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _checkpointGlobal();
        uint256 alreadyMinted = GOVERNANCE_TOKEN.mintedByMinter(address(this));
        uint256 remaining = alreadyMinted < INITIAL_DIRECT_MINT_CAP
            ? INITIAL_DIRECT_MINT_CAP - alreadyMinted
            : 0;
        if (amount > remaining) revert InitialInventoryCapExceeded(amount, remaining);

        uint256 fromReserve = amount < lockedMintReserveAmount ? amount : lockedMintReserveAmount;
        if (fromReserve != 0) {
            GOVERNANCE_TOKEN.mintReserved(mintReservationId, address(this), fromReserve);
            lockedMintReserveAmount -= fromReserve;
        }
        uint256 unreserved = amount - fromReserve;
        if (unreserved != 0) GOVERNANCE_TOKEN.mint(address(this), unreserved);
        initialInventoryMinted += amount;
        emit InitialInventoryMinted(amount, initialInventoryMinted);
    }

    function stake(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        _checkpointGlobal();
        _checkpointUser(msg.sender);
        uint256 index = principalIndex;
        shares = Math.mulDiv(amount, INDEX_PRECISION, index);
        if (shares == 0) revert ZeroAmount();
        CYVLSDT.safeTransferFrom(msg.sender, address(this), amount);
        userShares[msg.sender] += shares;
        totalShares += shares;
        emit Staked(msg.sender, amount, shares);
    }

    function withdraw(uint256 amount, address receiver) public nonReentrant returns (uint256 received) {
        if (amount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointGlobal();
        _checkpointUser(msg.sender);
        uint256 currentBalance = balanceOf(msg.sender);
        if (amount > currentBalance) revert InsufficientStake();
        uint256 sharesToBurn = Math.mulDiv(amount, INDEX_PRECISION, principalIndex);
        if (sharesToBurn == 0) revert ZeroAmount();
        received = _withdrawShares(msg.sender, sharesToBurn, receiver);
    }

    function withdrawAll(address receiver) external nonReentrant returns (uint256 received) {
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointGlobal();
        _checkpointUser(msg.sender);
        uint256 shares = userShares[msg.sender];
        if (shares == 0) revert ZeroAmount();
        received = _withdrawShares(msg.sender, shares, receiver);
    }

    function claim(address receiver) public nonReentrant returns (uint256 amount) {
        if (receiver == address(0)) revert ZeroAddress();
        _checkpointGlobal();
        _checkpointUser(msg.sender);
        amount = accruedRewards[msg.sender];
        if (amount == 0) return 0;
        accruedRewards[msg.sender] = 0;
        totalRewardLiability -= amount;
        IERC20(address(GOVERNANCE_TOKEN)).safeTransfer(receiver, amount);
        emit RewardClaimed(msg.sender, receiver, amount);
    }

    function checkpoint() external nonReentrant {
        _checkpointGlobal();
        _checkpointUser(msg.sender);
    }

    function syncMintReserve() external nonReentrant returns (uint256 amountAdded) {
        _checkpointGlobal();
        amountAdded = _topUpMintReserve();
    }

    function totalStaked() public view returns (uint256) {
        return Math.mulDiv(totalShares, principalIndex, INDEX_PRECISION);
    }

    function balanceOf(address user) public view returns (uint256) {
        if (userStakeEpoch[user] != stakeEpoch) return 0;
        return Math.mulDiv(userShares[user], principalIndex, INDEX_PRECISION);
    }

    function freeHeldCyGov() public view returns (uint256) {
        uint256 held = GOVERNANCE_TOKEN.balanceOf(address(this));
        return held > totalRewardLiability ? held - totalRewardLiability : 0;
    }

    function lockedMintReserve() external view returns (uint256) {
        return lockedMintReserveAmount;
    }

    function requiredMintReserve() public view returns (uint256 required) {
        if (maxMintRate > type(uint256).max / BACKING_DAYS) revert ValueTooLarge();
        uint256 requiredBacking = maxMintRate * BACKING_DAYS;
        uint256 freeHeld = freeHeldCyGov();
        required = requiredBacking > freeHeld ? requiredBacking - freeHeld : 0;
    }

    function effectiveMaxMintRate() public view returns (uint256) {
        uint256 backing = freeHeldCyGov() + lockedMintReserveAmount;
        uint256 backedRate = backing / BACKING_DAYS;
        return backedRate < maxMintRate ? backedRate : maxMintRate;
    }

    function currentDailyRewardRate() public view returns (uint256) {
        uint256 desired = Math.mulDiv(targetYield, totalStaked(), TARGET_YIELD_PRECISION);
        uint256 cap = effectiveMaxMintRate();
        return desired < cap ? desired : cap;
    }

    function earned(address user) external view returns (uint256) {
        uint256 shares = userShares[user];
        if (shares == 0) return accruedRewards[user];
        uint256 paid = userRewardPerSharePaid[user];
        uint256 current;
        if (userStakeEpoch[user] == stakeEpoch) {
            current = _previewRewardPerShare();
        } else {
            current = epochFinalRewardPerShare[userStakeEpoch[user]];
        }
        uint256 additional = current > paid
            ? Math.mulDiv(shares, current - paid, INDEX_PRECISION)
            : 0;
        return accruedRewards[user] + additional;
    }

    function _withdrawShares(address user, uint256 sharesToBurn, address receiver)
        internal
        returns (uint256 received)
    {
        if (sharesToBurn > userShares[user]) revert InsufficientStake();
        uint256 grossAmount = Math.mulDiv(sharesToBurn, principalIndex, INDEX_PRECISION);
        userShares[user] -= sharesToBurn;
        totalShares -= sharesToBurn;
        uint256 fee = Math.mulDiv(grossAmount, withdrawFeeBps, BPS);
        received = grossAmount - fee;
        if (fee != 0) CYVLSDT.safeTransfer(treasuryReceiver, fee);
        if (received != 0) CYVLSDT.safeTransfer(receiver, received);
        emit Withdrawn(user, receiver, grossAmount, fee);
    }

    function _setOrQueue(uint8 configType, uint256 value) internal {
        _validateConfig(configType, value);
        if (block.timestamp < configTimelocksActiveAt) {
            _applyConfig(configType, value);
            return;
        }
        uint256 readyAt = block.timestamp + CONFIG_CHANGE_DELAY;
        pendingConfig[configType] = PendingConfig(value, uint64(readyAt), true);
        emit ConfigQueued(configType, value, readyAt);
    }

    function _validateConfig(uint8 configType, uint256 value) internal pure {
        if (configType == CONFIG_TARGET_YIELD || configType == CONFIG_MAX_MINT_RATE) return;
        if (configType == CONFIG_WITHDRAW_FEE) {
            if (value > MAX_WITHDRAW_FEE_BPS) revert InvalidFee();
            return;
        }
        if (configType == CONFIG_DAILY_DECAY) {
            if (value > MAX_DAILY_DECAY_RATE) revert InvalidDecayRate();
            return;
        }
        revert InvalidConfigType();
    }

    function _applyConfig(uint8 configType, uint256 value) internal {
        uint256 oldValue;
        if (configType == CONFIG_TARGET_YIELD) {
            oldValue = targetYield;
            targetYield = value;
        } else if (configType == CONFIG_MAX_MINT_RATE) {
            oldValue = maxMintRate;
            _applyMaxMintRate(value);
        } else if (configType == CONFIG_WITHDRAW_FEE) {
            oldValue = withdrawFeeBps;
            withdrawFeeBps = uint16(value);
        } else if (configType == CONFIG_DAILY_DECAY) {
            oldValue = dailyDecayRate;
            dailyDecayRate = uint8(value);
        } else {
            revert InvalidConfigType();
        }
        emit ConfigApplied(configType, oldValue, value);
    }

    function _applyMaxMintRate(uint256 newRate) internal {
        if (newRate > type(uint256).max / BACKING_DAYS) revert ValueTooLarge();
        uint256 requiredBacking = newRate * BACKING_DAYS;
        uint256 freeHeld = freeHeldCyGov();
        uint256 requiredReserve = requiredBacking > freeHeld ? requiredBacking - freeHeld : 0;
        uint256 available = lockedMintReserveAmount + GOVERNANCE_TOKEN.availableMintableFor(address(this));
        if (requiredReserve > available) revert InsufficientMintBacking(requiredReserve, available);
        uint256 newId = GOVERNANCE_TOKEN.replaceMintReservation(
            mintReservationId, requiredReserve, block.timestamp
        );
        mintReservationId = newId;
        lockedMintReserveAmount = requiredReserve;
        maxMintRate = newRate;
        emit MintReserveRebalanced(newId, requiredReserve, requiredReserve);
    }

    function _checkpointGlobal() internal {
        _topUpMintReserve();
        (uint256 elapsed, uint256 activeElapsed, uint256 beforeTotal, uint256 afterTotal) = _previewDecay();
        _accrueGlobalRewards(activeElapsed, beforeTotal, afterTotal);
        _applyDecay(elapsed, beforeTotal, afterTotal);
        _topUpMintReserve();
    }

    /// @dev Integrates the target emission rate over the same additive linear principal path used
    /// by decay settlement. This makes reward accrual independent of checkpoint frequency without
    /// changing held-first funding, reservation consumption, or reserve top-up behavior.
    function _accrueGlobalRewards(uint256 elapsed, uint256 beforeTotal, uint256 afterTotal) internal {
        rewardLastUpdate = uint64(block.timestamp);
        if (elapsed == 0 || totalShares == 0 || targetYield == 0 || maxMintRate == 0) return;

        uint256 startDailyRate = Math.mulDiv(targetYield, beforeTotal, TARGET_YIELD_PRECISION);
        uint256 endDailyRate = Math.mulDiv(targetYield, afterTotal, TARGET_YIELD_PRECISION);
        uint256 cap = effectiveMaxMintRate();
        uint256 reward = _integratedReward(startDailyRate, endDailyRate, cap, elapsed);
        uint256 fundable = freeHeldCyGov() + lockedMintReserveAmount;
        if (reward > fundable) reward = fundable;
        if (reward == 0) return;

        uint256 freeHeld = freeHeldCyGov();
        uint256 mintNeeded = reward > freeHeld ? reward - freeHeld : 0;
        if (mintNeeded != 0) {
            if (mintNeeded > lockedMintReserveAmount || mintReservationId == 0) {
                revert RewardFundingInvariant();
            }
            GOVERNANCE_TOKEN.mintReserved(mintReservationId, address(this), mintNeeded);
            lockedMintReserveAmount -= mintNeeded;
        }

        totalRewardLiability += reward;
        uint256 scaled = reward * INDEX_PRECISION + rewardScaledRemainder;
        rewardPerShareStored += scaled / totalShares;
        rewardScaledRemainder = scaled % totalShares;
        emit RewardsAccrued(reward, Math.mulDiv(reward, 1 days, elapsed), elapsed);
    }

    /// @dev Exact integral for a linearly declining desired daily rate under a constant daily cap.
    function _integratedReward(
        uint256 startDailyRate,
        uint256 endDailyRate,
        uint256 cap,
        uint256 elapsed
    ) internal pure returns (uint256 reward) {
        if (elapsed == 0 || cap == 0 || startDailyRate == 0) return 0;
        if (endDailyRate > startDailyRate) endDailyRate = startDailyRate;

        if (startDailyRate <= cap) {
            return Math.mulDiv(startDailyRate + endDailyRate, elapsed, 2 days);
        }
        if (endDailyRate >= cap) return Math.mulDiv(cap, elapsed, 1 days);

        uint256 decliningRange = startDailyRate - endDailyRate;
        uint256 cappedElapsed = Math.mulDiv(elapsed, startDailyRate - cap, decliningRange);
        uint256 uncappedElapsed = elapsed - cappedElapsed;
        reward = Math.mulDiv(cap, cappedElapsed, 1 days);
        reward += Math.mulDiv(cap + endDailyRate, uncappedElapsed, 2 days);
    }

    /// @dev Cumulative rate-seconds are applied against the epoch's original index. Checkpointing
    /// daily or once after a year therefore produces the same principal for the same elapsed time.
    function _previewDecay()
        internal
        view
        returns (uint256 elapsed, uint256 activeElapsed, uint256 beforeTotal, uint256 afterTotal)
    {
        elapsed = block.timestamp - lastDecayCheckpoint;
        activeElapsed = elapsed;
        beforeTotal = totalStaked();
        afterTotal = beforeTotal;
        if (elapsed == 0 || totalShares == 0 || dailyDecayRate == 0 || beforeTotal == 0) {
            return (elapsed, activeElapsed, beforeTotal, afterTotal);
        }

        uint256 rate = uint256(dailyDecayRate);
        uint256 remainingUnits = DECAY_DENOMINATOR - cumulativeDecayUnits;
        uint256 secondsToZero = (remainingUnits + rate - 1) / rate;
        if (activeElapsed >= secondsToZero) {
            activeElapsed = secondsToZero;
            return (elapsed, activeElapsed, beforeTotal, 0);
        }

        uint256 newUnits = cumulativeDecayUnits + activeElapsed * rate;
        uint256 newIndex = Math.mulDiv(
            INDEX_PRECISION, DECAY_DENOMINATOR - newUnits, DECAY_DENOMINATOR
        );
        afterTotal = Math.mulDiv(totalShares, newIndex, INDEX_PRECISION);
    }

    function _applyDecay(uint256 elapsed, uint256 beforeTotal, uint256 afterTotal) internal {
        if (elapsed == 0) return;
        lastDecayCheckpoint = uint64(block.timestamp);
        if (totalShares == 0 || dailyDecayRate == 0 || beforeTotal == 0) return;

        uint256 newUnits = cumulativeDecayUnits + elapsed * uint256(dailyDecayRate);
        if (newUnits >= DECAY_DENOMINATOR || afterTotal == 0) {
            _closeStakeEpoch(elapsed, beforeTotal);
            return;
        }

        cumulativeDecayUnits = newUnits;
        principalIndex = Math.mulDiv(
            INDEX_PRECISION, DECAY_DENOMINATOR - newUnits, DECAY_DENOMINATOR
        );
        uint256 decayAmount = beforeTotal - afterTotal;
        if (decayAmount != 0) CYVLSDT.safeTransfer(treasuryReceiver, decayAmount);
        emit DecaySettled(elapsed, dailyDecayRate, decayAmount);
    }

    function _closeStakeEpoch(uint256 elapsed, uint256 principalToTreasury) internal {
        uint256 oldEpoch = stakeEpoch;
        epochFinalRewardPerShare[oldEpoch] = rewardPerShareStored;
        totalShares = 0;
        principalIndex = INDEX_PRECISION;
        cumulativeDecayUnits = 0;
        rewardPerShareStored = 0;
        rewardScaledRemainder = 0;
        stakeEpoch = oldEpoch + 1;
        CYVLSDT.safeTransfer(treasuryReceiver, principalToTreasury);
        emit DecaySettled(elapsed, dailyDecayRate, principalToTreasury);
        emit StakeEpochClosed(oldEpoch, epochFinalRewardPerShare[oldEpoch]);
    }

    function _checkpointUser(address user) internal {
        uint256 shares = userShares[user];
        uint256 paid = userRewardPerSharePaid[user];
        uint256 userEpoch = userStakeEpoch[user];
        if (userEpoch != stakeEpoch) {
            if (shares != 0) {
                uint256 finalReward = epochFinalRewardPerShare[userEpoch];
                if (finalReward > paid) {
                    accruedRewards[user] += Math.mulDiv(
                        shares, finalReward - paid, INDEX_PRECISION
                    );
                }
            }
            userShares[user] = 0;
            userRewardPerSharePaid[user] = 0;
            userStakeEpoch[user] = stakeEpoch;
            return;
        }
        if (shares != 0 && rewardPerShareStored > paid) {
            accruedRewards[user] += Math.mulDiv(
                shares, rewardPerShareStored - paid, INDEX_PRECISION
            );
        }
        userRewardPerSharePaid[user] = rewardPerShareStored;
    }

    function _topUpMintReserve() internal returns (uint256 amountAdded) {
        if (maxMintRate == 0) return 0;
        uint256 required = requiredMintReserve();
        if (required <= lockedMintReserveAmount) return 0;
        uint256 requested = required - lockedMintReserveAmount;
        uint256 resultingId;
        uint256 added;
        if (mintReservationId == 0) {
            uint256 available = GOVERNANCE_TOKEN.availableMintableFor(address(this));
            uint256 amountToLock = requested < available ? requested : available;
            if (amountToLock == 0) return 0;
            resultingId = GOVERNANCE_TOKEN.replaceMintReservation(
                0, amountToLock, block.timestamp
            );
            added = amountToLock;
        } else {
            (resultingId, added) = GOVERNANCE_TOKEN.increaseMintReservationUpTo(
                mintReservationId, requested, block.timestamp
            );
        }
        if (added != 0) {
            mintReservationId = resultingId;
            lockedMintReserveAmount += added;
            amountAdded = added;
            emit MintReserveRebalanced(resultingId, lockedMintReserveAmount, required);
        }
    }

    function _previewRewardPerShare() internal view returns (uint256 preview) {
        preview = rewardPerShareStored;
        if (totalShares == 0 || targetYield == 0 || maxMintRate == 0) return preview;
        (uint256 elapsed, uint256 activeElapsed, uint256 beforeTotal, uint256 afterTotal) = _previewDecay();
        if (elapsed == 0 || activeElapsed == 0) return preview;
        uint256 startDailyRate = Math.mulDiv(targetYield, beforeTotal, TARGET_YIELD_PRECISION);
        uint256 endDailyRate = Math.mulDiv(targetYield, afterTotal, TARGET_YIELD_PRECISION);
        uint256 reward = _integratedReward(
            startDailyRate, endDailyRate, effectiveMaxMintRate(), activeElapsed
        );
        uint256 fundable = freeHeldCyGov() + lockedMintReserveAmount;
        if (reward > fundable) reward = fundable;
        if (reward == 0) return preview;
        preview += (reward * INDEX_PRECISION + rewardScaledRemainder) / totalShares;
    }
}
