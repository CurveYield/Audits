// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

interface ICurveYieldStrategy {
    function want() external view returns (address);
    function vault() external view returns (address);
    function balanceOf() external view returns (uint256);
    function estimatedTokenAprBps() external view returns (uint256);
    function beforeDeposit() external;
    function deposit() external;
    function withdraw(uint256 amount) external;
}
