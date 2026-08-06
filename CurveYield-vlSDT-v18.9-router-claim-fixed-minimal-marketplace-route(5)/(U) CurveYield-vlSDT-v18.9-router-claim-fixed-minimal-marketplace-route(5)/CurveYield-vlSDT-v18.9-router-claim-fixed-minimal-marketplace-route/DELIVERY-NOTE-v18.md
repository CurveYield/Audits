# CurveYield vlSDT Liquid Locker V18.9 Auditor Delivery Note

V18.9 is a corrective source handoff for M-01 and M-02. Compiler artifacts are
omitted, but the source was clean-compiled, runtime-size checked, statically
checked, and exercised through a complete real-mainnet-fork simulation.

Primary review targets:

1. Checkpoint-independent additive linear decay and reward integration.
2. No changes to cyGOV top-up, reservation, or funding mechanics.
3. Strict harvest/compound-or-revert normal strategy retirement.
4. Seven-day delayed emergency strategy upgrade and permanent old-strategy retirement.
5. 33% Treasury + 7% live-admin fee on yield above benchmark.
6. Exact compiled byte sizes and executable regression tests.

No Solidity compilation was attempted by explicit instruction.
