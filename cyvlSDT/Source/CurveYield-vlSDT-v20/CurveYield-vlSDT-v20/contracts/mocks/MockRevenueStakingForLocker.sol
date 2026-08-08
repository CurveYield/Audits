// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockRevenueStakingForLocker {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public notifiedAmount;
    mapping(address => uint256) public notifiedBaseRewardPerVlSDT;

    function notifyReward(address token, uint256 amount, uint256 baseRewardPerVlSDT) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        notifiedAmount[token] += amount;
        notifiedBaseRewardPerVlSDT[token] = baseRewardPerVlSDT;
    }
}
