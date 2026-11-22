# Positional source calls on Darwin arm64

Sixteen rotated rounds compared inline primitive operations with the
positional call trial. All native executions stopped at entry, matched
the expected checksums and exited with status 42. The typed benchmark
image was byte identical. [Raw paired rounds](general-call-positional-calls-darwin-arm64.json)

| Kernel          | Node 26.13.1 median (ns) | Inline values (ns) | Positional calls (ns) | Paired change (ns) |       Paired IQR (ns) |
| --------------- | -----------------------: | -----------------: | --------------------: | -----------------: | --------------------: |
| Array           |                     3.98 |             161.56 |                168.58 |               6.83 |       -14.71 to 26.87 |
| Closure         |                     9.25 |             180.33 |                 93.87 |             -81.36 |      -97.60 to -73.42 |
| Control         |                     9.05 |               1.91 |                  1.89 |              -0.02 |         -0.18 to 0.18 |
| Method          |                     9.73 |             343.46 |                239.16 |            -100.27 |     -127.15 to -80.92 |
| Property        |                     3.55 |             209.30 |                207.32 |              -9.32 |        -63.16 to 7.75 |
| Recursive       |                   597.64 |           17201.06 |               7888.34 |           -9773.35 | -12589.77 to -8640.33 |
| Rest            |                    23.32 |            1423.48 |               1459.99 |              29.52 |     -138.94 to 124.58 |
| String equality |                     4.93 |              59.76 |                 64.78 |               6.21 |         1.78 to 12.85 |

The positional entry accepts zero to two fixed arguments. Its realm and
Script or module guards preserve the callee's execution context. The fast
path bypasses the realm callback, argument list and result record. Sloppy
caller reflection retains the passed arguments in reusable frame fields
and materializes a list if the legacy accessor is read. The ordinary
dispatch handles reflective, spread, rest, cross-realm and exotic calls.

The trial measured a string-equality slowdown of 6.21 ns per iteration.
The managed-surface validation subsequently required changing the order of
the entry helper's parameters to distinguish its type from the callback.
This table records the original positional trial.

The same frozen scope toolchain passed both whole-program smoke variants.
[Whole-program smoke](general-call-static-scopes-test262-program.json)
