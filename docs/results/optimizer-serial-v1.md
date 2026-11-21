# Serial LICM and SSA self-compile comparison

On November 21, 2026, native optimized compilers rebuilt the same
821-file snapshot from main commit
`206530edd2dc8df8f79d070bbae2e110a467ddbf`. The SHA-256 of the
ordered source manifest was
`dfd0676b9c40ab6c7a0e1b93244983e6a54483ed62047b02328b161337dac076`.
LICM reused the record proofs for each immutable function round. The
SSA analysis skipped incoming arguments once a block parameter reached
the unknown state in an unbounded run. Bounded SSA runs kept their
existing accounting.

## Rotated native self-compile

The execution order was main A, LICM A, SSA A, SSA B, combined A,
LICM B, combined B, main B. Every native inferior stopped at entry
under LLDB and exited zero. All outputs matched by `cmp`.
The signed image was 50,163,978 bytes, with SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.

| Compiler     | Run | Wall (s) | CPU (s) | Cycles (billions) | Peak sampled RSS (MiB) |
| ------------ | --- | -------: | ------: | ----------------: | ---------------------: |
| Main         | A   |  263.916 | 264.059 |            783.88 |                2,090.0 |
| Main         | B   |  291.669 | 289.293 |            808.73 |                2,090.0 |
| LICM only    | A   |  206.726 | 194.758 |            592.81 |                2,050.3 |
| LICM only    | B   |  123.463 | 136.549 |            526.19 |                2,052.3 |
| SSA only     | A   |  191.648 | 208.924 |            669.17 |                2,090.0 |
| SSA only     | B   |  184.212 | 202.845 |            658.50 |                2,090.5 |
| LICM and SSA | A   |  137.793 | 157.887 |            509.40 |                2,051.5 |
| LICM and SSA | B   |   91.523 | 109.593 |            453.71 |                2,051.8 |

Median native wall time fell from 277.8 to 114.7 s (58.7%). Median
CPU time fell 51.7% and median sampled hardware cycles fell 39.5%.
The machine also ran other validation workloads during this rotation.
Cycles use the samples bracketing inferior exit.

The split branch's compiler source matched all 821 files in the
archived combined compiler source manifest. Its native macOS arm64
stage 2 and stage 3 images matched by `cmp`, with SHA-256
`c41a51b1da4aaf045a5766ea221e2032a6edaaa64e7a7526afae555b4e6f233e`.
Both inferiors exited zero under LLDB. All 15 focused LICM and SSA tests
passed on the split checkout.

## Split branch confirmation

A fresh control-first pair used the same frozen source and both native
timing locks. The control and candidate outputs matched each other and
the signed reference by cmp. Both inferiors exited zero under LLDB.

| Compiler     | Wall (s) | CPU (s) | Cycles (billions) | Peak sampled RSS (MiB) |
| ------------ | -------: | ------: | ----------------: | ---------------------: |
| Main         |  159.244 | 177.758 |           658.103 |                2,090.3 |
| LICM and SSA |   85.669 | 101.746 |           434.721 |                2,051.8 |

## Object suite memory

The separate Node v24.12.0 compile-only runs used the pinned Object
selection at Test262 commit
`91c70759363c46557b694792bf34a2551a7af5ba`, with all 2,252
variants in one monolithic image. Both used 4,096 MiB V8 old space and
4 MiB semi-spaces. Peak process RSS rose from 4,761 MiB on main to
5,196 MiB with LICM and SSA. The native self-compile peak fell from
about 2,090 to 2,051 MiB.

The Object images were byte-identical. Each was 189,938,783 bytes,
SHA-256 `101fb0f4674648a163500a09793b756aec7d1e0baefc4e6ee721f50fd1485290`.
The harness stopped after publishing the executable.

Raw runs are preserved under `.tint-bootstrap/parallel-experiment.DQ4p4zZ9/`
in the original experiment worktree. The split validation copies are in
`.tint-bootstrap/serial-confirmation/` in the split checkout.
