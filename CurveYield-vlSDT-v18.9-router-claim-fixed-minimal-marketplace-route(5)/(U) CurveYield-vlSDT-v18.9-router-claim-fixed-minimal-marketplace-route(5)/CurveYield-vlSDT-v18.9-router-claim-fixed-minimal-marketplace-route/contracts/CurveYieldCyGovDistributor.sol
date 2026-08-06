// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICurveYieldGovernanceStaking} from "./interfaces/ICurveYield.sol";
import {ICurveYieldRevenueVaultV7} from "./interfaces/ICurveYieldRevenueVaultV7.sol";
import {ICurveYieldRevenueStrategyV7} from "./interfaces/ICurveYieldRevenueStrategyV7.sol";
import {ICurveYieldCyGovDistributor} from "./interfaces/ICurveYieldCyGovDistributor.sol";

/// @notice Automatic cyGOV reward index for transferable Beefy-style revenue-vault shares.
contract CurveYieldCyGovDistributor is ICurveYieldCyGovDistributor, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant PRECISION = 1e27;

    address public immutable override vault;
    IERC20 public immutable GOVERNANCE_TOKEN;
    ICurveYieldGovernanceStaking public immutable GOVERNANCE_STAKING;

    uint256 public governanceRewardPerShareStored;
    uint256 public governanceObserved;
    uint256 public governancePaidOut;
    uint256 public governanceUndistributed;
    mapping(address => uint256) public userGovernanceRewardPerSharePaid;
    mapping(address => uint256) public accruedGovernance;

    error ZeroAddress();
    error NotVault();
    error StrategyNotSet();
    error InsufficientGovernance(uint256 required, uint256 available);

    event GovernanceSynced(uint256 newlyObserved, uint256 rewardPerShare);
    event GovernanceClaimed(address indexed user, uint256 amount, bool staked);

    constructor(address vault_, address governanceToken_, address governanceStaking_) {
        if (vault_ == address(0) || governanceToken_ == address(0) || governanceStaking_ == address(0)) {
            revert ZeroAddress();
        }
        vault = vault_;
        GOVERNANCE_TOKEN = IERC20(governanceToken_);
        GOVERNANCE_STAKING = ICurveYieldGovernanceStaking(governanceStaking_);
    }

    function checkpoint(address from, address to) external override {
        if (msg.sender != vault) revert NotVault();
        _sync();
        if (from != address(0)) _checkpointUser(from);
        if (to != address(0) && to != from) _checkpointUser(to);
    }

    function sync() external override {
        _sync();
    }

    function claim(bool stakeIntoVotingToken) external nonReentrant returns (uint256 amount) {
        _sync();
        _checkpointUser(msg.sender);
        amount = accruedGovernance[msg.sender];
        accruedGovernance[msg.sender] = 0;
        if (amount == 0) return 0;

        uint256 available = GOVERNANCE_TOKEN.balanceOf(address(this));
        if (available < amount) {
            ICurveYieldRevenueStrategyV7(_strategy()).claimCyGovToDistributor();
            _sync();
            available = GOVERNANCE_TOKEN.balanceOf(address(this));
        }
        if (available < amount) revert InsufficientGovernance(amount, available);

        governancePaidOut += amount;
        if (stakeIntoVotingToken) {
            GOVERNANCE_TOKEN.forceApprove(address(GOVERNANCE_STAKING), amount);
            GOVERNANCE_STAKING.stakeFor(msg.sender, amount);
            GOVERNANCE_TOKEN.forceApprove(address(GOVERNANCE_STAKING), 0);
        } else {
            GOVERNANCE_TOKEN.safeTransfer(msg.sender, amount);
        }
        emit GovernanceClaimed(msg.sender, amount, stakeIntoVotingToken);
    }

    function earned(address user) external view override returns (uint256 amount) {
        uint256 rewardPerShare = _previewRewardPerShare();
        amount = accruedGovernance[user]
            + Math.mulDiv(
                ICurveYieldRevenueVaultV7(vault).balanceOf(user),
                rewardPerShare - userGovernanceRewardPerSharePaid[user],
                PRECISION
            );
    }

    function _strategy() internal view returns (address strategy_) {
        strategy_ = ICurveYieldRevenueVaultV7(vault).strategy();
        if (strategy_ == address(0)) revert StrategyNotSet();
    }

    function _lifetimeEarned() internal view returns (uint256) {
        return GOVERNANCE_TOKEN.balanceOf(address(this))
            + ICurveYieldRevenueStrategyV7(_strategy()).pendingCyGov()
            + governancePaidOut;
    }

    function _previewRewardPerShare() internal view returns (uint256 rewardPerShare) {
        rewardPerShare = governanceRewardPerShareStored;
        uint256 lifetime = _lifetimeEarned();
        uint256 newRewards = lifetime - governanceObserved + governanceUndistributed;
        uint256 supply = ICurveYieldRevenueVaultV7(vault).totalSupply();
        if (newRewards != 0 && supply != 0) {
            rewardPerShare += Math.mulDiv(newRewards, PRECISION, supply);
        }
    }

    function _sync() internal {
        uint256 lifetime = _lifetimeEarned();
        uint256 newRewards = lifetime - governanceObserved + governanceUndistributed;
        governanceObserved = lifetime;
        if (newRewards == 0) return;

        uint256 supply = ICurveYieldRevenueVaultV7(vault).totalSupply();
        if (supply == 0) {
            governanceUndistributed = newRewards;
            emit GovernanceSynced(newRewards, governanceRewardPerShareStored);
            return;
        }

        uint256 delta = Math.mulDiv(newRewards, PRECISION, supply);
        uint256 allocated = Math.mulDiv(delta, supply, PRECISION);
        governanceRewardPerShareStored += delta;
        governanceUndistributed = newRewards - allocated;
        emit GovernanceSynced(newRewards, governanceRewardPerShareStored);
    }

    function _checkpointUser(address user) internal {
        uint256 current = governanceRewardPerShareStored;
        uint256 paid = userGovernanceRewardPerSharePaid[user];
        if (current == paid) return;
        accruedGovernance[user] += Math.mulDiv(
            ICurveYieldRevenueVaultV7(vault).balanceOf(user), current - paid, PRECISION
        );
        userGovernanceRewardPerSharePaid[user] = current;
    }
}
