// SPDX-License-Identifier: UNLICENSED
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
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISdFxsCurvePool {
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
}

contract SdFxsRewardConverter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable wfrax;
    address public immutable sdFxs;
    ISdFxsCurvePool public immutable pool;

    error InvalidToken();
    error ZeroAmount();
    error ZeroQuote();
    error Slippage();

    constructor(address wfrax_, address sdFxs_, address pool_) {
        if (wfrax_ == address(0) || sdFxs_ == address(0) || pool_ == address(0)) revert InvalidToken();

        wfrax = wfrax_;
        sdFxs = sdFxs_;
        pool = ISdFxsCurvePool(pool_);
    }

    function previewConvert(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (uint256 amountOut)
    {
        if (tokenIn != wfrax || tokenOut != sdFxs) revert InvalidToken();
        if (amountIn == 0) return 0;
        amountOut = pool.get_dy(0, 1, amountIn);
    }

    function convert(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (tokenIn != wfrax || tokenOut != sdFxs) revert InvalidToken();
        if (amountIn == 0) revert ZeroAmount();

        IERC20(wfrax).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 beforeOut = IERC20(sdFxs).balanceOf(address(this));
        IERC20(wfrax).forceApprove(address(pool), amountIn);
        pool.exchange(0, 1, amountIn, minAmountOut);
        IERC20(wfrax).forceApprove(address(pool), 0);

        amountOut = IERC20(sdFxs).balanceOf(address(this)) - beforeOut;
        if (amountOut == 0) revert ZeroQuote();
        if (amountOut < minAmountOut) revert Slippage();

        IERC20(sdFxs).safeTransfer(msg.sender, amountOut);
    }
}
