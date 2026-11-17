# Unified typed/untyped pipeline

Status: design, 2026-11-17. Direction: typed and untyped code go through one
build pipeline with identical feature coverage. Plain JavaScript is fully
untyped TypeScript; type annotations and inferred facts only select faster
specializations. A construct that compiles untyped must compile typed. This
note records how the split works today, the target, and the migration slices.
[Progressive lowering](progressive-lowering.md) owns the HIR/pattern model this
converges onto; [value representations](representations.md) and
[runtime type contracts](runtime-types.md) own the representation and
mismatch policies used here.

## Current split

### Two front ends, one back end

There is already a single back end. Both front ends produce a TypeScript AST
that the same typed pipeline compiles:

| Stage                   | Typed (TypeScript application code)                                                                                                                                            | General (JavaScript; typed modules after fallback)                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Front end               | source modules as written                                                                                                                                                      | `eraseTypeSyntax` (`typescript/syntax/erase-types.ts`), then `lowerSourceTextModule` (`js-engine/lowering`) |
| Output of the front end | the program itself                                                                                                                                                             | TypeScript modules of `js-runtime` helper calls over `unknown` values, plus a generated typed host          |
| Shared from here        | `linkModules` → `bindModule` → `prepareNativeGlobals` → `specializeModule` → `checkClosureModule` → ts-native closure/scalar lowering → IR optimizer → AArch64 emitter → image | same                                                                                                        |

`compileTypedProgram` (`compiler/src/native/index.ts`) links every module into
one merged module before binding and checking, so a failure is attributed back
to a module through `locateSource`.

The typed checker (`typescript/src/checker/closures.ts`, `index.ts`,
`interfaces.ts`, `class-initialization.ts` and `binding/index.ts`, about 150
`UNSUPPORTED` sites) accepts only what ts-native can specialize, against a
closed set of built-in globals (`undefined`, `NaN`, `Infinity`, `Array`,
`Boolean`, `String`, `Number`, `Math`, `Map`, `Set`, four typed-array kinds,
`ArrayBuffer`, `DataView`, `TextEncoder`, `TextDecoder`, `TypeError`,
`RangeError`, `console`) whose implementations are native-runtime strict
builtins. There is no `Error`, `Object`, `Reflect`, `Symbol`, `Promise`, `JSON`
or `RegExp` in the typed world; that is where gaps such as `new Error`,
`.message` on a caught value, `instanceof Uint8Array` and `toLowerCase` come
from. The general path instead targets a complete ECMAScript realm
(`js-runtime` intrinsics installed by the generated host).

So the split is not two back ends but two **front ends with two standard
libraries and two object models**:

- Typed values use type-directed representations: unboxed numbers and
  booleans, native strings, closed-world records with fixed layouts, typed
  lists, native Map/Set, native typed arrays, closures, and a two-word
  category/payload encoding for `unknown` and heterogeneous unions.
- General values are always the two-word encoding (`unknown`); objects are
  `js-runtime` ordinary/exotic objects (`ObjectValue` records with shapes,
  descriptors and prototypes). Identifiers resolve by name through environment
  records (`resolveBinding`/`getIdentifierValue`), not slots.

The two-word general encoding and strings are physically shared: `js-runtime`
is itself typed TypeScript over `unknown` and `string`. Typed records, lists,
closures and Map/Set have no `js-runtime` object view.

### Where the decision is made

`compileArm64Program` first runs `compileTypedProgram`. Only when it fails and
the request carries a `GeneralLowering` (and a `start` export) does it fall
back:

1. `generalApplicationModules` collects application modules reachable from the
   entry; trusted runtime, host-bound, record-bound and service modules may not
   be imported by general code (this is the "general code cannot import
   runtime/FFI modules" gap).
2. The module the failure is attributed to seeds the general set
   (unattributed failures make the whole application general).
   `closeGeneralPartition` (`general-partition.ts`) closes it: every importer
   of a general module becomes general, because typed code consumes only typed
   values, and every typed module whose used exports cannot cross a checked
   boundary becomes general.
3. `createGeneralLowering` (`js-engine/src/program`) erases and lowers the
   general modules and generates a host whose `start` creates a realm,
   installs every intrinsic, loads, links and evaluates the module records,
   calls the start export and drains jobs.
4. The typed pipeline compiles the original modules plus the generated ones;
   retries grow the seed until it converges. The result is reported in
   `CompiledProgram.general` and `BuildRequest.onGeneralFallback`.
   `TINT_GENERAL_FALLBACK=0` (hosted fixtures) disables it.

Only `tools/hosted-fixture.ts` passes a `GeneralLowering`. The compiler CLI
(`compiler/src/cli.ts`, `project.ts`), library builds without a `start` export
and the compiler's own self-build have no fallback: there, a typed rejection is
a build failure. `@tint/compiler` cannot import `@tint/js-engine` (it depends
on the compiler), so the lowering is injected by a composition root.

### How values cross today

A typed module used by general code is presented as a synthetic module record.
`boundaryExport` admits only non-generic, non-async, non-generator functions
whose parameters and result are `number`/`string`/`boolean`/`undefined`/`null`
(or unions of them), and primitive-typed constants. Each argument is narrowed
by `checkedArgument`; a mismatch throws a TypeError. That TypeError deviates
from [runtime type contracts](runtime-types.md), where a mismatch must not
introduce a new exception. Nothing crosses from general into typed code: a
typed importer of a general module is always made general.

The consequences:

- fallback is per module and contagious upward through importers;
- one rejected construct makes its whole module, and usually most of the
  application, general, losing all typed specialization there;
- typed and general code see different realms and standard libraries, so even
  primitives behave identically only because they are physically shared.

## Target architecture

### Principles

1. **One front end.** Parse → bind (the full-language binder, which already
   handles every construct, scopes, `var`, Annex B and direct eval) → collect
   type facts → lower. Annotations, inference and the checker supply facts;
   they never decide whether a program compiles. JavaScript sources are the
   case with no annotations.
2. **Every construct has a general lowering** with full ECMAScript semantics:
   the js-engine rewrite into `js-runtime` operations over two-word values.
   This is the semantic definition of the construct.
3. **Facts select specializations.** Where facts prove a representation
   (number, string, a record layout, a typed list, a closure signature), the
   ts-native lowering replaces the general form. A specialization exists only
   where it is equivalent to the general form under the proven facts.
4. **Representation follows provable facts.** A value whose type the typed
   world cannot model (`Error`, `Promise`, a class with features the record
   planner cannot lay out, `any`, a union the encodings cannot hold) gets the
   general representation, and operations on it are general. This replaces
   checker rejections: "unsupported type" becomes "general representation".
5. **One realm, one standard library.** Typed builtins (native Math, Map, Set,
   typed arrays, string methods) are specializations of the realm's intrinsics
   chosen when the receiver's representation is proven, not a separate
   library. Unmodelled globals resolve to realm intrinsics.
6. **Fallback is per construct.** The unit of generality is the smallest
   construct whose specialization is unavailable: an expression, a statement,
   a function (for suspension, direct eval and `arguments`), a class. The
   module fallback disappears.

### Representation boundaries inside a function

A typed function containing a general construct (an _island_) stays one native
function. The island is the general lowering of that construct spliced inline,
so evaluation order and abrupt completion are the construct's own. Crossings
are explicit IR operations at the island's edges:

- **Reading** a typed binding inside an island boxes it at the read site
  (`toGeneral`). Primitives box without allocation (category/payload). Strings
  are shared. References use the value bridge below.
- **Writing** a typed binding from an island unboxes at the write site
  (`fromGeneral<T>`). When the checker cannot prove the written value has the
  binding's representation, the binding itself is given the general
  representation for its whole lifetime; typed uses then read it through a
  cheap checked projection. A write-back never needs a runtime failure path.
- **Island results** flowing into a typed context use the same rule: a proven
  representation is projected (one tag check for primitives); otherwise the
  consumer is general.
- **Completions** (`return`, `break`, `continue`, `throw`) inside an island
  are the general lowering's completion handling, targeting the typed
  function's labels and exits. Exceptions are already one mechanism: typed
  `throw`/`catch` and `js-runtime` throws share the native unwinder; a caught
  value in typed code is general unless a fact proves otherwise.
- **Suspension** (`yield`, `await`), direct `eval`, `with` and `arguments`
  change the frame, so their unit is the enclosing function, which becomes a
  general function object with a typed calling adapter.

No snapshot or copy-back exists: islands read and write at the original program
points, so closures and aliases observe the same values in the same order.

### The value bridge

Boxing must preserve identity, so reference values need JavaScript object
views:

- **Typed records and class instances** box to a `js-runtime` exotic object
  whose internal methods consult compiler-emitted layout metadata (property
  names, field offsets and encodings, read-only flags, prototype) and read and
  write the record's own storage. Identity is per record (one view per record,
  found through a side table or a header-reachable link), so `===`, WeakMap
  keys and repeated crossings agree. Writes check the field's representation;
  a type-changing write follows the [runtime type contracts](runtime-types.md)
  generalization policy (until storage generalization exists: a TypeError at
  the write, documented as a deviation, the same policy as today's boundary).
- **Typed lists, Map, Set and typed arrays** box to Array/Map/Set/TypedArray
  exotics over the same storage (typed arrays already back `js-runtime` byte
  storage with native `Uint8Array`, so views share bytes).
- **Closures** box to callable objects whose `[[Call]]` boxes arguments and
  projects the result; a typed function receiving a general callable calls it
  through `callObjectValue`.
- **Unboxing** a general value to a proven reference representation succeeds
  when it is a view of a compatible layout (the view's record is returned) and
  otherwise leaves the consumer general (principle 4). Only the old module
  boundary and field writes keep a TypeError path, and both are listed as
  deviations to remove with storage generalization.

The bridge is also what lets general code import typed, trusted runtime and
FFI modules: their exports cross as boxed values with typed adapters instead
of being refused.

### What happens to each front end

- js-engine lowering becomes a library of construct lowerings callable for a
  subtree, with a binding resolver hook: names bound outside the island
  resolve to typed bindings through the bridge, not to environment records.
  Whole-module JavaScript is the degenerate case where everything is general.
- The typed checker becomes a fact provider: rejections become "general
  representation" or "island" decisions with the reason recorded.
- ts-native keeps its specialized lowerings. The [HIR migration](progressive-lowering.md#migration)
  later expresses each construct as an op with a general pattern (the island
  lowering) and higher-benefit typed patterns.

## Migration slices

Each slice is independently mergeable, removes a class of typed-only gaps or
contagion, and leaves the module fallback as the last resort until slice 6
removes it.

| #   | Slice                                                                                                                                                                                                                                                                                                                                            | Removes                                                                                                                                              | Depends on |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0   | **Ledger and guardrails.** A corpus of construct fixtures, each in typed and untyped form; a test records which typed forms reach the general path and the reason. `CompiledProgram.general` reports units (module now; function/island later). Perf-critical builds (compiler self-build, frozen v3, feature-bench kernels) assert no fallback. | Silent typed-perf loss; establishes the gap count this work drives to 0.                                                                             | —          |
| 1   | **Program realm.** One lazily created realm per program, owned by a runtime module, used by the general host and by later islands; intrinsic installation demand-driven so unused intrinsics are not linked.                                                                                                                                     | Duplicate realm setup; image cost of the realm in typed programs.                                                                                    | 0          |
| 2   | **Value bridge for references** (records, class instances, lists, Map/Set, typed arrays, closures), with compiler-emitted layout metadata. First user: module boundaries accept any export (functions with any signature, classes, objects), and typed importers of general modules project declared types or stay general.                      | Upward contagion; "general code cannot import runtime/FFI modules".                                                                                  | 1          |
| 3   | **Function and class granularity.** A rejected top-level function or class lowers through js-engine as a general function/class object inside the typed module; typed callers use an adapter (box arguments, project the result). Nested functions follow, with captured typed bindings shared through closure cells and bridge reads/writes.    | Module-wide loss for generators, async, `var`, inheritance, accessors, private elements, decorators, `arguments`, direct eval.                       | 2          |
| 4   | **General representation for unmodelled types.** The checker types unmodelled globals and types as general instead of rejecting; their operations are general; unmodelled globals resolve to realm intrinsics. Native builtins become specializations selected by proven receivers.                                                              | `new Error`, `.message`, `instanceof` on realm constructors, missing Math/String/DataView members, `Reflect`, `JSON`, `Object`, `Symbol`, `Promise`. | 1, 2       |
| 5   | **Expression/statement islands.** Remaining checker rejections become islands with the boundary rules above.                                                                                                                                                                                                                                     | Destructuring, spread, object spread, optional/computed members and the remaining `UNSUPPORTED` sites inside otherwise typed functions.              | 2, 4       |
| 6   | **One entry.** JavaScript modules and Scripts enter the same front end with no facts (everything general) instead of the separate module fallback; `closeGeneralPartition` and the retry loop are deleted. The compiler CLI composes the general lowering, so native builds of untyped code work outside hosted fixtures.                        | The module fallback; the CLI gap.                                                                                                                    | 3, 5       |
| 7   | **Compiler sources.** The self-build may use any construct; an island report lists general units in compiler sources, and a self-build gate fails on new islands in measured hot paths. Then the HIR migration replaces island splicing with general patterns.                                                                                   | The compiler-source language restriction.                                                                                                            | 6          |

Orthogonal, schedulable at any point after slice 0: binder-resolved slots for
general code whose scopes cannot be observed dynamically (no direct eval or
`with`), replacing name-based `resolveBinding` per identifier. Untyped code
is only competitive once its locals are slots.

### Proof for every slice

- **Semantic tests** per construct: ordering, abrupt completion and boundary
  values in both typed and untyped form, compared with Node and run natively
  under LLDB (stopped-at-entry and exit state asserted). Divergences from Node
  are checked against the specification.
- **Typed path preserved.** `TINT_GENERAL_FALLBACK=0` builds of the existing
  typed fixtures and the slice-0 perf assertions pass; the ledger's typed
  general-unit count never rises.
- **Self-build fixpoint.** Node bootstrap, native stage2 and stage3 under LLDB,
  `cmp` identical.
- **Workspace and conformance.** `env -u TZ pnpm check`; the
  [pre-merge host smoke](test262-runner.md) and a GC-heavy file;
  `node tools/verify-heap-tools.ts`; a TZ=UTC Test262 slice covering
  `language/expressions/object`, `built-ins/Array`, `built-ins/Map` and
  `built-ins/Error`.
- **Frozen v3.** Output byte-identical to `.tint-bootstrap/workload-v3/out-sdisp`
  and no cycles or wall regression beyond noise:
  `lockf /Users/stephenbelanger/.t3/tint-timing.lock node tools/frozen-workload.ts run v3 <base> <variant> --rounds 6`.
  Slices that must not change typed output (0, 1 for typed-only programs) also
  compare images byte for byte.

## Risks

- **Compiler-source performance.** Once the self-build may contain islands, a
  convenient construct in a hot path silently costs the self-compile. Mitigated
  by the slice-0 assertion (no general units in the self-build until slice 7),
  then by the island report and its hot-path gate.
- **Image size and startup.** Any island links `js-runtime` and the realm. The
  current host installs every intrinsic eagerly; slice 1 must make installation
  demand-driven and lazy, or every typed program with one island pays for the
  whole realm. Measured per slice as image bytes and startup time.
- **Bootstrap order.** The compiler cannot import js-engine. Islands in the
  compiler's own build need the general lowering injected by a composition root
  above both packages (the CLI entry moves there in slice 6), and the bootstrap
  must build that root first. The self-build is also the first program where
  islands and closed-world record layout meet at scale.
- **Two object models during migration.** Until views are complete for a
  representation, values of that representation cannot cross and their users
  stay at the coarser granularity. The ledger makes each remaining case
  visible.
- **Mismatch policy.** Field writes and the legacy module boundary keep a
  TypeError path for type-changing writes until storage generalization exists;
  this is a documented deviation from the runtime-type contract, not a new
  restriction.
- **Parallel work.** The bridge reads record layout metadata that the GC work
  may be reshaping (record layout/packing, heap header); slice 2 must
  coordinate with it. General code importing FFI modules (slice 2) touches the
  FFI work's `tint:c` bindings.
