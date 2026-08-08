import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../service-worker.js', import.meta.url), 'utf8');

function createHarness() {
  const listeners = new Map();
  const added = [];
  const deleted = [];
  const cachePuts = [];
  const fallback = { kind: 'offline-index' };
  const cache = {
    async addAll(urls) { added.push(...urls); },
    async put(request, response) { cachePuts.push([request, response]); },
  };
  const context = {
    URL,
    Response,
    fetch: async () => ({ ok: true, clone() { return this; } }),
    caches: {
      async open(name) { context.openedCache = name; return cache; },
      async keys() { return ['curveyield-boosthub-shell-v2', 'curveyield-boosthub-shell-v3', 'curveyield-boosthub-shell-v4', 'curveyield-boosthub-shell-v5', 'unrelated-cache', 'curveyield-boosthub-shell-v6', 'curveyield-boosthub-shell-v8', 'curveyield-boosthub-shell-v11']; },
      async delete(name) { deleted.push(name); return true; },
      async match(request) {
        const url = typeof request === 'string' ? request : request.url;
        return url.endsWith('/index.html') ? fallback : null;
      },
    },
    self: {
      registration: { scope: 'https://gateway.example/ipfs/bafy-test/' },
      location: { origin: 'https://gateway.example' },
      clients: { async claim() { context.claimed = true; } },
      async skipWaiting() { context.skipped = true; },
      addEventListener(type, listener) { listeners.set(type, listener); },
    },
    console,
  };
  vm.runInNewContext(source, context, { filename: 'service-worker.js' });
  return { context, listeners, added, deleted, cachePuts, fallback };
}

async function runWaitUntil(listener, event = {}) {
  let promise;
  listener({ ...event, waitUntil(value) { promise = value; } });
  await promise;
}

test('service worker precaches the complete v11 static shell inside its IPFS scope', async () => {
  const h = createHarness();
  await runWaitUntil(h.listeners.get('install'));
  assert.equal(h.context.openedCache, 'curveyield-boosthub-shell-v11');
  assert.equal(h.context.skipped, true);
  assert.ok(h.added.length >= 40);
  assert.ok(h.added.every((url) => url.startsWith('https://gateway.example/ipfs/bafy-test/')));
  assert.ok(h.added.some((url) => url.endsWith('/assets/tokens/stakedao/fxs.svg')));
  assert.ok(h.added.some((url) => url.endsWith('/src-v11/app.js')));
});

test('service worker activation deletes only older CurveYield shell caches', async () => {
  const h = createHarness();
  await runWaitUntil(h.listeners.get('activate'));
  assert.deepEqual(h.deleted, ['curveyield-boosthub-shell-v2', 'curveyield-boosthub-shell-v3', 'curveyield-boosthub-shell-v4', 'curveyield-boosthub-shell-v5', 'curveyield-boosthub-shell-v6', 'curveyield-boosthub-shell-v8']);
  assert.equal(h.context.claimed, true);
});

test('offline navigation falls back to cached scoped index without caching RPC requests', async () => {
  const h = createHarness();
  h.context.fetch = async () => { throw new Error('offline'); };
  let responsePromise;
  h.listeners.get('fetch')({
    request: { method: 'GET', url: 'https://gateway.example/ipfs/bafy-test/locker', mode: 'navigate', destination: 'document' },
    respondWith(value) { responsePromise = value; },
  });
  assert.equal(await responsePromise, h.fallback);

  let intercepted = false;
  h.listeners.get('fetch')({
    request: { method: 'POST', url: 'https://ethereum-rpc.publicnode.com', mode: 'cors', destination: '' },
    respondWith() { intercepted = true; },
  });
  assert.equal(intercepted, false);
});
