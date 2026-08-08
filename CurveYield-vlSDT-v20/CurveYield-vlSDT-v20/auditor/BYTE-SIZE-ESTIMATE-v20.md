# Byte-Size Estimate V20

No Solidity compiler was invoked. These are conservative engineering estimates based on source size and prior measurements, not deployability proof.

EIP-170 deployed-runtime limit: **24,576 bytes**.

| Deployable contract | Source bytes | Non-comment bytes | Functions | Conservative runtime estimate | Assessment |
|---|---:|---:|---:|---:|---|
| CurveYieldGovernanceStaking | 50,687 | 48,181 | 92 | 19,000–22,500 | Exact compile mandatory |
| CurveYieldVlSDTRevenueStaking | 38,282 | 36,992 | 54 | 16,000–22,500 | Exact compile mandatory |
| CurveYieldVlSDTLocker | 35,076 | 31,821 | 55 | 15,000–22,500 | Exact compile mandatory |
| CurveYieldGovernanceToken | 31,975 | 29,782 | 47 | 14,500–21,500 | Exact compile mandatory |
| CurveYieldVlSDTBoostStaking | 28,469 | 27,179 | 35 | 13,000–20,000 | Exact compile mandatory |
| CurveYieldCyGovYieldStaking | 25,817 | 24,379 | 36 | 10,500–17,500 | Increased for cadence-independent integration |
| CurveYieldRevenueStrategyV7 | 17,711 | 16,954 | 34 | 9,500–15,500 | Increased for dual retirement paths |
| CurveYieldGovernanceBoostStrategy | 17,345 | 17,116 | 22 | 9,000–14,000 | Exact compile mandatory |
| CurveYieldVlSDTBoostMerchant | 11,264 | 9,974 | 12 | 6,000–11,000 | Exact compile mandatory |
| CurveYieldGovernanceMintController | 10,897 | 10,659 | 12 | 5,500–9,500 | Exact compile mandatory |
| CurveYieldRevenueVaultV7 | 9,869 | 8,871 | 20 | 5,500–10,000 | Increased for emergency upgrade path |
| CurveYieldRevenueConverter | 6,517 | 5,878 | 8 | 4,000–7,500 | Exact compile mandatory |
| CurveYieldCyGovDistributor | 6,144 | 6,015 | 9 | 3,500–6,500 | Exact compile mandatory |
| CurveYieldVlSDTToken | 2,398 | 1,108 | 2 | 1,500–3,500 | Exact compile mandatory |

The auditor must report compiler/optimizer settings, creation bytes, deployed runtime bytes, EIP-170 headroom, and reproducible standard-json hashes for every active deployable.
