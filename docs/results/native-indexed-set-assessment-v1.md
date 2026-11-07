# Indexed Set: hold the nine-entry candidate

A shared hash index makes 1,024-member string Set lookups **9.37x faster** in a
matched native benchmark, but the broad representation change regresses the full
native compiler. **Do not merge this candidate.** This report includes no runtime
implementation change.

| Workload | Before CPU | After CPU | Other evidence |
| --- | ---: | ---: | --- |
| 65,536 string lookups, median of four alternating pairs | 373.604 ms | 39.861 ms | Instructions -92.5%, cycles -89.1%; all eight exits 42 |
| Full native compiler, same frozen source | 297.590 s | 334.851 s | Instructions +8.6%, cycles +8.8%; identical output |
| Canonical 17-variant selection | 17/17 pass | 17/17 pass | Same pinned variants, unchanged limits/harness, fresh process each |

The same sealed baseline Node compiler builds both fixture images from their
respective source snapshots. Exactly three portable collection files differ.
Both native compilers then compile the same after snapshot. Both outputs and the
after stage-1 image are identical: 55,208,962 bytes, SHA-256
`470827aded46ac37f6b83f170dbbd525eb1ddbf71215c8b60679d8a7133fd8d3`.
Signature and DWARF verification pass. The native self-build used P's reserved
`selfbuild-perf 1`; actual Test262 used shared `runner 8`, after the temporary
three-recheck reservation had finished. Every launch preserves initial-stop and
final-outcome checks. Complete [before](test262-perf-indexed-set-before-v1.json)
and [after](test262-perf-indexed-set-after-v1.json) reports retain all 17 outcomes.
They are overlapping performance selections, not additional coverage totals.

The actual JavaScript Set matrix uses 262,144 membership queries per case and
four alternating pairs. At 8/16/32/64/128/256/1024 numeric members, CPU ratios
(before/after) are 0.435/0.264/0.325/0.464/0.775/1.429/5.018. String ratios are
0.813/0.366/0.550/0.858/1.629/2.866/9.614. All 112 native matrix executions exit
42. These are measured crossovers, not a justification to choose an arbitrary
small promotion threshold. Per-repetition CPU spread, instructions, cycles and
load are retained in [the evidence](native-indexed-set-assessment-v1.json).

A diagnostic Node execution of the identical compiler algorithm counts
7,366,024 Set constructions. 632,041 reach nine members, 39,965 reach 65, and
only 346 reach 129. Of 84.7 million queries, 82.8 million use numeric keys. The
histogram is an algorithm/input diagnostic; it is not a native CPU profile.
The transparent Set subclass produces the identical 55,208,962-byte image.

The candidate also harms unpromoted small Sets. Complete numeric `hasSet`
disassembly grows from 144 instructions, 10 loads, 3 stores and no calls to
349 instructions, 79 loads, 100 stores and one call. The indexed branch includes
an opaque callable and loses the whole-function nonallocating/leaf plan. Extra
root initialization and stack traffic now affect the linear branch as well.
This generated-code pattern explains why raising the promotion threshold alone
is insufficient. Both complete bodies and all specializations are retained.

The selected native compiler sampling windows contain 3,915 before and 3,921
after exclusive samples. They show lookup and GC costs shifting; they are not
duration-weighted whole-run profiles. [The current table](native-hot-functions-v12.md)
keeps expected compiler work separate from emitted-operation overhead. Runtime
index allocation pressure and loss of register specialization must be addressed
before this representation is reconsidered. General immutable word-capture
lowering is being measured independently; no candidate compiler speedup is
claimed here.

Focused collection tests (31), types, eight semantic/GC native fixtures, all
lookup benchmarks and stage-image checks pass. The first lookup preparation's
missing array-element narrowing is preserved separately; the corrected client
is identical across both hosts. No full gate was queued for a candidate with a
measured real-workload regression. No whole-suite speedup is extrapolated.
