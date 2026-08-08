export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

export const BOOSTHUB_ABI = [
  "function vlsdtDelegated() view returns (uint256)",
  "function vlBoost() view returns (address)",
  "function poolLength() view returns (uint256)",
  "function poolInfo(uint256) view returns (tuple(address asset,address gauge,bool active,uint256 totalStaked,address[] rewardTokens))",
  "function yieldBoostingTokens(uint256) view returns (address token,uint256 amount)",
  "function stakeDaoClaimExecutor() view returns (address)",
  "function checkpointGauge(uint256) returns (bool)",
  "function harvest(uint256) returns (address[] tokens,uint256[] amounts)",
  "function pendingRewards(uint256,address) view returns (address[] tokens,uint256[] amounts)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
];

export const STAKING_ABI = [
  "function boost_hub() view returns (address)",
  "function pid() view returns (uint256)",
  "function lp_token() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function reward_tokens(uint256) view returns (address)",
  "function claimable_reward(address,address) view returns (uint256)",
  "function claimable_reward(address,address) view returns (uint256)",
  "function reward_token_apr_bps(address) view returns (uint256)",
  "function deposit(uint256,address)",
  "function withdraw(uint256)",
  "function claim_rewards(address)",
  "function harvest()",
  "event Harvest(address indexed reward_token,uint256 amount)",
];

export const STAKEDAO_GAUGE_ABI = [
  "function SDT() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function working_balances(address) view returns (uint256)",
  "function working_supply() view returns (uint256)",
  "function reward_count() view returns (uint256)",
  "function reward_tokens(uint256) view returns (address)",
  "function claimable_reward(address,address) view returns (uint256)",
  "function reward_data(address) view returns (address token,address distributor,uint256 period_finish,uint256 rate,uint256 last_update,uint256 integral)",
];

export const STAKEDAO_CLAIM_EXECUTOR_ABI = [
  "function pendingTokens(uint256) view returns (address[] tokens)",
  "function getClaim(address) view returns (tuple(uint256 pid,uint256 index,uint256 amount,uint256 updateNumber,bytes32 root,bool exists) claim_,bytes32[] proof)",
];

export const VAULT_ABI = [
  "function decimals() view returns (uint8)",
  "function balance() view returns (uint256)",
  "function available() view returns (uint256)",
  "function getPricePerFullShare() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function deposit(uint256)",
  "function withdraw(uint256)",
  "function depositAll()",
  "function withdrawAll()",
  "function strategy() view returns (address)",
  "function paused() view returns (bool)",
];

export const STRATEGY_ABI = [
  "function harvest()",
  "function estimatedTokenAprBps() view returns (uint256)",
  "function aprLastUpdate() view returns (uint256)",
];
