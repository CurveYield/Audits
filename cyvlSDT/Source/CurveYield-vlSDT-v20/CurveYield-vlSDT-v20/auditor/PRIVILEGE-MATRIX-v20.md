# Privilege Matrix V20

| Component | Privileged actor | Capability | Delay / limit |
|---|---|---|---|
| Revenue Vault | Owner | Propose replacement strategy | Candidate must match vault/want |
| Revenue Vault | Owner | Normal strategy upgrade | Seven-day candidate delay; strict harvest must succeed |
| Revenue Vault | Owner | Emergency strategy upgrade | Same seven-day delay; skips rewards, permanently retires old strategy |
| Revenue Strategy | Vault only | Normal or emergency retirement | Permanent after execution |
| Revenue Strategy | Owner | Fees, Treasury, converter proposal, pause | Existing caps; converter replacement ten days |
| Revenue Staking | Admin | Receives 7% fee on excess yield; may transfer admin role | Sole non-Treasury protocol fee |
| Revenue Staking | Owner/Admin | Existing notifier/reward/fee controls | Existing contract rules |
| cyGOV Yield Staking | Owner | Target, max rate, withdrawal fee, decay rate | Seven-day setup window, then 14-day timelock |
| cyGOV Yield Staking | Anyone | Checkpoint/sync interactions | Cannot change deterministic elapsed-time outcome |
| Governance Token | Owner/minters | Existing allocation/reservation controls | Protected reservation constraints |
