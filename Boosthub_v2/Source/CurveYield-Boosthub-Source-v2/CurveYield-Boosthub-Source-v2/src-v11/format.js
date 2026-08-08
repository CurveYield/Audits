export function shortAddress(address) {
  if (!address || address.length < 10) return "--";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatUnits(value, decimals = 18, maxDecimals = 4) {
  if (value === null || value === undefined) return "--";
  try {
    const formatted = window.ethers.formatUnits(value, decimals);
    const [whole, fraction = ""] = formatted.split(".");
    const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole;
  } catch {
    return "--";
  }
}

export function formatNumber(value, maxDecimals = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: maxDecimals }).format(number);
}

export function formatPercentFromBps(value, fallback = "--") {
  if (value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return `${(number / 100).toFixed(2)}%`;
}

export function formatApyFromBps(value) {
  return formatPercentFromBps(value);
}

export function formatBoost(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}x` : "--";
}

export function parseInputAmount(value, decimals = 18) {
  const clean = String(value || "").trim();
  if (!clean || Number(clean) <= 0) throw new Error("Enter an amount greater than zero.");
  return window.ethers.parseUnits(clean, decimals);
}

export function scanAddress(chain, address) {
  return `${chain.explorer.baseUrl}/address/${address}`;
}
