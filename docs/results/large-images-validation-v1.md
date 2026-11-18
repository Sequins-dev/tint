# Large-image integration validation

Production sources at `357208b15` were compared with `main` at `0b782ef01`
using Node 24.12.0. See the [full-size verifier evidence](large-images-v1.md)
for the Mach-O and ELF launch, unwind and copying-collection observations.

## Gates

| Gate                                                 | Result                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Native subset                                        | Complete native compiler pipeline passed checking after specialization                                                   |
| `env -u TZ pnpm check`                               | 6,217 passed, 5 skipped, zero failures. Dependency and formatting gates passed.                                          |
| macOS arm64 self-build                               | Node stage1 = native stage2 = native stage3. SHA-256 `fc57933b7946a3932b1a0017545daf1285e6c3e4097d5ca589307acfed3dd986`. |
| Linux arm64 self-build on `dev`                      | Node stage1 = native stage2 = native stage3. SHA-256 `011b8052dd6e6cc4694d36441eccdbcd1c14af54fa44acb90efcc1bece120f17`. |
| Forced far and multi-chunk native FFI and weak cells | 30 passed. The forced far uncaught-throw trace test also passed.                                                         |
| Frozen Test262 host smoke                            | Both sloppy and strict variants of `language/expressions/object/11.1.5-0-1.js` passed in each of `units` and `program`.  |

The self-builds used captured sources and verified stopped-at-entry and zero
exit states under LLDB for each native generation. The Test262 host smoke
used the branch snapshot before the final invalid-budget guard change,
with source SHA-256 `c81f53d3e865a08b4da06c901f0937e2ca0e5cb02af5801e19d57e7b8d41834a`.
The runner emitted compile-phase `STALL` heartbeats while the compiler was
active. Both selections subsequently completed.

## Ordinary image equality

| Artifact                                     | Matching SHA-256                                                   |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Hosted fixture returning 42                  | `f0e86288126114793b5f0555af50fb9e0f1febb2899d06d23e2b4be3e2f2cb85` |
| Frozen v7 compiler image, common source path | `df00899a7defe1229e3302eb5bba7b1f56bb7d67c7d0eebaedcb3de0a0b3d99b` |
| Matched Test262 suite image                  | `9382f64a08ee0ff5df98c842c4c8fec93d1513a71fbcbe033bdb548d7ebe88d1` |

Each Test262 toolchain compiled the same captured 767-file program source graph
in suite mode with monolithic native services. Both 67,964,639-byte images
passed both variants. The matched input matters because the suite includes
Tint's compiler as part of its execution engine. The separately frozen
checkout-local suite images also passed both variants. Their source inputs
and image hashes differed.

## Frozen v7 timing

The specified timing command on the original v7 executables stopped on the
baseline after parsing. LLDB reproduced the trap in
`program:helper:allocate-finish`. The executable contains v4 stack-map tables
and the original v7 collector only recognizes v2 and v3. The candidate
executable was byte-identical to that baseline.

Both toolchains rebuilt v7 with the same current runtime files using
`frozen-workload.ts build v7 <label> --runtime-tree`. Cold-start LLDB
preflight completed on the baseline with exit 0. The compared text and
runtime unwind bytes had SHA-256
`7b490c6a494bf45501463ee8603cc0f6d8f9efd504f4268e01cd6e3848abca6d` on both.
The benchmark still compiled the original frozen v7 source. Three rounds
ran under the requested timing lock.

| Round | Main wall | Branch wall |  Main cycles | Branch cycles |
| ----- | --------: | ----------: | -----------: | ------------: |
| 1     |   73.08 s |     71.32 s | 349842335902 |  340892319979 |
| 2     |   69.61 s |     73.19 s | 340305180740 |  350661407847 |
| 3     |   71.94 s |     71.92 s | 346933571549 |  346478618339 |

The median wall times were 71.94 s on main and 71.92 s on the branch.
The final timed outputs were byte-identical with SHA-256 `d2952ace7f3782cdc36e69029f1f119b19cb9a20a64a97f84f1589998b559933`.
