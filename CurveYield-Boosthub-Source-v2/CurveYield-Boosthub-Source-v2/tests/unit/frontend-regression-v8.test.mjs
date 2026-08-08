import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { LOCKERS, blockscoutInteractionUrl, blockscoutSourceUrl } from '../../src-v11/config.js';
import { parseStakeDaoRewards } from '../../src-v11/stakedao-lockers.js';
import { mergeSnapshotLocker, SNAPSHOT_VERSION } from '../../src-v11/data-store.js';
import { appendErrorLog, normalizeAppError } from '../../src-v11/error-log.js';
import { filterErrorEntries, paginateEntries } from '../../src-v11/diagnostics.js';
import { resolveConfiguredTopology, resolveStakeDaoYield } from '../../src-v11/live-data.js';

const visible = LOCKERS.filter((locker) => !locker.hidden);

test('visible lockers use the approved audit-scope order', () => {
  assert.deepEqual(visible.map((locker) => locker.id), ['sdcrv', 'sdfxn', 'sdfxs']);
});



test('v10 invalidates prior shell snapshots after the transaction-target correction', () => {
  assert.equal(SNAPSHOT_VERSION, 16);
});

test('sdCRV uses the replacement vault and verified live strategy', () => {
  const sdCrv = visible.find((locker) => locker.id === 'sdcrv');
  assert.equal(sdCrv.vaultAddress, '0xdB6AA572243b9617C4b39FB20468843b2CB97bA5');
  assert.equal(sdCrv.strategyAddress, '0x93DFEfeFd5D3736381086eFa5A8810F278138ADf');
});

test('all visible staking contracts use Blockscout interaction and source pages', () => {
  for (const locker of visible) {
    assert.equal(locker.stakingInteractionUrl, blockscoutInteractionUrl(locker.chainId, locker.stakingAddress, { token: true }));
    assert.equal(locker.stakingSourceUrl, blockscoutSourceUrl(locker.chainId, locker.stakingAddress, { token: true }));
  }
});

test('configured topology survives staking introspection failure', () => {
  const locker = visible.find((entry) => entry.id === 'sdfxs');
  assert.deepEqual(resolveConfiguredTopology(locker), {
    boostHubAddress: '0xFbEF8941Da53EA724385B44E91ae9672061D0263',
    pid: 0,
    lpAddress: '0x1AEe2382e05Dc68BDfC472F1E46d570feCca5814',
    gaugeAddress: '0x12992595328E52267c95e45B1a97014D6Ddf8683',
  });
});

test('StakeDAO self token is excluded unless explicitly configured', () => {
  const locker = {
    sdToken: { address: '0x0000000000000000000000000000000000000001' },
    rewards: [
      { token: { address: '0x0000000000000000000000000000000000000001', symbol: 'sdCRV', decimals: 18 }, apr: 0, streaming: false },
      { token: { address: '0x0000000000000000000000000000000000000002', symbol: 'crvUSD', decimals: 18 }, apr: 12.04, streaming: true },
    ],
  };
  const rewards = parseStakeDaoRewards(locker, { includeAddresses: ['0x0000000000000000000000000000000000000002'] });
  assert.deepEqual(rewards.map((reward) => reward.symbol), ['crvUSD']);
});

test('partial refresh preserves last-known values and their timestamp', () => {
  const merged = mergeSnapshotLocker(
    { defaultAprBps: 1204, vaultApyBps: 4602, updatedAt: 1000, lastSuccessfulAt: 1000, status: 'live' },
    { status: 'partial', updatedAt: 2000, fieldErrors: { topology: 'offline' } },
  );
  assert.equal(merged.defaultAprBps, 1204);
  assert.equal(merged.vaultApyBps, 4602);
  assert.equal(merged.lastKnownAt, 1000);
  assert.equal(merged.updatedAt, 2000);
});

test('repeated errors keep a bounded occurrence timeline', () => {
  const first = normalizeAppError(new Error('RPC failed'), { action: 'read-topology', lockerId: 'sdfxs', chain: 'fraxtal', timestamp: 100 });
  const second = normalizeAppError(new Error('RPC failed'), { action: 'read-topology', lockerId: 'sdfxs', chain: 'fraxtal', timestamp: 200 });
  const third = normalizeAppError(new Error('RPC failed'), { action: 'read-topology', lockerId: 'sdfxs', chain: 'fraxtal', timestamp: 300 });
  const entries = appendErrorLog(appendErrorLog(appendErrorLog([], first, 1000), second, 1000), third, 1000);
  assert.equal(entries[0].count, 3);
  assert.equal(entries[0].firstTimestamp, 100);
  assert.equal(entries[0].lastTimestamp, 300);
  assert.deepEqual(entries[0].occurrences, [300, 200, 100]);
});

test('admin diagnostics filters are slim and support contract or transaction hash', () => {
  const entries = [
    { status: 'problem', chain: 'ethereum', contractAddress: '0xabc', transactionHash: '0x111', message: 'bad' },
    { status: 'healthy', chain: 'fraxtal', contractAddress: '0xdef', transactionHash: '0x222', message: 'ok' },
  ];
  assert.deepEqual(filterErrorEntries(entries, { chain: 'ethereum', status: 'problem', contractAddress: '0xabc' }), [entries[0]]);
  assert.deepEqual(filterErrorEntries(entries, { transactionHash: '0x222' }), [entries[1]]);
});

test('diagnostic pagination defaults to 200 and supports approved sizes', () => {
  const entries = Array.from({ length: 575 }, (_, index) => ({ id: index }));
  const first = paginateEntries(entries, { page: 1, pageSize: 200 });
  assert.equal(first.items.length, 200);
  assert.equal(first.totalPages, 3);
  assert.equal(first.pageSize, 200);
  const last = paginateEntries(entries, { page: 3, pageSize: 500 });
  assert.equal(last.page, 2);
  assert.equal(last.items.length, 75);
  assert.throws(() => paginateEntries(entries, { page: 1, pageSize: 25 }), /page size/i);
});


test('partial refresh does not erase working yield fields with null replacements', () => {
  const merged = mergeSnapshotLocker(
    { defaultAprBps: 2574.066, boostHubAprBps: 3012.4, vaultApyBps: 3510, boostMultiplier: 1.22, updatedAt: 1000, status: 'live' },
    { defaultAprBps: 2574.066, boostHubAprBps: null, vaultApyBps: null, boostMultiplier: null, updatedAt: 2000, status: 'partial', fieldErrors: { workingRaw: 'RPC unavailable' } },
  );
  assert.equal(merged.defaultAprBps, 2574.066);
  assert.equal(merged.boostHubAprBps, 3012.4);
  assert.equal(merged.vaultApyBps, 3510);
  assert.equal(merged.boostMultiplier, 1.22);
});

test('Ethereum sdFXN still uses the variable StakeDAO boost range', () => {
  const fxn = resolveStakeDaoYield('sdfxn', { minAprBps: 2574.066789070415, maxAprBps: 4275.444475381215 }, 1.22);
  assert.ok(fxn.defaultAprBps > 0);
  assert.ok(fxn.boostHubAprBps >= fxn.defaultAprBps);
  assert.ok(fxn.vaultApyBps > fxn.boostHubAprBps);
  assert.equal(fxn.boostMultiplier, 1.22);
});

const appSource = await readFile(new URL('../../src-v11/app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../../styles-v11.css', import.meta.url), 'utf8');
const serviceWorkerSource = await readFile(new URL('../../service-worker.js', import.meta.url), 'utf8');

test('home rows are fully clickable and rewards use two compact columns', () => {
  assert.match(appSource, /<a class="locker-row white-locker-card"[^>]+href="#\/locker\/\$\{locker\.id\}"/);
  assert.match(appSource, /class="home-reward-column staking-reward-column"/);
  assert.match(appSource, /class="home-reward-column vault-reward-column"/);
  assert.match(appSource, /<h3>Staking Rewards<\/h3>/);
  assert.match(appSource, /<h3>Vault Rewards<\/h3>/);
  assert.doesNotMatch(appSource, /Staking &amp; Vault Rewards/);
});

test('menu labels and ordering match the approved navigation', () => {
  assert.match(appSource, /href="#\/"[^>]*>[\s\S]*?<span>Home<\/span>/);
  assert.match(appSource, /href="#\/admin"[^>]*>[\s\S]*?<span>Admin<\/span>/);
  assert.doesNotMatch(appSource, /BoostHub Home|Administration<\/a>/);
});

test('unlimited approval page warnings are removed while approval behavior remains', () => {
  assert.doesNotMatch(appSource, /approval-note|Deposits may require an <strong>unlimited token approval/);
  assert.match(appSource, /ethers\.MaxUint256/);
});

test('wallet mismatch has automatic and manual switch paths', () => {
  assert.match(appSource, /promptWalletChainForRoute/);
  assert.match(appSource, /data-action="switch-chain"/);
  assert.match(appSource, /wallet_switchEthereumChain/);
});

test('offline shell and visible offline notice are installed', () => {
  assert.match(indexSource, /id="offlineIndicator"[^>]*>Connection Offline<\/span>/);
  assert.match(appSource, /serviceWorker\.register/);
  assert.match(serviceWorkerSource, /CACHE_NAME/);
  assert.match(serviceWorkerSource, /request\.method !== "GET"/);
  assert.match(stylesSource, /\.offline-indicator/);
});


test('locker contract summary includes a strategy contract link and copy control', () => {
  assert.match(appSource, /card\("Compounding strategy"/);
  assert.match(appSource, /blockscoutInteractionUrl\(locker\.chainId, strategyAddress\)/);
  assert.match(appSource, /data-copy-address="\$\{address\}"/);
});
