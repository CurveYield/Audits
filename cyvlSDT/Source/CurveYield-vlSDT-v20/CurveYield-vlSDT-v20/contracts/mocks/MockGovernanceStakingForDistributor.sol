// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockGovernanceStakingForDistributor {
    IERC20 public immutable TOKEN;
    mapping(address => uint256) public stakedFor;

    constructor(address token_) {
        TOKEN = IERC20(token_);
    }

    function stakeFor(address recipient, uint256 amount) external returns (uint256 votingTokensMinted) {
        TOKEN.transferFrom(msg.sender, address(this), amount);
        stakedFor[recipient] += amount;
        return amount;
    }

    function notifyParticipationReward(address, uint256) external {}
    function participationMultiplierBps(address) external pure returns (uint256) { return 10_000; }
}
