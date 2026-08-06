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

interface IMintableGovernanceV17 { function mint(address receiver, uint256 amount) external; }

contract MockRevenueStakingForCompounderV17 {
    uint256 public constant IMMEDIATE_WITHDRAW_FEE_BPS = 50;
    IERC20 public immutable CYVLSDT;
    IMintableGovernanceV17 public immutable GOV;
    mapping(address => uint256) public activeBalance;
    mapping(address => uint256) public governanceEarned;
    mapping(address => bool) public isRewardToken;
    uint256 public nextWithdrawalId = 1;
    mapping(uint256 => uint256) public withdrawals;

    constructor(address cyvlSdt_, address gov_) { CYVLSDT = IERC20(cyvlSdt_); GOV = IMintableGovernanceV17(gov_); }
    function setRewardToken(address token, bool allowed) external { isRewardToken[token] = allowed; }
    function setGovernanceEarned(address user, uint256 amount) external { governanceEarned[user] = amount; }
    function notifyReward(address,uint256,uint256) external {}
    function stake(uint256 amount) external {
        CYVLSDT.transferFrom(msg.sender, address(this), amount);
        activeBalance[msg.sender] += amount;
    }
    function withdrawImmediate(uint256 amount, address receiver) external returns (uint256 received) {
        activeBalance[msg.sender] -= amount;
        received = amount * (10_000 - IMMEDIATE_WITHDRAW_FEE_BPS) / 10_000;
        CYVLSDT.transfer(receiver, received);
    }
    function requestWithdrawal(uint256 amount) external returns (uint256 id) {
        activeBalance[msg.sender] -= amount;
        id = nextWithdrawalId++;
        withdrawals[id] = amount;
    }
    function completeQueuedWithdrawal(uint256 id, address receiver) external returns (uint256 amount) {
        amount = withdrawals[id];
        delete withdrawals[id];
        CYVLSDT.transfer(receiver, amount);
    }
    function claimRewards(address) external {}
    function claimGovernance(address receiver) external returns (uint256 amount) {
        amount = governanceEarned[msg.sender];
        governanceEarned[msg.sender] = 0;
        GOV.mint(receiver, amount);
    }
    function earnedGovernance(address user) external view returns (uint256) { return governanceEarned[user]; }
}
