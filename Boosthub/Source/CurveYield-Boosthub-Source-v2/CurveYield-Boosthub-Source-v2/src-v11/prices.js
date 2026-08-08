const PRICE_ENDPOINT = "https://coins.llama.fi/prices/current";

export function makePriceKey(priceChain, address) {
  return `${priceChain}:${String(address).toLowerCase()}`;
}

export async function fetchCurrentPrices(requests, { timeoutMs = 10_000 } = {}) {
  const unique = [...new Set(requests.map(({ priceChain, address }) => makePriceKey(priceChain, address)))];
  if (!unique.length) return {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${PRICE_ENDPOINT}/${unique.join(",")}`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Price API returned ${response.status}`);
    const payload = await response.json();
    const result = {};
    for (const key of unique) {
      const price = Number(payload?.coins?.[key]?.price);
      if (Number.isFinite(price) && price > 0) result[key] = price;
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}
