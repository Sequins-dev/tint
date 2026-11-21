# Specialized call and loop instruction traces

The arm64 debug image had SHA-256
`ecc3ec0990faf6235156f94ac58e8b2f8b2d1a4091485fd78bce2285039f0f7f`.
LLDB stopped at entry and at each kernel's hot sampling address. Each
loop window ends at the same address and stack pointer. The fib window starts
at `fib(2)` and ends at the caller's saved return PC and stack pointer.
All eight checksums matched and the inferior exited with status 42.

| Window          | Source iterations | Retired instructions | Calls | Stack-map crossings | Managed allocations |
| --------------- | ----------------: | -------------------: | ----: | ------------------: | ------------------: |
| Array           |                 4 |                  274 |     2 |                   2 |                   0 |
| Closure         |                 4 |                  230 |     4 |                   4 |                   0 |
| Control         |                 4 |                   15 |     0 |                   0 |                   0 |
| `fib(2)`        |                 — |                   65 |     2 |                   2 |                   0 |
| Method          |                 4 |                  348 |     4 |                   4 |                   0 |
| Property        |                 1 |                   21 |     0 |                   0 |                   0 |
| Rest            |                 4 |                   58 |     0 |                   0 |                   0 |
| String equality |                 2 |                   94 |     0 |                   0 |                   0 |

The control uses one signed accumulator update for each four-iteration group.
All 15 retired instructions are register operations or loop branches. Return PCs were matched against the image’s compact stack maps. There
are no safepoints or write barriers in that window. The array's remaining calls
are typed `readNumberList` loads. The closure and method windows call their
compiled numeric bodies from the specialized loop. The fib window
makes its two recursive calls using the unboxed numeric entry. The property
and rest loops were inlined into their dispatch wrappers. The first two trace
attempts identified those inlined paths after the out-of-line breakpoints
went unhit.

[Per-window call and allocation counts](general-call-final-kernel-traces-darwin-arm64.jsonl),
[general baseline trace](general-call-control-and-kernel-traces-darwin-arm64-77ae22dbe.md)
