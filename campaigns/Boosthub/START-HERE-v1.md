# Boosthub Deep Assurance v6 — Phase 0 Start Here v1

Campaign: `boosthub-v2-2026-08-07-v1`
Generation: `617292385dd1ec9cc4bbbd3ddfdaefc4`

Canonical bootstrap order:

1. `Audit Boosthub 0`
2. `Audit Boosthub 7`
3. `Audit Boosthub 1`
4. `Audit Boosthub 2`
5. `Audit Boosthub 3`
6. `Audit Boosthub 4`
7. `Audit Boosthub 5`
8. `Audit Boosthub 6`

Agents 1–4 must each be opened in a new private ChatGPT Project with project-only memory, one chat, no prior files, and no prior audit content. Agents 5–7 are control-only standby during bootstrap. Agent 0 is cold Orchestrator replacement.

Every numbered chat must resolve its pointer under `.deep-assurance/bootstrap/boosthub-v2-2026-08-07-v1/`, create its own safe-future hourly `exact_schedule` poll, immediately disable and re-fetch it, and register the real task receipt. During bootstrap it must not read `Boosthub/Source/`.
