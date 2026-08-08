function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function calculateUserPosition({ stakingBalance = 0, vaultUnderlying = 0, vaultShares = 0, assetPriceUsd = null } = {}) {
  const price = finite(assetPriceUsd);
  const staking = finite(stakingBalance) ?? 0;
  const underlying = finite(vaultUnderlying) ?? 0;
  const shares = finite(vaultShares) ?? 0;
  return {
    stakingValueUsd: price === null ? null : staking * price,
    vaultValueUsd: price === null ? null : underlying * price,
    totalValueUsd: price === null ? null : (staking + underlying) * price,
    vaultShares: shares,
    vaultUnderlying: underlying,
  };
}

export function projectPositionIncome(positionUsd, apyBps) {
  const principal = finite(positionUsd);
  const bps = finite(apyBps);
  if (principal === null || bps === null || principal < 0 || bps < 0) return { dailyUsd: null, weeklyUsd: null };
  const annualFactor = 1 + bps / 10_000;
  const dailyRate = annualFactor ** (1 / 365) - 1;
  const weeklyRate = annualFactor ** (7 / 365) - 1;
  return { dailyUsd: principal * dailyRate, weeklyUsd: principal * weeklyRate };
}
