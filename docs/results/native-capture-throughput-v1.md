# Stable numeric captures: native validation after authorization restoration

Strict simple captured numeric parameters can live directly in their closure
payload when binding proves initialization and no assignment, alias, eval or
arguments hazard. Sloppy functions, unknown strictness, default/rest/destructured
parameters, TDZ-sensitive locals and reassigned captures keep reference cells.
The change preserves dynamic conversions and does not rely on sound assertions.

| Same-source region closure, four alternating pairs | Before | After |
| --- | ---: | ---: |
| CPU median | 2,163.400 ms | 1,797.964 ms |
| CPU range | 2,058.051–2,252.476 ms | 1,726.630–1,938.103 ms |
| Retired instructions, separate counter repetition | 61.220 billion | 51.023 billion |
| Cycles, counter repetition | 7.861 billion | 6.468 billion |

The repeated CPU comparison is **1.203×**; the independent counter repetition
retires **16.7% fewer instructions** and uses **17.7% fewer cycles**. Every one of
the sixteen operation processes stops at entry and exits 42. Four further pairs
of semantic fixtures also exit 42, exercising signed zero, NaN, forwarded and
mutated captures, moving collection and returned closures. Loads and raw
CPU/counter intervals are retained. These are operation benchmarks, not Test262
coverage or a whole-suite projection.

Both frozen production hosts compile the exact same 570-file source snapshot
`0acbb505…75aa`. All four native compiler executions, in forward and reverse
orders, exit 0 and reproduce the **same 59,815,314-byte candidate stage image**,
SHA-256 `87c1d9153f8adbeac3f9be2086fd5e3ff1dc84cf2070a3c96e7db110fe259314`.
Signature and DWARF verification pass. Full-compiler CPU timing changes direction:
224.931 → 266.660 seconds in the first pair; 364.457 → 257.562 seconds in the
reverse-order pair. The reverse baseline overlaps recorded external saturation.
The counter pair retires **1.85% fewer instructions** after the change. This
establishes a fixed point and a lower instruction count, not a stable compiler
CPU speedup. Both directions are retained.

The adjacent canonical explicit-subset reports each pass **6/6**, with identical
outcomes, pinned test/harness hashes, unchanged strictness, fresh processes,
300-second containment and resource limits. They cover boolean/wrapper addition,
signed-infinity division and strict-equality ReferenceError handling in sloppy
and strict modes. These are complete subset reports, not complete families.

A separate canonical A1 pair is deliberately retained: the older baseline passes
2/2; the candidate records two after-entry timeouts, receiving only **213.7 and
147.6 CPU seconds** in the 300-second wall budget. Those observations are
inconclusive under load and are not semantic equivalence evidence. In a separate
symbolized diagnostic, the candidate sloppy A1 image stops at entry and exits
42 after **234.705 CPU seconds**, within its wall budget. That diagnostic does
not replace canonical outcomes or enter coverage totals. An earlier observer
mistakenly matched debugserver rather than the inferior; its data is marked
invalid and retained.

The matching A1 callback body falls from **852 to 557 instructions**, 190 to 138
loads and 294 to 166 stores; its one call is unchanged. The generational callback
remains 850 instructions, a negative control. Eight usable A1 sampling windows
contain 6,277 main-thread samples: `findEntry` 15.29%, `resolveReference` 14.50%,
`copying.read` closure 12.12%. The ninth window is empty after process exit and is
retained. These selected-window shares are not a matched whole-run share change.

[The JSON](native-capture-throughput-v1.json) contains exact toolchain identities,
all four stage comparisons, benchmark repetitions and loads, complete canonical
reports/journals, symbolized samples, invalid-observer notes and reproducible
measurement scripts. Earlier pre-entry host-authorization failures and static
provenance remain in [v8](native-hot-functions-v8.md). A fresh integrated workspace
gate is recorded separately before publishing a READY range. No full-suite hours
are inferred from this closure loop.
