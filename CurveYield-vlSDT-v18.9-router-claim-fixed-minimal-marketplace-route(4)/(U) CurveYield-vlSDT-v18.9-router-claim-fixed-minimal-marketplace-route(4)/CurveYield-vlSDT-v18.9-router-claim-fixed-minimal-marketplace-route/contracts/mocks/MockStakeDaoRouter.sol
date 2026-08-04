// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMockOperatorFeeDistributor {
    function claim(address user, address receiver) external returns (uint256);
}

contract MockStakeDaoRouter {
    using SafeERC20 for IERC20;

    uint8 public constant CLAIM_FEE_DISTRIBUTORS_MODULE = 0x0c;
    uint8 public constant SWEEP_TOKENS_MODULE = 0x07;
    bytes4 public constant CLAIM_FEE_DISTRIBUTORS_SELECTOR = 0xb38aab9d;
    bytes4 public constant SWEEP_TOKENS_SELECTOR = 0x780469bb;

    bytes public lastClaimCall;
    bytes public lastSweepCall;

    error InvalidCalls();
    error InvalidModule();
    error InvalidSelector();
    error LengthMismatch();

    function execute(bytes[] calldata calls) external payable returns (bytes[] memory results) {
        if (calls.length != 2) revert InvalidCalls();
        if (uint8(calls[0][0]) != CLAIM_FEE_DISTRIBUTORS_MODULE) revert InvalidModule();
        if (uint8(calls[1][0]) != SWEEP_TOKENS_MODULE) revert InvalidModule();
        if (_selector(calls[0]) != CLAIM_FEE_DISTRIBUTORS_SELECTOR) revert InvalidSelector();
        if (_selector(calls[1]) != SWEEP_TOKENS_SELECTOR) revert InvalidSelector();

        address[] memory distributors = abi.decode(calls[0][5:], (address[]));
        address[] memory tokens = abi.decode(calls[1][5:], (address[]));
        if (distributors.length != tokens.length) revert LengthMismatch();

        lastClaimCall = calls[0];
        lastSweepCall = calls[1];
        results = new bytes[](2);
        uint256[] memory amounts = new uint256[](distributors.length);
        for (uint256 i; i < distributors.length; ++i) {
            amounts[i] =
                IMockOperatorFeeDistributor(distributors[i]).claim(msg.sender, address(this));
        }
        results[0] = abi.encode(amounts);

        for (uint256 i; i < tokens.length; ++i) {
            uint256 amount = IERC20(tokens[i]).balanceOf(address(this));
            if (amount != 0) IERC20(tokens[i]).safeTransfer(msg.sender, amount);
        }
    }

    function _selector(bytes calldata callData) private pure returns (bytes4 selector) {
        assembly {
            selector := calldataload(add(callData.offset, 1))
        }
    }
}
