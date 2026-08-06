# V18.9 Deployment Runbook — Auditor Draft

Do not deploy until compilation, full tests, byte-size checks, and independent audit pass.

## Mandatory gates

- Compile Solidity 0.8.28 from a clean tree.
- Run all tests, especially checkpoint-partition and strategy-migration tests.
- Confirm all active runtime bytecode is below 24,576 bytes.
- Verify config release `18.9`, chain ID 1, addresses, allocations, fee settings, and ownership recipients.
- Verify Revenue Staking constants are 3,300 Treasury bps and 700 admin bps.
- Verify the initial Revenue Strategy reports `retired == false`.
- Simulate normal strategy migration with rewards and emergency migration with a forced harvest failure.

Abort if decay differs by checkpoint partition, normal migration can leave ordinary rewards behind, emergency migration bypasses the seven-day delay, retired strategy harvest/unpause remains possible, or any fee except the 7% admin fee routes outside Treasury.
