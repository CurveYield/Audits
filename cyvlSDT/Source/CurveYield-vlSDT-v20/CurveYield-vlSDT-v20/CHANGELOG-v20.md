# CurveYield vlSDT V20 Changelog

## V20 package normalization

- Normalized active package filenames, directories, test names, script names, and internal file references to V20.
- Removed the superseded `archive-do-not-run` tree and historical implementation-planning documents.
- Removed duplicate, bad, obsolete, and superseded deployment/auditor handoff artifacts that are not required for the current audit.
- Preserved the active Solidity source set, interfaces, mocks, current tests, audit scope/threat/privilege/test-plan materials, static verification tooling, and retained simulation dependencies.
- Solidity contract identifiers that encode an implementation generation (for example `CurveYieldRevenueStrategyV7`) were not renamed; only their source filenames were normalized to V20 so contract APIs and behavior are not altered by packaging cleanup.

No compilation was performed as part of this packaging update.
