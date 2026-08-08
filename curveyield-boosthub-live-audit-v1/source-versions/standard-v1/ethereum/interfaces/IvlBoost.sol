// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IvlBoost {
    function boost(address delegator, uint256 amount, uint256 endtime, address recipient) external;
    function delegableBalance(address account) external view returns (uint256);
    function delegatedOut(address user) external view returns (uint256);
    function delegatedIn(address user) external view returns (uint256);
    function adjusted_balance_of(address account) external view returns (uint256);
    function checkpointUser(address user) external;
    function MAX_DURATION_WEEKS() external view returns (uint256);
    function vlSDT() external view returns (address);
}
