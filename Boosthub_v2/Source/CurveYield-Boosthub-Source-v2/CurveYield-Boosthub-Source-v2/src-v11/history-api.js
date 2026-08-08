export const YIELD_HISTORY_API_BASE = 'https://boosthub-data.curveyield.online';
const VALID_RANGES = new Set(['7d', '30d', '90d', '1y', 'all']);

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeIndexerHistoryPayload(payload, lockerId) {
  if (!payload || String(payload.lockerId || '').toLowerCase() !== String(lockerId || '').toLowerCase() || !Array.isArray(payload.points)) return [];
  return payload.points.flatMap((point) => {
    const observedAt = Number(point?.observedAt);
    const defaultAprBps = finiteOrNull(point?.stakedaoDefaultAprBps);
    const vaultApyBps = finiteOrNull(point?.boosthubVaultApyBps);
    if (!Number.isFinite(observedAt) || observedAt <= 0 || (defaultAprBps === null && vaultApyBps === null)) return [];
    return [{
      id: `remote:${lockerId}:${observedAt}`,
      lockerId: String(lockerId),
      observedAt,
      defaultAprBps,
      boostHubAprBps: null,
      vaultApyBps,
      source: 'cloudflare-d1',
      stakeDaoSource: String(point?.stakedaoSource || ''),
      vaultApySource: String(point?.vaultApySource || ''),
      blockNumber: point?.blockNumber === null || point?.blockNumber === undefined ? null : Number(point.blockNumber),
      status: 'indexed',
      synthetic: false,
    }];
  }).sort((a, b) => a.observedAt - b.observedAt);
}

export function chooseHistorySource(remoteRows = [], localRows = []) {
  const remote = Array.isArray(remoteRows) ? remoteRows.filter((row) => row?.synthetic !== true) : [];
  if (remote.length >= 2) return remote;
  return Array.isArray(localRows) ? localRows.filter((row) => row?.synthetic !== true) : [];
}

export async function fetchIndexerHistory(lockerId, range = '7d', { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchImpl !== 'function') return [];
  const selectedRange = VALID_RANGES.has(String(range).toLowerCase()) ? String(range).toLowerCase() : '7d';
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(`${YIELD_HISTORY_API_BASE}/history/${encodeURIComponent(String(lockerId).toLowerCase())}?range=${selectedRange}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response?.ok) throw new Error(`Yield history API HTTP ${response?.status ?? 'error'}`);
    return normalizeIndexerHistoryPayload(await response.json(), lockerId);
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
