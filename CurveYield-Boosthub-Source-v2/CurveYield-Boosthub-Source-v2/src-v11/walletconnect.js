export function resolveWalletConnectGlobal(windowRef = globalThis) {
  return windowRef?.["@walletconnect/ethereum-provider"]?.EthereumProvider
    || windowRef?.WalletConnectEthereumProvider
    || null;
}

export async function loadWalletConnectEthereumProvider({
  windowRef = globalThis,
  documentRef = globalThis.document,
  scriptUrls = [],
} = {}) {
  const existing = resolveWalletConnectGlobal(windowRef);
  if (existing) return existing;
  if (!documentRef?.createElement) throw new Error("WalletConnect requires a browser document.");
  let lastError = null;
  for (const src of scriptUrls) {
    try {
      await new Promise((resolve, reject) => {
        const prior = documentRef.querySelector?.(`script[data-walletconnect-src="${src}"]`);
        if (prior?.dataset.loaded === "true") return resolve();
        const script = prior || documentRef.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.walletconnectSrc = src;
        script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
        script.addEventListener("error", () => reject(new Error(`WalletConnect library failed to load from ${src}`)), { once: true });
        if (!prior) documentRef.head.appendChild(script);
      });
      const loaded = resolveWalletConnectGlobal(windowRef);
      if (loaded) return loaded;
      throw new Error("WalletConnect library loaded without an EthereumProvider export.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("WalletConnect provider library is unavailable.");
}

const DEFAULT_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
];
const DEFAULT_EVENTS = ["accountsChanged", "chainChanged", "disconnect", "connect"];

export function walletConnectProjectIdError() {
  return new Error("WalletConnect project ID is not configured. Add it to src-v11/runtime-config.js before production deployment.");
}

export function createWalletConnectAdapter({
  EthereumProvider,
  projectId,
  chains = [],
  metadata = {},
  onUri = () => {},
  onAccountsChanged = () => {},
  onChainChanged = () => {},
  onDisconnect = () => {},
  onConnect = () => {},
} = {}) {
  let providerPromise = null;
  let boundProvider = null;
  const chainIds = chains.map((chain) => Number(chain.chainId)).filter(Number.isFinite);
  const rpcMap = Object.fromEntries(chains.flatMap((chain) => chain.rpcUrls?.[0] ? [[Number(chain.chainId), chain.rpcUrls[0]]] : []));

  function isConfigured() {
    return Boolean(String(projectId || "").trim());
  }

  async function initialize() {
    if (!isConfigured()) throw walletConnectProjectIdError();
    if (!EthereumProvider?.init) throw new Error("WalletConnect provider library failed to load.");
    if (!providerPromise) {
      providerPromise = EthereumProvider.init({
        projectId: String(projectId).trim(),
        optionalChains: chainIds,
        methods: DEFAULT_METHODS,
        events: DEFAULT_EVENTS,
        rpcMap,
        metadata,
        showQrModal: true,
      }).then((provider) => {
        boundProvider = provider;
        provider.on?.("display_uri", onUri);
        provider.on?.("accountsChanged", onAccountsChanged);
        provider.on?.("chainChanged", onChainChanged);
        provider.on?.("disconnect", onDisconnect);
        provider.on?.("connect", onConnect);
        return provider;
      }).catch((error) => {
        providerPromise = null;
        throw error;
      });
    }
    return providerPromise;
  }

  async function connect() {
    const provider = await initialize();
    if (!provider.session || !provider.accounts?.length) await provider.connect?.({ optionalChains: chainIds, rpcMap });
    return provider;
  }

  async function reconnect() {
    const provider = await initialize();
    if (!provider.session || !provider.accounts?.length) return null;
    return provider;
  }

  async function disconnect() {
    const provider = boundProvider || (providerPromise ? await providerPromise : null);
    if (provider?.disconnect) await provider.disconnect();
  }

  return {
    isConfigured,
    provider: initialize,
    connect,
    reconnect,
    disconnect,
    get session() { return boundProvider?.session || null; },
  };
}
