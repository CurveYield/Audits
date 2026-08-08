// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICurveYieldVlSDTRevenueStaking} from "./interfaces/ICurveYield.sol";
import {ICurveYieldRevenueStrategyV7} from "./interfaces/ICurveYieldRevenueStrategyV20.sol";
import {ICurveYieldRevenueConverter} from "./interfaces/ICurveYieldRevenueConverter.sol";

/// @notice Beefy V7-style strategy for the CurveYield revenue vault.
contract CurveYieldRevenueStrategyV7 is
    ICurveYieldRevenueStrategyV7,
    Ownable2Step,
    Pausable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_WITHDRAW_FEE_BPS = 100;
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 900;
    uint256 public constant MAX_CALL_FEE_BPS = 100;
    uint256 public constant MAX_TOTAL_HARVEST_FEE_BPS = 1_000;
    uint256 public constant CONVERTER_CHANGE_DELAY = 10 days;
    uint16 public constant DEFAULT_WITHDRAW_FEE_BPS = 10;
    uint16 public constant DEFAULT_PERFORMANCE_FEE_BPS = 390;
    uint16 public constant DEFAULT_CALL_FEE_BPS = 10;

    address public immutable override vault;
    IERC20 public immutable WANT;
    IERC20 public immutable SDT;
    IERC20 public immutable GOVERNANCE_TOKEN;
    ICurveYieldVlSDTRevenueStaking public immutable REVENUE_STAKING;

    ICurveYieldRevenueConverter public CONVERTER;
    address public pendingConverter;
    uint64 public pendingConverterReadyAt;
    address public cyGovDistributor;

    uint16 public withdrawalFeeBps;
    uint16 public performanceFeeBps;
    uint16 public callFeeBps;
    address public treasuryReceiver;
    bool public harvestOnDeposit;
    bool public retired;

    error ZeroAddress();
    error ZeroAmount();
    error NotVault();
    error NotSelf();
    error NotDistributor();
    error InvalidFee();
    error InvalidConverter();
    error ConverterNotReady();
    error UnsupportedReward(address token);
    error UnpriceableReward(address token, uint256 amount);
    error InsufficientOutput(uint256 minimum, uint256 actual);
    error DistributorAlreadySet();
    error StrategyAlreadyRetired();

    event Deposit(uint256 amount);
    event Withdraw(uint256 requested, uint256 sent, uint256 retainedFee);
    event Harvest(address indexed caller, uint256 grossWant, uint256 callerFee, uint256 performanceFee);
    event FeesSet(uint256 withdrawalFeeBps, uint256 performanceFeeBps, uint256 callFeeBps);
    event TreasuryReceiverSet(address indexed oldReceiver, address indexed newReceiver);
    event HarvestOnDepositSet(bool enabled);
    event ConverterProposed(address indexed converter, uint256 readyAt);
    event ConverterSet(address indexed converter);
    event ConverterProposalCancelled();
    event CyGovDistributorSet(address indexed distributor);
    event CyGovForwarded(uint256 amount);
    event StrategyRetired(uint256 wantReturned);
    event StrategyEmergencyRetired(uint256 wantReturned);

    constructor(
        address initialOwner_,
        address vault_,
        address want_,
        address sdt_,
        address governanceToken_,
        address revenueStaking_,
        address converter_,
        address treasuryReceiver_
    ) Ownable(initialOwner_) {
        if (
            initialOwner_ == address(0) || vault_ == address(0) || want_ == address(0)
                || sdt_ == address(0) || governanceToken_ == address(0)
                || revenueStaking_ == address(0) || converter_ == address(0)
                || treasuryReceiver_ == address(0)
        ) revert ZeroAddress();
        vault = vault_;
        WANT = IERC20(want_);
        SDT = IERC20(sdt_);
        GOVERNANCE_TOKEN = IERC20(governanceToken_);
        REVENUE_STAKING = ICurveYieldVlSDTRevenueStaking(revenueStaking_);
        _validateConverter(converter_);
        CONVERTER = ICurveYieldRevenueConverter(converter_);
        withdrawalFeeBps = DEFAULT_WITHDRAW_FEE_BPS;
        performanceFeeBps = DEFAULT_PERFORMANCE_FEE_BPS;
        callFeeBps = DEFAULT_CALL_FEE_BPS;
        treasuryReceiver = treasuryReceiver_;
        harvestOnDeposit = true;
        emit TreasuryReceiverSet(address(0), treasuryReceiver_);
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    function want() external view override returns (address) {
        return address(WANT);
    }

    function setCyGovDistributor(address distributor) external onlyOwner {
        if (distributor == address(0)) revert ZeroAddress();
        if (cyGovDistributor != address(0)) revert DistributorAlreadySet();
        cyGovDistributor = distributor;
        emit CyGovDistributorSet(distributor);
    }

    function setFees(
        uint16 withdrawalFeeBps_,
        uint16 performanceFeeBps_,
        uint16 callFeeBps_
    ) external onlyOwner {
        if (withdrawalFeeBps_ > MAX_WITHDRAW_FEE_BPS) revert InvalidFee();
        if (
            performanceFeeBps_ > MAX_PERFORMANCE_FEE_BPS
                || callFeeBps_ > MAX_CALL_FEE_BPS
                || uint256(performanceFeeBps_) + uint256(callFeeBps_) > MAX_TOTAL_HARVEST_FEE_BPS
        ) revert InvalidFee();
        withdrawalFeeBps = withdrawalFeeBps_;
        performanceFeeBps = performanceFeeBps_;
        callFeeBps = callFeeBps_;
        emit FeesSet(withdrawalFeeBps_, performanceFeeBps_, callFeeBps_);
    }

    function setTreasuryReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        emit TreasuryReceiverSet(treasuryReceiver, newReceiver);
        treasuryReceiver = newReceiver;
    }

    function setHarvestOnDeposit(bool enabled) external onlyOwner {
        harvestOnDeposit = enabled;
        emit HarvestOnDepositSet(enabled);
    }

    function proposeConverter(address converter_) external onlyOwner {
        _validateConverter(converter_);
        pendingConverter = converter_;
        pendingConverterReadyAt = uint64(block.timestamp + CONVERTER_CHANGE_DELAY);
        emit ConverterProposed(converter_, pendingConverterReadyAt);
    }

    function executeConverter() external {
        address converter_ = pendingConverter;
        if (converter_ == address(0) || block.timestamp < pendingConverterReadyAt) revert ConverterNotReady();
        _validateConverter(converter_);
        CONVERTER = ICurveYieldRevenueConverter(converter_);
        delete pendingConverter;
        delete pendingConverterReadyAt;
        emit ConverterSet(converter_);
    }

    function cancelConverter() external onlyOwner {
        delete pendingConverter;
        delete pendingConverterReadyAt;
        emit ConverterProposalCancelled();
    }

    function beforeDeposit() external override onlyVault {
        if (!harvestOnDeposit || paused()) return;
        try this.harvestBeforeDeposit() {} catch {}
    }

    function harvestBeforeDeposit() external onlySelf nonReentrant {
        _harvest(address(0));
    }

    function beforeDepositStrict() external override onlyVault nonReentrant {
        if (paused()) revert EnforcedPause();
        _harvest(address(0));
    }

    /// @notice Best-effort harvest used immediately before vault withdrawal pricing.
    /// @dev Harvest/conversion failures are intentionally swallowed so principal withdrawals remain live.
    function beforeWithdraw() external override onlyVault {
        if (paused()) return;
        try this.harvestBeforeWithdraw() {} catch {}
    }

    function harvestBeforeWithdraw() external onlySelf nonReentrant {
        _harvest(address(0));
    }

    function deposit() external override onlyVault whenNotPaused {
        _depositIdle();
    }

    function withdraw(uint256 amount) external override onlyVault nonReentrant {
        if (amount == 0) return;
        uint256 idle = WANT.balanceOf(address(this));
        if (idle < amount) {
            uint256 active = REVENUE_STAKING.activeBalance(address(this));
            uint256 requested = _grossUpForStakingWithdrawalFee(amount - idle);
            if (requested > active) requested = active;
            if (requested != 0) REVENUE_STAKING.withdrawImmediate(requested, address(this));
        }

        uint256 availableAmount = WANT.balanceOf(address(this));
        if (availableAmount > amount) availableAmount = amount;
        uint256 fee = Math.mulDiv(availableAmount, withdrawalFeeBps, BPS);
        uint256 sent = availableAmount - fee;
        if (sent != 0) WANT.safeTransfer(vault, sent);
        if (fee != 0) WANT.safeTransfer(treasuryReceiver, fee);
        emit Withdraw(amount, sent, fee);
    }

    function harvest() external nonReentrant whenNotPaused returns (uint256 grossWant) {
        grossWant = _harvest(msg.sender);
    }

    function harvest(address callFeeRecipient) external nonReentrant whenNotPaused returns (uint256 grossWant) {
        if (callFeeRecipient == address(0)) revert ZeroAddress();
        grossWant = _harvest(callFeeRecipient);
    }

    function balanceOf() public view override returns (uint256) {
        uint256 active = REVENUE_STAKING.activeBalance(address(this));
        return WANT.balanceOf(address(this)) + _netAfterStakingWithdrawalFee(active);
    }

    /// @notice Gross cyvlSDT-equivalent value of ordinary rewards attributable to this strategy.
    /// @dev Reverts rather than underpricing a positive unsupported reward during a vault deposit.
    function estimatedUnharvestedWant() external view override returns (uint256 estimatedWant) {
        ICurveYieldRevenueConverter converter = CONVERTER;
        uint256 count = REVENUE_STAKING.rewardTokenCount();
        bool sdtObserved;

        for (uint256 i; i < count; ++i) {
            address token = REVENUE_STAKING.rewardTokens(i);
            if (token == address(0) || token == address(GOVERNANCE_TOKEN)) continue;

            uint256 claimable = REVENUE_STAKING.earned(address(this), token);
            uint256 held;
            if (token != address(WANT)) held = IERC20(token).balanceOf(address(this));
            uint256 amount = claimable + held;
            if (amount == 0) continue;

            if (token == address(WANT)) {
                estimatedWant += amount;
                continue;
            }
            if (token == address(SDT)) sdtObserved = true;
            estimatedWant += _quoteOrRevert(converter, token, amount);
        }

        if (!sdtObserved) {
            uint256 heldSdt = SDT.balanceOf(address(this));
            if (heldSdt != 0) estimatedWant += _quoteOrRevert(converter, address(SDT), heldSdt);
        }
        estimatedWant = _netAfterStakingWithdrawalFee(estimatedWant);
    }

    function pendingCyGov() external view override returns (uint256) {
        return REVENUE_STAKING.earnedGovernance(address(this));
    }

    function claimCyGovToDistributor() external override nonReentrant returns (uint256 amount) {
        address distributor = cyGovDistributor;
        if (msg.sender != distributor || distributor == address(0)) revert NotDistributor();
        amount = _claimCyGov(distributor);
    }

    /// @notice Canonical migration path. All ordinary rewards must claim, convert, and compound or
    /// the retirement reverts, preventing rewards from remaining assigned to an obsolete strategy.
    function retireStrat() external override onlyVault nonReentrant {
        if (retired) revert StrategyAlreadyRetired();
        _harvest(address(0));
        address distributor = cyGovDistributor;
        if (distributor != address(0)) _claimCyGov(distributor);
        uint256 returned = _retirePrincipal();
        emit StrategyRetired(returned);
    }

    /// @notice Emergency migration path used only when harvesting is broken. Reward claims are
    /// deliberately skipped so principal can still exit. The strategy is permanently paused first,
    /// preventing later public harvests from restaking funds under the obsolete strategy.
    function retireStratEmergency() external override onlyVault nonReentrant {
        if (retired) revert StrategyAlreadyRetired();
        uint256 returned = _retirePrincipal();
        emit StrategyEmergencyRetired(returned);
    }

    function panic() external onlyOwner nonReentrant {
        _pause();
        uint256 active = REVENUE_STAKING.activeBalance(address(this));
        if (active != 0) REVENUE_STAKING.withdrawImmediate(active, address(this));
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        if (retired) revert StrategyAlreadyRetired();
        _unpause();
        _depositIdle();
    }


    function _retirePrincipal() internal returns (uint256 returned) {
        retired = true;
        if (!paused()) _pause();
        uint256 active = REVENUE_STAKING.activeBalance(address(this));
        if (active != 0) REVENUE_STAKING.withdrawImmediate(active, address(this));
        returned = WANT.balanceOf(address(this));
        if (returned != 0) WANT.safeTransfer(vault, returned);
    }

    function _harvest(address callFeeRecipient) internal returns (uint256 grossWant) {
        uint256 beforeWant = WANT.balanceOf(address(this));
        REVENUE_STAKING.claimRewards(address(this));

        uint256 count = REVENUE_STAKING.rewardTokenCount();
        for (uint256 i; i < count; ++i) {
            address token = REVENUE_STAKING.rewardTokens(i);
            if (token == address(0) || token == address(WANT) || token == address(GOVERNANCE_TOKEN)) continue;
            _convertHeld(token);
        }
        if (SDT.balanceOf(address(this)) != 0) _convertHeld(address(SDT));

        uint256 afterWant = WANT.balanceOf(address(this));
        grossWant = afterWant - beforeWant;
        uint256 callerFee;
        uint256 performanceFee;
        if (grossWant != 0) {
            if (callFeeRecipient != address(0) && callFeeBps != 0) {
                callerFee = Math.mulDiv(grossWant, callFeeBps, BPS);
                if (callerFee != 0) WANT.safeTransfer(callFeeRecipient, callerFee);
            }
            if (performanceFeeBps != 0) {
                performanceFee = Math.mulDiv(grossWant, performanceFeeBps, BPS);
                if (performanceFee != 0) WANT.safeTransfer(treasuryReceiver, performanceFee);
            }
        }
        _depositIdle();
        emit Harvest(callFeeRecipient, grossWant, callerFee, performanceFee);
    }

    function _convertHeld(address token) internal {
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) return;
        ICurveYieldRevenueConverter converter = CONVERTER;
        if (!converter.supportsToken(token)) revert UnsupportedReward(token);
        uint256 minimumOut = converter.quote(token, amount);
        if (minimumOut == 0) revert InsufficientOutput(1, 0);

        uint256 beforeWant = WANT.balanceOf(address(this));
        IERC20(token).forceApprove(address(converter), amount);
        converter.convert(token, amount, minimumOut, address(this), block.timestamp);
        IERC20(token).forceApprove(address(converter), 0);
        uint256 received = WANT.balanceOf(address(this)) - beforeWant;
        if (received < minimumOut) revert InsufficientOutput(minimumOut, received);
    }

    function _depositIdle() internal {
        uint256 amount = WANT.balanceOf(address(this));
        if (amount == 0) return;
        WANT.forceApprove(address(REVENUE_STAKING), amount);
        REVENUE_STAKING.stake(amount);
        WANT.forceApprove(address(REVENUE_STAKING), 0);
        emit Deposit(amount);
    }

    function _claimCyGov(address receiver) internal returns (uint256 amount) {
        uint256 beforeBalance = GOVERNANCE_TOKEN.balanceOf(receiver);
        REVENUE_STAKING.claimGovernance(receiver);
        amount = GOVERNANCE_TOKEN.balanceOf(receiver) - beforeBalance;
        emit CyGovForwarded(amount);
    }

    function _quoteOrRevert(ICurveYieldRevenueConverter converter, address token, uint256 amount)
        internal
        view
        returns (uint256 quote)
    {
        if (!converter.supportsToken(token)) revert UnpriceableReward(token, amount);
        try converter.quote(token, amount) returns (uint256 amountOut) {
            quote = amountOut;
        } catch {
            if (token == address(SDT)) return amount;
            revert UnpriceableReward(token, amount);
        }
        if (quote == 0) revert UnpriceableReward(token, amount);
    }

    function _stakingWithdrawalFeeBps() internal view returns (uint256 feeBps) {
        feeBps = REVENUE_STAKING.immediateWithdrawFeeBps();
        if (feeBps >= BPS) revert InvalidFee();
    }

    function _netAfterStakingWithdrawalFee(uint256 grossAmount) internal view returns (uint256) {
        if (grossAmount == 0) return 0;
        return REVENUE_STAKING.previewImmediateWithdrawal(grossAmount);
    }

    function _grossUpForStakingWithdrawalFee(uint256 netAmount) internal view returns (uint256 grossAmount) {
        if (netAmount == 0) return 0;
        grossAmount = Math.mulDiv(
            netAmount,
            BPS,
            BPS - _stakingWithdrawalFeeBps(),
            Math.Rounding.Ceil
        );
        if (REVENUE_STAKING.previewImmediateWithdrawal(grossAmount) < netAmount) ++grossAmount;
    }

    function _validateConverter(address converter_) internal view {
        if (converter_ == address(0) || converter_.code.length == 0) revert InvalidConverter();
        try ICurveYieldRevenueConverter(converter_).outputToken() returns (address output) {
            if (output != address(WANT)) revert InvalidConverter();
        } catch {
            revert InvalidConverter();
        }
    }
}
