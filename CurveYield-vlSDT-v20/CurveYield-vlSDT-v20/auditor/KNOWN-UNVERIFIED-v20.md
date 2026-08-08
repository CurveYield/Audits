# Known Unverified Items V20

No Solidity compiler or executable Hardhat test was run while preparing this package.

Unverified items include:

- Solidity syntax/type correctness beyond structural text checks.
- Exact daily-versus-annual on-chain equality under compiler rounding.
- Cap-crossing integration rounding across arbitrary checkpoint partitions.
- Exact runtime and creation bytecode sizes.
- Normal retirement against every supported reward token and converter route.
- Emergency migration behavior against live Revenue Staking implementations.
- Reward recovery policy for rewards intentionally abandoned during emergency retirement.
- Gas cost of Yield Staking checkpoints after the added integration logic.
- Deployment/fork simulations, ownership handoff, explorer verification, and live RPC behavior.
