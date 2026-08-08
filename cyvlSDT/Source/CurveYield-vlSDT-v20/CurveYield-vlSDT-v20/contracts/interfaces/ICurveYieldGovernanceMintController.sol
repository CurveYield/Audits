// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

interface ICurveYieldGovernanceMintController {
    function governanceStaking() external view returns (address);
    function governanceToken() external view returns (address);
}

interface ICurveYieldGovernanceMintReceiver {
    function queueMintedParticipationReward(uint256 amount) external returns (uint256 readyAt);
}
