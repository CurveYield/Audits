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

contract MockCompounderAdapterV17 {
    uint256 public quoteBps = 10_000;
    function setQuoteBps(uint256 bps) external { quoteBps = bps; }
    function quote(address, address, uint256 amountIn) external view returns (uint256) {
        return amountIn * quoteBps / 10_000;
    }
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address receiver,
        uint256
    ) external returns (uint256 amountOut) {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        amountOut = amountIn * quoteBps / 10_000;
        require(amountOut >= minimumAmountOut, "min");
        IERC20(tokenOut).transfer(receiver, amountOut);
    }
}
