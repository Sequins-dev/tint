# Slice 3 fixed numeric call probes

Node 24.12.0 built the typed `arguments-function-fallback-numeric` and
`arguments-function-fallback-throw` forms as Linux AArch64 images with
`TZ=UTC TINT_BUILD_ONLY=1 TINT_SOURCE_VALIDATION=1 TINT_SOURCE_REPLAY=1`.
The mixed builds added `TINT_FUNCTION_FALLBACK=1`. The captured workspace
SHA-256 was
`9582d3e1a0708676dd8d5dc13f0ae70f98f59ea769852ac2a47ffeedd34fbbed`.

| Form | Path | Bytes | SHA-256 |
|---|---|---:|---|
| `arguments-function-fallback-numeric` | mixed | 24,650,904 | `bd9c4983ad20e7b0b6479fe547a485f51d8fac22c44142eb9d83a5a4dad295e5` |
| `arguments-function-fallback-numeric` | whole module | 24,661,992 | `145343a4a339f68a02f1d29497178558ee55fd373fa3f5df87578cc5038f5e32` |
| `arguments-function-fallback-throw` | mixed | 24,631,944 | `a7aa226316c6475d5385bf088c4c009ef54cefca0e2ed175b52bad4551f056b1` |

All three builds and LLDB invocations on `dev` exited 0. Each inferior
stopped at entry and exited 42. The mixed numeric image was 11,088 bytes
smaller. The earlier synthetic callable route produced a working 24,710,248-byte
image. Eliding the Error view code first exposed an unresolved
`toRealmError` reference. The corrected synthetic route emitted 24,676,568
bytes and returned 42, which still exceeded the image budget. The final
route lowers known immutable numeric calls to direct checked imports,
eliminating the synthetic callable and generic argument list for that direction.
The typed entry reuses its argument buffer. This run did not measure
allocation counts or startup time.

The native-subset audit checked 638 functions from the general lowering
entry. A separate `perf stat -e cycles,instructions -- true` probe on
`dev` reported both hardware events as unsupported.
