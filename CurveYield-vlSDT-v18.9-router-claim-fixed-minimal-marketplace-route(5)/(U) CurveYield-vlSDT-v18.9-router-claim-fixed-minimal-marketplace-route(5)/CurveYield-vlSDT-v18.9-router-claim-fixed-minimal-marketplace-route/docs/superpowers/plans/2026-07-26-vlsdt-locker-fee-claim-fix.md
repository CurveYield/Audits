# vlSDT Locker Stake DAO Router Claim Implementation Plan

## Task 1: Add exact Router regression support

**Files:**

- Create `contracts/mocks/MockStakeDaoRouter.sol`
- Modify `contracts/mocks/MockFeeDistributor.sol`
- Replace `test/v18/VlSDTLockerFeeClaimV18.test.js`

Implement production-shaped operator claims and Router module decoding in
mocks. Add tests expecting the exact two-call payload, two reward deltas,
independent notification, and both-zero revert. Confirm the unchanged locker
fails before production changes.

## Task 2: Replace the locker claim integration

**Files:**

- Modify `contracts/interfaces/IStakeDao.sol`
- Modify `contracts/CurveYieldVlSDTLocker.sol`

Add the Router interface and immutable Router/two-distributor bindings. Replace
the direct single-distributor call with the verified two-module
`execute(bytes[])` flow and independent reward forwarding.

## Task 3: Update canonical deployment

**Files:**

- Modify `config-mainnet-v18.json`
- Modify `deployment-v18/lib-v18.js`
- Modify `deployment-v18/deploy-configure-v18.js`
- Modify `deployment-v18/verify-deployment-v18.js`

Validate all external contracts, derive both reward tokens, deploy the corrected
locker constructor, register both rewards, and verify every binding.

## Task 4: Update simulations and compatibility checks

**Files:**

- Modify `deployment-v18/simulate-vlsdt-locker-claim-30d-focused-v18.9.js`
- Modify `deployment-v18/simulate-live-deployment-30d-v18.9-fixed.js`
- Modify `test/v18/LiveFeeDistributorCompatibilityV18.test.js`

Record both token paths and assert the exact live Router payload.

## Task 5: Verify and rerun

Run the focused test, clean compile, static checks, size check, and full suite.
Then rerun the historical fork with exact 1,000 SDT backing and the corrected
Router claim. Replace the superseded package and reports only after fresh
output proves the behavior.
