const CACHE_NAME = "curveyield-boosthub-shell-v11";
const CACHE_PREFIX = "curveyield-boosthub-shell-";
const CORE_ASSETS = ["./","./index.html","./404.html","./styles-v11.css","./vendor/ethers.umd.min.js","./src-v11/abi.js","./src-v11/app.js","./src-v11/config.js","./src-v11/contract-targets.js","./src-v11/curve-apys.js","./src-v11/data-store.js","./src-v11/diagnostics.js","./src-v11/error-log.js","./src-v11/format.js","./src-v11/ipfs-path.js","./src-v11/live-data.js","./src-v11/modal-focus.js","./src-v11/portfolio-math.js","./src-v11/prices.js","./src-v11/rpc-health.js","./src-v11/runtime-config.js","./src-v11/stakedao-lockers.js","./src-v11/ui-state.js","./src-v11/walletconnect.js","./src-v11/yield-math.js","./src-v11/history-store.js","./src-v11/history-api.js","./src-v11/activity-store.js","./assets/brand/curveyield-mark.png","./assets/brand/curveyield_logo_512.png","./assets/brand/curveyield-white-logo.png","./assets/brand/stakedao-elephant.svg","./assets/tokens/crv-locker.png","./assets/tokens/crv.png","./assets/tokens/crvlogo.jpg","./assets/tokens/crvusd-clean.png","./assets/tokens/fxn.png","./assets/tokens/fxs.png","./assets/tokens/sdcrv-clean.png","./assets/tokens/sdcrv-crop-preview.png","./assets/tokens/sdcrv.png","./assets/tokens/sdfxs-clean.png","./assets/tokens/sdfxs-crop-preview.png","./assets/tokens/sdfxs.logo.png","./assets/tokens/sdspectra-clean.png","./assets/tokens/sdspectra-crop-preview.png","./assets/tokens/spectra.png","./assets/tokens/stakedao/crv.svg","./assets/tokens/stakedao/fxn.svg","./assets/tokens/stakedao/fxs.svg","./assets/tokens/stakedao/spectra.svg","./assets/tokens/wsteth.svg"];

function scopedUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS.map(scopedUrl));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isStaticRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (!url.href.startsWith(self.registration.scope)) return false;
  return request.mode === "navigate" || ["document", "script", "style", "image", "font", "manifest"].includes(request.destination);
}

async function networkFirst(request, fallbackUrl = null) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || (fallbackUrl ? await caches.match(fallbackUrl) : null) || Response.error();
  }
}

async function networkFirstNavigation(request) {
  return networkFirst(request, scopedUrl("./index.html"));
}

async function networkFirstStatic(request) {
  return networkFirst(request);
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (!isStaticRequest(request, url)) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (request.destination === "script" || request.destination === "style") {
    event.respondWith(networkFirstStatic(request));
    return;
  }
  event.respondWith(cacheFirstAsset(request));
});
