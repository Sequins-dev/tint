# RT-EVAL S5-de DE4: direct-eval evaluator service and intrinsic/host routing

Implementation status: service, intrinsic routing and captured Test262 host wiring
pass all 4,102 workspace checks/tests. The measured directory has 182 records,
165 signature classes and 41 runtime providers. Both
[managed native proofs](../results/native-direct-eval-service-validation-v1.json)
passed. The [native host verifier](../results/native-test262-direct-eval-validation-v1.json)
completed all 14 supported cases and correctly rejected four class-context cases.
The [frozen self-build](../results/direct-eval-host-selfhost-checkpoint-v1.json)
passed with byte-identical stage images, valid signing and verified DWARF. Unchanged
targeted Test262 selections are running. No complete-family conformance gain is claimed yet.

Research status: **plan only.** Parent: [direct environments](rt-eval-direct-environments.md)
§7 DE4. It refines DE4 against the code that has since landed:

- the carrier ([site carrier](rt-eval-direct-site-carrier.md), H5);
- the context entries ([context parsing](rt-eval-context-parsing.md));
- `lowerDirectEvalScript`, which passes its
  [native entry fixture](../results/native-direct-eval-entry-v2.json). Its
  [checkpoint](../results/direct-eval-entry-checkpoint-v1.json) records 4,083 workspace tests.

Where this plan and the parent's §6.5 disagree, this plan wins. The parent's text predates the
H5 carrier and the flag word.

**Capture.** 2026-11-05, live source. The surface has 126 entries: 104 helpers and 22 types,
with 40 instantiated. It has 182 record classes, 164 signature classes and 41 runtime
providers. No queue, survey or native process was touched. Survey v10 stopped safely, with its
828 observations preserved, and no native queue is running.

**Method.** Live source plus two read-only Node probes in `/tmp/tint-de4-plan`, importing
workspace `dist` (mtime 2026-11-04T21:33Z, older than `lowering/index.ts`; the probed flag,
strictness and parse facts do not depend on the later receiver fix). Nothing was emitted, no
native process or agent ran, and only this file and one cross-link changed.

**Out of scope, by user direction:** compiler reuse and caching, compile performance, and any
complete-suite survey.

## 1. Answer in brief

1. **The service is about 30 lines over existing primitives.**
   `createDirectEvaluator(context, host)` returns a `DirectEvalCompiler`. It reuses
   `createEntryRunner` and calls `run(lowered, site, false)`. With `inheritActive = false` the
   runner stores the **site itself** as the carrier's `hostDefined`. The lowered entry views it
   before its `try` and pushes `site.scriptOrModule`. It adds no frame, scheduler, cache or
   view consumer.
2. **Routing is one realm slot plus a write-once installer.** `ErrorRealm.directEvalCompiler`
   sits beside `evalCompiler`. `installDirectEvalCompiler` follows the `installEvalCompiler`
   pattern. Only `callEvalCandidate`'s string branch changes, and it already receives
   `flags` and `site`.
3. **Capabilities are rejected before parsing.** A flag word with any bit other than
   strict (1) or in-function (2) is sticky unsupported. Bit 16 is set at every
   class/private/super site, and bits 4 and 8 never occur without it, so no SyntaxError for
   `super` or `#x` is ever invented. Non-method `super` and `new.target` outside functions
   stay **real** early errors.
4. **Sequencing.** DE4a (service and routing, Node tests), then DE4b (native proofs: AOT
   caller → managed entry, managed caller → managed entry), and only then DE4c (Test262 host
   wiring behind a capture gate, new adapter label). The deferred frozen self-build runs once,
   after DE4c.

## 2. Current source [src]

| Piece                 | Location                                                                                | Fact                                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guard                 | `js-runtime/src/objects/global-properties.ts:64-79`                                     | `callEvalCandidate(callee, receiver, list, witness, realm, flags: number, site: unknown)`. Its string branch is `return rejectUnsupportedExecution(realm)`                                                                                                               |
| Realm slots           | `objects/errors.ts:62,73-74,325-326`                                                    | `EvalCompiler = (source: string) => unknown`; `evalFunction` and `evalCompiler` are initialized to `undefined`                                                                                                                                                           |
| Installer precedent   | `global-properties.ts:51-58`                                                            | `installEvalCompiler` throws `"EVAL_COMPILER_INVARIANT"` unless the intrinsic exists and the slot is empty                                                                                                                                                               |
| Flags                 | `js-engine/src/lowering/direct-eval-flags.ts`                                           | strict 1, inFunction 2, inMethod 4, inDerived 8, unsupportedCapability 16. Bit values are stable across snapshots                                                                                                                                                        |
| Caller site           | `lowering/index.ts:694-772`                                                             | `unsupported = home ∨ derivedContext ∨ privateScopes`. Such a site gets `undefined` plus bit 16, so bits 4 and 8 imply bit 16. Otherwise it gets `DirectEvalSite {scriptOrModule, lexical, variables, catches, thisValue, newTarget}`                                    |
| Eval entry            | `lowering/index.ts:137-144, 4667-4705`                                                  | `lowerDirectEvalScript(script, sourceText, flags, EvalBindingContext)` binds through `bindEvalScript`, views `$script.hostDefined` **before** `runScriptContext`, and returns the `"unsupported"` completion on a mismatch                                               |
| Entry state           | `lowering/index.ts:176-205`                                                             | `variableScope` is `$site.variables` when sloppy and `$scope` when strict; it uses `$site.catches`, `$site.thisValue` and `$site.newTarget`; `inFunction` comes from bit 2                                                                                               |
| Runner                | `js-engine/src/script-evaluation.ts:118-170`                                            | `run(lowered, identity, inheritActive)`: compile, domain check, `createScriptRecord(realm, inheritActive ? active.scriptOrModule : identity)`, invoke, context-leak check, completion view                                                                               |
| Indirect mapping      | `script-evaluation.ts:174-209`                                                          | The parse error codes `SYNTAX_ERROR`/`LEXICAL_ERROR` and the lowering code `EARLY_ERROR` become a realm SyntaxError; others are unsupported. Completion `none` returns the value, `throw` rethrows, `unsupported` is sticky, anything else is `fault("completion-kind")` |
| Parser and binder     | `typescript/src/syntax/parser.ts:144-160`, `binding/index.ts:167-176`                   | `parseEvalScript(view, {strict, newTarget, superProperty, superCall})` and `bindEvalScript(script, {privateNames, fieldInitializer})`                                                                                                                                    |
| Host capability       | `tools/test262-native.ts:793,865-868,1099-1122`                                         | `directEvalSiteView` is detected from the snapshot. `directEvalSiteImageContract(enabled)` retains `viewDirectEvalSite` and binds it as a record **view**                                                                                                                |
| Host wiring           | `tools/test262-native.ts:454, 899-947`                                                  | One `service: ScriptEvaluationHost` per realm build feeds `createScriptEvaluator`, `installEvalCompiler(createIndirectEvaluator)` and the function fallback. The adapter labels are v6, v7 and v8                                                                        |
| Managed fixture       | `tools/verify-hosted-managed-script.ts`                                                 | Selected cases 1-6. Case 5 (`verifyIndirect`, `:146`) asserts that `callEvalCandidate(…,"1",…,0,undefined)` is sticky. Its runtimes do **not** retain `viewDirectEvalSite`                                                                                               |
| AOT entry fixture     | `tools/verify-hosted-direct-eval-entry.ts`                                              | Lowered entries are AOT-linked and called directly with `createScriptRecord(realm, site)`. Exits 60-67; 42 is a pass                                                                                                                                                     |
| Sticky host verifiers | `tools/verify-test262-native-eval-{guard,site}.ts`, `…-indirect-eval.ts`                | The expectations `index >= 6`, `>= 12` and `>= 14` are "unsupported". Some of those cases are plain direct string eval                                                                                                                                                   |
| Census pins           | `js-engine/test/runtime-surface.test.ts:54`, `tools/script-runtime-surface.test.ts:376` | 126 entries; 41 providers, 43 operation ABIs, 355 operations                                                                                                                                                                                                             |

**Probe [node, read-only, `/tmp/tint-de4-plan/probe*.mjs`].**

- **Strictness.** `strict: true` yields `script.strict === true`, so lowering takes the fresh
  strict var scope; a sloppy caller's `'use strict'` directive does too.
- **Early errors.** SyntaxErrors: `new.target` without bit 2 (it parses with it); `super.x`
  and `super()` under flags 2; `with` and `"\08"` under strict 1; `return 1`. Lowering
  `EARLY_ERROR`: `#x in o` ("undeclared private name") and `let a;let a`.
- **Empty bodies.** `""` and `/*c*/` parse to zero statements.
- **Nested candidates** receive static flags: 2, 3 and 0 at top level, 2 inside an arrow, and
  **2 inside a nested sloppy function even when the eval was flags 0**. The site argument is
  always a temporary, never `undefined`.

## 3. Contracts (proposed; nothing below exists yet)

### 3.1 `js-runtime/src/objects/errors.ts`

```ts
/** Embedding-owned direct PerformEval. `flags` is the lowering's static
 * caller word; `site` is opaque here and is viewed only by the lowered entry. */
export type DirectEvalCompiler = (
  source: string,
  flags: number,
  site: unknown,
) => unknown;
// ErrorRealm, beside evalCompiler:
directEvalCompiler: DirectEvalCompiler | undefined; // createErrorRealm: undefined
```

`objects` gains no import. `DynamicFunctionCompiler` is the precedent for an `unknown`
callback parameter. The existing stale doc block above `EvalCompiler` (`errors.ts:56-61`)
actually describes `DynamicFunctionCompiler`. Move it there; this is continuous cleanup.

### 3.2 `js-runtime/src/objects/global-properties.ts`

```ts
/** Install this realm's direct-eval service once, after its indirect service. */
export function installDirectEvalCompiler(
  realm: ErrorRealm,
  compiler: DirectEvalCompiler,
): void {
  if (
    realm.evalFunction === undefined ||
    realm.evalCompiler === undefined ||
    realm.directEvalCompiler !== undefined
  )
    throw "DIRECT_EVAL_COMPILER_INVARIANT";
  realm.directEvalCompiler = compiler;
}
```

**Requiring `evalCompiler` first** makes direct-without-indirect wiring impossible.
`callEvalCandidate` keeps its exact signature; only the string branch's last line changes:

```ts
const compiler = realm.directEvalCompiler;
if (compiler === undefined) return rejectUnsupportedExecution(realm);
return { error: "none", value: compiler(source, flags, site) };
```

- **Abrupt completions.** A SyntaxError or user throw from the compiler escapes as a native
  throw from the helper, which is the same path as `rejectUnsupportedExecution` and the
  intrinsic. The caller's `check(result.error)` is untouched.
- **Ordering.** The callee, every argument and the SameValue test happen before the
  compiler runs. This is already pinned by G1-G3.
- **Exports.** `objects/index.ts` exports `installDirectEvalCompiler` and
  `type DirectEvalCompiler`.
- **Doc comment.** Replace "Flags and site remain opaque until direct string execution is
  enabled" with the routing contract.

### 3.3 `js-engine/src/script-evaluation.ts`

```ts
export function createDirectEvaluator(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): DirectEvalCompiler {
  const realm = context.realm,
    runner = createEntryRunner(context, host);
  return (source: string, flags: number, site: unknown): unknown => {
    if (
      realm.unsupported ||
      site === undefined ||
      (flags & ~directEvalSupported) !== 0
    )
      return rejectUnsupportedExecution(realm);
    runner.ensureDomain();
    const parsed = parseEvalScript(createSourceTextView(source), {
      strict: (flags & directEvalStrict) !== 0,
      newTarget: (flags & directEvalInFunction) !== 0,
      superProperty: false,
      superCall: false,
    });
    if (!parsed.ok) return rejectSource(realm, parsed.error.code);
    if (parsed.value.statements.length === 0) return undefined;
    const lowered = lowerDirectEvalScript(parsed.value, source, flags, {
      privateNames: [],
      fieldInitializer: false,
    });
    if (!lowered.ok) return rejectLowering(realm, lowered.error.code);
    return completeEntry(realm, runner, runner.run(lowered.value, site, false));
  };
}
```

- **`directEvalSupported`** is a module constant equal to `directEvalStrict |
directEvalInFunction`, imported from `./lowering/index.ts`, which already re-exports the
  flags. Bits 4, 8 and 16, and any unknown bit, are rejected sticky **before** parsing. That
  rejection is DE5's boundary.
- **`site === undefined`** cannot occur with clean flags; the check is defensive. The service
  **does not view the site**, so the lowered entry stays the view's single consumer; a
  non-site `hostDefined` yields the entry's `"unsupported"` completion (sticky).
- **Raw UTF-16.** `createSourceTextView(source)` takes the string as is, as the indirect path
  does, so lone surrogates survive.
- **Shared helpers (behavior-preserving extraction from `createEntryEvaluator`, which then
  uses them):** `rejectSource(realm, code)` (SyntaxError for `SYNTAX_ERROR`/`LEXICAL_ERROR`,
  else sticky), `rejectLowering(realm, code)` (SyntaxError for `EARLY_ERROR`, else sticky) and
  `completeEntry(realm, runner, done)` (`none` → value, `throw` → same identity, `unsupported`
  → sticky, else `runner.fault("completion-kind")`). No other refactor belongs to this slice.
- **Identity.** `run(…, site, false)` makes a fresh carrier `createScriptRecord(realm, site)`;
  the entry pushes `$site.scriptOrModule`, which the caller chose via `scriptIdentity()`
  (`$script` in a Script, `$script.hostDefined` in indirect eval and function bodies,
  `$site.scriptOrModule` in nested direct eval). **`inheritActive` must be `false`:** `true`
  would overwrite `hostDefined` with the active `scriptOrModule`, making every call sticky.
- **Realm.** The service is per realm. `callEvalCandidate` reaches it only when the callee
  is SameValue to **that** realm's `%eval%`, through `$errors`, the running realm. So
  `evalRealm` is the caller's realm, and `context.global` is the caller's global. A foreign
  realm's `eval` called by name stays an ordinary call, which is indirect eval in that realm.
- **Empty body** returns `undefined` without compiling, matching indirect eval; a
  directive-only body compiles and completes with the directive string. Lowering errors
  other than `EARLY_ERROR` stay sticky, never late SyntaxErrors.

### 3.4 Caller-state invariants already in place (pin, do not re-implement)

Fresh eval lexical record over `site.lexical`; var target `site.variables` (sloppy) or the
entry's own `$scope` (strict); Catch exemption via `site.catches` (inherited in sloppy nested
eval, reset in nested functions); `this` = `site.thisValue`, the **enclosing** receiver,
distinct from `callReceiver`; `new.target` = `site.newTarget`; declarations through
`instantiateDirectEvalDeclarations($scope, variableScope, $site.catches, plan, strict)`.

## 4. Edit list

**DE4a: service and routing (Node only).** One commit.

1. `js-runtime/src/objects/errors.ts`: add `DirectEvalCompiler`, the slot and its
   initializer, and move the stale comment.
2. `js-runtime/src/objects/global-properties.ts`: add `installDirectEvalCompiler`, change the
   string branch and update the doc comment.
3. `js-runtime/src/objects/index.ts`: add the two exports.
4. `js-engine/src/script-evaluation.ts`: add `createDirectEvaluator`, extract the three
   helpers and import `parseEvalScript`, `lowerDirectEvalScript` and the flags.
5. **Census.** Run `pnpm build`, then re-measure the record, signature and provider facts in
   `tools/script-runtime-surface.test.ts` and `js-engine/test/runtime-surface.test.ts`.
   - The vocabulary should stay at **126 entries** (104 helpers, 22 types, 40 instantiated),
     because no helper is added.
   - `ErrorRealm` changes layout, and a new callback ABI may add a signature class. **Do not
     predict 182/164/41; measure, then re-pin with the measured values**, and record them in
     the checkpoint.
   - The eight lowering corpus hashes must stay **unchanged**, because no lowered text
     changes.
6. `packages/js-runtime/test/ordinary-object-global-properties.test.ts:151`: the test "direct
   string eval rejects before invoking the intrinsic" becomes "…when no direct compiler is
   installed". Its assertion stays sticky.
7. The `tools/verify-hosted-managed-script.ts:146` expectation stays valid, because that case
   installs no direct compiler.

**DE4b: native proofs (tools only).** One commit with its reports.

8. `tools/verify-hosted-managed-script.ts`:
   - add selected case **7**, `verifyDirect` (§6.2);
   - add the `global-environment` runtime retaining `viewDirectEvalSite`, and its `view` record
     binding;
   - reuse `directEvalSiteImageContract(true)` from `test262-native.ts` so the fixture cannot
     drift from the image contract;
   - import `createDirectEvaluator`, `installDirectEvalCompiler` and `type DirectEvalSite`.
9. `tools/verify-hosted-direct-eval-entry.ts`: unchanged. It remains the AOT-entry baseline.

**DE4c: host routing (after DE4b passes natively).** One commit.

10. `tools/test262-native.ts`:
    - `NativeScriptEvaluation` gains `directEval?: true`, set by `capturedScriptEvaluation`
      when the provider exports `createDirectEvaluator`. It then requires
      `installDirectEvalCompiler` in `objects`, `indirectEval` and the `directEvalSiteView`
      capability, else throws `"incomplete captured direct-eval contract"` (`:936-942`).
    - `nativeScriptAdapter` returns `"native-script-v9-direct-eval"` first when set.
    - The generated host conditionally imports both names and, right after
      `installEvalCompiler(…)` (`:454`), emits
      `installDirectEvalCompiler(realm,createDirectEvaluator({realm,global},service))`. The
      **same** `service` shares compiler, arena, budget and fault sink; realm construction
      (including `$262.createRealm`) runs this per realm.
    - Assert that `directEval` implies `directEvalSiteImageContract(true)`.
11. `tools/test262-script-service.test.ts`: add the capture-gate tests (§7.1).
12. Host verifiers: replace the `index >= N` predicates with an explicit per-case
    expectation table (§7.2). Do **not** edit existing reports.

## 5. Red-first Node tests (DE4a)

Write each test first, run it, and see it fail. The failure must be a missing export or the
still-sticky branch, not a typo. Then implement.

**`js-runtime/test/ordinary-object-global-properties.test.ts`**

- R1. `installDirectEvalCompiler` throws `"DIRECT_EVAL_COMPILER_INVARIANT"` before
  `installEvalIntrinsic`, before `installEvalCompiler`, and on a second install; the slot is
  unchanged after each throw.
- R2. With a spy compiler installed, `callEvalCandidate(intrinsic, recv, ["s"], g, realm, 3,
site)` calls it **once** with `("s", 3, site)`. The site arrives by reference identity, and
  the receiver is never passed. The result is `{error: "none", value}` with the spy's value.
- R3. Non-string and empty argument lists, a shadowed callee and another realm's `eval` never
  call the spy, and `realm.unsupported` stays false.
- R4. A spy that throws value `X` propagates `X` by identity, as a native throw rather than
  an `{error}` record. A spy that calls `rejectUnsupportedExecution` leaves the realm sticky.
- R5. Without an installed compiler, the existing sticky test still holds (renamed per edit 6).

**`js-engine/test/script-evaluation.test.ts`.** Extend `fixture()` with a `"direct-eval"`
kind that returns `createDirectEvaluator`; reuse the fake host.

- S1. **Carrier.** `evaluate("1", 2, site)` compiles once; `frames[0].$argument1.hostDefined
=== site` and `.realm === realm`. Under an outer active context with `scriptOrModule` `Q`,
  `hostDefined` is still `site` (`inheritActive = false`).
- S2. **Flags.** In `modules[0]`, flags 3 gives `script.strict` and var target `$scope`, flags
  2 gives `$site.variables`. Flags 0 rejects `new.target` with a realm SyntaxError and **no
  compile**; flags 2 accepts it.
- S3. **Capabilities.** Flags 16, 20, 24, 4, 8 and 32 are each sticky unsupported with **no
  parse and no compile**. This holds even for sources such as `super.x`, which would
  otherwise be a SyntaxError. `site === undefined` with flags 2 is also sticky.
- S4. **Early errors.** `super.x` and `super()` (flags 2), `with(o){}` (flags 1), `return 1`,
  `#x in o` and `let a;let a` each give a SyntaxError from **this** realm, with zero compiles
  and no sticky flag.
- S5. **Empty bodies.** `""` and `" /*c*/ "` return `undefined` without compiling. The
  `"'use strict'"` directive compiles.
- S6. **Completion mapping**, matching the indirect tests: thrown identity rethrown;
  `unsupported` sticky; bad kind → `completion-kind`; invoke throw → `invoke-threw`; leak →
  `context-leak`; every compile-failure stage unsupported before invoke.
- S7. **Domain and parser limits.** A changed domain rejects before parsing. Parser `LIMIT`
  is unsupported, not a SyntaxError.
- S8. **Source text.** A lone surrogate inside a string literal survives into the lowered
  template value. Mirror the indirect test at `:514`.
- S9. **Cross-realm services.** Services in realms A and B are independent, and a SyntaxError
  in B is B's. Neither realm becomes sticky because of the other.
- S10. **Shared helpers.** Every existing Script and indirect test passes unchanged.

**`js-engine/test/eval-guard.test.ts`**

- G1. The lowered guard call is unchanged in arity and argument order. The
  "indirect-only lowering remains byte-identical" corpus still matches.

**Gate.** Run `pnpm build`, then `node --test` on the three files, then `pnpm check`. Inspect
every exit status. Record a `direct-eval-service-checkpoint-v1.json` (Node, `conformance:
false`) with the measured census.

## 6. Native fixtures

### 6.1 Remaining unknowns that DE4b must settle

- **N-a. AOT caller to managed entry.** The AOT entry fixture links the entry ahead of time
  and passes a hand-built carrier. Nothing has yet run a site through `callEvalCandidate`'s
  `site: unknown`, the realm-slot closure call, `createScriptRecord(realm, site)` and a
  **JIT-published** entry calling the AOT-bound view through the managed surface (site-carrier
  N2).
- **N-b. Managed caller to managed entry.** A site built in **JIT** caller code (a managed
  Script containing `eval(s)`), then viewed by a JIT entry.
- **N-c. Authority.** The view's authority must come from the compiler's record binding
  (`general-record-is` against the exact descriptor). It must never come from ABI matching
  or a relaxed managed-surface contract. If the binding is absent, the entry's call must
  surface as the `invoke-threw` fault (`UNBOUND_DIRECT_EVAL_SITE_VIEW` escapes before the
  `try`). It must never surface as a JS-visible completion.

### 6.2 `verify-hosted-managed-script.ts` case 7 (`verifyDirect`)

Build the realm with `make()`, then install the indirect evaluator and then
`createDirectEvaluator` on the counted managed host from case 5. The case returns 42 only if
every check below holds. Each exit code is distinct and fault codes are not reused:

| Exit | Check                                                                                                                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 180  | **AOT caller (N-a).** Fixture code builds a `DirectEvalSite` over a declarative `vars` record, the same shape as the entry fixture, and calls `callEvalCandidate(a.realm.evalFunction, undefined, ["var w=v+2;w"], …, 2, site)`. Expect 42, `w` in `vars`, `invokes` +1 and the `nativeActive` identity equal to `site.scriptOrModule` |
| 181  | Flags 3 with `"var s=1;s"` returns 1, and `vars` has no `s`                                                                                                                                                                                                                                                                            |
| 182  | Flags 16 with a defined site, and flags 2 with `site = undefined`, are sticky. Expect `invokes` unchanged, `a.realm.unsupported` true, and a fresh realm used afterwards                                                                                                                                                               |
| 183  | **Managed caller (N-b).** A managed **Script** compiled through `createScriptEvaluator` runs `function f(){var v=40;eval("var w=v+2");return w}f()`. Expect 42 and two managed publishes: the Script and the eval entry                                                                                                                |
| 184  | `function g(){let x=1;try{eval("var x")}catch(e){return e instanceof SyntaxError}}g()` is true, and the conflict is detected before any binding                                                                                                                                                                                        |
| 185  | `function h(){try{throw 1}catch(e){eval("var e=2");return e}}h()` returns 2, which is the Catch exemption                                                                                                                                                                                                                              |
| 186  | `var o={};function k(){return eval("this")}k.call(o)===o` holds, and `function n(){return eval("new.target")}new n()` returns `n`                                                                                                                                                                                                      |
| 187  | **Retention.** `function m(){eval("var c=function(){return 5}");return c}var keep=m();` then `churn()` (32 MiB), then `keep()` returns 5. Expect no context leak and `currentRootHead()` restored                                                                                                                                      |
| 188  | **Nested.** `function p(){eval("eval('var z=7')");return z}p()` returns 7, with the inherited site's catches and variables                                                                                                                                                                                                             |
| 189  | **Throw identity.** `eval("throw t")` inside a function rethrows the same object, caught in the managed Script                                                                                                                                                                                                                         |
| 190  | **Fault isolation.** A wrong-type `hostDefined`, via a direct `invoke` of a published eval entry with `createScriptRecord(realm, object)`, gives the `"unsupported"` completion                                                                                                                                                        |

**Constraints.** Managed generator/async **Scripts** are rejected at `profile` by the existing
callback-variance check ([analysis](../results/direct-eval-site-managed-suspension-analysis-v1.json));
that is a separate defect, so use no managed generator or async callers and do not relax the
profile. Direct eval inside an **AOT** generator or async caller (a Test262 file, §7) compiles
an ordinary eval Script entry with no suspension; prove it in §7.2. Eval code that _declares_
`function*` or `async function` should hit the same `profile` rejection and map to sticky: pin
it as exit 191 ("unsupported, not crash"), never as a pass. Case 190 takes the entry address
from the counted host's `compile` result.

Build with `TINT_BUILD_ONLY=1` and run the binary under LLDB with argument `7`. Assert that
the inferior stopped at entry and that its final exit is 42; the debugger's own status alone
is insufficient. Use the build manifest's snapshot. Store the result in
`native-direct-eval-service-v1.json`, and preserve any failed observation instead of
retrying it away. **If 180 or 183 fails**, stop and diagnose the boxing or view path (N2).
Do not wire the host.

## 7. Host routing and Test262 (DE4c)

### 7.1 Capture gate tests (`tools/test262-script-service.test.ts`)

- The current snapshot gives `directEval: true` and adapter `native-script-v9-direct-eval`.
- Historical snapshots without `createDirectEvaluator` keep v8, v7 and v6 exactly, and their
  generated host text has no `installDirectEvalCompiler`.
- A snapshot that exports `createDirectEvaluator` but lacks `installDirectEvalCompiler`,
  `viewDirectEvalSite` or `createIndirectEvaluator` throws `incomplete captured direct-eval
contract`.
- The generated host installs direct after indirect, with the same `service` identifier.

### 7.2 Bespoke host verifiers (new reports; no old report is edited)

Today's sticky-by-index assertions turn into per-case expectations. Native outcomes are
**unknown** until observed. These are the predictions to be tested:

| Verifier              | Case                                                   | Today       | Expected after DE4c                                     |
| --------------------- | ------------------------------------------------------ | ----------- | ------------------------------------------------------- |
| `eval-guard` 6-8      | `try{eval("1")}…`, `?.y`, `evalScript('eval("1")?.y')` | unsupported | completed                                               |
| `eval-site` 12        | `function f(){try{throw 1}catch(e){eval("1")}}f()`     | unsupported | completed                                               |
| `eval-site` 13        | derived constructor `eval("1")`                        | unsupported | **unsupported** (canary)                                |
| `indirect-eval` 14-18 | `eval("1")`, with `eval`, nested `(0,eval)("eval(…)")` | unsupported | completed                                               |
| `indirect-eval` 19    | ``(0,eval)("t`x`")``                                   | unsupported | **unchanged**: not direct eval; do not re-classify here |

Add `tools/verify-test262-native-direct-eval.ts`, following `verify-test262-native-eval-site.ts`
(raw sources, Node `vm` reference for completed cases, one batch image, LLDB containment via
`NativeImageRunner`). It covers: a function var visible to AOT and JIT closures after churn;
`a = eval("var a")` and `p = eval("var arguments")`; intervening `let`/`for` conflicts; a
`with`-object `eval`; strict caller and directive isolation; `cptn-*` style completions and
the empty source; an eval-created promise job observing the caller identity; **direct eval
inside an AOT generator and an async function**; and `unsupported` canaries for an
object-literal method, a class field, a private method and a derived constructor.

### 7.3 Unchanged Test262 acceptance groups

These are targeted directory reruns through `tools/test262-native-run.ts <checkout> <dir>`,
not a suite survey. Run each first against a fresh pre-change baseline image built from a
captured snapshot, then against the v9 adapter. Store new immutable reports, and update the
dashboard row only after a complete rerun.

1. `language/eval-code/direct`, 286 files. Expected movers: `var-env-*` (27), `lex-env-*`
   (7), `cptn-*` (11), `global-env-*` (5), `non-definable-*` (5), `this-value-*` (4),
   `strict-caller-*`, `strictness-override`, `new.target*`, `switch-*`, `block-decl-*`,
   `non-string-*`, `parse-failure-*`; `func-decl-*`, `func-expr-*`, `arrow-fn-*` (12 each);
   **AOT** `gen-func-*` (36), `async-func-*` (36), `async-gen-*` (48); and `super-*-no-home*`,
   `super-call`, `super-prop`, `super-*-arrow`, `super-call-fn` as real non-method
   SyntaxErrors.
2. `annexB/language/eval-code/direct`, 309 files (`global-*` 160, `func-*` 144).
3. `language/global-code`: the two direct-eval-dependent unsupported files out of 75.
4. `language/arguments-object`, last 456/460: a regression check, because DE0 changed its AOT
   output.

**Canaries that must stay `unsupported`** (DE5): `meth-*`, `gen-meth-*` and `async-meth-*`
(12 each), `super-call-method`, `super-prop-method`, and in the class element directories
every `*direct-eval-err-contains*`, `*derived-cls-direct-eval-*` and
`privatename-not-valid-eval-earlyerr-*`.

A canary **pass** means the bit-16 reject was bypassed; a canary **SyntaxError** is a fake early
error. Either blocks the slice.

## 8. Sequencing the deferred frozen self-build

DE0-DE3 and the entry slice deferred the frozen native self-build to "the DE4 batch". Run it
**once, after DE4c** lands and its verifiers pass; a DE4a-only snapshot would be rebuilt
anyway. Capture the snapshot with `tools/frozen-node-toolchain.ts`, build stage 1 and stage 2,
and require byte-identical images, verified signatures and DWARF, compared with
[the last completed self-build](../results/eval-entry-contracts-selfhost-checkpoint-v1.json).
Run it **serially** with no native queue active, record a new checkpoint, and do not overlap
the §7.3 reruns, which should use the **same captured snapshot** so image and conformance rows
are attributable. This is not a compiler-performance task; elapsed time is only an
observation.

## 9. Risks

- **Boxing.** The record-through-closure boxing (N-a) is the main native risk. Its fallback is
  the parent's H2′ carrier, not a cast or an ABI-matched view.
- **Expectation edits.** Edits to the bespoke host verifiers must not hide regressions. Each
  flipped case needs a Node reference run, and canaries stay explicit.
- **Arena cost.** Each direct eval publishes code: no cache, by direction. Loops over direct
  eval exhaust the arena sooner, and exhaustion stays `budget`, which is sticky unsupported.
  Measuring this is deferred.
- **Snapshot drift.** Older frozen images keep their adapter labels and stay sticky; the
  capture gate prevents mixed snapshot/image attribution.

## 10. Next task recommendation (not started)

**Implement DE4a**: §3.1-§3.3 and edits 1-7, red-first with tests R1-R5, S1-S10 and G1.
After that comes DE4b, the native case 7 (§6.2), and only then DE4c. Do not wire the host or
start a self-build or conformance run within DE4a.
