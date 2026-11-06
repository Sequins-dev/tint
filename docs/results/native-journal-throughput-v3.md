# Historical compilation attribution

The existing tested `tools/test262-throughput.ts` was rerun over all 434 JSONL
files present in `docs/results`. Two exact content copies were excluded by the
[driver](native-journal-throughput-v3-driver.ts). The [full aggregation](native-journal-throughput-v3.json)
retains interrupted work and overlapping selections; it measures historical
work, not unique conformance coverage or current CPU performance.

| Engine / compiled execution batch occupancy | Batches | Median compile wall seconds |
|---|---:|---:|
| v4, 1–2 variants | 103 | 5.565 |
| v19, 1–2 variants | 62 | 153.984 |
| v4, 3–8 variants | 574 | 6.327 |
| v19, 3–8 variants | 45 | 280.265 |
| v4, 33–64 variants | 1,182 | 41.281 |
| v19, 33–64 variants | 113 | 160.298 |

[Outcome strata](native-journal-throughput-v3-compiled-strata.json) separate
compiled execution from syntax and failed/unsupported compilation. This matters:
the v19 tiny-batch median falls to 11 seconds if fast rejection is mixed into the
execution-compilation population. The all-batch medians, 14.587 seconds for v4
and 134.177 seconds for v19, describe another mixture. None of these comparisons
controls source graph, load or hardware scheduling and none establishes a causal
code-change speedup.

The examples in the original brief are verified: Date v8 has a 15.065-second
median over 19 batches, with a 120.950-second first-batch outlier; using/Annex v3
has a 5.387-second median over 29 batches; the Reflect interruption records a
286.321-second compilation. The near-constant hundreds of seconds across tiny
and large v19 populations support substantial fixed preparation cost. They do
not establish a scaling law, especially for B's interrupted 64-variant case.

Across the recorded v19 workload, compilation totals 20.928 wall hours. The
largest selection-directory charges are assignment, object expressions and
dynamic import. Historical observation `elapsedMs` is cumulative latency from
preparation, including batch compilation and earlier launches; its sum must
never be called execution time. The retained within-batch deltas exclude first
launches and include preparation skew. Parse/bind/check/lower/codegen/link,
writeback, debugger and inferior times cannot be reconstructed individually
from these journals. Native sampling and matched process CPU accounting supply
the separate attribution in [the hot-function reports](native-hot-functions-v3.md).

At the v19 historical occupancy mixture, compilation-only extrapolation is
223.05 hours for 103,264 variants. Holding the 160.298-second compiled-execution
median fixed while filling every 64-variant batch would instead give 71.88 wall
hours. Both are scenarios excluding execution, load correction and preparation.
B's matched tiny CPU measurement gives a different, explicitly CPU-based
scenario: 327.530 seconds per 64-variant batch would cost 146.84 CPU hours, versus
4,697.50 CPU hours at two variants per batch. Its 64-variant compile did not
finish, so constant-cost extrapolation is unproven.

The regression is in Node-hosted image compilation before inferior entry;
addition/division/eval preparation is a second cost executed by Tint output.
The current history checkpoints multiple engine generations together, so this
report does not assign the whole regression to one commit. The controlled
cross-source hash comparison is retained separately; changing both the Node
host and the embedded native compiler source in the original B pair confounds
that attribution. No checker algorithm change or cap increase is justified here.
