# AArch64 integer-use audit

The frozen v5 and v7 compilers and the current self-compiled image were
emitted with the Node 24.12.0 toolchain from
`9c5c7f1cfd7145fb946025e87dbe2cfa510ba9f8`, with
`tools/bootstrap-compiler.ts --operation-ranges` and `TZ=UTC`. The v5
image used the original runtime sources. The v7 image used the existing
matched collector and runtime overlay from the general-calls experiment.
The self-compile used a fresh compiler-source snapshot. The Node-hosted
image and the native-produced stage 2 matched byte for byte. The native
inferior stopped at entry and exited 0 under LLDB. The image SHA-256 is
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.

The audit followed AArch64 conversion results through 64-bit register
moves and stack spill/reloads within an emitted IR block. It intersected
known origins at forward branch joins and dropped call-clobbered
registers. A consuming `fcvtzs`, `fcvtzu`, or conversion in a known leaf
helper counted once at the consumer site. The helper entries covered
`ToUint32`, array copy and the clamped position in `startsWith`.
These are conservative static site counts over program operation ranges.
Cross-block slot histories, interprocedural value flow, backward edges
and separate allocator/runtime ranges lack provenance in this audit.
A conversion attributed to a consumer may have been forced by another
use of the same value. The counts carry no execution-frequency weight.

| Conversion consumer                                                                                               | Frozen v5 | Frozen v7 | Self-compiled |
| ----------------------------------------------------------------------------------------------------------------- | --------: | --------: | ------------: |
| `reference-vector-new`                                                                                            |     1,750 |     1,813 |         2,285 |
| `string-starts-with`                                                                                              |        95 |        96 |           103 |
| `array-new`                                                                                                       |        14 |        14 |            14 |
| `array-subarray`                                                                                                  |         4 |         4 |            13 |
| `binary:%`                                                                                                        |        11 |        11 |            10 |
| C memory, unary signs, host arguments, array copy, reference-vector copy, string allocation/write/from-code-units |         0 |         0 |             0 |
| All observed conversions                                                                                          |     3,773 |     3,614 |         4,448 |

The table includes conversions originating from both `scvtf` and
`ucvtf`. For example, the v7 remainder count contains seven signed and
four unsigned origins. The per-function counts with signed and unsigned
origins, image hashes, and operation-range denominators are in the
[JSON Lines ledger](integer-uses-audit-v1.jsonl). Function offsets are
relative to the image text section and disambiguate specializations.

The crypto reproduction contains one additional site in
`String.fromCharCode(((bytes[0] ?? 0) & 15) | 48)`. The `scvtf` at text
offset 550060 spills the result of the bitwise OR. The from-code-units
range reloads the same double and calls `ToUint32` at offset 550292.
The optimized byte value is already an exact integer, and the UTF-16
store consumes its low 16 bits.

There were also 1,127 / 1,181 / 1,468 slot-store consumer sites, and
200 / 203 / 228 call-range consumers. A call range can contain an
already-specialized inline list access or a guard. This does not
establish where an ordinary typed argument converted back to an
integer in its callee. Typed parameter conventions, record field
layouts and returns are deferred. That keeps this work independent of
the general-call lowering in [PR #7](https://github.com/Sequins-dev/tint/pull/7).
