const DB_NAME = 'curveyield-boosthub-private-v1';
const DB_VERSION = 1;
const STORE_NAME = 'confirmed-activity';

function lower(value) { return String(value || '').toLowerCase(); }

export function normalizeActivityRecord(input = {}) {
  const account = lower(input.account);
  const lockerId = String(input.lockerId || '');
  const hash = String(input.hash || '');
  const chainId = Number(input.chainId);
  const timestamp = Number(input.timestamp || Date.now());
  if (!account.startsWith('0x') || !lockerId || !hash.startsWith('0x') || !Number.isFinite(chainId) || !Number.isFinite(timestamp)) return null;
  return {
    id: `${chainId}:${account}:${lockerId}:${lower(hash)}`,
    account,
    chainId,
    lockerId,
    hash,
    timestamp,
    title: String(input.title || 'Confirmed transaction'),
    type: String(input.type || 'transaction'),
    target: String(input.target || ''),
    amount: input.amount === null || input.amount === undefined ? null : String(input.amount),
    symbol: input.symbol ? String(input.symbol) : null,
    status: 'confirmed',
  };
}

export function filterActivity(rows = [], { account, chainId, lockerId, limit = 8 } = {}) {
  const wantedAccount = lower(account);
  return rows
    .filter((row) => row && row.status === 'confirmed')
    .filter((row) => !wantedAccount || lower(row.account) === wantedAccount)
    .filter((row) => chainId === null || chainId === undefined || Number(row.chainId) === Number(chainId))
    .filter((row) => !lockerId || row.lockerId === lockerId)
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
    .slice(0, limit);
}

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function recordActivity(input) {
  const row = normalizeActivityRecord(input);
  if (!row) return null;
  const db = await openDb();
  if (!db) return row;
  await new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(row);
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
    transaction.onabort = resolve;
  });
  db.close();
  return row;
}

export async function readActivity({ account, chainId = null, lockerId = null, limit = 40 } = {}) {
  const db = await openDb();
  if (!db) return [];
  const rows = await new Promise((resolve) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => resolve([]);
  });
  db.close();
  return filterActivity(rows, { account, chainId, lockerId, limit });
}
