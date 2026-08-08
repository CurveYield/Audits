import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAINS, LOCKERS } from '../../src-v11/config.js';
import {
  calculateTokenPricedAprBps,
  resolveXChainReceiptYield,
} from '../../src-v11/live-data.js';

test('Fraxtal wallet metadata uses FRAX after North Star', () => {
  assert.equal(CHAINS.fraxtal.chainId, 252);
  assert.equal(CHAINS.fraxtal.nativeCurrency.symbol, 'FRAX');
  assert.equal(CHAINS.fraxtal.nativeCurrency.name, 'Frax');
});

test('sdFXS explicitly uses the uniform XChain gauge model', () => {
  const locker = LOCKERS.find((entry) => entry.id === 'sdfxs');
  assert.equal(locker.gaugeModel, 'xchain-uniform');
});

test('receipt token APR is normalized into deposit-token USD APR', () => {
  assert.equal(calculateTokenPricedAprBps({ tokenAprBps: 1000, rewardPriceUsd: 1, depositPriceUsd: 2 }), 500);
  assert.equal(calculateTokenPricedAprBps({ tokenAprBps: 1000, rewardPriceUsd: 2, depositPriceUsd: 2 }), 1000);
  assert.equal(calculateTokenPricedAprBps({ tokenAprBps: null, rewardPriceUsd: 1, depositPriceUsd: 2 }), null);
});

test('XChain receipt yield has a neutral 1x multiplier and compounds receipt APR', () => {
  const result = resolveXChainReceiptYield({ receiptRewardAprBps: [1200, 300] });
  assert.equal(result.defaultAprBps, 1500);
  assert.equal(result.boostHubAprBps, 1500);
  assert.equal(result.boostMultiplier, 1);
  assert.ok(result.vaultApyBps > 1500);
  assert.equal(result.boostModel, 'xchain-uniform');
});

test('XChain vault APY prefers a nonzero harvested strategy APR', () => {
  const result = resolveXChainReceiptYield({ receiptRewardAprBps: [1200, 300], strategyAprBps: 1100 });
  assert.equal(result.defaultAprBps, 1500);
  assert.equal(result.boostHubAprBps, 1500);
  assert.equal(result.vaultAprBps, 1100);
  assert.ok(result.vaultApyBps > 1100);
  assert.ok(result.vaultApyBps < resolveXChainReceiptYield({ receiptRewardAprBps: [1200, 300] }).vaultApyBps);
});

test('XChain yield falls back to API reward APRs when receipt APR reads fail', () => {
  const result = resolveXChainReceiptYield({ receiptRewardAprBps: [null, null], fallbackRewardAprBps: [900, 250] });
  assert.equal(result.boostHubAprBps, 1150);
  assert.equal(result.boostMultiplier, 1);
});


test('XChain yield falls back per reward when only one receipt APR read fails', () => {
  const result = resolveXChainReceiptYield({ receiptRewardAprBps: [700, null], fallbackRewardAprBps: [650, 250] });
  assert.equal(result.boostHubAprBps, 950);
});

test('xchain default APR can use the StakeDAO minimum independently from vault APR', () => {
  const result = resolveXChainReceiptYield({ receiptRewardAprBps: [1200, 300], strategyAprBps: 1100, stakeDaoDefaultAprBps: 901 });
  assert.equal(result.defaultAprBps, 901);
  assert.equal(result.vaultAprBps, 1100);
  assert.equal(result.boostMultiplier, 1);
});
