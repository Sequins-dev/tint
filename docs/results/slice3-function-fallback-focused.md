# Slice 3 focused function fallback and typed image comparison

Node 24.12.0 built these Linux AArch64 images with `TZ=UTC` and
`TINT_BUILD_ONLY=1`. Each image ran under LLDB on the shared `dev` machine.
All builds and LLDB commands exited 0, and every inferior stopped at entry
and exited 42. The candidate source manifest captured
`3a0c521264acfededa60aa75367895410796c04e1d9c97a03ecc8d8f7f3eaa3b`.

| Typed corpus form | Compilation path | Function source range | Bytes | SHA-256 |
|---|---|---|---:|---|
| `arguments-object` | mixed | `count`, UTF-16 0–73 | 24,614,216 | `7fb20b01107c06c35bd869ecdaa04cfd0fcc61a2be7e9a2bf334e029bb267fec` |
| `arguments-object` | whole module | — | 24,614,568 | `926423a8bc79903eab6e86fe856731d60c8705c841e8f72e609b9359c1e3ceda` |
| `arguments-function-fallback-reentry` | mixed | `read`, UTF-16 50–162 | 24,712,232 | `44ab3f9a851d0717dd51a2d3d104e5991f18128f49e480619d1d55bad9b3b654` |
| `arguments-function-fallback-throw` | mixed | `read`, UTF-16 39–102 | 24,705,576 | `08e3fa820e1a94e85d7be97eda96676da99829e3a75357cdd7af354b79701d5c` |

Both `arguments-object` builds used the same source snapshot and
`TINT_SOURCE_VALIDATION=1 TINT_SOURCE_REPLAY=1`. The mixed build added
`TINT_FUNCTION_FALLBACK=1`. The mixed image was 352 bytes smaller.
Earlier prototype measurements exceeded the module image by 52,768,
8,304, 1,392 and 9,216 bytes. The final adapter shares the runtime call
path and passes only the argument count to the selected function.
The reentry fixture checks that its captured count survives an inner
call with fewer arguments. The throw fixture sends a primitive through
both call boundaries and checks its value in the typed catch.

For the typed-only comparison, a source archive of main
`a282ba01dadcc3a04fa5a5bff81e7ef980a5b4a0` and the candidate each built
`numeric-loop` with `TINT_GENERAL_FALLBACK=0`. The main archive's source
manifest captured
`d8f8dc662c1d8e53b9e82b899d055e58a29744a66aa7a116f866b5ed2c32f8ae`.
`cmp` exited 0. Both images were 566,584 bytes with SHA-256
`9063fcb2c758c7a1c6e20dcc1fd102c91e8891d354c822d2be35ee1e90fd59ce`.

This report covers one typed-only executable and one matched mixed image
size comparison. The compiler stage fixpoint, startup, crossing cycles
and allocation counts remain unmeasured.
