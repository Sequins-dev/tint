# General JavaScript calls and loops on Darwin arm64

Tint compiler and runtime revision `206530edd2dc8df8f79d070bbae2e110a467ddbf`
was built with Node 24.12.0 and compared with Node 26.13.1 on Apple M5 Max.
Both Tint images ran the same kernels. The typed build required the strict
profile. The untyped build reported general lowering. Every launch verified
the warmup and measured checksum for each of the eight kernels. The
JavaScript-only control uses the FFI benchmark's operation and accumulator
loop in its own function, outside the FFI benchmark's polymorphic driver.

There were 15 rounds and 45 launches, with five visits to each launch
position per engine. Timing covers only the kernel call in each process.
All 30 Tint launches reached entry and exited 42 under LLDB. Every round
contributes to the medians and quartiles. One-minute load before launch
ranged from 5.09 to 7.25. Recorded CPU idle ranged from 53.05% to 80.81%
across launches with samples. The profile image preparation and the first
part of the timing run overlapped.

| Kernel              |                    Node |                  Tint untyped |              Tint typed |
| ------------------- | ----------------------: | ----------------------------: | ----------------------: |
| FFI control         |       4.16 [3.98, 4.41] |       228.62 [221.34, 244.55] |       1.18 [1.18, 1.24] |
| Closure             |       4.79 [4.63, 5.10] |       319.06 [306.40, 346.67] |       2.30 [2.27, 2.43] |
| Method              |       4.44 [4.16, 5.06] |       391.31 [376.70, 405.35] |       2.27 [2.26, 2.41] |
| Property read/write |       1.90 [1.82, 1.98] |       280.63 [275.33, 289.95] |       1.18 [1.18, 1.24] |
| Array read          |       2.05 [1.92, 2.26] |       233.09 [229.48, 254.01] |       1.60 [1.41, 1.67] |
| String equality     |       2.32 [2.15, 2.60] |       196.95 [192.83, 216.37] |       1.18 [1.18, 1.29] |
| Rest                |      9.02 [8.91, 10.14] |       940.95 [930.19, 977.72] |    20.31 [20.12, 22.37] |
| Recursive Fibonacci | 249.87 [238.15, 273.05] | 16000.31 [15547.59, 16702.43] | 114.48 [113.96, 120.50] |

Values are nanoseconds per outer iteration. The Fibonacci loop calls
`fib(8)` and `fib(9)` alternately. The raw report stores the median and
IQR of each engine's round-by-round difference from Node, the full launch
order, load, checksums, image and manifest identities.
[Raw report](general-call-benchmark-darwin-arm64-206530edd-baseline.json)

## Untyped control main-thread profile

The 15 million iteration control build enabled debug symbols and IR operation
ranges. LLDB stopped the inferior at entry. PProfessor attached with
`--main-thread --freq 997`. The inferior exited 42 and PProfessor recorded
2,325 samples over 3.55 seconds. `pprofessor analyze` resolved the stacks.
`tools/disasm/annotate.ts` matched leaf PCs against the exact image and
grouped records by machine function.

| Machine function               | Leaf samples | Attribution                                                                                                                                                                   |
| ------------------------------ | -----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findBinding`                  | 456 (19.61%) | Stack-limit load, spill, declarative record tag and linked name probes. PCs `0x10060d97c` (46), `0x10060d9bc` (49), `0x10060d9cc` (23), `0x10060da1c` (11).                   |
| `lookupIdentifierValue`        |  132 (5.68%) | Scope traversal. PC `0x10061d29c` loaded the current scope spill (26).                                                                                                        |
| `callObject`                   |  105 (4.52%) | Call dispatch and managed closure/result work. PC `0x1005ecedc` loaded the allocation state (11).                                                                             |
| `remember-object`              |  105 (4.52%) | GC write barrier. PC `0x10097d53c` loaded the card byte (23).                                                                                                                 |
| `getBindingValue`              |  101 (4.34%) | General get after resolution and during per-iteration binding copying.                                                                                                        |
| Source context entry           |   98 (4.22%) | Trace frame setup and restoration. PC `0x10062d938` reloaded a saved value (25).                                                                                              |
| `createDeclarativeEnvironment` |   77 (3.31%) | Environment allocation. The control lowers to a new declarative record on each iteration and each expression-arrow invocation. PC `0x10060cbdc` loaded allocation state (13). |
| `runScriptContext`             |   55 (2.37%) | Saving and restoring active definition context around the call.                                                                                                               |
| `collect`                      |   50 (2.15%) | Collector self cost.                                                                                                                                                          |

The control has zero call arguments and the callee does not observe an
`arguments` object. The lowered caller still materializes the internal empty
argument list. These samples do not assign a separate cost to that list.
Native general values transport category/payload words. The arithmetic and
update helpers are sampled, but this profile does not identify a numeric
heap box as the main loop cost.

Profile SHA-256 `4bc5c3daaf9629992e01f147b4baa95fe306f22d58083664cf523b47f3325ee9`.
Image SHA-256 `ac88fbc02d7fdfc8c68a66586d042ff58517207ac448f82f648933c5e70f4166`.
Build manifest SHA-256 `23c9d3b8ccf1b18a73f6f1d5b404aa3659aab865bd0040ba1f66475387523496`.
