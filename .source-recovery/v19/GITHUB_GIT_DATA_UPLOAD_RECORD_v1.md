# GitHub Git Data Upload Record v1

- Project: `vlsdt`
- Audit source version: `v19`
- Source branch: `audit/vlsdt-v19-route-6-v1`
- Required staging layout: exact `(Z)` ZIP plus exact `(U)` extraction
- Source archive: `CurveYield-vlSDT-v19-router-claim-fixed-minimal-marketplace-route(2).zip`
- Archive byte length: `725591`
- Archive SHA-256: `cd331a1d9c886dc68cf4a4167bdf3e93e1085ab0263cc81aec77b28754c01cae`
- Archive expected Git blob SHA-1: `c435805e498c0bf38a9d8bcc18457aa1ed67e9c5`
- Archive regular-member count: `228`
- Planned repository source-file count: `229` (`1` untouched `(Z)` archive + `228` `(U)` regular members)
- Planned unique source blob count: `226`
- Planned source-byte total: `3298915`

## Durable extracted-file hash map

The package's own `Source-Manifest-v19.sha256` is the canonical extracted-file SHA-256 map for its listed payload. It is itself separately bound here because a checksum manifest cannot safely self-hash.

- Planned `(U)` manifest path: `CurveYield-vlSDT-v19-router-claim-fixed-minimal-marketplace-route(2)/(U) CurveYield-vlSDT-v19-router-claim-fixed-minimal-marketplace-route(2)/CurveYield-vlSDT-v19-router-claim-fixed-minimal-marketplace-route/Source-Manifest-v19.sha256`
- Manifest byte length: `27045`
- Manifest SHA-256: `42b02eca3cda6343466082b0bf2167b388104fe0bd514bb3e9c22acb098c2f70`
- Manifest expected Git blob SHA-1: `766692a3d44b3fd0b592cfd3ea2c53ceb0f6b345`
- Manifest-listed payload entries: `226`
- Full local object-map SHA-256 used for pre-staging reconciliation: `373a6accb45dcf545623745d829841d22cc55bc0b8a48b803e223c2e5fecb2c5`

The final source-staging operation is not admitted until the committed `(Z)` object has Git blob SHA `c435805e498c0bf38a9d8bcc18457aa1ed67e9c5`, the committed `(U)` manifest has Git blob SHA `766692a3d44b3fd0b592cfd3ea2c53ceb0f6b345`, all 228 regular archive members are safely extracted, and all manifest-listed SHA-256 values validate against committed extracted bytes.

## Git Data transport record

The connected GitHub application's `create_blob` action is available and is used as the authenticated Git Data plane. Its schema accepts a literal text `content` argument but does not accept a mounted local file path. The 725591-byte archive Base64 representation is 967456 ASCII characters, exceeding the connector's safe single-result literal transport window in this runtime. Local authenticated Git/Git-LFS and direct outbound GitHub access were independently checked and are unavailable.

To preserve the exact-byte contract without operator intervention, the already-authorized `CurveYield/Audits` GitHub Actions transport is used only to concatenate bounded Base64 transport blobs created through the authenticated Git Data API. The recovery program uses Python standard library only, performs no dependency installation and no contract compilation, then verifies archive byte length, SHA-256, Git blob SHA, safe ZIP membership, exact regular-member count and internal manifest before committing `(Z)` and `(U)`. Temporary transport chunks and the one-shot request are removed in the source-staging commit.

- Recovery program Git blob: `e2b6b83b4e067b4861d5a00279f324acbe0cd6cc`
- Recovery workflow Git blob: `d06cb59c5f2111829b402e217dbeff145431298b`
- Recovery scaffold commit: `da06b175e3f9683f45e019b536b452abe6bbbdcd`
- Base64 transport length: `967456`
- Bounded transport blob count: `54`
- Transport chunk size: `18000` ASCII characters except final chunk

This is a transport-layer recovery only. It does not alter, repack, normalize, compile or execute the submitted source archive.
