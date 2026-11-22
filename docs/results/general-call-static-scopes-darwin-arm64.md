# Static scope resolution on Darwin arm64

Sixteen rotated rounds compared the existing numeric-loop build with the
static-scope build. Every checksum matched, and LLDB verified the native
entry stop and exit status 42. The two typed benchmark images had the
same SHA-256. The native-validation rebuild of the untyped benchmark
also reproduced the measured untyped image SHA-256. [Raw paired rounds](general-call-static-scopes-darwin-arm64.json)

| Kernel          | Node 26.13.1 median (ns) | Before (ns) | Static scopes (ns) | Paired change (ns) |        Paired IQR (ns) |
| --------------- | -----------------------: | ----------: | -----------------: | -----------------: | ---------------------: |
| Array           |                     5.77 |      220.94 |             209.66 |             -14.57 |        -31.13 to -7.51 |
| Closure         |                    10.75 |      347.01 |             220.44 |            -124.20 |     -135.91 to -110.30 |
| Control         |                     6.49 |        1.90 |               1.99 |              -0.00 |          -0.07 to 0.47 |
| Method          |                    11.08 |      477.71 |             374.24 |            -102.64 |      -112.63 to -83.19 |
| Property        |                     3.96 |      266.46 |             256.23 |             -20.68 |         -31.53 to 3.89 |
| Recursive       |                   560.05 |    31224.11 |           19390.26 |          -11513.64 | -14883.79 to -10515.45 |
| Rest            |                    29.73 |     1715.14 |            1487.48 |            -181.06 |      -377.56 to -66.11 |
| String equality |                     4.46 |      187.83 |              83.52 |            -101.44 |      -108.99 to -90.33 |

The paired IQR excludes zero for six kernels. The short control window
includes V8 tiering. The [longer control comparison](general-call-control-and-kernel-traces-darwin-arm64-77ae22dbe.md)
records its steady-state gap separately.

At `b51cf81a3`, the concurrent workspace gate reported 6,050 passes,
zero failures and one skip. A frozen linked-unit Test262 host passed
both variants of the object initializer smoke test. The focused Darwin
moving-collector fixture exited with status 42 after preserving an object
held only by a promoted parameter and another retained by a by-value
closure. [Linked-unit smoke](general-call-static-scopes-test262-units.json)
