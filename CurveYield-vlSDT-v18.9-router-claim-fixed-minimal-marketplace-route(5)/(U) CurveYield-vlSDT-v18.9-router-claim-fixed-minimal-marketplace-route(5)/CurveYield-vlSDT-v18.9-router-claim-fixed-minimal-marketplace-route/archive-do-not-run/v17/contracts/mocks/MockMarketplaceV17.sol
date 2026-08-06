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

contract MockMarketplaceV17 {
    struct SellListing {
        address seller;
        uint96 pricePerWeek;
        address paymentToken;
        uint32 maxDuration;
        uint64 expiry;
        uint128 amount;
        uint128 filled;
        uint32 minDuration;
    }
    struct BuyOffer {
        address buyer;
        uint96 pricePerWeek;
        address paymentToken;
        uint32 duration;
        uint64 expiry;
        address recipient;
        uint128 amount;
        uint128 filled;
    }
    uint256 public nextId = 1;
    mapping(uint256 => SellListing) public listings;
    mapping(uint256 => BuyOffer) public offers;
    mapping(address => uint256) public committedBalance;

    function createListing(
        uint256 amount,
        uint256 pricePerWeek,
        uint256 minDuration,
        uint256 maxDuration,
        address paymentToken,
        uint256 expiry
    ) external returns (uint256 id) {
        id = nextId++;
        listings[id] = SellListing(
            msg.sender,
            uint96(pricePerWeek),
            paymentToken,
            uint32(maxDuration),
            uint64(expiry),
            uint128(amount),
            0,
            uint32(minDuration)
        );
        committedBalance[msg.sender] += amount;
    }
    function updateListing(uint256 id, uint256 newAmount, uint256 newPricePerWeek) external {
        SellListing storage listing = listings[id];
        require(listing.seller == msg.sender, "owner");
        committedBalance[msg.sender] = committedBalance[msg.sender] + newAmount - listing.amount;
        listing.amount = uint128(newAmount);
        listing.pricePerWeek = uint96(newPricePerWeek);
    }
    function cancelListing(uint256 id) external {
        SellListing storage listing = listings[id];
        require(listing.seller == msg.sender, "owner");
        committedBalance[msg.sender] -= uint256(listing.amount) - uint256(listing.filled);
        delete listings[id];
    }
    function getListing(uint256 id) external view returns (SellListing memory) { return listings[id]; }
    function setOffer(
        uint256 id,
        address buyer,
        uint256 pricePerWeek,
        address paymentToken,
        uint256 duration,
        uint256 expiry,
        address recipient,
        uint256 amount
    ) external {
        offers[id] = BuyOffer(
            buyer,
            uint96(pricePerWeek),
            paymentToken,
            uint32(duration),
            uint64(expiry),
            recipient,
            uint128(amount),
            0
        );
    }
    function acceptOffer(uint256 id, uint256 fillAmount, uint256, uint256) external {
        BuyOffer storage offer = offers[id];
        require(offer.buyer != address(0), "offer");
        require(fillAmount <= uint256(offer.amount) - uint256(offer.filled), "fill");
        uint256 payment = fillAmount * uint256(offer.pricePerWeek) * uint256(offer.duration) / 1e18;
        offer.filled += uint128(fillAmount);
        IERC20(offer.paymentToken).transferFrom(offer.buyer, msg.sender, payment);
    }
    function getOffer(uint256 id) external view returns (BuyOffer memory) { return offers[id]; }
}
