# Faster `check-native`: research and proposal (v1, 2026-11-24)

Research only. Nothing here changes CI, the gate or any test. The proposals are
for the orchestrator and the user to choose from. They are meant to work with
the `ci/fast-gate` restructure (one bootstrap per target that fans out to
parallel jobs).

## Summary

- **Builds are the bottleneck.** On the macOS CI runner the native batch spends
  **1,289 s building** 85 images (88 builds), one at a time, because CI sets
  `TINT_GATE_MEMORY_SLOTS=1`. It spends **840 s launching** them, one at a
  time under the launch lock. The batch's wall time is 1,557 s. Speeding up
  launches alone saves only about 2 minutes.
- **Six images cost 57% of build time.** The median build is 7.1 s, but six
  images of 24–81 MB take 86–185 s each (737 s together). Two of them,
  `gc-granule-churn` and `gc-release-churn`, fall back to the general path by
  accident. They pull the whole JavaScript runtime into GC tests that were
  written for typed records.
- **About 80% of each small build is the same for every program.** That
  share is the allocator, the runtime and the workspace parse. Today they are
  recompiled for every image. Memoizing them in a prototype built 17 fixtures
  in **15.9 s instead of 42.1 s**, with **every image byte-identical**.
- **About 2.8 s of each ~3 s launch is LLDB's command path.** The cost comes
  from LLDB's `process launch --stop-at-entry`, not from debugging. The SB API
  makes the same stopped-at-entry launch with the same exit-state assertion in
  about **0.22–0.35 s** from a fresh LLDB, or about **65 ms** per launch in one
  persistent LLDB session. Locally the command form takes 2.2–2.5 s. The
  programs stay under LLDB, so AGENTS.md's containment rule is still met.
- **Recommended order:**
  1. Fixture compile cache.
  2. LLDB SB-API driver.
  3. Fix the two accidental general fallbacks.
  4. Remove the duplicate devtools builds.
  5. Decide on node-os and memory slots.
  6. Size the fan-out shards.

  Modelled `check-native` time falls from **26–27 min to about 13–14 min on
  one runner** (steps 1–4), about 11–12 min with step 5, and about 5–6 min per
  shard with a 3-way fan-out.

- **PR #17 alone would add about 650 s of builds.** Its evidence run adds 20
  fixtures, ten of them 24 MB general-surface images at 52–100 s each. Without
  the structural fixes, `check-native` heads for 35–40 minutes.

## Evidence

| Source                                                                                                                                                          | What it gives                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI run [45351729932](https://github.com/Sequins-dev/tint/actions/runs/45351729932) on main `c923cfc6c`, macOS job                                               | `check-native active-ms=1619061`; `native-images built=85 admitted=85 launch-attempted=84`; the `native-tests-macos-26` artifact (`check-native.log`, per-test durations, which include lock and slot waits)  |
| CI run [45321827967](https://github.com/Sequins-dev/tint/actions/runs/45321827967), attempt 1, `eee2d2c3d` (an ancestor of main), evidence artifact 14890501728 | The complete `native-images.jsonl`: per-image build, admission and execution times with no waits; `native-batch active-ms=1557324`. The batch failed in one devtools heap test, so the evidence was uploaded. |
| CI runs 45264851599 (`052341d05`) and 45307028578 (PR #17, `c0b2e5f46`)                                                                                         | Variance (1,770 s and 2,250 s active), and PR #17's growth to 105 images                                                                                                                                      |
| Local, Apple M5 Max, host load 4–15 (other streams running)                                                                                                     | LLDB launch variants on a 16 KB clang `exit(42)` binary under the launch lock; build phase split and memo prototypes with `TINT_BUILD_ONLY=defer-admission` (nothing launched)                                |

On success, CI uploads only `check-native.log`. `native-images.jsonl` is
uploaded only on failure, so per-image data comes from failed attempts.

### How CI spends the batch (run 45321827967, journal)

| Resource                      |   Total | Notes                                                                                                                                                                                                                |
| ----------------------------- | ------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builds (memory slot, 1 on CI) | 1,289 s | 88 builds: 85 images plus 3 build-only failure checks (2 × `node-os-other`, 1 × `bindgen-general-import-blocked`). Median 7.1 s, mean 14.8 s. The six 24–81 MB images take 737 s.                                    |
| Admissions (launch lock)      |   253 s | 85 launches at about 3.0 s each: `lldb --batch`, `process launch --stop-at-entry`, `process kill`                                                                                                                    |
| Executions (launch lock)      |   588 s | 150 launches. The median trivial run takes 3.1 s, nearly all LLDB overhead. Real program time is about 150–180 s, mostly devtools sessions, the large-heap `gc-compact` and the breakpoint-counted weak debug image. |
| Wall (2 workers)              | 1,557 s | Close to max(build, launch) + 0.2·min + 100 s. This is the model behind the estimates below.                                                                                                                         |

### Local measurements

**LLDB launch cost** (16 KB clang binary, ms; raw CSV kept in the session
scratchpad):

| Launch form                                                                                             |                                                 ms |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------: |
| Direct `exec` (first exec of a fresh copy / warm)                                                       |                                          7–9 / 7–8 |
| `lldb --batch` with no target (start-up only)                                                           |                                              64–69 |
| Gate admission form (`process launch --stop-at-entry`, assert stopped, `process kill`)                  |                                        2,189–2,306 |
| Gate run form (`native-target-runner.ts` `localDarwinRun`)                                              | 2,224–3,279, and 2,381–2,515 in a later quiet pair |
| `process launch` without `--stop-at-entry`                                                              |                                            221–225 |
| Fresh LLDB, SB API `target.Launch` with `eLaunchFlagStopAtEntry`, assert stopped, continue, exit status |             223–364, and 331–349 in the later pair |
| One LLDB session, five SB-API launches with the same assertions                                         |      60–76 each, 484 total including LLDB start-up |

**Build phase split** (`buildHostedFixture`, ms, from load-hook timestamps):

| Fixture                  | Workspace parse (`workspaceModules`) | Allocator |     Runtime |    Program | Link and write |
| ------------------------ | -----------------------------------: | --------: | ----------: | ---------: | -------------: |
| negative-zero            |                               ~1,240 |     1–265 | 1,230–1,600 |    350–470 |            ~20 |
| gc-stack-maps (3 images) |                       910–1,120 each |         — |           — |          — |              — |
| node-os                  |                               ~1,300 |       210 |       1,450 | **41,260** |            260 |

The workspace parse, allocator and runtime do not depend on the fixture
program, and every image redoes them. `node-os` is the counter-example: its
program phase includes the general/JS object surface and dominates.

**Memo prototype.** A measurement-only Node load hook memoized two things per
process:

- the runtime `compileNativeProgram` call in `compileMacOSProgram`
  (`packages/compiler/src/build.ts`, about line 1123), keyed by its options
  plus the module-id list;
- `workspaceModules(roots, snapshot)` in `tools/hosted-fixture.ts:432`, keyed
  by roots plus `sourceSnapshot`.

The test set was 17 fixtures from 10 files in one process (`gc-compact`,
`gc-stack-maps`, `safe-for-space`, `list-reads`, `gc-nursery-fallback`,
`string-code-units`, `negative-zero`, `map-set`, `remainder`, `key-index`):

| Run                      | Runtime memo hit/miss | Modules memo hit/miss |              Wall | Images                        |
| ------------------------ | --------------------- | --------------------- | ----------------: | ----------------------------- |
| Without memo             | —                     | —                     | 42.1 s and 49.4 s | reference                     |
| Runtime memo only        | 12/5                  | —                     |            39.1 s | 17/17 `imageSha256` identical |
| Runtime and modules memo | 12/5                  | 12/5                  |        **15.9 s** | 17/17 `imageSha256` identical |

**Memory.** Peak RSS of build-only runs:

| Build                                      | Peak RSS |
| ------------------------------------------ | -------: |
| `native-negative-zero`                     |  1.13 GB |
| `native-map-set`                           |  1.23 GB |
| `native-ffi` (25 images including node-os) |  2.45 GB |
| `node-os` alone                            |  2.10 GB |

## 1. Inventory of native tests

The table lists all 53 files in `tools/check-test-files.json` `native`.
Column key:

- **Build** and **Launch**: CI seconds from the journal of run 45321827967.
  Launch is admission plus runs.
- **Test**: the per-file sum of test durations in main run 45351729932. It
  includes memory-slot and launch-lock waits, so it overstates a file's own
  cost. For example, `native-host-facts` shows 279 s but does about 65 s of
  its own work.
- **Debugger use**:
  - _subject_: the test inspects the program with the debugger (breakpoints,
    backtraces, DAP, JIT loader).
  - _containment_: LLDB only contains faults and asserts stopped-at-entry and
    the final exit state; the check itself is an exit code (usually 42) or
    output.
  - _traps_: the exit is an expected trap or signal.

Per-image numbers are in the [appendix](#appendix-per-image-ci-costs).

|     # | Test file                                                                                                                                                                                                                                                                                                                                                                                                     |             Images | What it validates                                                                                                                                                                                                                                                                                                                                                                                                                                                      |         Build |                          Launch |          Test | Debugger use                                                | Native execution needed?                                                 |
| ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: | ------------------------------: | ------------: | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
|     1 | `tools/native-ffi.test.ts`                                                                                                                                                                                                                                                                                                                                                                                    | 25 (+2 build-only) | Leaf C calls through binding declarations: ABI probes, `createHash` against Node, `node:zlib` against system zlib and Node, optional libraries, external storage, C views, `tint:ffi/unsafe` views, `node:os` against Node, dynamic calls, callbacks (qsort, nesting, GC, exceptions), the registered zlib allocator, callback-contract traps. Most run on both the generational and copying runtimes. `node:os` builds 24 MB images (98 s and 86 s).                  |           330 |                             216 |           831 | containment; traps for the 4 contract violations            | Yes: C ABI and GC interaction                                            |
|     2 | `tools/runtime-diagnostics.test.ts`                                                                                                                                                                                                                                                                                                                                                                           |                  4 | An uncaught throw prints a symbolicated trace (exit 70). Default images print nothing. Signposted GC phases stay correct, and their names are in `__TEXT,__cstring`. **JIT debug**: an 81 MB image containing the in-image compiler JIT-compiles and registers code; LLDB resolves a pending breakpoint, backtrace and line, and a perf map is written.                                                                                                                | 201 (jit 185) |                              25 |           325 | jit-debug: **subject**; others: containment, stderr capture | Yes                                                                      |
|     3 | `tools/c-bindgen.test.ts`                                                                                                                                                                                                                                                                                                                                                                                     |  4 (+1 build-only) | 21 tests, mostly in-process emission and oracle checks. Native: a generated binding calls libc; a registered zlib allocator in may-callback calls (generational and copying); **general code imports a generated binding across a checked boundary** (24.5 MB, 149 s); the blocked import fails to build.                                                                                                                                                              |           186 |                              38 |           206 | containment                                                 | Yes for the 4 runs                                                       |
|     4 | `tools/native-gc-release.test.ts`                                                                                                                                                                                                                                                                                                                                                                             |                  2 | Majors copy into released semispace pages. `gc-release-churn` **falls back to general by accident** (24.6 MB, 117 s).                                                                                                                                                                                                                                                                                                                                                  |           123 |                              34 |           144 | containment                                                 | Yes (GC)                                                                 |
|     5 | `tools/native-gc-granule.test.ts`                                                                                                                                                                                                                                                                                                                                                                             |                  2 | Odd-word objects on 8-byte granules through minors and majors; weak slots and ephemerons among odd-word objects. `gc-granule-churn` **falls back to general by accident** (24.6 MB, 101 s).                                                                                                                                                                                                                                                                            |           110 |                              25 |           108 | containment                                                 | Yes (GC)                                                                 |
|     6 | `tools/native-weak.test.ts`                                                                                                                                                                                                                                                                                                                                                                                   |                  5 | Weak cells under the generational (small and large or parallel), copying and parallel collectors. A debug build counts LLDB breakpoint hits to prove the parallel weak and ephemeron paths ran.                                                                                                                                                                                                                                                                        |            30 |                              60 |           360 | parallel-debug: **subject**; others: containment            | Yes                                                                      |
|     7 | `tools/devtools-tint-plugin.test.ts`                                                                                                                                                                                                                                                                                                                                                                          |                  2 | DevTools Tint plugin: values as RemoteObjects; heap snapshots, sampling heap profiles, `collectGarbage`. The image is the **same program as devtools-core**.                                                                                                                                                                                                                                                                                                           |            25 |                              42 |           192 | **subject** (lldb-dap)                                      | Yes                                                                      |
|     8 | `tools/native-host-facts.test.ts`                                                                                                                                                                                                                                                                                                                                                                             |                  4 | Page size, CPU count and limit against the host; cgroup v1/v2/hybrid parsing from fixture files; SHA-256 on the instruction path and the forced portable path against Node.                                                                                                                                                                                                                                                                                            |            29 |                              36 |           279 | containment                                                 | Yes. The cgroup parser is portable, but AGENTS.md requires native proof. |
|     9 | `tools/native-gc-stack-maps.test.ts`                                                                                                                                                                                                                                                                                                                                                                          |                  3 | Precise stack maps across collections; wide maps stream on a bounded native heap; the x86-64 assembler, running natively, releases local fixups before allocating the image.                                                                                                                                                                                                                                                                                           |            29 |                              30 |            61 | containment                                                 | Yes                                                                      |
|    10 | `tools/native-gc-compact.test.ts`                                                                                                                                                                                                                                                                                                                                                                             |                  2 | Mark-compact majors are unobservable, with a small and a large heap (the large heap runs about 10 s).                                                                                                                                                                                                                                                                                                                                                                  |            16 |                              38 |            47 | containment                                                 | Yes                                                                      |
|    11 | `tools/devtools-tint.test.ts`                                                                                                                                                                                                                                                                                                                                                                                 |                  1 | DevTools bridge on a Tint debug build: breakpoints, inlined frames, scopes, stepping, pause.                                                                                                                                                                                                                                                                                                                                                                           |             9 |                              42 |            77 | **subject**                                                 | Yes                                                                      |
|    12 | `tools/native-gc-nursery-fallback.test.ts`                                                                                                                                                                                                                                                                                                                                                                    |                  2 | A nursery that cannot fit the old prefix compacts, with serial and pool marking.                                                                                                                                                                                                                                                                                                                                                                                       |            15 |                              19 |            40 | containment                                                 | Yes                                                                      |
|    13 | `tools/native-safe-for-space.test.ts`                                                                                                                                                                                                                                                                                                                                                                         |                  2 | Guarded reads keep closure semantics under collection; dead slot values are collected.                                                                                                                                                                                                                                                                                                                                                                                 |            14 |                              19 |            33 | containment                                                 | Yes                                                                      |
|    14 | `tools/native-list-reads.test.ts`                                                                                                                                                                                                                                                                                                                                                                             |                  2 | Cached list vectors stay current across calls, aliases, collections and throws; dense, sparse, holey and empty reads.                                                                                                                                                                                                                                                                                                                                                  |            13 |                              17 |            34 | containment                                                 | Yes                                                                      |
|    15 | `tools/native-string-code-units.test.ts`                                                                                                                                                                                                                                                                                                                                                                      |                  2 | Proven-index `charCodeAt` reads, and typed native code-unit conversions. A third test runs in Node only.                                                                                                                                                                                                                                                                                                                                                               |            12 |                              18 |            41 | containment                                                 | Yes                                                                      |
|    16 | `tools/large-image.test.ts`                                                                                                                                                                                                                                                                                                                                                                                   |                  1 | A signed multi-chunk, forced-far image: backtrace across far code, survives a copying collection.                                                                                                                                                                                                                                                                                                                                                                      |            11 | 3 (+ LLDB run outside the lock) |            40 | **subject** (breakpoint and `bt`)                           | Yes                                                                      |
| 17–33 | Single-fixture semantic files: `native-block-forwarding`, `-captured-loop-values`, `-counted-loops`, `-early-exit`, `-indirect-call-effects`, `-key-index`, `-list-capacity`, `-map-set`, `-negative-zero`, `-optional-numbers`, `-record-packing`, `-region-collection`, `-remainder`, `-slot-home-sharing`, `-string-dispatch`, `-string-equality`, `-string-lists`                                         |             1 each | One compiler or runtime property each: frame-word forwarding, captured-loop promotion, counted-loop bounds, frameless exits, indirect-call effects, key-index storage, list and Map/Set sizing, Map/Set order, −0 in integer slots, NaN-boxed optionals, packed record tags, the region collector, `%`, shared register homes, string-literal dispatch and equality, direct string lists. Each compares a Node-computed checksum, and the program exits 42 on a match. |     6–11 each |                        8–9 each |    14–23 each | containment                                                 | Yes: only execution proves the generated code                            |
|    34 | `tools/devtools-c.test.ts`                                                                                                                                                                                                                                                                                                                                                                                    |          1 (clang) | DevTools bridge on a clang `-g` C program (lldb-dap).                                                                                                                                                                                                                                                                                                                                                                                                                  |           0.5 |                              12 |            19 | **subject**                                                 | Bridge test, not Tint codegen                                            |
|    35 | `tools/devtools-profiler.test.ts`                                                                                                                                                                                                                                                                                                                                                                             |          1 (clang) | Backend stack-sampling CPU profiles. Two of its three tests are skipped on CI (need pprofessor).                                                                                                                                                                                                                                                                                                                                                                       |           0.2 |                               8 |            15 | **subject**                                                 | Bridge test                                                              |
|    36 | `packages/compiler/test/foreign-declarations.test.ts`                                                                                                                                                                                                                                                                                                                                                         |          3 (clang) | 18 in-process tests, plus 3 clang layout oracles (CommonCrypto SHA-256 context, zlib `z_stream`, darwin-os records) run after an LLDB admission.                                                                                                                                                                                                                                                                                                                       |           0.8 |                              10 |            25 | none (clang output)                                         | No: see §3                                                               |
|    37 | `packages/abi/test/c-abi-oracle.test.ts`                                                                                                                                                                                                                                                                                                                                                                      |          1 (clang) | `classifyCCall` agrees with clang. Clang-built capture stubs run directly after an LLDB admission.                                                                                                                                                                                                                                                                                                                                                                     |           1.0 |                               3 |             3 | none (clang output)                                         | Runs clang code, not Tint output                                         |
| 38–53 | `native-debugger-session`, `native-process-launch`, `native-run-control`, `native-target-runner`, `native-variant-selection`, `native-x64-ffi` (all 14 tests skipped on macOS), `perf-profile`, `shared-primitives`, `test262-native-extract`, `test262-native-heartbeat`, `test262-node`, `usdt-live`, `x64-hosted` (executions skipped), `x64-scalar`, `packages/image` `elf-x86-64`, `elf-linux` (skipped) |                  0 | Runner, debugger-command and launch plumbing with stand-in scripts; parsers; x86-64 and ELF emission checks; Test262 selection and reference adapter.                                                                                                                                                                                                                                                                                                                  |             0 |                               0 | 13 (together) | none, or deadlines                                          | No Tint image is built or run on macOS                                   |

## 2. Consolidation candidates

### 2a. Share the runtime and workspace parse across images (exact)

`compileMacOSProgram` already compiles the allocator, the runtime and the
program as separate units (`packages/compiler/src/build.ts:994–1236`), and
`linkMacOSProgram` joins them. The runtime compile depends on the following,
and not on the fixture program:

- the runtime entry;
- the memory module and its collector bindings;
- the options `optimization`, `debugSymbols`, `stackTraces`, `signposts`,
  `forceFarReach`, `maxSpecializations`;
- the target.

The allocator is similar. The workspace module parse depends on the source
snapshot and the roots. Caching these is a pure reuse: images stay
byte-identical, which the prototype showed for 17/17. This is the "precompiled
runtime, link only test code" option. Unlike Test262 units, it gives up no
closed-world optimisation, because the program is still compiled exactly as
today.

About 10 distinct runtime configurations cover all 85 images:

- region (default), generational and copying runtimes;
- debug builds (devtools, `weak-cells-parallel-debug`, `large-image`);
- `stackTraces`;
- `signposts`;
- `forceFarReach` with `optimization: "none"`.

See §4.1 for the mechanism.

### 2b. Build identical programs once

- **devtools-core, devtools-values and devtools-heap** (and devtools-cpu when
  the profiler test is enabled) all come from `buildDevToolsFixture(name)`
  (`tools/devtools-fixture.ts:87`): same source, same options, same
  `TINT_DEBUG_SYMBOLS=1`. Only the name differs, and it flows into
  `identifier: "tint-hosted-" + name`. Today they are 3 builds of about 9–13 s
  and 3 admissions on CI. Build once per gate and share the image (a
  content-addressed key that excludes the name), or keep one name. This saves
  about 25 s of builds and 6 s of launches.
- **Same program, different startup configuration.** The program compile does
  not see `managedBytes`, `allocationCapacity`, `rootCapacity` or
  `stackBytes`, which are used only at startup and link. A program-level cache
  keyed without them would therefore share compiles where only the heap
  differs. The current fixtures mostly also change their source with the heap
  size (`gc-compact` substitutes SCALE and HELD; `gc-nursery-fallback` and
  `source(managedBytes)`), so the gain here is small today.

### 2c. Multi-case images (one program, case selected by argument)

Use this only where the property under test does not depend on whole-program
analysis.

**Candidates.** The FFI runtime-behaviour fixtures, per runtime entry:
`ffi-abi-probes`, `ffi-crypto`, `ffi-availability`, `ffi-storage`,
`ffi-views`, `ffi-foreign`, `ffi-dynamic`, `ffi-callbacks`,
`ffi-zlib-callbacks`, `ffi-zlib`. Merging gives 2 images (generational and
copying) instead of about 20. Separately, `host-facts` and `cgroup-files`
share options and could become one image. The contract-trap scenarios must
stay separate, because the process dies by design.

**Value after §4.1 and §4.5:** small, about 1–2 s per merged image on CI (link,
write, admission). The risk is moderate: merged foreign-library sets can
change what `availability` sees as absent. Precedent: the scalar-native
harness already merges independent wrappers into one signed executable
(`docs/ir-evolution.md` §"Two debugger launches replace 1,268 launches"), and
Test262 batch hosts select cases by argument.

**Do not merge the codegen semantic fixtures** (rows 17–33, plus
`gc-stack-maps`, `safe-for-space`, `list-reads`, `string-code-units`). Each
tests a whole-program analysis or code-generation decision:

- `indirectCallTargets` in `native-indirect-call-effects`;
- `cacheListVectors` and `promoteLoopCells` in `list-reads` and
  `captured-loop-values`;
- interval facts and integer slots in `negative-zero`;
- `boundCountedLoops`;
- register-home sharing.

Adding other programs changes those analyses and the specialization and
inlining budgets. A single untyped construct in any merged fixture also moves
the module to the general fallback, silently changing what every fixture in it
tests.

## 3. Tests that could become cheaper checks

| Test                                                                                           | Property protected                                                             | Cheaper form                                                                                                                                                                                                 | Keeps the property?                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `foreign-declarations`: CommonCrypto, zlib and darwin-os layout oracles                        | Tint's record layouts match clang's for the system headers                     | Compile-only clang check with `_Static_assert(offsetof(T, f) == N && sizeof(T) == S)` generated from the layouts; nothing is executed                                                                        | **Yes.** It is the same clang computation with no image to admit. `c-bindgen`'s `layoutOracle` already runs its printf oracle by direct exec without LLDB, so today the two are treated inconsistently. |
| `c-abi-oracle`                                                                                 | `classifyCCall` places each value where clang's caller does                    | Keep execution: the captured register file is the oracle. Drop the LLDB admission, since it is a clang-built binary and the run is already a direct `spawnSync`.                                             | Yes (decision D5)                                                                                                                                                                                       |
| `runtime-diagnostics` signposts (macOS)                                                        | Signpost names are in `__TEXT,__cstring`; signposted GC stays correct          | The section and name checks are already static. Execution is needed for the GC part.                                                                                                                         | Already minimal                                                                                                                                                                                         |
| `native-ffi` "each target's node:os fails explicitly" and `c-bindgen` "general-import-blocked" | Resolution rejects the other target's binding                                  | Already build-only (no execution). Could move to the `memory` group.                                                                                                                                         | Yes (no time change)                                                                                                                                                                                    |
| `native-host-facts` cgroup parsing                                                             | The cgroup v1/v2/hybrid parser reads limits correctly                          | A Node unit test on the portable parser covers the logic, but AGENTS.md requires native proof for portable algorithms. Keep it native and merge it into the `host-facts` image (§2c).                        | Only with the native run                                                                                                                                                                                |
| Semantic fixtures (rows 9, 13–15, 17–33)                                                       | The generated native code agrees with ECMAScript for one optimisation          | Codegen unit tests (instruction sequences) cannot prove values; Node cannot run the output.                                                                                                                  | **No.** Native execution is the only proof. Cut their cost with §4.1 and §4.5 instead.                                                                                                                  |
| GC fixtures (rows 4–6, 10, 12)                                                                 | Collector behaviour                                                            | None; the collector exists only natively                                                                                                                                                                     | No                                                                                                                                                                                                      |
| `native-weak` parallel-debug                                                                   | The parallel weak and ephemeron paths actually ran                             | Runtime counters would replace the debugger, but the external-tools-only rule (no profiling in Tint output) argues for keeping LLDB                                                                          | Keep                                                                                                                                                                                                    |
| `node-os` copying variant                                                                      | `node:os` reads C memory correctly while a copying collection can move objects | `ffi-foreign` and `ffi-views` already cover views under both collectors. Running `node:os` on the default collector only drops the composition check, saves about 86 s of build and removes one 24 MB image. | Partly (decision D3)                                                                                                                                                                                    |
| 16 files with no image (rows 38–53)                                                            | Plumbing, parsers, emission                                                    | Already cheap (about 13 s). Files without deadlines or process launches could move to `concurrent`.                                                                                                          | Yes (frees native worker slots)                                                                                                                                                                         |

Summary: no native-only proof needs to be dropped. The savings are structural.

## 4. Build-side savings independent of the test list

### 4.1 Fixture compile cache (recommended first)

- **B1, per-process memo.** In `buildHostedFixture`, memoize:
  - `workspaceModules(roots, foreign.snapshot)`, keyed by `sourceSnapshot` and
    roots;
  - the allocator and runtime compile of `compileMacOSProgram`, keyed by their
    option set, the target and the source snapshot.

  This needs a small API in `build.ts`, either a `runtimeCache` hook on the
  `BuildRequest` or an exported `compileMacOSRuntime(request)`, rather than
  load hooks. Multi-image files profit right away: `native-ffi` has 25 images,
  `native-weak` 5, `c-bindgen` 5, `native-host-facts` 4, `gc-stack-maps` 3,
  and nine files have 2.

  Estimated CI saving: about 40 runtime hits × about 3.8 s plus about 48 module
  parses × about 2.5 s, roughly **280 s of build time**.

- **B2, gate-scoped disk cache for the compiled runtime and allocator**
  (`CompiledProgram` data, which is code, symbols, lines and entry), in the
  gate evidence directory. Every test file then reuses about 10 compiled
  configurations, giving about 35 more runtime hits, roughly **another 130 s**.
  Test262 units already cache compiled hosts on disk by toolchain, sources and
  configuration (`docs/test262-separate-compilation.md`), so reuse that
  serialization.
- **Acceptance.** All 85 images and manifests byte-identical with and without
  the cache, in one gate run. This is tools-only, so the stage images are
  unaffected. Key on the source snapshot: within one gate the tree is fixed.
- **Caveat.** Do not get the cross-file effect by running several test files
  in one process (`--test-isolation=none`). Several files set process-wide
  environment at import (for example `process.env.TINT_GENERAL_FALLBACK = "0"`
  in `native-negative-zero.test.ts`), and that would leak into other files'
  fixtures. Use the disk cache, or pass `requireTyped` explicitly first.

### 4.2 Remove the accidental general fallbacks (also a test-correctness fix)

`gc-granule-churn` and `gc-release-churn` log `general fallback for fixture
(check: fixture:2319:2331 / 720:729: invalid property read)`. The checker
rejects `current = current.next` and `cell = cell.next` inside
`while (x !== undefined)` loops whose variable is reassigned. That is valid
TypeScript, and it is the class of typed-path narrowing gap recorded in
`docs/design-4a-narrowing-errors.md`.

Consequences:

- Each of these GC tests builds the general runtime: 24.6 MB, 101–117 s on CI,
  versus about 7 s for its typed sibling.
- They no longer exercise the typed 1-, 3- and 5-word records their headers
  describe.

Under the unified-pipeline rule, the fix is the typed-path gap, not a rewrite
of the fixture. Either way, these tests should pin their path, as most
semantic fixtures do (`TINT_GENERAL_FALLBACK = "0"` or `requireTyped: true`),
so a silent fallback fails loudly. Saving: about **210 s of build time**.
Decision D4.

More broadly, every `general fallback for …` line in the native log means a
24 MB image. PR #17's run has six such lines, plus ten typed-classes images
that are 24 MB because of their general surface. Make that visible in the gate
summary: count the images of 20 MB or more and the fallback lines.

### 4.3 Avoid duplicate builds

The devtools fixture is built three times (§2b). Generally, key images by
content (source, options, snapshot) excluding the name, and share admitted
images within a gate.

### 4.4 Memory slots on the CI runner

CI runs with `TINT_GATE_MEMORY_SLOTS=1` on a 7 GB runner. Small fixture builds
peak at 1.1–1.2 GB RSS locally, and heavy ones at 2.1–2.5 GB. `jit-debug` (an
81 MB image) has not been measured. A weighted semaphore would let two small
builds run together: heavy builds (any image expected at 20 MB or more, or
`allowJit`) take both slots. Measure CI RSS for `jit-debug` and `node-os`
first. Decision D6.

### 4.5 LLDB SB-API driver (keeps the AGENTS.md LLDB rule)

Replace the command-form launches with a short Python driver, a module that
LLDB imports with `command script import`. Three places use the command form:

- `localDarwinRun` (`tools/native-target-runner.ts:135`);
- `admitUnderLldb` (`tools/native-admission.ts:21`);
- the bespoke sessions in `verify-hosted-stack-traces.ts`,
  `verify-hosted-signposts.ts` and `verify-large-image.ts`.

The driver:

1. calls `target.Launch` with `eLaunchFlagStopAtEntry`;
2. asserts `eStateStopped`;
3. continues;
4. reports the exit status or the stopping signal, as the current marker lines
   do.

The assertions and containment are the same as today. Expected: about
3.0 s → about 0.4 s per launch on CI, scaled from 2.2–2.5 s → 0.22–0.35 s
locally. That cuts the launch total from about 840 s to about **255 s**.

Further options:

- One persistent LLDB per worker brings launches to about 65 ms each. It needs
  stall handling inside the session, so it is phase 2.
- The admission launch could become the first run, with its execution
  deadline starting at the entry stop. That is cheap either way once launches
  are fast.

Validate on CI before relying on the CI factor.

Two smaller findings belong to the same owner:

- `verify-large-image.ts` launches LLDB outside the launch lock, so the
  journal shows `launch-attempted=84` of 85.
- It retries once on `could not pause execution`, which conflicts with
  AGENTS.md "Do not automatically retry away failures".

### 4.6 Running admitted programs without the debugger (decision D2)

After §4.5, the remaining LLDB cost is about 0.3 s × about 225 launches, about
70 s of launch-lock time, mostly off the critical path. Dropping LLDB would
need:

- CI only, on a dedicated runner;
- ReportCrash disabled (`launchctl unload -w …/com.apple.ReportCrash.plist`);
- plain `posix_spawn` with exit status and signal as the outcome, which Test262
  already does by default (`selectNativeDebuggerLaunch`, "process" mode, in
  `tools/test262-native-process.ts`);
- the trap scenarios and the debugger-subject tests kept under LLDB.

It loses the stopped-at-entry assertion, which separates pre-entry launch
failures from faults. **Recommendation: not now.** §4.5 gets almost all of the
saving under the existing rule.

### 4.7 Evidence for sizing shards

Upload `native-images.jsonl` on success as well (a `ci/fast-gate` change), so
per-image costs exist for every run.

## 5. Expected CI time and recommended order

The estimates use the batch model fitted to run 45321827967:

> wall ≈ max(Σbuild, Σlaunch) + 0.2·min + 100 s, with one memory slot and two
> workers.

Local savings are scaled to CI by about 2.5× (small builds take 7 s on CI
against about 2.5–3.6 s locally under load). Treat these as ±15% until each
step is measured.

| Step (cumulative)                                      |         Σbuild (s) |   Σlaunch (s) |               Modelled `check-native` |
| ------------------------------------------------------ | -----------------: | ------------: | ------------------------------------: |
| Today (journal run; main run 45351729932 took 1,619 s) |              1,289 |           840 |                      1,557 s (26 min) |
| Only A: LLDB SB-API driver (§4.5)                      |              1,289 |          ~255 |                     ~1,440 s (24 min) |
| Only B1: per-process memo (§4.1)                       |             ~1,010 |           840 |                     ~1,280 s (21 min) |
| A + B1                                                 |             ~1,010 |          ~255 |                     ~1,160 s (19 min) |
| + B2: disk runtime cache                               |               ~880 |          ~255 |                     ~1,030 s (17 min) |
| + C: fix the two accidental fallbacks (§4.2)           |               ~670 |          ~255 |                       ~820 s (14 min) |
| + E: devtools dedupe (§2b)                             |               ~650 |          ~250 |                       ~800 s (13 min) |
| + D3: `node-os` on one collector (decision)            |               ~565 |          ~245 |                       ~710 s (12 min) |
| + D6: weighted memory slots                            |     ~500 effective |          ~245 |                       ~650 s (11 min) |
| + 3-way fan-out on separate runners (`ci/fast-gate`)   | ~190–250 per shard | ~80 per shard | ~5–6 min per shard, plus runner setup |

Two observations from the model:

- Once B and C land, builds fall below 840 s of launches, so **A is needed to
  keep launches off the critical path**. A alone, though, saves only about
  2 minutes.
- After C and D3, three images make up most of the remaining build time:
  `jit-debug` (185 s), `bindgen-general-import` (149 s) and `node-os` (98 s).
  They set the floor on one runner.

**Recommended order:**

1. **B1, per-process memo.** Small, exact and test-independent. Acceptance:
   byte-identical images and manifests.
2. **A, LLDB SB-API driver.** Small; same assertions; validate the CI factor.
3. **C, the two fallbacks.** Fix the typed narrowing gap, or decide D4; pin
   both tests' path.
4. **B2, disk runtime cache**, and **E, devtools dedupe.**
5. **Decisions D3 and D6.** Optionally the multi-case FFI images (§2c, low
   value).
6. **Fan-out sizing with `ci/fast-gate`.**

**Coordination with `ci/fast-gate`.** Its uncommitted `shardCheckTests` balances
by per-file cost from a reporter that sums test durations and first-to-last
wall time. Both include memory-slot and lock waits: `native-host-facts` shows
279 s against about 65 s of its own work. Points to agree with that delegate:

- Seed costs from the journal (build plus admission plus execution per
  worker).
- The **floor is the largest file**, `native-ffi.test.ts`: about 546 s of its
  own work today, and about 250 s after A and B, of which `node-os` is 184 s.
  Moving `node-os` into its own test file gives balanced shards.
- Keep `jit-debug` (in `runtime-diagnostics`), `bindgen-general-import` (in
  `c-bindgen`) and `node-os` in different shards.
- Each shard pays its own runtime compiles: about 10 configurations × about
  4 s.

## Decisions for the orchestrator and the user

| #   | Decision                                                                                                                         | Recommendation                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| D1  | Accept the SB-API LLDB driver as meeting "run under LLDB, assert stopped-at-entry and exit state"                                | Yes. It is the same debugger and the same assertions; only the launch API differs.           |
| D2  | Run admitted programs without LLDB on CI (ReportCrash off, dedicated runner)                                                     | Not now. It saves about 70 s off the critical path after D1.                                 |
| D3  | Run `node-os` on the default collector only, relying on `ffi-foreign` and `ffi-views` for collector coverage                     | Your call. It saves about 86 s of build and one 24 MB image per gate.                        |
| D4  | `gc-granule-churn` and `gc-release-churn`: fix the typed narrowing gap, or deliberately keep a general-path GC test (and pin it) | Fix the gap and pin both tests to the typed path.                                            |
| D5  | Run clang-built oracles (`c-abi-oracle`, layout oracles) without LLDB admission, or make the layout oracle compile-only          | Yes. They are clang output, not experimental Tint images, and `c-bindgen` already does this. |
| D6  | Weighted memory slots on the CI runner                                                                                           | After a CI RSS measurement of `jit-debug` and `node-os`.                                     |
| D7  | Multi-case FFI images                                                                                                            | Optional, low value after B and A.                                                           |

## Outside `check-native` (for the CI owner)

In run 45351729932 the two Test262 smokes take longer than `check-native`:
`smoke-units` 1,306 s and `smoke-program` 799 s, run one after the other, each
for a single test (2 variants). Most of that is compiling the Test262 host and
batch image. `check-memory` takes 569 s. Those are the next-largest items in
the 93-minute macOS job, and good fan-out candidates.

## Appendix: per-image CI costs

Run 45321827967, attempt 1, journal `native-images.jsonl`. Times are seconds
with no waits. The two "build-only" rows (three builds) are expected build failures with no
image. **Bold** sizes are images that link the general/JS runtime surface or
the in-image compiler.

| Test file                    | Image                              | Build | Admission | Runs | Run total | Size                     |
| ---------------------------- | ---------------------------------- | ----: | --------: | ---: | --------: | ------------------------ |
| c-abi-oracle                 | c-abi-oracle                       |   1.0 |       3.2 |    1 |       0.0 | clang C                  |
| c-bindgen                    | bindgen-general-import-blocked     |   6.6 |       0.0 |    0 |       0.0 | build-only failure check |
| c-bindgen                    | bindgen-general-import             | 149.4 |       3.2 |    2 |       6.3 | **24.5 MB**              |
| c-bindgen                    | bindgen-sample                     |  10.4 |       3.1 |    2 |       6.2 | 0.6 MB                   |
| c-bindgen                    | bindgen-zlib-allocator             |  10.9 |       3.0 |    2 |       6.1 | 0.8 MB                   |
| c-bindgen                    | bindgen-zlib-allocator-copying     |   9.1 |       3.0 |    2 |       6.9 | 0.8 MB                   |
| devtools-c                   | devtools-c                         |   0.5 |       3.1 |    1 |       8.5 | clang C                  |
| devtools-profiler            | devtools-cpu                       |   0.2 |       3.1 |    1 |       4.9 | clang C                  |
| devtools-tint                | devtools-core                      |   8.8 |       2.9 |    1 |      38.9 | 1.9 MB                   |
| devtools-tint-plugin         | devtools-heap                      |  12.8 |       2.9 |    1 |      32.9 | 1.9 MB                   |
| devtools-tint-plugin         | devtools-values                    |  11.7 |       3.8 |    1 |       2.2 | 1.9 MB                   |
| foreign-declarations         | commoncrypto-layout                |   0.2 |       3.1 |    1 |       0.0 | clang C                  |
| foreign-declarations         | darwin-os-layout                   |   0.2 |       3.5 |    1 |       0.0 | clang C                  |
| foreign-declarations         | zlib-layout                        |   0.4 |       3.3 |    1 |       0.0 | clang C                  |
| large-image                  | large-image                        |  10.5 |       3.1 |    0 |       0.0 | 5.0 MB                   |
| native-block-forwarding      | block-forwarding                   |  11.0 |       3.0 |    2 |       5.9 | 0.7 MB                   |
| native-captured-loop-values  | captured-loop-values               |   7.3 |       2.9 |    2 |       5.7 | 0.7 MB                   |
| native-counted-loops         | counted-loops                      |   6.5 |       2.8 |    2 |       6.2 | 0.6 MB                   |
| native-early-exit            | early-exit                         |   6.5 |       2.7 |    2 |       5.8 | 0.6 MB                   |
| native-ffi                   | node-os-other                      |   1.2 |       0.0 |    0 |       0.0 | build-only failure check |
| native-ffi                   | ffi-abi-probes                     |   7.6 |       2.8 |    2 |       6.0 | 0.6 MB                   |
| native-ffi                   | ffi-availability                   |   5.6 |       3.1 |    2 |       6.2 | 0.6 MB                   |
| native-ffi                   | ffi-callback-leaf-inside           |   4.1 |       3.0 |    1 |       3.1 | 0.8 MB                   |
| native-ffi                   | ffi-callback-leaf-later            |   4.6 |       2.8 |    1 |       3.1 | 0.7 MB                   |
| native-ffi                   | ffi-callback-ok                    |   4.3 |       2.8 |    2 |       5.8 | 0.8 MB                   |
| native-ffi                   | ffi-callback-thread                |   4.5 |       2.8 |    1 |       3.2 | 0.7 MB                   |
| native-ffi                   | ffi-callback-view-escape           |   4.6 |       2.7 |    1 |       3.0 | 0.8 MB                   |
| native-ffi                   | ffi-callbacks                      |   5.3 |       2.8 |    2 |       7.3 | 0.8 MB                   |
| native-ffi                   | ffi-callbacks-copying              |   4.7 |       2.7 |    2 |       7.1 | 0.8 MB                   |
| native-ffi                   | ffi-crypto                         |   5.7 |       3.2 |    2 |       6.3 | 0.7 MB                   |
| native-ffi                   | ffi-dynamic                        |   7.1 |       2.7 |    2 |       7.8 | 1.1 MB                   |
| native-ffi                   | ffi-dynamic-copying                |   7.6 |       2.9 |    2 |       5.8 | 1.1 MB                   |
| native-ffi                   | ffi-foreign                        |   6.3 |       3.1 |    2 |       6.7 | 0.8 MB                   |
| native-ffi                   | ffi-foreign-copying                |   6.4 |       3.2 |    2 |       6.7 | 0.8 MB                   |
| native-ffi                   | ffi-storage                        |   7.0 |       3.1 |    2 |       6.4 | 0.8 MB                   |
| native-ffi                   | ffi-storage-copying                |   6.0 |       3.2 |    2 |       9.1 | 0.8 MB                   |
| native-ffi                   | ffi-views                          |   7.7 |       3.2 |    2 |       6.0 | 0.8 MB                   |
| native-ffi                   | ffi-views-initializeCopyingRuntime |   8.3 |       2.8 |    2 |       6.4 | 0.8 MB                   |
| native-ffi                   | ffi-zlib                           |  14.5 |       3.1 |    2 |       6.9 | 1.3 MB                   |
| native-ffi                   | ffi-zlib-callbacks                 |   5.5 |       2.9 |    2 |       6.4 | 0.8 MB                   |
| native-ffi                   | ffi-zlib-callbacks-copying         |   5.5 |       2.7 |    2 |       6.0 | 0.8 MB                   |
| native-ffi                   | ffi-zlib-copying                   |  11.4 |       3.2 |    2 |       7.0 | 1.4 MB                   |
| native-ffi                   | node-os                            |  98.3 |       3.0 |    2 |       6.4 | **24.2 MB**              |
| native-ffi                   | node-os-copying                    |  86.0 |       3.1 |    2 |       6.3 | **24.6 MB**              |
| native-gc-compact            | gc-compact (large heap)            |   7.8 |       3.8 |    2 |      25.5 | 0.7 MB                   |
| native-gc-compact            | gc-compact (small heap)            |   8.2 |       2.7 |    2 |       6.2 | 0.7 MB                   |
| native-gc-granule            | gc-granule-churn                   | 101.4 |       3.3 |    2 |      12.6 | **24.6 MB**              |
| native-gc-granule            | gc-granule-weak                    |   8.4 |       3.1 |    2 |       6.0 | 0.7 MB                   |
| native-gc-nursery-fallback   | gc-nursery-fallback-parallel       |   6.5 |       2.8 |    2 |       6.4 | 0.6 MB                   |
| native-gc-nursery-fallback   | gc-nursery-fallback-serial         |   8.7 |       3.0 |    2 |       6.5 | 0.6 MB                   |
| native-gc-release            | gc-release-churn                   | 116.9 |       3.4 |    2 |      19.8 | **24.6 MB**              |
| native-gc-release            | gc-release-large                   |   5.6 |       3.2 |    2 |       7.9 | 0.6 MB                   |
| native-gc-stack-maps         | gc-stack-maps                      |  10.5 |       2.9 |    2 |       6.5 | 0.7 MB                   |
| native-gc-stack-maps         | wide-stack-map-stream              |  10.3 |       3.1 |    2 |       6.8 | 0.9 MB                   |
| native-gc-stack-maps         | x64-local-relocations-heap         |   8.6 |       3.0 |    2 |       7.3 | 0.9 MB                   |
| native-host-facts            | cgroup-files                       |   6.9 |       3.0 |    2 |       6.1 | 0.7 MB                   |
| native-host-facts            | host-facts                         |   8.3 |       3.0 |    2 |       6.5 | 0.7 MB                   |
| native-host-facts            | sha256-instructions                |   7.6 |       3.1 |    2 |       6.1 | 0.7 MB                   |
| native-host-facts            | sha256-portable                    |   5.6 |       2.9 |    2 |       5.6 | 0.7 MB                   |
| native-indirect-call-effects | indirect-call-effects              |   7.6 |       2.7 |    2 |       5.5 | 0.7 MB                   |
| native-key-index             | key-index                          |   9.4 |       2.7 |    2 |       5.8 | 0.9 MB                   |
| native-list-capacity         | list-capacity                      |  11.3 |       2.9 |    2 |       5.7 | 0.8 MB                   |
| native-list-reads            | list-reads                         |   5.4 |       2.7 |    2 |       5.6 | 0.6 MB                   |
| native-list-reads            | list-reads-mutating                |   7.4 |       2.8 |    2 |       5.7 | 0.7 MB                   |
| native-map-set               | map-set                            |   7.9 |       2.9 |    2 |       5.7 | 0.9 MB                   |
| native-negative-zero         | negative-zero                      |   7.7 |       2.9 |    2 |       5.8 | 0.6 MB                   |
| native-optional-numbers      | optional-numbers                   |   7.0 |       2.7 |    2 |       5.6 | 0.6 MB                   |
| native-record-packing        | record-packing                     |   6.9 |       3.2 |    2 |       6.1 | 0.7 MB                   |
| native-region-collection     | region-collection                  |   7.8 |       2.9 |    2 |       6.3 | 0.7 MB                   |
| native-remainder             | remainder                          |   9.1 |       2.7 |    2 |       6.3 | 1.0 MB                   |
| native-safe-for-space        | safe-for-space-closures            |   7.5 |       3.0 |    2 |       6.8 | 0.7 MB                   |
| native-safe-for-space        | safe-for-space-collectable         |   6.3 |       2.7 |    2 |       6.1 | 0.7 MB                   |
| native-slot-home-sharing     | slot-home-sharing                  |   9.8 |       3.0 |    2 |       5.8 | 0.7 MB                   |
| native-string-code-units     | string-code-unit-integer           |   5.2 |       2.7 |    2 |       5.9 | 0.6 MB                   |
| native-string-code-units     | string-code-units                  |   6.3 |       2.9 |    2 |       5.9 | 0.6 MB                   |
| native-string-dispatch       | string-dispatch                    |   7.1 |       3.0 |    2 |       5.8 | 0.6 MB                   |
| native-string-equality       | string-equality                    |   6.0 |       2.9 |    2 |       6.2 | 0.6 MB                   |
| native-string-lists          | string-lists                       |   7.0 |       2.6 |    2 |       5.7 | 0.7 MB                   |
| native-weak                  | weak-cells-copying                 |   4.4 |       2.7 |    2 |       5.6 | 0.7 MB                   |
| native-weak                  | weak-cells-generational            |   7.9 |       2.9 |    2 |       5.8 | 0.7 MB                   |
| native-weak                  | weak-cells-generational-large      |   4.9 |       2.7 |    2 |       5.7 | 0.7 MB                   |
| native-weak                  | weak-cells-parallel                |   3.4 |       2.7 |    2 |       8.1 | 0.7 MB                   |
| native-weak                  | weak-cells-parallel-debug          |   9.8 |       3.1 |    1 |      20.3 | 1.9 MB                   |
| runtime-diagnostics          | signposts-test                     |   5.0 |       2.6 |    1 |       2.8 | 0.6 MB                   |
| runtime-diagnostics          | stack-traces-default-test          |   4.5 |       2.7 |    1 |       2.8 | 0.6 MB                   |
| runtime-diagnostics          | stack-traces-test                  |   6.4 |       2.6 |    1 |       2.8 | 1.0 MB                   |
| runtime-diagnostics          | jit-debug-test                     | 184.6 |       4.1 |    1 |       4.4 | **80.8 MB**              |
