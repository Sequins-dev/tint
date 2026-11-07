# Defer temporary-root clearing until a block can collect

Closed native functions now clear their temporary root pool at entry to blocks
that may allocate or call an unproven callee. Proven nonallocating blocks avoid
that work. Persistent locals and environment roots keep their existing setup;
root descriptors and collection semantics are unchanged. No uninitialized or
stale temporary can be scanned: the full pool is cleared before any potential
safepoint in the block. Open modules and incomplete proofs retain the old policy.

A static cost guard requires the deferred stores to fit within the original
emitted store count, with directly encodable stack offsets. Large initializer
CFGs therefore retain the conservative policy. The proof budget is bounded per
function; exhaustion and sparse IDs fall back completely. No cap was raised.

| Matched workload | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Pure-loop fixture, emitted temporary-root clears | 4 | 1 | Only the cold collecting block clears |
| 50M boxed-equality iterations, CPU median, four alternating pairs | 166.811 ms | 161.118 ms | Small CPU difference; earlier control was flat |
| Same loop, retired instructions | 3,118,253,514 | 2,917,313,300 | 6.44% fewer |
| Same loop, cycles | 467,787,570 | 465,438,482 | Near flat |
| Full native compiler, CPU median of forward/reverse runs | 290.497 s | 285.293 s | Mixed direction between pairs; no reliable CPU gain claimed |
| Same compiler, instruction median | 3,243,362,795,517 | 3,229,453,630,334 | 0.429% fewer |
| Same compiler, cycle median | 918,555,779,888 | 909,599,219,691 | Mixed pair directions, median 0.98% lower |
| Unchanged canonical nine variants | 9/9 pass | 9/9 pass | Same exact variants, hashes, harnesses and outcomes |

Loop CPU ranges are 161.530–169.141 ms and
155.967–165.585 ms. Compiler CPU ranges are
267.416–313.577 s and
279.446–291.139 s. Per-repetition load, wall,
CPU, cycles, instructions and final missing-CPU bounds are retained in
[the evidence](native-deferred-roots-throughput-v1.json). These small improvements
do not establish a whole-suite hours saving or a Node-hosted compile speedup.

Eight executions of the semantic fixture and eight benchmark executions exit
42 under LLDB. Semantic checks cover boxed references, typed-array identity,
NaN/negative-zero, exceptions and cold collecting branches with moving GC.
All four native compiler executions exit 0, and their stage-2 images equal the
after stage-1 image: 53,679,234 bytes, SHA-256
`c6031c3a87ee71a8dcf5ebc55e64cfed04568f5caff865377ed4849cd73353f0`.
Signature and DWARF checks pass in both orders. The exact 595-file source snapshot
is `530ed16933f73de5b0ce7cd7b3ee7be6869aecd4efb8e1e890c30be8a7b223b5`.
The two changed portable emitter files are byte-identical to that frozen input.
Later main changes are tracked by the current gate rather than attributed to an
older image. Frozen toolchain identities and build manifests are retained.

The [canonical report](test262-perf-deferred-roots-v1.json) is complete, including
addition A1 sloppy/strict and call A1 sloppy. Independently observed native CPU:
addition sloppy 227.788 s at load 20.321, addition strict 212.100 s at load 14.442,
call sloppy 219.001 s at load 11.185. Six short variants finish between observer
polls; their canonical outcomes remain authoritative, without invented CPU data.
`elapsedMs` includes preparation and is not substituted for inferior CPU.
This overlapping performance selection adds no new suite coverage denominator.

The first unrestricted candidate failed batch emission with an initializer
branch OUT_OF_RANGE; its complete 0/9 unsupported journal is retained. The static
store-cost guard fixes the code growth instead of raising the branch limit.
Two later complete 0/9 unsupported journals record native-source-checking failures
from unchecked array iteration and mutable union narrowing. Explicit guards and
an immutable proof snapshot correct those failures; fresh immutable toolchains
were created for each attempt. Failed preparation, the early missing fixture
path/assertion issue, and the first gate's ill-typed test instruction are all
retained as infrastructure/checking observations, not native runtime failures.
The successful v41 toolchain completes preparation, native fixtures, self-builds
and all nine canonical outcomes. Self-builds use `selfbuild-perf 1`; Test262 uses
the shared runner slot, never the expired reserved runner class. Every native
launch asserts initial stop and final state; heartbeat and STALL records remain
in the raw logs. The final `tint-check` passes 4,809/4,809 tests, types, boundaries and formatting.
