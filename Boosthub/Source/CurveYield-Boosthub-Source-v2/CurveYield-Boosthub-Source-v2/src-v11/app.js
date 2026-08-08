import {
  CHAINS,
  DOCS_URL,
  LOCKERS,
  REFRESH_INTERVAL_MS,
  TOKENS,
  blockscoutInteractionUrl,
  blockscoutSourceUrl,
} from "./config.js";
import { BOOSTHUB_ABI, ERC20_ABI, STAKING_ABI, STRATEGY_ABI, VAULT_ABI } from "./abi.js";
import {
  SNAPSHOT_VERSION,
  clearPublicCache,
  hydrateSnapshot,
  inspectPublicCache,
  inspectStorageHealth,
  getStorageDiagnostics,
  loadErrorLog,
  loadLocalSnapshot,
  mergeSnapshotLocker,
  persistErrorLog,
  persistSnapshot,
  subscribeSnapshots,
} from "./data-store.js";
import { createLiveDataClient } from "./live-data.js";
import { buildChartSeries, filterYieldHistory, readAllYieldHistory, readYieldHistory, recordYieldObservation } from "./history-store.js";
import { chooseHistorySource, fetchIndexerHistory } from "./history-api.js";
import { readActivity, recordActivity } from "./activity-store.js";
import { appendErrorLog, normalizeAppError } from "./error-log.js";
import { DIAGNOSTIC_PAGE_SIZES, diagnosticExport, filterErrorEntries, paginateEntries, redactDiagnosticRecord } from "./diagnostics.js";
import { createModalFocusManager } from "./modal-focus.js";
import { RUNTIME_CONFIG } from "./runtime-config.js";
import { createWalletConnectAdapter, loadWalletConnectEthereumProvider } from "./walletconnect.js";
import { vaultAddressFor } from "./contract-targets.js";
import { calculateUserPosition, projectPositionIncome } from "./portfolio-math.js";
import { createLockerActionState, getLockerActionState, resolveRoute, updateLockerActionState } from "./ui-state.js";
import {
  formatApyFromBps,
  formatBoost,
  formatNumber,
  formatPercentFromBps,
  formatUnits,
  parseInputAmount,
  scanAddress,
  shortAddress,
} from "./format.js";

const { ethers } = window;
const liveClient = createLiveDataClient({ ethers, chains: CHAINS, tokens: TOKENS });
const app = document.getElementById("app");
const connectWalletButton = document.getElementById("connectWallet");
const networkIndicator = document.getElementById("networkIndicator");
const offlineIndicator = document.getElementById("offlineIndicator");
const toast = document.getElementById("toast");
const statusRegion = document.getElementById("statusRegion");
const menuToggle = document.getElementById("menuToggle");
const siteMenu = document.getElementById("siteMenu");
const sidebarSummary = document.getElementById("sidebarSummary");
const confirmationModal = document.getElementById("confirmationModal");
const walletModal = document.getElementById("walletModal");

let walletConnectAdapter = null;
let walletConnectLoadPromise = null;

const state = {
  account: null,
  provider: null,
  signer: null,
  walletChainId: null,
  walletEip1193: null,
  walletInfo: null,
  walletProviders: new Map(),
  boundWalletProviders: new WeakSet(),
  activeLockerId: "sdcrv",
  actionState: createLockerActionState(LOCKERS),
  live: new Map(),
  aggregate: {},
  yieldHistory: new Map(),
  remoteYieldHistory: new Map(),
  historyFetches: new Map(),
  yieldRange: new Map(),
  activity: new Map(),
  refreshPromise: null,
  lastRefreshAt: 0,
  pendingActions: new Set(),
  pendingIntent: null,
  confirmation: null,
  transactionStatus: null,
  lastTransactionError: null,
  errorLog: [],
  adminData: new Map(),
  adminSelection: new Set(),
  batchStatus: [],
  adminRefreshPromise: null,
  diagnosticFilters: { chain: "all", status: "all", contractAddress: "all", transactionHash: "" },
  diagnosticPage: 1,
  diagnosticPageSize: 200,
  cacheInspection: null,
  storageHealth: null,
  autoSwitchPrompts: new Set(),
  walletConnectStatus: "idle",
  walletConnectError: null,
};

const walletModalFocus = createModalFocusManager({ container: walletModal, onEscape: closeWalletModal });
const confirmationModalFocus = createModalFocusManager({ container: confirmationModal, onEscape: closeConfirmation });

function token(tokenKey) {
  return TOKENS[tokenKey];
}

function lockerById(id) {
  return LOCKERS.find((locker) => locker.id === id) || LOCKERS.find((locker) => locker.id === "sdcrv");
}

function liveFor(locker) {
  return state.live.get(locker.id) || {};
}

function contract(address, abi, providerOrSigner) {
  return new ethers.Contract(address, abi, providerOrSigner);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function formatUsd(value, maximumFractionDigits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits }).format(number);
}

function relativeTimeFrom(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "--";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function announce(message) {
  statusRegion.textContent = "";
  window.setTimeout(() => { statusRegion.textContent = message; }, 10);
}

function notify(message, type = "info") {
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("visible");
  announce(message);
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove("visible"), type === "error" ? 8_000 : 4_200);
}

function getRoute() {
  const route = resolveRoute(window.location.hash, LOCKERS);
  if (route.redirect) {
    const base = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", `${base}#/`);
  }
  return route;
}

function fallbackImageAttribute(fallback) {
  return fallback ? ` data-icon-fallback="${escapeAttribute(fallback)}"` : "";
}

function tokenImg(tokenKey, size = "md") {
  const item = token(tokenKey);
  const src = item.listIcon || item.icon;
  const fallback = item.listIcon ? null : item.fallbackIcon;
  return `<span class="token-orb ${size} token-${tokenKey.toLowerCase()}"><img class="token-img" src="${escapeAttribute(src)}"${fallbackImageAttribute(fallback)} alt="${escapeAttribute(item.symbol)}" /></span>`;
}

function rewardImg(reward, size = "xs") {
  if (reward?.icon) return `<span class="token-orb ${size}"><img class="token-img" src="${escapeAttribute(reward.icon)}"${fallbackImageAttribute(reward.iconFallback)} alt="${escapeAttribute(reward.symbol)}" /></span>`;
  return `<span class="token-orb ${size} token-fallback" aria-hidden="true">${escapeHtml(String(reward?.symbol || "?").slice(0, 1))}</span>`;
}

function installImageFallbacks() {
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const fallback = image.dataset.iconFallback;
    if (!fallback || image.dataset.iconFallbackApplied === "true") return;
    image.dataset.iconFallbackApplied = "true";
    image.src = fallback;
  }, true);
}

function chainBadge(chainKey) {
  return `<span class="chain-badge chain-${chainKey}">${CHAINS[chainKey].shortName}</span>`;
}

function hasFieldError(live, keys) {
  const errors = live?.fieldErrors || {};
  return keys.some((key) => Boolean(errors[key]));
}

function displayOrError(live, formatted, errorKeys = []) {
  const hasError = hasFieldError(live, errorKeys) || (live?.status === "error" && !live?.updatedAt);
  if (formatted !== "--" && formatted !== "") {
    if (!hasError) return formatted;
    const timestamp = Number(live?.lastKnownAt || live?.lastSuccessfulAt || live?.updatedAt || 0);
    const title = timestamp ? `Last successful value from ${new Date(timestamp).toLocaleString()}` : "Last successful value";
    return `<span class="last-known-value" title="${escapeAttribute(title)}"><strong>${formatted}</strong><small>Last known</small></span>`;
  }
  if (hasError) return `<span class="data-unavailable" aria-label="Data unavailable">Unavailable</span>`;
  return "--";
}

function statusText(live) {
  if (!live?.updatedAt) return Object.keys(live?.fieldErrors || {}).length ? "Error · no saved value" : "Waiting for data";
  const age = Date.now() - Number(live.updatedAt);
  if (live.status === "partial") return `Partial · saved values retained · ${new Date(live.updatedAt).toLocaleTimeString()}`;
  if (live.status === "error" || live.status === "stale" || age > REFRESH_INTERVAL_MS * 2) return `Cached · stale · ${new Date(live.updatedAt).toLocaleTimeString()}`;
  if (live.status === "cached") return `Cached · ${new Date(live.updatedAt).toLocaleTimeString()}`;
  return `Live · ${new Date(live.updatedAt).toLocaleTimeString()}`;
}

function isXChainUniform(live) {
  return live?.boostModel === "xchain-uniform";
}

function defaultAprText(live) {
  return displayOrError(live, formatPercentFromBps(live.defaultAprBps), isXChainUniform(live) ? ["topology"] : ["stakeDaoRange"]);
}

function boostHubAprText(live) {
  return displayOrError(live, formatPercentFromBps(live.boostHubAprBps), isXChainUniform(live) ? ["topology"] : ["stakeDaoRange", "workingRaw", "topology"]);
}

function vaultApyText(live) {
  return displayOrError(live, formatApyFromBps(live.vaultApyBps), isXChainUniform(live) ? ["topology"] : ["curveApy", "stakeDaoRange", "topology"]);
}

function boostText(live) {
  return displayOrError(live, formatBoost(live.boostMultiplier), isXChainUniform(live) ? ["topology"] : ["workingRaw", "topology"]);
}

function overviewVaultApyText(locker, live) {
  return vaultApyText(live);
}

function rewardRows(locker, live) {
  if (Array.isArray(live.rewards) && live.rewards.length) return live.rewards;
  return locker.rewardTokens.map((key) => ({ ...token(key), address: token(key).address.toLowerCase(), aprBps: null }));
}

function claimRewardRows(locker, live) {
  if (Array.isArray(live.claimRewards) && live.claimRewards.length) return live.claimRewards;
  return locker.rewardTokens.map((key) => ({ ...token(key), address: token(key).address.toLowerCase(), aprBps: null }));
}

function rewardAprText(live, reward) {
  return displayOrError(live, formatPercentFromBps(reward.aprBps), isXChainUniform(live) ? [] : ["stakeDaoRange"]);
}

function renderStakingRewardCell(locker, live) {
  const staking = rewardRows(locker, live).map((reward) => `<div class="reward-pill">${rewardImg(reward)}<span>${escapeHtml(reward.symbol)}</span><strong>${rewardAprText(live, reward)}</strong></div>`).join("") || `<span class="reward-empty">No active rewards</span>`;
  return `<div class="reward-cell-list staking-reward-list">${staking}</div>`;
}

function renderVaultRewardCell(locker, live) {
  const item = token(locker.token);
  return `<div class="reward-cell-list vault-reward-list"><div class="reward-pill vault-reward-pill">${tokenImg(locker.token, "xs")}<span>${escapeHtml(item.symbol)}</span><strong>${overviewVaultApyText(locker, live)} APY</strong></div></div>`;
}

function metric(label, value, sub = "", className = "") {
  return `<div class="metric-card ${className}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div>${sub ? `<div class="metric-sub">${sub}</div>` : ""}</div>`;
}

function addressControl(chain, address, label = "Contract") {
  if (!address || !String(address).startsWith("0x")) return `<span>${escapeHtml(address || "--")}</span>`;
  return `<span class="address-control"><a href="${scanAddress(chain, address)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeAttribute(label)} ${escapeAttribute(address)}">${shortAddress(address)}</a><button type="button" class="copy-address" data-copy-address="${address}" aria-label="Copy ${escapeAttribute(label)} address">Copy</button></span>`;
}

function isDesktopNavigation() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 981px)").matches;
}

function navigationActive(href) {
  const route = getRoute();
  if (href === "#/" && route.page === "overview") return true;
  if (href === "#/admin" && route.page === "admin") return true;
  if (href.startsWith("#/locker/") && route.page === "locker") return href.endsWith(`/${route.id}`);
  return false;
}

function renderSiteMenu() {
  const lockerLinks = LOCKERS.filter((locker) => !locker.hidden).map((locker) => {
    const href = `#/locker/${locker.id}`;
    return `<a href="${href}" class="${navigationActive(href) ? "active" : ""}">${tokenImg(locker.token, "xs")}<span>${escapeHtml(token(locker.token).symbol)}</span></a>`;
  }).join("");
  siteMenu.innerHTML = `<a href="#/" class="${navigationActive("#/") ? "active" : ""}"><span class="nav-symbol" aria-hidden="true">⌂</span><span>Home</span></a><a href="${DOCS_URL}" target="_blank" rel="noreferrer"><span class="nav-symbol" aria-hidden="true">▤</span><span>Documentation</span></a>${lockerLinks}<a href="#/admin" class="${navigationActive("#/admin") ? "active" : ""}"><span class="nav-symbol" aria-hidden="true">◇</span><span>Admin</span></a>`;
  siteMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => closeMenu()));
  if (isDesktopNavigation()) siteMenu.hidden = false;
}

function updateSidebarSummary() {
  if (!sidebarSummary) return;
  const delegated = state.aggregate.vlsdtDelegated === null || state.aggregate.vlsdtDelegated === undefined
    ? "--"
    : `${formatNumber(state.aggregate.vlsdtDelegated, 2)} vlSDT`;
  const visibleLockers = LOCKERS.filter((locker) => !locker.hidden);
  const availableLockers = visibleLockers.filter((locker) => Number(liveFor(locker).updatedAt) > 0).length;
  sidebarSummary.innerHTML = `<div class="sidebar-summary-head"><span class="sidebar-summary-mark" aria-hidden="true">◇</span><strong>CurveYield Ecosystem</strong></div><div class="sidebar-summary-row"><span>Delegated vlSDT</span><strong>${escapeHtml(delegated)}</strong></div><div class="sidebar-summary-row"><span>Locker data available</span><strong>${availableLockers}/${visibleLockers.length}</strong></div>`;
}

function openMenu() {
  siteMenu.hidden = false;
  menuToggle.setAttribute("aria-expanded", "true");
  menuToggle.setAttribute("aria-label", "Close navigation menu");
  document.body.classList.add("nav-open");
}

function closeMenu() {
  document.body.classList.remove("nav-open");
  if (isDesktopNavigation()) {
    siteMenu.hidden = false;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Navigation menu");
    return;
  }
  siteMenu.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation menu");
}

function toggleMenu() {
  if (isDesktopNavigation()) return;
  if (siteMenu.hidden) openMenu(); else closeMenu();
}

function finiteMetricCandidate(locker, key) {
  const live = liveFor(locker);
  const value = Number(live?.[key]);
  if (!Number.isFinite(value)) return null;
  return { locker, live, value };
}

function highestLockerMetric(key) {
  return LOCKERS.filter((locker) => !locker.hidden)
    .map((locker) => finiteMetricCandidate(locker, key))
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)[0] || null;
}

function liveRewardStreamCount() {
  const lockers = LOCKERS.filter((locker) => !locker.hidden);
  const rows = lockers.flatMap((locker) => rewardRows(locker, liveFor(locker)));
  const known = rows.filter((reward) => Number.isFinite(Number(reward.aprBps)));
  if (!known.length) return null;
  return known.filter((reward) => Number(reward.aprBps) > 0).length;
}

function summaryMetric(label, value, sub, icon) {
  return `<div class="metric-card aggregate-metric white-summary-card"><div><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-sub">${sub}</div></div><span class="summary-icon" aria-hidden="true">${icon}</span></div>`;
}

function summaryMetricIcon(kind) {
  if (kind === "delegated") return `<img src="./assets/brand/stakedao-elephant.svg" alt="" />`;
  if (kind === "staking") return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 23l6-7 5 4 9-11"/><path d="M20 9h5v5"/><circle cx="8" cy="8" r="3"/><path d="M6.4 9.8l3.2-3.6"/></svg>`;
  if (kind === "vault") return `<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="9" rx="9" ry="4"/><path d="M7 9v6c0 2.2 4 4 9 4s9-1.8 9-4V9"/><path d="M7 15v6c0 2.2 4 4 9 4s9-1.8 9-4v-6"/></svg>`;
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 25V13"/><circle cx="16" cy="9" r="2"/><path d="M10 14a8 8 0 0 1 12 0M6 10a13 13 0 0 1 20 0M10 20h12"/></svg>`;
}

function renderOverview() {
  const rows = LOCKERS.filter((locker) => !locker.hidden).map((locker) => {
    const item = token(locker.token);
    const live = liveFor(locker);
    return `<a class="locker-row white-locker-card" href="#/locker/${locker.id}" aria-label="Open ${escapeAttribute(item.symbol)} BoostHub">
      <div class="locker-token home-locker-identity">${tokenImg(locker.token, "lg")}<span><span class="locker-name-line"><strong>${escapeHtml(item.symbol)}</strong>${chainBadge(locker.chain)}</span><p>Stake ${escapeHtml(item.symbol)} to earn rewards and boost your yield.</p></span></div>
      <div class="locker-performance" aria-label="${escapeAttribute(item.symbol)} yield metrics">
        <div><span>Default APR</span><strong>${defaultAprText(live)}</strong></div>
        <div><span>BoostHub APY</span><strong>${overviewVaultApyText(locker, live)}</strong></div>
        <div><span>Boost</span><strong>${boostText(live)}</strong></div>
      </div>
      <div class="home-reward-columns" aria-label="${escapeAttribute(item.symbol)} reward columns">
        <section class="home-reward-column staking-reward-column"><h3>Staking Rewards</h3>${renderStakingRewardCell(locker, live)}</section>
        <section class="home-reward-column vault-reward-column"><h3>Vault Rewards</h3>${renderVaultRewardCell(locker, live)}</section>
      </div>
      <span class="view-locker-cta">View Locker <span aria-hidden="true">›</span></span>
    </a>`;
  }).join("");

  const delegated = state.aggregate.vlsdtDelegated === null || state.aggregate.vlsdtDelegated === undefined
    ? displayOrError(state.aggregate, "--", ["vlsdtDelegated"])
    : `${formatNumber(state.aggregate.vlsdtDelegated, 2)} vlSDT`;
  const highestStaking = highestLockerMetric("boostHubAprBps");
  const highestVault = highestLockerMetric("vaultApyBps");
  const streams = liveRewardStreamCount();
  const highestStakingValue = highestStaking ? formatPercentFromBps(highestStaking.value) : "--";
  const highestVaultValue = highestVault ? formatApyFromBps(highestVault.value) : "--";
  const highestStakingSub = highestStaking ? token(highestStaking.locker.token).symbol : "Waiting for live data";
  const highestVaultSub = highestVault ? token(highestVault.locker.token).symbol : "Waiting for live data";
  const streamValue = streams === null ? "--" : String(streams);
  const streamSub = streams === null ? "Waiting for live data" : "Current positive reward streams";

  app.innerHTML = `<section class="overview white-overview">
    ${renderTransactionStatus()}
    <div class="page-title overview-title"><div class="overview-copy"><h1>BoostHub</h1><p>StakeDAO yield boosters and compounding vaults.</p></div><button class="small-btn refresh-btn" type="button" data-action="refresh" ${isPending("global:refresh") ? "disabled" : ""}>${isPending("global:refresh") ? "Refreshing…" : "Refresh"}</button></div>
    <div class="aggregate-grid white-aggregate-grid">
      ${summaryMetric("Delegated vlSDT", delegated, statusText(state.aggregate), summaryMetricIcon("delegated"))}
      ${summaryMetric("Highest Boosted Staking APR", highestStakingValue, highestStakingSub, summaryMetricIcon("staking"))}
      ${summaryMetric("Highest Vault APY", highestVaultValue, highestVaultSub, summaryMetricIcon("vault"))}
      ${summaryMetric("Live Reward Streams", streamValue, streamSub, summaryMetricIcon("rewards"))}
    </div>
    <section class="locker-list-panel white-locker-list" aria-label="CurveYield BoostHub vaults">
      <div class="locker-list">${rows}</div>
    </section>
    <section class="boosthub-trust-strip"><span class="trust-mark" aria-hidden="true">◇</span><div><strong>BoostHub boosts your rewards.</strong><p>Stake in a supported locker to earn protocol rewards and compound through CurveYield vaults.</p></div><a href="${DOCS_URL}" target="_blank" rel="noreferrer">Learn more ↗</a></section>
  </section>`;
}

function renderTransactionStatus() {
  const tx = state.transactionStatus;
  if (!tx) return "";
  const chain = CHAINS[tx.chain];
  const hashLink = tx.hash && chain ? `<a href="${chain.explorer.baseUrl}/tx/${tx.hash}" target="_blank" rel="noreferrer">View transaction</a>` : "";
  return `<section class="transaction-status ${tx.status}" aria-label="Transaction status"><div><strong>${escapeHtml(tx.title || "Transaction")}</strong><span>${escapeHtml(tx.message || tx.status)}</span></div>${hashLink}</section>`;
}

function renderTransactionError(lockerId = null) {
  const error = state.lastTransactionError;
  if (!error || (lockerId && error.lockerId && error.lockerId !== lockerId)) return "";
  const chain = error.chain ? CHAINS[error.chain] : null;
  const hash = error.transactionHash && chain ? `<a href="${chain.explorer.baseUrl}/tx/${error.transactionHash}" target="_blank" rel="noreferrer">Open failed transaction</a>` : "";
  return `<section class="transaction-error-panel" role="alert"><div><strong>Transaction error</strong><p>${escapeHtml(error.message)}</p>${error.reason && error.reason !== error.message ? `<p><span>Reason:</span> ${escapeHtml(error.reason)}</p>` : ""}${error.code ? `<p><span>Code:</span> ${escapeHtml(error.code)}</p>` : ""}${error.details ? `<details><summary>Technical details</summary><pre>${escapeHtml(error.details)}</pre></details>` : ""}</div>${hash}<button type="button" class="dismiss-error" data-action="dismiss-error" aria-label="Dismiss transaction error">×</button></section>`;
}

function renderChainSwitchPrompt(locker) {
  if (!state.account || state.walletChainId === CHAINS[locker.chain].chainId) return "";
  const current = Object.values(CHAINS).find((chain) => chain.chainId === state.walletChainId)?.name || `chain ${state.walletChainId}`;
  return `<section class="chain-switch-prompt" role="status"><div><strong>Switch network</strong><span>Your wallet is on ${escapeHtml(current)}. ${escapeHtml(token(locker.token).symbol)} uses ${escapeHtml(CHAINS[locker.chain].name)}.</span></div><button type="button" class="small-btn" data-action="switch-chain" data-locker-id="${locker.id}">Switch to ${escapeHtml(CHAINS[locker.chain].name)}</button></section>`;
}

function renderContractSummary(locker, live = {}) {
  const item = token(locker.token);
  const strategyAddress = live.topology?.strategyAddress || locker.strategyAddress;
  const stakingInteraction = locker.stakingInteractionUrl || blockscoutInteractionUrl(locker.chainId, locker.stakingAddress, { token: true });
  const stakingSource = locker.stakingSourceUrl || blockscoutSourceUrl(locker.chainId, locker.stakingAddress, { token: true });
  const vaultAddress = vaultAddressFor(locker);
  const vaultInteraction = blockscoutInteractionUrl(locker.chainId, vaultAddress, { token: true });
  const vaultSource = blockscoutSourceUrl(locker.chainId, vaultAddress, { token: true });
  const strategyInteraction = blockscoutInteractionUrl(locker.chainId, strategyAddress);
  const strategySource = blockscoutSourceUrl(locker.chainId, strategyAddress);
  const card = (label, name, address, interaction, source) => `<div class="contract-summary-item"><span class="contract-summary-label">${label}</span><strong>${escapeHtml(name)}</strong><code>${shortAddress(address)}</code><div class="contract-summary-actions"><a class="contract-summary-link primary-contract-link" href="${escapeAttribute(interaction)}" target="_blank" rel="noreferrer">Read / Write ↗</a><a class="contract-source-link" href="${escapeAttribute(source)}" target="_blank" rel="noreferrer">Verified source ↗</a><button type="button" class="copy-address" data-copy-address="${address}">Copy</button></div></div>`;
  return `<section class="contract-information-section"><div class="section-heading"><div><span class="action-eyebrow">Contracts</span><h2>Contract Information</h2></div></div><div class="contract-summary" aria-label="${escapeAttribute(item.symbol)} contracts">
    ${card("Staking contract", "BoostHub Staking", locker.stakingAddress, stakingInteraction, stakingSource)}
    ${card("Compounding vault", `${item.symbol} Vault`, vaultAddress, vaultInteraction, vaultSource)}
    ${card("Compounding strategy", `${item.symbol} Strategy`, strategyAddress, strategyInteraction, strategySource)}
  </div></section>`;
}

function renderLockerRewardsSection(locker, live, wallet) {
  const stakingRewards = claimRewardRows(locker, live).map((reward) => `<div class="locker-reward-item"><div class="reward-token">${rewardImg(reward, "sm")}<strong>${escapeHtml(reward.symbol)}</strong></div><div><span>APR</span><strong>${rewardAprText(live, reward)}</strong></div><div><span>Claimable</span><strong>${wallet.claimable?.[reward.address] || "--"}</strong></div></div>`).join("") || `<p class="analytics-empty-copy">No active staking rewards are available.</p>`;
  return `<section class="locker-reward-panels">
    <div class="panel locker-reward-panel"><div class="section-heading compact"><div><span class="action-eyebrow">Distributed rewards</span><h2>Staking Rewards</h2></div></div><div class="locker-reward-list">${stakingRewards}</div></div>
    <div class="panel locker-reward-panel vault-reward-detail"><div class="section-heading compact"><div><span class="action-eyebrow">Auto-compounding</span><h2>Vault Rewards</h2></div></div><div class="vault-reward-highlight">${tokenImg(locker.token, "md")}<div><strong>${escapeHtml(token(locker.token).symbol)} vault</strong><span>BoostHub APY</span></div><strong class="vault-reward-apy">${vaultApyText(live)}</strong></div><p>Vault rewards are compounded into the underlying locker position. PPS: ${displayOrError(live, formatNumber(live.pps, 6), ["reportedPpsRaw", "vaultBalanceRaw", "vaultSupplyRaw"])}</p></div>
  </section>`;
}

function historyRangeFor(lockerId) {
  return state.yieldRange.get(lockerId) || "7d";
}

function chartPath(points, key, minTime, maxTime, minBps, maxBps, width = 620, height = 210) {
  const left = 42, right = 14, top = 14, bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const timeSpan = Math.max(1, maxTime - minTime);
  const valueSpan = Math.max(1, maxBps - minBps);
  return points.flatMap((point) => {
    const value = point[key];
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return [];
    const x = left + ((Number(point.observedAt) - minTime) / timeSpan) * plotWidth;
    const y = top + plotHeight - ((Number(value) - minBps) / valueSpan) * plotHeight;
    return [[x, y]];
  }).map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

function chartPoint(point, key, minTime, maxTime, minBps, maxBps, className) {
  const value = Number(point?.[key]);
  if (!Number.isFinite(value)) return "";
  const x = 42 + ((Number(point.observedAt) - minTime) / Math.max(1, maxTime - minTime)) * 564;
  const y = 14 + 166 - ((value - minBps) / Math.max(1, maxBps - minBps)) * 166;
  return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" class="${className}"/>`;
}

function renderYieldHistoryPanel(locker) {
  const range = historyRangeFor(locker.id);
  const localRows = state.yieldHistory.get(locker.id) || [];
  const remoteRows = state.remoteYieldHistory.get(`${locker.id}:${range}`) || [];
  const rawRows = chooseHistorySource(remoteRows, localRows);
  const rows = filterYieldHistory(rawRows, range);
  const series = buildChartSeries(rows);
  const ranges = [["7d", "7D"], ["30d", "30D"], ["90d", "90D"], ["1y", "1Y"], ["all", "All"]];
  const controls = ranges.map(([value, label]) => `<button type="button" data-history-range="${value}" data-locker-id="${locker.id}" class="${range === value ? "active" : ""}">${label}</button>`).join("");
  const usable = series.points.filter((point) => point.defaultAprBps !== null || point.vaultApyBps !== null);
  if (usable.length < 2) {
    return `<section class="panel yield-history-panel"><div class="analytics-panel-head"><div><span class="action-eyebrow">Indexed real observations</span><h2>Historical Yield</h2></div><div class="history-range-controls">${controls}</div></div><div class="analytics-empty"><strong>Building real yield history</strong><p class="analytics-empty-copy">This chart tracks StakeDAO Default Staking APR and BoostHub Vault APY. Shared Cloudflare D1 history is used when available; local real observations remain the offline fallback. Synthetic backfill is disabled.</p></div></section>`;
  }
  const minTime = Math.min(...usable.map((point) => Number(point.observedAt)));
  const maxTime = Math.max(...usable.map((point) => Number(point.observedAt)));
  const values = usable.flatMap((point) => [point.defaultAprBps, point.vaultApyBps]).map(Number).filter(Number.isFinite);
  const rawMinBps = Math.min(...values);
  const rawMaxBps = Math.max(...values);
  const padding = Math.max(100, (rawMaxBps - rawMinBps) * 0.15);
  const minBps = Math.max(0, rawMinBps - padding);
  const maxBps = rawMaxBps + padding;
  const aprPath = chartPath(usable, "defaultAprBps", minTime, maxTime, minBps, maxBps);
  const apyPath = chartPath(usable, "vaultApyBps", minTime, maxTime, minBps, maxBps);
  const ticks = [0, 0.5, 1].map((ratio) => {
    const value = maxBps - ((maxBps - minBps) * ratio);
    const y = 14 + ratio * 166;
    return `<line x1="42" y1="${y}" x2="606" y2="${y}" class="chart-grid-line"/><text x="4" y="${y + 4}" class="chart-axis-label">${(value / 100).toFixed(1)}%</text>`;
  }).join("");
  const latest = usable[usable.length - 1];
  const latestDefault = Number.isFinite(Number(latest.defaultAprBps)) ? formatPercentFromBps(latest.defaultAprBps) : "--";
  const latestVault = Number.isFinite(Number(latest.vaultApyBps)) ? formatApyFromBps(latest.vaultApyBps) : "--";
  const latestApyPoint = chartPoint(latest, "vaultApyBps", minTime, maxTime, minBps, maxBps, "chart-point vault-apy-point");
  const latestAprPoint = chartPoint(latest, "defaultAprBps", minTime, maxTime, minBps, maxBps, "chart-point staking-apr-point");
  const dateIndexes = [...new Set([0, Math.floor((usable.length - 1) / 2), usable.length - 1])];
  const dateLabels = dateIndexes.map((index) => {
    const point = usable[index];
    const x = 42 + ((Number(point.observedAt) - minTime) / Math.max(1, maxTime - minTime)) * 564;
    return `<text x="${x}" y="204" text-anchor="middle" class="chart-axis-label">${new Date(point.observedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</text>`;
  }).join("");
  return `<section class="panel yield-history-panel"><div class="analytics-panel-head"><div><span class="action-eyebrow">Indexed real observations</span><h2>Historical Yield</h2></div><div class="history-range-controls">${controls}</div></div><div class="chart-legend"><span><i class="legend-line apy"></i>BoostHub Vault APY <strong class="latest-history-value">${latestVault}</strong></span><span><i class="legend-line apr"></i>StakeDAO Default APR <strong class="latest-history-value">${latestDefault}</strong></span><small>${usable.length} observations</small></div><div class="yield-chart-wrap"><svg class="yield-chart" viewBox="0 0 620 210" role="img" aria-label="Historical StakeDAO Default APR and BoostHub Vault APY based on real indexed observations">${ticks}${dateLabels}<path d="${apyPath}" class="chart-series vault-apy-series"/><path d="${aprPath}" class="chart-series staking-apr-series"/>${latestApyPoint}${latestAprPoint}</svg></div></section>`;
}

function renderRecentActivityPanel(locker) {
  const rows = state.activity.get(locker.id) || [];
  if (!state.account) return `<section class="panel recent-activity-panel"><div class="analytics-panel-head"><div><span class="action-eyebrow">Local wallet history</span><h2>Recent Activity</h2></div></div><div class="analytics-empty"><strong>Connect a wallet</strong><p class="analytics-empty-copy">Confirmed BoostHub transactions submitted through this DApp will appear here.</p></div></section>`;
  if (!rows.length) return `<section class="panel recent-activity-panel"><div class="analytics-panel-head"><div><span class="action-eyebrow">Local wallet history</span><h2>Recent Activity</h2></div></div><div class="analytics-empty"><strong>No recorded activity yet</strong><p class="analytics-empty-copy">Only real confirmed transactions submitted through this browser are shown. The DApp does not fabricate historical events.</p></div></section>`;
  const items = rows.slice(0, 6).map((row) => {
    const chain = Object.values(CHAINS).find((candidate) => candidate.chainId === Number(row.chainId));
    const sign = row.type === "withdraw" ? "−" : row.type === "deposit" ? "+" : "";
    const amount = row.amount && row.symbol ? `${sign}${escapeHtml(row.amount)} ${escapeHtml(row.symbol)}` : "Confirmed";
    const link = chain ? `${chain.explorer.baseUrl}/tx/${row.hash}` : "#";
    return `<a class="activity-row activity-${escapeAttribute(row.type)}" href="${escapeAttribute(link)}" target="_blank" rel="noreferrer"><span class="activity-icon" aria-hidden="true">${row.type === "withdraw" ? "↓" : row.type === "deposit" ? "↑" : "✓"}</span><span><strong>${escapeHtml(row.title)}</strong><small>${new Date(row.timestamp).toLocaleString()} · ${shortAddress(row.hash)}</small></span><em>${amount}</em></a>`;
  }).join("");
  return `<section class="panel recent-activity-panel"><div class="analytics-panel-head"><div><span class="action-eyebrow">Local wallet history</span><h2>Recent Activity</h2></div></div><div class="activity-list">${items}</div></section>`;
}

function renderLocker(id) {
  const locker = lockerById(id);
  state.activeLockerId = locker.id;
  const item = token(locker.token);
  const live = liveFor(locker);
  const wallet = live.wallet || {};
  const boosting = live.yieldBoostingTokens === null || live.yieldBoostingTokens === undefined
    ? displayOrError(live, "--", ["boostingResult", "topology"])
    : `${formatNumber(live.yieldBoostingTokens, 4)} ${live.yieldBoostingTokenSymbol || item.symbol}`;

  const boostDescription = "";
  const defaultAprDescription = "StakeDAO rate without vlSDT boost";
  const metrics = `${metric("Default APR", defaultAprText(live), defaultAprDescription, "locker-apr-metric")}
    ${metric("BoostHub APY", vaultApyText(live), "Estimated compounded vault return", "primary-yield-metric")}
    ${metric("Boost Multiplier", boostText(live), boostDescription, "boost-metric")}
    ${metric("Yield Boosting Tokens", boosting, "Donated and retained staking tokens", "boosting-token-metric")}`;

  app.innerHTML = `<section class="locker-detail white-locker-detail">
    ${renderTransactionStatus()}
    ${renderTransactionError(locker.id)}
    ${renderChainSwitchPrompt(locker)}
    <div class="detail-title white-detail-title"><div class="locker-identity">${tokenImg(locker.token, "xl")}<div><a class="back-link" href="#/">← Back to BoostHub</a><h1>${escapeHtml(item.symbol)} Locker</h1><p>Stake, boost, and compound your ${escapeHtml(item.symbol)} position.</p><div class="title-badges">${chainBadge(locker.chain)}<span class="data-status">${statusText(live)}</span></div></div></div></div>
    <div class="detail-metrics white-detail-metrics">${metrics}</div>
    ${renderActionModules(locker, wallet, live)}
    ${renderLockerRewardsSection(locker, live, wallet)}
    <section class="locker-insights-grid">${renderUserPosition(locker, wallet, live)}${renderYieldHistoryPanel(locker)}${renderRecentActivityPanel(locker)}</section>
    <section class="boosthub-trust-strip locker-trust-strip"><span class="trust-mark" aria-hidden="true">◇</span><div><strong>Non-custodial by design.</strong><p>All deposits and withdrawals execute directly against the configured BoostHub contracts.</p></div><a href="${DOCS_URL}" target="_blank" rel="noreferrer">Learn more ↗</a></section>
    ${renderContractSummary(locker, live)}
  </section>`;
}

function renderActionModules(locker, wallet, live) {
  return `<section class="action-layout">${renderActionModule(locker, wallet, "staking", live)}${renderActionModule(locker, wallet, "vault", live)}</section>`;
}

function actionFor(lockerId, target) {
  return getLockerActionState(state.actionState, lockerId, target);
}

function actionKey(locker, action, target = "") {
  return `${locker.id}:${target}:${action}`;
}

function isPending(key) {
  return state.pendingActions.has(key);
}

function allowanceFor(wallet, target) {
  return target === "staking" ? wallet.stakingAllowanceAmount || 0n : wallet.vaultAllowanceAmount || 0n;
}

function depositButtonLabel(locker, wallet, target) {
  const key = actionKey(locker, "deposit", target);
  if (isPending(key) || isPending(actionKey(locker, "approve", target))) return "Pending…";
  if (!state.account) return "Connect Wallet";
  const raw = actionFor(locker.id, target).input;
  if (!String(raw).trim()) return "Deposit";
  try {
    const amount = ethers.parseUnits(String(raw), token(locker.token).decimals);
    return amount > 0n && allowanceFor(wallet, target) < amount ? "Approve Unlimited" : "Review Deposit";
  } catch {
    return "Deposit";
  }
}

function withdrawButtonLabel(locker, target) {
  if (isPending(actionKey(locker, "withdraw", target))) return "Pending…";
  return state.account ? "Review Withdrawal" : "Connect Wallet";
}

function renderActionModule(locker, wallet, target, live) {
  const item = token(locker.token);
  const action = actionFor(locker.id, target);
  const isDeposit = action.mode === "deposit";
  const isStaking = target === "staking";
  const balance = isDeposit ? wallet.assetBalance : isStaking ? wallet.stakingBalance : wallet.vaultShares;
  const heldLabel = isStaking ? "Staked balance" : "Vault shares";
  const heldValue = isStaking ? wallet.stakingBalance || "--" : wallet.vaultShares || "--";
  const inputId = `${locker.id}-${target}-amount`;
  const panelId = `${locker.id}-${target}-panel`;
  const description = isStaking
    ? `Stake ${item.symbol} to earn distributed rewards and use BoostHub's delegated voting power.`
    : `Deposit ${item.symbol} into the CurveYield vault to auto-compound BoostHub rewards.`;
  const isVaultShareWithdrawal = !isDeposit && !isStaking;
  const amountLabel = isVaultShareWithdrawal ? "Vault shares to redeem" : isDeposit ? "Amount to deposit" : "Amount to withdraw";
  const unitLabel = isVaultShareWithdrawal ? "shares" : item.symbol;
  const estimatedUnderlying = isVaultShareWithdrawal && Number(action.input) > 0 && Number.isFinite(Number(live.pps))
    ? Number(action.input) * Number(live.pps)
    : null;
  const depositFlowPending = isPending(actionKey(locker, "deposit", target)) || isPending(actionKey(locker, "approve", target));

  return `<section id="${panelId}" class="action-module panel ${target}-module white-action-module" role="tabpanel" aria-labelledby="${locker.id}-${target}-${action.mode}-tab">
    <div class="panel-head action-head"><div class="action-title-row"><span class="action-step-number">${isStaking ? "1" : "2"}</span><div><h2>${isStaking ? "Staking" : "Compounding Vault"}</h2><p>${description}</p></div></div><span class="action-balance">Balance: <strong>${balance || "--"} ${unitLabel}</strong></span></div>
    <div class="mode-tabs" role="tablist" aria-label="${item.symbol} ${target} action">
      <button id="${locker.id}-${target}-deposit-tab" type="button" role="tab" aria-selected="${isDeposit}" aria-controls="${panelId}" data-mode="deposit" data-target="${target}" data-locker-id="${locker.id}" class="${isDeposit ? "active" : ""}">Deposit</button>
      <button id="${locker.id}-${target}-withdraw-tab" type="button" role="tab" aria-selected="${!isDeposit}" aria-controls="${panelId}" data-mode="withdraw" data-target="${target}" data-locker-id="${locker.id}" class="${!isDeposit ? "active" : ""}">Withdraw</button>
    </div>
    <div class="amount-row"><label for="${inputId}">${amountLabel}</label><div class="amount-box"><span class="token-select">${tokenImg(locker.token, "sm")} ${unitLabel}</span><input id="${inputId}" data-amount-input data-target="${target}" data-locker-id="${locker.id}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeAttribute(action.input)}" /><button type="button" data-action="max" data-target="${target}" data-locker-id="${locker.id}">MAX</button></div>
      <div class="balance-line"><span>${isDeposit ? "Wallet balance" : "Available"}: ${balance || "--"} ${unitLabel}</span><span>${heldLabel}: ${heldValue}</span></div>
      ${isVaultShareWithdrawal ? `<div class="withdraw-preview"><span>Estimated underlying received</span><strong>${estimatedUnderlying === null ? "--" : `${formatNumber(estimatedUnderlying, 6)} ${item.symbol}`}</strong></div>` : isStaking ? `<div class="withdraw-preview"><span>Estimated rewards</span><strong>${state.account ? "Based on current streamed APR" : "Connect wallet"}</strong></div>` : `<div class="withdraw-preview"><span>You will receive (est.)</span><strong>${Number(action.input) > 0 && Number.isFinite(Number(live.pps)) ? `${formatNumber(Number(action.input) / Number(live.pps), 6)} shares` : "--"}</strong></div>`}
    </div>
    <div class="action-buttons"><button class="primary-btn" type="button" data-action="${isDeposit ? "deposit" : "withdraw"}" data-target="${target}" data-locker-id="${locker.id}" ${(isDeposit ? depositFlowPending : isPending(actionKey(locker, "withdraw", target))) ? "disabled" : ""}>${isDeposit ? depositButtonLabel(locker, wallet, target) : withdrawButtonLabel(locker, target)}</button>${isStaking && state.account ? `<button class="secondary-btn" type="button" data-action="claim" data-target="${target}" data-locker-id="${locker.id}" ${isPending(actionKey(locker, "claim", target)) ? "disabled" : ""}>Claim Rewards</button>` : ""}</div>
  </section>`;
}

function renderStakingRewardsInline(locker, live, wallet) {
  const rows = claimRewardRows(locker, live).map((reward) => `<div class="reward-row"><div class="reward-token">${rewardImg(reward, "sm")}<strong>${escapeHtml(reward.symbol)}</strong></div><div><span>Distribution APR</span><strong>${rewardAprText(live, reward)}</strong></div><div><span>Claimable</span><strong>${wallet.claimable?.[reward.address] || "--"}</strong></div></div>`).join("");
  return `<div class="staking-rewards-inline"><h3>Staking Rewards</h3><div class="reward-list">${rows}</div></div>`;
}

function renderVaultMetricsInline(locker, live, wallet) {
  return `<div class="vault-metrics-inline"><h3>Vault Rewards</h3><div class="reward-list"><div class="reward-row"><div><span>BoostHub APY</span><strong>${vaultApyText(live)}</strong></div><div><span>PPS</span><strong>${displayOrError(live, formatNumber(live.pps, 6), ["reportedPpsRaw", "vaultBalanceRaw", "vaultSupplyRaw"])}</strong></div><div><span>Your underlying</span><strong>${wallet.vaultUnderlying || "--"}</strong></div></div></div></div>`;
}

function renderUserPosition(locker, wallet, live) {
  const item = token(locker.token);
  const position = calculateUserPosition({
    stakingBalance: wallet.stakingBalanceNumber,
    vaultUnderlying: wallet.vaultUnderlyingNumber,
    vaultShares: wallet.vaultSharesNumber,
    assetPriceUsd: live.assetPriceUsd,
  });
  const projection = projectPositionIncome(position.vaultValueUsd, live.vaultApyBps);
  const row = (label, value, detail = "") => `<div class="position-row"><span>${label}</span><div><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ""}</div></div>`;
  return `<section class="panel user-position-panel compact-position-panel"><div class="analytics-panel-head"><div><span class="action-eyebrow">Connected wallet</span><h2>Your Position</h2></div></div>
    <div class="position-list">
      ${row(`Staked ${escapeHtml(item.symbol)}`, wallet.stakingBalance ? `${wallet.stakingBalance} ${escapeHtml(item.symbol)}` : "--", formatUsd(position.stakingValueUsd))}
      ${row("Vault underlying", wallet.vaultUnderlying || "--", formatUsd(position.vaultValueUsd))}
      ${row("Vault shares", wallet.vaultShares || "--", wallet.vaultUnderlying ? `Backing: ${wallet.vaultUnderlying}` : "")}
      ${row("BoostHub APY", vaultApyText(live), "Current estimated compounded return")}
      ${row("Estimated daily earnings", formatUsd(projection.dailyUsd), "Based on current vault position")}
      ${row("Estimated weekly earnings", formatUsd(projection.weeklyUsd), "Based on current vault position")}
    </div>
  </section>`;
}

function adminAuthorizationLabel(data) {
  if (!state.account) return `<span class="auth-state neutral">Connect wallet</span>`;
  if (data?.authorized) return `<span class="auth-state allowed">Callable now</span>`;
  return `<span class="auth-state blocked">Blocked</span>`;
}

function renderPendingRewards(items = []) {
  if (!items.length) return `<div class="admin-empty">No pending reward data.</div>`;
  return `<div class="admin-reward-list">${items.map((reward) => `<div><span>${escapeHtml(reward.symbol)}</span><strong>${reward.amount === null ? "Unavailable" : formatNumber(reward.amount, 6)}</strong><em>${formatUsd(reward.valueUsd)}</em></div>`).join("")}</div>`;
}

function renderAdminCard(locker) {
  const item = token(locker.token);
  const chain = CHAINS[locker.chain];
  const live = liveFor(locker);
  const admin = state.adminData.get(locker.id) || {};
  const boostHubAddress = admin.boostHubAddress || live.topology?.boostHubAddress;
  const strategyAddress = admin.strategyAddress || live.topology?.strategyAddress || locker.strategyAddress;
  const pid = admin.pid ?? live.topology?.pid ?? locker.pid;
  const lastHarvest = admin.historyError
    ? `<span class="data-unavailable" aria-label="Harvest history unavailable">Unavailable</span>`
    : admin.lastHarvestAt ? new Date(admin.lastHarvestAt).toLocaleString() : "No recent harvest event";
  const lastHarvestAgo = admin.historyError ? "See Error Log" : admin.lastHarvestAt ? relativeTimeFrom(admin.lastHarvestAt) : "--";
  const vaultStatus = admin.vaultPaused === null || admin.vaultPaused === undefined ? `<span class="data-unavailable" aria-label="Vault status unavailable">Unavailable</span>` : admin.vaultPaused ? "Paused" : "Operational";
  const boostHubStatus = admin.boostHubPaused === null || admin.boostHubPaused === undefined ? `<span class="data-unavailable" aria-label="BoostHub status unavailable">Unavailable</span>` : admin.boostHubPaused ? "Paused" : "Operational";
  const vaultSelectKey = `${locker.id}:vault`;
  const boostSelectKey = `${locker.id}:boosthub`;
  const vaultAuthorized = Boolean(admin.vault?.authorized);
  const boostAuthorized = Boolean(admin.boostHub?.authorized);
  return `<section class="panel admin-card">
    <div class="panel-head"><div class="admin-identity">${tokenImg(locker.token, "lg")}<div><h2>${item.symbol}</h2><div class="title-badges">${chainBadge(locker.chain)}<span class="data-status">${statusText(live)}</span></div></div></div></div>
    <div class="admin-contracts">
      <div><span>Vault</span>${addressControl(chain, vaultAddressFor(locker), "Vault")}</div>
      <div><span>Strategy</span>${addressControl(chain, strategyAddress, "Strategy")}</div>
      <div><span>Staking</span>${addressControl(chain, locker.stakingAddress, "Staking")}</div>
      <div><span>BoostHub</span>${addressControl(chain, boostHubAddress, "BoostHub")}</div>
      <div><span>Pool ID</span><strong>${pid}</strong></div>
      <div><span>Last harvest activity</span><strong>${lastHarvest}</strong></div>
      <div><span>Time since last harvest</span><strong>${lastHarvestAgo}</strong></div>
      <div><span>Vault status</span><strong>${vaultStatus}</strong></div>
      <div><span>BoostHub status</span><strong>${boostHubStatus}</strong></div>
    </div>
    <div class="harvest-diagnostics-grid">
      <article class="harvest-diagnostic"><div class="harvest-heading"><label><input type="checkbox" data-admin-select="${vaultSelectKey}" ${state.adminSelection.has(vaultSelectKey) ? "checked" : ""} ${vaultAuthorized ? "" : "disabled"} /> Vault strategy</label>${adminAuthorizationLabel(admin.vault)}</div>
        <div class="harvest-stats"><span>Pending value <strong>${formatUsd(admin.vault?.pendingValueUsd)}</strong></span><span>Estimated gas <strong>${admin.vault?.gasEstimate ? formatNumber(admin.vault.gasEstimate, 0) : "--"}</strong></span></div>
        ${renderPendingRewards(admin.vault?.pendingRewards)}
        ${Object.keys(admin.vault?.errors || {}).length ? `<p class="diagnostic-error">One or more strategy reward reads failed. See Error Log.</p>` : ""}
        ${admin.vault?.reason ? `<p class="simulation-reason">${escapeHtml(admin.vault.reason)}</p>` : ""}
        <button class="primary-btn" type="button" data-action="harvest-vault" data-locker-id="${locker.id}" ${vaultAuthorized && !isPending(actionKey(locker, "harvest-vault")) ? "" : "disabled"}>${isPending(actionKey(locker, "harvest-vault")) ? "Pending…" : "Harvest Vault"}</button>
      </article>
      <article class="harvest-diagnostic"><div class="harvest-heading"><label><input type="checkbox" data-admin-select="${boostSelectKey}" ${state.adminSelection.has(boostSelectKey) ? "checked" : ""} ${boostAuthorized ? "" : "disabled"} /> BoostHub pool</label>${adminAuthorizationLabel(admin.boostHub)}</div>
        <div class="harvest-stats"><span>Pending value <strong>${formatUsd(admin.boostHub?.pendingValueUsd)}</strong></span><span>Estimated gas <strong>${admin.boostHub?.gasEstimate ? formatNumber(admin.boostHub.gasEstimate, 0) : "--"}</strong></span></div>
        <div class="admin-reward-group"><h4>Gauge rewards</h4>${renderPendingRewards(admin.boostHub?.pendingRewards)}</div>
        ${admin.boostHub?.voteIncentiveExecutor ? `<div class="admin-reward-group"><h4>Vote incentives / airdrops</h4>${renderPendingRewards(admin.boostHub?.voteIncentiveRewards)}</div>` : ""}
        ${admin.boostHub?.pendingError ? `<p class="diagnostic-error">Pending BoostHub rewards could not be read. See Error Log.</p>` : ""}
        ${admin.boostHub?.voteIncentiveError ? `<p class="diagnostic-error">StakeDAO vote-incentive rewards could not be read. See Error Log.</p>` : ""}
        ${admin.boostHub?.reason ? `<p class="simulation-reason">${escapeHtml(admin.boostHub.reason)}</p>` : ""}
        <button class="secondary-btn" type="button" data-action="harvest-boosthub" data-locker-id="${locker.id}" ${boostAuthorized && !isPending(actionKey(locker, "harvest-boosthub")) ? "" : "disabled"}>${isPending(actionKey(locker, "harvest-boosthub")) ? "Pending…" : "Harvest BoostHub"}</button>
      </article>
    </div>
  </section>`;
}

function renderBatchStatus() {
  if (!state.batchStatus.length) return "";
  return `<section class="panel batch-status"><h2>Batch progress</h2>${state.batchStatus.map((item) => `<div class="batch-status-row ${item.status}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.status)}</strong>${item.hash && CHAINS[item.chain] ? `<a href="${CHAINS[item.chain].explorer.baseUrl}/tx/${item.hash}" target="_blank" rel="noreferrer">Transaction</a>` : ""}</div>`).join("")}</section>`;
}

function formatDiagnosticTime(value) {
  return value ? new Date(Number(value)).toLocaleString() : "--";
}

function renderRpcStatus() {
  const status = liveClient.getRpcStatus();
  return `<section class="panel rpc-health-panel"><div class="panel-head"><div><span class="action-eyebrow">Session diagnostics</span><h2>RPC Health</h2><p>Endpoint details are shown only on Admin. Healthy endpoints rotate after five successful request groups and retire after four consecutive failures.</p></div><button class="small-btn" type="button" data-action="retest-rpc" ${isPending("global:rpc-retest") ? "disabled" : ""}>${isPending("global:rpc-retest") ? "Retesting…" : "Retest RPCs"}</button></div>${Object.entries(status).map(([chainKey, endpoints]) => `<div class="rpc-chain"><h3>${CHAINS[chainKey].name}</h3>${endpoints.map((endpoint) => {
    const statusLabel = endpoint.retired
      ? "Retired for session"
      : endpoint.active
        ? `Active · rotates in ${endpoint.successesUntilRotation} read${endpoint.successesUntilRotation === 1 ? "" : "s"}`
        : endpoint.next
          ? "Next endpoint"
          : `${endpoint.consecutiveFailures}/4 failures`;
    return `<div class="rpc-row ${endpoint.retired ? "retired" : endpoint.active ? "active current" : "active"}"><div><span>${escapeHtml(endpoint.url)}</span><small>Last success: ${escapeHtml(formatDiagnosticTime(endpoint.lastSuccessAt))} · Last failure: ${escapeHtml(formatDiagnosticTime(endpoint.lastFailureAt))}${endpoint.lastLatencyMs != null ? ` · ${escapeHtml(String(endpoint.lastLatencyMs))} ms` : ""}</small>${endpoint.lastError ? `<small class="rpc-error-reason">${escapeHtml(endpoint.lastError)}</small>` : ""}</div><strong>${escapeHtml(statusLabel)}</strong></div>`;
  }).join("")}</div>`).join("")}</section>`;
}

function renderCacheInspection() {
  const cache = state.cacheInspection;
  if (!cache) return "";
  const cacheRow = (label, value) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
  return `<div class="cache-inspection" aria-live="polite"><h3>Public snapshot cache</h3>${cacheRow("Freshest layer", cache.freshest)}${cacheRow("Local snapshot", cache.local.present ? `${cache.local.lockerCount} lockers · ${cache.local.savedAt ? new Date(cache.local.savedAt).toLocaleString() : "unknown time"}` : "Empty")}${cacheRow("IndexedDB snapshot", cache.indexed.present ? `${cache.indexed.lockerCount} lockers · ${cache.indexed.savedAt ? new Date(cache.indexed.savedAt).toLocaleString() : "unknown time"}` : "Empty")}</div>`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let scaled = bytes;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1; }
  return `${scaled.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function renderStorageHealth() {
  const health = state.storageHealth;
  const diagnostics = health?.diagnostics || getStorageDiagnostics();
  const rows = diagnostics.length ? diagnostics.slice(0, 20).map((entry) => `<article class="storage-diagnostic-row"><div><strong>${escapeHtml(entry.subsystem)} · ${escapeHtml(entry.operation)}</strong><span>${new Date(entry.timestamp).toLocaleString()}</span></div><p>${escapeHtml(entry.name)}: ${escapeHtml(entry.message)}</p><small>${escapeHtml(entry.store || "browser storage")} · ${escapeHtml(entry.keyCategory || "general")} · ${escapeHtml(entry.outcome || "failed")}</small></article>`).join("") : `<div class="admin-empty">No storage failures recorded in this browser.</div>`;
  return `<section class="panel storage-health-panel"><div class="panel-head"><div><span class="action-eyebrow">Browser persistence</span><h2>Storage Health</h2><p>Quota, availability, private-mode restrictions, blocked access, and fallback events.</p></div><button type="button" class="small-btn" data-action="inspect-storage">Refresh storage data</button></div><div class="storage-health-grid"><div><span>IndexedDB</span><strong>${health ? (health.indexedDbAvailable ? "Available" : "Unavailable") : "Checking…"}</strong></div><div><span>localStorage</span><strong>${health ? (health.localStorageAvailable ? "Available" : "Unavailable") : "Checking…"}</strong></div><div><span>Persistent storage</span><strong>${health?.persisted == null ? "Unknown" : health.persisted ? "Granted" : "Not granted"}</strong></div><div><span>Estimated usage</span><strong>${formatBytes(health?.usage)} / ${formatBytes(health?.quota)}</strong></div></div><div class="storage-diagnostic-list">${rows}</div></section>`;
}

function contractFilterOptions() {
  const entries = [];
  for (const locker of LOCKERS.filter((item) => !item.hidden)) {
    const symbol = token(locker.token).symbol;
    const values = [
      ["Staking", locker.stakingAddress], ["Vault", vaultAddressFor(locker)], ["Strategy", locker.strategyAddress],
      ["BoostHub", locker.boostHubAddress], ["Gauge", locker.gaugeAddress],
    ];
    for (const [kind, address] of values) if (address && !entries.some((entry) => entry.address.toLowerCase() === address.toLowerCase())) entries.push({ label: `${symbol} ${kind} · ${shortAddress(address)}`, address });
  }
  return entries;
}

function lockerHasProblem(locker) {
  const live = liveFor(locker);
  const admin = state.adminData.get(locker.id) || {};
  return ["partial", "error", "stale"].includes(live.status)
    || Object.keys(live.fieldErrors || {}).length > 0
    || Boolean(admin.historyError || admin.boostHub?.pendingError || Object.keys(admin.vault?.errors || {}).length || admin.vaultPaused || admin.boostHubPaused);
}

function lockerMatchesAdminFilters(locker) {
  const filters = state.diagnosticFilters;
  if (filters.chain !== "all" && locker.chain !== filters.chain) return false;
  if (filters.status === "healthy" && lockerHasProblem(locker)) return false;
  if (filters.status === "problem" && !lockerHasProblem(locker)) return false;
  if (filters.contractAddress !== "all") {
    const target = filters.contractAddress.toLowerCase();
    const addresses = [locker.stakingAddress, vaultAddressFor(locker), locker.strategyAddress, locker.boostHubAddress, locker.gaugeAddress].filter(Boolean).map((value) => value.toLowerCase());
    if (!addresses.includes(target)) return false;
  }
  return true;
}

function renderAdminFilters() {
  const filters = state.diagnosticFilters;
  const chainOptions = [{ value: "all", label: "All" }, ...[...new Set(LOCKERS.filter((locker) => !locker.hidden).map((locker) => locker.chain))].map((chain) => ({ value: chain, label: CHAINS[chain].name }))];
  const options = (items, selected) => items.map((item) => `<option value="${escapeAttribute(item.value)}" ${item.value === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  const contracts = [{ value: "all", label: "All BoostHub contracts" }, ...contractFilterOptions().map((entry) => ({ value: entry.address, label: entry.label }))];
  return `<form class="admin-filters" data-diagnostic-filter-form><label>Chain<select name="chain">${options(chainOptions, filters.chain)}</select></label><label>Status<select name="status">${options([{ value: "all", label: "All" }, { value: "healthy", label: "Healthy" }, { value: "problem", label: "Problem" }], filters.status)}</select></label><label>Contract<select name="contractAddress">${options(contracts, filters.contractAddress)}</select></label><label>Transaction hash<input name="transactionHash" type="search" value="${escapeAttribute(filters.transactionHash)}" placeholder="0x…" pattern="0x[0-9a-fA-F]{0,64}" /></label><div class="diagnostic-filter-actions"><button class="small-btn" type="submit">Apply</button><button class="small-btn" type="button" data-action="reset-diagnostic-filters">Reset</button></div></form>`;
}

function renderOccurrenceTimeline(entry) {
  const occurrences = Array.isArray(entry.occurrences) ? entry.occurrences : [];
  if (Number(entry.count || 1) <= 1 || !occurrences.length) return "";
  return `<details class="occurrence-timeline"><summary>${entry.count} occurrences · view recent timeline</summary><ol>${occurrences.map((timestamp) => `<li><time datetime="${new Date(timestamp).toISOString()}">${new Date(timestamp).toLocaleString()}</time></li>`).join("")}</ol>${entry.count > occurrences.length ? `<p>${entry.count - occurrences.length} older occurrences are summarized in the count.</p>` : ""}</details>`;
}

function renderDeveloperErrors() {
  const filtered = filterErrorEntries(state.errorLog, state.diagnosticFilters);
  const pagination = paginateEntries(filtered, { page: state.diagnosticPage, pageSize: state.diagnosticPageSize });
  state.diagnosticPage = pagination.page;
  const entries = pagination.items.length ? pagination.items.map((entry) => {
    const safe = redactDiagnosticRecord(entry);
    return `<article class="error-log-entry"><div class="error-log-entry-head"><strong>${escapeHtml(safe.action)}${safe.count > 1 ? ` ×${safe.count}` : ""}</strong><span>${new Date(safe.timestamp).toLocaleString()}</span><button class="small-btn diagnostic-inline-action" type="button" data-copy-error-id="${escapeAttribute(safe.id)}">Copy</button></div><p>${escapeHtml(safe.message)}</p><dl><dt>Scope</dt><dd>${escapeHtml(safe.scope || "unknown")}</dd><dt>Locker</dt><dd>${escapeHtml(safe.lockerId || "global")}</dd><dt>Chain</dt><dd>${escapeHtml(safe.chain || "--")}</dd><dt>Contract</dt><dd>${safe.contractAddress ? escapeHtml(shortAddress(safe.contractAddress)) : "--"}</dd><dt>Code</dt><dd>${escapeHtml(safe.code || "--")}</dd><dt>Reason</dt><dd>${escapeHtml(safe.reason || "--")}</dd></dl>${renderOccurrenceTimeline(safe)}${safe.details ? `<details><summary>Technical details</summary><pre>${escapeHtml(safe.details)}</pre></details>` : ""}${safe.transactionHash && safe.chain && CHAINS[safe.chain] ? `<a class="diagnostic-link" href="${CHAINS[safe.chain].explorer.baseUrl}/tx/${safe.transactionHash}" target="_blank" rel="noreferrer">Open transaction</a>` : ""}</article>`;
  }).join("") : `<div class="admin-empty">No errors match these filters.</div>`;
  return `<section class="panel developer-log"><div class="panel-head developer-log-head"><div><span class="action-eyebrow">Developer diagnostics</span><h2>Error Log</h2><p>Redacted data, RPC, wallet, simulation, storage, and transaction failures from this browser.</p></div><div class="diagnostic-primary-actions"><button class="small-btn" type="button" data-action="copy-diagnostics">Copy diagnostics</button><button class="small-btn" type="button" data-action="export-diagnostics">Export JSON</button><button class="small-btn" type="button" data-action="clear-errors">Clear Log</button></div></div>
    <div class="diagnostic-tools"><button class="small-btn" type="button" data-action="inspect-cache">Inspect cache</button><button class="small-btn" type="button" data-action="clear-cache">Clear public cache</button><button class="small-btn" type="button" data-action="retry-reads" ${isPending("global:retry-reads") ? "disabled" : ""}>${isPending("global:retry-reads") ? "Retrying…" : "Retry safe reads"}</button><span class="diagnostic-result-count">${filtered.length} of ${state.errorLog.length} records</span></div>
    ${renderCacheInspection()}
    <div class="error-log-list">${entries}</div>
    <div class="diagnostic-pagination"><label>Records per page<select data-diagnostic-page-size>${DIAGNOSTIC_PAGE_SIZES.map((size) => `<option value="${size}" ${size === pagination.pageSize ? "selected" : ""}>${size}</option>`).join("")}</select></label><span>Page ${pagination.page} of ${pagination.totalPages}</span><div><button type="button" class="small-btn" data-action="diagnostic-prev" ${pagination.page <= 1 ? "disabled" : ""}>Previous</button><button type="button" class="small-btn" data-action="diagnostic-next" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next</button></div></div>
  </section>`;
}

function renderAdmin() {
  const visibleLockers = LOCKERS.filter((locker) => !locker.hidden && lockerMatchesAdminFilters(locker));
  const cards = visibleLockers.length ? visibleLockers.map(renderAdminCard).join("") : `<div class="admin-empty panel">No lockers match the selected filters.</div>`;
  app.innerHTML = `<section class="admin-page">
    ${renderTransactionStatus()}
    ${renderTransactionError()}
    <div class="page-title admin-title"><div><a class="back-link" href="#/">‹ Back to BoostHub</a><h1>Admin</h1><p>Harvest diagnostics are public. Transaction buttons are enabled only when the connected account can successfully simulate the call.</p></div><div class="admin-toolbar"><button class="primary-btn" type="button" data-action="batch-harvest" ${state.adminSelection.size && !isPending("global:batch") ? "" : "disabled"}>${isPending("global:batch") ? "Batch running…" : `Harvest Selected (${state.adminSelection.size})`}</button><button class="small-btn" type="button" data-action="refresh-admin" ${isPending("global:admin-refresh") ? "disabled" : ""}>Refresh diagnostics</button></div></div>
    ${renderAdminFilters()}
    ${renderBatchStatus()}
    <div class="admin-grid">${cards}</div>
    ${renderRpcStatus()}
    ${renderStorageHealth()}
    ${renderDeveloperErrors()}
  </section>`;
}

async function loadRemoteHistory(lockerId, range = historyRangeFor(lockerId), { force = false } = {}) {
  const key = `${lockerId}:${range}`;
  if (!force && state.remoteYieldHistory.has(key)) return state.remoteYieldHistory.get(key);
  if (state.historyFetches.has(key)) return state.historyFetches.get(key);
  const promise = fetchIndexerHistory(lockerId, range).then((rows) => {
    state.remoteYieldHistory.set(key, rows);
    if (getRoute().page === "locker" && getRoute().id === lockerId && historyRangeFor(lockerId) === range) render();
    return rows;
  }).finally(() => state.historyFetches.delete(key));
  state.historyFetches.set(key, promise);
  return promise;
}

function render() {
  const route = getRoute();
  if (route.page === "locker") renderLocker(route.id);
  else if (route.page === "admin") renderAdmin();
  else renderOverview();
  bindPageEvents();
  updateWalletHeader();
  updateSidebarSummary();
}

function bindPageEvents() {
  app.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    updateLockerActionState(state.actionState, button.dataset.lockerId, button.dataset.target, { mode: button.dataset.mode });
    render();
  }));
  app.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action, button.dataset.target, button.dataset.lockerId)));
  app.querySelectorAll("[data-amount-input]").forEach((input) => input.addEventListener("input", () => {
    updateLockerActionState(state.actionState, input.dataset.lockerId, input.dataset.target, { input: input.value });
    updateActionButtonLabels(input.dataset.lockerId);
  }));
  app.querySelectorAll("[data-copy-address]").forEach((button) => button.addEventListener("click", () => copyAddress(button.dataset.copyAddress)));
  app.querySelectorAll("[data-history-range]").forEach((button) => button.addEventListener("click", async () => {
    const lockerId = button.dataset.lockerId;
    const range = button.dataset.historyRange;
    state.yieldRange.set(lockerId, range);
    render();
    await loadRemoteHistory(lockerId, range);
  }));
  app.querySelectorAll("[data-copy-error-id]").forEach((button) => button.addEventListener("click", () => copyDiagnosticError(button.dataset.copyErrorId)));
  app.querySelector("[data-diagnostic-filter-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.diagnosticFilters = {
      chain: String(form.get("chain") || "all"),
      status: String(form.get("status") || "all"),
      contractAddress: String(form.get("contractAddress") || "all"),
      transactionHash: String(form.get("transactionHash") || "").trim(),
    };
    state.diagnosticPage = 1;
    render();
  });
  app.querySelector("[data-diagnostic-page-size]")?.addEventListener("change", (event) => {
    state.diagnosticPageSize = Number(event.currentTarget.value);
    state.diagnosticPage = 1;
    render();
  });
  app.querySelectorAll("[data-admin-select]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.adminSelection.add(checkbox.dataset.adminSelect); else state.adminSelection.delete(checkbox.dataset.adminSelect);
    render();
  }));
  app.querySelectorAll('[role="tab"]').forEach((tab) => tab.addEventListener("keydown", handleTabKeyboard));
}

function handleTabKeyboard(event) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = [...event.currentTarget.parentElement.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(event.currentTarget);
  const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

async function copyAddress(address) {
  try {
    await navigator.clipboard.writeText(address);
    notify("Contract address copied.", "success");
  } catch {
    notify("Could not copy the address. Select it manually.", "error");
  }
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    notify(successMessage, "success");
    return true;
  } catch {
    notify("Could not access the clipboard. Export the diagnostics instead.", "error");
    return false;
  }
}

function diagnosticMetadata() {
  return {
    route: getRoute(),
    generatedAt: Date.now(),
    appVersion: "v11",
    wallet: state.walletInfo ? { name: state.walletInfo.name, rdns: state.walletInfo.rdns } : null,
    walletChainId: state.walletChainId,
    rpcStatus: liveClient.getRpcStatus(),
    cacheInspection: state.cacheInspection,
    userAgent: navigator.userAgent,
  };
}

function diagnosticPayload(entries = state.errorLog) {
  return diagnosticExport(entries, { metadata: diagnosticMetadata(), maxEntries: 100 });
}

async function copyDiagnosticError(id) {
  const entry = state.errorLog.find((candidate) => candidate.id === id);
  if (!entry) return notify("That diagnostic record is no longer available.", "error");
  await copyText(JSON.stringify(redactDiagnosticRecord(entry), null, 2), "Diagnostic record copied.");
}

function downloadTextFile(text, filename, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportDiagnostics() {
  downloadTextFile(diagnosticPayload(), `curveyield-boosthub-diagnostics-v11-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  notify("Redacted diagnostics exported.", "success");
}

function updateActionButtonLabels(lockerId) {
  const locker = lockerById(lockerId);
  const wallet = liveFor(locker).wallet || {};
  app.querySelectorAll(`.primary-btn[data-action="deposit"][data-locker-id="${locker.id}"]`).forEach((button) => { button.textContent = depositButtonLabel(locker, wallet, button.dataset.target || "staking"); });
}

function setMaxAmount(locker, target) {
  const wallet = liveFor(locker).wallet || {};
  const action = actionFor(locker.id, target);
  const value = action.mode === "deposit" ? wallet.assetBalanceRaw || "" : target === "staking" ? wallet.stakingBalanceRaw || "" : wallet.vaultSharesRaw || "";
  updateLockerActionState(state.actionState, locker.id, target, { input: value });
  render();
}

function amountFromState(locker, target) {
  return parseInputAmount(actionFor(locker.id, target).input, token(locker.token).decimals);
}

function registerWalletProvider(detail) {
  if (!detail?.provider) return;
  const key = detail.info?.uuid || detail.info?.rdns || detail.info?.name || `wallet-${state.walletProviders.size}`;
  state.walletProviders.set(key, { info: { name: detail.info?.name || "Browser Wallet", icon: detail.info?.icon || "", rdns: detail.info?.rdns || "", uuid: key }, provider: detail.provider });
  if (!walletModal.hidden) renderWalletModal();
}

function discoverWallets() {
  window.addEventListener("eip6963:announceProvider", (event) => registerWalletProvider(event.detail));
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  if (window.ethereum) registerWalletProvider({ info: { name: "Browser Wallet", rdns: "legacy.injected", uuid: "legacy-injected" }, provider: window.ethereum });
}

function mobileWalletLinks() {
  const currentUrl = window.location.href;
  const metamaskTarget = currentUrl.replace(/^https?:\/\//, "");
  return `<div class="wallet-mobile-links"><a href="https://metamask.app.link/dapp/${escapeAttribute(metamaskTarget)}" target="_blank" rel="noreferrer">Open in MetaMask</a><a href="https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(currentUrl)}" target="_blank" rel="noreferrer">Open in Coinbase Wallet</a></div>`;
}

function walletConnectDescription() {
  if (!RUNTIME_CONFIG.walletConnectProjectId) return "Setup required: add the public Reown project ID in src-v11/runtime-config.js.";
  if (state.walletConnectStatus === "loading") return "Opening secure QR and mobile pairing…";
  if (state.walletConnectStatus === "error") return state.walletConnectError || "WalletConnect could not start.";
  return "Scan a QR code or open a compatible mobile wallet.";
}

function renderWalletModal() {
  const providers = [...state.walletProviders.entries()];
  const injectedOptions = providers.length
    ? providers.map(([key, entry]) => `<button type="button" class="wallet-option" data-wallet-key="${escapeAttribute(key)}">${entry.info.icon ? `<img src="${escapeAttribute(entry.info.icon)}" alt="" />` : `<span class="wallet-fallback">W</span>`}<span><strong>${escapeHtml(entry.info.name)}</strong><small>${escapeHtml(entry.info.rdns || "Injected wallet")}</small></span></button>`).join("")
    : `<div class="wallet-empty"><p>No injected wallet was found in this browser.</p><div class="wallet-install-links"><a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a><a href="https://rabby.io/" target="_blank" rel="noreferrer">Rabby</a><a href="https://www.coinbase.com/wallet/downloads" target="_blank" rel="noreferrer">Coinbase Wallet</a></div></div>`;
  const walletConnectClass = state.walletConnectStatus === "error" ? "has-error" : "";
  walletModal.innerHTML = `<section class="modal-card wallet-modal-card" role="dialog" aria-modal="true" aria-labelledby="walletModalTitle" tabindex="-1"><button class="modal-close" type="button" data-wallet-close aria-label="Close wallet chooser">×</button><span class="action-eyebrow">Wallet connection</span><h2 id="walletModalTitle">Choose a wallet</h2><div class="wallet-options">${injectedOptions}<button type="button" class="wallet-option walletconnect-option ${walletConnectClass}" data-walletconnect ${state.walletConnectStatus === "loading" ? "disabled" : ""}><span class="wallet-fallback walletconnect-mark" aria-hidden="true">WC</span><span><strong>${state.walletConnectStatus === "loading" ? "Opening WalletConnect…" : "WalletConnect"}</strong><small>${escapeHtml(walletConnectDescription())}</small></span></button></div>${mobileWalletLinks()}<p class="modal-note">Injected EIP-6963 wallets are detected automatically. WalletConnect v2 requires a public Reown project ID configured before deployment.</p></section>`;
  walletModal.querySelectorAll("[data-wallet-key]").forEach((button) => button.addEventListener("click", () => connectWalletProvider(state.walletProviders.get(button.dataset.walletKey), { requestAccounts: true }).catch((error) => recordError(error, { action: "connect-wallet", scope: "wallet" }))));
  walletModal.querySelector("[data-walletconnect]")?.addEventListener("click", () => connectWalletConnect());
  walletModal.querySelector("[data-wallet-close]")?.addEventListener("click", closeWalletModal);
}

function openWalletModal(trigger = document.activeElement) {
  state.walletConnectError = null;
  if (state.walletConnectStatus === "error") state.walletConnectStatus = "idle";
  renderWalletModal();
  walletModal.hidden = false;
  walletModalFocus.open(trigger);
}

function closeWalletModal() {
  const wasOpen = !walletModal.hidden;
  walletModal.hidden = true;
  walletModal.innerHTML = "";
  if (wasOpen) walletModalFocus.close();
}

async function getWalletConnectAdapter() {
  if (walletConnectAdapter) return walletConnectAdapter;
  if (!walletConnectLoadPromise) {
    walletConnectLoadPromise = loadWalletConnectEthereumProvider({ scriptUrls: RUNTIME_CONFIG.walletConnectScriptUrls }).catch((error) => {
      walletConnectLoadPromise = null;
      throw error;
    });
  }
  const EthereumProvider = await walletConnectLoadPromise;
  walletConnectAdapter = createWalletConnectAdapter({
    EthereumProvider,
    projectId: RUNTIME_CONFIG.walletConnectProjectId,
    chains: Object.values(CHAINS),
    metadata: RUNTIME_CONFIG.walletConnectMetadata,
  });
  return walletConnectAdapter;
}

async function connectWalletConnect() {
  state.walletConnectStatus = "loading";
  state.walletConnectError = null;
  renderWalletModal();
  try {
    if (!RUNTIME_CONFIG.walletConnectProjectId) throw new Error("WalletConnect setup is incomplete. Add a public Reown project ID in src-v11/runtime-config.js before deployment.");
    const adapter = await getWalletConnectAdapter();
    const provider = await adapter.connect();
    await connectWalletProvider({ info: { name: "WalletConnect", rdns: "walletconnect", uuid: "walletconnect-v2" }, provider }, { requestAccounts: false });
    state.walletConnectStatus = "connected";
  } catch (error) {
    state.walletConnectStatus = "error";
    state.walletConnectError = String(error?.shortMessage || error?.message || error);
    if (!walletModal.hidden) renderWalletModal();
    await recordError(error, { action: "connect-walletconnect", scope: "wallet" }, { renderNow: false });
  }
}

function clearConnectedWallet({ renderNow = true } = {}) {
  state.account = null;
  state.signer = null;
  state.provider = null;
  state.walletEip1193 = null;
  state.walletInfo = null;
  state.walletChainId = null;
  state.transactionStatus = null;
  state.activity.clear();
  updateWalletHeader();
  if (renderNow) render();
}

async function loadRecentActivityForLocker(locker) {
  if (!state.account) {
    state.activity.delete(locker.id);
    return [];
  }
  const rows = await readActivity({ account: state.account, chainId: locker.chainId, lockerId: locker.id, limit: 20 });
  state.activity.set(locker.id, rows);
  return rows;
}

async function loadRecentActivityForAccount() {
  if (!state.account) {
    state.activity.clear();
    return;
  }
  await Promise.allSettled(LOCKERS.filter((locker) => !locker.hidden).map(loadRecentActivityForLocker));
}

async function connectWalletProvider(entry, { requestAccounts = true } = {}) {
  if (!entry?.provider) throw new Error("No wallet provider found.");
  const browserProvider = new ethers.BrowserProvider(entry.provider);
  const accounts = await browserProvider.send(requestAccounts ? "eth_requestAccounts" : "eth_accounts", []);
  if (!accounts.length) {
    if (requestAccounts) throw new Error("The wallet did not return an account.");
    return false;
  }
  state.walletEip1193 = entry.provider;
  state.walletInfo = entry.info;
  state.provider = browserProvider;
  state.signer = await browserProvider.getSigner(accounts[0]);
  state.account = accounts[0];
  state.walletChainId = Number((await browserProvider.getNetwork()).chainId);
  bindWalletProviderEvents(entry.provider);
  closeWalletModal();
  updateWalletHeader();
  render();
  await promptWalletChainForRoute();
  await Promise.all([refreshWalletData(), loadRecentActivityForAccount()]);
  render();
  notify(`${entry.info?.name || "Wallet"} connected.`, "success");
  if (getRoute().page === "admin") await refreshAdminData({ force: true });
  const intent = state.pendingIntent;
  state.pendingIntent = null;
  if (intent) await handleAction(intent.action, intent.target, intent.lockerId);
  return true;
}

function bindWalletProviderEvents(provider) {
  if (state.boundWalletProviders.has(provider) || !provider?.on) return;
  state.boundWalletProviders.add(provider);
  provider.on("accountsChanged", async (accounts) => {
    if (!accounts.length) {
      clearConnectedWallet();
      return;
    }
    state.account = accounts[0];
    state.provider = new ethers.BrowserProvider(provider);
    state.signer = await state.provider.getSigner(accounts[0]);
    state.walletChainId = Number((await state.provider.getNetwork()).chainId);
    await Promise.all([refreshWalletData(), loadRecentActivityForAccount()]);
    updateWalletHeader();
    render();
  });
  provider.on("chainChanged", async (chainIdHex) => {
    state.provider = new ethers.BrowserProvider(provider);
    state.walletChainId = Number(chainIdHex);
    if (state.account) state.signer = await state.provider.getSigner(state.account).catch(() => null);
    updateWalletHeader();
    await refreshWalletData([state.activeLockerId]);
    render();
    await promptWalletChainForRoute();
  });
  provider.on("disconnect", () => {
    clearConnectedWallet();
    notify("Wallet disconnected.", "info");
  });
}

async function attemptAutoReconnect() {
  const entries = [...state.walletProviders.values()];
  for (const entry of entries) {
    try {
      const accounts = await entry.provider.request({ method: "eth_accounts" });
      if (accounts?.length) {
        await connectWalletProvider(entry, { requestAccounts: false });
        return true;
      }
    } catch {
      // Try another discovered provider.
    }
  }
  if (RUNTIME_CONFIG.walletConnectProjectId) {
    try {
      const adapter = await getWalletConnectAdapter();
      const provider = await adapter.reconnect();
      if (provider) {
        await connectWalletProvider({ info: { name: "WalletConnect", rdns: "walletconnect", uuid: "walletconnect-v2" }, provider }, { requestAccounts: false });
        state.walletConnectStatus = "connected";
        return true;
      }
    } catch (error) {
      state.walletConnectStatus = "error";
      state.walletConnectError = String(error?.shortMessage || error?.message || error);
      await recordError(error, { action: "reconnect-walletconnect", scope: "wallet" }, { showOnPage: false, notifyUser: false, renderNow: false });
    }
  }
  updateWalletHeader();
  return false;
}

function updateWalletHeader() {
  const label = connectWalletButton.querySelector("span:last-child");
  if (!state.account) {
    label.textContent = "Connect Wallet";
    connectWalletButton.classList.remove("connected");
    networkIndicator.textContent = "No wallet";
    networkIndicator.dataset.state = "disconnected";
    return;
  }
  label.textContent = shortAddress(state.account);
  connectWalletButton.classList.add("connected");
  const chainEntry = Object.values(CHAINS).find((chain) => chain.chainId === state.walletChainId);
  networkIndicator.textContent = chainEntry ? chainEntry.name : `Unsupported chain ${state.walletChainId}`;
  networkIndicator.dataset.state = chainEntry ? "connected" : "unsupported";
}

async function promptWalletChainForRoute() {
  if (!state.account || !state.walletEip1193) return false;
  const route = getRoute();
  if (route.page !== "locker") return false;
  const locker = lockerById(route.id);
  const target = CHAINS[locker.chain];
  if (state.walletChainId === target.chainId) return true;
  const key = `${String(state.account).toLowerCase()}:${locker.id}:${target.chainId}`;
  if (state.autoSwitchPrompts.has(key)) return false;
  state.autoSwitchPrompts.add(key);
  try {
    await ensureWalletChain(target);
    render();
    return true;
  } catch (error) {
    await recordError(error, { action: "automatic-chain-switch", lockerId: locker.id, chain: locker.chain, scope: "wallet" }, { showOnPage: false, notifyUser: false });
    return false;
  }
}

async function ensureWalletChain(chain) {
  if (!state.walletEip1193) throw new Error("Connect a wallet first.");
  if (state.walletChainId === chain.chainId) return;
  const chainId = `0x${chain.chainId.toString(16)}`;
  try {
    await state.walletEip1193.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await state.walletEip1193.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls, blockExplorerUrls: [chain.explorer.baseUrl] }] });
  }
  state.provider = new ethers.BrowserProvider(state.walletEip1193);
  state.walletChainId = Number((await state.provider.getNetwork()).chainId);
  if (state.walletChainId !== chain.chainId) throw new Error(`Wallet remained on chain ${state.walletChainId}; ${chain.name} is required.`);
  state.signer = await state.provider.getSigner(state.account);
  updateWalletHeader();
}

function renderConfirmationModal() {
  const confirmation = state.confirmation;
  if (!confirmation) {
    confirmationModal.hidden = true;
    confirmationModal.innerHTML = "";
    return;
  }
  confirmationModal.innerHTML = `<section class="modal-card confirmation-card" role="dialog" aria-modal="true" aria-labelledby="confirmationTitle" tabindex="-1"><button class="modal-close" type="button" data-confirm-cancel aria-label="Cancel transaction">×</button><span class="action-eyebrow">Transaction confirmation</span><h2 id="confirmationTitle">${escapeHtml(confirmation.title)}</h2><div class="confirmation-summary">${confirmation.rows.map((row) => `<div><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`).join("")}</div>${confirmation.warning ? `<div class="confirmation-warning">${escapeHtml(confirmation.warning)}</div>` : ""}<div class="modal-actions"><button class="secondary-btn" type="button" data-confirm-cancel>Cancel</button><button class="primary-btn" type="button" data-confirm-submit>${escapeHtml(confirmation.confirmLabel || "Confirm")}</button></div></section>`;
  confirmationModal.hidden = false;
  confirmationModal.querySelectorAll("[data-confirm-cancel]").forEach((button) => button.addEventListener("click", closeConfirmation));
  confirmationModal.querySelector("[data-confirm-submit]")?.addEventListener("click", async () => {
    const execute = confirmation.execute;
    closeConfirmation();
    try { await execute(); } catch (error) { await recordError(error, confirmation.errorContext || { action: "transaction" }); }
  });
}

function requestConfirmation(options) {
  state.confirmation = options;
  renderConfirmationModal();
  confirmationModalFocus.open(document.activeElement);
  queueMicrotask(() => confirmationModal.querySelector("[data-confirm-submit]")?.focus());
}

function closeConfirmation() {
  const wasOpen = !confirmationModal.hidden;
  state.confirmation = null;
  renderConfirmationModal();
  if (wasOpen) confirmationModalFocus.close();
}

async function recordError(error, context = {}, options = {}) {
  const showOnPage = options.showOnPage ?? true;
  const notifyUser = options.notifyUser ?? showOnPage;
  const renderNow = options.renderNow ?? true;
  const normalized = normalizeAppError(error, context);
  state.errorLog = appendErrorLog(state.errorLog, normalized, 1000);
  await persistErrorLog(state.errorLog);
  if (showOnPage && normalized.scope !== "data") state.lastTransactionError = normalized;
  console.error(error);
  if (notifyUser) notify(normalized.message, "error");
  if (renderNow) render();
  return normalized;
}

async function recordDataErrors(locker, fieldErrors = {}) {
  for (const [field, message] of Object.entries(fieldErrors)) {
    await recordError(
      new Error(message),
      { action: `read-${field}`, lockerId: locker.id, chain: locker.chain, scope: "data", contractAddress: locker.stakingAddress, details: message },
      { showOnPage: false, notifyUser: false, renderNow: false },
    );
  }
}

async function withPending(key, operation) {
  if (state.pendingActions.has(key)) return null;
  state.pendingActions.add(key);
  render();
  try { return await operation(); }
  finally { state.pendingActions.delete(key); render(); }
}

async function submitTransaction({ locker, key, title, send, afterSuccess, activity = null }) {
  return withPending(key, async () => {
    state.lastTransactionError = null;
    state.transactionStatus = { status: "awaiting-wallet", title, message: "Confirm this transaction in your wallet.", chain: locker.chain };
    render();
    const transaction = await send();
    state.transactionStatus = { status: "pending", title, message: "Submitted and waiting for confirmation.", chain: locker.chain, hash: transaction.hash };
    render();
    const receipt = await transaction.wait();
    const confirmedHash = receipt?.hash || transaction.hash;
    state.transactionStatus = { status: "confirmed", title, message: "Confirmed on-chain.", chain: locker.chain, hash: confirmedHash };
    notify(`${title} confirmed.`, "success");
    if (afterSuccess) await afterSuccess(receipt);
    if (activity && state.account) {
      await recordActivity({ ...activity, account: state.account, chainId: locker.chainId, lockerId: locker.id, hash: confirmedHash, title, timestamp: Date.now() });
      await loadRecentActivityForLocker(locker);
    }
    await refreshRelevantLocker(locker);
    return receipt;
  });
}

async function prepareDeposit(locker, target) {
  const amount = amountFromState(locker, target);
  const item = token(locker.token);
  const input = actionFor(locker.id, target).input;
  const wallet = liveFor(locker).wallet || {};
  const spender = target === "staking" ? locker.stakingAddress : vaultAddressFor(locker);
  if (allowanceFor(wallet, target) < amount) {
    requestConfirmation({
      title: `Approve ${item.symbol}`,
      rows: [
        { label: "Chain", value: CHAINS[locker.chain].name },
        { label: "Token", value: item.symbol },
        { label: "Action", value: target === "staking" ? "Authorize staking deposits" : "Authorize vault deposits" },
      ],
      confirmLabel: "Approve Unlimited",
      errorContext: { action: "approve", lockerId: locker.id, chain: locker.chain },
      execute: () => submitTransaction({
        locker,
        key: actionKey(locker, "approve", target),
        title: `${item.symbol} approval`,
        send: () => contract(item.address, ERC20_ABI, state.signer).approve(spender, ethers.MaxUint256),
        afterSuccess: () => refreshWalletData([locker.id]),
      }),
    });
    return;
  }
  requestConfirmation({
    title: `Deposit ${item.symbol}`,
    rows: [
      { label: "Chain", value: CHAINS[locker.chain].name },
      { label: "Amount", value: `${input} ${item.symbol}` },
      { label: "Destination", value: `${target === "staking" ? "Boosted staking" : "Compounding vault"} ${shortAddress(spender)}` },
      { label: "Action", value: target === "staking" ? "Stake and credit this wallet" : "Mint vault shares" },
    ],
    confirmLabel: "Confirm Deposit",
    errorContext: { action: "deposit", lockerId: locker.id, chain: locker.chain },
    execute: () => submitTransaction({
      locker,
      key: actionKey(locker, "deposit", target),
      title: `${item.symbol} deposit`,
      send: () => target === "staking" ? contract(locker.stakingAddress, STAKING_ABI, state.signer).deposit(amount, state.account) : contract(vaultAddressFor(locker), VAULT_ABI, state.signer).deposit(amount),
      afterSuccess: () => updateLockerActionState(state.actionState, locker.id, target, { input: "" }),
      activity: { type: "deposit", target, amount: input, symbol: item.symbol },
    }),
  });
}

async function prepareWithdraw(locker, target) {
  const amount = amountFromState(locker, target);
  const item = token(locker.token);
  const input = actionFor(locker.id, target).input;
  const live = liveFor(locker);
  const isVault = target === "vault";
  const estimated = isVault && Number.isFinite(Number(live.pps)) ? Number(input) * Number(live.pps) : null;
  const destination = isVault ? vaultAddressFor(locker) : locker.stakingAddress;
  requestConfirmation({
    title: `Withdraw ${item.symbol}`,
    rows: [
      { label: "Chain", value: CHAINS[locker.chain].name },
      { label: isVault ? "Vault shares redeemed" : "Staking tokens withdrawn", value: isVault ? `${input} shares` : `${input} ${item.symbol}` },
      { label: "Estimated underlying received", value: isVault && estimated !== null ? `${formatNumber(estimated, 6)} ${item.symbol}` : `${input} ${item.symbol}` },
      { label: "Contract", value: shortAddress(destination) },
    ],
    warning: isVault ? "The final underlying amount is determined by the vault PPS when the transaction executes." : "Review the amount before confirming in your wallet.",
    confirmLabel: "Confirm Withdrawal",
    errorContext: { action: "withdraw", lockerId: locker.id, chain: locker.chain },
    execute: () => submitTransaction({
      locker,
      key: actionKey(locker, "withdraw", target),
      title: `${item.symbol} withdrawal`,
      send: () => target === "staking" ? contract(locker.stakingAddress, STAKING_ABI, state.signer).withdraw(amount) : contract(vaultAddressFor(locker), VAULT_ABI, state.signer).withdraw(amount),
      afterSuccess: () => updateLockerActionState(state.actionState, locker.id, target, { input: "" }),
      activity: { type: "withdraw", target, amount: input, symbol: isVault ? "vault shares" : item.symbol },
    }),
  });
}

async function prepareClaim(locker) {
  requestConfirmation({
    title: `Claim ${token(locker.token).symbol} staking rewards`,
    rows: [
      { label: "Chain", value: CHAINS[locker.chain].name },
      { label: "Receiver", value: shortAddress(state.account) },
      { label: "Staking contract", value: shortAddress(locker.stakingAddress) },
      { label: "Rewards", value: claimRewardRows(locker, liveFor(locker)).map((reward) => reward.symbol).join(", ") },
    ],
    confirmLabel: "Confirm Claim",
    errorContext: { action: "claim", lockerId: locker.id, chain: locker.chain },
    execute: () => submitTransaction({
      locker,
      key: actionKey(locker, "claim", "staking"),
      title: `${token(locker.token).symbol} reward claim`,
      send: () => contract(locker.stakingAddress, STAKING_ABI, state.signer).claim_rewards(state.account),
      activity: { type: "claim", target: "staking", symbol: token(locker.token).symbol },
    }),
  });
}

async function resolveLiveHarvestTargets(locker) {
  const admin = state.adminData.get(locker.id) || {};
  const live = liveFor(locker);
  const vault = contract(vaultAddressFor(locker), VAULT_ABI, state.signer);
  const staking = contract(locker.stakingAddress, STAKING_ABI, state.signer);
  const [strategyResult, boostHubResult, pidResult] = await Promise.allSettled([vault.strategy(), staking.boost_hub(), staking.pid()]);
  return {
    strategyAddress: strategyResult.status === "fulfilled" ? strategyResult.value : admin.strategyAddress || live.topology?.strategyAddress || locker.strategyAddress,
    boostHubAddress: boostHubResult.status === "fulfilled" ? boostHubResult.value : admin.boostHubAddress || live.topology?.boostHubAddress,
    pid: pidResult.status === "fulfilled" ? Number(pidResult.value) : admin.pid ?? live.topology?.pid ?? locker.pid,
  };
}

async function sendAdminHarvest(locker, type) {
  const targets = await resolveLiveHarvestTargets(locker);
  if (type === "vault") {
    return submitTransaction({
      locker,
      key: actionKey(locker, "harvest-vault"),
      title: `${token(locker.token).symbol} vault harvest`,
      send: () => contract(targets.strategyAddress, STRATEGY_ABI, state.signer).harvest(),
    });
  }
  return submitTransaction({
    locker,
    key: actionKey(locker, "harvest-boosthub"),
    title: `${token(locker.token).symbol} BoostHub harvest`,
    send: () => contract(targets.boostHubAddress, BOOSTHUB_ABI, state.signer).harvest(targets.pid),
  });
}

function prepareAdminHarvest(locker, type) {
  const admin = state.adminData.get(locker.id) || {};
  const detail = type === "vault" ? admin.vault : admin.boostHub;
  if (!detail?.authorized) throw new Error(detail?.reason || "The connected account cannot call this harvest now.");
  const address = type === "vault" ? admin.strategyAddress : admin.boostHubAddress;
  requestConfirmation({
    title: `${token(locker.token).symbol} ${type === "vault" ? "vault" : "BoostHub"} harvest`,
    rows: [
      { label: "Chain", value: CHAINS[locker.chain].name },
      { label: "Contract", value: shortAddress(address) },
      { label: "Pending reward value", value: formatUsd(detail.pendingValueUsd) },
      { label: "Estimated gas", value: detail.gasEstimate ? formatNumber(detail.gasEstimate, 0) : "Unavailable" },
    ],
    confirmLabel: "Confirm Harvest",
    errorContext: { action: type === "vault" ? "harvest-vault" : "harvest-boosthub", lockerId: locker.id, chain: locker.chain },
    execute: () => sendAdminHarvest(locker, type),
  });
}

function selectedBatchItems() {
  return [...state.adminSelection].map((key) => {
    const [lockerId, type] = key.split(":");
    return { locker: lockerById(lockerId), type };
  }).filter(({ locker, type }) => {
    const data = state.adminData.get(locker.id)?.[type === "vault" ? "vault" : "boostHub"];
    return data?.authorized;
  }).sort((a, b) => a.locker.chain.localeCompare(b.locker.chain));
}

function prepareBatchHarvest() {
  const items = selectedBatchItems();
  if (!items.length) throw new Error("Select at least one currently authorized harvest action.");
  requestConfirmation({
    title: `Harvest ${items.length} selected actions`,
    rows: items.map(({ locker, type }) => ({ label: `${token(locker.token).symbol} · ${CHAINS[locker.chain].name}`, value: type === "vault" ? "Vault strategy" : "BoostHub pool" })),
    warning: "The dapp executes these transactions sequentially and requests network switches when the chain changes.",
    confirmLabel: "Start Batch",
    errorContext: { action: "batch-harvest", scope: "transaction" },
    execute: () => runBatchHarvest(items),
  });
}

async function runBatchHarvest(items) {
  return withPending("global:batch", async () => {
    state.batchStatus = items.map(({ locker, type }) => ({ key: `${locker.id}:${type}`, label: `${token(locker.token).symbol} ${type === "vault" ? "vault" : "BoostHub"}`, chain: locker.chain, status: "queued", hash: null }));
    render();
    for (let index = 0; index < items.length; index += 1) {
      const { locker, type } = items[index];
      const row = state.batchStatus[index];
      try {
        await ensureWalletChain(CHAINS[locker.chain]);
        row.status = "awaiting wallet";
        render();
        const targets = await resolveLiveHarvestTargets(locker);
        const tx = type === "vault"
          ? await contract(targets.strategyAddress, STRATEGY_ABI, state.signer).harvest()
          : await contract(targets.boostHubAddress, BOOSTHUB_ABI, state.signer).harvest(targets.pid);
        row.hash = tx.hash;
        row.status = "pending";
        render();
        await tx.wait();
        row.status = "confirmed";
        await refreshRelevantLocker(locker);
      } catch (error) {
        row.status = "failed";
        await recordError(error, { action: `batch-${type}`, lockerId: locker.id, chain: locker.chain });
      }
      render();
    }
    state.adminSelection.clear();
    await refreshAdminData({ force: true });
  });
}

async function handleAction(action, target = "staking", lockerId = null) {
  try {
    if (action === "refresh") return withPending("global:refresh", () => refreshAll({ force: true }));
    if (action === "refresh-admin") return withPending("global:admin-refresh", () => refreshAdminData({ force: true }));
    if (action === "dismiss-error") { state.lastTransactionError = null; render(); return; }
    if (action === "clear-errors") { state.errorLog = []; await persistErrorLog([]); state.diagnosticPage = 1; render(); return; }
    if (action === "copy-diagnostics") return copyText(diagnosticPayload(), "Redacted diagnostics copied.");
    if (action === "export-diagnostics") return exportDiagnostics();
    if (action === "reset-diagnostic-filters") { state.diagnosticFilters = { chain: "all", status: "all", contractAddress: "all", transactionHash: "" }; state.diagnosticPage = 1; render(); return; }
    if (action === "diagnostic-prev") { state.diagnosticPage = Math.max(1, state.diagnosticPage - 1); render(); return; }
    if (action === "diagnostic-next") { state.diagnosticPage += 1; render(); return; }
    if (action === "inspect-cache") { state.cacheInspection = await inspectPublicCache(); render(); return; }
    if (action === "inspect-storage") { state.storageHealth = await inspectStorageHealth(); render(); return; }
    if (action === "clear-cache") { await clearPublicCache(); state.cacheInspection = await inspectPublicCache(); render(); notify("Public snapshot cache cleared.", "success"); return; }
    if (action === "retest-rpc") return withPending("global:rpc-retest", async () => { await liveClient.retestRpcHealth(); render(); notify("RPC health retest completed.", "success"); });
    if (action === "retry-reads") return withPending("global:retry-reads", async () => { await refreshAll({ force: true }); if (getRoute().page === "admin") await refreshAdminData({ force: true }); notify("Safe read operations retried.", "success"); });
    if (action === "batch-harvest") return prepareBatchHarvest();
    if (action === "switch-chain") { const switchLocker = lockerById(lockerId || state.activeLockerId); await ensureWalletChain(CHAINS[switchLocker.chain]); render(); return; }
    const locker = lockerById(lockerId || state.activeLockerId);
    if (action === "max") return setMaxAmount(locker, target);
    if (!state.account) {
      state.pendingIntent = { action, target, lockerId: locker.id };
      openWalletModal();
      return;
    }
    await ensureWalletChain(CHAINS[locker.chain]);
    if (action === "deposit") return prepareDeposit(locker, target);
    if (action === "withdraw") return prepareWithdraw(locker, target);
    if (action === "claim") return prepareClaim(locker);
    if (action === "harvest-vault") return prepareAdminHarvest(locker, "vault");
    if (action === "harvest-boosthub") return prepareAdminHarvest(locker, "boostHub");
  } catch (error) {
    const locker = lockerId ? lockerById(lockerId) : lockerById(state.activeLockerId);
    await recordError(error, { action, lockerId: locker?.id || null, chain: locker?.chain || null });
  }
}

async function readWalletBalances(locker) {
  const provider = await liveClient.getProvider(locker.chain);
  const item = token(locker.token);
  const asset = contract(item.address, ERC20_ABI, provider);
  const staking = contract(locker.stakingAddress, STAKING_ABI, provider);
  const vault = contract(vaultAddressFor(locker), VAULT_ABI, provider);
  const live = liveFor(locker);
  const old = live.wallet || {};
  const calls = {
    assetBalance: asset.balanceOf(state.account),
    stakingBalance: staking.balanceOf(state.account),
    vaultShares: vault.balanceOf(state.account),
    pps: vault.getPricePerFullShare().catch(() => live.pps ? ethers.parseUnits(String(live.pps), item.decimals) : null),
    stakingAllowance: asset.allowance(state.account, locker.stakingAddress),
    vaultAllowance: asset.allowance(state.account, vaultAddressFor(locker)),
  };
  const entries = Object.entries(calls);
  const results = await Promise.allSettled(entries.map(([, promise]) => promise));
  const values = {};
  results.forEach((result, index) => { if (result.status === "fulfilled") values[entries[index][0]] = result.value; });
  const claimable = { ...(old.claimable || {}) };
  await Promise.all(claimRewardRows(locker, live).map(async (reward) => {
    try {
      const amount = await staking.claimable_reward(state.account, reward.address);
      claimable[reward.address] = `${formatUnits(amount, reward.decimals, 5)} ${reward.symbol}`;
    } catch {
      claimable[reward.address] = "Unavailable";
    }
  }));
  const pps = values.pps ?? (live.pps ? ethers.parseUnits(String(live.pps), item.decimals) : null);
  const vaultUnderlyingRaw = values.vaultShares !== undefined && pps !== null ? (values.vaultShares * pps) / ethers.parseUnits("1", item.decimals) : null;
  const assetBalanceText = values.assetBalance !== undefined ? formatUnits(values.assetBalance, item.decimals, 5) : old.assetBalance;
  const stakingBalanceText = values.stakingBalance !== undefined ? formatUnits(values.stakingBalance, item.decimals, 5) : old.stakingBalance;
  const vaultSharesText = values.vaultShares !== undefined ? formatUnits(values.vaultShares, item.decimals, 5) : old.vaultShares;
  const vaultUnderlyingText = vaultUnderlyingRaw !== null ? `${formatUnits(vaultUnderlyingRaw, item.decimals, 5)} ${item.symbol}` : old.vaultUnderlying;
  return {
    ...old,
    assetBalance: assetBalanceText,
    assetBalanceRaw: values.assetBalance !== undefined ? formatUnits(values.assetBalance, item.decimals, 18) : old.assetBalanceRaw,
    assetBalanceNumber: Number(assetBalanceText || 0),
    stakingBalance: stakingBalanceText,
    stakingBalanceRaw: values.stakingBalance !== undefined ? formatUnits(values.stakingBalance, item.decimals, 18) : old.stakingBalanceRaw,
    stakingBalanceNumber: Number(stakingBalanceText || 0),
    stakingAllowanceAmount: values.stakingAllowance ?? old.stakingAllowanceAmount ?? 0n,
    vaultShares: vaultSharesText,
    vaultSharesRaw: values.vaultShares !== undefined ? formatUnits(values.vaultShares, item.decimals, 18) : old.vaultSharesRaw,
    vaultSharesNumber: Number(vaultSharesText || 0),
    vaultAllowanceAmount: values.vaultAllowance ?? old.vaultAllowanceAmount ?? 0n,
    vaultUnderlying: vaultUnderlyingText,
    vaultUnderlyingNumber: vaultUnderlyingRaw !== null ? Number(ethers.formatUnits(vaultUnderlyingRaw, item.decimals)) : old.vaultUnderlyingNumber ?? 0,
    claimable,
  };
}

async function refreshWalletData(lockerIds = null) {
  if (!state.account) return;
  const ids = lockerIds ? new Set(lockerIds) : null;
  const lockers = ids ? LOCKERS.filter((locker) => ids.has(locker.id)) : LOCKERS;
  await Promise.allSettled(lockers.map(async (locker) => {
    try {
      const live = liveFor(locker);
      live.wallet = await readWalletBalances(locker);
      state.live.set(locker.id, live);
    } catch (error) {
      await recordError(error, { action: "read-wallet", lockerId: locker.id, chain: locker.chain, scope: "data" }, { showOnPage: false });
    }
  }));
}

function publicSnapshot() {
  const lockers = {};
  for (const locker of LOCKERS) {
    const { wallet: _wallet, ...publicLive } = liveFor(locker);
    lockers[locker.id] = publicLive;
  }
  return { version: SNAPSHOT_VERSION, savedAt: Date.now(), aggregate: state.aggregate, lockers };
}

function applySnapshot(snapshot, cached = true) {
  if (!snapshot?.lockers) return;
  state.aggregate = { ...(snapshot.aggregate || {}), status: cached ? "cached" : snapshot.aggregate?.status };
  for (const locker of LOCKERS) {
    const incoming = snapshot.lockers[locker.id];
    if (!incoming) continue;
    const wallet = liveFor(locker).wallet;
    state.live.set(locker.id, { ...incoming, status: cached ? "cached" : incoming.status, ...(wallet ? { wallet } : {}) });
  }
}

async function refreshOneLocker(locker) {
  try {
    const fresh = await liveClient.readLocker(locker);
    const old = liveFor(locker);
    const wallet = old.wallet;
    const merged = mergeSnapshotLocker(old, fresh);
    if (wallet) merged.wallet = wallet;
    state.live.set(locker.id, merged);
    const observation = await recordYieldObservation(locker.id, fresh);
    if (observation) state.yieldHistory.set(locker.id, await readYieldHistory(locker.id));
    if (fresh.fieldErrors && Object.keys(fresh.fieldErrors).length) await recordDataErrors(locker, fresh.fieldErrors);
    return merged;
  } catch (error) {
    const old = liveFor(locker);
    state.live.set(locker.id, old.updatedAt ? { ...old, status: "stale" } : { ...old, status: "error", fieldErrors: { refresh: error.message } });
    await recordError(error, { action: "refresh-locker", lockerId: locker.id, chain: locker.chain, scope: "data" }, { showOnPage: false });
    return state.live.get(locker.id);
  }
}

async function refreshAggregate() {
  const ethereumLocker = LOCKERS.find((locker) => locker.chain === "ethereum" && liveFor(locker).topology?.boostHubAddress);
  if (!ethereumLocker) return;
  try {
    const fresh = { vlsdtDelegated: await liveClient.readDelegatedVlSdt(liveFor(ethereumLocker).topology.boostHubAddress), updatedAt: Date.now(), status: "live", fieldErrors: {} };
    state.aggregate = mergeSnapshotLocker(state.aggregate, fresh);
  } catch (error) {
    state.aggregate = state.aggregate.updatedAt ? { ...state.aggregate, status: "stale", fieldErrors: { vlsdtDelegated: error.message } } : { status: "error", fieldErrors: { vlsdtDelegated: error.message } };
    await recordError(error, { action: "read-vlsdt-delegated", chain: "ethereum", scope: "data" }, { showOnPage: false });
  }
}

async function refreshAll({ force = false } = {}) {
  if (state.refreshPromise) return state.refreshPromise;
  if (!force && state.lastRefreshAt && Date.now() - state.lastRefreshAt < REFRESH_INTERVAL_MS) return null;
  state.refreshPromise = (async () => {
    await Promise.allSettled(LOCKERS.map(refreshOneLocker));
    await refreshAggregate();
    state.lastRefreshAt = Date.now();
    await persistSnapshot(publicSnapshot());
    await refreshWalletData();
    render();
    if (getRoute().page === "admin") await refreshAdminData({ force: true });
  })().finally(() => { state.refreshPromise = null; });
  return state.refreshPromise;
}

async function refreshRelevantLocker(locker) {
  await refreshOneLocker(locker);
  await refreshAggregate();
  await refreshWalletData([locker.id]);
  await persistSnapshot(publicSnapshot());
  if (getRoute().page === "admin") await refreshAdminData({ lockerIds: [locker.id], force: true });
  render();
}

async function refreshAdminData({ lockerIds = null, force = false } = {}) {
  if (state.adminRefreshPromise) return state.adminRefreshPromise;
  if (!force && getRoute().page !== "admin") return null;
  const ids = lockerIds ? new Set(lockerIds) : null;
  const lockers = LOCKERS.filter((locker) => !locker.hidden && (!ids || ids.has(locker.id)));
  state.adminRefreshPromise = (async () => {
    state.storageHealth = await inspectStorageHealth();
    await Promise.allSettled(lockers.map(async (locker) => {
      try {
        const data = await liveClient.readAdminHarvestData(locker, state.account, liveFor(locker));
        state.adminData.set(locker.id, data);
        const adminErrors = { ...(data.healthErrors || {}), ...(data.vault?.errors || {}) };
        if (data.historyError) adminErrors.harvestHistory = data.historyError;
        if (data.boostHub?.pendingError) adminErrors.pendingBoostHubRewards = data.boostHub.pendingError;
        if (Object.keys(adminErrors).length) await recordDataErrors(locker, adminErrors);
      } catch (error) {
        await recordError(error, { action: "read-admin-harvest", lockerId: locker.id, chain: locker.chain, scope: "data" }, { showOnPage: false });
      }
    }));
    render();
  })().finally(() => { state.adminRefreshPromise = null; });
  return state.adminRefreshPromise;
}

function handleRouteChange() {
  closeMenu();
  renderSiteMenu();
  render();
  const route = getRoute();
  if (route.page === "locker") loadRemoteHistory(route.id, historyRangeFor(route.id));
  if (route.page === "admin") refreshAdminData({ force: true });
  promptWalletChainForRoute();
}

function updateOfflineIndicator() {
  if (!offlineIndicator) return;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  offlineIndicator.hidden = !offline;
  offlineIndicator.setAttribute("aria-hidden", offline ? "false" : "true");
}

async function registerOfflineShell() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(window.location.protocol)) return;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js?v=11", { scope: "./", updateViaCache: "none" });
    await registration.update();
  } catch (error) {
    await recordError(error, { action: "register-offline-shell", scope: "storage" }, { showOnPage: false, notifyUser: false, renderNow: false });
  }
}

installImageFallbacks();
renderSiteMenu();
updateOfflineIndicator();
window.addEventListener("online", updateOfflineIndicator);
window.addEventListener("offline", updateOfflineIndicator);
registerOfflineShell();
menuToggle.addEventListener("click", toggleMenu);
connectWalletButton.addEventListener("click", (event) => openWalletModal(event.currentTarget));
window.addEventListener("hashchange", handleRouteChange);
window.addEventListener("resize", () => { renderSiteMenu(); closeMenu(); });
window.addEventListener("click", (event) => {
  if (!siteMenu.hidden && !siteMenu.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
});
confirmationModal.addEventListener("click", (event) => { if (event.target === confirmationModal) closeConfirmation(); });
walletModal.addEventListener("click", (event) => { if (event.target === walletModal) closeWalletModal(); });
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeMenu();
  closeConfirmation();
  closeWalletModal();
});

discoverWallets();

const immediateCache = loadLocalSnapshot();
if (immediateCache) applySnapshot(immediateCache, true);
render();

Promise.all([hydrateSnapshot(), loadErrorLog(), readAllYieldHistory(LOCKERS.filter((locker) => !locker.hidden).map((locker) => locker.id))]).then(([snapshot, errors, history]) => {
  state.errorLog = errors;
  state.yieldHistory = history;
  if (snapshot && Number(snapshot.savedAt || 0) > Number(immediateCache?.savedAt || 0)) applySnapshot(snapshot, true);
  render();
  const route = getRoute();
  if (route.page === "locker") loadRemoteHistory(route.id, historyRangeFor(route.id));
}).finally(async () => {
  await attemptAutoReconnect();
  await refreshAll({ force: true });
});

subscribeSnapshots((snapshot) => {
  applySnapshot(snapshot, true);
  render();
});

setInterval(() => refreshAll(), REFRESH_INTERVAL_MS);
window.addEventListener("focus", () => refreshAll());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshAll(); });
