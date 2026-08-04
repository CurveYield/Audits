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

contract MockVlBoostV17 {
    mapping(address => uint256) public delegableBalance;
    mapping(address => uint256) public delegatedOut;
    mapping(address => mapping(address => bool)) public isOperator;
    address public lastDelegator;
    address public lastRecipient;
    uint256 public lastAmount;
    uint256 public lastEndtime;

    function setDelegableBalance(address account, uint256 amount) external { delegableBalance[account] = amount; }
    function setOperator(address operator, bool approved) external { isOperator[msg.sender][operator] = approved; }
    function boost(address delegator, uint256 amount, uint256 endtime, address recipient) external {
        require(delegableBalance[delegator] >= amount, "capacity");
        delegableBalance[delegator] -= amount;
        delegatedOut[delegator] += amount;
        lastDelegator = delegator;
        lastRecipient = recipient;
        lastAmount = amount;
        lastEndtime = endtime;
    }
}
