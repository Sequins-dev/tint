# Inline primitive unions: post-C2 native validation

The frozen compiler including C2's checker change and P's equality, inline-union
and control-flow changes builds itself successfully. Stage 1 and stage 2 are
**byte-identical: 69,486,994 bytes**, SHA-256
`2e79b837c6ab82b1d20afef3425e576edc7ae40cc48c7698944157bdae3bb478`.
The inferior starts stopped at entry and exits 0. Signature verification and
DWARF verification pass; debug abbreviation, information and line sections are
nonempty. The [machine-readable record](native-codegen-inline-post-C2-v1.json)
contains the frozen toolchain and source identities, CPU counter bounds,
compressed logs, gate status and retained rejected runner launch.

The native stage uses **1,884.395 seconds of CPU**, with at most 0.104 seconds
unobserved at exit, and 3,372.435 seconds of inferior wall time. Node builds stage
1 in 110.34 user + 4.45 system seconds (175.14 wall seconds). These times describe
different workloads and hosts. Earlier frozen sources differ, so this report
does not claim a whole-compiler speedup from their timing differences.

The matched [store benchmark](native-codegen-inline-primitive-unions-v2.json)
remains the performance evidence: 130.598 to 44.463 ms median inferior CPU,
**2.94×**, four alternating pairs, eight expected native exits. Static body size
increases while indirect calls fall from eight to four. The benefit comes from
removing per-store primitive boxes, rather than making every static count lower.
No suite execution-hours projection follows from that microbenchmark.

The original specialization limit was a real bounded-work guard. Incorrect
numeric equality loaded general-value payloads from stale stack locations when
their planned storage was a leaf register; native deduplication consequently
failed and exhausted the guard. Reading the planned storage fixes this semantic
defect. The bound remains unchanged. The successful full native self-build
confirms that the repaired native compiler can compile this frozen graph.

The frozen graph includes `63e5264` and the linked-syntax hash fix; it predates
later C1 private-element changes. Current main integration is checked separately:
the preceding workspace gate passed **4,577/4,577** tests, and a fresh gate is
queued after rebasing onto `f74cb1e`, which adds debugger connection readiness.
The newly added debugger-session test passes together with its nine existing
tests. A gate completion record will establish merge readiness separately.

The first post-C2 A1 launcher was rejected before compilation because P set
`TINT_TEST262_MODULES=0`; that variable accepts unset or `1`. Its error and exit
are retained, with **zero native observations**. The corrected launcher deletes
the variable and writes a separate report. This does not replace the existing
completed **0/2, two post-entry timeouts** A1 result or establish outcome-value
equivalence for those timed-out variants.
