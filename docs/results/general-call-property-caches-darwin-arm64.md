# Property and method caches on Darwin arm64

Sixteen rotated rounds compared positional calls with caches for constant
property names. Each native execution stopped at entry and exited with
status 42, and checksums matched. The typed image was byte identical.
[Raw paired rounds](general-call-property-caches-darwin-arm64.json)

| Kernel          | Node 26.13.1 median (ns) | Positional calls (ns) | Property caches (ns) | Paired change (ns) |     Paired IQR (ns) |
| --------------- | -----------------------: | --------------------: | -------------------: | -----------------: | ------------------: |
| Array           |                    18.35 |                207.25 |               186.39 |              -8.89 |     -84.87 to 12.26 |
| Closure         |                    13.85 |                103.42 |               101.47 |              -1.31 |     -23.86 to 19.06 |
| Control         |                     9.22 |                  1.91 |                 1.89 |              -0.00 |       -0.31 to 0.23 |
| Method          |                    14.33 |                258.34 |               154.77 |            -106.15 |   -143.88 to -80.92 |
| Property        |                     4.34 |                268.49 |                70.37 |            -191.26 |  -274.06 to -166.12 |
| Recursive       |                   758.65 |               8513.56 |              8792.55 |             150.44 | -1237.72 to 1171.54 |
| Rest            |                    41.95 |               2266.07 |              2070.41 |             -18.07 |   -389.99 to 470.96 |
| String equality |                     4.26 |                129.88 |                65.31 |             -55.82 |     -119.34 to 3.85 |

Each read site records the shapes along the resolved prototype chain and
an offset in the final object's descriptor list. Write sites cache own
writable data descriptors. Objects retain their own descriptors and sites
retain shape names and offsets. Layout changes, deletion and prototype
replacement invalidate the guard. Getter, setter and proxy traffic uses
the ordinary runtime path with the original receiver and operation order.
