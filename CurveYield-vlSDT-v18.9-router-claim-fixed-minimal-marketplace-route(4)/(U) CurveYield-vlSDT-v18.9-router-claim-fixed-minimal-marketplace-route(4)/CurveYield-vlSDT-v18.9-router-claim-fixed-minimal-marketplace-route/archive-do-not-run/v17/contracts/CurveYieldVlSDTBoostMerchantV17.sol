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
import {IBoostMarketplaceV17} from "./interfaces/IStakeDaoV17.sol";
import {
    ICurveYieldVlSDTLockerV17,
    ICurveYieldVlSDTRevenueStakingV17
} from "./interfaces/ICurveYieldV17.sol";

contract CurveYieldVlSDTBoostMerchantV17 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant WEEK = 7 days;
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_DURATION_WEEKS = 52;

    struct PaymentConfig {
        bool enabled;
        uint128 minPricePerWeek;
        uint128 maxPricePerWeek;
    }

    ICurveYieldVlSDTLockerV17 public immutable LOCKER;
    ICurveYieldVlSDTRevenueStakingV17 public immutable REVENUE_STAKING;
    IBoostMarketplaceV17 public immutable MARKETPLACE;

    mapping(address => PaymentConfig) public paymentConfig;
    mapping(address => bool) public isKeeper;
    mapping(uint256 => address) public listingPaymentToken;
    uint256 public minimumLeaseBoost = 1e18;

    error ZeroAddress();
    error ZeroAmount();
    error InvalidPriceRange();
    error UnsupportedPaymentToken();
    error InvalidDuration();
    error DeadlineExpired();
    error MaximumPaymentExceeded();
    error InsufficientBoostCapacity();
    error OfferBelowCurrentRate();
    error InvalidOffer();
    error NotOwnerOrKeeper();
    error BelowMinimumLease();

    event PaymentTokenConfigured(
        address indexed token,
        bool enabled,
        uint256 minPrice,
        uint256 maxPrice
    );
    event DirectLease(
        address indexed buyer,
        address indexed recipient,
        address indexed paymentToken,
        uint256 boostAmount,
        uint256 pricePerWeek,
        uint256 payment,
        uint256 endtime
    );
    event MarketplaceListingCreated(
        uint256 indexed listingId,
        address indexed paymentToken,
        uint256 amount,
        uint256 price
    );
    event MarketplaceListingUpdated(uint256 indexed listingId, uint256 amount, uint256 price);
    event MarketplaceListingCancelled(uint256 indexed listingId);
    event MarketplaceOfferFilled(uint256 indexed offerId, uint256 fillAmount, uint256 pricePerWeek);
    event KeeperSet(address indexed keeper, bool allowed);
    event MinimumLeaseBoostSet(uint256 amount);

    constructor(address initialOwner_, address locker_, address revenueStaking_, address marketplace_)
        Ownable(initialOwner_)
    {
        if (
            initialOwner_ == address(0) || locker_ == address(0) || revenueStaking_ == address(0)
                || marketplace_ == address(0)
        ) revert ZeroAddress();

        LOCKER = ICurveYieldVlSDTLockerV17(locker_);
        REVENUE_STAKING = ICurveYieldVlSDTRevenueStakingV17(revenueStaking_);
        MARKETPLACE = IBoostMarketplaceV17(marketplace_);
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

    function setMinimumLeaseBoost(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        minimumLeaseBoost = amount;
        emit MinimumLeaseBoostSet(amount);
    }

    function setPaymentToken(
        address token,
        bool enabled,
        uint256 minPricePerWeek,
        uint256 maxPricePerWeek
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (
            minPricePerWeek == 0 || maxPricePerWeek < minPricePerWeek
                || maxPricePerWeek > type(uint128).max
        ) revert InvalidPriceRange();

        paymentConfig[token] = PaymentConfig(
            enabled,
            uint128(minPricePerWeek),
            uint128(maxPricePerWeek)
        );
        emit PaymentTokenConfigured(token, enabled, minPricePerWeek, maxPricePerWeek);
    }

    function utilization() public view returns (uint256) {
        uint256 total = LOCKER.boostMerchantBoostCapacity();
        if (total == 0) return PRECISION;
        uint256 available = LOCKER.boostMerchantDelegableBoost();
        if (available >= total) return 0;
        return Math.mulDiv(total - available, PRECISION, total);
    }

    function currentPricePerWeek(address paymentToken) public view returns (uint256 price) {
        PaymentConfig memory config = paymentConfig[paymentToken];
        if (!config.enabled) revert UnsupportedPaymentToken();

        uint256 used = utilization();
        uint256 usedSquared = Math.mulDiv(used, used, PRECISION);
        price = uint256(config.minPricePerWeek)
            + Math.mulDiv(
                uint256(config.maxPricePerWeek) - uint256(config.minPricePerWeek),
                usedSquared,
                PRECISION
            );
    }

    function quoteLease(address paymentToken, uint256 boostAmount, uint256 durationWeeks)
        public
        view
        returns (uint256 pricePerWeek, uint256 endtime, uint256 totalPayment)
    {
        if (boostAmount == 0) revert ZeroAmount();
        if (boostAmount < minimumLeaseBoost) revert BelowMinimumLease();

        pricePerWeek = currentPricePerWeek(paymentToken);
        endtime = _alignedEndtime(durationWeeks);
        totalPayment = Math.mulDiv(
            boostAmount,
            pricePerWeek * (endtime - block.timestamp),
            WEEK * PRECISION
        );
    }

    function leaseBoost(
        address paymentToken,
        uint256 boostAmount,
        uint256 durationWeeks,
        address recipient,
        uint256 maxPayment,
        uint256 deadline
    ) external nonReentrant returns (uint256 payment, uint256 endtime) {
        if (recipient == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (boostAmount > LOCKER.boostMerchantDelegableBoost()) revert InsufficientBoostCapacity();

        (uint256 pricePerWeek, uint256 quotedEndtime, uint256 totalPayment) =
            quoteLease(paymentToken, boostAmount, durationWeeks);
        if (totalPayment > maxPayment) revert MaximumPaymentExceeded();

        payment = totalPayment;
        endtime = quotedEndtime;

        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), payment);
        IERC20(paymentToken).forceApprove(address(REVENUE_STAKING), payment);
        REVENUE_STAKING.notifyReward(paymentToken, payment, 0);
        IERC20(paymentToken).forceApprove(address(REVENUE_STAKING), 0);

        LOCKER.delegateBoost(boostAmount, endtime, recipient);
        emit DirectLease(
            msg.sender,
            recipient,
            paymentToken,
            boostAmount,
            pricePerWeek,
            payment,
            endtime
        );
    }

    function createMarketplaceListing(
        address paymentToken,
        uint256 amount,
        uint256 minDuration,
        uint256 maxDuration,
        uint256 expiry
    ) external onlyOwnerOrKeeper returns (uint256 listingId) {
        uint256 price = currentPricePerWeek(paymentToken);
        listingId = LOCKER.marketplaceCreateListing(
            amount,
            price,
            minDuration,
            maxDuration,
            paymentToken,
            expiry
        );
        listingPaymentToken[listingId] = paymentToken;
        emit MarketplaceListingCreated(listingId, paymentToken, amount, price);
    }

    function refreshMarketplaceListing(uint256 listingId, uint256 newAmount)
        external
        onlyOwnerOrKeeper
    {
        address paymentToken = listingPaymentToken[listingId];
        if (paymentToken == address(0)) revert InvalidOffer();

        uint256 price = currentPricePerWeek(paymentToken);
        LOCKER.marketplaceUpdateListing(listingId, newAmount, price);
        emit MarketplaceListingUpdated(listingId, newAmount, price);
    }

    function cancelMarketplaceListing(uint256 listingId) external onlyOwnerOrKeeper {
        if (listingPaymentToken[listingId] == address(0)) revert InvalidOffer();
        LOCKER.marketplaceCancelListing(listingId);
        delete listingPaymentToken[listingId];
        emit MarketplaceListingCancelled(listingId);
    }

    function fillProfitableOffer(
        uint256 offerId,
        uint256 fillAmount,
        uint256 minTotalPayment,
        uint256 maxEffectiveDuration
    ) external nonReentrant returns (uint256 revenueAmount) {
        IBoostMarketplaceV17.BuyOffer memory offer = MARKETPLACE.getOffer(offerId);
        if (
            offer.buyer == address(0) || offer.expiry <= block.timestamp || fillAmount == 0
                || fillAmount > uint256(offer.amount) - uint256(offer.filled)
        ) revert InvalidOffer();

        uint256 currentPrice = currentPricePerWeek(offer.paymentToken);
        if (offer.pricePerWeek < currentPrice) revert OfferBelowCurrentRate();
        if (fillAmount > LOCKER.boostMerchantDelegableBoost()) revert InsufficientBoostCapacity();

        revenueAmount = LOCKER.marketplaceAcceptOffer(
            offerId,
            fillAmount,
            minTotalPayment,
            maxEffectiveDuration,
            offer.paymentToken
        );
        emit MarketplaceOfferFilled(offerId, fillAmount, offer.pricePerWeek);
    }

    function _alignedEndtime(uint256 durationWeeks) internal view returns (uint256 endtime) {
        if (durationWeeks == 0 || durationWeeks > MAX_DURATION_WEEKS) revert InvalidDuration();
        endtime = Math.ceilDiv(block.timestamp + durationWeeks * WEEK, WEEK) * WEEK;
    }
}
