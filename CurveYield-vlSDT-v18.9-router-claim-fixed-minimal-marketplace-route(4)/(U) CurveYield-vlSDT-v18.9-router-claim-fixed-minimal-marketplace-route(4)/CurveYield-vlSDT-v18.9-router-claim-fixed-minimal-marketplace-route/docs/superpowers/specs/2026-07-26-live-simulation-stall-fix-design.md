# V18.9 Live Simulation Stall Fix Design

## Goal

Identify the exact post-configuration operation that stalled the reviewed V18.9 mainnet-fork simulation, fix only the proven root cause, and complete a fresh 30-day run with evidence.

## Constraints

- Preserve `deployment-v18/simulate-live-deployment-30d-v18.9.js` byte-for-byte at its approved SHA-256.
- Do not fabricate balances, rewards, time cycles, or external integrations.
- Keep the RPC secret only in memory and out of files and logs.
- Do not change contract behavior or production configuration merely to make the simulation pass.
- Report genuine zero rewards and configuration blockers honestly.

## Approach

Create a disposable diagnostic copy of the reviewed runner. Enable post-configuration provider tracing that records only local JSON-RPC request IDs, methods, completion/error status, and major stage boundaries. This distinguishes an unreturned RPC request from a project promise, transaction confirmation, or loop.

After the trace proves the exact failure:

1. Add a focused regression test that fails against the current implementation.
2. Apply one minimal fix in a separately named fixed script or shared simulation helper.
3. Run the regression test, existing tests, syntax check, and compilation.
4. Run the complete 30-day mainnet-fork simulation with bounded stage diagnostics retained in its evidence log.

## Alternatives Considered

- **Repeat the unchanged run:** rejected because it reproduces the ambiguity and can hang indefinitely.
- **Replace Anvil or the RPC:** rejected because direct RPC and fresh-Anvil tests completed the suspected external calls in 0–3 seconds.
- **Add broad retries everywhere:** rejected because it would mask the root cause and could duplicate state-changing transactions.

## Success Criteria

- The exact stalled operation is demonstrated by trace evidence.
- The approved reviewed script remains unchanged.
- A regression test fails before the fix and passes afterward.
- The full fork run either completes or produces a bounded, exact failure with a machine-readable report.
- No arbitrary rewards or principal are injected.

