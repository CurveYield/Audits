const SNAPSHOT_VERSION = 16;
const LOCAL_KEY = "curveyield.boosthub.live.v16";
const ERROR_LOCAL_KEY = "curveyield.boosthub.errors.v1";
const STORAGE_DIAGNOSTIC_LOCAL_KEY = "curveyield.boosthub.storage-diagnostics.v1";
const DB_NAME = "curveyield-boosthub-live";
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "latest";
const ERROR_KEY = "errors";
const CHANNEL_NAME = "curveyield-boosthub-live";

export function encodeSnapshot(snapshot) {
  return JSON.stringify(snapshot, (_key, value) => typeof value === "bigint" ? value.toString() : value);
}

export function decodeSnapshot(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const snapshot = JSON.parse(value);
    if (snapshot?.version !== SNAPSHOT_VERSION || !snapshot.lockers || typeof snapshot.lockers !== "object") return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function normalizeStoredErrors(value, maxEntries = 1000) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object" && entry.id && entry.message).slice(0, maxEntries);
}

export function mergeSnapshotLocker(previous = {}, fresh = {}) {
  const merged = { ...previous };
  const fieldErrors = fresh?.fieldErrors && typeof fresh.fieldErrors === "object" ? fresh.fieldErrors : {};
  const preserveUnavailable = Object.keys(fieldErrors).length > 0 || fresh?.status === "partial" || fresh?.status === "error";
  for (const [key, value] of Object.entries(fresh || {})) {
    if (value === undefined) continue;
    if (preserveUnavailable && value === null && previous[key] !== undefined && previous[key] !== null) continue;
    merged[key] = value;
  }
  if (Object.keys(fieldErrors).length) {
    merged.status = "partial";
    merged.fieldErrors = fieldErrors;
    merged.lastKnownAt = Number(previous.lastSuccessfulAt || previous.lastKnownAt || previous.updatedAt || 0) || null;
    merged.lastSuccessfulAt = Number(previous.lastSuccessfulAt || previous.updatedAt || 0) || null;
  } else if (fresh?.status) {
    merged.status = fresh.status;
    merged.lastSuccessfulAt = Number(fresh.updatedAt || previous.lastSuccessfulAt || previous.updatedAt || 0) || null;
    delete merged.lastKnownAt;
    delete merged.fieldErrors;
  }
  return merged;
}

export function describeSnapshotCache(local, indexed) {
  const summarize = (snapshot) => ({
    present: Boolean(snapshot),
    savedAt: Number(snapshot?.savedAt || 0),
    lockerCount: snapshot?.lockers && typeof snapshot.lockers === "object" ? Object.keys(snapshot.lockers).length : 0,
  });
  const localSummary = summarize(local);
  const indexedSummary = summarize(indexed);
  let freshest = "none";
  if (localSummary.present || indexedSummary.present) freshest = indexedSummary.savedAt > localSummary.savedAt ? "indexed" : "local";
  return { local: localSummary, indexed: indexedSummary, freshest };
}

export function loadLocalSnapshot() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  return decodeSnapshot(window.localStorage.getItem(LOCAL_KEY));
}

let storageDiagnostics = [];

function safeError(error) {
  return { name: String(error?.name || "Error"), message: String(error?.message || error || "Unknown storage error") };
}

function recordStorageFailure({ subsystem, operation, store = null, keyCategory = null, outcome = "fallback", error }) {
  const safe = safeError(error);
  const entry = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, timestamp: Date.now(), subsystem, operation, store, keyCategory, outcome, ...safe };
  storageDiagnostics = [entry, ...storageDiagnostics].slice(0, 100);
  try { window.localStorage?.setItem(STORAGE_DIAGNOSTIC_LOCAL_KEY, JSON.stringify(storageDiagnostics)); } catch { /* Avoid recursive diagnostics. */ }
  return entry;
}

export async function inspectStorageHealth() {
  let estimate = { usage: null, quota: null };
  let persisted = null;
  try { if (navigator?.storage?.estimate) estimate = await navigator.storage.estimate(); } catch (error) { recordStorageFailure({ subsystem: "browser-storage", operation: "estimate", outcome: "unavailable", error }); }
  try { if (navigator?.storage?.persisted) persisted = await navigator.storage.persisted(); } catch (error) { recordStorageFailure({ subsystem: "browser-storage", operation: "persisted", outcome: "unavailable", error }); }
  const indexedDbAvailable = typeof indexedDB !== "undefined";
  let localStorageAvailable = false;
  try { localStorageAvailable = Boolean(window.localStorage); } catch (error) { recordStorageFailure({ subsystem: "localStorage", operation: "availability", outcome: "unavailable", error }); }
  return { indexedDbAvailable, localStorageAvailable, persisted, usage: Number(estimate?.usage ?? 0), quota: Number(estimate?.quota ?? 0), diagnostics: getStorageDiagnostics() };
}

export function getStorageDiagnostics() {
  if (!storageDiagnostics.length) {
    try { storageDiagnostics = JSON.parse(window.localStorage?.getItem(STORAGE_DIAGNOSTIC_LOCAL_KEY) || "[]").slice(0, 100); } catch { storageDiagnostics = []; }
  }
  return [...storageDiagnostics];
}

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    recordStorageFailure({ subsystem: "IndexedDB", operation: "open", store: STORE_NAME, outcome: "unavailable", error: new Error("IndexedDB is unavailable in this browser context") });
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { recordStorageFailure({ subsystem: "IndexedDB", operation: "open", store: STORE_NAME, outcome: "failed", error: request.error }); resolve(null); };
    request.onblocked = () => { recordStorageFailure({ subsystem: "IndexedDB", operation: "open", store: STORE_NAME, outcome: "blocked", error: new Error("IndexedDB upgrade/open was blocked by another tab") }); resolve(null); };
  });
}

async function readDatabaseKey(key) {
  const db = await openDatabase();
  if (!db) return null;
  const value = await new Promise((resolve) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => { recordStorageFailure({ subsystem: "IndexedDB", operation: "read", store: STORE_NAME, keyCategory: String(key), outcome: "failed", error: request.error }); resolve(null); };
  });
  db.close();
  return value;
}

async function writeDatabaseKey(key, value) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => { recordStorageFailure({ subsystem: "IndexedDB", operation: "write", store: STORE_NAME, keyCategory: String(key), outcome: "failed", error: request.error }); resolve(); };
  });
  db.close();
}

async function deleteDatabaseKey(key) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => { recordStorageFailure({ subsystem: "IndexedDB", operation: "delete", store: STORE_NAME, keyCategory: String(key), outcome: "failed", error: request.error }); resolve(); };
  });
  db.close();
}

export async function hydrateSnapshot() {
  const local = loadLocalSnapshot();
  const indexed = decodeSnapshot(await readDatabaseKey(SNAPSHOT_KEY));
  if (!indexed) return local;
  if (!local) return indexed;
  return Number(indexed.savedAt || 0) >= Number(local.savedAt || 0) ? indexed : local;
}

export async function persistSnapshot(snapshot, { broadcast = true } = {}) {
  const encoded = encodeSnapshot(snapshot);
  try {
    window.localStorage?.setItem(LOCAL_KEY, encoded);
  } catch (error) {
    recordStorageFailure({ subsystem: "localStorage", operation: "write", keyCategory: LOCAL_KEY, outcome: "indexeddb-fallback", error });
    console.warn("Local snapshot storage failed", error);
  }
  await writeDatabaseKey(SNAPSHOT_KEY, encoded);

  if (broadcast && typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(snapshot);
    channel.close();
  }
}

export async function inspectPublicCache() {
  const local = loadLocalSnapshot();
  const indexed = decodeSnapshot(await readDatabaseKey(SNAPSHOT_KEY));
  return describeSnapshotCache(local, indexed);
}

export async function clearPublicCache() {
  try { window.localStorage?.removeItem(LOCAL_KEY); } catch (error) { recordStorageFailure({ subsystem: "localStorage", operation: "delete", keyCategory: LOCAL_KEY, outcome: "indexeddb-fallback", error }); }
  await deleteDatabaseKey(SNAPSHOT_KEY);
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: "cache-cleared", version: SNAPSHOT_VERSION });
    channel.close();
  }
}

export async function loadErrorLog() {
  let local = [];
  try {
    local = normalizeStoredErrors(JSON.parse(window.localStorage?.getItem(ERROR_LOCAL_KEY) || "[]"));
  } catch {
    local = [];
  }
  let indexed = [];
  try {
    indexed = normalizeStoredErrors(JSON.parse(await readDatabaseKey(ERROR_KEY) || "[]"));
  } catch {
    indexed = [];
  }
  const byId = new Map([...indexed, ...local].map((entry) => [entry.id, entry]));
  return [...byId.values()].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, 1000);
}

export async function persistErrorLog(entries) {
  const normalized = normalizeStoredErrors(entries);
  const encoded = JSON.stringify(normalized);
  try { window.localStorage?.setItem(ERROR_LOCAL_KEY, encoded); } catch (error) { recordStorageFailure({ subsystem: "localStorage", operation: "write", keyCategory: ERROR_LOCAL_KEY, outcome: "indexeddb-fallback", error }); }
  await writeDatabaseKey(ERROR_KEY, encoded);
}

export function subscribeSnapshots(listener) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const snapshot = event.data;
    if (snapshot?.version === SNAPSHOT_VERSION && snapshot.lockers) listener(snapshot);
  };
  return () => channel.close();
}

export { SNAPSHOT_VERSION };
