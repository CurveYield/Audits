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
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    ICurveYieldVlSDTLockerV17,
    ICurveYieldVlSDTRevenueStakingV17,
    ICurveYieldGovernanceStakingV17
} from "./interfaces/ICurveYieldV17.sol";
import {ICompounderAdapterV17} from "./interfaces/ICompounderAdapterV17.sol";

contract CurveYieldRevenueCompounderV17 is ERC4626, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant PRECISION = 1e27;
    uint256 public constant MAX_MARKET_ADVANTAGE_BPS = 2_000;
    uint256 public constant IMMEDIATE_WITHDRAW_FEE_BPS = 50;

    struct VaultWithdrawal {
        address owner;
        address receiver;
        uint128 assets;
        uint128 revenueWithdrawalId;
        bool completed;
    }

    IERC20 public immutable CYVLSDT;
    IERC20 public immutable SDT;
    IERC20 public immutable GOVERNANCE_TOKEN;
    ICurveYieldVlSDTLockerV17 public immutable LOCKER;
    ICurveYieldVlSDTRevenueStakingV17 public immutable REVENUE_STAKING;
    ICurveYieldGovernanceStakingV17 public immutable GOVERNANCE_STAKING;

    address public sdtToCyvlSdtAdapter;
    mapping(address => address) public rewardToSdtAdapter;
    mapping(address => bool) public isKeeper;
    uint256 public minimumMarketAdvantageBps;

    uint256 public governanceRewardPerShareStored;
    uint256 public governanceObserved;
    uint256 public governancePaidOut;
    uint256 public governanceUndistributed;
    mapping(address => uint256) public userGovernanceRewardPerSharePaid;
    mapping(address => uint256) public accruedGovernance;

    uint256 public nextWithdrawalId = 1;
    mapping(uint256 => VaultWithdrawal) public withdrawalRequests;

    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error InvalidAdvantage();
    error UnsupportedRewardToken();
    error MissingAdapter();
    error InvalidArrayLengths();
    error InsufficientOutput(uint256 minimum, uint256 actual);
    error InvalidWithdrawalRequest();
    error ValueTooLarge();
    error NotOwnerOrKeeper();

    event WithdrawalRequested(
        uint256 indexed id,
        address indexed owner,
        address indexed receiver,
        uint256 shares,
        uint256 assets,
        uint256 revenueWithdrawalId
    );
    event WithdrawalCompleted(
        uint256 indexed id,
        address indexed owner,
        address indexed receiver,
        uint256 assets
    );
    event RewardToSdtAdapterSet(address indexed rewardToken, address indexed adapter);
    event SdtToCyvlSdtAdapterSet(address indexed adapter);
    event MinimumMarketAdvantageSet(uint256 bps);
    event Harvested(
        uint256 sdtProcessed,
        uint256 cyvlSdtCompounded,
        bool marketRouteUsed,
        uint256 marketQuote
    );
    event GovernanceHarvested(uint256 amount);
    event GovernanceClaimed(address indexed user, uint256 amount, bool staked);
    event KeeperSet(address indexed keeper, bool allowed);

    constructor(
        address initialOwner_,
        address cyvlSdt_,
        address sdt_,
        address governanceToken_,
        address locker_,
        address revenueStaking_,
        address governanceStaking_
    ) ERC20("CurveYield Compounding vlSDT", "cycvlSDT") ERC4626(IERC20(cyvlSdt_)) Ownable(initialOwner_) {
        if (
            initialOwner_ == address(0) || cyvlSdt_ == address(0) || sdt_ == address(0)
                || governanceToken_ == address(0) || locker_ == address(0)
                || revenueStaking_ == address(0) || governanceStaking_ == address(0)
        ) revert ZeroAddress();

        CYVLSDT = IERC20(cyvlSdt_);
        SDT = IERC20(sdt_);
        GOVERNANCE_TOKEN = IERC20(governanceToken_);
        LOCKER = ICurveYieldVlSDTLockerV17(locker_);
        REVENUE_STAKING = ICurveYieldVlSDTRevenueStakingV17(revenueStaking_);
        GOVERNANCE_STAKING = ICurveYieldGovernanceStakingV17(governanceStaking_);
    }

    modifier onlyOwnerOrKeeper() {
        if (msg.sender != owner() && !isKeeper[msg.sender]) revert NotOwnerOrKeeper();
        _;
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setMinimumMarketAdvantageBps(uint256 bps) external onlyOwner {
        if (bps > MAX_MARKET_ADVANTAGE_BPS) revert InvalidAdvantage();
        minimumMarketAdvantageBps = bps;
        emit MinimumMarketAdvantageSet(bps);
    }

    function setSdtToCyvlSdtAdapter(address adapter) external onlyOwner {
        sdtToCyvlSdtAdapter = adapter;
        emit SdtToCyvlSdtAdapterSet(adapter);
    }

    function setRewardToSdtAdapter(address rewardToken, address adapter) external onlyOwner {
        if (!REVENUE_STAKING.isRewardToken(rewardToken)) revert UnsupportedRewardToken();
        if (
            rewardToken == address(SDT) || rewardToken == address(CYVLSDT)
                || rewardToken == address(GOVERNANCE_TOKEN)
        ) revert UnsupportedRewardToken();
        rewardToSdtAdapter[rewardToken] = adapter;
        emit RewardToSdtAdapterSet(rewardToken, adapter);
    }

    function totalAssets() public view override returns (uint256) {
        return CYVLSDT.balanceOf(address(this)) + REVENUE_STAKING.activeBalance(address(this));
    }

    /// @notice Returns shares required to receive an exact net asset amount through immediate withdrawal.
    /// @dev Grosses up for Revenue Staking's fixed 0.5% immediate-withdrawal fee.
    function previewWithdraw(uint256 assets) public view override returns (uint256 shares) {
        uint256 grossAssets = Math.mulDiv(
            assets,
            BPS,
            BPS - IMMEDIATE_WITHDRAW_FEE_BPS,
            Math.Rounding.Ceil
        );
        shares = _convertToShares(grossAssets, Math.Rounding.Ceil);
    }

    /// @notice Returns the net assets expected from immediately redeeming shares.
    function previewRedeem(uint256 shares) public view override returns (uint256 assets) {
        uint256 grossAssets = _convertToAssets(shares, Math.Rounding.Floor);
        assets = Math.mulDiv(grossAssets, BPS - IMMEDIATE_WITHDRAW_FEE_BPS, BPS);
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        return previewRedeem(maxRedeem(owner_));
    }

    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        assets = super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        assets = super.redeem(shares, receiver, owner_);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        _stakeIdleCyvlSdt();
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
    {
        _stakeIdleCyvlSdt();
        uint256 grossAssets = Math.mulDiv(
            assets,
            BPS,
            BPS - IMMEDIATE_WITHDRAW_FEE_BPS,
            Math.Rounding.Ceil
        );
        uint256 beforeBalance = CYVLSDT.balanceOf(address(this));
        REVENUE_STAKING.withdrawImmediate(grossAssets, address(this));
        uint256 received = CYVLSDT.balanceOf(address(this)) - beforeBalance;
        if (received < assets) revert InsufficientOutput(assets, received);

        super._withdraw(caller, receiver, owner_, assets, shares);
        _stakeIdleCyvlSdt();
    }

    function requestWithdrawal(uint256 shares, address receiver)
        external
        nonReentrant
        returns (uint256 id, uint256 assets)
    {
        if (shares == 0) revert ZeroShares();
        if (receiver == address(0)) revert ZeroAddress();

        _stakeIdleCyvlSdt();
        assets = convertToAssets(shares);
        _burn(msg.sender, shares);

        uint256 revenueWithdrawalId = REVENUE_STAKING.requestWithdrawal(assets);
        if (assets > type(uint128).max || revenueWithdrawalId > type(uint128).max) revert ValueTooLarge();

        id = nextWithdrawalId++;
        withdrawalRequests[id] = VaultWithdrawal(
            msg.sender,
            receiver,
            uint128(assets),
            uint128(revenueWithdrawalId),
            false
        );
        emit WithdrawalRequested(id, msg.sender, receiver, shares, assets, revenueWithdrawalId);
    }

    function completeWithdrawal(uint256 id) external nonReentrant returns (uint256 assets) {
        VaultWithdrawal storage request = withdrawalRequests[id];
        if (request.owner == address(0) || request.completed) revert InvalidWithdrawalRequest();

        request.completed = true;
        assets = REVENUE_STAKING.completeQueuedWithdrawal(
            request.revenueWithdrawalId,
            address(this)
        );
        CYVLSDT.safeTransfer(request.receiver, assets);
        emit WithdrawalCompleted(id, request.owner, request.receiver, assets);
    }

    function harvest(
        address[] calldata rewardTokens,
        uint256[] calldata minimumSdtOut,
        uint256 minimumCyvlSdtOut,
        uint256 deadline
    ) external onlyOwnerOrKeeper nonReentrant returns (uint256 cyvlSdtCompounded, bool marketRouteUsed) {
        if (rewardTokens.length != minimumSdtOut.length) revert InvalidArrayLengths();

        REVENUE_STAKING.claimRewards(address(this));

        for (uint256 i; i < rewardTokens.length; ++i) {
            address token = rewardTokens[i];
            if (token == address(CYVLSDT) || token == address(SDT) || token == address(GOVERNANCE_TOKEN)) {
                continue;
            }
            if (!REVENUE_STAKING.isRewardToken(token)) revert UnsupportedRewardToken();

            uint256 amount = IERC20(token).balanceOf(address(this));
            if (amount == 0) continue;
            address adapter = rewardToSdtAdapter[token];
            if (adapter == address(0)) revert MissingAdapter();

            uint256 beforeSdt = SDT.balanceOf(address(this));
            IERC20(token).forceApprove(adapter, amount);
            ICompounderAdapterV17(adapter).swap(
                token,
                address(SDT),
                amount,
                minimumSdtOut[i],
                address(this),
                deadline
            );
            IERC20(token).forceApprove(adapter, 0);
            uint256 received = SDT.balanceOf(address(this)) - beforeSdt;
            if (received < minimumSdtOut[i]) revert InsufficientOutput(minimumSdtOut[i], received);
        }

        uint256 sdtAmount = SDT.balanceOf(address(this));
        uint256 marketQuote;
        if (sdtAmount != 0) {
            address adapter = sdtToCyvlSdtAdapter;
            if (adapter != address(0)) {
                marketQuote = ICompounderAdapterV17(adapter).quote(
                    address(SDT),
                    address(CYVLSDT),
                    sdtAmount
                );
            }

            uint256 marketThreshold = Math.mulDiv(
                sdtAmount,
                BPS + minimumMarketAdvantageBps,
                BPS
            );
            if (adapter != address(0) && marketQuote >= marketThreshold) {
                uint256 beforeCyvl = CYVLSDT.balanceOf(address(this));
                SDT.forceApprove(adapter, sdtAmount);
                ICompounderAdapterV17(adapter).swap(
                    address(SDT),
                    address(CYVLSDT),
                    sdtAmount,
                    minimumCyvlSdtOut,
                    address(this),
                    deadline
                );
                SDT.forceApprove(adapter, 0);
                uint256 receivedCyvl = CYVLSDT.balanceOf(address(this)) - beforeCyvl;
                if (receivedCyvl < minimumCyvlSdtOut) {
                    revert InsufficientOutput(minimumCyvlSdtOut, receivedCyvl);
                }
                marketRouteUsed = true;
            } else {
                SDT.forceApprove(address(LOCKER), sdtAmount);
                uint256 minted = LOCKER.deposit(sdtAmount, address(this));
                SDT.forceApprove(address(LOCKER), 0);
                if (minted < minimumCyvlSdtOut) {
                    revert InsufficientOutput(minimumCyvlSdtOut, minted);
                }
            }
        }

        cyvlSdtCompounded = CYVLSDT.balanceOf(address(this));
        _stakeIdleCyvlSdt();
        emit Harvested(sdtAmount, cyvlSdtCompounded, marketRouteUsed, marketQuote);
    }

    function harvestGovernance() external nonReentrant returns (uint256 amount) {
        uint256 beforeBalance = GOVERNANCE_TOKEN.balanceOf(address(this));
        REVENUE_STAKING.claimGovernance(address(this));
        amount = GOVERNANCE_TOKEN.balanceOf(address(this)) - beforeBalance;
        _syncGovernance();
        emit GovernanceHarvested(amount);
    }

    function claimGovernance(bool stakeIntoVotingToken)
        external
        nonReentrant
        returns (uint256 amount)
    {
        _syncGovernance();
        _checkpointGovernanceUser(msg.sender);
        amount = accruedGovernance[msg.sender];
        accruedGovernance[msg.sender] = 0;

        uint256 balance = GOVERNANCE_TOKEN.balanceOf(address(this));
        if (balance < amount) {
            REVENUE_STAKING.claimGovernance(address(this));
            _syncGovernance();
            balance = GOVERNANCE_TOKEN.balanceOf(address(this));
        }
        if (balance < amount) revert InsufficientOutput(amount, balance);

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

    function earnedGovernance(address user) external view returns (uint256 amount) {
        uint256 currentRewardPerShare = _previewGovernanceRewardPerShare();
        amount = accruedGovernance[user]
            + Math.mulDiv(
                balanceOf(user),
                currentRewardPerShare - userGovernanceRewardPerSharePaid[user],
                PRECISION
            );
    }

    function _stakeIdleCyvlSdt() internal {
        uint256 amount = CYVLSDT.balanceOf(address(this));
        if (amount == 0) return;
        CYVLSDT.forceApprove(address(REVENUE_STAKING), amount);
        REVENUE_STAKING.stake(amount);
        CYVLSDT.forceApprove(address(REVENUE_STAKING), 0);
    }

    function _governanceLifetimeEarned() internal view returns (uint256) {
        return GOVERNANCE_TOKEN.balanceOf(address(this))
            + REVENUE_STAKING.earnedGovernance(address(this))
            + governancePaidOut;
    }

    function _previewGovernanceRewardPerShare() internal view returns (uint256 rewardPerShare) {
        rewardPerShare = governanceRewardPerShareStored;
        uint256 lifetime = _governanceLifetimeEarned();
        uint256 newRewards = lifetime - governanceObserved + governanceUndistributed;
        uint256 supply = totalSupply();
        if (newRewards != 0 && supply != 0) {
            rewardPerShare += Math.mulDiv(newRewards, PRECISION, supply);
        }
    }

    function _syncGovernance() internal {
        uint256 lifetime = _governanceLifetimeEarned();
        uint256 newRewards = lifetime - governanceObserved + governanceUndistributed;
        governanceObserved = lifetime;

        uint256 supply = totalSupply();
        if (newRewards == 0) return;
        if (supply == 0) {
            governanceUndistributed = newRewards;
            return;
        }

        uint256 delta = Math.mulDiv(newRewards, PRECISION, supply);
        uint256 allocated = Math.mulDiv(delta, supply, PRECISION);
        governanceRewardPerShareStored += delta;
        governanceUndistributed = newRewards - allocated;
    }

    function _checkpointGovernanceUser(address user) internal {
        uint256 current = governanceRewardPerShareStored;
        uint256 paid = userGovernanceRewardPerSharePaid[user];
        if (current != paid) {
            accruedGovernance[user] +=
                Math.mulDiv(balanceOf(user), current - paid, PRECISION);
            userGovernanceRewardPerSharePaid[user] = current;
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        _syncGovernance();
        if (from != address(0)) _checkpointGovernanceUser(from);
        if (to != address(0) && to != from) _checkpointGovernanceUser(to);
        super._update(from, to, value);
    }
}
