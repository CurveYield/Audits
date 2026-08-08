const DEFAULT_BASE_APY_ENDPOINT = "https://api.curve.finance/v1/getBaseApys/ethereum";
const DEFAULT_POOLS_ENDPOINT = "https://api.curve.finance/v1/getPools/ethereum/factory-stable-ng";

function normalizeAddress(value) {
  return String(value || "").toLowerCase();
}

function nonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function baseApyRows(payload) {
  const rows = payload?.data?.baseApys ?? payload?.baseApys;
  if (!Array.isArray(rows)) throw new Error("Curve APY API returned a malformed payload");
  return rows;
}

function poolRows(payload) {
  const rows = payload?.data?.poolData ?? payload?.poolData;
  if (!Array.isArray(rows)) throw new Error("Curve pools API returned a malformed payload");
  return rows;
}

export function normalizeCurvePoolApy(payload, poolAddress) {
  const wanted = normalizeAddress(poolAddress);
  const pool = baseApyRows(payload).find((entry) => normalizeAddress(entry?.address) === wanted);
  if (!pool) throw new Error(`Curve APY API has no matching pool for ${poolAddress || "unknown"}`);

  const dailyApyPcent = nonNegativeNumber(pool.latestDailyApyPcent);
  const weeklyApyPcent = nonNegativeNumber(pool.latestWeeklyApyPcent);
  if (weeklyApyPcent === null) throw new Error("Curve APY API returned no valid weekly APY");

  return {
    weeklyApyBps: weeklyApyPcent * 100,
    dailyApyPcent,
    weeklyApyPcent,
  };
}

export function normalizeCurvePoolCrvApr(payload, poolAddress) {
  const wanted = normalizeAddress(poolAddress);
  const pool = poolRows(payload).find((entry) => normalizeAddress(entry?.address) === wanted);
  if (!pool) throw new Error(`Curve pools API has no matching pool for ${poolAddress || "unknown"}`);

  const crvAprRangePcent = Array.isArray(pool.gaugeCrvApy)
    ? pool.gaugeCrvApy.map(nonNegativeNumber).filter((value) => value !== null)
    : [];
  if (!crvAprRangePcent.length) throw new Error("Curve pools API returned no valid CRV APR range");

  const maxCrvAprPcent = Math.max(...crvAprRangePcent);
  return {
    maxCrvAprBps: maxCrvAprPcent * 100,
    crvAprRangePcent,
    maxCrvAprPcent,
  };
}

export function normalizeCurvePoolYield(baseApyPayload, poolsPayload, poolAddress) {
  const base = normalizeCurvePoolApy(baseApyPayload, poolAddress);
  const crv = normalizeCurvePoolCrvApr(poolsPayload, poolAddress);
  return {
    maxApyBps: base.weeklyApyBps + crv.maxCrvAprBps,
    weeklyBaseApyBps: base.weeklyApyBps,
    maxCrvAprBps: crv.maxCrvAprBps,
    dailyApyPcent: base.dailyApyPcent,
    weeklyApyPcent: base.weeklyApyPcent,
    crvAprRangePcent: crv.crvAprRangePcent,
    maxCrvAprPcent: crv.maxCrvAprPcent,
  };
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

export function createCurveApyClient({
  fetchImpl = globalThis.fetch,
  baseApyEndpoint = DEFAULT_BASE_APY_ENDPOINT,
  poolsEndpoint = DEFAULT_POOLS_ENDPOINT,
  timeoutMs = 10_000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Curve APY API requires fetch");
  let baseInFlight = null;
  let poolsInFlight = null;

  async function fetchPayload(endpoint, label, validator) {
    const response = await withTimeout(fetchImpl(endpoint, { headers: { accept: "application/json" } }), timeoutMs, label);
    if (!response?.ok) throw new Error(`${label} failed with HTTP ${response?.status ?? "error"}`);
    const payload = await withTimeout(response.json(), timeoutMs, `${label} JSON`);
    validator(payload);
    return payload;
  }

  function getBasePayload() {
    if (!baseInFlight) {
      baseInFlight = fetchPayload(baseApyEndpoint, "Curve APY API", baseApyRows).finally(() => {
        baseInFlight = null;
      });
    }
    return baseInFlight;
  }

  function getPoolsPayload() {
    if (!poolsInFlight) {
      poolsInFlight = fetchPayload(poolsEndpoint, "Curve pools API", poolRows).finally(() => {
        poolsInFlight = null;
      });
    }
    return poolsInFlight;
  }

  async function getPoolMaxApy(poolAddress) {
    const [basePayload, poolsPayload] = await Promise.all([getBasePayload(), getPoolsPayload()]);
    return normalizeCurvePoolYield(basePayload, poolsPayload, poolAddress);
  }

  return { getBasePayload, getPoolsPayload, getPoolMaxApy };
}
