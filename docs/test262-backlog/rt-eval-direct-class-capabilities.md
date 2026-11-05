# RT-EVAL S5-de DE5: direct eval in methods and class contexts

Implementation status: **DE5a Node gates, native proofs and frozen self-build pass.**
See the [implementation checkpoint](../results/direct-eval-class-node-checkpoint-v1.json).
The service, typed site and lazy derived-this lowering are implemented. The
[native entry proof](../results/native-direct-eval-class-entry-v2.json) and
[host verifier](../results/native-test262-direct-eval-class-validation-v2.json)
passed (26 completed, two private-name canaries unsupported). The [frozen self-build](../results/direct-eval-class-selfhost-checkpoint-v1.json)
produced identical stage images and passed signature and debug-info checks. Private-name eval was unsupported in this
frozen slice; the following private-environment slice is separately recorded. The private-scope check uses actual nonempty name maps:
classes with no private names still create empty private-scope entries.

Research capture below describes the pre-implementation source. Parent: [direct environments](rt-eval-direct-environments.md)
§7 DE5. It refines DE5 against the code that DE4 landed:

- the evaluator service and routing ([host integration](rt-eval-direct-host-integration.md));
- the typed H5 site and its view ([site carrier](rt-eval-direct-site-carrier.md));
- the parser and binder context entries ([context parsing](rt-eval-context-parsing.md)).

Where this plan and the parent's DE5 bullet disagree, this plan wins. It splits DE5 into
**DE5a** (home object, field initializers, static blocks and derived constructors) and
**DE5b** (the private environment). Only DE5a is implementation-ready here.

**Capture.** 2026-11-05, live source; `dist` mtimes equal the source mtimes of
`lowering/index.ts` (05:54) and `binding/index.ts` (04:41). DE4 is reported implemented,
with 4,102 workspace tests and managed proof cases 7 and 8 passing. The native host verifier
completed 14 cases, and its 4 class canaries were expected unsupported. The frozen self-build
(`run-direct-eval-host-selfbuild-v1.mjs`) and the queued conformance controller were
**live and untouched**. No DE4 conformance result is cited here.

**Evidence classes.**

- **[spec]** is the draft ECMA-262 text. PerformEval and EvalDeclarationInstantiation come
  from `/tmp/tint-lexentry-spec/global-object.html`. The class clauses (15.7.1, 15.7.10, 15.7.11
  and 15.7.12) come from `/tmp/tint-de5-plan/fc.html`, fetched today from
  tc39.es/ecma262/multipage.
- **[src]** is live workspace source, or unchanged Test262 at the pinned checkout
  `91c70759363c` (2026-10-29).
- **[probe]** is a read-only Node import of workspace `dist`: `/tmp/tint-de5-plan/probe1.mjs`
  and `probe2.mjs`. It parses, binds and lowers, but emits nothing.
- **[node]** is V8 v24.12 output from `/tmp/tint-de5-plan/ref.cjs` and `ref2.cjs`. It is not
  authoritative.
- **[assumption]** has not been observed natively.

**Method.** I emitted nothing, launched no native process or agent, and touched no queue,
journal, report, snapshot or running process. The only edits are this file and one
cross-link in the parent.

**Out of scope, by user direction:** compiler reuse and caching, compile performance, and
complete-suite measurement.

## 1. Answer in brief

1. **The caller capability model is static, except for the derived `this` state.**
   PerformEval's four booleans come from `GetThisEnvironment()`, which skips arrows. The
   lowerer already tracks them in lowering state (`inFunction`, `home`, `derivedContext`,
   `activeConstructor`), and all of them are saved and restored per non-arrow callable. Only
   the class-field-initializer fact is missing from that state. DE5a adds it as flag bit
   **32**.
2. **The site gains three exact typed fields:** `home` and `activeFunction`
   (`OrdinaryObject<ScriptPropertyKey, unknown> | undefined`) and `derived`
   (`DerivedConstruction<ScriptPropertyKey, unknown> | undefined`). Every value already has exactly that static type at the call site [src]. This needs no
   cast, no new frame, no new helper and no new vocabulary entry. `DirectEvalSite` stays the
   one checked record behind `viewDirectEvalSite`.
3. **Derived `this` stays lazy by construction.** A derived site stores the per-invocation
   `DerivedConstruction` record, never a `this` value. Its `thisValue` field is the literal
   `undefined`. The eval entry sets `derivedContext = $derived`, so the existing
   `thisValue()` lowering emits `getDerivedThis($derived)` only where eval code actually
   reads `this` (`index.ts:487-493`). The consequences:
   - `eval('1')` and non-string eval before `super()` never touch the binding;
   - `eval('this')` throws ReferenceError only when it executes;
   - `eval('super()')` reuses `constructSuper`, including the double-`super` ReferenceError.
4. **The engine stays opaque to the site.** The service reads only `flags`: bit 4 sets
   `superProperty`, bit 8 `superCall` and bit 32 the binder's `fieldInitializer`. The engine never calls `viewDirectEvalSite`. That view is an unbound stub under Node
   (`global-environment-direct-eval-site.test.ts:37-40`), so an engine-side view would make
   the service untestable in Node. It would also add the view consumer that DE4 deliberately
   avoided.
5. **Private names are DE5b, and they require a design change, not just a field.** The binder
   needs private-name _spellings_ at compile time. Only the site knows them, and the engine
   cannot view the site. §9 recommends checking AllPrivateIdentifiersValid at run time in the
   lowered entry. That check sits where EvalDeclarationInstantiation puts it [spec], and every
   private-bearing caller is strict. Until DE5b, any site with `privateScopes.length !== 0`
   keeps bit 16 and stays sticky unsupported.
6. **Canaries.** DE5a flips host verifier cases 14 (object method), 15 (field initializer)
   and 17 (derived `eval("1")` before `super()`) to completed. Case 16 (`eval("this.#m")`)
   **stays unsupported** until DE5b.

## 2. Primary specification [spec]

- **PerformEval 19.2.1.1.** For direct eval, it takes `thisEnvRecord = GetThisEnvironment()`.
  For a Function Environment Record it sets `inFunction`, `inMethod = HasSuperBinding()`,
  `inDerivedConstructor` (`[[ConstructorKind]]` derived) and `inClassFieldInitializer`
  (`[[ClassFieldInitializerName]]` not empty). Next, an empty ScriptBody returns `undefined`. Then the early errors apply: NewTarget
  unless inFunction, SuperProperty unless inMethod, SuperCall unless inDerivedConstructor,
  and ContainsArguments when inClassFieldInitializer. The private environment is the running
  context's `PrivateEnvironment`.
- **EvalDeclarationInstantiation 19.2.1.4.** The AllPrivateIdentifiersValid check (built from
  the descriptions in the whole `privateEnv` chain) comes _after_ the sloppy var-conflict walk
  and _before_ any CanDeclareGlobal check or binding creation. That position is what lets
  DE5b defer it to the lowered entry.
- **ClassFieldDefinitionEvaluation 15.7.10** calls MakeMethod(initializer, homeObj) and sets
  `[[ClassFieldInitializerName]]`. A field initializer therefore has inFunction, inMethod and
  inClassFieldInitializer all true, and its `new.target` is undefined.
- **ClassStaticBlockDefinitionEvaluation 15.7.11** uses OrdinaryFunctionCreate and
  MakeMethod(bodyFunc, homeObj), but it does **not** set `[[ClassFieldInitializerName]]`. Then
  15.7.12 runs FunctionDeclarationInstantiation(funcObj, « »). So (settling R5) a static
  block's `eval("arguments")` is _not_ an early error and yields a strict arguments object of
  length 0, and its `new.target` is undefined.
- **15.7.1** gives `FieldDefinition` the ContainsArguments early error. Static blocks get it
  through ClassStaticBlockStatementList, which concerns only _direct_ source and not eval.
- **SuperProperty** does `env.GetThisBinding()` first, then evaluates the key expression,
  then calls GetSuperBase (HomeObject.[[GetPrototypeOf]]). **SuperCall** does GetNewTarget,
  then GetSuperConstructor before arguments, then ArgumentListEvaluation, then IsConstructor,
  then Construct, then BindThisValue (a ReferenceError if already bound), then
  InitializeInstanceElements.
- **Class code is always strict.** Derived constructors, field initializers, static blocks
  and every private-name scope are therefore strict callers, and their eval var record is
  always fresh. Only object-literal methods can be **sloppy** callers with a home object.

## 3. Current source [src]

| Piece           | Location                                                  | Fact                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flags           | `js-engine/src/lowering/direct-eval-flags.ts`             | Bits 1 strict, 2 inFunction, 4 inMethod, 8 inDerived and 16 unsupported. Their values are stable across snapshots                                                                                                                                                                      |
| Site and flags  | `lowering/index.ts:694-772`                               | Sets `unsupported = home ∨ derivedContext ∨ privateScopes`. Bits 4 and 8 are set only together with 16, and such a site argument is `undefined`                                                                                                                                        |
| Site type       | `js-runtime/src/environments/global/direct-eval.ts:13-25` | Six fields; `viewDirectEvalSite(value: unknown)` is a stub that the compiler binds as an exact record view                                                                                                                                                                             |
| Entry state     | `lowering/index.ts:176-213`                               | `receiver = $site.thisValue` and `newTarget = $site.newTarget`. `home`, `derivedContext` and `activeConstructor` start `undefined`, and `privateScopes` is empty                                                                                                                       |
| `this`          | `index.ts:487-493`                                        | `thisValue()` emits `getDerivedThis(context)` plus `check` only when `derivedContext` is set                                                                                                                                                                                           |
| `super.x`       | `index.ts:504-515`                                        | Reads `thisValue` first, then the key, then the base `home.prototype`. It fails with "super requires a compiled method home object" when `home` is undefined                                                                                                                           |
| `super()`       | `index.ts:2636-2652`                                      | Calls `constructSuper(derivedContext, activeConstructor.prototype, args, undefined)`. The base is read before the arguments                                                                                                                                                            |
| Callable state  | `index.ts:1099-1106, 1202-1216, 1676-1685`                | A non-arrow callable sets `home = homeObject`, `derivedContext = $receiverN` (typed `DerivedConstruction`, `:1692-1703`) and `activeConstructor = $calleeN` (typed `OrdinaryObject`). For a derived callable, `newTarget` is `$receiverN.newTarget.value`. Arrows inherit all of these |
| Class callables | `index.ts:1913-1925, 1960-1967, 2141-2147`                | The constructor is `raw, homeObject: prototype, derived`. A static block is `raw, method, homeObject: result`. A field initializer is `raw, method, homeObject: …` and is **indistinguishable from a static block** in its options                                                     |
| Object literal  | `index.ts:2456-2460, 2529`                                | `homeObject: result`, where `result = createObject(objectPrototype)`                                                                                                                                                                                                                   |
| Arguments       | `index.ts:1286-1334`                                      | Every non-arrow callable, including static blocks, runs `instantiateScriptArguments`                                                                                                                                                                                                   |
| Private names   | `index.ts:1865-1879, 478-486`                             | `privateScopes` maps a spelling (with `#`) to a `createPrivateName` temporary. `PrivateName` is `{description}` (`objects/private-elements.ts:4-6`)                                                                                                                                    |
| Service         | `js-engine/src/script-evaluation.ts:87-115`               | `directEvalSupported = 1\|2`. Parses with `superProperty: false, superCall: false` and binds with `{privateNames: [], fieldInitializer: false}`                                                                                                                                        |
| Binder          | `typescript/src/binding/index.ts:165-176, 557-567`        | `EvalBindingContext {privateNames: readonly string[], fieldInitializer}`. Spellings include `#`                                                                                                                                                                                        |
| Derived runtime | `js-runtime/src/objects/derived-construction.ts:12-56`    | `DerivedConstruction {newTarget, thisBinding, initialize}`. `getDerivedThis` returns a BindingResult; `constructSuper` constructs, then binds, then initializes                                                                                                                        |
| Imports         | `lowering/runtime-imports.ts:50-80, 220-245`              | `DerivedConstruction`, `OrdinaryObject`, `getDerivedThis` and `constructSuper` are already imported by every Script entry                                                                                                                                                              |

**Probe [probe, `probe1.mjs`].** Eval-entry results today:

- `super.x` (flags 7) and `super()` (flags 15) fail in lowering for lack of a home object and
  a derived context.
- `#x in this` with `privateNames: ["#x"]` binds, then fails in lowering with "unresolved
  private name". Without the context it is a binder `INVALID_CONTEXT`.
- With `fieldInitializer: true`, `arguments` and `()=>arguments` are `INVALID_CONTEXT`, and
  `(function(){arguments})` lowers.
- **`this` with flags 15 lowers today to `$site.thisValue`.** That is an eager, wrong read in
  a derived constructor, and DE5a must replace it.
- Class private keys parse as `{kind: "string", value: "#x"}` (`probe2.mjs`).

## 4. Node reference and discrepancies [node]

Matches the spec, so it is usable as a fixture oracle:

- **Derived constructor:** `eval("1")` before `super()` succeeds; `eval("this")` and
  `eval("typeof this")` before it throw ReferenceError; `eval("super()")` returns `this`; an
  `eval("() => this")` arrow made before `super()` returns the instance when called after
  it; `eval("new.target") === D`.
- **Double `super`:** `super(); eval("super(order.push('arg'))")` logs `B,field,arg,B`, then
  throws ReferenceError. The arguments are evaluated and the parent is constructed again, but
  the fields are not re-initialized.
- **Read order:** `eval("super[(log.push('key'),'x')]")` before `super()` throws ReferenceError
  with an empty log. `eval("super.x = (l2.push('rhs'), 2)")` throws before the right-hand side
  runs. After `super()`, the order is key then get.
- **Object methods:** sloppy `eval("var leaked=1")` leaks into the method;
  `eval("super(ev = true)")` throws SyntaxError with `ev === false`.
- **Static blocks:** `this === C`, `eval("super.x")` works, `eval("new.target")` is undefined.
  **Field initializers:** `eval("super.x")` works; `eval("arguments")` and
  `eval("() => arguments")` throw SyntaxError; a nested `function(){ return
eval("arguments.length") }` returns 2.
- **Private names (for DE5b):** `eval("this.#m")` works, an undeclared `#n` is a SyntaxError,
  the brand check throws TypeError, and a class declared inside eval shadows the outer `#m`.

**Discrepancy D1.** In a static block, V8 throws SyntaxError for `eval("arguments")`, but the
spec (§2) yields an arguments object of length 0. Pinned Test262 has no file for this case:
no `static {` test calls `eval('arguments')`. Native fixtures follow the spec, and the Node
reference must be skipped for that case, the same way as the existing index-3 exemption in
`verify-test262-native-direct-eval.ts:69`. The parent's two earlier V8 discrepancies
(destructured catch, and `var arguments` in parameters) are unaffected.

## 5. Capability model and contracts (DE5a, proposed)

### 5.1 Flags (`direct-eval-flags.ts`)

Add `export const directEvalInClassFieldInitializer = 32;`. Keep bit 16 with its meaning,
"capability not implemented in this snapshot". After DE5a, the lowerer sets bit 16 only for
`privateScopes.length !== 0`. A caller sets its bits like this:

| Caller (all at site, through arrows)                                  | Bits     | Example word |
| --------------------------------------------------------------------- | -------- | ------------ |
| Sloppy object method / getter / setter                                | 2,4      | 6            |
| Class method, accessor, static method, base constructor, static block | 1,2,4    | 7            |
| Field initializer (instance or static)                                | 1,2,4,32 | 39           |
| Derived constructor                                                   | 1,2,4,8  | 15           |
| Any of the above with a visible private name                          | +16      | e.g. 23      |

**Invariant.** Bits 4, 8 and 32 imply 2; bits 8 and 32 imply 4; and 8 and 32 never occur
together. The service treats any violating word as sticky unsupported, because only a
mismatched snapshot can produce one.

### 5.2 Site record (`environments/global/direct-eval.ts`)

```ts
import type {
  DerivedConstruction,
  OrdinaryObject,
  ScriptPropertyKey,
} from "../../objects/index.ts";
export interface DirectEvalSite {
  readonly scriptOrModule: unknown;
  readonly lexical: EnvironmentScope<ScriptPropertyKey, unknown>;
  readonly variables: EnvironmentScope<ScriptPropertyKey, unknown>;
  readonly catches: DirectEvalCatch<unknown> | undefined;
  readonly thisValue: unknown; // undefined at derived sites; never read there
  readonly newTarget: unknown;
  /** [[HomeObject]] of GetThisEnvironment's function; present iff flag 4. */
  readonly home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  /** Per-invocation derived state, read lazily; present iff flag 8. */
  readonly derived: DerivedConstruction<ScriptPropertyKey, unknown> | undefined;
  /** The derived constructor F, for GetSuperConstructor; present iff flag 8. */
  readonly activeFunction:
    OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
}
```

The `objects/index.ts` type-import edge already exists, so this adds no new module edge. The
fields are appended, so the existing six keep their order. This is still a descriptor change,
and older captured images keep their own descriptor. `DerivedConstruction` and
`OrdinaryObject` are already managed vocabulary types used by JIT class code.

### 5.3 Caller lowering (`invokeEvalCandidate`, `index.ts:694`)

- Set `unsupported = privateScopes.length !== 0`. OR bit 32 from a new
  `inClassFieldInitializer` state into the flag word.
- Append `home`, `derivedContext` and `activeConstructor` (each `?? undefined`).
- At a derived site, `thisValue` becomes `id("undefined")` instead of `receiver`. In a
  derived constructor, `receiver` is the `DerivedConstruction` itself.
- Site construction reads no binding, so `getDerivedThis` counts stay unchanged.

### 5.4 Callable state (`callable`, `index.ts:1060-1216, 1676-1685`)

- Add `readonly classFieldInitializer?: boolean` to `CallableOptions`, and set it only in the
  field branch (`:2141`).
- Add the state variable `inClassFieldInitializer`. Save it beside `outerInFunction`, set
  `if (!arrow) inClassFieldInitializer = options.classFieldInitializer ?? false`, and restore
  it at `:1682`.
- Static blocks, methods and constructors leave it false. This adds no emitted statements,
  so output for code without eval stays byte-identical.

### 5.5 Eval entry (`lowerScriptEntry`, `index.ts:176-213, 4667-4705`)

- Initial direct-eval state: `home = flags & 4 ? id("$home")`, `derivedContext` and
  `activeConstructor = flags & 8 ? id("$derived") / id("$activeFunction")` (else
  `undefined`), and `inClassFieldInitializer = (flags & 32) !== 0`.
- `sitePrologue` is assembled after the body, outside the `try`, next to the `$site`
  narrowing. Under the matching bits it adds
  `const $home = $site.home; if ($home === undefined) return finish("unsupported")`, and the
  same pair for `$derived` and `$activeFunction`. The view already proved the exact
  descriptor. These checks narrow the union fields for the native checker, and they reject a
  flag/site disagreement with the existing sticky completion.
- `$derived` is never dereferenced in the prologue. The body arrow, nested arrows and nested
  eval sites capture the narrowed consts, which follows the `$site` precedent. A nested
  candidate inside eval code then rebuilds its site from the same state, which propagates
  `home`, `derived` and `activeFunction` and keeps `thisValue` undefined.

### 5.6 Service (`script-evaluation.ts:87-115`)

```ts
const directEvalSupported =
  directEvalStrict |
  directEvalInFunction |
  directEvalInMethod |
  directEvalInDerivedConstructor |
  directEvalInClassFieldInitializer;
// reject: realm.unsupported, site undefined, unknown bits, or !capabilitiesConsistent(flags)
parseEvalScript(view, {
  strict: f & 1,
  newTarget: f & 2,
  superProperty: f & 4,
  superCall: f & 8,
});
lowerDirectEvalScript(parsed, source, flags, {
  privateNames: [],
  fieldInitializer: (f & 32) !== 0,
});
```

`capabilitiesConsistent` lives beside the bits in `direct-eval-flags.ts` and is exported
through `lowering/index.ts`. The SyntaxError realm mapping is unchanged: a `super()` from a
method (flags 7) and `arguments` from a field initializer (flags 39) become caller-realm
SyntaxErrors before any compile.

## 6. DE5a exact edit list

1. `js-engine/src/lowering/direct-eval-flags.ts`: add bit 32 and `capabilitiesConsistent`.
2. `js-runtime/src/environments/global/direct-eval.ts`: add the three fields (§5.2), and
   correct the doc comment.
3. `js-engine/src/lowering/index.ts`: `CallableOptions.classFieldInitializer` and the new
   state (§5.4); the field branch option; `invokeEvalCandidate` (§5.3); the entry state and
   `sitePrologue` (§5.5). Also update the `lowerDirectEvalScript` doc comment.
4. `js-engine/src/script-evaluation.ts`: the supported mask, parse and bind contexts, and the
   invariant (§5.6). Update the doc comment, which currently says "class capabilities stay
   explicitly unsupported".
5. `DirectEvalSite` literals gain the three fields:
   `js-runtime/test/global-environment-direct-eval-site.test.ts:26`,
   `tools/verify-hosted-direct-eval-site.ts:35`, `tools/verify-hosted-direct-eval-entry.ts:52`
   and `tools/verify-hosted-managed-script.ts:207`.
6. Tests (§7) and the native verifier (§8).
7. Docs: this plan's status line, the parent's DE5 status, and the host-integration answer 3
   (bit 16 now marks private scopes only).

**Not edited:** the guard `callEvalCandidate`, `ErrorRealm`, `ScriptRecord`, the frame, the
directory, `tools/test262-native.ts` host wiring (the service is captured with its snapshot)
and runtime imports. The vocabulary stays at 126. Record and signature class counts are
**expected** to be unchanged but must be measured by the existing pins
(`runtime-surface.test.ts:54`, `script-runtime-surface.test.ts:376-390`).

## 7. Red-first Node tests

**`js-engine/test/eval-site.test.ts`**

- Replace "class capabilities defer site construction" (`:104-128`) with two tests:
  - private sites still defer. The sources `class C{#x;m(){eval(x)}}` and the derived and
    field variants with a `#x` give bit 16, an `undefined` argument and no site object;
  - non-private class sites build a site. Check the exact field list (9 names, in order) and
    these words: `var o={m(){eval(x)}}` gives 6, `class C{m(){eval(x)}}` 7,
    `class C{x=eval(x)}` 39, `class C{static{eval(x)}}` 7, and the derived constructor and its
    arrow both give 15.
- Field values: a method's `home` is the prototype temporary and a static method's is the
  class temporary; a derived site's `derived`/`activeFunction` are the callback's
  `$receiverN`/`$calleeN` and its `thisValue` is the identifier `undefined`; non-class sites
  have three `undefined` identifiers.
- Bit-32 scoping: an arrow inside a field initializer keeps 39;
  `class C{x=function(){eval(x)}}` drops back to 3; `class C{static{(()=>eval(x))()}}` has
  no bit 32.
- Keep "derived candidates add no derived-this read" (`:152-163`) unchanged. It must stay
  green with the new site.
- **Byte identity:** lowering a class-heavy source without a candidate (methods, fields, static
  blocks, derived constructor, object methods) produces no `DirectEvalSite` and is identical
  to the same source lowered with the DE4 state.

**`js-engine/test/direct-eval-lowering.test.ts`**

- With flags 7, `super.x` and `super[k]=v` lower, and the prologue has the `$home` narrowing
  before `runScriptContext`.
- With flags 15, `this` lowers to `getDerivedThis($derived)` _inside_ the body (zero prologue
  `getDerivedThis` calls), `super()` to `constructSuper($derived, $activeFunction.prototype,
…)`, and `()=>this` captures `$derived`.
- Flags 3 emit no `$home` or `$derived`.
- A nested candidate inside eval code with flags 15 builds a site whose `derived` and
  `activeFunction` are the narrowed consts and whose `thisValue` is `undefined`.
- With flags 39, `arguments` gives `EARLY_ERROR` and `(function(){return arguments})()`
  lowers.

**`js-engine/test/script-evaluation.test.ts`**

- Replace "rejects unavailable caller capabilities" (`:752-766`): words 6, 7, 15 and 39
  compile `super.x` into one module and 15 compiles `super()`; words 16, 23, 64, 4 (no bit
  2), 10 (8 without 4) and 46 (8 with 32) stay sticky unsupported with no module.
- Owning-realm SyntaxErrors with zero modules: `super()` under 7, `arguments` and
  `()=>arguments` under 39, `super.x` under 3. `new.target` under 39 compiles.

## 8. Native acceptance

**AOT entry fixture.** Extend `tools/verify-hosted-direct-eval-entry.ts` and keep exits 60-67.
The site is built with `createDerivedConstruction` and `createObject`:

| Exit | Case                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 68   | Flags 7: `super.x` reads `home.prototype.x` with `this` from the site. Mutating the home's prototype afterwards is observed                                                                                     |
| 69   | Flags 15, before binding: `1` completes. `this` returns `throw` with a ReferenceError. `super()` binds and returns the instance, and a second `super()` gives ReferenceError after the parent runs (log length) |
| 70   | Flags 7 with `home: undefined` returns the `"unsupported"` completion without running the body                                                                                                                  |

**Test262 host verifier.** In `tools/verify-test262-native-direct-eval.ts`, keep cases 0-17 in
place. Cases 14, 15 and 17 become `completed`, and case 16 stays `unsupported`. Append these
cases:

| #   | Source shape                                                                                                                                                                           | Expected                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 18  | `super-prop-method.js` shape: object method `eval('super.test262')`, before and after `setPrototypeOf`                                                                                 | completed                     |
| 19  | `class C extends B{m(){return eval('super["x"]')}}` through a two-level chain                                                                                                          | completed                     |
| 20  | Derived class field `x=eval('executed=true;super.x')`, `y=eval('new.target')` undefined, and `z=eval('arguments')` SyntaxError with `executed` false                                   | completed                     |
| 21  | Derived constructor: `eval('this')` before `super` is a ReferenceError; then `eval('super()')===this`, an arrow made before `super` returns the instance, and `eval('new.target')===D` | completed                     |
| 22  | Double super through eval: log `B,field,arg,B`, then ReferenceError                                                                                                                    | completed                     |
| 23  | Static block: `eval('this')===C`, `eval('super.x')`, and `eval('arguments').length===0` (D1: no Node reference)                                                                        | completed                     |
| 24  | Nested evals: method `eval("eval('super.x')")`, and field `eval("eval('arguments')")` SyntaxError                                                                                      | completed                     |
| 25  | Async method `await 1; eval('super.x')`                                                                                                                                                | completed (async)             |
| 26  | GC: a derived `eval('()=>this')` closure made before `super`, after 20,000 allocation iterations                                                                                       | completed                     |
| 27  | `class C{#m=1;static{eval('1')}}`                                                                                                                                                      | **unsupported** (DE5b canary) |

Run it with `TINT_BUILD_ONLY=1` under LLDB, following AGENTS.md. Asserting the stopped-at-entry
and final exit states is part of the acceptance. Store the result as a new immutable report;
the v1 report stays as recorded.

**Self-build.** A new frozen self-build is needed after DE5a because the compiler source
changes. The compiler's own source contains no direct eval candidate, so stage-image identity
is expected [assumption].

## 9. DE5b direction: private environment (not implementation-ready)

Superseded by the implementation-ready [DE5b private-environment plan](rt-eval-private-environment.md).

The engine cannot read spellings from the site (§1.4), so the recommended path is:

- **Site field** `privateNames: DirectEvalPrivateName | undefined`, where
  `DirectEvalPrivateName { readonly name: PrivateName; readonly outer: … | undefined }`. The
  chain lists every visible name, innermost first, so shadowing resolves by first match. Each
  site builds it from `privateScopes`, and an eval entry appends to `$site.privateNames`,
  mirroring `catches`. Class output without eval stays byte-identical.
- **Flag bit 64** "private environment" replaces bit 16 for private scopes.
- **Binder:** `EvalBindingContext` gains a mode in which a private name left unresolved by
  inner classes is recorded (`BoundModule.externalPrivateNames`) instead of failing. The
  unused `privateNames: readonly string[]` from DE3 is then removed, or kept for tests.
- **Helper:** `resolveDirectEvalPrivateName(chain, description): {error: "none" | "syntax";
value: PrivateName}` (+1 helper and +1 type, so the vocabulary goes from 126 to 128). The
  entry resolves each external name once, at body start before
  `instantiateDirectEvalDeclarations`, through the existing `check`. That is
  AllPrivateIdentifiersValid at its spec position. All such callers are strict, so no
  sloppy-walk ordering is involved.
- **Test262 targets:** 54 files (§10).

Rejected: an engine-side `viewDirectEvalSite` (breaks Node tests, adds a view consumer), and
widening `callEvalCandidate`/`DirectEvalCompiler` with a names array (guard ABI change and
per-site array literals).

## 10. Test262 focus (unchanged sources; counts are static file census, non-native)

**DE5a targets (50 files).**

- `language/statements/class/elements`: 21 non-private `*direct-eval*` files (field
  initializer `contains-superproperty-{1,2}`, `err-contains-{supercall,supercall-1,
supercall-2,arguments,newtarget}` across plain, `arrow-body-` and `nested-` variants);
- `language/expressions/class/elements`: the same 21;
- `language/expressions/super/prop-{dot,expr}-{cls,obj}-val-from-eval.js`: 4;
- `language/eval-code/direct/super-prop-method.js` and `super-call-method.js`: 2;
- `{statements,expressions}/class/elements/static-field-init-with-this.js`: 2.

**DE5b (54 files).** These are 33 private-bearing files in statements, including the 12
`private-*-visible-to-direct-eval*`, and 21 in expressions.

**No Test262 coverage was found** for `eval('this')` or `eval('super()')` inside a derived
constructor, or for a static-block `eval('arguments')`. The bespoke native cases in §8 are
therefore the only evidence for those semantics. That makes them mandatory and is no reason
to weaken them.

**Selections.** `tools/test262-native-run.ts` accepts one path per run. Use
`language/eval-code/direct` (286), whose DE4 report from the queued controller is the
baseline, and `language/expressions/super` (94). The 46 element and static-field files need
per-file selections, run by one controller against a fresh baseline from the DE4 snapshot.
The whole `class/elements` directory (1,108 files) is a complete-family run, which is
deferred.

**Canaries:** `super-prop-method.js` and `prop-expr-cls-val-from-eval.js` must pass, and
`private-field-visible-to-direct-eval.js` must stay unsupported until DE5b. Re-run
`annexB/language/eval-code/direct` and `language/arguments-object` unchanged as regression
controls; they contain no class sites, so no movement is expected.

## 11. Validated versus assumed

**Validated:** [spec] every flag source, the class clauses, the AllPrivateIdentifiersValid
position and R5; [src] the field types at the site, lazy `thisValue()` and `constructSuper`
ordering, arrow inheritance, unchanged guard and imports, and that Node cannot execute the
view; [probe] today's lowering failures and the eager derived `this`; [node] §4; the Test262
counts.

**Assumed, to observe natively:** (1) the JIT entry narrows the three union fields captured
in closures, as it does `$site`; (2) `getDerivedThis`/`constructSuper` work from JIT entry
code on an AOT- or JIT-allocated `DerivedConstruction`; (3) the 9-field descriptor passes the
view and rejection fixtures; (4) census pins do not move; (5) self-build stages match.

## 12. Risks and non-goals

**Risks.** The descriptor change invalidates mixed-snapshot images; service and lowering are
captured together, so this stays confined to fixtures. Any future eval-entry path reading
`receiver` directly would bypass the lazy derived read; the flag-15 lowering test guards it.
D1 can mislead fixture authors.

**Non-goals:** private names (DE5b), decorators and auto-accessors (still failing in
`classValue`), module-goal eval, compiler reuse, and complete-suite runs.

## 13. Recommended next focused planning task

**DE5b refinement.** Turn §9 into exact red-first test text:

- settle the binder mode and field name, and whether DE3's `privateNames` list is removed;
- fix the chain construction order relative to computed keys and heritage (the heritage
  evaluates with the _outer_ private environment, as in [node] `heritage eval private`);
- state the resolver's exact signature and its census delta;
- decide the per-site versus per-class chain allocation, with byte-identity proof;
- specify the native cases for brand-check TypeError, shadowing by a class inside eval, and
  the SyntaxError position.

Research only; no implementation.
