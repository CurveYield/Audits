# Threat Model V20

## New or changed threats

1. **Checkpoint manipulation:** a permissionless caller attempts to alter decay or emissions by choosing checkpoint frequency. Mitigation: cumulative rate-seconds and integrated linear reward accounting.
2. **Decay extinction:** elapsed time consumes the entire epoch principal. Mitigation: active reward time is bounded to the zero-principal timestamp and the epoch closes atomically.
3. **Cap crossing:** target emissions move from above to below `maxMintRate` during an interval. Mitigation: explicit capped/uncapped integral split.
4. **Migration reward stranding:** ordinary rewards remain assigned to a retired strategy. Mitigation: normal retirement requires strict harvest/compound.
5. **Harvest-bricked migration:** a broken reward token, converter, or staking claim prevents principal migration. Mitigation: delayed owner-only emergency upgrade that skips rewards.
6. **Obsolete strategy restaking:** public harvest is called after emergency migration. Mitigation: permanent `retired` state plus pause; `unpause()` reverts forever.
7. **Emergency reward loss:** emergency migration intentionally leaves unclaimed rewards at the old strategy. This is an explicit liveness-over-reward-recovery tradeoff and must be tested/documented.
8. **Fee routing:** 33% excess must reach Treasury and 7% only the live admin-role address; all other protocol fees must follow Treasury rules.

Existing token-allocation, reservation, governance, withdrawal, converter, oracle, and reward-token risks remain in scope.
