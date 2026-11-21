# Parallel compilation screening on merged main

November 21, 2026. Baseline implementation `206530edd`, after the worker
and unified-pipeline merges. macOS arm64, Mac17,7, 128 GiB, Node 24.12.0,
`TZ=UTC`. Other validation work shared the machine.

## Fresh self-compile control

The Node bootstrap captured 821 files. SHA-256 of the path-sorted
`shasum -a 256` listing from the snapshot root was
`dfd0676b9c40ab6c7a0e1b93244983e6a54483ed62047b02328b161337dac076`.
The stage-1 compiler rebuilt the snapshot under LLDB with the timing and
native gate locks. It stopped at entry and exited zero. The 50,163,978-byte
images matched by `cmp`, SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.

| Compiler                                | Wall (s) | CPU (s) | Cycles (billions) | Peak RSS (MiB) |
| --------------------------------------- | -------: | ------: | ----------------: | -------------: |
| Node bootstrap, whole process           |   290.91 |  318.74 |          1,085.33 |        3,886.8 |
| Native, source read through publication |  263.916 | 264.059 |     783.85–783.90 |        2,090.0 |

Native CPU and cycles come from inferior `proc_pid_rusage` V4 samples. Its
RSS is the maximum sample. Node uses `/usr/bin/time -l`. This establishes a
new comparison input. The Phase 1 control used an older commit and fewer
files, so elapsed times across the two reports do not isolate an upstream
regression. [Phase 1 baseline](parallel-bounded-compile-baseline-2026-11-21.md)

## Worker transport screen on SSA constant folding

A Node-hosted observer captured the full IR function array at the end of the
first `fold-constants` pass. The fixture contains 5,665 functions, 703,687
blocks and 2,642,798 instructions. The scratch fixture used V8 serialization
for offline input capture, SHA-256
`4053bbf28a61207be71c538d01dc1883cc24c4225a0709a858bb47fbeb3ac1e6`.
Each method ran the same `foldSSAConstants` with `unboundedWork` in a fresh
Node process under the timing lock. Worker runs held one in-flight job per
worker. They merged the changed functions in original range order. Every
method used 27 batches targeting 100,000 instructions plus blocks, with any
single oversized function kept intact.

- Clone sends the decoded function graph through `postMessage`.
- Transfer encodes each batch with the existing IR codec and moves its
  backing ArrayBuffer. Shared copies the packed bytes into an immutable
  SharedArrayBuffer. Spill writes the same encoding to temporary files
  and sends the file path. Packed modes send offsets and the codec vocabulary
  alongside the payload.
- Pass wall and CPU include worker startup, packing, computation, worker
  shutdown and ordered merge. RSS and cycles are whole-process values that
  include input loading and output verification.

| Transport | Workers | Pass wall (s) | Pass CPU (s) | Process peak RSS (MiB) | Process cycles (billions) |
| --------- | ------: | ------------: | -----------: | ---------------------: | ------------------------: |
| serial    |       1 |        12.416 |       11.893 |                 1657.2 |                     52.70 |
| clone     |       4 |         7.683 |       28.402 |                 3432.2 |                    101.29 |
| transfer  |       4 |        11.953 |       25.522 |                 2996.7 |                     87.36 |
| shared    |       4 |         9.826 |       24.272 |                 3135.0 |                     82.93 |
| spill     |       4 |         5.385 |       26.448 |                 3150.2 |                     85.46 |

All five methods visited 430,125,708 work units and reported 135,019 rewrites.
Re-encoding the ordered results and vocabularies produced the same SHA-256
`fd9b75b514b35a7f4b054873a0a3386dae23c9803faff5869ab55f966ace491a`.
A separate serial diagnostic found that the largest function consumed 25%
of sampled per-function wall time. It has 79,291 blocks and 384,531
instructions, so count-based sharding risks leaving other workers idle.

Spill led this one-order screen by wall time, with about twice the serial CPU
and almost twice the process RSS. The spread between packed transports
warrants rotated repetitions before selecting one. The screen ran a real
optimizer pass, isolated from the compiler pipeline. It establishes neither
native worker cost nor end-to-end speedup.

## Object Test262 cap screen

The matched input used pinned Test262
`91c70759363c46557b694792bf34a2551a7af5ba`, all 2,252 variants selected by
`language/expressions/object`, suite linking, modules enabled, monolithic
native services, and a 2,867 MiB V8 old-space setting. The same captured
workspace source JSON was used for both attempts, file SHA-256
`7d3f40ab7477dce55da4b3dff2f539c91678141eba2ee077a7556968fcbeed42`.

| Compiler                                     | Wall (s) | Process peak RSS (MiB) | Outcome                                                                     |
| -------------------------------------------- | -------: | ---------------------: | --------------------------------------------------------------------------- |
| Merged main                                  |   154.94 |                3,461.3 | V8 heap limit, SIGABRT during suite compilation                             |
| Specializer indexes only template references |   125.13 |                3,757.5 | Ineffective mark-compacts near heap limit, SIGABRT during suite compilation |

Neither attempt wrote a suite image or ran any cases. RSS includes memory
beyond V8 old space. The baseline setup initially passed the heap flag via CLI
arguments. The heartbeat worker rejected the inherited option with
`ERR_WORKER_INVALID_EXEC_ARGV` before compilation. The timed cap runs set
`NODE_OPTIONS=--max-old-space-size=2867`.

Raw inputs, logs, sampler files, the scratch optimizer harness and the
specializer patch are under `.tint-bootstrap/parallel-experiment.DQ4p4zZ9/`
in the assigned worktree.
