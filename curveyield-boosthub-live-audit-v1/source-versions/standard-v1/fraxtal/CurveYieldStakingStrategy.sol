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
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface ICurveYieldStaking {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function harvest() external;
    function claim_rewards(address account) external;
    function balanceOf(address account) external view returns (uint256);
}

interface ICurveYieldRewardConverter {
    function previewConvert(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut);
    function convert(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        returns (uint256 amountOut);
}

contract CurveYieldStakingStrategy is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant CALLER_FEE_BPS = 10;
    uint256 public constant TREASURY_FEE_BPS = 290;
    uint256 public constant MAX_SLIPPAGE_BPS = 400;
    uint256 public constant CONFIG_CHANGE_DELAY = 10 days;
    uint256 public constant TOKEN_RESCUE_DELAY = 60 days;

    address public immutable want;
    address public immutable vault;
    ICurveYieldStaking public immutable staking;

    address public treasury;
    uint16 public maxSlippageBps;
    address public pendingTreasury;
    uint256 public pendingTreasuryReadyAt;
    uint16 public pendingMaxSlippageBps;
    uint256 public pendingMaxSlippageReadyAt;
    bool public pendingMaxSlippageSet;
    uint256 public ownershipTransferReadyAt;
    bool public ownershipTransferDelayInitialized;
    bool public maxSlippageDelayInitialized;
    bool public treasuryDelayInitialized;
    uint256 public lastHarvest;
    uint256 public estimatedTokenAprBps;
    uint256 public aprLastUpdate;

    struct RewardRoute {
        address token;
        address converter;
        uint256 minAmount;
        bool enabled;
    }

    struct PendingRewardRoute {
        address token;
        address converter;
        uint256 minAmount;
        bool enabled;
        bool exists;
        uint256 readyAt;
    }

    RewardRoute[] internal rewardRoutes;
    mapping(address => uint256) internal rewardRouteIndexPlusOne;
    mapping(address => PendingRewardRoute) internal pendingRewardRoutes;
    mapping(address => bool) public rewardRouteDelayInitialized;
    mapping(address => uint256) public tokenRescueReadyAt;

    event Deposit(uint256 tvl);
    event Withdraw(uint256 tvl);
    event StratHarvest(address indexed harvester, uint256 wantHarvested, uint256 tvl);
    event ChargedFees(address indexed token, uint256 callerFee, uint256 treasuryFee);
    event RewardRouteSet(address indexed token, uint256 minAmount);
    event RewardRouteRemoved(address indexed token);
    event RewardRouteQueued(address indexed token, uint256 minAmount, bool enabled, uint256 readyAt);
    event SlippageSet(uint16 maxSlippageBps);
    event SlippageQueued(uint16 maxSlippageBps, uint256 readyAt);
    event TreasuryQueued(address indexed treasury, uint256 readyAt);
    event TreasurySet(address indexed treasury);
    event TokenRescueQueued(address indexed token, uint256 readyAt);
    event TokenRescued(address indexed token, uint256 amount);

    error ZeroAddress();
    error InvalidRoute();
    error RouteNotFound();
    error SlippageTooHigh();
    error TimelockNotReady();
    error NoPendingChange();

    constructor(
        address want_,
        address vault_,
        address staking_,
        address treasury_,
        address owner_,
        address[] memory initialRouteTokens,
        address[] memory initialRouteConverters,
        uint256[] memory initialRouteMinAmounts
    ) Ownable(owner_) {
        if (
            want_ == address(0) || vault_ == address(0) || staking_ == address(0) || treasury_ == address(0)
                || owner_ == address(0)
        ) revert ZeroAddress();
        if (
            initialRouteTokens.length != initialRouteConverters.length
                || initialRouteTokens.length != initialRouteMinAmounts.length
        ) revert InvalidRoute();

        want = want_;
        vault = vault_;
        staking = ICurveYieldStaking(staking_);
        treasury = treasury_;
        maxSlippageBps = 25;

        uint256 length = initialRouteTokens.length;
        for (uint256 i; i < length; ++i) {
            _setRewardRouteImmediate(initialRouteTokens[i], initialRouteConverters[i], initialRouteMinAmounts[i]);
        }

        _giveAllowances();
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

    function beforeDeposit() external {
        if (!paused()) {
            _harvest(treasury);
        }
    }

    function deposit() public whenNotPaused {
        uint256 wantBal = IERC20(want).balanceOf(address(this));
        if (wantBal > 0) {
            staking.deposit(wantBal);
            uint256 tvl = balanceOf();
            if (aprLastUpdate == 0 && tvl > 0) {
                aprLastUpdate = block.timestamp;
            }
            emit Deposit(tvl);
        }
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(msg.sender == vault, "!vault");

        uint256 wantBal = IERC20(want).balanceOf(address(this));
        if (wantBal < amount) {
            staking.withdraw(amount - wantBal);
            wantBal = IERC20(want).balanceOf(address(this));
        }

        if (wantBal > amount) {
            wantBal = amount;
        }

        IERC20(want).safeTransfer(vault, wantBal);
        emit Withdraw(balanceOf());
    }

    function harvest() external nonReentrant whenNotPaused {
        _harvest(msg.sender);
    }

    function harvest(address callFeeRecipient) external nonReentrant whenNotPaused {
        if (callFeeRecipient == address(0)) revert ZeroAddress();
        _harvest(callFeeRecipient);
    }

    function _harvest(address callFeeRecipient) internal {
        uint256 tvlBefore = balanceOf();
        uint256 elapsed = aprLastUpdate == 0 ? 0 : block.timestamp - aprLastUpdate;
        uint256 beforeWant = IERC20(want).balanceOf(address(this));
        staking.harvest();
        staking.claim_rewards(address(this));

        uint256 afterClaimWant = IERC20(want).balanceOf(address(this));
        if (afterClaimWant > beforeWant) {
            _chargeFees(want, afterClaimWant - beforeWant, callFeeRecipient);
        }

        _compoundRewards(callFeeRecipient);
        uint256 afterWant = IERC20(want).balanceOf(address(this));
        uint256 wantHarvested = afterWant > beforeWant ? afterWant - beforeWant : 0;

        if (wantHarvested > 0) {
            if (tvlBefore > 0 && elapsed > 0) {
                estimatedTokenAprBps = Math.mulDiv(wantHarvested, 365 days * FEE_DENOMINATOR, tvlBefore * elapsed);
            } else {
                estimatedTokenAprBps = 0;
            }
            deposit();
            lastHarvest = block.timestamp;
            aprLastUpdate = block.timestamp;
            emit StratHarvest(msg.sender, wantHarvested, balanceOf());
        }
    }

    function _compoundRewards(address callFeeRecipient) internal {
        uint256 length = rewardRoutes.length;
        for (uint256 i; i < length; i++) {
            RewardRoute storage currentRoute = rewardRoutes[i];
            if (!currentRoute.enabled) continue;

            uint256 bal = IERC20(currentRoute.token).balanceOf(address(this));
            if (bal < currentRoute.minAmount) continue;
            if (currentRoute.token == want) continue;

            uint256 amountToCompound = _chargeFees(currentRoute.token, bal, callFeeRecipient);
            if (amountToCompound == 0) continue;

            IERC20(currentRoute.token).forceApprove(currentRoute.converter, amountToCompound);
            uint256 quoted =
                ICurveYieldRewardConverter(currentRoute.converter).previewConvert(currentRoute.token, want, amountToCompound);
            uint256 minOut = quoted * (FEE_DENOMINATOR - maxSlippageBps) / FEE_DENOMINATOR;
            ICurveYieldRewardConverter(currentRoute.converter).convert(currentRoute.token, want, amountToCompound, minOut);
            IERC20(currentRoute.token).forceApprove(currentRoute.converter, 0);
        }
    }

    function _chargeFees(address token, uint256 amount, address callFeeRecipient) internal returns (uint256 net) {
        uint256 callerFee = amount * CALLER_FEE_BPS / FEE_DENOMINATOR;
        uint256 treasuryFee = amount * TREASURY_FEE_BPS / FEE_DENOMINATOR;

        if (callerFee > 0) IERC20(token).safeTransfer(callFeeRecipient, callerFee);
        if (treasuryFee > 0) IERC20(token).safeTransfer(treasury, treasuryFee);

        emit ChargedFees(token, callerFee, treasuryFee);
        return amount - callerFee - treasuryFee;
    }

    function addRewardRoute(
        address token,
        address converter,
        uint256 minAmount
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (token != want && converter == address(0)) revert ZeroAddress();

        if (!rewardRouteDelayInitialized[token]) {
            _setRewardRouteImmediate(token, converter, minAmount);
        } else {
            pendingRewardRoutes[token] = PendingRewardRoute({
                token: token,
                converter: converter,
                minAmount: minAmount,
                enabled: true,
                exists: true,
                readyAt: block.timestamp + CONFIG_CHANGE_DELAY
            });
            emit RewardRouteQueued(token, minAmount, true, pendingRewardRoutes[token].readyAt);
        }
    }

    function removeRewardRoute(address token) external onlyOwner {
        uint256 indexPlusOne = rewardRouteIndexPlusOne[token];
        if (indexPlusOne == 0) revert RouteNotFound();
        RewardRoute storage configuredRoute = rewardRoutes[indexPlusOne - 1];
        if (!rewardRouteDelayInitialized[token]) {
            rewardRouteDelayInitialized[token] = true;
            configuredRoute.enabled = false;
            emit RewardRouteRemoved(token);
        } else {
            pendingRewardRoutes[token] = PendingRewardRoute({
                token: token,
                converter: configuredRoute.converter,
                minAmount: configuredRoute.minAmount,
                enabled: false,
                exists: true,
                readyAt: block.timestamp + CONFIG_CHANGE_DELAY
            });
            emit RewardRouteQueued(token, configuredRoute.minAmount, false, pendingRewardRoutes[token].readyAt);
        }
    }

    function applyRewardRoute(address token) external {
        PendingRewardRoute memory pending = pendingRewardRoutes[token];
        if (!pending.exists) revert NoPendingChange();
        if (block.timestamp < pending.readyAt) revert TimelockNotReady();

        uint256 indexPlusOne = rewardRouteIndexPlusOne[token];
        if (indexPlusOne == 0) {
            rewardRoutes.push(RewardRoute(token, pending.converter, pending.minAmount, pending.enabled));
            rewardRouteIndexPlusOne[token] = rewardRoutes.length;
        } else {
            RewardRoute storage configuredRoute = rewardRoutes[indexPlusOne - 1];
            configuredRoute.converter = pending.converter;
            configuredRoute.minAmount = pending.minAmount;
            configuredRoute.enabled = pending.enabled;
        }

        delete pendingRewardRoutes[token];
        if (pending.enabled) {
            emit RewardRouteSet(token, pending.minAmount);
        } else {
            emit RewardRouteRemoved(token);
        }
    }

    function _setRewardRouteImmediate(address token, address converter, uint256 minAmount) internal {
        if (token == address(0)) revert ZeroAddress();
        if (token != want && converter == address(0)) revert ZeroAddress();
        if (rewardRouteIndexPlusOne[token] != 0) revert InvalidRoute();

        rewardRouteDelayInitialized[token] = true;
        rewardRoutes.push(RewardRoute(token, converter, minAmount, true));
        rewardRouteIndexPlusOne[token] = rewardRoutes.length;
        emit RewardRouteSet(token, minAmount);
    }

    function setMaxSlippageBps(uint16 maxSlippageBps_) external onlyOwner {
        if (maxSlippageBps_ > MAX_SLIPPAGE_BPS) revert SlippageTooHigh();
        if (!maxSlippageDelayInitialized) {
            maxSlippageDelayInitialized = true;
            maxSlippageBps = maxSlippageBps_;
            emit SlippageSet(maxSlippageBps_);
        } else {
            pendingMaxSlippageBps = maxSlippageBps_;
            pendingMaxSlippageReadyAt = block.timestamp + CONFIG_CHANGE_DELAY;
            pendingMaxSlippageSet = true;
            emit SlippageQueued(maxSlippageBps_, pendingMaxSlippageReadyAt);
        }
    }

    function applyMaxSlippageBps() external {
        if (!pendingMaxSlippageSet) revert NoPendingChange();
        if (block.timestamp < pendingMaxSlippageReadyAt) revert TimelockNotReady();
        maxSlippageBps = pendingMaxSlippageBps;
        delete pendingMaxSlippageBps;
        delete pendingMaxSlippageReadyAt;
        delete pendingMaxSlippageSet;
        emit SlippageSet(maxSlippageBps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (!treasuryDelayInitialized) {
            treasuryDelayInitialized = true;
            treasury = treasury_;
            emit TreasurySet(treasury_);
        } else {
            pendingTreasury = treasury_;
            pendingTreasuryReadyAt = block.timestamp + CONFIG_CHANGE_DELAY;
            emit TreasuryQueued(treasury_, pendingTreasuryReadyAt);
        }
    }

    function applyTreasury() external {
        if (pendingTreasury == address(0)) revert NoPendingChange();
        if (block.timestamp < pendingTreasuryReadyAt) revert TimelockNotReady();
        treasury = pendingTreasury;
        delete pendingTreasury;
        delete pendingTreasuryReadyAt;
        emit TreasurySet(treasury);
    }

    function rewardRoutesLength() external view returns (uint256) {
        return rewardRoutes.length;
    }

    function rewardRoute(address token) external view returns (RewardRoute memory route) {
        uint256 indexPlusOne = rewardRouteIndexPlusOne[token];
        if (indexPlusOne == 0) revert RouteNotFound();
        return rewardRoutes[indexPlusOne - 1];
    }

    function balanceOf() public view returns (uint256) {
        return balanceOfWant() + balanceOfPool();
    }

    function balanceOfWant() public view returns (uint256) {
        return IERC20(want).balanceOf(address(this));
    }

    function balanceOfPool() public view returns (uint256) {
        return staking.balanceOf(address(this));
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
        _giveAllowances();
        deposit();
    }

    function inCaseTokensGetStuck(address token) external onlyOwner {
        if (token == want) revert InvalidRoute();
        uint256 indexPlusOne = rewardRouteIndexPlusOne[token];
        if (indexPlusOne != 0 && rewardRoutes[indexPlusOne - 1].enabled) revert InvalidRoute();
        tokenRescueReadyAt[token] = block.timestamp + TOKEN_RESCUE_DELAY;
        emit TokenRescueQueued(token, tokenRescueReadyAt[token]);
    }

    function executeTokenRescue(address token) external onlyOwner {
        uint256 readyAt = tokenRescueReadyAt[token];
        if (readyAt == 0) revert NoPendingChange();
        if (block.timestamp < readyAt) revert TimelockNotReady();

        uint256 indexPlusOne = rewardRouteIndexPlusOne[token];
        if (token == want || (indexPlusOne != 0 && rewardRoutes[indexPlusOne - 1].enabled)) revert InvalidRoute();

        delete tokenRescueReadyAt[token];
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(msg.sender, balance);
        emit TokenRescued(token, balance);
    }

    function _giveAllowances() internal {
        IERC20(want).forceApprove(address(staking), type(uint256).max);
    }
}
