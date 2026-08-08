import { BOOSTHUB_ABI, ERC20_ABI, STAKEDAO_GAUGE_ABI, STAKEDAO_CLAIM_EXECUTOR_ABI, STAKING_ABI, VAULT_ABI, STRATEGY_ABI } from "./abi.js";
import { fetchCurrentPrices, makePriceKey } from "./prices.js";
import { createStakeDaoLockerClient } from "./stakedao-lockers.js";
import { createCurveApyClient } from "./curve-apys.js";
import { createRpcHealth } from "./rpc-health.js";
import { vaultAddressFor } from "./contract-targets.js";
import {
  calculateBoostMultiplier,
  calculateAprFromBoostRange,
  normalizeLockerYield,
  aprBpsToApyBps,
  apyBpsToAprBps,
  sumAvailableAprBps,
  calculateEffectiveBoostHubYield,
} from "./yield-math.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_REWARDS = 8;
const RPC_TIMEOUT_MS = 8_000;

export function buildPriceKey(priceChain, address) {
  return makePriceKey(priceChain, address);
}

export function normalizeRewardMetadata({ symbol, decimals, address }) {
  return { symbol: String(symbol || "TOKEN"), decimals: Number(decimals ?? 18), address: String(address).toLowerCase() };
}

export function selectRpcUrls(chain) {
  return [...new Set((chain?.rpcUrls || []).filter(Boolean))];
}

export function createChainRpcSessions(chains) {
  return new Map(Object.entries(chains || {}).map(([chainKey, chain]) => [chainKey, createRpcHealth(selectRpcUrls(chain), 4)]));
}

export async function settleNamedReads(reads = {}) {
  const entries = Object.entries(reads);
  const settled = await Promise.allSettled(entries.map(([, promise]) => Promise.resolve(promise)));
  const values = {};
  const errors = {};
  settled.forEach((result, index) => {
    const key = entries[index][0];
    if (result.status === "fulfilled") values[key] = result.value;
    else errors[key] = String(result.reason?.shortMessage || result.reason?.reason || result.reason?.message || result.reason || "Read failed");
  });
  return { values, errors };
}

function sameAddress(a, b) {
  return Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
}

function tupleValue(tuple, name, index) {
  return tuple?.[name] ?? tuple?.[index];
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { code: "TIMEOUT" })), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function configuredToken(tokens, chainKey, address) {
  return Object.values(tokens).find((item) => item.chain === chainKey && sameAddress(item.address, address)) || null;
}

function stablePrice(meta, configured) {
  return configured?.stable || /^(crvusd|3crv|usdc|usdt|frax|wfrax|dai)$/i.test(meta.symbol) ? 1 : null;
}

function isTransportFailure(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.shortMessage || error?.message || error || "").toLowerCase();
  if (["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT", "OFFCHAIN_FAULT", "BAD_DATA"].includes(code)) return true;
  return /timeout|timed out|network|failed to fetch|connection|socket|gateway|429|rate limit|missing response|could not coalesce|dns|cors/.test(message);
}

function errorText(error) {
  return String(error?.shortMessage || error?.reason || error?.message || error || "Read failed");
}

export function mergeRewardAddresses({ configured = [], api = [], discovered = [] } = {}) {
  const unique = (values) => [...new Set(values.map((address) => String(address || "").toLowerCase()).filter(Boolean))];
  const overview = unique([...configured, ...api]);
  const claim = unique([...overview, ...discovered]);
  return { overview, claim };
}


export function resolveConfiguredTopology(locker) {
  if (!locker?.boostHubAddress || !locker?.gaugeAddress || !locker?.lpAddress || locker?.pid === null || locker?.pid === undefined) return null;
  return {
    boostHubAddress: locker.boostHubAddress,
    pid: Number(locker.pid),
    lpAddress: locker.lpAddress,
    gaugeAddress: locker.gaugeAddress,
  };
}

export function resolveGaugeBoostMultiplier({ depositedBalance, workingBalance }) {
  if (workingBalance === null || workingBalance === undefined) return null;
  return calculateBoostMultiplier({ depositedBalance, workingBalance });
}

export function resolveStakeDaoYield(lockerId, range, boostMultiplier) {
  const defaultAprBps = range?.minAprBps ?? null;
  const boostHubAprBps = calculateAprFromBoostRange({
    minAprBps: range?.minAprBps,
    maxAprBps: range?.maxAprBps,
    boostMultiplier,
  });
  return normalizeLockerYield(lockerId, { defaultAprBps, boostHubAprBps, boostMultiplier });
}

export function calculateTokenPricedAprBps({ tokenAprBps, rewardPriceUsd, depositPriceUsd } = {}) {
  if (tokenAprBps === null || tokenAprBps === undefined || rewardPriceUsd === null || rewardPriceUsd === undefined || depositPriceUsd === null || depositPriceUsd === undefined) return null;
  const apr = Number(tokenAprBps);
  const rewardPrice = Number(rewardPriceUsd);
  const depositPrice = Number(depositPriceUsd);
  if (!Number.isFinite(apr) || !Number.isFinite(rewardPrice) || !Number.isFinite(depositPrice) || apr < 0 || rewardPrice < 0 || depositPrice <= 0) return null;
  return apr * rewardPrice / depositPrice;
}

export function resolveXChainReceiptYield({ receiptRewardAprBps = [], fallbackRewardAprBps = [], strategyAprBps = null, stakeDaoDefaultAprBps = null } = {}) {
  const length = Math.max(receiptRewardAprBps.length, fallbackRewardAprBps.length);
  const mergedRewardAprBps = Array.from({ length }, (_, index) => {
    const primary = receiptRewardAprBps[index];
    return primary === null || primary === undefined ? fallbackRewardAprBps[index] ?? null : primary;
  });
  const boostHubAprBps = sumAvailableAprBps(mergedRewardAprBps);
  const harvestedStrategyApr = Number(strategyAprBps);
  const vaultAprBps = Number.isFinite(harvestedStrategyApr) && harvestedStrategyApr > 0 ? harvestedStrategyApr : boostHubAprBps;
  const hasStakeDaoDefault = stakeDaoDefaultAprBps !== null && stakeDaoDefaultAprBps !== undefined && stakeDaoDefaultAprBps !== "";
  const stakeDaoDefault = hasStakeDaoDefault ? Number(stakeDaoDefaultAprBps) : null;
  return {
    defaultAprBps: Number.isFinite(stakeDaoDefault) && stakeDaoDefault >= 0 ? stakeDaoDefault : boostHubAprBps,
    boostHubAprBps,
    boostMultiplier: 1,
    boostModel: "xchain-uniform",
    vaultAprBps,
    vaultApyBps: aprBpsToApyBps(vaultAprBps),
  };
}

export function resolveVaultPps({ reportedPps = null, totalSupply = 0n, totalAssets = 0n, decimals = 18 } = {}) {
  if (reportedPps !== null && reportedPps !== undefined) return BigInt(reportedPps);
  const scale = 10n ** BigInt(Number(decimals));
  const supply = BigInt(totalSupply ?? 0n);
  if (supply === 0n) return scale;
  return BigInt(totalAssets ?? 0n) * scale / supply;
}

export function applyCurveVaultYield(locker, live, curveApy) {
  if (locker?.yieldSource !== "curve-weekly-apy-plus-max-crv") return live;
  const rawMaximum = curveApy?.maxApyBps;
  const maximum = rawMaximum === null || rawMaximum === undefined || rawMaximum === "" ? null : Number(rawMaximum);
  if (maximum === null || !Number.isFinite(maximum) || maximum < 0) {
    throw new Error("Curve APY API returned no valid maximum APY");
  }
  const yieldBoostingFactor = Number(live?.yieldBoostingFactor);
  const factor = Number.isFinite(yieldBoostingFactor) && yieldBoostingFactor > 0 ? yieldBoostingFactor : 1;
  const curveAprBps = apyBpsToAprBps(maximum);
  if (curveAprBps === null) throw new Error("Curve APY could not be normalized to APR");
  const boostedCurveAprBps = curveAprBps * factor;
  const boostedCurveApyBps = aprBpsToApyBps(boostedCurveAprBps);
  return {
    ...live,
    vaultAprBps: boostedCurveAprBps,
    vaultApyBps: boostedCurveApyBps,
    curveApySource: {
      type: "curve-weekly-apy-plus-max-crv",
      poolAddress: locker.curvePoolAddress,
      dailyApyPcent: curveApy.dailyApyPcent ?? null,
      weeklyApyPcent: curveApy.weeklyApyPcent ?? null,
      weeklyBaseApyPcent: Number(curveApy.weeklyBaseApyBps) / 100,
      crvAprRangePcent: curveApy.crvAprRangePcent ?? [],
      maxCrvAprPcent: curveApy.maxCrvAprPcent ?? null,
      baseSelectedApyPcent: maximum / 100,
      selectedApyPcent: boostedCurveApyBps / 100,
      yieldBoostingFactor: factor,
    },
  };
}

export function createLiveDataClient({ ethers, chains, tokens, stakeDaoClient: providedStakeDaoClient = null, curveApyClient: providedCurveApyClient = null }) {
  const providerCache = new Map();
  const rpcSessions = createChainRpcSessions(chains);
  const stakeDaoClient = providedStakeDaoClient || createStakeDaoLockerClient();
  const curveApyClient = providedCurveApyClient || createCurveApyClient();

  function providerFor(chainKey, rpcUrl) {
    const cacheKey = `${chainKey}:${rpcUrl}`;
    if (!providerCache.has(cacheKey)) {
      const chain = chains[chainKey];
      const provider = new ethers.JsonRpcProvider(rpcUrl, chain.chainId, { staticNetwork: true });
      Object.defineProperty(provider, "__curveYieldRpcUrl", { value: rpcUrl, configurable: true });
      providerCache.set(cacheKey, provider);
    }
    return providerCache.get(cacheKey);
  }

  function retireProvider(chainKey, rpcUrl) {
    const cacheKey = `${chainKey}:${rpcUrl}`;
    providerCache.get(cacheKey)?.destroy?.();
    providerCache.delete(cacheKey);
  }

  async function withProvider(chainKey, operation, label = "RPC read") {
    const chain = chains[chainKey];
    const health = rpcSessions.get(chainKey);
    if (!chain || !health) throw new Error(`Unknown chain ${chainKey}`);
    const order = health.order();
    let lastError;
    for (const rpcUrl of order) {
      const provider = providerFor(chainKey, rpcUrl);
      try {
        const startedAt = performance.now();
        const value = await withTimeout(operation(provider), RPC_TIMEOUT_MS, `${chain.name} ${label}`);
        health.recordSuccess(rpcUrl, performance.now() - startedAt);
        return value;
      } catch (error) {
        lastError = error;
        if (!isTransportFailure(error)) throw error;
        const record = health.recordFailure(rpcUrl, error);
        if (record?.retired) retireProvider(chainKey, rpcUrl);
      }
    }
    throw lastError || new Error(`No working RPC configured for ${chain.name}`);
  }

  async function getProvider(chainKey, { reset = false } = {}) {
    if (reset) {
      rpcSessions.get(chainKey)?.reset();
      for (const key of [...providerCache.keys()]) {
        if (key.startsWith(`${chainKey}:`)) {
          providerCache.get(key)?.destroy?.();
          providerCache.delete(key);
        }
      }
    }
    return withProvider(chainKey, async (provider) => {
      await provider.getBlockNumber();
      return provider;
    }, "health check");
  }

  function contract(address, abi, providerOrSigner) {
    return new ethers.Contract(address, abi, providerOrSigner);
  }

  async function readTokenMetadata(chainKey, address) {
    const configured = configuredToken(tokens, chainKey, address);
    const metadata = await settleNamedReads({
      symbol: withProvider(chainKey, (provider) => contract(address, ERC20_ABI, provider).symbol(), "token symbol"),
      decimals: withProvider(chainKey, (provider) => contract(address, ERC20_ABI, provider).decimals(), "token decimals"),
    });
    return normalizeRewardMetadata({
      address,
      symbol: metadata.values.symbol ?? configured?.symbol,
      decimals: metadata.values.decimals ?? configured?.decimals,
    });
  }

  async function readRewardAddresses(chainKey, stakingAddress) {
    const addresses = [];
    for (let index = 0; index < MAX_REWARDS; index += 1) {
      try {
        const address = await withProvider(chainKey, (provider) => contract(stakingAddress, STAKING_ABI, provider).reward_tokens(index), `reward token ${index}`);
        if (!address || sameAddress(address, ZERO_ADDRESS)) break;
        addresses.push(address);
      } catch {
        break;
      }
    }
    return [...new Set(addresses.map((address) => address.toLowerCase()))];
  }

  async function readTopology(locker) {
    return withProvider(locker.chain, async (provider) => {
      const staking = contract(locker.stakingAddress, STAKING_ABI, provider);
      const [boostHubAddress, pidValue, lpAddress] = await Promise.all([staking.boost_hub(), staking.pid(), staking.lp_token()]);
      const pid = Number(pidValue);
      const pool = await contract(boostHubAddress, BOOSTHUB_ABI, provider).poolInfo(pid);
      const gaugeAddress = tupleValue(pool, "gauge", 1);
      const poolTotalStakedRaw = tupleValue(pool, "totalStaked", 3);
      if (!gaugeAddress || sameAddress(gaugeAddress, ZERO_ADDRESS)) throw new Error(`No gauge returned for ${locker.id}`);
      return { boostHubAddress, pid, lpAddress, gaugeAddress, poolTotalStakedRaw };
    }, `${locker.id} topology`);
  }

  async function readGaugeWorkingBalance(locker, gaugeAddress, account) {
    if (locker?.gaugeModel === "xchain-uniform") return null;
    try {
      return await withProvider(locker.chain, (provider) => contract(gaugeAddress, STAKEDAO_GAUGE_ABI, provider).working_balances(account), `${locker.id} working balance`);
    } catch (error) {
      if (!isTransportFailure(error)) return null;
      throw error;
    }
  }

  async function readLocker(locker, { account = null } = {}) {
    const fieldErrors = {};
    const external = await settleNamedReads({
      stakeDaoRange: stakeDaoClient.getLockerRange({
        sdTokenAddress: tokens[locker.token]?.address,
        lockerId: locker.stakeDaoId || locker.id.replace(/^sd/i, ""),
        rewardTokenAddresses: locker.rewardTokens.map((key) => tokens[key]?.address?.toLowerCase()).filter(Boolean),
      }),
      ...(locker.yieldSource === "curve-weekly-apy-plus-max-crv" ? { curveApy: curveApyClient.getPoolMaxApy(locker.curvePoolAddress) } : {}),
    });
    Object.assign(fieldErrors, external.errors);

    const configuredTopology = resolveConfiguredTopology(locker);
    let topology = configuredTopology;
    try {
      const discoveredTopology = await readTopology(locker);
      topology = { ...(configuredTopology || {}), ...discoveredTopology };
    } catch (error) {
      fieldErrors.topology = errorText(error);
      if (!topology) {
        const stakeDaoRange = external.values.stakeDaoRange || null;
        const yieldData = stakeDaoRange ? resolveStakeDaoYield(locker.id, stakeDaoRange, null) : {};
        return { ...yieldData, status: "partial", updatedAt: Date.now(), fieldErrors, account };
      }
    }

    const { boostHubAddress, pid, lpAddress, gaugeAddress } = topology;
    const reads = await settleNamedReads({
      depositedRaw: withProvider(locker.chain, (provider) => contract(gaugeAddress, STAKEDAO_GAUGE_ABI, provider).balanceOf(boostHubAddress), `${locker.id} deposited balance`).catch(() => topology.poolTotalStakedRaw ?? null),
      workingRaw: readGaugeWorkingBalance(locker, gaugeAddress, boostHubAddress),
      reportedPpsRaw: withProvider(locker.chain, (provider) => contract(vaultAddressFor(locker), VAULT_ABI, provider).getPricePerFullShare(), `${locker.id} PPS`).catch(() => null),
      vaultBalanceRaw: withProvider(locker.chain, (provider) => contract(vaultAddressFor(locker), VAULT_ABI, provider).balance(), `${locker.id} vault balance`),
      vaultSupplyRaw: withProvider(locker.chain, (provider) => contract(vaultAddressFor(locker), VAULT_ABI, provider).totalSupply(), `${locker.id} vault supply`),
      vaultDecimalsRaw: withProvider(locker.chain, (provider) => contract(vaultAddressFor(locker), VAULT_ABI, provider).decimals(), `${locker.id} vault decimals`).catch(() => 18),
      stakingSupplyRaw: withProvider(locker.chain, (provider) => contract(locker.stakingAddress, STAKING_ABI, provider).totalSupply(), `${locker.id} staking supply`),
      strategyAddress: withProvider(locker.chain, (provider) => contract(vaultAddressFor(locker), VAULT_ABI, provider).strategy(), `${locker.id} strategy`).catch(() => locker.strategyAddress || null),
      strategyAprRaw: locker.gaugeModel === "xchain-uniform" && locker.strategyAddress ? withProvider(locker.chain, (provider) => contract(locker.strategyAddress, STRATEGY_ABI, provider).estimatedTokenAprBps(), `${locker.id} strategy APR`).catch(() => null) : Promise.resolve(null),
      strategyAprLastUpdateRaw: locker.gaugeModel === "xchain-uniform" && locker.strategyAddress ? withProvider(locker.chain, (provider) => contract(locker.strategyAddress, STRATEGY_ABI, provider).aprLastUpdate(), `${locker.id} strategy APR update`).catch(() => null) : Promise.resolve(null),
      boostingResult: withProvider(locker.chain, (provider) => contract(boostHubAddress, BOOSTHUB_ABI, provider).yieldBoostingTokens(pid), `${locker.id} boosting tokens`).catch(() => null),
      discoveredRewards: readRewardAddresses(locker.chain, locker.stakingAddress),
    });
    Object.assign(fieldErrors, reads.errors);

    const configuredRewardAddresses = locker.rewardTokens.map((key) => tokens[key]?.address?.toLowerCase()).filter(Boolean);
    const stakeDaoRange = external.values.stakeDaoRange || null;
    const apiRewardAddresses = stakeDaoRange?.rewards?.map((reward) => reward.address) || [];
    const rewardAddresses = mergeRewardAddresses({
      configured: configuredRewardAddresses,
      api: apiRewardAddresses,
      discovered: reads.values.discoveredRewards || [],
    });

    let depositedMeta;
    try {
      depositedMeta = await readTokenMetadata(locker.chain, lpAddress);
    } catch (error) {
      fieldErrors.depositMetadata = errorText(error);
      const configured = configuredToken(tokens, locker.chain, lpAddress);
      depositedMeta = normalizeRewardMetadata({ address: lpAddress, symbol: configured?.symbol || locker.token, decimals: configured?.decimals ?? 18 });
    }

    const metadataSettled = await settleNamedReads(Object.fromEntries(rewardAddresses.claim.map((address) => [address, readTokenMetadata(locker.chain, address)])));
    for (const [address, message] of Object.entries(metadataSettled.errors)) fieldErrors[`metadata:${address}`] = message;
    const rewardMetadataList = rewardAddresses.claim.map((address) => {
      if (metadataSettled.values[address]) return metadataSettled.values[address];
      const configured = configuredToken(tokens, locker.chain, address);
      const apiReward = (stakeDaoRange?.rewards || []).find((reward) => sameAddress(reward.address, address));
      return normalizeRewardMetadata({ address, symbol: configured?.symbol || apiReward?.symbol || "TOKEN", decimals: configured?.decimals ?? apiReward?.decimals ?? 18 });
    });
    const metadataByAddress = Object.fromEntries(rewardMetadataList.map((meta) => [meta.address, meta]));
    const chain = chains[locker.chain];
    const configuredLp = configuredToken(tokens, locker.chain, lpAddress);
    const priceRequests = [{ priceChain: chain.priceChain, address: lpAddress }];
    if (configuredLp?.priceFallbackAddress) priceRequests.push({ priceChain: chain.priceChain, address: configuredLp.priceFallbackAddress });
    rewardMetadataList.forEach((meta) => priceRequests.push({ priceChain: chain.priceChain, address: meta.address }));

    let prices = {};
    try {
      prices = await fetchCurrentPrices(priceRequests);
    } catch (error) {
      fieldErrors.prices = errorText(error);
    }

    function tokenPrice(meta) {
      if (sameAddress(meta.address, lpAddress) && configuredLp?.stable) return 1;
      const direct = prices[buildPriceKey(chain.priceChain, meta.address)];
      if (direct) return direct;
      const configured = configuredToken(tokens, locker.chain, meta.address);
      const fallbackAddress = configured?.priceFallbackAddress;
      const fallback = fallbackAddress ? prices[buildPriceKey(chain.priceChain, fallbackAddress)] : null;
      return fallback || stablePrice(meta, configured);
    }

    let lpPrice = tokenPrice(depositedMeta);
    if (!lpPrice && configuredLp?.priceFallbackAddress) lpPrice = prices[buildPriceKey(chain.priceChain, configuredLp.priceFallbackAddress)] || null;
    if (!lpPrice && stakeDaoRange?.sdTokenPriceUsd) lpPrice = stakeDaoRange.sdTokenPriceUsd;
    if (!lpPrice && stakeDaoRange?.tokenPriceUsd && sameAddress(tokens[locker.token]?.address, lpAddress)) lpPrice = stakeDaoRange.tokenPriceUsd;

    const apiRewardByAddress = Object.fromEntries((stakeDaoRange?.rewards || []).map((reward) => [reward.address, reward]));
    const receiptAprReads = locker.gaugeModel === "xchain-uniform"
      ? await settleNamedReads(Object.fromEntries(rewardAddresses.overview.map((address) => [address, withProvider(locker.chain, (provider) => contract(locker.stakingAddress, STAKING_ABI, provider).reward_token_apr_bps(address), `${locker.id} receipt APR ${address}`)])))
      : { values: {}, errors: {} };
    for (const [address, message] of Object.entries(receiptAprReads.errors)) fieldErrors[`receiptApr:${address}`] = message;

    const stakingRewards = rewardAddresses.claim.map((address) => {
      const meta = metadataByAddress[address];
      const configured = configuredToken(tokens, locker.chain, address);
      const apiReward = apiRewardByAddress[address] || null;
      const price = apiReward?.priceUsd ?? (sameAddress(address, lpAddress) ? lpPrice || 1 : tokenPrice(meta));
      const rawReceiptApr = receiptAprReads.values[address];
      const pricedReceiptApr = locker.gaugeModel === "xchain-uniform" && rawReceiptApr !== undefined
        ? calculateTokenPricedAprBps({ tokenAprBps: Number(rawReceiptApr), rewardPriceUsd: sameAddress(address, lpAddress) ? (lpPrice || price || 1) : price, depositPriceUsd: lpPrice || (sameAddress(address, lpAddress) ? price || 1 : null) })
        : null;
      return { ...meta, icon: configured?.icon || apiReward?.icon || null, iconFallback: configured?.fallbackIcon || null, priceUsd: price, aprBps: apiReward?.aprBps ?? pricedReceiptApr ?? null, receiptTokenAprBps: rawReceiptApr === undefined ? null : Number(rawReceiptApr) };
    });

    let depositedBalance;
    let workingBalance;
    let voteBoostMultiplier = null;
    if (reads.values.depositedRaw !== undefined && reads.values.depositedRaw !== null) depositedBalance = Number(ethers.formatUnits(reads.values.depositedRaw, depositedMeta.decimals));
    if (reads.values.workingRaw !== undefined && reads.values.workingRaw !== null) workingBalance = Number(ethers.formatUnits(reads.values.workingRaw, depositedMeta.decimals));

    const boostingAmountRaw = reads.values.boostingResult ? tupleValue(reads.values.boostingResult, "amount", 1) : undefined;
    const yieldBoostingTokens = boostingAmountRaw === undefined ? undefined : Number(ethers.formatUnits(boostingAmountRaw || 0n, depositedMeta.decimals));
    const poolTotalStakedRaw = topology.poolTotalStakedRaw;
    const accountedPrincipal = poolTotalStakedRaw !== undefined && poolTotalStakedRaw !== null
      ? Number(ethers.formatUnits(poolTotalStakedRaw, depositedMeta.decimals))
      : (depositedBalance !== undefined && yieldBoostingTokens !== undefined ? Math.max(0, depositedBalance - yieldBoostingTokens) : null);

    if (locker.gaugeModel === "xchain-uniform") voteBoostMultiplier = 1;
    else if (depositedBalance !== undefined) voteBoostMultiplier = resolveGaugeBoostMultiplier({ depositedBalance, workingBalance });

    let yieldData = {};
    if (stakeDaoRange && depositedBalance !== undefined && accountedPrincipal > 0 && voteBoostMultiplier !== null) {
      yieldData = calculateEffectiveBoostHubYield({
        minAprBps: stakeDaoRange.minAprBps,
        maxAprBps: locker.gaugeModel === "xchain-uniform" ? stakeDaoRange.minAprBps : stakeDaoRange.maxAprBps,
        voteBoostMultiplier,
        gaugeBalance: depositedBalance,
        accountedPrincipal,
      });
    } else if (stakeDaoRange) {
      yieldData = resolveStakeDaoYield(locker.id, stakeDaoRange, voteBoostMultiplier);
    }
    if (locker.yieldSource === "curve-weekly-apy-plus-max-crv" && external.values.curveApy) {
      try { yieldData = applyCurveVaultYield(locker, yieldData, external.values.curveApy); }
      catch (error) { fieldErrors.curveApy = errorText(error); }
    }

    const stakingRewardByAddress = Object.fromEntries(stakingRewards.map((reward) => [reward.address, reward]));
    const overviewRewards = rewardAddresses.overview.map((address) => stakingRewardByAddress[address]).filter(Boolean);

    let pps;
    if (reads.values.vaultSupplyRaw !== undefined && reads.values.vaultBalanceRaw !== undefined) {
      const ppsRaw = resolveVaultPps({
        reportedPps: reads.values.reportedPpsRaw,
        totalSupply: reads.values.vaultSupplyRaw,
        totalAssets: reads.values.vaultBalanceRaw,
        decimals: reads.values.vaultDecimalsRaw ?? 18,
      });
      pps = Number(ethers.formatUnits(ppsRaw, Number(reads.values.vaultDecimalsRaw ?? 18)));
    }

    const result = {
      ...yieldData,
      boostModel: locker.gaugeModel || "working-balance",
      status: Object.keys(fieldErrors).length ? "partial" : "live",
      updatedAt: Date.now(),
      fieldErrors,
      topology: { boostHubAddress, gaugeAddress, pid, lpAddress, poolTotalStakedRaw, strategyAddress: reads.values.strategyAddress || locker.strategyAddress || null },
      depositedBalance,
      accountedPrincipal,
      workingBalance,
      voteBoostMultiplier,
      yieldBoostingTokens,
      yieldBoostingTokenSymbol: depositedMeta.symbol,
      pps,
      vaultBalance: reads.values.vaultBalanceRaw === undefined ? undefined : Number(ethers.formatUnits(reads.values.vaultBalanceRaw, depositedMeta.decimals)),
      stakingSupply: reads.values.stakingSupplyRaw === undefined ? undefined : Number(ethers.formatUnits(reads.values.stakingSupplyRaw, depositedMeta.decimals)),
      assetPriceUsd: lpPrice,
      rewards: overviewRewards,
      claimRewards: stakingRewards,
      account,
      strategyAprLastUpdate: reads.values.strategyAprLastUpdateRaw === null || reads.values.strategyAprLastUpdateRaw === undefined ? null : Number(reads.values.strategyAprLastUpdateRaw) * 1000,
    };
    if (stakeDaoRange) {
      result.aprSource = {
        type: "stakedao-api",
        lockerId: stakeDaoRange.lockerId,
        minAprBps: stakeDaoRange.minAprBps,
        maxAprBps: stakeDaoRange.maxAprBps,
        lastUpdate: stakeDaoRange.lastUpdate ? stakeDaoRange.lastUpdate * 1000 : null,
      };
    }
    return result;
  }

  async function readDelegatedVlSdt(boostHubAddress, chainKey = "ethereum") {
    return withProvider(chainKey, async (provider) => {
      const boostHub = contract(boostHubAddress, BOOSTHUB_ABI, provider);
      try {
        const direct = await boostHub.vlsdtDelegated();
        if (direct > 0n) return Number(ethers.formatUnits(direct, 18));
      } catch {
        // Fall through to the vlBoost balance.
      }
      const vlBoostAddress = await boostHub.vlBoost();
      const vlBoost = contract(vlBoostAddress, ERC20_ABI, provider);
      const [balance, decimals] = await Promise.all([vlBoost.balanceOf(boostHubAddress), vlBoost.decimals().catch(() => 18)]);
      return Number(ethers.formatUnits(balance, Number(decimals)));
    }, "delegated vlSDT");
  }

  async function simulateWrite(chainKey, address, abi, functionName, args, account) {
    if (!account) return { authorized: false, reason: "Connect a wallet to check authorization.", gasEstimate: null };
    return withProvider(chainKey, async (provider) => {
      const iface = new ethers.Interface(abi);
      const data = iface.encodeFunctionData(functionName, args);
      const request = { to: address, from: account, data };
      try {
        await provider.call(request);
      } catch (error) {
        return { authorized: false, reason: errorText(error), gasEstimate: null };
      }
      let gasEstimate = null;
      try { gasEstimate = Number(await provider.estimateGas(request)); } catch { /* Simulation already proved callable. */ }
      return { authorized: true, reason: null, gasEstimate };
    }, `${functionName} simulation`);
  }

  async function lastHarvestTimestamp(locker) {
    try {
      const value = await withProvider(locker.chain, async (provider) => {
        const latest = await provider.getBlockNumber();
        const topic = ethers.id("Harvest(address,uint256)");
        const logs = await provider.getLogs({ address: locker.stakingAddress, topics: [topic], fromBlock: Math.max(0, latest - 150_000), toBlock: latest });
        if (!logs.length) return null;
        const block = await provider.getBlock(logs[logs.length - 1].blockNumber);
        return block ? Number(block.timestamp) * 1000 : null;
      }, `${locker.id} harvest history`);
      return { value, error: null };
    } catch (error) {
      return { value: null, error: errorText(error) };
    }
  }

  async function readStakeDaoVoteIncentives(locker, topology, rewards = []) {
    let executorAddress = null;
    try {
      executorAddress = await withProvider(locker.chain, (provider) =>
        contract(topology.boostHubAddress, BOOSTHUB_ABI, provider).stakeDaoClaimExecutor(),
      `${locker.id} StakeDAO claim executor`);
    } catch (error) {
      return { executorAddress: null, rewards: [], error: errorText(error) };
    }

    if (!executorAddress || sameAddress(executorAddress, ZERO_ADDRESS)) {
      return { executorAddress: null, rewards: [], error: null };
    }

    try {
      const pendingTokens = await withProvider(locker.chain, (provider) =>
        contract(executorAddress, STAKEDAO_CLAIM_EXECUTOR_ABI, provider).pendingTokens(topology.pid),
      `${locker.id} StakeDAO vote incentives`);

      const uniqueTokens = [...new Set((pendingTokens || []).map((address) => String(address).toLowerCase()).filter(Boolean))];
      if (!uniqueTokens.length) return { executorAddress, rewards: [], error: null };

      const claimReads = await settleNamedReads(Object.fromEntries(uniqueTokens.map((address) => [
        address,
        withProvider(locker.chain, (provider) =>
          contract(executorAddress, STAKEDAO_CLAIM_EXECUTOR_ABI, provider).getClaim(address),
        `${locker.id} StakeDAO incentive ${address}`),
      ])));

      const output = [];
      for (const address of uniqueTokens) {
        const result = claimReads.values[address];
        if (!result) continue;
        const claim = tupleValue(result, "claim_", 0);
        const exists = Boolean(tupleValue(claim, "exists", 5));
        const rawAmount = tupleValue(claim, "amount", 2);
        if (!exists || rawAmount === undefined || rawAmount === null || rawAmount === 0n) continue;

        let known = rewards.find((reward) => sameAddress(reward.address, address)) || null;
        let meta = known;
        if (!meta) {
          try {
            const tokenMeta = await readTokenMetadata(locker.chain, address);
            const configured = configuredToken(tokens, locker.chain, address);
            meta = { ...tokenMeta, symbol: configured?.symbol || tokenMeta.symbol, priceUsd: null };
          } catch {
            continue;
          }
        }

        const amount = Number(ethers.formatUnits(rawAmount, meta.decimals));
        if (!Number.isFinite(amount) || amount <= 0 || !meta.symbol || meta.symbol === "TOKEN") continue;

        let priceUsd = known?.priceUsd ?? null;
        if (priceUsd === null || priceUsd === undefined) {
          const configured = configuredToken(tokens, locker.chain, address);
          if (configured?.stable) priceUsd = 1;
          else {
            try {
              const priceMap = await fetchCurrentPrices([{ priceChain: chains[locker.chain].priceChain, address }]);
              priceUsd = priceMap[buildPriceKey(chains[locker.chain].priceChain, address)] ?? null;
            } catch {
              priceUsd = null;
            }
          }
        }

        output.push({
          address,
          symbol: meta.symbol,
          decimals: meta.decimals,
          amount,
          priceUsd,
          valueUsd: priceUsd === null || priceUsd === undefined ? null : amount * priceUsd,
        });
      }

      const claimErrors = Object.values(claimReads.errors || {});
      return { executorAddress, rewards: output, error: claimErrors.length ? claimErrors.join(" | ") : null };
    } catch (error) {
      return { executorAddress, rewards: [], error: errorText(error) };
    }
  }

  async function readAdminHarvestData(locker, account, live = {}) {
    const topology = live.topology?.boostHubAddress ? live.topology : await readTopology(locker);
    const strategyAddress = topology.strategyAddress || locker.strategyAddress || await withProvider(locker.chain, (provider) => contract(vaultAddressFor(locker), VAULT_ABI, provider).strategy(), `${locker.id} strategy`);
    const rewards = Array.isArray(live.claimRewards) ? live.claimRewards : [];
    const strategyClaimReads = Object.fromEntries(rewards.map((reward) => [reward.address, withProvider(locker.chain, (provider) => contract(locker.stakingAddress, STAKING_ABI, provider).claimable_reward(strategyAddress, reward.address), `${locker.id} strategy reward`)]));
    const strategyClaimed = await settleNamedReads(strategyClaimReads);
    const strategyRewards = rewards.map((reward) => {
      const raw = strategyClaimed.values[reward.address];
      const amount = raw === undefined ? null : Number(ethers.formatUnits(raw, reward.decimals));
      return { address: reward.address, symbol: reward.symbol, amount, priceUsd: reward.priceUsd ?? null, valueUsd: amount === null || reward.priceUsd === null || reward.priceUsd === undefined ? null : amount * reward.priceUsd };
    }).filter((reward) => reward.symbol && reward.symbol !== "TOKEN" && reward.amount !== null && reward.amount > 0);

    let boostHubRewards = [];
    let boostHubPendingError = null;
    try {
      const gauge = await withProvider(locker.chain, (provider) => Promise.resolve(contract(topology.gaugeAddress, STAKEDAO_GAUGE_ABI, provider)), `${locker.id} gauge contract`);
      const pendingReads = await settleNamedReads(Object.fromEntries(rewards.map((reward) => [
        reward.address,
        gauge.claimable_reward(topology.boostHubAddress, reward.address),
      ])));
      boostHubRewards = rewards.map((reward) => {
        const raw = pendingReads.values[reward.address];
        const amount = raw === undefined ? null : Number(ethers.formatUnits(raw, reward.decimals));
        const priceUsd = reward.priceUsd ?? null;
        return { address: reward.address, symbol: reward.symbol, amount, priceUsd, valueUsd: amount === null || priceUsd === null ? null : amount * priceUsd };
      }).filter((reward) => reward.symbol && reward.symbol !== "TOKEN" && reward.amount !== null && reward.amount > 0);
      if (Object.keys(pendingReads.errors).length) boostHubPendingError = Object.values(pendingReads.errors).join(" | ");
    } catch (error) {
      boostHubPendingError = errorText(error);
    }

    const voteIncentives = await readStakeDaoVoteIncentives(locker, topology, rewards);
    const voteIncentiveRewards = voteIncentives.rewards || [];

    const healthReads = await settleNamedReads({
      vaultPaused: withProvider(locker.chain, (provider) => contract(vaultAddressFor(locker), VAULT_ABI, provider).paused(), `${locker.id} vault paused status`),
      boostHubPaused: withProvider(locker.chain, (provider) => contract(topology.boostHubAddress, BOOSTHUB_ABI, provider).paused(), `${locker.id} BoostHub paused status`),
    });

    const [vaultSimulation, boostHubSimulation, harvestHistory] = await Promise.all([
      simulateWrite(locker.chain, strategyAddress, STRATEGY_ABI, "harvest", [], account),
      simulateWrite(locker.chain, topology.boostHubAddress, BOOSTHUB_ABI, "harvest", [topology.pid], account),
      lastHarvestTimestamp(locker),
    ]);

    const sumUsd = (items) => items.reduce((sum, item) => sum + (Number.isFinite(item.valueUsd) ? item.valueUsd : 0), 0);
    return {
      updatedAt: Date.now(),
      strategyAddress,
      boostHubAddress: topology.boostHubAddress,
      pid: topology.pid,
      lastHarvestAt: harvestHistory.value,
      historyError: harvestHistory.error,
      vaultPaused: healthReads.values.vaultPaused ?? null,
      boostHubPaused: healthReads.values.boostHubPaused ?? null,
      healthErrors: healthReads.errors,
      vault: { ...vaultSimulation, pendingRewards: strategyRewards, pendingValueUsd: sumUsd(strategyRewards), errors: strategyClaimed.errors },
      boostHub: {
        ...boostHubSimulation,
        pendingRewards: boostHubRewards,
        voteIncentiveRewards,
        directPendingValueUsd: sumUsd(boostHubRewards),
        voteIncentiveValueUsd: sumUsd(voteIncentiveRewards),
        pendingValueUsd: sumUsd(boostHubRewards) + sumUsd(voteIncentiveRewards),
        pendingError: boostHubPendingError,
        voteIncentiveError: voteIncentives.error,
        voteIncentiveExecutor: voteIncentives.executorAddress,
      },
    };
  }

  function getRpcStatus() {
    return Object.fromEntries([...rpcSessions.entries()].map(([chainKey, session]) => {
      const rotation = session.rotationStatus();
      const endpoints = session.all().map((endpoint) => ({
        ...endpoint,
        active: endpoint.url === rotation.activeUrl,
        next: endpoint.url === rotation.nextUrl,
        successesUntilRotation: endpoint.url === rotation.activeUrl ? rotation.successesUntilRotation : null,
        rotateAfterSuccesses: rotation.rotateAfterSuccesses,
      }));
      return [chainKey, endpoints];
    }));
  }

  async function retestRpcHealth(chainKey = null) {
    const keys = chainKey ? [chainKey] : [...rpcSessions.keys()];
    for (const key of keys) rpcSessions.get(key)?.reset();
    for (const cacheKey of [...providerCache.keys()]) {
      if (!chainKey || cacheKey.startsWith(`${chainKey}:`)) {
        providerCache.get(cacheKey)?.destroy?.();
        providerCache.delete(cacheKey);
      }
    }
    await Promise.allSettled(keys.map((key) => getProvider(key)));
    return getRpcStatus();
  }

  return { getProvider, readLocker, readDelegatedVlSdt, readAdminHarvestData, getRpcStatus, retestRpcHealth };
}
