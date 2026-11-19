# Compiler lowering memory, 2026-11-19

Node 24.12.0 on macOS arm64 built the `language/expressions/object` Test262
selection with `TZ=UTC`, module execution, suite linking, and AOT native
services. The Test262 checkout was `91c70759363c46557b694792bf34a2551a7af5ba`.
The probe stopped after writing each image and recorded the compiled variant
denominator.

The paired runs used `3c0c3c4c5` and `b260f15d7`, compiling the same frozen
770-file source input with SHA-256
`36536a3247cb51e02e8ee15128b7819f9155bc3c99eb9dbb5bdb6dfc4e5ce64b`.
The Node toolchain manifests have SHA-256
`1486e47c1d79d6faf860fdca531938b6d0f4d052d313f637b37f494e3691cd47` and
`95f8083bbc9072fd68b6b44c39b23013b22ad0c16a4075ee648c650ce89f0aa1`,
respectively. Only the three changed lowering dist files differ between
the matched compilers, apart from instrumentation and manifest hashes.

## Live heap and build time

The 4,096 MiB runs forced GC at each probe. The table records the main
application, after service and surface-layout preparation.

| Seam, live MiB              |  Main | Candidate |
| --------------------------- | ----: | --------: |
| Link returned               |   558 |       558 |
| Second application instance | 1,968 |     1,968 |
| Check returned              | 1,100 |     1,100 |
| Before function bodies      | 1,217 |     1,217 |
| After 24,576 bodies         | 1,880 |     1,762 |
| After 32,768 bodies         | 2,628 |     2,373 |
| After 36,864 bodies         | 2,879 |     2,583 |
| Before IR verification      | 2,972 |     2,658 |
| Closure lowering returned   | 2,790 |     2,603 |
| Typed lowering returned     | 1,874 |     1,687 |
| After pruning               | 1,812 |     1,650 |
| After optimization          | 1,644 |     1,644 |

Live heap at the verification seam dropped 314 MiB (10.6%). The checked
graph and IR must coexist while bodies are produced. Each completed block
keeps a compact copy of its instruction array, and the closure adapter clears
the consumed record-construction, access, spread and constructor plans after
each body. Record layouts and type-to-layout mappings remain available for
subsequent bodies.

| Matched 4,096 MiB runs           |     Main | Candidate |
| -------------------------------- | -------: | --------: |
| Whole build wall time, s         | 1,221.13 |  1,243.94 |
| Whole build user + system CPU, s | 1,100.49 |  1,164.05 |
| Maximum RSS, MiB                 |    5,910 |     5,927 |

Wall time rose 1.9% and CPU time rose 5.8%. The runs included GC probes and
overlapped other host work. The similar whole-process RSS includes memory
outside the V8 old-space cap. Immediately after emitting the last body, the
pre-GC samples were 3,002 and 3,383 MiB, respectively. The cap trials below
measure the build with V8's automatic collection.

## Heap caps and image identity

The cap runs recorded the same seams with V8's automatic collection.

| Run                   | Cap, MiB | Result                          | Max RSS, MiB |  Wall, s |
| --------------------- | -------: | ------------------------------- | -----------: | -------: |
| `final-base-cap-3136` |    3,136 | OOM late in lowering, exit 134  |        4,078 |   560.25 |
| `final-cap-2880`      |    2,880 | OOM during checking, exit 134   |        3,922 |   403.56 |
| `final-cap-2912`      |    2,912 | OOM late in lowering, exit 134  |        3,875 |   333.20 |
| `final-cap-2944`      |    2,944 | Compiled 2,252 of 2,252, exit 0 |        4,429 | 1,317.57 |

The smallest successful tested cap was **2,944 MiB**, 256 MiB below the
3,200 MiB success recorded on the original baseline `d5cc32cd8`. The
adjacent failed cap on the candidate was 2,912 MiB. Its last probe recorded
36,864 lowered function bodies and it OOMed before IR verification.

Both 4,096 MiB images and the 2,944 MiB image are byte-identical. Each has
175,077,983 bytes and SHA-256
`c8dd81110e0c16c9573c53c40a0f65a88db3d9da125bb4f15429e878cc89eade`.

## Earlier trials

On the original `d5cc32cd8` input, trimming instruction arrays alone
reduced the live verification seam from 2,971 to 2,783 MiB. Its image was
identical at 3,008 MiB and it OOMed at 2,944 MiB. Clearing record expression
plans as well completed at 2,944 MiB with the same image.

Packing the lowered IR into the existing store after 5 million instructions
plus blocks cut the live verification seam to 1,394 MiB. Materializing it
again for the optimizer raised the live post-lowering footprint from 1,874
to 2,373 MiB. The trial emitted identical bytes at 4,096 MiB and OOMed in
optimization at 2,944 and 3,008 MiB. A trial with smaller decoder allocations
still OOMed in optimization at 2,944 MiB. The implementation was reverted.

Raw probe JSONL, build reports, timings, errors and images are in
`.tint-bootstrap/lowering-evidence/` in the measurement worktree.

## Validation

- `pnpm check` exited 0 on `b260f15d7` with 6,242 passing tests and seven
  skips. The native-subset test passed. The catalog regenerated with no diff.
- The Linux arm64 gate ran on the `dev` container machine. Its storage tests
  passed 7/7. Stages 1–3 and the main compiler's build on the candidate's
  frozen sources were byte-identical, SHA-256
  `45e1eb2f7fb42f6437ac7f804a44332037ec2ff56c9369b4f7d27e088f096b91`.
- The macOS arm64 bootstrap produced identical stages 1–3, SHA-256
  `3e9b57b3d07321319ad13d2dff0169e9c9bb9f3e584e43453607736b9b262ce9`.
