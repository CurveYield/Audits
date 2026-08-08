// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IStakeDaoGauge {
    struct Reward {
        address token;
        address distributor;
        uint256 period_finish;
        uint256 rate;
        uint256 last_update;
        uint256 integral;
    }

    function deposit(uint256 amount, address receiver) external;
    function withdraw(uint256 amount, bool claimRewards) external;
    function withdraw(uint256 amount, address user, bool claimRewards) external;
    function claim_rewards() external;
    function claim_rewards(address user) external;
    function claim_rewards(address user, address receiver) external;
    function claim_rewards_for(address user, address receiver) external;
    function user_checkpoint(address user) external returns (bool);
    function integrate_checkpoint_of(address user) external;
    function reward_tokens(uint256 index) external view returns (address);
    function reward_data(address rewardToken) external view returns (Reward memory);
    function claimable_reward(address user, address rewardToken) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function working_balances(address account) external view returns (uint256);
    function working_supply() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function staking_token() external view returns (address);
}
