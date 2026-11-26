# Native self-compile critical path by actor candidate

November 22, 2026. One native serial profile per arm64 host compiled the
frozen 821-source input after the serial optimizer changes. Both ran under
`tools/gate/with-lock.sh both`, with `TZ=UTC`, LLDB stopped at entry,
and a verified inferior exit of 0. Timing spans the native compiler's
first source marker through pass-statistics publication. Nested rows
overlap their parent rows. The runs used the ordinary release image settings.

| Stage                                              | macOS arm64 |  Share | Linux arm64 |  Share |
| -------------------------------------------------- | ----------: | -----: | ----------: | -----: |
| Full observed build                                |   142.266 s |   100% |   133.732 s |   100% |
| Link, lower and optimize                           |    80.468 s | 56.56% |    69.189 s | 51.74% |
| Optimizer passes in the report                     |    54.584 s | 38.37% |    45.831 s | 34.27% |
| Last interprocedural list-vector pass              |     6.526 s |  4.59% |     5.376 s |  4.02% |
| Final local counted-loop rewrite                   |     3.182 s |  2.24% |     2.550 s |  1.91% |
| Final reachability and ID assignment               |     0.212 s |  0.15% |     0.162 s |  0.12% |
| AArch64 backend                                    |    59.058 s | 41.51% |    62.007 s | 46.37% |
| Backend validation, compact slots and module facts |     7.031 s |  4.94% |     5.740 s |  4.29% |
| Function frame planning and instruction emission   |    49.212 s | 34.59% |    53.587 s | 40.07% |
| Stack-map encoding                                 |     1.145 s |  0.81% |     1.254 s |  0.94% |
| Source intake                                      |     0.084 s |  0.06% |     0.306 s |  0.23% |
| Initial graph decode, parse and resolution         |     1.343 s |  0.94% |     1.219 s |  0.91% |
| Source loader calls during compilation, 372 calls  |     0.822 s |  0.58% |     0.592 s |  0.44% |
| Image construction including hashes and unwind     |     0.214 s |  0.15% |     0.073 s |  0.05% |
| Mach-O UUID hash                                   |     0.092 s |  0.06% |           — |      — |
| Mach-O signature pages and directory               |     0.103 s |  0.07% |           — |      — |
| ELF build ID hash                                  |           — |      — |     0.065 s |  0.05% |
| Unwind encoding                                    |     0.016 s |  0.01% |     0.005 s | <0.01% |
| Publish executable                                 |     0.009 s | <0.01% |     0.036 s |  0.03% |
| Format and publish pass statistics                 |     0.003 s | <0.01% |     0.012 s |  0.01% |

Release DWARF encoding, spill writes and the optional TypeScript validator
each had zero time on this path. No debug sections were requested. The frozen
input uses the decoded backend path at 3.69 million instructions plus blocks,
under the default five-million threshold for packing. The validator is an
optional Node-hosted fixture hook. The regular frozen self-build does not call
it. Ordinary progress diagnostics are included in the surrounding stages.
The statistics row measures the separately timed statistics sink.

## Ranked actor interfaces

1. The backend function loop is 34.59% and 40.07% of these builds. Send a
   canonical function range and immutable packed bodies with offsets and
   prepared facts. A worker owns the decoded body, frame scratch, and
   relocatable code and metadata for its assignment. The placement actor
   owns ordered offsets, first-use dispatch IDs and the retry decisions.
   Closed direct-call groups have a measured imbalance described below.
   Splitting across that component needs common call summaries and symbolic
   relocations. A bounded store admits bodies at the rate the emitter and
   placement can consume them.

   The local counted-loop pass is 5.83% of measured optimization on macOS
   and 5.56% on Linux. It follows the list-vector pass and precedes the
   final reachability barrier. **Zero optimizer work currently follows
   that barrier.** Moving the local tail across it needs proof that its
   loop copies preserve final reachability and ID assignment. The emitter
   also computes module-wide word, record, and call facts from the rewritten
   bodies, so moving the pruning barrier alone leaves a second join.
   Earlier local list-vector rewrites share indirect target and write-effect
   summaries. Their generated helper IDs are assigned in first-use order.

2. Sources have 2.165 s and 1.812 s of graph work plus timed loader
   calls, including decode and resolution. Send source IDs and immutable
   UTF-8 ranges. Return ordered import and export records with spans or
   a parse diagnostic. The parser owns its tokens and transient tree.
   The coordinator owns resolution, reachable-module order, and which
   diagnostic is observed first. The later binder still needs the parsed
   body. A Node-only check actor can own the pinned TypeScript program and
   return its diagnostics before image publication when that check is
   enabled.

3. Section encoding and publish sinks account for about one percent of
   release wall time. A stack-map or unwind actor receives ordered frame
   records with final offsets and owns the encoded section bytes. A
   debug build can send source ranges and symbol records to a DWARF actor.
   The image writer receives sealed sections and final layout. On Darwin,
   the UUID is installed before signing pages whose contents depend on it.
   Signature page digests return by page index before the code directory
   is serialized. ELF build-ID hashing observes the canonical image byte
   sequence. The writer owns publication of the final file. A spill actor
   can accept sealed store segments and report completion before releasing
   their buffers. Statistics and diagnostics can accept numbered records
   and own formatting and I/O.

Stack maps, final publication, image construction and statistics together
accounted for 0.96% on macOS and 1.03% on Linux. Eliminating that entire
sum leaves the 15% target out of reach. Source-side work has a similar
upper bound. An ideal two-lane speedup of the function loop alone
would save 17.30% on macOS and 20.04% on Linux before preparation,
transfer, imbalance, and merge. This ranks the function loop first and shows
how little overhead the two-lane macOS design can absorb.

## Native measurements of closed call groups

A separate matched Linux native profile timed each frame-and-emission
visit and counted direct call edges on the same 7,111 bodies. Build
and measurement ran under both locks with the same LLDB assertions.
It observed 73,154 direct calls and 1,268 weakly connected components
after joining each caller with its direct callee. The largest component
contained 5,810 functions and 3,568,533 of 3,689,414 instructions plus
blocks. It accounted for **69.451 of 70.430 s**, or **98.61%**, of
measured function-loop time. The other 1,267 groups accounted for 0.979 s
combined. A whole closed-group-per-worker scheme can overlap at most
those 0.979 s on this workload with no further partitioning. Indirect or
cross-group ownership constraints can only make the independent groups
coarser.

## Image and artifact provenance

The Mach-O matched the existing 50,163,978-byte signed control by `cmp`,
SHA-256 `334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.
Both Linux profiles matched the 49,771,592-byte ELF control by `cmp`,
SHA-256 `30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
Profiler compiler hashes were
`6d2ee330975d8a4906d70b8574a78395058bfae032ef2e3afd12cc3e2b958bfb` (macOS),
`dafb67df21691996ef756bc1949cf55dd04e04429312b1b64bcb044099091867` (Linux),
and `962676343c0c35775d008e208317e2cc8814e954bf886dbf2c4c526535fab0ec`
(Linux groups).

Raw logs are `native-actors-{macos,linux}-{build,profile}.log`,
`native-groups-{build,profile}.log` and `native-group-costs.json` in the
worker-overhead experiment directory. An initial group profiler build
failed on a missing `FunctionIR` type import. The corrected compiler had
a verified native exit and image comparison.
