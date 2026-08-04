# CurveYield Revenue Compounder ABI V17

Contract: `CurveYieldRevenueCompounderV17`

Base template: OpenZeppelin Contracts 5.4.0 `ERC4626` with OpenZeppelin `ERC20`, `Ownable2Step`, `ReentrancyGuard`, and `SafeERC20`.

The compiled ABI exposes **62 externally callable functions/getters**. Solidity public constants, immutables, mappings, and structs create ABI getters and are included in that count.

## ERC-4626 and ERC-20 surface (25)

| Mutability | Signature | Returns |
|---|---|---|
| view | `allowance(address,address)` | `uint256` |
| nonpayable | `approve(address,uint256)` | `bool` |
| view | `asset()` | `address` |
| view | `balanceOf(address)` | `uint256` |
| view | `convertToAssets(uint256)` | `uint256` |
| view | `convertToShares(uint256)` | `uint256` |
| view | `decimals()` | `uint8` |
| nonpayable | `deposit(uint256,address)` | `uint256` |
| view | `maxDeposit(address)` | `uint256` |
| view | `maxMint(address)` | `uint256` |
| view | `maxRedeem(address)` | `uint256` |
| view | `maxWithdraw(address)` | `uint256` |
| nonpayable | `mint(uint256,address)` | `uint256` |
| view | `name()` | `string` |
| view | `previewDeposit(uint256)` | `uint256` |
| view | `previewMint(uint256)` | `uint256` |
| view | `previewRedeem(uint256)` | `uint256` |
| view | `previewWithdraw(uint256)` | `uint256` |
| nonpayable | `redeem(uint256,address,address)` | `uint256` |
| view | `symbol()` | `string` |
| view | `totalAssets()` | `uint256` |
| view | `totalSupply()` | `uint256` |
| nonpayable | `transfer(address,uint256)` | `bool` |
| nonpayable | `transferFrom(address,address,uint256)` | `bool` |
| nonpayable | `withdraw(uint256,address,address)` | `uint256` |

## Ownership surface (5)

| Mutability | Signature | Returns |
|---|---|---|
| nonpayable | `acceptOwnership()` | `—` |
| view | `owner()` | `address` |
| view | `pendingOwner()` | `address` |
| nonpayable | `renounceOwnership()` | `—` |
| nonpayable | `transferOwnership(address)` | `—` |

## CurveYield write operations (9)

| Mutability | Signature | Returns |
|---|---|---|
| nonpayable | `claimGovernance(bool)` | `uint256` |
| nonpayable | `completeWithdrawal(uint256)` | `uint256` |
| nonpayable | `harvest(address[],uint256[],uint256,uint256)` | `uint256, bool` |
| nonpayable | `harvestGovernance()` | `uint256` |
| nonpayable | `requestWithdrawal(uint256,address)` | `uint256, uint256` |
| nonpayable | `setKeeper(address,bool)` | `—` |
| nonpayable | `setMinimumMarketAdvantageBps(uint256)` | `—` |
| nonpayable | `setRewardToSdtAdapter(address,address)` | `—` |
| nonpayable | `setSdtToCyvlSdtAdapter(address)` | `—` |

## CurveYield views and generated getters (23)

| Mutability | Signature | Returns |
|---|---|---|
| view | `accruedGovernance(address)` | `uint256` |
| view | `BPS()` | `uint256` |
| view | `CYVLSDT()` | `address` |
| view | `earnedGovernance(address)` | `uint256` |
| view | `GOVERNANCE_STAKING()` | `address` |
| view | `GOVERNANCE_TOKEN()` | `address` |
| view | `governanceObserved()` | `uint256` |
| view | `governancePaidOut()` | `uint256` |
| view | `governanceRewardPerShareStored()` | `uint256` |
| view | `governanceUndistributed()` | `uint256` |
| view | `IMMEDIATE_WITHDRAW_FEE_BPS()` | `uint256` |
| view | `isKeeper(address)` | `bool` |
| view | `LOCKER()` | `address` |
| view | `MAX_MARKET_ADVANTAGE_BPS()` | `uint256` |
| view | `minimumMarketAdvantageBps()` | `uint256` |
| view | `nextWithdrawalId()` | `uint256` |
| view | `PRECISION()` | `uint256` |
| view | `REVENUE_STAKING()` | `address` |
| view | `rewardToSdtAdapter(address)` | `address` |
| view | `SDT()` | `address` |
| view | `sdtToCyvlSdtAdapter()` | `address` |
| view | `userGovernanceRewardPerSharePaid(address)` | `uint256` |
| view | `withdrawalRequests(uint256)` | `address, address, uint128, uint128, bool` |

## Exit behavior

- Standard `withdraw` and `redeem` use Revenue Staking's immediate route and account for its fixed 0.5% fee in previews.
- `requestWithdrawal` and `completeWithdrawal` are additional non-ERC-4626 functions using Revenue Staking's delayed no-fee route.
- `claimGovernance(bool)` lets the caller receive liquid governance rewards or stake them directly into Governance Staking.
