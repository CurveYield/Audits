export const EXPLORERS = {
  1: { name: "Etherscan", baseUrl: "https://etherscan.io" },
  252: { name: "Fraxscan", baseUrl: "https://fraxscan.com" },
  8453: { name: "BaseScan", baseUrl: "https://basescan.org" },
};

export const CHAINS = {
  ethereum: {
    key: "ethereum",
    priceChain: "ethereum",
    chainId: 1,
    name: "Ethereum",
    shortName: "Ethereum",
    rpcUrls: [
      "https://ethereum-rpc.publicnode.com",
      "https://public.1rpc.io/eth",
      "https://eth.llamarpc.com",
      "https://web3-trial.cloudflare-eth.com/v1/mainnet",
    ],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorer: EXPLORERS[1],
  },
  fraxtal: {
    key: "fraxtal",
    priceChain: "fraxtal",
    chainId: 252,
    name: "Fraxtal",
    shortName: "Fraxtal",
    rpcUrls: [
      "https://rpc.frax.com",
      "https://fraxtal-rpc.publicnode.com",
      "https://fraxtal.gateway.tenderly.co",
      "https://fraxtal.drpc.org",
    ],
    nativeCurrency: { name: "Frax", symbol: "FRAX", decimals: 18 },
    explorer: EXPLORERS[252],
  },
  base: {
    key: "base",
    priceChain: "base",
    chainId: 8453,
    name: "Base",
    shortName: "Base",
    rpcUrls: [
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com",
      "https://base.llamarpc.com",
      "https://base.drpc.org",
    ],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorer: EXPLORERS[8453],
  },
};

export const TOKENS = {
  sdFXS: { symbol: "sdFXS", name: "StakeDAO FXS", icon: "./assets/tokens/stakedao/fxs.svg", listIcon: "./assets/tokens/stakedao/fxs.svg", address: "0x1AEe2382e05Dc68BDfC472F1E46d570feCca5814", chain: "fraxtal", decimals: 18 },
  WFRAX: { symbol: "WFRAX", name: "Wrapped FRAX", icon: null, address: "0xFc00000000000000000000000000000000000002", chain: "fraxtal", decimals: 18, stable: true },
  sdCRV: { symbol: "sdCRV", name: "StakeDAO CRV", icon: "./assets/tokens/stakedao/crv.svg", listIcon: "./assets/tokens/stakedao/crv.svg", address: "0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5", chain: "ethereum", decimals: 18, priceFallbackAddress: "0xD533a949740bb3306d119CC777fa900bA034cd52" },
  CRV: { symbol: "CRV", name: "Curve DAO", icon: "./assets/tokens/crv.png", address: "0xD533a949740bb3306d119CC777fa900bA034cd52", chain: "ethereum", decimals: 18 },
  crvUSD: { symbol: "crvUSD", name: "Curve USD", icon: "https://cdn.jsdelivr.net/gh/curvefi/curve-assets/images/assets/0xf939e0a03fb07f59a73314e73794be0e57ac1b4e.png", fallbackIcon: "./assets/tokens/crvusd-clean.png", address: "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E", chain: "ethereum", decimals: 18, stable: true },
  SDT: { symbol: "SDT", name: "StakeDAO Token", icon: "./assets/brand/stakedao-elephant.svg", address: "0x73968b9a57c6E53d41345FD57a6E6ae27d6CDB2F", chain: "ethereum", decimals: 18 },
  sdFXN: { symbol: "sdFXN", name: "StakeDAO FXN", icon: "./assets/tokens/stakedao/fxn.svg", address: "0xe19d1c837B8A1C83A56cD9165b2c0256D39653aD", chain: "ethereum", decimals: 18, priceFallbackAddress: "0x365AccFCa291e7D3914637ABf1F7635dB165Bb09" },
  wstETH: { symbol: "wstETH", name: "Wrapped stETH", icon: "./assets/tokens/wsteth.svg", address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", chain: "ethereum", decimals: 18 },
};

export const BLOCKSCOUT_EXPLORERS = {
  1: "https://eth.blockscout.com",
  252: "https://explorer.mainnet.frax.com",
  8453: "https://base.blockscout.com",
};

export function blockscoutInteractionUrl(chainId, address, { token = false } = {}) {
  const baseUrl = BLOCKSCOUT_EXPLORERS[Number(chainId)];
  if (!baseUrl) throw new Error(`No Blockscout explorer configured for chain ${chainId}`);
  return `${baseUrl}/${token ? "token" : "address"}/${address}?tab=read_write_contract`;
}

export function blockscoutSourceUrl(chainId, address, { token = false } = {}) {
  const baseUrl = BLOCKSCOUT_EXPLORERS[Number(chainId)];
  if (!baseUrl) throw new Error(`No Blockscout explorer configured for chain ${chainId}`);
  return `${baseUrl}/${token ? "token" : "address"}/${address}?tab=contract`;
}

// Retained for compatibility with older integrations; the user-facing UI now uses Blockscout.
export function sourcifyContractUrl(chainId, address) {
  return `https://repo.sourcify.dev/${Number(chainId)}/${address}`;
}

const ETHEREUM_BOOSTHUB = "0xFbEF8941Da53EA724385B44E91ae9672061D0263";
const FRAXTAL_BOOSTHUB = "0xFbEF8941Da53EA724385B44E91ae9672061D0263";

export const LOCKERS = [
  {
    id: "sdcrv", stakeDaoId: "crv", pid: 0, chain: "ethereum", chainId: 1, token: "sdCRV", title: "CRV BoostHub",
    boostHubAddress: ETHEREUM_BOOSTHUB,
    gaugeAddress: "0x7f50786A0b15723D741727882ee99a0BF34e3466",
    lpAddress: "0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5",
    stakingAddress: "0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C",
    stakingInteractionUrl: blockscoutInteractionUrl(1, "0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C", { token: true }),
    stakingSourceUrl: blockscoutSourceUrl(1, "0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C", { token: true }),
    vaultAddress: "0xdB6AA572243b9617C4b39FB20468843b2CB97bA5",
    strategyAddress: "0x93DFEfeFd5D3736381086eFa5A8810F278138ADf",
    converterAddresses: ["0x3C618Deb7659695C378170A032A1B8e61e17644E", "0xf4b32155BeA17b075AEf88540e14F9835e16351B"],
    rewardTokens: ["sdCRV", "crvUSD", "CRV"],
  },
  {
    id: "sdfxn", stakeDaoId: "fxn", pid: 1, chain: "ethereum", chainId: 1, token: "sdFXN", title: "FXN BoostHub",
    boostHubAddress: ETHEREUM_BOOSTHUB,
    gaugeAddress: "0xbcfE5c47129253C6B8a9A00565B3358b488D42E0",
    lpAddress: "0xe19d1c837B8A1C83A56cD9165b2c0256D39653aD",
    stakingAddress: "0x7d53B437f950d6F515C8871aC985F1e875d6B52E",
    stakingInteractionUrl: blockscoutInteractionUrl(1, "0x7d53B437f950d6F515C8871aC985F1e875d6B52E", { token: true }),
    stakingSourceUrl: blockscoutSourceUrl(1, "0x7d53B437f950d6F515C8871aC985F1e875d6B52E", { token: true }),
    vaultAddress: "0x0f57460a1bef095c4D788B3b6118533823d8d3dD",
    strategyAddress: "0xc202f5137DE30b8170874e1DE55d1DbB2FA4CD45",
    converterAddresses: ["0xd66D8F419d9e809eC3A6443A5Da72AEae56649eB"],
    rewardTokens: ["sdFXN", "wstETH"],
  },
  {
    id: "sdfxs", stakeDaoId: "fxs", pid: 0, chain: "fraxtal", chainId: 252, token: "sdFXS", title: "FXS BoostHub",
    gaugeModel: "xchain-uniform",
    boostHubAddress: FRAXTAL_BOOSTHUB,
    gaugeAddress: "0x12992595328E52267c95e45B1a97014D6Ddf8683",
    lpAddress: "0x1AEe2382e05Dc68BDfC472F1E46d570feCca5814",
    stakingAddress: "0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183",
    stakingInteractionUrl: blockscoutInteractionUrl(252, "0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183", { token: true }),
    stakingSourceUrl: blockscoutSourceUrl(252, "0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183", { token: true }),
    vaultAddress: "0x0A4b9DC3fC75DDBEb44B581a582B5D27d09ede47",
    strategyAddress: "0xF64bC212C4dD190d10764B8B447C62368908c2AE",
    converterAddresses: ["0x2616Efd6F8D629dE2223924AE07A691e03240207"],
    rewardTokens: ["sdFXS", "WFRAX"],
  },
];

export const DOCS_URL = "https://docs-boosthub.curveyield.online";
export const REFRESH_INTERVAL_MS = 300_000;
