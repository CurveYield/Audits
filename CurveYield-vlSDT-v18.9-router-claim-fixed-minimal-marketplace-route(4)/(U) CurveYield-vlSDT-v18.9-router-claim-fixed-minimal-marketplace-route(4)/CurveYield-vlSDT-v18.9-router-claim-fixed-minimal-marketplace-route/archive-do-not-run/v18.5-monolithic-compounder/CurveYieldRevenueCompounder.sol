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
    ICurveYieldVlSDTLocker,
    ICurveYieldVlSDTRevenueStaking,
    ICurveYieldGovernanceStaking
} from "./interfaces/ICurveYield.sol";
import {ICompounderAdapter} from "./interfaces/ICompounderAdapter.sol";

contract CurveYieldRevenueCompounder is ERC4626, Ownable2Step, ReentrancyGuard {
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
    ICurveYieldVlSDTLocker public immutable LOCKER;
    ICurveYieldVlSDTRevenueStaking public immutable REVENUE_STAKING;
    ICurveYieldGovernanceStaking public immutable GOVERNANCE_STAKING;

    address public sdtToCyvlSdtAdapter;
    mapping(address => address) public rewardToSdtAdapter;
    mapping(address => bool) public isKeeper;
    uint256 public minimumMarketAdvantageBps;
    bool public harvestOnDeposit;

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
    event HarvestOnDepositSet(bool enabled);

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
        LOCKER = ICurveYieldVlSDTLocker(locker_);
        REVENUE_STAKING = ICurveYieldVlSDTRevenueStaking(revenueStaking_);
        GOVERNANCE_STAKING = ICurveYieldGovernanceStaking(governanceStaking_);
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

    function setHarvestOnDeposit(bool enabled) external onlyOwner {
        harvestOnDeposit = enabled;
        emit HarvestOnDepositSet(enabled);
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

    /// @notice cyvlSDT already held or staked and available to back an exit without reward quotes.
    function realizedAssets() public view returns (uint256) {
        return CYVLSDT.balanceOf(address(this)) + REVENUE_STAKING.activeBalance(address(this));
    }

    /// @notice Best-effort cyvlSDT-equivalent value of ordinary rewards not yet compounded.
    /// @dev Missing adapters, reverting token reads, and reverting or zero quotes contribute zero.
    function estimatedUnharvestedRewards() public view returns (uint256 estimatedAssets) {
        try SDT.balanceOf(address(this)) returns (uint256 heldSdt) {
            estimatedAssets = heldSdt;
        } catch {}

        uint256 count;
        try REVENUE_STAKING.rewardTokenCount() returns (uint256 rewardCount) {
            count = rewardCount;
        } catch {
            return estimatedAssets;
        }

        for (uint256 i; i < count; ++i) {
            address token;
            try REVENUE_STAKING.rewardTokens(i) returns (address rewardToken) {
                token = rewardToken;
            } catch {
                continue;
            }
            if (token == address(0) || token == address(GOVERNANCE_TOKEN)) continue;

            uint256 claimable;
            try REVENUE_STAKING.earned(address(this), token) returns (uint256 amount) {
                claimable = amount;
            } catch {}

            uint256 value;
            if (token == address(CYVLSDT) || token == address(SDT)) {
                value = claimable;
            } else {
                uint256 held;
                try IERC20(token).balanceOf(address(this)) returns (uint256 balance) {
                    held = balance;
                } catch {}
                if (held > type(uint256).max - claimable) continue;
                uint256 amountToValue = held + claimable;
                if (amountToValue == 0) continue;

                address adapter = rewardToSdtAdapter[token];
                if (adapter == address(0)) continue;
                try ICompounderAdapter(adapter).quote(token, address(SDT), amountToValue) returns (uint256 quote) {
                    value = quote;
                } catch {
                    continue;
                }
            }

            if (value > type(uint256).max - estimatedAssets) continue;
            estimatedAssets += value;
        }
    }

    /// @notice Economic NAV used for deposit and mint share pricing.
    /// @dev Ordinary reward estimates are included; governance rewards remain separately distributable.
    function totalAssets() public view override returns (uint256) {
        uint256 realized = realizedAssets();
        uint256 estimated = estimatedUnharvestedRewards();
        return estimated > type(uint256).max - realized ? type(uint256).max : realized + estimated;
    }

    /// @notice Returns shares required to receive an exact net asset amount through immediate withdrawal.
    /// @dev Uses realized cyvlSDT only and grosses up for Revenue Staking's fixed 0.5% fee.
    function previewWithdraw(uint256 assets) public view override returns (uint256 shares) {
        uint256 grossAssets = Math.mulDiv(
            assets,
            BPS,
            BPS - IMMEDIATE_WITHDRAW_FEE_BPS,
            Math.Rounding.Ceil
        );
        shares = _convertToRealizedShares(grossAssets, Math.Rounding.Ceil);
    }

    /// @notice Returns the net realized assets expected from immediately redeeming shares.
    /// @dev Unharvested reward estimates are intentionally excluded.
    function previewRedeem(uint256 shares) public view override returns (uint256 assets) {
        uint256 grossAssets = _convertToRealizedAssets(shares, Math.Rounding.Floor);
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
        if (harvestOnDeposit) _attemptConfiguredHarvest();
        shares = super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        if (harvestOnDeposit) _attemptConfiguredHarvest();
        assets = super.mint(shares, receiver);
    }

    /// @notice Strict deposit route that completes configured ordinary-reward harvesting before share issuance.
    /// @dev Share pricing uses realized cyvlSDT only after the harvest. No unharvested-reward estimate is read.
    function depositWithStrictHarvest(uint256 assets, address receiver)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        _harvestConfiguredStrict();
        shares = _convertToRealizedShares(assets, Math.Rounding.Floor);
        if (shares == 0) revert ZeroShares();
        _deposit(msg.sender, receiver, assets, shares);
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

    /// @notice Attempts configured reward compounding before redeeming shares against realized cyvlSDT.
    /// @dev The payout is calculated after the attempt and never includes an unharvested reward quote.
    function redeemWithHarvest(uint256 shares, address receiver, address owner_)
        external
        nonReentrant
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroShares();
        _attemptConfiguredHarvest();
        assets = previewRedeem(shares);
        if (assets == 0) revert ZeroAmount();
        _withdraw(msg.sender, receiver, owner_, assets, shares);
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
        assets = _convertToRealizedAssets(shares, Math.Rounding.Floor);
        if (assets == 0) revert ZeroAmount();
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

    /// @dev Best-effort harvest used by harvest-on-deposit and harvest-assisted redemption.
    /// Missing or failing optional routes are skipped; only actual cyvlSDT becomes realized NAV.
    function _attemptConfiguredHarvest() internal returns (uint256 cyvlSdtCompounded, bool marketRouteUsed) {
        try REVENUE_STAKING.claimRewards(address(this)) {} catch {}

        uint256 count;
        try REVENUE_STAKING.rewardTokenCount() returns (uint256 rewardCount) {
            count = rewardCount;
        } catch {}

        for (uint256 i; i < count; ++i) {
            address token;
            try REVENUE_STAKING.rewardTokens(i) returns (address rewardToken) {
                token = rewardToken;
            } catch {
                continue;
            }
            if (
                token == address(0) || token == address(CYVLSDT) || token == address(SDT)
                    || token == address(GOVERNANCE_TOKEN)
            ) continue;

            uint256 amount;
            try IERC20(token).balanceOf(address(this)) returns (uint256 balance) {
                amount = balance;
            } catch {
                continue;
            }
            if (amount == 0) continue;

            address adapter = rewardToSdtAdapter[token];
            if (adapter == address(0)) continue;
            uint256 minimumOut;
            try ICompounderAdapter(adapter).quote(token, address(SDT), amount) returns (uint256 quote) {
                minimumOut = quote;
            } catch {
                continue;
            }
            if (minimumOut == 0) continue;

            uint256 beforeSdt = SDT.balanceOf(address(this));
            IERC20(token).forceApprove(adapter, amount);
            try ICompounderAdapter(adapter).swap(
                token, address(SDT), amount, minimumOut, address(this), block.timestamp
            ) returns (uint256) {
                IERC20(token).forceApprove(adapter, 0);
                uint256 received = SDT.balanceOf(address(this)) - beforeSdt;
                if (received < minimumOut) revert InsufficientOutput(minimumOut, received);
            } catch {
                IERC20(token).forceApprove(adapter, 0);
                continue;
            }
        }

        uint256 sdtAmount = SDT.balanceOf(address(this));
        uint256 marketQuote;
        if (sdtAmount != 0) {
            address adapter = sdtToCyvlSdtAdapter;
            if (adapter != address(0)) {
                try ICompounderAdapter(adapter).quote(address(SDT), address(CYVLSDT), sdtAmount)
                    returns (uint256 quote)
                {
                    marketQuote = quote;
                } catch {}
            }

            uint256 marketThreshold = Math.mulDiv(sdtAmount, BPS + minimumMarketAdvantageBps, BPS);
            if (adapter != address(0) && marketQuote >= marketThreshold && marketQuote != 0) {
                uint256 beforeCyvl = CYVLSDT.balanceOf(address(this));
                SDT.forceApprove(adapter, sdtAmount);
                try ICompounderAdapter(adapter).swap(
                    address(SDT), address(CYVLSDT), sdtAmount, marketQuote, address(this), block.timestamp
                ) returns (uint256) {
                    SDT.forceApprove(adapter, 0);
                    uint256 receivedCyvl = CYVLSDT.balanceOf(address(this)) - beforeCyvl;
                    if (receivedCyvl < marketQuote) revert InsufficientOutput(marketQuote, receivedCyvl);
                    marketRouteUsed = true;
                } catch {
                    SDT.forceApprove(adapter, 0);
                }
            }

            if (!marketRouteUsed && SDT.balanceOf(address(this)) != 0) {
                uint256 remainingSdt = SDT.balanceOf(address(this));
                SDT.forceApprove(address(LOCKER), remainingSdt);
                try LOCKER.deposit(remainingSdt, address(this)) returns (uint256 minted) {
                    SDT.forceApprove(address(LOCKER), 0);
                    if (minted < remainingSdt) revert InsufficientOutput(remainingSdt, minted);
                } catch {
                    SDT.forceApprove(address(LOCKER), 0);
                }
            }
        }

        cyvlSdtCompounded = CYVLSDT.balanceOf(address(this));
        _stakeIdleCyvlSdt();
        emit Harvested(sdtAmount, cyvlSdtCompounded, marketRouteUsed, marketQuote);
    }

    /// @dev Strict all-configured-routes harvest used only by depositWithStrictHarvest.
    /// Any failure that prevents complete conversion reverts before depositor assets are transferred or shares are minted.
    function _harvestConfiguredStrict() internal returns (uint256 cyvlSdtCompounded, bool marketRouteUsed) {
        REVENUE_STAKING.claimRewards(address(this));

        uint256 count = REVENUE_STAKING.rewardTokenCount();
        for (uint256 i; i < count; ++i) {
            address token = REVENUE_STAKING.rewardTokens(i);
            if (
                token == address(0) || token == address(CYVLSDT) || token == address(SDT)
                    || token == address(GOVERNANCE_TOKEN)
            ) continue;

            uint256 amount = IERC20(token).balanceOf(address(this));
            if (amount == 0) continue;

            address adapter = rewardToSdtAdapter[token];
            if (adapter == address(0)) revert MissingAdapter();
            uint256 minimumOut = ICompounderAdapter(adapter).quote(token, address(SDT), amount);
            if (minimumOut == 0) revert InsufficientOutput(1, 0);

            uint256 beforeSdt = SDT.balanceOf(address(this));
            IERC20(token).forceApprove(adapter, amount);
            ICompounderAdapter(adapter).swap(
                token, address(SDT), amount, minimumOut, address(this), block.timestamp
            );
            IERC20(token).forceApprove(adapter, 0);
            uint256 received = SDT.balanceOf(address(this)) - beforeSdt;
            if (received < minimumOut) revert InsufficientOutput(minimumOut, received);
        }

        uint256 sdtAmount = SDT.balanceOf(address(this));
        uint256 marketQuote;
        if (sdtAmount != 0) {
            address adapter = sdtToCyvlSdtAdapter;
            if (adapter != address(0)) {
                try ICompounderAdapter(adapter).quote(address(SDT), address(CYVLSDT), sdtAmount)
                    returns (uint256 quote)
                {
                    marketQuote = quote;
                } catch {}
            }

            uint256 marketThreshold = Math.mulDiv(sdtAmount, BPS + minimumMarketAdvantageBps, BPS);
            if (adapter != address(0) && marketQuote >= marketThreshold && marketQuote != 0) {
                uint256 beforeCyvl = CYVLSDT.balanceOf(address(this));
                SDT.forceApprove(adapter, sdtAmount);
                ICompounderAdapter(adapter).swap(
                    address(SDT), address(CYVLSDT), sdtAmount, marketQuote, address(this), block.timestamp
                );
                SDT.forceApprove(adapter, 0);
                uint256 receivedCyvl = CYVLSDT.balanceOf(address(this)) - beforeCyvl;
                if (receivedCyvl < marketQuote) revert InsufficientOutput(marketQuote, receivedCyvl);
                marketRouteUsed = true;
            } else {
                SDT.forceApprove(address(LOCKER), sdtAmount);
                uint256 minted = LOCKER.deposit(sdtAmount, address(this));
                SDT.forceApprove(address(LOCKER), 0);
                if (minted < sdtAmount) revert InsufficientOutput(sdtAmount, minted);
            }
        }

        cyvlSdtCompounded = CYVLSDT.balanceOf(address(this));
        _stakeIdleCyvlSdt();
        emit Harvested(sdtAmount, cyvlSdtCompounded, marketRouteUsed, marketQuote);
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
            ICompounderAdapter(adapter).swap(
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
                marketQuote = ICompounderAdapter(adapter).quote(
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
                ICompounderAdapter(adapter).swap(
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

    function _convertToRealizedShares(uint256 assets, Math.Rounding rounding)
        internal
        view
        returns (uint256)
    {
        return Math.mulDiv(
            assets,
            totalSupply() + 10 ** _decimalsOffset(),
            realizedAssets() + 1,
            rounding
        );
    }

    function _convertToRealizedAssets(uint256 shares, Math.Rounding rounding)
        internal
        view
        returns (uint256)
    {
        return Math.mulDiv(
            shares,
            realizedAssets() + 1,
            totalSupply() + 10 ** _decimalsOffset(),
            rounding
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
