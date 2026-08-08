// Public deployment configuration. A Reown project ID is not a secret.
// Paste the production project ID between the quotes or set window.CURVEYIELD_RUNTIME_CONFIG before app.js loads.
const DEPLOYMENT_WALLETCONNECT_PROJECT_ID = "";
const override = globalThis.CURVEYIELD_RUNTIME_CONFIG || {};

function safePageUrl() {
  const candidate = String(globalThis.location?.href || "");
  return /^https?:\/\//i.test(candidate) ? candidate : "https://boosthub.curveyield.online/";
}

function safeOrigin() {
  const candidate = String(globalThis.location?.origin || "");
  return /^https?:\/\//i.test(candidate) ? candidate : "https://boosthub.curveyield.online";
}

function safeAssetUrl(path) {
  try { return new URL(path, safePageUrl()).href; } catch { return `https://boosthub.curveyield.online/${String(path).replace(/^\.\//, "")}`; }
}

export const RUNTIME_CONFIG = Object.freeze({
  walletConnectProjectId: String(override.walletConnectProjectId || DEPLOYMENT_WALLETCONNECT_PROJECT_ID).trim(),
  walletConnectScriptUrls: override.walletConnectScriptUrls || [
    "https://unpkg.com/@walletconnect/ethereum-provider@2.23.10/dist/index.umd.js",
    "https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2.23.10/dist/index.umd.js",
  ],
  walletConnectMetadata: {
    name: "CurveYield BoostHub",
    description: "CurveYield BoostHub staking and compounding vault interface.",
    url: safeOrigin(),
    icons: [safeAssetUrl("./assets/brand/curveyield_logo_512.png")],
    ...(override.walletConnectMetadata || {}),
  },
});
