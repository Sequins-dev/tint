# HOST-ESM M3a: dynamic import lowering plan

This is the detailed lowering plan for M3a, handed off by the
[M3a runtime plan](host-esm-dynamic-import-runtime.md) §8. It settles how
`import(s, o)` and `import.meta` lower in the `script` and `module` entries, and
how the eval and dynamic-function entries reject them. It also fixes the
`scriptRuntimeImports` signature, the red-first tests, the edit list and the
native gate. It does not repeat the runtime contracts (runtime plan §1–§5) or
the census counts.

This is research only: nothing else was edited, built or run, apart from one
cross-link in runtime plan §8. Main's G1 build and queue and its `pnpm check`
(564 source files) were left alone.

**All probes are Node v24.12.0 only and non-native.** The probe scripts are
`/tmp/m3a-lowering/probe.mts`, `baseline.mts` and `p/d2/main.mjs`. The first
two import the **source** lowerer (`js-engine/src/lowering/*.ts`) through
Node's type stripping, with the built `typescript`/`source` dist for parsing.
Nothing was emitted or written to the workspace.

## 1. Baseline (hashed 2026-11-05 14:10 PST, before any M3a lowering change)

| File                                          | sha256 (prefix) | Note                                   |
| --------------------------------------------- | --------------- | -------------------------------------- |
| `packages/js-engine/src/lowering/index.ts`    | `91ef2131918d…` | Identical to `…-fixture-syntax-v1`     |
| `…/lowering/runtime-imports.ts`               | `9108026f6032…` | Identical to `…-fixture-syntax-v1`     |
| `…/lowering/generators.ts`                    | `165530eca759…` |                                        |
| `packages/js-runtime/src/modules/referrer.ts` | `378c436d9377…` | Views plus referrer helpers (main WIP) |
| `…/modules/import-meta.ts`                    | `326f757c19bb…` | `getImportMeta` only                   |
| `…/modules/loading.ts`                        | `1fb8a05d99e6…` | Graph-only `ModuleLoader`              |
| `…/modules/source.ts`                         | `36401cd3c8f1…` | `createLoweredSourceModule`            |
| `…/modules/index.ts`                          | `66890fe4eec8…` | Exports views and referrer helpers     |
| `tools/test262-native.ts`                     | `4d11fd19921c…` | Graph-only loader text (line 543)      |
| `host-esm-dynamic-import-runtime.md`          | `d2d065719dd1…` | Before the §8 cross-link               |

**Lowered-output baselines** (`baseline.mts`, 16-hex sha256 of the
`JSON.stringify`ed result). Script: `42;` `1701798523d466c0`, optional call
`f6d4d675a6a50cb7`, async plus generator `74032e704242b891`, `new`/`??`
`fc437856b61975c4`, `eval("1");` `a127bc5b4136865d`, `using`
`a814d3fc647f1bec`. Module: hoisted export `a15de0902a705a52`, import plus
default `ee255721ef820054`, async export `5048934726531477`, optional `this`
`ffb4be691e49332f`. Whole output `17a7e3df88ba43a9…`.

**Vocabulary** (`probe.mts`): Script default 114 and module default 118. With
every flag set, `script` and `indirect-eval` have 124, `direct-eval` 126,
`function` 123, and `module` and `all` 128 each. `scriptRuntimeSurface()` has
128 entries and **none** from `@tint/js-runtime/modules`. Serialized hashes:
Script default `3957fac48d6069a9`, module default `f57bc746c0b1b0f7`, surface
`d5ab311fe176ee3a`.

## 2. Current source facts

**Entries.** `lowerScriptEntry` has five kinds: `script`, `module`,
`indirect-eval`, `direct-eval` and `dynamic-function` (`index.ts:160-167`).
`$262.evalScript` reaches the `script` kind at runtime through
`script-evaluation.ts:242`. Every entry receives `$global` and `$errors`. The
module factory is `create($global, $errors, $hostDefined)`, and Script code
reads `$global.hooks` the same way.

**Today's failures** (`index.ts:3044-3053`, probe). In `module`, `import()`
gives `dynamic import requires HOST-ESM M3` and `import.meta` gives
`import.meta requires HOST-ESM M3`. Every other entry reports the `import-call`
fall-through and rejects `import.meta` at parse time. The `defer` and `source`
phases fail like the evaluation phase. The span is the `import-call` node, for
example `[0,11]` for `import("x");`, and `parseDynamicFunction` adds a 25-byte
prefix (`[25,36]`).

**Expression machinery.** `value(node)` returns an expression and emits the
statements that compute it. `temporary(value, general)` pins it in
`const $valueN` (typed `unknown` when `general`), and operands are pinned in
source order (`argumentList`, `private-in`, `await`). `check(result.error)` is
the completion wrapper, needed only by helpers that return `{error, value}`.
JavaScript throws are native throws, caught by the entry's `try` and turned into
`finish("throw", $thrown)`. `rejectUnsupportedExecution` is sticky and throws
`undefined`, so `finishScriptExecution` reports `unsupported` even after a
catch. Helpers that return a plain object are emitted without `check`, for
example `createRegExpLiteral`, `getTemplateObject` and `createArrayObject`.

**Identity reaches nested code without lowering.** `createSourceExecutionContext`
captures the active `scriptOrModule` when a function is **created**
(`objects/jobs.ts:131-144`). Generators, async functions and jobs copy it
(`objects/generators.ts:143`, `async-functions.ts:99`, `jobs.ts:82,109`). Module
`instantiate` and `execute` both run under `{realm, scriptOrModule: module}`
(`linking.ts:76-80`, `evaluation.ts:66-70`). So hoisted functions, arrows, class
members, generators and async continuations defined in a module see that
ModuleRecord. Script bodies run under `scriptIdentity()`, which is `$script`
(`index.ts:5245-5250`). `createLoweredSourceModule` never passes the record to
its callbacks, and it does not need to.

**Managed surface.** `native/script-compile.ts:46` builds its approved
specifiers from `scriptRuntimeSurface()`. `normalizeManagedSurfaceApplications`
(`compiler/src/native/managed-applications.ts:34-44`) rejects any other
specifier, the compile returns `!ok`, and `script-evaluation.ts:198` calls
`rejectUnsupportedExecution`.

**Runtime APIs: present versus planned.**

| API                                                             | State                          |
| --------------------------------------------------------------- | ------------------------------ |
| `viewModuleRecord`, `viewScriptRecord` (`referrer.ts`)          | Present, exported; G1 pending  |
| `realmReferrer`, `activeModuleReferrer`, `ModuleReferrer` types | Present, exported (main WIP)   |
| `ScriptRecord.loadedRequests`, `ErrorRealm.realmReferrer`       | Present                        |
| `getImportMeta(module)`                                         | Present, workspace native pass |
| `getActiveImportMeta(realm): OrdinaryObject`                    | **Planned** (runtime D9)       |
| `evaluateImportCall(specifier, options, hooks, realm)`          | **Planned** (runtime §4)       |
| Widened `ModuleLoader`, `ModuleLoadPayload`                     | **Planned** (runtime D5)       |

This plan binds lowering to the two **planned** names and signatures exactly.
If the runtime slice renames them, update §4 and §7 together.

## 3. Spec and Node facts for lowering

From ECMA-262 §13.3.10.2 EvaluateImportCall (fetched for the runtime plan) and
`p/d2/main.mjs`:

1. The specifier expression and GetValue run first, then the options
   expression. An abrupt completion from either is a **synchronous throw**, and
   the options are not evaluated after a specifier throw. Node: `sync S opts?0`,
   `sync O`, and a ReferenceError from an unresolvable specifier is synchronous.
2. The promise capability is created only after both operands. Every later
   failure (ToString, Get `with`, attribute checks) **rejects**. Node:
   ToString throw `rejected TS`, and non-object options reject with a TypeError.
3. The observed order is specifier expression, options expression, ToString,
   Get `with`, then the call returns.
4. The specifier value is fixed before the options run. Node:
   `import(spec, (spec = …))` uses the old value.
5. Nested function, arrow and generator referrers are the **defining** module,
   and `import.meta` inside a function is the defining module's object
   (`d1` versus `d2` probe).
6. Positions. Optional chains short-circuit before the call (ToString count
   0), and `import(x)?.then` is a chain base. `new (import(x))`, `import(x)()`
   and a tagged template all throw a synchronous TypeError **after** the import
   has started (ToString ran once). `import(yield)` and `await import(await x)`
   work across resumptions. `new import(x)` is a parse error
   (`parser.ts:2035-2040`).

## 4. Decisions

**L1. Operands use the existing path, with no new wrapper.** Lower
`s = temporary(value(node.specifier), true)` and then, only when present,
`o = temporary(value(node.options), true)`. Otherwise `o` is the identifier
`undefined`. Pinning both satisfies facts 1 and 4. Operand throws stay
synchronous because they are ordinary lowered effects inside the current entry
or function.

**L2. The call has no completion wrapper.** `evaluateImportCall` returns
`OrdinaryObject` and turns every post-operand failure into a rejection
internally. The only things that escape synchronously are host faults (string
invariants) and `rejectUnsupportedExecution`. Both are handled by the existing
`try`/`finish` and the sticky flag. Adding `check` would need an `{error,value}`
result, which the runtime contract does not have. The emitted statement is
`const $valueK: unknown = evaluateImportCall($valueI, $valueJ, $global.hooks, $errors);`.
The result is pinned with `temporary(…, true)`, because the call starts host
loading and its position must not move past later operands. The span is the
`import-call` node, the operand temporaries keep the operand spans, and there
are no type arguments (`scriptRuntimeTypeArguments` default `[]`).

**L3. Runtime catch discipline (runtime handoff note).** `evaluateImportCall`
must wrap **only** the user-observable steps (ToString, Get `with`, `ownKeys`,
`getOwnProperty`, `getProperty`) in `try`. A caught value rejects, unless
`realm.unsupported` is set, in which case it is rethrown. The loader call,
`canonicalModuleRequest` and capability creation stay outside the `try`, so
`MODULE_*` invariants remain host faults. This matches runtime plan §4, and it
is why L2 needs no wrapper.

**L4. `import.meta` lowers to a pinned call.** Emit
`const $valueK: unknown = getActiveImportMeta($errors);`. Only the module goal
parses `import.meta`. Any other entry reaching this arm throws
`"IMPORT_META_GOAL_INVARIANT"`, a host fault and not a user error. There is no
`$module` parameter (runtime D4/D9).

**L5. Check order: phase, then entry.**

1. `phase === "defer"` fails with `import.defer requires P-DEFER`.
2. `phase === "source"` fails with `import.source requires P-SOURCE`.
3. The `indirect-eval`, `direct-eval` and `dynamic-function` entries fail with
   `dynamic import in eval code requires the managed modules surface`.

Every failure uses `fail(node, …)` on the `import-call` span and runs before the
operands are lowered. Checking the phase first gives proposal rows the same
reason in every entry. The old `HOST-ESM M3` messages and the `import-call`
fall-through are deleted.

**L6. Usage flags only.** Two new locals are set inside the arms after the
operands lower: `usesImportCall` and `usesImportMeta`. Nothing else in the
entry changes, so import-free programs lower byte-identically (§1 hashes).

**L7. The `scriptRuntimeImports` signature appends two positional flags.** The
six existing parameters keep their order and defaults, and
`usesImportCall: boolean = false, usesImportMeta: boolean = false` follow
`usesAnnexAdmissions`.

- **`module`.** `moduleRuntimeImport(generated, usesImportCall, usesImportMeta)`
  appends `evaluateImportCall`, then `getActiveImportMeta`, after the existing
  four. Both are values (not `typeOnly`).
- **`script`.** When `usesImportCall` is set, push one more declaration,
  `{specifier:"@tint/js-runtime/modules", bindings:[evaluateImportCall]}`, with
  the `generated` span, **after** the records declaration.
- **Any other combination** throws `"SCRIPT_IMPORT_INVARIANT"`. That means
  `usesImportCall` with `indirect-eval`, `direct-eval`, `function` or `all`, and
  `usesImportMeta` with anything but `module`.
- **`scriptRuntimeSurface()`** keeps its call unchanged. It stays at 128 entries
  with no modules entry, and the managed JIT vocabulary is untouched.

Positional flags match every existing caller. An options object would rewrite
them all, including the surface call.

**L8. Runtime `$262.evalScript` with `import()` is explicitly unsupported.**
That Script lowers (L5 allows `script`), but its modules import fails the
managed specifier check. The evaluator then raises sticky unsupported. This
path is reached by test262 only at runtime. M3b decides whether to widen the
surface. M3a does not.

**L9. No generator or continuation special cases.** The import call contains
no suspension marker. `await import(x)` and `yield import(x)` lower the call
into a pinned `const`, then suspend on it. `generatorContinuation` already
keeps a preceding segment's `const` through closure conversion. `import(yield)`
and `import(await x)` suspend while lowering the operand, before the call.

**L10. Source retention is unchanged.** `retainFunctionSource` keeps the
original text, and the new import declaration uses `generated` like its
siblings.

## 5. Exact arm text (in `value()`, before `default`)

```ts
case "import-call": {
  if (node.phase === "defer") return fail(node, "import.defer requires P-DEFER");
  if (node.phase === "source") return fail(node, "import.source requires P-SOURCE");
  if (entryKind !== "script" && entryKind !== "module")
    return fail(node, "dynamic import in eval code requires the managed modules surface");
  const specifier = temporary(value(node.specifier), true);
  const options = node.options === undefined
    ? id("undefined", node)
    : temporary(value(node.options), true);
  usesImportCall = true;
  return temporary(runtimeCall("evaluateImportCall",
    [specifier, options, member(id("$global"), "hooks", node), id("$errors")], node), true);
}
case "import-meta": {
  if (entryKind !== "module") throw "IMPORT_META_GOAL_INVARIANT";
  usesImportMeta = true;
  return temporary(runtimeCall("getActiveImportMeta", [id("$errors")], node), true);
}
```

The `default` arm becomes
`fail(node, "Script expression lowering is not implemented: " + node.kind)`.
The `scriptRuntimeImports` call at `index.ts:4823` passes
`usesImportCall, usesImportMeta` after the annex flag.

## 6. Position coverage (no extra code; each needs a test)

| Position                                                             | Path                                                         | Test   |
| -------------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| Statement or expression, nested function, arrow, method, class field | `value()` from any body                                      | T3, T9 |
| Optional chain argument `a?.[import(x)]`, `a?.f(import(x))`          | Emitted inside the guard's `if` block                        | T5     |
| Chain base `import(x)?.p()`, `import.meta?.()`                       | `callTarget` default (receiver `undefined`)                  | T5, G8 |
| `new (import(x))`, `import(x)()`, tag                                | Callee pinned first, then a TypeError from construct or call | T6     |
| `await import(await x)`, `yield import(yield)`                       | L9                                                           | T7     |
| Specifier `import(import.meta)`                                      | Inner meta call pinned before the import call                | T4     |
| Spans                                                                | Node span on the call and on failures                        | T2, T8 |

## 7. Red-first tests (write each, watch it fail, then implement)

**`packages/js-engine/test/module-lowering.test.ts` (edit).** Delete the two
rows at lines 84–85 from the unsupported table. In their place add
`['import.defer("./x");', "import.defer requires P-DEFER"]` and
`['import.source("./x");', "import.source requires P-SOURCE"]`.

**`packages/js-engine/test/import-call-lowering.test.ts` (new),** reusing the
helpers of `module-lowering.test.ts` and the neighbouring eval tests.

- **T1. Script and module both lower `import(s, o)`.** The test finds the
  `const` initialized by `evaluateImportCall`. Its arguments are
  `[$valueI, $valueJ, $global.hooks, $errors]`, and `I`'s declaration comes
  before `J`'s. `import(s)` passes the identifier `undefined` second, and
  `calls()` counts exactly one `evaluateImportCall`.
- **T2. Imports equal the vocabulary.** A module's `imports` deep-equal
  `scriptRuntimeImports(span,false,false,false,"module",false,true,false)`. A
  Script's equal `(…,"script",false,true,false)`, its fourth declaration is
  exactly the modules `evaluateImportCall` binding, and its span is the program
  start.
- **T3. Identity is never threaded.** Lowering
  `export function f(){return import("x");} export const g=()=>import.meta;`
  emits no identifier `$module`. Its `getActiveImportMeta` call has exactly
  `[$errors]` as arguments.
- **T4. `import(import.meta)`.** `getActiveImportMeta`'s `const` precedes
  `evaluateImportCall`'s, and the imports equal
  `(…,"module",false,true,true)`.
- **T5. Optional chains.** In `a?.[import("x")]`, the `evaluateImportCall`
  `const` sits in the consequent of an `if` statement, not in the top-level
  execute block. `import("x")?.p()` and `import.meta?.()` lower.
- **T6–T7. Callee positions and continuations.** In `new (import("x"))(1)` and
  `import("x")()`, the call's `const` precedes `constructObjectValue` or
  `callObjectValue`. `async function g(){return await import(await x);}` and
  `function* h(){yield import(yield);}` lower with one call each, as Script and
  as module.
- **T8. D10 and D11 messages.** For `import("x");` the message is L5's eval
  message. `indirect-eval` and `direct-eval` give span `[0,11]`, and
  `dynamic-function` gives `[25,36]`. `import.defer("x")` gives `[0,17]` and
  `import.source("x")` gives `[0,18]` in all five entries, with the phase
  message. The `dynamic-function` spans are shifted by 25 (`[25,42]` and
  `[25,43]`).
- **T9. Class bodies.**
  `class C { f = import.meta; static { import("x"); } m(){ return import("x"); } }`
  lowers as a module.

**`packages/js-engine/test/runtime-imports.test.ts` (extend).**

- **T10. Vocabulary pins.** The §1 counts hold with the new flags false. The
  surface has 128 entries and 0 modules entries.
- **T11. New flags.** `module` with `usesImportCall` adds 1 and with
  `usesImportMeta` adds 1. `script` with `usesImportCall` adds 1 binding in one
  new declaration.
- **T12. Invariants.** Every L7 invalid combination throws
  `SCRIPT_IMPORT_INVARIANT`.
- **T13. Import-free programs.** For the §1 corpus, each program's `imports`
  deep-equal the six-argument call (`usesImportCall`/`usesImportMeta` omitted).

**`packages/js-engine/test/script-compile.test.ts` or `runtime-surface.test.ts`.**

- **T14. Managed surface rejects the modules import.** The program
  `import("x")` lowered as `script` imports a specifier outside the
  `scriptRuntimeSurface()` set, and `normalizeManagedSurfaceApplications`
  rejects it with
  `profile: managed surface requires named imports from approved specifiers`.

**`tools` (with the runtime plan's tests 24–26).**

- **T15. Old snapshots unchanged.** For a snapshot without `evaluateImportCall`
  (the frozen `node-toolchain-module-fixture-syntax-v1`, or the live snapshot
  with the export filtered out, as in `test262-module-host.test.ts:10-24`), the
  generated host text, loader signature, retained exports and record bindings
  are byte-identical to today's. Capturing only some of `evaluateImportCall`,
  `getActiveImportMeta`, `viewModuleRecord` and `viewScriptRecord` throws
  `incomplete captured dynamic import contract`.
- **T16. Script route.** A Script whose lowered `imports` include
  `@tint/js-runtime/modules` prepares as
  `unsupported(<file>: Script dynamic import requires HOST-ESM M3b)`, and the
  check runs before compile, at `test262-native.ts:247-249`. A module case
  under the dynamic capability prepares.

T1–T14 can land before the runtime exports exist. T15–T16 need runtime plan §4.

## 8. Edit list (in order)

1. `js-engine/src/lowering/runtime-imports.ts`: add L7 (two parameters, the
   `moduleRuntimeImport` flags, the Script modules declaration and the
   invariants). Clean up while there: lift the repeated `typeOnly` name list
   into a small `Set` beside its declaration.
2. `js-engine/src/lowering/index.ts`: add the two flags next to
   `usesDirectEval`, add the §5 arms, simplify `default`, and pass the flags at
   line 4823.
3. `js-runtime/src/modules/import-meta.ts` and `dynamic-import.ts`: add
   `getActiveImportMeta` and `evaluateImportCall` per runtime plan §4 and L3,
   exported from `modules/index.ts`. This is the runtime slice, listed here only
   for ordering.
4. `tools/test262-native.ts`: `nativeDynamicImportCapability`, the widened
   loader text only under that capability, retained views and
   `operation:"view"` bindings following `directEvalSiteImageContract`, and the
   T16 Script check. The
   [M3a host contract plan](host-esm-dynamic-import-host-contract.md) settles
   the details.
5. `tools/verify-hosted-module-dynamic-import.ts` (new, §9).
6. Regenerate the compiler catalog only if the new runtime files require it
   (`node tools/generate-compiler-catalog.ts`, then format). There are no
   manifest or dependency changes, because `@tint/js-runtime/modules` is already
   a dependency of every lowered module.

## 9. Native gate G8: lowered `import()` in the current module host

`tools/verify-hosted-module-dynamic-import.ts` follows
`verify-hosted-module-lowering.ts`: the same four generated dependency mappings,
plus the `referrer` views namespace and `view` bindings from
`verify-hosted-dynamic-import.ts`. Its loader closes over a specifier table with
the widened payload, and jobs drain with `drainScriptJobs(realm.agent, …)`.

**Generated modules:**

- `root`:
  `export const meta=import.meta;export function f(){return import.meta;}export let seen;export const p=import("./dep");p.then(ns=>{seen=ns;});export const q=(()=>import("./dep"))();export function g(){return import("./root");}`
- `dep`: `export const value=42;`
- `chain`:
  `export let t1,t2;try{void (import.meta?.());}catch(e){t1=e;}try{void (import("./dep")?.p());}catch(e){t2=e;}`
- `opt`: `export let n=null,k=0;n?.[import({toString(){k++;return "./dep";}})];`

**Exit codes:**

| Exit  | Meaning                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------- |
| 60/61 | `root` load, link and evaluate settle synchronously                                                  |
| 62    | `meta === f()` and has a null prototype                                                              |
| 63    | `p !== q`, and both are pending before the drain                                                     |
| 64    | After the drain, `seen === getModuleNamespace(dep)`                                                  |
| 65    | Calling `g()` resolves to root's namespace, and root's body ran once                                 |
| 66    | `t1` and `t2` are synchronous TypeErrors from the module's realm                                     |
| 67    | `k === 0`, so the optional chain short-circuited                                                     |
| 68    | The loader saw the root ModuleRecord as referrer for all three, and never a Script or realm referrer |
| 42    | Pass                                                                                                 |

Build with `TINT_BUILD_ONLY=1` and run under LLDB. Assert stop-at-entry and
exit 42, and record the build manifest. It runs after G1–G6 in the module host
that N1, N2 and M2c already use. A Script lowered with `import()` gets **no**
native gate in M3a (M3b).

## 10. Measurements and census expectations

1. **Byte identity.** Re-run `baseline.mts` and `probe.mts`. Every §1 hash and
   count must match, and no difference is re-pinned silently.
2. **Re-census under the M3a toolchain (Node only).**
   - The 24 module variants prepare.
   - Module proposal variants move from `dynamic import requires HOST-ESM M3` to
     the L5 phase messages.
   - In the 1,143 Script `import-call` rows, variants containing an
     `import.defer` or `import.source` call (class 05) move to the L5 phase
     messages, not to the §9 Script reason. This corrects runtime plan §10.4's
     wording. The class membership is unchanged.
   - The remaining Script variants move to the M3b Script reason (T16).
   - Class 03 (`usage-from-eval`) still prepares and becomes runtime-unsupported
     through L5.
   - Report the exact split. Any other movement blocks the native runs.
3. **Layouts.** Lowering adds no record or frame fields. Layout digests may move
   only through the runtime plan §10.3 records.

## 11. Tested versus unverified

**Tested (Node only, non-native).** §3 facts 1–6. The §1 baselines and current
failure messages for all five entries. `import.meta` parse errors outside the
module goal. The source lowerer matches the frozen fixture-syntax snapshot.
`$262.evalScript` uses the `script` entry, and the managed specifier check
rejects other specifiers (read from source, not executed).

**Unverified until native.** G1 (the views bind exactly). `evaluateImportCall`
and `getActiveImportMeta` do not exist yet. Whether a pinned `unknown` `const`
holding an `OrdinaryObject` costs anything beyond today's
`temporary(…, true)`. That closure conversion keeps the call's `const` across
`await` and `yield` in native continuations (L9 is by analogy with existing
pinned helpers). The G8 error realms. Whether old-snapshot host text is truly
byte-identical (T15).

## 12. Next runnable test

After G1 is green and main's `pnpm check` finishes, write T8 first:

```sh
node --test packages/js-engine/test/import-call-lowering.test.ts
```

It must fail on the old messages. Then implement §8 items 1–2 and run T1–T14
with `node --test` on the changed `js-engine/test` files, after `pnpm build` if
framework source changed. Before any freeze, run §8 item 3, T15–T16 and G8.
