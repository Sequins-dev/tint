# Native fragment label guard

November 27, 2026. This macOS arm64 screen used PR #4 at `2912951cf`
for the native actor and `aa4cc4c69` for the focused optimizer test.
It follows the [Worker composition and checker profile](parallel-bounded-compile-worker-checker-cliff-v1.md).

## Where emission stops

The R8 fixture passes the lane ID into its shared helper as a numeric
argument. A diagnostic Node load hook confirmed that the build selected
typed Worker preparation. It produced a native image in 6m55s with the
ordinary AOT passes enabled.

The typed image opened a 48,099,259-byte shared input containing
7,846 functions in 33 ranges. The smoke selected ranges 30–32. All
three configurations trapped before returning a packet.

| Workers started | Thread that reached the trap | Packets returned | Peak RSS sampled before trap |
| --------------: | ---------------------------- | ---------------: | ---------------------------: |
|               0 | Coordinator                  |                0 |                  221,552 KiB |
|               1 | Worker                       |                0 |                  279,632 KiB |
|               2 | Worker                       |                0 |                  392,960 KiB |

These peaks are partial observations at a correctness failure. They
give no completed-run memory or speed comparison.

The three-function Worker-enabled fixture reproduced the trap on both
workers. The equivalent dedicated coordinator fixture reproduced all
three Node reference packets and exited 42. A reduced source fixture
writing the same optional-offset encoding with two record shapes, a
hole, and an explicit `undefined` also produced the expected bytes
and exited 42 in both its standalone and Worker-enabled coordinator
images. It did not reproduce the emitter crash.

## Native instruction and record layout

LLDB resolved the tiny Worker fixture to `writeLabels` at
`packages/codegen/src/aarch64/scalar/fragments.ts:511:31`, through
`writeRows` in `encodeFragment` and the closure from
`openFragmentActor`. The AArch64 operation map marks the trap as block
70 of function 6364, `@415:value:47$5025$direct`.

The actual row was nonnull. Its record descriptor matched the first
layout tested at `writeLabels+236`. The later read checked only the
second layout at `writeLabels+1780`. LLDB showed the first descriptor
in `x10` and the second descriptor in `x11`. The resulting
`b.ne` at `+1784` entered the `brk #0` at `+2148`. The misplaced
guard runs before the label loop reads the first offset.

## Focused LICM regression

The existing optimizer test “a union dispatch's later layout checks
stay behind the earlier check” passes. A variant inserts an empty block
with a jump between the first layout check's failure edge and the
second layout check. The preheader assertion fails immediately
(`record` instead of `jump`). The IR verifier accepted the input and
rewritten output in both cases.

`recordProofs` in `packages/ir/src/optimization/licm.ts` records only
immediate failure targets. `hoistLoop` therefore treats the second
layout's read as eligible when an intermediate block separates it
from the earlier check's failure edge. Hoisting it demands that
objects of the first layout satisfy the second layout before the loop
can test the first. This IR reproducer isolates the optimizer bug
independently of the native actor.

## The native IR before and after LICM

A fresh build with `TINT_DUMP_PASSES=@415:value:47` confirms the same
shape in `writeLabels`. After pass 51 the first layout, r5538, falls
through b13's load and jump to the r5444 check in b14. A second
dispatch similarly routes b10 → b17 → b18. In both dispatches only
the failure of the first layout can reach the second check.

Pass 52, `hoist-loop-invariants`, replaces the r5444 checks in b14
and b18 with slot copies. It inserts both checks in the preheader
chain b44 → b93 → b94 → b95, before either dispatch. Final IR b52
tests the same layout, renumbered r5133, and traps in b70 on a row
of the first layout. This is the branch observed under LLDB.

## Array-access allocation screen

A Node-hosted probe counted per-block substitution table allocations
in `selectArrayAccesses` on the captured pre-final-fold hot body and
the 12 outlined emission bodies with the most slots. Each body had
already passed through array access selection. The hot body took
15,068,441 analysis visits. The two outlined emitter bodies took
12,243,746 and 9,347,315 visits. Across the 13 inputs the probe
observed zero rewrites and zero substitution table allocations. The
screen rules out that allocation as an explanation for this replay's
work. It does not measure allocation at the original optimization
barriers.

## Reproduction

Raw artifacts are under `.tint-bootstrap/outline-v2.CaPaRsha`.
`stage-r8-smoke-darwin.log` and `stage-r8-worker-traps.log` preserve
the three failed runs. `actor-emission-label-guard.log` and
`actor-emission-writeLabels.disassembly` contain the symbolic stack,
registers, descriptor bytes and branches. The small fixture sources and
build manifests are in the same directory.
`actor-label-before-licm.ir`, `actor-label-after-licm.ir`, and
`actor-label-final.ir` preserve the matching pass dumps.
`count-bounds-allocation.{mjs,log}` contain the array-access probe.

Run the focused test and, separately, launch the already built native
fixture from the PR worktree:

```sh
p=$(cat .tint-bootstrap/outline-v2-current)
node --test "$p/repro-licm-union-failure-bridge.test.ts"

TINT_GATE_STEP_TIMEOUT=45 tools/gate/with-lock.sh launch actor-label-guard \
  /usr/bin/lldb --batch -o 'settings set target.disable-aslr false' \
  -o 'process launch --stop-at-entry' -o continue \
  -k 'register read x24 x10 x11 pc' -k bt -k 'process kill' \
  "$p/native-actor-emission-worker-symbols"
```
