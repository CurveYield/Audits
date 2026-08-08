const DEFAULT_ENDPOINTS = [
  "https://api.stakedao.org/api/lockers/",
  "https://raw.githubusercontent.com/stake-dao/api/main/api/lockers/index.json",
];

const DEFAULT_ASSET_BASE_URL = "https://raw.githubusercontent.com/stake-dao/assets/main";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAddress(value) {
  return String(value || "").toLowerCase();
}

function resolveAssetUrl(uri, baseUrl = DEFAULT_ASSET_BASE_URL) {
  if (!uri) return null;
  const value = String(uri);
  if (/^https?:\/\//i.test(value)) return value;
  return `${String(baseUrl).replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}

function assertPayload(payload) {
  if (!payload || !Array.isArray(payload.parsed)) {
    throw new Error("StakeDAO locker API returned a malformed payload");
  }
  return payload;
}

export function findStakeDaoLocker(payload, { sdTokenAddress, lockerId } = {}) {
  const lockers = Array.isArray(payload?.parsed) ? payload.parsed : [];
  const wantedAddress = normalizeAddress(sdTokenAddress);
  if (wantedAddress) {
    const byAddress = lockers.find((locker) => normalizeAddress(locker?.sdToken?.address) === wantedAddress);
    if (byAddress) return byAddress;
  }
  const wantedId = String(lockerId || "").toLowerCase();
  if (!wantedId) return null;
  return lockers.find((locker) => String(locker?.id || "").toLowerCase() === wantedId) || null;
}

export function parseStakeDaoAprRange(locker) {
  const values = locker?.apr;
  if (!Array.isArray(values) || values.length < 2) {
    throw new Error("StakeDAO locker APR range is missing or malformed");
  }
  const minimum = finiteNumber(values[0]);
  const maximum = finiteNumber(values[1]);
  if (minimum === null || maximum === null || minimum < 0 || maximum < minimum) {
    throw new Error("StakeDAO locker APR range is missing or malformed");
  }
  return {
    minAprBps: minimum * 100,
    maxAprBps: maximum * 100,
  };
}

export function parseStakeDaoRewards(locker, { assetBaseUrl = DEFAULT_ASSET_BASE_URL, includeAddresses = [] } = {}) {
  const rewards = Array.isArray(locker?.rewards) ? locker.rewards : [];
  const selfTokenAddress = normalizeAddress(locker?.sdToken?.address);
  const includedAddresses = new Set(includeAddresses.map(normalizeAddress).filter(Boolean));
  return rewards.flatMap((reward) => {
    const token = reward?.token;
    const address = normalizeAddress(token?.address);
    const aprPercent = finiteNumber(reward?.apr);
    if (!token || !address || aprPercent === null || aprPercent < 0) return [];
    const isSelfToken = Boolean(selfTokenAddress) && address === selfTokenAddress;
    const isExplicitlyIncluded = includedAddresses.has(address);
    if (isSelfToken && !isExplicitlyIncluded) return [];
    if (aprPercent === 0 && !reward?.streaming && !isExplicitlyIncluded) return [];
    return [{
      address,
      symbol: String(token.symbol || "TOKEN"),
      decimals: Number(token.decimals ?? 18),
      icon: resolveAssetUrl(token.logoURI, assetBaseUrl),
      priceUsd: finiteNumber(reward.price),
      aprBps: aprPercent * 100,
      streaming: Boolean(reward.streaming),
      periodFinish: finiteNumber(reward.periodFinish),
    }];
  });
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createStakeDaoLockerClient({
  fetchImpl = globalThis.fetch,
  endpoints = DEFAULT_ENDPOINTS,
  timeoutMs = 10_000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("StakeDAO locker API requires fetch");
  let inFlight = null;

  async function fetchPayload() {
    const failures = [];
    for (const endpoint of endpoints) {
      try {
        const response = await withTimeout(fetchImpl(endpoint, { headers: { accept: "application/json" } }), timeoutMs, "StakeDAO locker API");
        if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "error"}`);
        return assertPayload(await withTimeout(response.json(), timeoutMs, "StakeDAO locker API JSON"));
      } catch (error) {
        failures.push(`${endpoint}: ${error.message}`);
      }
    }
    throw new Error(`StakeDAO locker API failed (${failures.join("; ")})`);
  }

  function getPayload() {
    if (!inFlight) {
      inFlight = fetchPayload().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  async function getLockerRange(match) {
    const payload = await getPayload();
    const locker = findStakeDaoLocker(payload, match);
    if (!locker) throw new Error(`StakeDAO locker API has no matching locker for ${match?.lockerId || match?.sdTokenAddress || "unknown"}`);
    return {
      ...parseStakeDaoAprRange(locker),
      rewards: parseStakeDaoRewards(locker, { includeAddresses: match?.rewardTokenAddresses || [] }),
      lastUpdate: finiteNumber(payload.lastUpdate),
      lockerId: locker.id,
      tokenPriceUsd: finiteNumber(locker.tokenPriceInUsd),
      sdTokenPriceUsd: finiteNumber(locker.sdTokenPriceInUsd),
    };
  }

  return { getPayload, getLockerRange };
}
