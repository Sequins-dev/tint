# RT-EVAL: runtime source compilation (Script, eval, Function)

Status: **implemented with remaining conformance, profile and resource gaps**.
This document preserves the original design and its historical baseline. Runtime
Script evaluation, indirect/direct eval and general bodies for all four Function
constructor kinds are implemented; its old populations and unsupported counts
are not current results. Use the [Test262 dashboard](../test262.md) and
[complete group inventory](../test262-inventory.md) for measured coverage.
The [managed template-site slice](rt-eval-template-sites.md) records the latest
native cache checks and unchanged-source rerun. Module execution (HOST-ESM) and
workers (HOST-AGENT) retain their own scopes. Backlog entry: [README](README.md).

## 1. Why, and what is at stake

Pinned revision `91c7075…`. File counts come from the checkout under
`.tint-bootstrap/test262`. Variant counts come from the
[v67 inventory](../results/test262-native-group-inventory-v67.json). These are
populations, not predicted gains.

| Selection                                                            | Population                                                                                                                                                                     | Evidence when planned                                                                                                                                                                                                                          | Needs                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `language/eval-code`                                                 | 454 variants (450 Script, 4 module-unsupported). `direct/` has 286 files: 219 `noStrict`, 15 `onlyStrict`, 48 `async`, 2 negative. `indirect/` has 61 files.                   | No complete report. The v9 prefix shows them as `unsupported`.                                                                                                                                                                                   | S3 (indirect), S5 (direct) |
| `annexB/language/eval-code`                                          | 470 variants. `direct/` has 309 files and `indirect/` has 160. All are `noStrict`.                                                                                             | All observed v9-prefix rows are `unsupported`.                                                                                                                                                                                                   | S3, S5 and Annex B.3.2.3   |
| `$262.evalScript`                                                    | 31 files: 13 in `language/global-code`, 17 in `annexB/language/global-code`, 1 in `annexB/language/eval-code`.                                                                 | The host throws unsupported ([`tools/test262-native.ts`](../../tools/test262-native.ts), `installRealmHost`).                                                                                                                                    | S2                         |
| `built-ins/Function`                                                 | 893 variants. 207 of 509 files construct Function-family bodies.                                                                                                               | [Report](../results/test262-function-managed-access-native-v1.json): 703 pass, 147 unsupported (all reported only as "native runtime reached an unsupported operation", with no subreason), 16 errors and 27 pre-entry crashes (INFRA-PREENTRY). | S4, S6                     |
| `built-ins/{GeneratorFunction,AsyncFunction,AsyncGeneratorFunction}` | 46, 36 and 46 variants                                                                                                                                                         | 36, 31 and 36 pass. 9, 4 and 9 unsupported.                                                                                                                                                                                                      | S6                         |
| Cross-cutting                                                        | `fnGlobalObject.js` (`Function('return this')`) is included by 130 files and `wellKnownIntrinsicObjects.js` by 10. 97 `*cptn*` files observe completion values through `eval`. | Not separable from other features                                                                                                                                                                                                                | S2–S5                      |

Of the 286 `language/eval-code/direct` files, 145 are named after generator or
async functions. They are mostly `…-fn-body-cntns-arguments-*` cases: a direct
eval inside the **parameter list** of an AOT-compiled generator or async
function. Their eval code is synchronous. They need S5, not S6.

The README's text-scan counts (about 1,454 files mention `eval(`) remain
order-of-magnitude dependency signals. `staging/sm`, LANG-CORE (`with`, class
`super`/private tests that use eval) and RT-SHADOWREALM inherit from this row,
but their gains are not attributable until complete reruns. **No expected pass
rate is stated.**

## 2. Specification baseline

| Algorithm                                                                                                                                                                                                                                                                                                | Plan rule                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ParseScript](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-parse-script) / [ScriptEvaluation](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-runtime-semantics-scriptevaluation)                                               | `$262.evalScript` follows [INTERPRETING.md](https://github.com/tc39/test262/blob/main/INTERPRETING.md). Parse errors become a thrown SyntaxError from the **current realm**, and the completion value is returned.                                                                                                              |
| [GlobalDeclarationInstantiation](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-globaldeclarationinstantiation)                                                                                                                                                      | Persistent global lexical and var declarations. Errors are thrown before any statement runs. Already implemented as `instantiateGlobalDeclarations`.                                                                                                                                                                            |
| [eval(x)](https://tc39.es/ecma262/multipage/global-object.html#sec-eval-x) / [PerformEval](https://tc39.es/ecma262/multipage/global-object.html#sec-performeval)                                                                                                                                         | Non-string input is returned unchanged (already done). The early-error context comes from the call site: `inFunction`, `inMethod`, `inDerivedConstructor` and `inClassFieldInitializer`. Strictness is `strictCaller` OR a directive. Indirect eval uses the eval function's realm, the global var env and a fresh lexical env. |
| [HostEnsureCanCompileStrings](https://tc39.es/ecma262/multipage/global-object.html#sec-hostensurecancompilestrings)                                                                                                                                                                                      | An embedding hook. The Test262 host always allows it. It runs before parsing for eval and for CreateDynamicFunction.                                                                                                                                                                                                            |
| [EvalDeclarationInstantiation](https://tc39.es/ecma262/multipage/global-object.html#sec-evaldeclarationinstantiation)                                                                                                                                                                                    | Hoisting conflicts are checked against every intermediate lexical scope. Global vars are deletable (`CreateGlobalVarBinding(vn, true)`). Function bindings are deletable. This is new runtime code.                                                                                                                             |
| [Function calls (direct eval test)](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-function-calls-runtime-semantics-evaluation)                                                                                                                                              | Direct eval needs a non-property Reference named `eval` whose value is SameValue to `%eval%` of the **running** realm. `(eval)(s)` and a `with`-object `eval` are direct. `(0,eval)(s)` and `eval?.(s)` are indirect. The callee is read before the arguments are evaluated.                                                    |
| [FunctionDeclarationInstantiation](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-functiondeclarationinstantiation)                                                                                                                                                   | Steps 20–21: sloppy functions with parameter expressions get a **separate** parameter env, so eval `var`s land in the outer callee env. Steps 27–28 add a separate body var env.                                                                                                                                                |
| [CreateDynamicFunction](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-createdynamicfunction)                                                                                                                                                                                            | Already eager: conversion, then parse, then prototype, then source text. The environment is the constructor realm's global env, and PrivateEnvironment is null.                                                                                                                                                                 |
| [B.3.2.3 eval changes](https://tc39.es/ecma262/multipage/additional-ecmascript-features-for-web-browsers.html#sec-web-compat-evaldeclarationinstantiation), [B.3.4 catch](https://tc39.es/ecma262/multipage/additional-ecmascript-features-for-web-browsers.html#sec-variablestatements-in-catch-blocks) | Block-function var copies inside eval code, and `var` redeclaring a simple catch parameter. Reuse the Annex B plan machinery that the Script lowering already applies ([annex-b-bindings](../annex-b-bindings.md)).                                                                                                             |

Error phases. Eval and dynamic-function parse and early errors are
**runtime-thrown SyntaxErrors in the caller's realm**. These are not
parse-negative tests: the containing Script still parses and runs. The two
`negative:` files in `eval-code/direct` and the one in `indirect` keep their
existing syntax-gate handling. Unchanged harnesses, strictness variants and
isolation rules from [the runner contract](../test262-runner.md) apply. The known
Annex B arguments discrepancy
([analysis](../results/annex-arguments-spec-analysis-v1.json)) stays a failure.

## 3. Current implementation and capability boundary

**AOT Script path.** [`tools/test262-native.ts`](../../tools/test262-native.ts)
(`prepareNativeScripts`) parses each harness and test Script. It calls
`lowerScript` ([`packages/js-engine/src/lowering/index.ts`](../../packages/js-engine/src/lowering/index.ts))
to produce a typed TS module, then links it AOT with `@tint/js-runtime/{objects,
environments/global, environments/records}` into one image. The lowered module
contains:

- about 120 named imports (the binding list near the end of `lowerScript`);
- module-level `TemplateSite` constants (module initialization);
- an exported `execute($global: GlobalEnvironment<ScriptPropertyKey, unknown>,
$errors: ErrorRealm): {error: string; value: unknown}` that wraps the body in
  `runScriptContext`.

Bindings are resolved by **name at runtime**: `resolveBinding`,
`getBindingReference` and `putBindingReference` over `EnvironmentScope` chains
(`packages/js-runtime/src/environments/global/scope.ts`). Statement completion
values are tracked in `$completion`. `callable()` builds an implementation arrow
`(receiver, args, callee, newTarget)` and wraps it in `createSourceFunction` or
its generator/async variants. Generators and async functions are already lowered
to continuation closures (`lowering/generators.ts`). Because all of this is
dynamic, eval-introduced bindings are visible to AOT code without any static
re-resolution.

**Dynamic functions.** [`packages/js-engine/src/dynamic-function.ts`](../../packages/js-engine/src/dynamic-function.ts)
(`createDynamicFunctionCompiler`) does the following:

- validates eagerly with `parseDynamicFunction` and `validateJavaScriptBindings`;
- builds the object with `createSourceFunction` and its kind variants, then
  `setPrototype` and `retainFunctionSource`;
- compiles **lazily** through three profiles: `compileClosedDynamicFunction`
  (borrowed input), `compileManagedGlobalAccessDynamicFunction`
  (`tint.global-access.v1`) and `compileManagedReceiverWriteDynamicFunction`
  (`tint.receiver-write.v1`);
- rejects anything else with `rejectUnsupportedExecution`.

These profiles are fast paths, **not general execution**. `installEvalIntrinsic`
(`js-runtime/src/objects/global-properties.ts`) returns non-strings and rejects
strings.

**Compiler entry.** `prepareNativeFunctionEntry`
([`packages/compiler/src/native/closed-functions.ts`](../../packages/compiler/src/native/closed-functions.ts))
runs `checkClosureModule`, `lowerModuleEntries`, `pruneClosedModule`,
`optimizeModule` and prune again. It **rejects any import and any non-declaration
statement**, and entries that need an environment or receiver slot.
`emitModule(…, {managedABI})` (`packages/codegen/src/aarch64/scalar/index.ts`,
`ManagedABIRequest`) emits zeroed slots for:

- the function brand;
- signatures, with optional `localFunctions` membership;
- records, by witness.

`resolveManagedPointers` ([`managed-imports.ts`](../../packages/compiler/src/native/managed-imports.ts))
validates `ManagedIdentityBinding`s and patches a copy of the image. It checks
role, name, contract string, exact physical signature, complete `RecordLayout`
(offsets, types, mutability, presence/state tags) and the descriptor words read
through a trusted reader. The function brand words are 48/1/24/0.
`callExecutableManaged`/`…WithIndex` enter `(reference) -> general` code. They
root the argument, propagate throws and restore the root chain.

**G0 pieces with native proof**
([checkpoint](../results/managed-source-entry-checkpoint-v1.json),
[self-build](../results/bootstrap-managed-source-entry-v1.json),
[`tools/verify-native-managed-frame.ts`](../../tools/verify-native-managed-frame.ts)
`--source-entry`/`--local-callback`,
[`verify-native-managed-invocation.ts`](../../tools/verify-native-managed-invocation.ts)):

- native TS parse, check, lower and emit of an entry over an imported `Frame`
  record whose fields are AOT closures;
- the descriptor reflected through the `"descriptor"` record binding and
  `nativeFunctionSignature`;
- a JIT-local callback admitted into an imported signature;
- allocation, retained closures and objects across copying GC, thrown payloads,
  and nested root restoration;
- a byte-identical self-build.

**Remaining boundary.** Context-domain issuance and complete import preflight now
have native rejection/positive-call evidence (S0 below). The real two-live-heap
isolation fixture remains outstanding. Module imports and per-evaluation state in
checked entries remain S1 work; lowered Scripts cannot yet use the general entry.

**Publication.** `createEngineCodeStorage`
([`code-storage.ts`](../../packages/js-engine/src/native/code-storage.ts)) is a
bounded, process-lifetime, never-recycled arena. It is registered as permanent
readable external memory before the first write. The Test262 host maps a 1 MiB
arena (`nativeTestResources.executableMemoryBytes`). Exhaustion yields
`undefined`, which is reported as unsupported.

## 4. Design

### 4.1 Pipeline

```
source ─▶ parseScript / parseEvalScript(ctx) / parseDynamicFunction   (@tint/typescript/syntax)
       ─▶ validateJavaScriptBindings + eval-context early errors
       ─▶ lowerScript | lowerEvalScript(ctx) | lowerDynamicFunctionImplementation  (@tint/js-engine/lowering)
       ─▶ prepareManagedEntry(module, surface)    (@tint/compiler/native: check/specialize/lower/prune/optimize)
       ─▶ emitModule(managedABI from surface) ─▶ resolveManagedPointers(bindings, domain)
       ─▶ EngineCodeStorage.publish ─▶ invokeManagedEntry(address, frame)   (domain-checked adapter)
```

There is one lowering for AOT and runtime use. There is no interpreter, no
per-body template catalogue, no C stage and no platform linker. The existing
profiles stay as optional fast paths, tried before the general path.

### 4.2 Managed import surface (AOT-produced, compiler-owned)

**Problem.** The lowered module imports generic runtime helpers, for example
`resolveBinding<Key, Value>`, `createObject<Key, Value>` and
`runGeneratorSteps<Value>`. It also imports interfaces such as `OrdinaryObject`,
`GlobalEnvironment` and `ErrorRealm`. At runtime these must resolve to the
**already-compiled AOT specializations**, so that module state, record
descriptors and signatures are shared. Recompiling the helpers would duplicate
runtime state and break descriptor identity.

**Vocabulary (single source).** Hoist the binding lists at the end of
`lowerScript` into an exported constant, for example
`scriptRuntimeVocabulary: readonly {specifier; name; typeOnly; typeArguments?}[]`
in `@tint/js-engine/lowering`. `lowerScript` emits its imports **from that
constant**, and every generic helper call emits its explicit `typeArguments`
from the same entry. In practice these are `ScriptPropertyKey`/`unknown`, and
the fixed result type for `runScriptContext`. This is the existing list, made
authoritative. No signature is written by hand: parameter and result types come
from the checked AOT program.

Add one canonical result interface, for example `ScriptCompletionRecord
{error: string; value: unknown}`, to `js-runtime/objects`. Lowering uses it in
place of the anonymous object type, so the entry's returned record has an
importable identity.

**AOT compilation.** Add a compiler option:

```ts
// @tint/compiler/native (CompileRequest)
readonly managedSurfaces?: readonly {
  readonly name: string;                          // e.g. "tint.script-runtime"
  readonly entries: readonly { module: string; name: string; typeArguments: readonly TypeNode[] }[];
}[];
```

`compileArm64Program` resolves each entry to its linked export. It requests
specializations with the existing demand machinery (`specializeCheckedRoots`,
which `prepareCollectionRuntimes` already uses) and retains the results like
`retainedExports`. It then:

1. **Reifies** the closed type graph of every entry signature with `reifyTypes`
   (`@tint/typescript/reify`). Recursive shapes become named aliases. The
   result is a declaration-only module: `declare`-style function signatures,
   interfaces and aliases, plus a synthesized table interface with one field
   per entry.
2. Computes each referenced record's `RecordLayout` using the AOT layout
   pass, the physical signature for each entry, and the list-, set- and
   map-runtime specializations those types require (`collectRuntimeRequirements`).
3. Computes `digest` = SHA-256 of the canonical serialization: declarations,
   layouts, signatures, ABI versions and `nativeSignatureVersion`. Contracts are
   `tint.surface/<digest>/{fn|record}/<index>`.
4. Emits into the image:
   - a **permanent identity directory**: for each contract, the address and
     byte length of the AOT signature or record descriptor that AOT code itself
     uses, and the function brand;
   - the **serialized surface**: declarations text, contracts, layouts and
     table field order, as permanent read-only data;
   - a generated initializer that allocates the **import table record**, whose
     fields are the AOT function values.

Two new `HostOperation`s expose these: `managed-surface-directory` (returns the
window) and `managed-surface-table` (calls the initializer). They are granted
only through `hostBindings`. JavaScript cannot see them.

**Runtime consumption.** `@tint/js-engine/runtime-compilation` (new internal
module of the existing framework) does the following:

1. Parses the surface declarations **once per process**.
2. Holds the table record in a rooted engine-owned cell.
3. Builds `ManagedIdentityBinding`s from directory entries only. The table's
   own descriptor is also in the directory, so no runtime reflection is needed
   to authorize.

A missing specialization means the lowered output demanded something absent from
the surface. That is reported as unsupported **compilation** with a precise
diagnostic. It is never satisfied by compiling the helper privately.

### 4.3 Managed entry mode (compiler)

Add `prepareManagedEntry(module, entry, surface, limits)` next to
`prepareNativeFunctionEntry`. It shares the check → lower → prune → optimize
stages. Do **not** relax `prepareNativeFunctionEntry`: the closed profile keeps
its rejections.

```ts
export interface PreparedManagedEntry {
  readonly module: ModuleIR;
  readonly entryId: number;
  readonly abi: ManagedABIRequest; // brand + signature/record witnesses, contracts from surface
  readonly instance: RecordLayout | undefined; // per-evaluation state (template sites), see 4.4
  readonly requiresPermanentLiterals: boolean;
}
```

Transformations, in order:

1. **Import rewriting.** Each value import from a vocabulary specifier becomes a
   field load on `$frame.imports`, and the call becomes a `call-indirect`
   through the AOT function value. Type-only imports resolve to the reified
   declarations. A non-vocabulary import is rejected (`stage: "profile"`).
2. **Module state.** Module-level `const` statements that the lowering marks as
   per-parse state (today `TemplateSite`s) move into a synthesized instance
   record. Any other initializer is rejected. This keeps "no module
   initialization" true for code bytes.
3. **Entry wrapper.** Synthesize `export function $entry($frame: $Frame):
ScriptCompletionRecord`, which calls the lowered `execute`. Specifically:
   `execute($frame.global, $frame.realm)` for Scripts, the eval form for eval
   code, and `$frame` → implementation closure for dynamic functions.
4. **Identity mapping.** After emission, map every IR record and signature
   witness whose source type is a reified surface alias to that alias's
   contract. Use the alias name, then check against the directory layout. JIT
   functions whose values flow into surface function types are listed in
   `localFunctions` of that signature binding. This is the already-proven
   explicit membership. Image-private records, such as purely local
   temporaries, keep private descriptors in the published, registered arena.
5. **Effects.** Allocation, throw, invoke and heap-write are allowed. GC roots
   and frames come from the normal emitter.

### 4.4 Frame, instance and site contracts

These are canonical surface records, declared in `js-runtime`. AOT code
constructs them, so their identity is in the directory.

```ts
export interface ManagedScriptFrame {
  readonly imports: unknown; // table record; typed by synthesized surface alias
  readonly global: GlobalEnvironment<ScriptPropertyKey, unknown>;
  readonly realm: ErrorRealm;
  readonly instance: unknown; // per-parse state record or undefined
  readonly site: EvalSite | undefined; // direct eval only
}
export interface EvalSite {
  // built by AOT-lowered caller code
  readonly scope: EnvironmentScope<ScriptPropertyKey, unknown>; // LexicalEnvironment
  readonly variables: EnvironmentScope<ScriptPropertyKey, unknown>; // VariableEnvironment scope
  readonly thisValue: unknown; // or derived this state, below
  readonly derived: DerivedConstruction | undefined;
  readonly home: { readonly prototype: unknown } | undefined; // the lowering's home holder shape
  readonly newTarget: unknown;
  readonly activeConstructor: unknown;
  readonly privateNames: readonly {
    readonly name: string;
    readonly value: unknown;
  }[]; // innermost first
  readonly flags: number; // strict | inFunction | inMethod | inDerivedConstructor | inClassFieldInitializer
}
```

**Code is context-independent.** Scope, receiver and realm always arrive through
the frame. Moving references are never embedded in code. Only permanent
registered literals are embedded.

### 4.5 Engine service

Generalize `createDynamicFunctionCompiler` into a realm-local
`RuntimeCompiler` in `@tint/js-engine`, reusing the same `DynamicFunctionCodeHost`
authority shape:

```ts
interface RuntimeCompilerHost extends DynamicFunctionCodeHost {
  readonly surface: ManagedSurfaceAccess; // directory reader + table cell (rooted)
  readonly domain: () => number; // current context domain token
  readonly invokeEntry: (
    address: number,
    domain: number,
    frame: unknown,
  ) => unknown; // checks domain
  readonly ensureCanCompileStrings: (
    realm: ErrorRealm,
    direct: boolean,
  ) => boolean; // HostEnsureCanCompileStrings
}
interface RuntimeCompiler {
  evaluateScript(source: string): unknown; // $262.evalScript, ScriptEvaluation
  performEval(
    source: unknown,
    direct: EvalSite | undefined,
    strictCaller: boolean,
  ): unknown;
  createDynamicFunction: DynamicFunctionCompiler; // existing contract, general fallback
}
```

`ErrorRealm` gains `evalCompiler` alongside `dynamicFunctionCompiler`, as an
embedding-owned callback that JavaScript cannot replace. The code cache is
bounded and maps `(kind, strict, context flags, source)` to a published entry.
It is shared across realms of one domain. Instance records are **never**
cached: each PerformEval, evalScript and CreateDynamicFunction parse creates
fresh template sites, as the per-Parse-Node rule requires.

## 5. Observable semantics checklist

- **Persistent Script globals (S2).** Each evalScript runs against the realm's
  single `GlobalEnvironment`. Lexical declarations persist in `$global.lexical`.
  Function and var declarations go through `instantiateGlobalDeclarations`.
  Collision errors happen before any statement runs. Escaped closures stay
  callable after later Scripts and GC.
- **Indirect eval (S3).** Uses the eval function's realm, the global var env
  and a fresh declarative lexical env over the global scope, so eval-level
  `let`/`const` do **not** persist. Var and function bindings are configurable.
  Strictness is directive-only, and strict eval gets its own var env. `this` is
  the global this value. Returns the completion value, using UpdateEmpty and
  `undefined` for an empty completion.
- **Direct eval (S5).**
  - Identity is checked against the **running** realm's `%eval%`.
    `installEvalIntrinsic` returns that function but `ErrorRealm` does not
    store it today. Add a realm-owned slot so the identity test never reads the
    mutable global `eval` property.
  - Sloppy `var`/function declarations go into the caller's VariableEnvironment,
    including function var envs and the separate parameter env from
    FunctionDeclarationInstantiation steps 20–21. The current single
    `parameterRecord` in `callable()` must be split when `!strict &&
hasParameterExpressions` **and** the parameter list contains a direct eval.
    Verify the lowering against the spec text before changing it.
  - `this`, `new.target`, `super.x`, `super()` and `#x` come from the site.
    Arrows inherit the site of their enclosing function. `arguments` resolves
    by name.
  - Early errors use the site flags (`new.target` outside functions, `super`
    outside methods, `arguments` in field initializers, unknown private names).
  - Strict callers make eval strict.
  - **A global wrapper is never substituted.**
- **Function constructors (S4/S6).** Use the constructor realm's global scope,
  no private environment and no lexical `anonymous` self binding.
  Parameter/default/rest/`arguments` timing is exactly the existing
  `callable()` and `instantiateScriptArguments` path. Sloppy `this` boxing
  applies with `$frame.global.thisValue` of the **function's** realm. The
  existing eager conversion, syntax and prototype order is unchanged. Body
  compilation stays lazy and happens once per function object. Generator,
  async and async-generator bodies use the lowering's continuation closures.
- **Exceptions and completions.** Runtime throws propagate to the caller
  unchanged. SyntaxError and ReferenceError come from the correct realm:
  - the caller's realm for direct eval;
  - the eval function's realm for indirect eval (equal by construction);
  - the constructor's realm for Function;
  - the host's realm for evalScript.

  Eval inherits the caller's ScriptOrModule identity, including across realms;
  it does not create a fresh Script identity. `runScriptContext` and jobs retain
  that inherited identity. Host `evalScript` instead creates a fresh ScriptRecord
  for each successful parse. Source text for `Function.prototype.toString` remains
  `retainFunctionSource`. Functions declared inside eval code keep their exact
  source slice from the eval string, as `lowerScript(…, sourceText)` already
  does for Scripts.

- **Cross-realm.** Each realm has its own `RuntimeCompiler` closure. The table
  record and code cache are shared per domain, because helpers take realm
  arguments. A realm-B `eval` called from realm A as a plain value is
  **indirect**, in realm B. Direct-eval identity fails in that case, which is
  correct.

## 6. Publication, ownership and resources

1. **Context domain (G0).** A domain is one heap, collector and hosted context
   instance. Realms share a domain; future agents do not.
   - Add a domain word to the hosted context. Name it through `@tint/abi/host`
     constants, not a hardcoded offset.
   - The directory reader and `native-function-signature`/`descriptor` stamp
     the current domain on each binding (`ManagedIdentityBinding.domain`).
   - `resolveManagedPointers(native, bindings, read, expectedDomain)` rejects
     any mismatch before reading descriptors.
   - `EngineCodeStorage.publish` records the domain of each published range.
   - `invokeEntry` checks that the entry's domain equals the current domain
     **before** the trusted call. The frame's `imports` must be the domain's
     own table (identity compare against the rooted cell).
2. **W^X.** Keep the existing trusted `executable-write` leaf (thread-local
   write mode, copy, icache invalidate, restore). Validation and patching
   happen on a private `Uint8Array`, and bytes become executable only after
   successful resolution. Platform facts stay behind `PosixHostABI.executableMemory`.
3. **Lifetime.** Code, private record and root descriptors, signature
   descriptors and literals live in the never-recycled arena, which is
   registered before publication. Escaped JIT closures (function objects
   created by eval code, generator continuations) reference arena code
   permanently. The table record, cache and surface declarations are rooted by
   the engine. Instance records are referenced only from frames and closures,
   so they are traced. Code reclamation is a non-goal. It would need
   code-liveness tracing, not RT-WEAK.
4. **Failure rollback.** Lowering, checking, emission and resolution failures
   publish nothing. A failed write consumes its range (existing policy) and
   the cache entry is not created. Partial images never escape. Cache
   insertion happens only after publication succeeds.
5. **Limits are not language errors.** Arena exhaustion, the code-size limit
   (`maxDynamicCodeBytes`), the cache limit, specialization limits and
   compiler `LIMIT` codes all give `rejectUnsupportedExecution` with a
   diagnostic subreason. They never give a RangeError or SyntaxError. Raise the
   Test262 arena only after measuring S2 code size (open question 2).
6. **Diagnostics.** Distinguish five categories:
   - `early-error` → realm SyntaxError;
   - `unsupported-lowering`/`unsupported-compilation`;
   - `missing-authority` (directory, contract or domain mismatch) → internal
     unsupported, plus a fixture assertion;
   - `resource-limit`;
   - runtime throws.

   Extend `realm.unsupported` to carry the first subreason, so reports can say
   _why_ a row is unsupported. Today all 147 Function rows share one string.

## 7. Implementation slices

Each slice is test-first. Node tests prove portable logic; native fixtures prove
the claim. Run `pnpm check`, then a frozen native self-build with stage-image
comparison whenever a compiler, codegen or lowering file changes.

**S0. Finish G0 authority.**

The complete-set contract/descriptor-extent preflight is implemented, with
[Node tests and a native rejection/positive-call fixture](../results/native-managed-preflight-v1.json).
Context-domain issuance, resolution, publication and invocation checks are implemented
and [validated natively](../results/native-managed-domain-v1.json). Two-live-context
isolation remains outstanding; the [ownership self-build](../results/managed-domain-checkpoint-v1.json) passes. Physical
version words require authorized reads to validate; rejecting a mismatched
loader-issued contract before reads is a separate check.

- Files: `packages/abi/src/host.ts` (domain constant),
  `compiler/src/native/managed-imports.ts` (`domain`, `expectedDomain`),
  `js-engine/src/native/code-storage.ts` (per-range domain), the trusted
  invocation adapter (`callExecutableManaged`, host operation in `ir/scalar/host.ts`
  and codegen), and `dynamic-function.ts` (pass the domain; profiles now use
  it too).
- Acceptance:
  - Node tests where mismatched domain, wrong contract version string and
    `nativeSignatureVersion` drift are rejected before `readWord` is called
    (spy reader).
  - Native `verify-native-managed-frame.ts --reject` mode, where each case must
    return a distinct status **without invoking the foreign pointer** (a
    sentinel helper that sets a flag):
    - signature contract differs;
    - signature physical type differs;
    - record layout differs by one mutability tag;
    - version differs;
    - foreign domain token, both at resolve time and at invoke time.
  - Existing two-helper, source-entry and local-callback modes still pass.
- A real foreign-domain proof needs two independently initialized live heaps and
  contexts. This can be tested sequentially in one process; worker support is not
  intrinsically required. Until that fixture exists, an unissued-token test only
  proves the guard rejects that token, and the report must state that limit.

**S1. Managed import surface plus managed entry (no JS yet).**

The next integration slice is refined in
[rt-eval-surface-directory.md](rt-eval-surface-directory.md).

Started: shared `scriptRuntimeImports`, named `ScriptCompletionRecord`,
`prepareManagedSurfaceTypes`/`reifyManagedSurfaceTypes`, checked named type exports,
and requested record identities through pruning are implemented. The
[expanded native fixture](../results/native-managed-surface-specialization-v3.json)
covers reification, generic demands/reuse, rechecking/lowering and record lookup.
Explicit backend `localSignatures` groups now preserve separate descriptor
identities for equal machine signatures, with
[native validation](../results/native-managed-surface-local-signatures-v2.json).
Opt-in `signatureTypes` preparation now selects distinct indirect witnesses from
checked function types and maps named aliases through both pruning passes; its
[native validation passes](../results/native-managed-semantic-witnesses-v1.json).
Entry selection also now inverts lowering's native-index → source-ID table; the
[native execution regression](../results/native-managed-entry-selection-v1.json)
checks an earlier nested closure plus actual JIT helper calls, GC and exceptions. Keep equal checked types
shared, while separating different record shapes that both encode as references.
Do not infer semantic membership from physical signatures. Exact type groups
are the first helper-table profile, not a complete implementation of function
assignability: safe parameter/return variance can give one function overlapping
compatible contracts. Do not merge overlapping groups transitively, which can
admit an incompatible member. General callback interchange needs explicit allowed
membership/guards or another identity-preserving design, with variance tests.
Typed AOT helper-table factories and explicitly authorized metadata reflectors now
have [runtime](../results/native-managed-surface-reflection-v1.json) and
[native compiler](../results/native-managed-surface-reflector-compiler-v1.json)
fixtures. Factories allocate fresh tables of existing helper bindings, preserving
shared module state. The [semantic-witness checkpoint](../results/managed-semantic-witnesses-checkpoint-v1.json)
passes a native fixed point; its frozen source precedes the factory/reflector
producers. Automatic retention, the physical directory, serialization and general
entry remain pending. The [factory/reflection self-build](../results/managed-reflector-checkpoint-v1.json)
is byte-identical. The [reachable-identity extension](../results/managed-reachable-identities-v1.json)
exposes record and callback identities throughout the reified graph and passes
native compiler and AOT reflection fixtures. It is newer than that frozen source.
The typed import adapter passes [native execution and a fixed point](../results/managed-entry-checkpoint-v1.json).
It is an initial synchronous profile, not the general Script entry described below.
[Versioned declaration interchange](../results/managed-declaration-interchange-v1.json)
also passes native restoration, type checking and adaptation; that source is newer
than the import checkpoint. Automatic helper retention, semantic membership,
physical directories and general publication still require integration.

- Files: `compiler/src/native/index.ts` (`managedSurfaces`, new host operations),
  new `compiler/src/native/managed-entry.ts` (`prepareManagedEntry`), and
  `ts-native` reuse of `specializeCheckedRoots`, `reifyTypes` and
  `collectRuntimeRequirements`.
- Data flow: the AOT surface is built from a **test vocabulary** of three
  generic helpers and one interface. A native fixture parses a typed module
  that imports them, compiles it with `prepareManagedEntry`, resolves it
  against the directory, publishes it and invokes it with a frame.
- Acceptance:
  - recursive interface identity (a self-referential record);
  - a `string[]`/`unknown[]` list crossing the boundary;
  - template-site instance state;
  - closures returned to AOT and called after copying GC;
  - throw propagation;
  - a missing specialization reported as unsupported;
  - a tampered serialized surface rejected by digest.
- Self-build stays byte-identical when no surface is requested.

**S2. General synchronous Script: `$262.evalScript`.**

- Files: `js-engine/src/lowering/index.ts` (vocabulary constant, explicit type
  arguments, `ScriptCompletionRecord`, instance-marked template sites), new
  `js-engine/src/runtime-compilation/`, `js-runtime/objects` (`evalCompiler`
  slot and frame interfaces), and the `tools/test262-native.ts` prelude
  (request the `tint.script-runtime` surface; `evaluateScript` calls the
  service and returns its completion value or throws). The prelude contains
  only host capability wiring; the algorithm lives in the engine.
- Data flow: string → `parseScript` → `lowerScript` (unchanged semantics) →
  `prepareManagedEntry` → publish → `invokeEntry(frame{global, realm,
instance})`. A `{error: "throw"}` result is rethrown, and `unsupported` maps
  to `rejectUnsupportedExecution`.
- Acceptance:
  - Node: the lowered output is identical except for import type arguments.
    Re-run the existing lowering tests.
  - Native fixture: declarations, loops, objects, nested closures and
    try/finally. A global `let` from snippet 1 is visible in snippet 2. A
    collision TypeError happens with no partial execution. A closure from
    snippet 1 survives 32 MiB of churn and is called from snippet 3. A parse
    error throws the host realm's SyntaxError.
  - Then unchanged complete reruns of `language/global-code` and
    `annexB/language/global-code`.
- Rejection: a Script needing a non-vocabulary import is unsupported with a
  subreason, not a crash.

**S3. Indirect eval.**

The first slice is refined in [rt-eval-indirect-eval.md](rt-eval-indirect-eval.md).

- Files: `js-runtime/src/environments/global/` (new `eval-declarations.ts`
  implementing EvalDeclarationInstantiation and B.3.2.3, with
  `varEnv`/`lexEnv`/`privateEnv` parameters), `lowering` (`lowerEvalScript(script,
{mode: "indirect"})`, which starts from `createDeclarativeScope(globalScope,
fresh)` and calls `instantiateEvalDeclarations`), and the
  `installEvalIntrinsic` callback (string → `realm.evalCompiler`).
- Acceptance:
  - Node semantic tests of `instantiateEvalDeclarations`: global var
    deletability, the `CanDeclareGlobalFunction` failure ordering, and
    lexical non-persistence.
  - A native fixture for completion values (`cptn-*` shapes) and realm of
    errors.
  - Then complete reruns of `language/eval-code/indirect`,
    `annexB/language/eval-code/indirect` and `built-ins/eval`.

**S4. General ordinary Function fallback.** Refined in
[rt-eval-function-fallback.md](rt-eval-function-fallback.md).

- Files: `lowering` (factor `callable()` so the implementation arrow can be the
  module result: `lowerDynamicFunctionImplementation(syntax, kind)` →
  `execute(frame): SourceFunctionCall`), and `dynamic-function.ts`
  (`ensureCompiled` tries the profiles, then the general path; the
  implementation closure is cached per function object; `execute` calls it;
  remove the `!simple` rejection for the general path only).
- Acceptance:
  - Native: default, rest and destructured parameters, `arguments` mapping,
    and sloppy `this` boxing with the right realm. `new` on a dynamic function
    uses the construct path with `newTarget`. A cross-realm constructor
    (`$262.createRealm`) uses the other realm's global. Lazy compilation is
    preserved: an uncalled invalid-at-runtime body never compiles.
  - The existing dynamic-function fixtures and profiles are unchanged.
  - Then a complete `built-ins/Function` rerun.

**S5. Direct eval.**

Caller environments, the site record and the context handoff are refined in
[rt-eval-direct-environments.md](rt-eval-direct-environments.md).

- Files:
  - `lowering`: call-site detection (callee stripped of groups is identifier
    `eval`, not an optional call); read the callee before the arguments; emit
    `performDirectEval(func, thisValue, args, site, …)`, building `EvalSite`
    lazily; track a `variable` scope expression alongside `lexical`; materialize
    private names; split parameter envs per §5.
  - `js-runtime/objects`: `performDirectEval` (identity test, then delegate or
    ordinary call).
  - `typescript/syntax`: a `parseEvalScript(source, flags)` entry that seeds the
    existing parser state (`strict`, `newTargetAllowed`, `superProperty`,
    `superCall`, declared private names, class-field-initializer flag). This
    is a context entry point, not a grammar change.
  - `lowerEvalScript(script, {mode: "direct"})`, which starts from the site.
- Acceptance:
  - Native:
    - a var added to a function scope is visible to AOT closures;
    - eval inside parameter defaults (the `fn-body-cntns-arguments` shapes);
    - `with`-object `eval` is direct, while `(0,eval)` and `eval?.()` are
      indirect;
    - `new.target`, `super` and `#x` inside eval inside a class;
    - eval in a derived constructor before and after `super()` (TDZ
      ReferenceError);
    - a strict caller;
    - an escaped eval closure after GC.
  - Then complete reruns of `language/eval-code/direct` and
    `annexB/language/eval-code/direct`. Re-run any LANG-CORE clusters that the
    v9 report attributes to eval.

**S6. Generator and async dynamic bodies.**

Ordinary async bodies, and the managed-suspension prerequisite they share with
the other kinds, are refined in
[rt-eval-async-function-fallback.md](rt-eval-async-function-fallback.md).
Ordinary generator bodies are planned in
[rt-eval-generator-function-fallback.md](rt-eval-generator-function-fallback.md).
Async-generator bodies are planned in
[rt-eval-async-generator-function-fallback.md](rt-eval-async-generator-function-fallback.md).

- Files: `dynamic-function.ts` only, to route the three other kinds through
  `lowerDynamicFunctionImplementation`, returning the continuation factory
  types already used by `createSourceGeneratorFunction` and the other variants.
- Remove the profile-only `completion` discriminator assumption on the general
  path.
- Acceptance: native `yield`, `await`, `yield*`, and return/throw before and
  after start. Then complete reruns of `GeneratorFunction`, `AsyncFunction`,
  `AsyncGeneratorFunction` and `built-ins/Function` again.
- Sequenced last because suspension is already in the lowering, so this slice
  mostly widens the vocabulary. Isolating it keeps S4 failures unambiguous.

**S7. Shared prerequisites handed to later plans (document only).**

- HOST-ESM reuses the surface, `prepareManagedEntry`, instance records and
  publication. It adds a module vocabulary (live bindings, namespaces, TLA) and
  a loader identity.
- HOST-AGENT reuses S2 for `$262.agent.start(source)`. It needs a **second live
  domain**, with a per-domain table, directory reads and published-range
  domain. That is the real proof for S0's context check.
- RT-SHADOWREALM `evaluate` reuses S3 with the target realm.

## 8. Validation strategy

- **Node first.**
  - Lowering snapshot and semantic tests for each new entry.
  - Runtime algorithm tests for EvalDeclarationInstantiation and
    `performDirectEval`, covering ordering and abrupt completion.
  - Compiler tests for `prepareManagedEntry` rejections: non-vocabulary import,
    non-instance module state, a missing specialization, and a digest
    mismatch.
  - Node reference runs (`tools/test262-run.ts`) for the same selections, kept
    separate, with discrepancies checked against the spec.
- **Native.**
  - Hosted fixtures built with `TINT_BUILD_ONLY=1` and run serially under
    LLDB, asserting the stopped-at-entry and exact final exit states.
  - Each slice adds a status-coded fixture under `tools/`, extending
    `verify-native-managed-frame.ts` or adding a sibling.
  - Keep pre-entry debugger failures separate from post-entry faults.
  - Do not expand debugger tooling beyond what a failure requires.
- **Conformance.**
  - Unchanged complete selections, each in a new immutable report, with the
    dashboard updated only after complete reruns.
  - Never mix with the active v9 journal or the parent's RelativeTimeFormat
    controller. Native runs are serial: coordinate with that controller and
    do not pause or resume v9 yourself.
- **Self-hosting.** S1, S2, S4 and S5 change compiler or lowering files. Each
  needs a frozen-source native self-build with byte-identical stage images, and
  the debug-information check for debug builds.

## 9. Decisions, non-goals, blockers and risks

**Decisions (recommended defaults)**

| Decision                 | Default                                                                                                                     | Alternative rejected because                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Helper linkage           | Compiler-generated import table record plus a permanent identity directory                                                  | Recompiling helpers at runtime duplicates module state and descriptors |
| Specialization set       | The lowering vocabulary with explicit type arguments, specialized by `specializeCheckedRoots`                               | Inferring the set from sample Scripts is incomplete                    |
| Type identity            | Reified aliases name contracts. Full layout equality is still checked                                                       | Structural hashing alone is not authority                              |
| Code cache key           | `(kind, strict, flags, source)`, with per-parse instance records                                                            | Sharing instances breaks template-object identity                      |
| Function compilation     | Lazy, one implementation closure per function object                                                                        | Eager compilation would regress construct-only tests                   |
| Surface type checking    | Parse and check the surface declarations once per process. Measure, then add a prechecked environment only if needed        | Premature checker caching                                              |
| Indirect before Function | S3 reuses S2's entry and introduces EvalDeclarationInstantiation, which S5 needs. S4 needs a separate `callable()` refactor | Either order is sound; this one front-loads the shared eval algorithm  |

**Non-goals.** Code reclamation, a JS AST interpreter, a per-body profile
catalogue, module execution, real agents, debugger and profiler source mapping
of JIT code (keep existing `debugSpans` only), and changing strict-profile
TypeScript rules. Do not fake fixes for the two documented discrepancies.

**Blockers.**

- S0 is required before any general path ships.
- The final "wrong context" proof needs a second live context/heap, which may
  be initialized sequentially without HOST-AGENT.
- No dependency on RT-WEAK. `realm.templateObjects` retains sites strongly,
  which is spec-permitted. Weak keying could later bound repeated-eval growth,
  but is not required.

**Risks.**

1. **Native compile latency per eval.** Checking the about-120-helper surface
   plus the lowered body inside the native compiler may hit Test262 timeouts.
   Measure in S2 and record it. Mitigations: the code cache, a prechecked
   surface, and a smaller vocabulary for eval-only modules.
2. **Arena size.** The verbose lowered code may exceed 1 MiB across a test.
   Measure, then size `executableMemoryBytes`. Exhaustion stays unsupported.
3. **Batch image growth.** Linking the lowering and surface into every Test262
   batch host raises AOT build time. Measure before and after S2.
4. **The parameter-env split** (§5) changes AOT lowering for existing
   functions. Gate it on the presence of a syntactic direct eval to keep other
   output byte-stable. Re-run `language/arguments-object`, which currently has
   456 passes out of 460.
5. **Completion values** were previously unobservable natively. Expect latent
   `$completion` bugs to surface in `cptn-*`.

**Open questions**

1. Should `managed-surface-table` be a host operation, or a retained generated
   export bound through `hostBindings`? The default is a host operation,
   because it keeps the authority explicit.
2. What is the acceptable per-test arena and compile-time budget once S2 is
   measured?
   **Resolved domain identity:** the implemented hosted-context token is separate
   from logical agent identity. It identifies a heap/context lifetime and remains
   reserved after teardown. HOST-AGENT planning can proceed; native thread/context
   lifecycle and the two-live-context proof remain implementation work.
