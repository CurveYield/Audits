import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const NEW_VAULT = '0xdB6AA572243b9617C4b39FB20468843b2CB97bA5';

test('v10 entrypoint uses a new runtime URL so an old service worker cannot return stale transaction modules', () => {
  const html = read('index.html');
  assert.match(html, /src-v11\/app\.js/);
  assert.doesNotMatch(html, /src\/app\.js/);
});

test('v10 service worker uses network-first for scripts and styles', () => {
  const sw = read('service-worker.js');
  assert.match(sw, /curveyield-boosthub-shell-v11/);
  assert.match(sw, /networkFirstStatic/);
  assert.match(sw, /request\.destination === "script"/);
  assert.match(sw, /request\.destination === "style"/);
});

test('homepage renders independent staking and vault reward table cells and headers', () => {
  const app = read('src-v11/app.js');
  assert.match(app, /class="home-reward-column staking-reward-column"/);
  assert.match(app, /class="home-reward-column vault-reward-column"/);
  assert.match(app, /<h3>Staking Rewards<\/h3>/);
  assert.match(app, /<h3>Vault Rewards<\/h3>/);
  assert.doesNotMatch(app, /Staking &amp; Vault Rewards/);
});


test('snapshot version and browser cache key advance together', () => {
  const store = read('src-v11/data-store.js');
  assert.match(store, /const SNAPSHOT_VERSION = 16;/);
  assert.match(store, /const LOCAL_KEY = "curveyield\.boosthub\.live\.v16";/);
});

test('all sdCRV vault operations resolve to the replacement vault', async () => {
  const { LOCKERS } = await import(path.join(root, 'src-v11/config.js'));
  const { vaultAddressFor, vaultOperationTargets } = await import(path.join(root, 'src-v11/contract-targets.js'));
  const locker = LOCKERS.find((entry) => entry.id === 'sdcrv');
  assert.equal(vaultAddressFor(locker), NEW_VAULT);
  assert.deepEqual(vaultOperationTargets(locker), {
    allowanceSpender: NEW_VAULT,
    depositContract: NEW_VAULT,
    withdrawContract: NEW_VAULT,
    balanceContract: NEW_VAULT,
    ppsContract: NEW_VAULT,
    apyContract: NEW_VAULT,
    strategyLookupContract: NEW_VAULT,
  });
});
