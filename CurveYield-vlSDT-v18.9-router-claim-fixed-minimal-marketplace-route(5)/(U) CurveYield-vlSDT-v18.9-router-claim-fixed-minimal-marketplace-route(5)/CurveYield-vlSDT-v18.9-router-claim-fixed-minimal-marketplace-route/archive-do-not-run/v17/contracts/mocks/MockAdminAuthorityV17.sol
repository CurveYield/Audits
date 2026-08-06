// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

contract MockAdminAuthorityV17 {
    address public admin;

    error OnlyAdmin();
    error ZeroAddress();

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
    }

    function setAdmin(address newAdmin) external {
        if (msg.sender != admin) revert OnlyAdmin();
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }
}
