# Native instruction accounting for the JavaScript control loop

The two arm64 Mach-O images were built from
`ac299b208f9daa9a721a26b569234e383053a621` with debug symbols and operation
ranges. The benchmark checks a 20,000-iteration warmup and the 25,000,000-
iteration result of 1,050,000,000 in each image.

| Image | SHA-256 | Build manifest SHA-256 |
| --- | --- | --- |
| General | `b48750b4c774dd70cde68becc8e2ccf56cd1d75a9d1b83e77183c85b5766439c` | `2f675ebb0ba27658832fe114eabe936b121efc5926f659d0aefc63583dbac621` |
| Typed | `0672f8114e220578c7f540078bbc5f5b91115ddf698e24a4bccbc24ecefb1e00` | `5ef5f3a284b16e8973834512ee86590dc8998993640633e5bc109c47a857d1cd` |

LLDB stopped at image entry, then at the 64th hit of the loop's sampling
address. The trace stepped into each instruction until the same address
recurred. Both inferiors subsequently exited with status 42. The typed address
was `0x100090300` at the loop test. The general address was `0x100768a64`
at the call instruction. Each interval spans one complete control-loop
iteration. Addresses below are image addresses before the ASLR slide.

| Executed by one iteration | General | Typed |
| --- | ---: | ---: |
| Instructions retired | 2,484 | 10 |
| Managed allocations | 8 | 0 |
| Managed allocation bytes, including layout overhead | 352 | 0 |
| Calls, including the call to the user arrow | 20 | 0 |
| Distinct return PCs with stack maps | 19 | 0 |
| Dynamic crossings of those return PCs | 20 | 0 |
| Inline managed write-barrier checks | 13 | 0 |
| Write-barrier slow-path calls | 0 | 0 |
| Collections observed in the sampled iteration | 0 | 0 |

The typed code inlines the leaf and performs its sum, index update, bound
comparison and loop control on scalar values. The general code spends 1,435
instructions inside and entering the source call. The generic increment adds
148, the loop-bound lookup adds 365, and the boolean conversion adds 128.
The other 408 execute in the caller and cover the call-result check, numeric
tag checks and scalar operations, slot traffic, control flow and argument-list
construction. The 2,484-instruction sum includes every instruction executed
from the sampling address back to itself. Debugger stepping establishes the
dynamic path. It does not partition wall time among these operations, or
measure the amortized cost of collections in other iterations.

## Managed allocations

Counts come from writes to the native nursery allocation cursor. Byte
counts are the difference between the old and new cursor at each store.
Allocation-start bitmap updates are part of each allocation sequence and
are distinct from the pointer write barriers.

| Cursor store | Allocating code and managed object | Count | Bytes |
| --- | --- | ---: | ---: |
| `0x1005ecefc` | `callObject` mutable captured-state record | 1 | 32 |
| `0x1005ed708` | `callObject` capture record for the realm thunk | 1 | 32 |
| `0x1005ed7dc` | `callObject` realm thunk function object | 1 | 40 |
| `0x1005ed584` | `callObject` result record | 1 | 32 |
| `0x10060cbfc` | `createDeclarativeEnvironment` empty callee environment | 1 | 104 |
| `0x10078e6c4` | Arrow's empty declarative scope record | 1 | 40 |
| `0x10055a55c` | `updateObjectValue` result record | 1 | 48 |
| `0x10076a538` | Caller’s empty argument list for the next iteration | 1 | 24 |

The source function did not create an `arguments` object. Its numbers
did not individually allocate. Every write-barrier check exited through the
inline `b.hs` branch without invoking a slow-path helper.

## Calls and safepoints

The call graph below counts dynamic `bl` and `blr` edges. The 19 distinct
return PCs match decoded native stack maps. `findBinding` is reached twice
from the same PC, `0x10061aad8`.

| Caller | Callee | Count |
| --- | --- | ---: |
| Control loop | `callObjectValue` | 1 |
| `callObjectValue` | `viewObjectValue` | 1 |
| `callObjectValue` | `callObject` | 1 |
| `callObject` | Realm run callback, `objects/jobs.ts` closure at 12987 | 1 |
| Realm run callback | `runScriptContext` | 1 |
| `runScriptContext` | Realm thunk, `objects/call.ts` closure at 1577 | 1 |
| Realm thunk | Source invocation, `objects/functions.ts` closure at 12224 | 1 |
| Source invocation | Execute wrapper, `objects/functions.ts` closure at 11302 | 1 |
| Execute wrapper | `enterSourceCall` | 1 |
| Execute wrapper | User arrow | 1 |
| User arrow | `createDeclarativeEnvironment` | 1 |
| Execute wrapper | `exitSourceCall` | 1 |
| Control loop | `updateObjectValue` | 1 |
| Control loop | `getIdentifierValue` | 1 |
| `getIdentifierValue` | `lookupIdentifierValue` | 1 |
| `lookupIdentifierValue` | `findBinding` | 2 |
| Control loop | `scriptBoolean` | 1 |
| `scriptBoolean` | `viewObjectValue` | 1 |
| `scriptBoolean` | `viewBigIntValue` | 1 |

General safepoint return PCs in image order:

```text
1003539a0 1003539fc 100354190 1003541c4 1005ed8e0 1005f2ca8 100610658
10061aad8 10062621c 100626290 1006262bc 1006268ec 10062da10 10072455c
100767f00 1007680c0 100768a28 100768a68 10078e62c
```

## Direct leaf call trial

A second instruction trace sampled the build with just the direct leaf call
at `0x100768b10` after its 63rd preceding hit. The image
`8ed8bd1f52cf1e11efe7ba154192a7654d93b2731af9e838cbf8195033705305`
and its build manifest
`ce9e4412ce8c4ebdad467559e434292b6a922ed811741ebe0a407c58618e5711`
retained the same checksum and exited with status 42.

This iteration retired **946 instructions**, made **eight calls** and crossed
**seven distinct stack-map sites**, one of them twice. Its sole managed
allocation was the 48-byte increment record at `0x10055a55c`. The trace
observed zero managed write barriers. Argument-list creation, realm
setup and restoration, source-call entry and exit, and the empty callee
environment all disappeared from the sampled path. The native compiler
inlined the constant leaf.

The remaining calls are `updateObjectValue` (once), `getIdentifierValue`
(once), `lookupIdentifierValue` (once), `findBinding` (twice),
`scriptBoolean` (once), `viewObjectValue` (once), and
`viewBigIntValue` (once). The generic increment, lexical resolution of the
bound and boolean conversion account for the three chains.

## Guarded numeric loop trial

The guarded loop in image
`fc73cfdfcc0c9fbde0d01685b8986e80da916eca15379e9ad00daf023f4f9630`
(manifest `eccf2c41ebba2de645d166e6a4eb29120f9e10bdcf587a4197a6d0aff1eb36c2`)
retired **10 instructions** between hits of `0x100767568`. It made
zero calls or managed allocations and had zero barriers or safepoints.
The scalar argument guard and entry work execute outside the iteration.
The same inferior checked 1,050,000,000 and exited with status 42.
Its benchmark clock reported 49.223 ms for 25 million iterations
(1.97 ns per iteration) during this instruction-trace run. The paired
benchmark report records timings separately.

The recurring instruction sequence, with branch addresses replaced by labels:

```text
test:  fcmp  d8, d10
       b.pl  exit
       mov   x9, #0x4045000000000000
       fmov  d16, x9
       fadd  d17, d9, d16
       fmov  d9, d17
       fmov  d16, #1.0
       fadd  d17, d8, d16
       fmov  d8, d17
       b     test
```
