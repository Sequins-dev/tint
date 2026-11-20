# Slice 3 source replay comparison for open-variable

Node 24.12.0 built the typed `open-variable` corpus form against source snapshot
`cf18023ea621fbe5ead3a24cef8c3d7f0dcfb0e3cb27a4f6cea1a1258ebbe0a9`
(791 files). The target was Linux AArch64. Both builds used `TZ=UTC`,
`TINT_BUILD_ONLY=1` and `TINT_SOURCE_VALIDATION=1`. The replay image used
`TINT_SOURCE_REPLAY=1`. The owned-syntax image used `TINT_SOURCE_REPLAY=0`.

| Observation | Owned syntax | Source replay |
|---|---:|---:|
| Build exit status | 0 | 0 |
| Image bytes | 24,715,384 | 24,715,384 |
| LLDB exit status on `dev` | 0 | 0 |
| Inferior exit status after stopped-at-entry assertion | 42 | 42 |
| Source loader calls | — | 32 |
| Modules returned across loader calls | — | 1,510 |
| UTF-16 units returned across loader calls | — | 34,380,888 |

`cmp` exited 0. Both image SHA-256 values were
`18964033e914a0d11b916841aa42d0710e339aed8ef0b8c919dbc03e5ffdcced`.
Both builds used legacy general lowering for `fixture` and
`construct-helper:untyped.ts`. The first typed rejection was at
`construct-helper:untyped.ts:0:66`, with the message
`named functions require parameter and return annotations`.

The loader counts include typed and runtime preparation. This comparison
covers one graph and gives no dense-graph wall-time or peak RSS measurement.
