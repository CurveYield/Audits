# Codex / Auditor Agent Handoff V18.9

Independently compile, test, measure, and audit the V18.9 active source. Never compile or deploy `archive-do-not-run/`.

Review `auditor/CHANGE-MAP-v18.8-to-v18.9.md` first. Prove:

- arbitrary checkpoint partitions produce the same linear decay and decay-driven emissions;
- reward top-up/reservation behavior is unchanged from V18.8;
- normal migration harvests and compounds or reverts;
- emergency migration uses the same seven-day candidate delay, returns principal, and permanently disables old-strategy harvesting;
- excess-yield fees are 33% Treasury and 7% live admin, 40% total;
- all active contracts compile and fit runtime limits.

Report every failure with reproducible commands and transaction/state details.
