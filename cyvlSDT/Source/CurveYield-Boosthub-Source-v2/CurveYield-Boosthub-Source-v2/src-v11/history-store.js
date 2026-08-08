const DB_NAME = 'curveyield-boosthub-analytics-v1';
const DB_VERSION = 1;
const STORE_NAME = 'yield-history';
const HOUR_MS = 60 * 60 * 1000;
const RANGE_MS = {
  '7d': 7 * 24 * HOUR_MS,
  '30d': 30 * 24 * HOUR_MS,
  '90d': 90 * 24 * HOUR_MS,
  '1y': 365 * 24 * HOUR_MS,
  all: Infinity,
};

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeYieldObservation(lockerId, live = {}, timestamp = live.updatedAt ?? Date.now()) {
  const observedAt = Number(timestamp);
  if (!lockerId || !Number.isFinite(observedAt) || observedAt <= 0) return null;
  const defaultAprBps = finiteOrNull(live.defaultAprBps);
  const boostHubAprBps = finiteOrNull(live.boostHubAprBps);
  const vaultApyBps = finiteOrNull(live.vaultApyBps);
  if (defaultAprBps === null && boostHubAprBps === null && vaultApyBps === null) return null;
  const bucket = Math.floor(observedAt / HOUR_MS) * HOUR_MS;
  return {
    id: `${lockerId}:${bucket}`,
    lockerId: String(lockerId),
    bucket,
    observedAt,
    defaultAprBps,
    boostHubAprBps,
    vaultApyBps,
    source: String(live?.aprSource?.type || live?.curveApySource?.type || 'live-runtime'),
    status: String(live.status || 'live'),
    synthetic: false,
  };
}

export function filterYieldHistory(rows = [], range = '7d', now = Date.now()) {
  const windowMs = RANGE_MS[range] ?? RANGE_MS['7d'];
  const cutoff = Number.isFinite(windowMs) ? Number(now) - windowMs : -Infinity;
  return rows
    .filter((row) => row && row.synthetic !== true && Number(row.observedAt) >= cutoff)
    .sort((a, b) => Number(a.observedAt) - Number(b.observedAt));
}

export function buildChartSeries(rows = []) {
  const points = rows
    .map((row) => ({
      observedAt: Number(row.observedAt),
      defaultAprBps: finiteOrNull(row.defaultAprBps),
      boostHubAprBps: finiteOrNull(row.boostHubAprBps),
      vaultApyBps: finiteOrNull(row.vaultApyBps),
    }))
    .filter((row) => Number.isFinite(row.observedAt));
  const values = points.flatMap((row) => [row.defaultAprBps, row.vaultApyBps]).filter((value) => value !== null && value >= 0);
  return {
    points,
    minBps: values.length ? Math.min(...values) : 0,
    maxBps: values.length ? Math.max(...values) : 0,
  };
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

export async function recordYieldObservation(lockerId, live, { maxRowsPerLocker = 9000 } = {}) {
  const observation = normalizeYieldObservation(lockerId, live);
  if (!observation) return null;
  const db = await openDb();
  if (!db) return observation;
  await new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(observation);
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
    transaction.onabort = resolve;
  });
  // Bounded pruning is intentionally simple: only run occasionally at the hour boundary.
  if (observation.observedAt - observation.bucket < 5 * 60 * 1000) {
    const all = await readYieldHistory(lockerId);
    if (all.length > maxRowsPerLocker) {
      const remove = all.slice(0, all.length - maxRowsPerLocker);
      await new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        remove.forEach((row) => store.delete(row.id));
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
        transaction.onabort = resolve;
      });
    }
  }
  db.close();
  return observation;
}

export async function readYieldHistory(lockerId) {
  const db = await openDb();
  if (!db) return [];
  const rows = await new Promise((resolve) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => resolve([]);
  });
  db.close();
  return rows.filter((row) => row?.lockerId === lockerId && row.synthetic !== true).sort((a, b) => Number(a.observedAt) - Number(b.observedAt));
}

export async function readAllYieldHistory(lockerIds = []) {
  const entries = await Promise.all(lockerIds.map(async (lockerId) => [lockerId, await readYieldHistory(lockerId)]));
  return new Map(entries);
}
