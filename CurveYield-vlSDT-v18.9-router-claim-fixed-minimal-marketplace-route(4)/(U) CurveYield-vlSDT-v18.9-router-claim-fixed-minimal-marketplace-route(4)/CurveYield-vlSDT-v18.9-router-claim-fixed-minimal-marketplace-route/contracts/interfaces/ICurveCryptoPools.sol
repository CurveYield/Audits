// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

interface ICurveTricryptoUsdcPool {
    function coins(uint256 index) external view returns (address);
    function price_oracle(uint256 index) external view returns (uint256);
    function exchange(
        uint256 i,
        uint256 j,
        uint256 dx,
        uint256 minDy,
        bool useEth,
        address receiver
    ) external payable returns (uint256 amountOut);
}

interface ICurveTwoCryptoPool {
    function coins(uint256 index) external view returns (address);
    function price_oracle() external view returns (uint256);
    function exchange(uint256 i, uint256 j, uint256 dx, uint256 minDy, address receiver)
        external
        returns (uint256 amountOut);
}
