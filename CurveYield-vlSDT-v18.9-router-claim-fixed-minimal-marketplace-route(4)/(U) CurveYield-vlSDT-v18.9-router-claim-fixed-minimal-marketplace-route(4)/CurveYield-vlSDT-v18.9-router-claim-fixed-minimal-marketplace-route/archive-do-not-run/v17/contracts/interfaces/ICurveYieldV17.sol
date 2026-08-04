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

interface ICurveYieldVlSDTTokenV17 {
    function mint(address receiver, uint256 amount) external;
    function burn(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface ICurveYieldGovernanceTokenV17 {
    function mint(address receiver, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function CAP() external view returns (uint256);
}



interface ICurveYieldGovernanceStakingV17 {
    function stakeFor(address recipient, uint256 amount) external returns (uint256 votingTokensMinted);
    function notifyParticipationReward(address token, uint256 amount) external;
    function participationMultiplierBps(address account) external view returns (uint256);
}

interface ICurveYieldVlSDTRevenueStakingV17 {
    function admin() external view returns (address);
    function notifyReward(address token, uint256 amount, uint256 baseRewardPerVlSDT) external;
    function stake(uint256 amount) external;
    function withdrawImmediate(uint256 amount, address receiver) external returns (uint256 received);
    function requestWithdrawal(uint256 amount) external returns (uint256 id);
    function completeQueuedWithdrawal(uint256 id, address receiver) external returns (uint256 amount);
    function claimRewards(address receiver) external;
    function claimGovernance(address receiver) external returns (uint256 amount);
    function earnedGovernance(address user) external view returns (uint256);
    function activeBalance(address user) external view returns (uint256);
    function isRewardToken(address token) external view returns (bool);
}

interface ICurveYieldVlSDTLockerV17 {
    function deposit(uint256 amount, address receiver) external returns (uint256 minted);
    function delegateBoost(uint256 amount, uint256 endtime, address recipient)
        external
        returns (uint256 commitmentId);
    function releaseModuleBoostCommitment(uint256 id) external;
    function totalVlSDT() external view returns (uint256);
    function delegableBoost() external view returns (uint256);
    function moduleBoostAllocation() external view returns (uint256);
    function boostMerchantBoostCapacity() external view returns (uint256);
    function boostStakingBoostCapacity() external view returns (uint256);
    function boostMerchantDelegableBoost() external view returns (uint256);
    function boostStakingDelegableBoost() external view returns (uint256);
    function boostMerchantBoostUsed() external view returns (uint256);
    function boostStakingBoostUsed() external view returns (uint256);
    function daoBoostAllocation() external view returns (uint256);
    function daoDelegableBoost() external view returns (uint256);
    function adminBoostAllocation() external view returns (uint256);
    function adminDelegableBoost() external view returns (uint256);

    function marketplaceCreateListing(
        uint256 amount,
        uint256 pricePerWeek,
        uint256 minDuration,
        uint256 maxDuration,
        address paymentToken,
        uint256 expiry
    ) external returns (uint256 listingId);

    function marketplaceUpdateListing(uint256 listingId, uint256 newAmount, uint256 newPricePerWeek) external;
    function marketplaceCancelListing(uint256 listingId) external;

    function marketplaceAcceptOffer(
        uint256 offerId,
        uint256 fillAmount,
        uint256 minTotalPayment,
        uint256 maxEffectiveDuration,
        address paymentToken
    ) external returns (uint256 revenueAmount);
}
