// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

interface ICurveYieldRevenueStrategyV7 {
    function want() external view returns (address);
    function vault() external view returns (address);
    function beforeDeposit() external;
    function beforeDepositStrict() external;
    function deposit() external;
    function withdraw(uint256 amount) external;
    function retireStrat() external;
    function retireStratEmergency() external;
    function balanceOf() external view returns (uint256);
    function estimatedUnharvestedWant() external view returns (uint256);
    function pendingCyGov() external view returns (uint256);
    function claimCyGovToDistributor() external returns (uint256 amount);
}
