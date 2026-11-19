# Collection instance check memory, 2026-11-20

The `language/expressions/object` suite links and specializes the application, then checks it once to collect runtime requirements. Collection preparation specializes those helpers and materializes the managed surfaces. It moves the application into an initializer and hashes the resulting syntax. The checker binds that entire generated tree, including the moved declarations and generated helpers, so lowering receives binding, function and type IDs for the final program.

The first instance exposes a list element contract with no matching specialized helper. The retry uses that instance's checked graph to select helpers and supply the runtime binding context. Previously, the new checker ran while the last observation and the specialized and transformed syntax were still reachable. The old observation included bindings, types and relation caches, expression indexes, operations and bodies. The candidate consumes it within preparation and returns the finalized tree, roots, plan, binding records, C view registry and scalar facts. Only a retry publishes another observation. The convergence check compares the two demand counts.

## Matched check probes

Node 24.12.0 on macOS arm64 used suite linking, module support, AOT native services and `TZ=UTC` with Test262 `91c70759363c46557b694792bf34a2551a7af5ba`. Both probes used the same 783-file source snapshot, `02fa1e7faf41eb007c7c67ab4e27cdcaa3897abd7bdbab1e2680d955564bdc4a`. They used a 4,096 MiB old-space cap, forced GC at instrumented boundaries and stopped when checking returned. MiB are rounded.

| Seam | Main `34187f4a8` | Candidate `e24156452` |
| --- | ---: | ---: |
| Link returned | 570 | 570 |
| Initial application check | 1,279 | 1,182 |
| First instance constructed | 1,772 | 1,772 |
| First instance enters final checker | 2,018 | 975 |
| First instance final check returned | 2,448 | 1,405 |
| Retry instance constructed | 2,006 | 2,063 |
| Retry instance enters final checker | 2,295 | 996 |
| Retry instance final check returned | 2,742 | 1,443 |
| Check stage returned, after a second GC | 1,122 | 1,123 |

The retry's final checker uses 1,299 MiB less live memory at entry and at return. The largest sampled check seam fell by 679 MiB (24.8%) and moved to retry instance construction. The first GC immediately after checking returned measured 1,122 and 1,449 MiB. A second GC at the same boundary measured the values in the table.

From the return of linking until checking returned, CPU time was 158.16 s and 147.56 s, a 6.7% reduction in this instrumented pair. Wall time was 144.7 s and 150.0 s under concurrent host load. In the matching warm 4,096 MiB full builds without forced GC, wall time was 814.26 s and 767.96 s, and CPU time was 940.05 s and 951.15 s. Process peak RSS was 5,240 and 5,336 MiB. Each built 2,252 of 2,252 variants and wrote a byte-identical 177,835,487-byte image (SHA-256 `ddd0b55abbbe003afb40e3e194fc0727efc57f0cb41dd761fb4bdc00285ee373`). The builds stopped after writing the image.

## Old-space cap

The cap trials sampled without forced GC. An alarm stopped each probe at 890 seconds. A stage in the table identifies the last completed or entered phase, as indicated.

| Compiler | Cap, MiB | Observation |
| --- | ---: | --- |
| Main `34187f4a8` | 2,880 | OOM in the retry instance's final checker, exit 134 at 278.58 s |
| Candidate `e24156452` | 2,848 | OOM while specializing collection helpers for the retry, exit 134 at 548.48 s |
| Candidate `e24156452` | 2,880 | First run timed out in optimization. The warm repeat finished optimization at 750.6 s and timed out during emission. Both exited 142 |
| Candidate `e24156452` | 2,912 | Stopped while optimizing at handoff |
| Candidate `e24156452` | 4,096 | Compiled 2,252 of 2,252, exit 0 at 767.96 s |

The observed bracket for reaching emission is (2,848, 2,880] MiB. The full build completed at 4,096 MiB. The lower-cap runs leave the end-to-end minimum unresolved.

## Managed surface RSS

The [original matched surface probes](compiler-surface-layout-memory-2026-11-19.md) recorded peak RSS of 4,942 and 5,466 MiB. The same `time -l` logs recorded peak Darwin memory footprint of 4,972 and 4,787 MiB. The 524 MiB RSS delta was accompanied by a 185 MiB decrease in footprint.

Replaying the archived toolchains with the same captured input (`0500ec98c485615d962135d9f77c6f0fa3bca0713841c0da3572270bb6e524ae`) shows the process RSS high-water marks diverge before lowering. They were 4,233 and 4,541 MiB by check return in the first replay, and 4,465 and 4,576 MiB in the second. At check return in the second replay, V8 reported 1,879 and 1,827 MiB of physical heap and both compilers retained 1,099 MiB of live heap. The second application instance also had equal live heap and ArrayBuffer use. The evidence points to transient residency and collection timing across otherwise similar live heaps. The exact phase responsible for the original whole-process RSS high-water mark was unsampled.

## Validation

- Linux gate exited 0 in 1,190 s. Storage passed 7/7 and `LINUX_STAGE1_EQ_2_EQ_3` passed. All three images match main's compiler run on the same candidate sources (SHA-256 `64f002b9c223bc7850175be52261a27b04cd08c944512b9dd98912f838b2f3ea`).
- At the requested handoff checkpoint, macOS workspace checks passed 6,312 with 10 skips and zero failures. Storage passed 7/7. Stage 1 matches main on the same candidate sources (SHA-256 `fe7a67317b02dc13e7b8cf05551dee88c6b9c90836595108199b1edda29e29fa`). The already-running gate was in LLDB stage 2. Its log is `.tint-bootstrap/check-evidence/mac-gate.log`.
- Both compilers produced the same two-variant object smoke image (SHA-256 `826ff1b2a536472d1a520be06eb4092ca2588b34cec05770f174cf676fa234d8`).

Raw probes, error logs and comparison artifacts are in `.tint-bootstrap/check-evidence/` in the implementation worktree.
