# Node FFI after the shared-block registry merge

Node 26.13.1 and Tint `8cf9a9389a59a4a59f2d02e7c7219635636a687f` ran on an Apple M5 Max
with 20,000 warmups and 100,000 measured calls per case. Nine rounds
rotated order under the shared timing lock. All 270 measurements verified
their checksums. LLDB confirmed exit 42 for all 18 native launches.
The host was contended. One-minute load was 5.17
before the run and 11.78 afterward.

| Case | Node | Tint literal | Tint runtime |
| --- | ---: | ---: | ---: |
| arity-0 | 11.0 | 339.1 | 364.9 |
| arity-1 | 21.1 | 389.7 | 397.5 |
| arity-2 | 29.3 | 420.7 | 444.5 |
| arity-4 | 158.4 | 481.2 | 550.5 |
| arity-8 | 127.4 | 579.3 | 679.8 |
| arity-12 | 190.5 | 703.7 | 854.9 |
| arity-24 | 351.4 | 1035.7 | 1276.4 |
| buffer | 80.4 | 441.1 | 436.6 |
| callback | 101.0 | 661.4 | 676.2 |

Values are median nanoseconds per call. Node led all nine cases in
both definition modes. The parity check exited 2.

## Diagnostic controls

The main-thread profiles and lower-contention baseline are in the
[performance investigation](node-ffi-benchmark-darwin-arm64-cf6faaf6b-v3.md).
The merged JavaScript-only control took 231.6 ns
in the literal image, 231.7 ns in the runtime
image, and 2.4 ns in Node. A separate contended
diagnostic inlined each call into its loop and removed the closure
from the constant-return control. The control took
209.6 ns and 230.0 ns
in Tint.

A five-round comparison rotated Node, the merged binaries, and a
compiler prototype. The prototype materialized fixed argument lists in one
operation, tested the numeric tag directly, and embedded the scalar kind
in generated wrappers. Arity 24 improved from 1812.3 to
1442.3 ns for literal definitions and from
1956.4 to 1787.9 ns for runtime
definitions. Buffer latency increased in both modes during this contended
run. These changes remain experimental. Parity and irreducibility remain
unestablished.

## Byte budgets

The 10-million-call FFI leaf images match main `1e56551e3` byte for byte.
Both hash to `9100616df7d3978a91d1dd21f89b562aa261b4faca907d59588461fcb8868753`.
The frozen v7 executable text matches with SHA-256
`bba7c0999174197a90559575f4f969973f825024df4fc3f82448ceabfec084fa`.
Both frozen compiler images exited 0 under LLDB and emitted the same
48,843,002-byte output with SHA-256
`68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.

The raw merged benchmark SHA-256 is `ed8b2ae4f83bfcaf2409a5241a6f8adb57afab4bb5ca706cf8cdcfbe0bddaba7`.
The inline diagnostic SHA-256 is `47636d26f1e649bb072f0308dad329a821a35dd435c3fe74190dd0cfa20574fb`.
The five-engine comparison SHA-256 is `57181aa64801f529ed0d77c379a895477d5ba3b54061a8812ada5fa215eb09a5`.
