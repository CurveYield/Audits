# CurveYield BoostHub — Current DApp Contracts v2

Source: active contract configuration in the finalized BoostHub frontend v7.

This list contains the **current active contracts used by the dApp**. The hidden legacy `sdYB-old` deployment is intentionally excluded because it is not the current sdYB deployment.

---

## Shared BoostHub Contracts

| Label | Chain | Address |
|---|---|---|
| Ethereum BoostHub | Ethereum | `0xFbEF8941Da53EA724385B44E91ae9672061D0263` |
| Fraxtal BoostHub | Fraxtal | `0xFbEF8941Da53EA724385B44E91ae9672061D0263` |

> The BoostHub uses the same deterministic address on Ethereum and Fraxtal, but they are separate deployments on separate chains.

---

## sdCRV / CRV BoostHub

| Label | Chain | Address |
|---|---|---|
| **sdCRV Staking** | Ethereum | `0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C` |
| **sdCRV Vault** | Ethereum | `0xdB6AA572243b9617C4b39FB20468843b2CB97bA5` |
| **sdCRV Strategy** | Ethereum | `0x93DFEfeFd5D3736381086eFa5A8810F278138ADf` |
| sdCRV StakeDAO Gauge | Ethereum | `0x7f50786A0b15723D741727882ee99a0BF34e3466` |
| sdCRV / LP Token | Ethereum | `0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5` |
| sdCRV Converter 1 | Ethereum | `0x3C618Deb7659695C378170A032A1B8e61e17644E` |
| sdCRV Converter 2 | Ethereum | `0xf4b32155BeA17b075AEf88540e14F9835e16351B` |
| sdCRV Reward Token — sdCRV | Ethereum | `0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5` |
| sdCRV Reward Token — crvUSD | Ethereum | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` |
| sdCRV Reward Token — CRV | Ethereum | `0xD533a949740bb3306d119CC777fa900bA034cd52` |

**BoostHub PID:** `0`

---

## sdFXN / FXN BoostHub

| Label | Chain | Address |
|---|---|---|
| **sdFXN Staking** | Ethereum | `0x7d53B437f950d6F515C8871aC985F1e875d6B52E` |
| **sdFXN Vault** | Ethereum | `0x0f57460a1bef095c4D788B3b6118533823d8d3dD` |
| **sdFXN Strategy** | Ethereum | `0xc202f5137DE30b8170874e1DE55d1DbB2FA4CD45` |
| sdFXN StakeDAO Gauge | Ethereum | `0xbcfE5c47129253C6B8a9A00565B3358b488D42E0` |
| sdFXN / LP Token | Ethereum | `0xe19d1c837B8A1C83A56cD9165b2c0256D39653aD` |
| sdFXN Converter | Ethereum | `0xd66D8F419d9e809eC3A6443A5Da72AEae56649eB` |
| sdFXN Reward Token — sdFXN | Ethereum | `0xe19d1c837B8A1C83A56cD9165b2c0256D39653aD` |
| sdFXN Reward Token — wstETH | Ethereum | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` |

**BoostHub PID:** `1`

---

## sdYB / YB BoostHub

| Label | Chain | Address |
|---|---|---|
| **sdYB Staking** | Ethereum | `0xD63819Fef90981fAc8CD6240EA1f2559CD835CBa` |
| **sdYB Vault** | Ethereum | `0x8582dC9a1f0e6DeFcB2Cd3CFd6BF36B053A4cCe3` |
| **sdYB Strategy** | Ethereum | `0x30048681bf6924221f75Ecd98C42a4A3C5a7B0e3` |
| sdYB StakeDAO Gauge | Ethereum | `0x28604Ff7B4aEAE28d4d9e54d14038c910844343a` |
| sdYB / LP Token | Ethereum | `0x0c057598dcE1891688829581f890DD2a3685a43f` |
| sdYB Curve Pool / Yield Source | Ethereum | `0x98b540fa89690969D111D045afCa575C91519B1A` |
| sdYB Reward Token — crvUSD | Ethereum | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` |

**BoostHub PID:** `2`

---

## sdFXS / FXS BoostHub

| Label | Chain | Address |
|---|---|---|
| **sdFXS Staking** | Fraxtal | `0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183` |
| **sdFXS Vault** | Fraxtal | `0x0A4b9DC3fC75DDBEb44B581a582B5D27d09ede47` |
| **sdFXS Strategy** | Fraxtal | `0xF64bC212C4dD190d10764B8B447C62368908c2AE` |
| sdFXS StakeDAO Gauge | Fraxtal | `0x12992595328E52267c95e45B1a97014D6Ddf8683` |
| sdFXS / LP Token | Fraxtal | `0x1AEe2382e05Dc68BDfC472F1E46d570feCca5814` |
| sdFXS Converter | Fraxtal | `0x2616Efd6F8D629dE2223924AE07A691e03240207` |
| sdFXS Reward Token — sdFXS | Fraxtal | `0x1AEe2382e05Dc68BDfC472F1E46d570feCca5814` |
| sdFXS Reward Token — WFRAX | Fraxtal | `0xFc00000000000000000000000000000000000002` |

**BoostHub PID:** `0` on Fraxtal

---

## Additional Token / Pricing Contracts Referenced by the DApp

These are external token contracts used by the frontend for pricing, reward display, or fallback pricing.

| Label | Chain | Address |
|---|---|---|
| CRV | Ethereum | `0xD533a949740bb3306d119CC777fa900bA034cd52` |
| crvUSD | Ethereum | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` |
| StakeDAO Token / SDT | Ethereum | `0x73968b9a57c6E53d41345FD57a6E6ae27d6CDB2F` |
| FXN price-fallback token | Ethereum | `0x365AccFCa291e7D3914637ABf1F7635dB165Bb09` |
| wstETH | Ethereum | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` |
| YB price-fallback token | Ethereum | `0x01791F726B4103694969820be083196cC7c045fF` |
| WFRAX | Fraxtal | `0xFc00000000000000000000000000000000000002` |

---

## Quick Core-Contract List

### sdCRV
- Staking: `0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C`
- Vault: `0xdB6AA572243b9617C4b39FB20468843b2CB97bA5`
- Strategy: `0x93DFEfeFd5D3736381086eFa5A8810F278138ADf`

### sdFXN
- Staking: `0x7d53B437f950d6F515C8871aC985F1e875d6B52E`
- Vault: `0x0f57460a1bef095c4D788B3b6118533823d8d3dD`
- Strategy: `0xc202f5137DE30b8170874e1DE55d1DbB2FA4CD45`

### sdYB
- Staking: `0xD63819Fef90981fAc8CD6240EA1f2559CD835CBa`
- Vault: `0x8582dC9a1f0e6DeFcB2Cd3CFd6BF36B053A4cCe3`
- Strategy: `0x30048681bf6924221f75Ecd98C42a4A3C5a7B0e3`

### sdFXS
- Staking: `0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183`
- Vault: `0x0A4b9DC3fC75DDBEb44B581a582B5D27d09ede47`
- Strategy: `0xF64bC212C4dD190d10764B8B447C62368908c2AE`

---

Generated from: `curveyield-boosthub-source-v7/src-v7/config.js`

---

# Live Verified-Source Links

The links below open the **live Blockscout Contract tab** for each current deployment. When Blockscout has the contract verified, this tab exposes the published source code, ABI, compiler metadata, and related contract details directly from the live explorer.

- Ethereum contracts use `eth.blockscout.com`.
- Fraxtal contracts use the official Fraxtal Blockscout explorer at `explorer.mainnet.frax.com`.
- If a deployment is ever unverified or loses published metadata, the explorer page will show that state rather than this document pretending source is available.


## Shared BoostHub

- **Ethereum BoostHub** — `0xFbEF8941Da53EA724385B44E91ae9672061D0263` — [Live verified source / contract page](https://eth.blockscout.com/address/0xFbEF8941Da53EA724385B44E91ae9672061D0263?tab=contract)
- **Fraxtal BoostHub** — `0xFbEF8941Da53EA724385B44E91ae9672061D0263` — [Live verified source / contract page](https://explorer.mainnet.frax.com/address/0xFbEF8941Da53EA724385B44E91ae9672061D0263?tab=contract)

## sdCRV

- **sdCRV Staking** — `0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C` — [Live verified source / contract page](https://eth.blockscout.com/address/0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C?tab=contract)
- **sdCRV Vault** — `0xdB6AA572243b9617C4b39FB20468843b2CB97bA5` — [Live verified source / contract page](https://eth.blockscout.com/address/0xdB6AA572243b9617C4b39FB20468843b2CB97bA5?tab=contract)
- **sdCRV Strategy** — `0x93DFEfeFd5D3736381086eFa5A8810F278138ADf` — [Live verified source / contract page](https://eth.blockscout.com/address/0x93DFEfeFd5D3736381086eFa5A8810F278138ADf?tab=contract)
- **sdCRV StakeDAO Gauge** — `0x7f50786A0b15723D741727882ee99a0BF34e3466` — [Live verified source / contract page](https://eth.blockscout.com/address/0x7f50786A0b15723D741727882ee99a0BF34e3466?tab=contract)
- **sdCRV / LP Token** — `0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5` — [Live verified source / contract page](https://eth.blockscout.com/address/0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5?tab=contract)
- **sdCRV Converter 1** — `0x3C618Deb7659695C378170A032A1B8e61e17644E` — [Live verified source / contract page](https://eth.blockscout.com/address/0x3C618Deb7659695C378170A032A1B8e61e17644E?tab=contract)
- **sdCRV Converter 2** — `0xf4b32155BeA17b075AEf88540e14F9835e16351B` — [Live verified source / contract page](https://eth.blockscout.com/address/0xf4b32155BeA17b075AEf88540e14F9835e16351B?tab=contract)
- **sdCRV Reward Token — crvUSD** — `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` — [Live verified source / contract page](https://eth.blockscout.com/address/0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E?tab=contract)
- **sdCRV Reward Token — CRV** — `0xD533a949740bb3306d119CC777fa900bA034cd52` — [Live verified source / contract page](https://eth.blockscout.com/address/0xD533a949740bb3306d119CC777fa900bA034cd52?tab=contract)

## sdFXN

- **sdFXN Staking** — `0x7d53B437f950d6F515C8871aC985F1e875d6B52E` — [Live verified source / contract page](https://eth.blockscout.com/address/0x7d53B437f950d6F515C8871aC985F1e875d6B52E?tab=contract)
- **sdFXN Vault** — `0x0f57460a1bef095c4D788B3b6118533823d8d3dD` — [Live verified source / contract page](https://eth.blockscout.com/address/0x0f57460a1bef095c4D788B3b6118533823d8d3dD?tab=contract)
- **sdFXN Strategy** — `0xc202f5137DE30b8170874e1DE55d1DbB2FA4CD45` — [Live verified source / contract page](https://eth.blockscout.com/address/0xc202f5137DE30b8170874e1DE55d1DbB2FA4CD45?tab=contract)
- **sdFXN StakeDAO Gauge** — `0xbcfE5c47129253C6B8a9A00565B3358b488D42E0` — [Live verified source / contract page](https://eth.blockscout.com/address/0xbcfE5c47129253C6B8a9A00565B3358b488D42E0?tab=contract)
- **sdFXN / LP Token** — `0xe19d1c837B8A1C83A56cD9165b2c0256D39653aD` — [Live verified source / contract page](https://eth.blockscout.com/address/0xe19d1c837B8A1C83A56cD9165b2c0256D39653aD?tab=contract)
- **sdFXN Converter** — `0xd66D8F419d9e809eC3A6443A5Da72AEae56649eB` — [Live verified source / contract page](https://eth.blockscout.com/address/0xd66D8F419d9e809eC3A6443A5Da72AEae56649eB?tab=contract)
- **sdFXN Reward Token — wstETH** — `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` — [Live verified source / contract page](https://eth.blockscout.com/address/0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0?tab=contract)

## sdYB

- **sdYB Staking** — `0xD63819Fef90981fAc8CD6240EA1f2559CD835CBa` — [Live verified source / contract page](https://eth.blockscout.com/address/0xD63819Fef90981fAc8CD6240EA1f2559CD835CBa?tab=contract)
- **sdYB Vault** — `0x8582dC9a1f0e6DeFcB2Cd3CFd6BF36B053A4cCe3` — [Live verified source / contract page](https://eth.blockscout.com/address/0x8582dC9a1f0e6DeFcB2Cd3CFd6BF36B053A4cCe3?tab=contract)
- **sdYB Strategy** — `0x30048681bf6924221f75Ecd98C42a4A3C5a7B0e3` — [Live verified source / contract page](https://eth.blockscout.com/address/0x30048681bf6924221f75Ecd98C42a4A3C5a7B0e3?tab=contract)
- **sdYB StakeDAO Gauge** — `0x28604Ff7B4aEAE28d4d9e54d14038c910844343a` — [Live verified source / contract page](https://eth.blockscout.com/address/0x28604Ff7B4aEAE28d4d9e54d14038c910844343a?tab=contract)
- **sdYB / LP Token** — `0x0c057598dcE1891688829581f890DD2a3685a43f` — [Live verified source / contract page](https://eth.blockscout.com/address/0x0c057598dcE1891688829581f890DD2a3685a43f?tab=contract)
- **sdYB Curve Pool / Yield Source** — `0x98b540fa89690969D111D045afCa575C91519B1A` — [Live verified source / contract page](https://eth.blockscout.com/address/0x98b540fa89690969D111D045afCa575C91519B1A?tab=contract)

## sdFXS

- **sdFXS Staking** — `0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183` — [Live verified source / contract page](https://explorer.mainnet.frax.com/address/0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183?tab=contract)
- **sdFXS Vault** — `0x0A4b9DC3fC75DDBEb44B581a582B5D27d09ede47` — [Live verified source / contract page](https://explorer.mainnet.frax.com/address/0x0A4b9DC3fC75DDBEb44B581a582B5D27d09ede47?tab=contract)
- **sdFXS Strategy** — `0xF64bC212C4dD190d10764B8B447C62368908c2AE` — [Live verified source / contract page](https://explorer.mainnet.frax.com/address/0xF64bC212C4dD190d10764B8B447C62368908c2AE?tab=contract)
- **sdFXS StakeDAO Gauge** — `0x12992595328E52267c95e45B1a97014D6Ddf8683` — [Live verified source / contract page](https://explorer.mainnet.frax.com/address/0x12992595328E52267c95e45B1a97014D6Ddf8683?tab=contract)
- **sdFXS / LP Token** — `0x1AEe2382e05Dc68BDfC472F1E46d570feCca5814` — [Live verified source / contract page](https://explorer.mainnet.frax.com/address/0x1AEe2382e05Dc68BDfC472F1E46d570feCca5814?tab=contract)
- **sdFXS Converter** — `0x2616Efd6F8D629dE2223924AE07A691e03240207` — [Live verified source / contract page](https://explorer.mainnet.frax.com/address/0x2616Efd6F8D629dE2223924AE07A691e03240207?tab=contract)
- **sdFXS Reward Token — WFRAX** — `0xFc00000000000000000000000000000000000002` — [Live verified source / contract page](https://explorer.mainnet.frax.com/address/0xFc00000000000000000000000000000000000002?tab=contract)

## Additional tokens / pricing

- **StakeDAO Token / SDT** — `0x73968b9a57c6E53d41345FD57a6E6ae27d6CDB2F` — [Live verified source / contract page](https://eth.blockscout.com/address/0x73968b9a57c6E53d41345FD57a6E6ae27d6CDB2F?tab=contract)
- **FXN price-fallback token** — `0x365AccFCa291e7D3914637ABf1F7635dB165Bb09` — [Live verified source / contract page](https://eth.blockscout.com/address/0x365AccFCa291e7D3914637ABf1F7635dB165Bb09?tab=contract)
- **YB price-fallback token** — `0x01791F726B4103694969820be083196cC7c045fF` — [Live verified source / contract page](https://eth.blockscout.com/address/0x01791F726B4103694969820be083196cC7c045fF?tab=contract)

---

## Explorer Bases

- **Ethereum Blockscout:** https://eth.blockscout.com
- **Fraxtal Blockscout:** https://explorer.mainnet.frax.com

Generated from the current BoostHub frontend v7 contract configuration and the v1 contract inventory.
