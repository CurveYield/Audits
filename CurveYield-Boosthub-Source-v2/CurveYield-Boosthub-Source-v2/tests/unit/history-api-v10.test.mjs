import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIndexerHistoryPayload, chooseHistorySource } from '../../src-v11/history-api.js';

test('remote indexer payload maps to the two existing chart fields', () => {
  const rows = normalizeIndexerHistoryPayload({
    lockerId: 'sdfxs',
    points: [
      { observedAt: 1000, stakedaoDefaultAprBps: 901, boosthubVaultApyBps: 1002 },
      { observedAt: 2000, stakedaoDefaultAprBps: 910, boosthubVaultApyBps: 1015 },
    ],
  }, 'sdfxs');
  assert.equal(rows[0].defaultAprBps, 901);
  assert.equal(rows[0].vaultApyBps, 1002);
  assert.equal(rows[0].source, 'cloudflare-d1');
  assert.equal(rows[0].synthetic, false);
});

test('remote D1 history wins with two real points and local IndexedDB remains the fallback', () => {
  const local = [{ observedAt: 10, defaultAprBps: 1, vaultApyBps: 2, synthetic: false }];
  const remote = [
    { observedAt: 20, defaultAprBps: 3, vaultApyBps: 4, synthetic: false },
    { observedAt: 30, defaultAprBps: 5, vaultApyBps: 6, synthetic: false },
  ];
  assert.deepEqual(chooseHistorySource(remote, local), remote);
  assert.deepEqual(chooseHistorySource([], local), local);
  assert.deepEqual(chooseHistorySource([remote[0]], local), local);
});
