export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
export const TOKENLESS_PRODUCTION = 0.4;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function calculateAprFromBoostRange({ minAprBps, maxAprBps, boostMultiplier }) {
  const minimum = finiteNumber(minAprBps);
  const maximum = finiteNumber(maxAprBps);
  const multiplier = finiteNumber(boostMultiplier);
  if (minimum === null || maximum === null || multiplier === null || minimum < 0 || maximum < minimum) return null;
  const clampedMultiplier = Math.min(2.5, Math.max(1, multiplier));
  const progress = (clampedMultiplier - 1) / 1.5;
  return minimum + ((maximum - minimum) * progress);
}

export function calculateBoostMultiplier({ depositedBalance, workingBalance, tokenlessProduction = TOKENLESS_PRODUCTION }) {
  const deposited = finiteNumber(depositedBalance);
  const working = finiteNumber(workingBalance);
  if (deposited === null || working === null || deposited <= 0 || tokenlessProduction <= 0) return null;
  const multiplier = working / (deposited * tokenlessProduction);
  return Math.min(2.5, Math.max(1, multiplier));
}


export function calculateYieldBoostingFactor({ gaugeBalance, accountedPrincipal }) {
  const gauge = finiteNumber(gaugeBalance);
  const principal = finiteNumber(accountedPrincipal);
  if (gauge === null || principal === null || gauge <= 0 || principal <= 0) return null;
  return Math.max(1, gauge / principal);
}

export function calculateEffectiveBoostHubYield({
  minAprBps,
  maxAprBps,
  voteBoostMultiplier = 1,
  gaugeBalance,
  accountedPrincipal,
}) {
  const defaultAprBps = finiteNumber(minAprBps);
  const voteBoost = finiteNumber(voteBoostMultiplier);
  const yieldBoostingFactor = calculateYieldBoostingFactor({ gaugeBalance, accountedPrincipal });
  if (defaultAprBps === null || defaultAprBps < 0 || voteBoost === null || yieldBoostingFactor === null) {
    return { defaultAprBps, stakeDaoBoostedAprBps: null, yieldBoostingFactor, boostHubAprBps: null, boostMultiplier: null, vaultApyBps: null };
  }
  const stakeDaoBoostedAprBps = calculateAprFromBoostRange({
    minAprBps: defaultAprBps,
    maxAprBps: maxAprBps ?? defaultAprBps,
    boostMultiplier: voteBoost,
  });
  const boostHubAprBps = stakeDaoBoostedAprBps === null ? null : stakeDaoBoostedAprBps * yieldBoostingFactor;
  const boostMultiplier = defaultAprBps > 0 && boostHubAprBps !== null
    ? boostHubAprBps / defaultAprBps
    : voteBoost * yieldBoostingFactor;
  return {
    defaultAprBps,
    stakeDaoBoostedAprBps,
    yieldBoostingFactor,
    boostHubAprBps,
    boostMultiplier,
    vaultApyBps: aprBpsToApyBps(boostHubAprBps),
  };
}

export function calculateRewardAprBps({
  rateTokensPerSecond,
  periodFinish,
  now,
  rewardPriceUsd,
  earningBalance,
  denominatorSupply,
  depositedBalance,
  depositedPriceUsd,
}) {
  const rate = finiteNumber(rateTokensPerSecond);
  const finish = finiteNumber(periodFinish);
  const timestamp = finiteNumber(now);
  const rewardPrice = finiteNumber(rewardPriceUsd);
  const earnedBalance = finiteNumber(earningBalance);
  const supply = finiteNumber(denominatorSupply);
  const deposit = finiteNumber(depositedBalance);
  const depositPrice = finiteNumber(depositedPriceUsd);

  if ([rate, finish, timestamp, rewardPrice, earnedBalance, supply, deposit, depositPrice].some((value) => value === null)) {
    return null;
  }
  if (finish <= timestamp || rate <= 0) return 0;
  if (rewardPrice <= 0 || supply <= 0 || deposit <= 0 || depositPrice <= 0 || earnedBalance < 0) return null;

  const annualRewardUsd = rate * SECONDS_PER_YEAR * (earnedBalance / supply) * rewardPrice;
  const depositedUsd = deposit * depositPrice;
  const aprBps = (annualRewardUsd / depositedUsd) * 10_000;
  return Math.round(aprBps * 1e9) / 1e9;
}

export function calculateGaugeRewardAprPair({
  rateTokensPerSecond,
  periodFinish,
  now,
  rewardPriceUsd,
  depositedBalance,
  depositedPriceUsd,
  totalSupply,
  workingSupply,
  workingBalance,
  boostedReward,
}) {
  const common = {
    rateTokensPerSecond,
    periodFinish,
    now,
    rewardPriceUsd,
    depositedBalance,
    depositedPriceUsd,
  };

  if (!boostedReward) {
    const aprBps = calculateRewardAprBps({
      ...common,
      earningBalance: depositedBalance,
      denominatorSupply: totalSupply,
    });
    return { defaultAprBps: aprBps, boostHubAprBps: aprBps };
  }

  return {
    defaultAprBps: calculateRewardAprBps({
      ...common,
      earningBalance: Number(depositedBalance) * TOKENLESS_PRODUCTION,
      denominatorSupply: workingSupply,
    }),
    boostHubAprBps: calculateRewardAprBps({
      ...common,
      earningBalance: workingBalance,
      denominatorSupply: workingSupply,
    }),
  };
}

export function sumAvailableAprBps(values) {
  const available = values.map(finiteNumber).filter((value) => value !== null);
  if (!available.length) return null;
  return available.reduce((sum, value) => sum + value, 0);
}

export function aprBpsToApyBps(aprBps, compoundsPerYear = 365) {
  const bps = finiteNumber(aprBps);
  if (bps === null) return null;
  if (bps <= 0) return 0;
  const apr = bps / 10_000;
  return (Math.pow(1 + apr / compoundsPerYear, compoundsPerYear) - 1) * 10_000;
}

export function apyBpsToAprBps(apyBps, compoundsPerYear = 365) {
  const bps = finiteNumber(apyBps);
  const periods = finiteNumber(compoundsPerYear);
  if (bps === null || periods === null || periods <= 0) return null;
  if (bps <= 0) return 0;
  const apy = bps / 10_000;
  return periods * (Math.pow(1 + apy, 1 / periods) - 1) * 10_000;
}

export function normalizeLockerYield(lockerId, values) {
  const defaultAprBps = finiteNumber(values.defaultAprBps);
  let boostHubAprBps = finiteNumber(values.boostHubAprBps);
  let boostMultiplier = finiteNumber(values.boostMultiplier);

  return {
    defaultAprBps,
    boostHubAprBps,
    boostMultiplier,
    vaultApyBps: aprBpsToApyBps(boostHubAprBps),
  };
}
