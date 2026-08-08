// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

interface ICurveYieldCyGovDistributor {
    function vault() external view returns (address);
    function checkpoint(address from, address to) external;
    function sync() external;
    function earned(address user) external view returns (uint256 amount);
}
