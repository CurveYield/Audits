# WalletConnect Setup v11

1. Open `src-v11/runtime-config.js`.
2. Set the public Reown / WalletConnect project ID in the existing runtime configuration field.
3. Do not place private keys, RPC secrets, or server credentials in the frontend bundle.
4. Re-run the release tests and regenerate the release manifest after changing the public project ID.

The Cloudflare yield-history API does not require or use the WalletConnect project ID.
