# Deep Assurance v6 Controller Import v1

Use the entire `curveyield-boosthub-live-audit-v1.zip` as the single Phase-0 source archive.

## Suggested Phase-0 coordinates

- Target GitHub source-freeze repository: `CurveYield/Audits`
- Suggested branch: `audit/boosthub-live-2026-08-07-v1`
- ZIP path: `source-freeze/boosthub-live-2026-08-07-v1/curveyield-boosthub-live-audit-v1.zip`
- Extraction root: `source-freeze/boosthub-live-2026-08-07-v1/extracted/`
- Controller repository: `CurveYield/audit-controller`
- Controller commit observed while packaging: `f0fe601c32f469176dddfb3428959a3b21b367f9`
- v6 skill package inspected: `Audit_V6.1_Deep_Assurance_Autonomous_Workflow_v16_5_v1.zip`
- Skill package SHA-256: `dc65e538d98d765fb88b354d893d07037417bb228f4b150416ff554a0527df11`

## Required controller identity after upload

After the atomic ZIP + extraction commit, set the campaign's exact source identity to:

- `sourceRepository = CurveYield/Audits`
- `sourceCommit = <the Phase-0 source-freeze commit SHA>`

The future commit SHA cannot be embedded before that commit exists. The package SHA-256 and complete extraction checksums are provided so the controller can verify it did not mutate source bytes during admission.

## Why the new source-freeze commit is required

The active deployment is not represented by one historical `CurveYield/Contracts` commit. Standard contracts are anchored to `5464d13029cfbdc7d46ca28f93ee577454b89d9e`, while the current cysdCRV replacement and hybrid sdYB contracts come from separate later release artifacts. This ZIP is the intentionally unified exact source set for the live-suite campaign.
