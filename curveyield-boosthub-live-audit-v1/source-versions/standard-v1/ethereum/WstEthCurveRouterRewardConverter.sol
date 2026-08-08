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

interface IWstEthCurveRouterRewardConverterWstEth {
    function getStETHByWstETH(uint256 wstETHAmount) external view returns (uint256);
    function unwrap(uint256 wstETHAmount) external returns (uint256);
}

interface IWstEthCurveRouterRewardConverterRouter {
    function get_exchange_multiple_amount(address[9] calldata route, uint256[3][4] calldata swapParams, uint256 amount)
        external
        view
        returns (uint256);

    function exchange_multiple(
        address[9] calldata route,
        uint256[3][4] calldata swapParams,
        uint256 amount,
        uint256 expected
    ) external payable returns (uint256);
}

contract WstEthCurveRouterRewardConverter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable wstEth;
    address public immutable stEth;
    address public immutable tokenOut;
    address public immutable router;

    address[9] private route_;
    uint256[3][4] private swapParams_;

    error InvalidToken();
    error InvalidRoute();
    error ZeroAmount();
    error ZeroQuote();
    error Slippage();

    constructor(
        address wstEth_,
        address stEth_,
        address tokenOut_,
        address router_,
        address[9] memory route__,
        uint256[3][4] memory swapParams__
    ) {
        if (wstEth_ == address(0) || stEth_ == address(0) || tokenOut_ == address(0) || router_ == address(0)) {
            revert InvalidToken();
        }
        if (route__[0] != stEth_) revert InvalidRoute();
        if (_lastToken(route__) != tokenOut_) revert InvalidRoute();

        wstEth = wstEth_;
        stEth = stEth_;
        tokenOut = tokenOut_;
        router = router_;
        route_ = route__;
        swapParams_ = swapParams__;
    }

    receive() external payable {}

    function route() external view returns (address[9] memory) {
        return route_;
    }

    function swapParams() external view returns (uint256[3][4] memory) {
        return swapParams_;
    }

    function pools() external view returns (address[] memory routePools) {
        uint256 count;
        for (uint256 i = 1; i < route_.length; i += 2) {
            if (route_[i] == address(0)) break;
            count++;
        }

        routePools = new address[](count);
        for (uint256 i; i < count; i++) {
            routePools[i] = route_[1 + i * 2];
        }
    }

    function previewConvert(address tokenIn_, address tokenOut_, uint256 amountIn)
        external
        view
        returns (uint256 amountOut)
    {
        if (tokenIn_ != wstEth || tokenOut_ != tokenOut) revert InvalidToken();
        if (amountIn == 0) return 0;

        uint256 stEthAmount = IWstEthCurveRouterRewardConverterWstEth(wstEth).getStETHByWstETH(amountIn);
        if (stEthAmount == 0) return 0;

        amountOut =
            IWstEthCurveRouterRewardConverterRouter(router).get_exchange_multiple_amount(route_, swapParams_, stEthAmount);
    }

    function convert(address tokenIn_, address tokenOut_, uint256 amountIn, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (tokenIn_ != wstEth || tokenOut_ != tokenOut) revert InvalidToken();
        if (amountIn == 0) revert ZeroAmount();

        IERC20(wstEth).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 beforeStEth = IERC20(stEth).balanceOf(address(this));
        IWstEthCurveRouterRewardConverterWstEth(wstEth).unwrap(amountIn);
        uint256 stEthAmount = IERC20(stEth).balanceOf(address(this)) - beforeStEth;
        if (stEthAmount == 0) revert ZeroQuote();

        IERC20(stEth).forceApprove(router, stEthAmount);

        uint256 beforeOut = IERC20(tokenOut).balanceOf(address(this));
        IWstEthCurveRouterRewardConverterRouter(router).exchange_multiple(route_, swapParams_, stEthAmount, minAmountOut);
        IERC20(stEth).forceApprove(router, 0);

        amountOut = IERC20(tokenOut).balanceOf(address(this)) - beforeOut;
        if (amountOut == 0) revert ZeroQuote();
        if (amountOut < minAmountOut) revert Slippage();

        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }

    function _lastToken(address[9] memory route__) internal pure returns (address lastToken) {
        for (uint256 i; i < route__.length; i += 2) {
            if (route__[i] == address(0)) break;
            lastToken = route__[i];
        }
    }
}
