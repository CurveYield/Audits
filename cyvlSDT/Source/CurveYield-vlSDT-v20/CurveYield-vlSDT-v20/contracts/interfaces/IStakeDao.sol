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

interface IVlSDT {
    function stake(uint256 amount, address recipient) external;
    function unstake(uint256 amount) external returns (uint256 id);
    function withdraw(uint256 id, address recipient) external;
    function balanceOf(address account) external view returns (uint256);
}

interface IVlBoost {
    function boost(address delegator, uint256 amount, uint256 endtime, address recipient) external;
    function delegableBalance(address delegator) external view returns (uint256);
    function delegatedOut(address delegator) external view returns (uint256);
    function setOperator(address operator, bool approved) external;
}

interface IFeeDistributor {
    function REWARD_TOKEN() external view returns (address);
    function claim(address user, address receiver) external returns (uint256);
}

interface IStakeDaoRouter {
    function execute(bytes[] calldata calls) external payable returns (bytes[] memory);
}

interface IBoostMarketplace {
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

    function createListing(
        uint256 amount,
        uint256 pricePerWeek,
        uint256 minDuration,
        uint256 maxDuration,
        address paymentToken,
        uint256 expiry
    ) external returns (uint256 listingId);

    function updateListing(uint256 listingId, uint256 newAmount, uint256 newPricePerWeek) external;
    function cancelListing(uint256 listingId) external;
    function committedBalance(address seller) external view returns (uint256);
    function getListing(uint256 listingId) external view returns (SellListing memory);

    function acceptOffer(
        uint256 offerId,
        uint256 fillAmount,
        uint256 minTotalPayment,
        uint256 maxEffectiveDuration
    ) external;

    function getOffer(uint256 offerId) external view returns (BuyOffer memory);
}
