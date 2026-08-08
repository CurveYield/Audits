import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYieldObservation, filterYieldHistory, buildChartSeries } from '../../src-v11/history-store.js';
import { normalizeActivityRecord, filterActivity } from '../../src-v11/activity-store.js';

test('yield observations preserve only real finite metrics and use hourly buckets', () => {
  const obs = normalizeYieldObservation('sdcrv', { updatedAt: 1_800_123, defaultAprBps: 542, vaultApyBps: 1867, boostHubAprBps: 1140, status: 'live' });
  assert.equal(obs.lockerId, 'sdcrv');
  assert.equal(obs.bucket, 0);
  assert.equal(obs.observedAt, 1_800_123);
  assert.equal(obs.defaultAprBps, 542);
  assert.equal(obs.vaultApyBps, 1867);
  assert.equal(obs.synthetic, false);
});

test('yield observation rejects fabricated or empty metrics', () => {
  assert.equal(normalizeYieldObservation('sdcrv', { updatedAt: Date.now(), defaultAprBps: null, vaultApyBps: null }), null);
});

test('history range filtering never invents missing points', () => {
  const now = 10 * 86_400_000;
  const rows = [
    { observedAt: now - 8 * 86_400_000, defaultAprBps: 100, vaultApyBps: 200 },
    { observedAt: now - 2 * 86_400_000, defaultAprBps: 110, vaultApyBps: 220 },
    { observedAt: now - 1 * 86_400_000, defaultAprBps: 120, vaultApyBps: 240 },
  ];
  const filtered = filterYieldHistory(rows, '7d', now);
  assert.deepEqual(filtered.map((r) => r.defaultAprBps), [110,120]);
  assert.equal(buildChartSeries(filtered).points.length, 2);
});

test('activity is scoped to account, chain, and locker and remains confirmed only', () => {
  const row = normalizeActivityRecord({ account: '0xAbC', chainId: 1, lockerId: 'sdcrv', hash: '0x123', title: 'sdCRV deposit', type: 'deposit', target: 'vault', amount: '10', symbol: 'sdCRV', timestamp: 1000 });
  assert.equal(row.account, '0xabc');
  assert.equal(row.status, 'confirmed');
  assert.equal(filterActivity([row], { account: '0xABC', chainId: 1, lockerId: 'sdcrv' }).length, 1);
  assert.equal(filterActivity([row], { account: '0xdef', chainId: 1, lockerId: 'sdcrv' }).length, 0);
});
