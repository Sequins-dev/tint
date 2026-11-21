# Inline primitive value operations on Darwin arm64

The static-scope candidate and the inline-value candidate completed 16
rotated rounds with identical checksums. Every native launch stopped at
entry and exited with status 42. The typed images were byte identical.
[Raw paired rounds](general-call-inline-value-operations-darwin-arm64.json)

| Kernel          | Node 26.13.1 median (ns) | Static scopes (ns) | Inline values (ns) | Paired change (ns) |     Paired IQR (ns) |
| --------------- | -----------------------: | -----------------: | -----------------: | -----------------: | ------------------: |
| Array           |                     3.97 |             176.04 |             153.85 |             -21.81 |    -30.31 to -17.45 |
| Closure         |                     9.58 |             199.99 |             171.99 |             -29.34 |    -34.32 to -24.07 |
| Control         |                     8.01 |               2.07 |               1.91 |              -0.08 |       -0.46 to 0.22 |
| Method          |                     9.93 |             335.25 |             313.97 |             -22.01 |    -37.73 to -12.05 |
| Property        |                     3.68 |             222.47 |             192.85 |             -29.67 |    -36.75 to -14.48 |
| Recursive       |                   500.78 |           17229.47 |           15651.65 |           -1964.74 | -2891.52 to -996.67 |
| Rest            |                    20.83 |            1356.28 |            1274.28 |             -57.28 |    -138.71 to 22.44 |
| String equality |                     4.33 |              80.45 |              57.03 |             -25.12 |    -29.60 to -18.71 |

Number, Boolean, undefined and null tags select native scalar operations
for arithmetic, update, comparison and truthiness. Coercions involving
objects, strings, BigInts or other slow cases still use the existing
runtime helpers. The numeric path writes its value directly. The update
result record remains on the slow path.

## Frozen v7 comparison for static scopes

Three paired rounds compared `206530edd` with the static-scope record-table
candidate. All six native compiler executions exited with status 0 and
produced byte-identical images. The paired median wall time fell by 40.580
seconds. Peak RSS rose by 819,200 bytes, so this run did not meet the RSS
budget. The comparison covers the static-scope candidate before the
inline-value change. [Frozen rounds](general-call-frozen-v7-darwin-arm64-static-scopes.json)
