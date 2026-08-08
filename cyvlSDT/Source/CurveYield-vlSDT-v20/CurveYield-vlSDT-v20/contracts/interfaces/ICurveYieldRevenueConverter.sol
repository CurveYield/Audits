// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

interface ICurveYieldRevenueConverter {
    function outputToken() external view returns (address);
    function supportsToken(address tokenIn) external view returns (bool);
    function quote(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut);
    function convert(
        address tokenIn,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 amountOut);
}
