// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICurveYieldRevenueStrategyV7} from "./interfaces/ICurveYieldRevenueStrategyV7.sol";
import {ICurveYieldCyGovDistributor} from "./interfaces/ICurveYieldCyGovDistributor.sol";

/**
 * @dev Standalone CurveYield adaptation of Beefy's canonical BeefyVaultV7.
 * The core vault/strategy flow and delayed strategy-candidate model are retained.
 */
contract CurveYieldRevenueVaultV7 is ERC20, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct StratCandidate {
        address implementation;
        uint256 proposedTime;
    }

    StratCandidate public stratCandidate;
    ICurveYieldRevenueStrategyV7 public strategy;
    ICurveYieldCyGovDistributor public CYGOV_DISTRIBUTOR;
    uint256 public constant approvalDelay = 7 days;
    bool public initialConfigurationSet;

    error ZeroAddress();
    error ZeroAmount();
    error NoShares();
    error StrategyNotSet();
    error InitialConfigurationAlreadySet();
    error InvalidStrategy();
    error InvalidDistributor();
    error NoCandidate();
    error ApprovalDelayNotPassed();
    error InsufficientShares(uint256 minimum, uint256 actual);

    event NewStratCandidate(address implementation);
    event UpgradeStrat(address implementation);
    event EmergencyUpgradeStrat(address implementation);
    event InitialConfigurationSet(address strategy, address distributor);
    event Deposit(address indexed user, uint256 assets, uint256 shares, bool strictHarvest);
    event Withdraw(address indexed user, uint256 shares, uint256 assets);

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner_
    ) ERC20(name_, symbol_) Ownable(initialOwner_) {
        if (initialOwner_ == address(0)) revert ZeroAddress();
        stratCandidate.proposedTime = 5_000_000_000;
    }

    /// @notice One-time standalone wiring used instead of Beefy's proxy initializer/factory stack.
    function setInitialConfiguration(address strategy_, address distributor_) external onlyOwner {
        if (initialConfigurationSet) revert InitialConfigurationAlreadySet();
        if (strategy_ == address(0) || distributor_ == address(0)) revert ZeroAddress();
        ICurveYieldRevenueStrategyV7 candidate = ICurveYieldRevenueStrategyV7(strategy_);
        if (candidate.vault() != address(this) || candidate.want() == address(0)) revert InvalidStrategy();
        if (ICurveYieldCyGovDistributor(distributor_).vault() != address(this)) revert InvalidDistributor();
        strategy = candidate;
        CYGOV_DISTRIBUTOR = ICurveYieldCyGovDistributor(distributor_);
        initialConfigurationSet = true;
        emit InitialConfigurationSet(strategy_, distributor_);
    }

    function want() public view returns (IERC20) {
        ICurveYieldRevenueStrategyV7 activeStrategy = strategy;
        if (address(activeStrategy) == address(0)) revert StrategyNotSet();
        return IERC20(activeStrategy.want());
    }

    /// @notice Realized cyvlSDT held by the vault and active strategy.
    function balance() public view returns (uint256) {
        return want().balanceOf(address(this)) + strategy.balanceOf();
    }

    /// @notice Economic NAV used only to prevent stale-reward capture during standard deposits.
    function economicBalance() public view returns (uint256) {
        uint256 realized = balance();
        uint256 estimated = strategy.estimatedUnharvestedWant();
        return estimated > type(uint256).max - realized ? type(uint256).max : realized + estimated;
    }

    function available() public view returns (uint256) {
        return want().balanceOf(address(this));
    }

    /// @notice Economic PPS including conservatively quoted ordinary rewards; cyGOV is excluded.
    function getPricePerFullShare() public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? 1e18 : Math.mulDiv(economicBalance(), 1e18, supply);
    }

    function getRealizedPricePerFullShare() external view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? 1e18 : Math.mulDiv(balance(), 1e18, supply);
    }

    function depositAll() external {
        deposit(want().balanceOf(msg.sender));
    }

    /// @dev Beefy V7 deposit flow with economic pre-deposit NAV replacing stale realized-only pricing.
    function deposit(uint256 amount) public nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        strategy.beforeDeposit();
        uint256 pool = economicBalance();
        shares = _receiveEarnAndPrice(amount, pool, false);
        emit Deposit(msg.sender, amount, shares, false);
    }

    /// @notice Forces a complete pre-deposit harvest and prices only from realized cyvlSDT.
    function depositWithStrictHarvest(uint256 amount, uint256 minimumShares)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (amount == 0) revert ZeroAmount();
        strategy.beforeDepositStrict();
        uint256 pool = balance();
        shares = _receiveEarnAndPrice(amount, pool, true);
        if (shares < minimumShares) revert InsufficientShares(minimumShares, shares);
        emit Deposit(msg.sender, amount, shares, true);
    }

    function earn() public {
        uint256 bal = available();
        if (bal == 0) return;
        want().safeTransfer(address(strategy), bal);
        strategy.deposit();
    }

    function withdrawAll() external returns (uint256 assets) {
        assets = withdraw(balanceOf(msg.sender));
    }

    /// @dev Canonical Beefy realized withdrawal flow. Strategy applies the configured withdrawal fee.
    function withdraw(uint256 shares) public nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        assets = Math.mulDiv(balance(), shares, totalSupply());
        _burn(msg.sender, shares);

        uint256 vaultBalance = want().balanceOf(address(this));
        if (vaultBalance < assets) {
            uint256 requested = assets - vaultBalance;
            strategy.withdraw(requested);
            uint256 afterBalance = want().balanceOf(address(this));
            uint256 received = afterBalance - vaultBalance;
            if (received < requested) assets = vaultBalance + received;
        }

        want().safeTransfer(msg.sender, assets);
        emit Withdraw(msg.sender, shares, assets);
    }

    function proposeStrat(address implementation) public onlyOwner {
        if (implementation == address(0) || implementation.code.length == 0) revert InvalidStrategy();
        ICurveYieldRevenueStrategyV7 candidate = ICurveYieldRevenueStrategyV7(implementation);
        if (candidate.vault() != address(this)) revert InvalidStrategy();
        if (candidate.want() != address(want())) revert InvalidStrategy();
        stratCandidate = StratCandidate({implementation: implementation, proposedTime: block.timestamp});
        emit NewStratCandidate(implementation);
    }

    function upgradeStrat() public onlyOwner {
        _upgradeStrat(false);
    }

    /// @notice Uses the same candidate validation and seven-day delay as a normal upgrade, but
    /// permits migration when the old strategy's reward harvest is broken.
    function emergencyUpgradeStrat() external onlyOwner {
        _upgradeStrat(true);
    }

    function _upgradeStrat(bool emergency) internal {
        address implementation = stratCandidate.implementation;
        if (implementation == address(0)) revert NoCandidate();
        if (block.timestamp <= stratCandidate.proposedTime + approvalDelay) revert ApprovalDelayNotPassed();

        if (emergency) {
            emit EmergencyUpgradeStrat(implementation);
            strategy.retireStratEmergency();
        } else {
            emit UpgradeStrat(implementation);
            strategy.retireStrat();
        }
        strategy = ICurveYieldRevenueStrategyV7(implementation);
        stratCandidate.implementation = address(0);
        stratCandidate.proposedTime = 5_000_000_000;
        earn();
    }

    function inCaseTokensGetStuck(address token) external onlyOwner {
        if (token == address(want())) revert InvalidStrategy();
        IERC20(token).safeTransfer(msg.sender, IERC20(token).balanceOf(address(this)));
    }

    function _receiveEarnAndPrice(uint256 requestedAmount, uint256 pool, bool strictHarvest)
        internal
        returns (uint256 shares)
    {
        IERC20 wantToken = want();
        uint256 beforeBalance = wantToken.balanceOf(address(this));
        wantToken.safeTransferFrom(msg.sender, address(this), requestedAmount);
        if (wantToken.balanceOf(address(this)) == beforeBalance) revert ZeroAmount();
        earn();

        uint256 afterBalance = strictHarvest ? balance() : economicBalance();
        if (afterBalance <= pool) revert ZeroAmount();
        uint256 contributedAssets = afterBalance - pool;
        uint256 supply = totalSupply();
        shares = supply == 0 ? contributedAssets : Math.mulDiv(contributedAssets, supply, pool);
        if (shares == 0) revert NoShares();
        _mint(msg.sender, shares);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (address(CYGOV_DISTRIBUTOR) != address(0)) {
            CYGOV_DISTRIBUTOR.checkpoint(from, to);
        }
        super._update(from, to, value);
    }
}
