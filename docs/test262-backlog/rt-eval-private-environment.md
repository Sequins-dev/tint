# RT-EVAL S5-de DE5b: direct eval inside a private environment

Status: **implemented; Node gates, all 41 native host cases and the frozen
compiler fixed point pass.** See the
[native validation](../results/native-test262-eval-private-validation-v1.json)
and [self-host checkpoint](../results/eval-private-selfhost-checkpoint-v1.json).
Complete Test262 selection reruns remain separate. Research capture follows.
Parent:
[class capabilities](rt-eval-direct-class-capabilities.md) §9, which this plan replaces.
DE5a is implemented, with Node evidence only
([checkpoint](../results/direct-eval-class-node-checkpoint-v1.json): 4,107 workspace tests;
source `5ac58a8e…63bb6`, 552 files). Its AOT entry fixture and the native 28-case host binary
are **built but not executed**. They wait in the serial controller
`run-direct-eval-class-validation-v1.mjs`, which sits behind the DE4 frozen self-build and the
conformance pause handshake. This plan touches none of that. Until DE5b lands, every eval call
inside a nonempty private environment stays sticky unsupported (bit 16).

**Evidence labels.**

- **[spec]** ECMA-262 draft: EDI/PerformEval (`/tmp/tint-lexentry-spec/global-object.html`),
  ResolvePrivateIdentifier (`…/executable-code-and-execution-contexts.html`), 15.7.7/15.7.14
  (`/tmp/tint-de5-plan/fc.html`), §16.1.1 (`/tmp/tint-de5b-plan/scripts.html`, fetched today).
- **[src]** live source; Test262 pinned at `91c70759363c` (2026-10-29).
- **[probe]** Node import of workspace `dist` (mtimes equal source) in
  `/tmp/tint-de5b-plan/probe.mjs`: parse, bind and lower only, no emit.
- **[node]** V8 v24.12 (`/tmp/tint-de5b-plan/ref.cjs`, `cases.cjs`), not authoritative.
  **[native]**: none in this plan. **[assumption]**: unobserved.

**Method.** No emit, build, native run or agent; no queue, journal, report or process touched.
Edits: this file and one parent cross-link. Out of scope by user direction: full-suite survey,
compile performance, compiler reuse.

## 1. Decision in brief

1. **Validate at run time, in the lowered entry, at EDI step 7.** The binder gets one
   boolean mode, `privateEnvironment`. In that mode, only a private identifier that is
   _unresolved by every class enclosing it inside the eval source_ is deferred and recorded in
   `BoundModule.externalPrivateNames`. The entry resolves each such spelling once against the
   caller's chain, before `instantiateDirectEvalDeclarations`. A miss throws SyntaxError in the
   evaluator's realm. Because private names exist only in class code, every caller with this
   mode is strict. The sloppy var-conflict walk (EDI step 3) therefore never runs first, and
   no body statement, heritage or function instantiation is observable before the check.
2. **Transport is a linked chain on the existing site**, `privateEnvironment:
DirectEvalPrivateName | undefined`, listed innermost first. It mirrors `catches`: there is no
   collection runtime, no new frame and no guard ABI change. Each eval site allocates its chain.
   Class code without an eval candidate is unchanged.
3. **Flag bit 64, `directEvalInPrivateEnvironment`**, is set iff the static chain is nonempty or
   the site is inside eval code that has bit 64. It tells the service to bind in deferred mode.
   Without it, an undeclared `#x` stays a compile-time SyntaxError, as today. The lowerer
   no longer produces bit 16. The constant and the service's rejection of it stay, for snapshot
   stability.
4. **One lookup point.** Every private reference already goes through the lowerer's
   `privateName()` (`lowering/index.ts:491-499`). DE5b adds one fallback map after the local
   scope walk. This replaces the DE3 `privateNames: string[]` binder context, so no parallel
   mechanism remains.
5. **Census.** One value (`resolveDirectEvalPrivateName`) and one type
   (`DirectEvalPrivateName`), both non-generic. Surface 126→128, helpers 104→105 and type
   exports 22→23 follow from the registry. Records (182), signatures (165) and runtimes (41)
   **must be measured**. §7 states the expectation but does not pin it.

## 2. Specification [spec]

- **PerformEval 19.2.1.1.** Direct eval takes `privateEnv = runningContext's
PrivateEnvironment` and passes it to EDI. There is no parse-time private check for direct
  eval: §16.1.1 says "It is a Syntax Error if AllPrivateIdentifiersValid of StatementList with
  argument « » is false **unless** the source text containing ScriptBody is eval code that is
  being processed by a direct eval."
- **EDI 19.2.1.4.** Steps 1-3 are the var names and, only if `strict` is false, the global and
  intervening lexical conflict walk. Steps 4-6 collect the `[[Description]]` of every Private
  Name in the whole `privateEnv` chain. Step 7 throws SyntaxError if AllPrivateIdentifiersValid
  is false. Function instantiation and binding creation come after it.
- **AllPrivateIdentifiersValid 15.7.7** covers `MemberExpression . #x`, `CallExpression . #x`,
  `?. #x`, `OptionalChain . #x` and `#x in`. `ClassBody` extends `names` with its own
  PrivateBoundIdentifiers. Nested function bodies are included, so a reference in a method
  that is never called still counts.
- **ResolvePrivateIdentifier 9.2.1.2** walks from the inner environment outward and compares
  `[[Description]]`. Private environments are immutable after creation, so resolving once at
  EDI time gives the same answer as resolving at each reference.
- **ClassDefinitionEvaluation 15.7.14.** It creates `classPrivateEnv` with one Private Name per
  description (a getter/setter pair shares one). It notes: "The running execution context's
  PrivateEnvironment is outerPrivateEnv when evaluating ClassHeritage". It then sets
  `classPrivateEnv` before the elements (including computed keys) and restores the outer
  environment on every exit.
- **Strictness.** ClassBody is strict code, so any context with a nonempty PrivateEnvironment
  is strict. So is eval code from such a caller, and so is every eval nested in it.

## 3. Current source [src]

| Piece                  | Location                                                             | Fact                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Flags                  | `js-engine/src/lowering/direct-eval-flags.ts`                        | Bits 1, 2, 4, 8, 16 (unsupported) and 32. `directEvalCapabilitiesConsistent` checks 4/8/32 ⇒ 2, 8/32 ⇒ 4, and ¬(8∧32)                                                    |
| Site                   | `js-runtime/src/environments/global/direct-eval.ts:16-29`            | Nine fields. `viewDirectEvalSite` is an unbound stub that the compiler binds as an exact record view                                                                     |
| Private scopes (lower) | `lowering/index.ts:220, 1889-1903, 2253`                             | `{names: Map<spelling, Expression>}` per class. Names are created after heritage and pushed before elements. **Empty maps are pushed for classes with no private names** |
| Lookup                 | `index.ts:491-499`                                                   | Walks innermost-first, else `fail("unresolved private name")`. All uses (`:550-555`, `:2031`, `:2098`, `:2110`, `:2180`, `:2292`) go through it                          |
| Site build             | `index.ts:706-787`                                                   | `unsupported` iff any `names.size !== 0` (`:714-718`). It then sets bit 16, `site = undefined` and no object                                                             |
| Entry state            | `index.ts:176-221`                                                   | The `catches` precedent is `inheritedCatches = $site.catches` (`:188-191`)                                                                                               |
| Entry body             | `index.ts:4431-4597`                                                 | `$evalLexical`, then `$scope`, then `plan` (function bodies lowered here), then `check(instantiateDirectEvalDeclarations…)`                                              |
| Prologue               | `index.ts:4692-4771`                                                 | `$site` view; per-capability `const $f = $site.f; if ($f === undefined) return finish("unsupported")` loop over `fields`                                                 |
| Service                | `js-engine/src/script-evaluation.ts:91-126`                          | Mask 1\|2\|4\|8\|32. It binds with `{privateNames: [], fieldInitializer}` (`:121-124`). `rejectLowering` maps EARLY_ERROR to a realm SyntaxError (`:253-256`)            |
| Binder                 | `typescript/src/binding/index.ts:165-176, 557-564, 734-779, 781-788` | The context seeds one scope from `privateNames`. Classes bind the heritage before the push and computed keys after it. `checkPrivateName` fails with INVALID_CONTEXT     |
| Runtime                | `js-runtime/src/objects/private-elements.ts:4-6, 28-30`              | `PrivateName {description}`, where the description includes `#`. `createPrivateName`                                                                                     |
| Chain walk precedent   | `environments/global/eval-declarations.ts:155-165`                   | `catchRecord` uses a cursor `while` over `DirectEvalCatch.outer`                                                                                                         |
| Imports                | `lowering/runtime-imports.ts:171-189`                                | Direct-eval entries import the instantiate function and the view. `usesDirectEval` imports `DirectEvalCatch`/`DirectEvalSite` as types                                   |
| `$errors`              | `index.ts` contextual prologue                                       | `$script.realm`, the carrier realm, which is the evaluator's own realm                                                                                                   |

**Probe [probe].** `this.#x` with `privateNames: []` is BIND INVALID_CONTEXT; with `["#x"]`
it is LOWER UNSUPPORTED "unresolved private name" (`#x in this`, `this?.#x` alike). The
local-only `(class{#x;m(o){return o.#x}})` lowers. Words: `class C{#x=42;m(){eval(…)}}` → 23
with an `undefined` site; `class C{m(){eval(…)}}` → 7 with a site. A heritage eval in
`class O{static f(){class I extends (eval('1'),Object){#i}}}` → 7 (it does not see `#i`); a
computed key inside `I` → 23 (it does). Key `value`, member `property` and `#x in` `name` all
carry `"#x"`.

## 4. The engine-view question (correcting DE5a §1.4)

DE5a said the engine "cannot" view the site. More precisely, `viewDirectEvalSite` is an
unbound stub under Node (`global-environment-direct-eval-site.test.ts`). The compiler binds it
only in lowered and hosted code. That is a **testability constraint, not an architectural
impossibility**. The service already takes an injected checked view:
`ScriptEvaluationHost.completion`. Native hosts bind it to the `completion` view in the
`script-host` module (`tools/test262-native.ts:263,998`;
`tools/verify-hosted-managed-script.ts:70,114,138,202`), and Node tests pass a fake
(`script-evaluation.test.ts:102`).

| Option                                                                                                                                                                      | What it needs                                                                                                                                                                                                                                       | Verdict                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A. Host-injected view: `host.privateDescriptions(site): readonly string[] \| undefined`, with the service collecting spellings and binding with the existing `privateNames` | A new `ScriptEvaluationHost` member in six host literals, a second site-view consumer, a string-list collection per eval call before parsing, **and still** a run-time resolver, because a `PrivateName` identity cannot be a compile-time constant | Feasible and Node-testable with a fake, but strictly additive: it does not remove the resolver |
| B. Deferred run-time validation in the entry                                                                                                                                | Binder deferral, the lowerer fallback map and one resolver. Resolution doubles as the AllPrivateIdentifiersValid check                                                                                                                              | **Chosen**                                                                                     |

B puts the check exactly at EDI step 7 [spec]. It adds no host ABI, keeps the site opaque to
the engine and keeps the single view consumer that DE4 chose. Its costs:

- An eval body with an undeclared external name is lowered and compiled before it throws.
- If the same body also contains an unrelated **unsupported** lowering construct, the result is
  the sticky "unsupported" completion instead of SyntaxError. That is conservative and
  unchanged in kind from today.

## 5. Contracts

### 5.1 Flags (`direct-eval-flags.ts`)

```ts
/** Lowering no longer produces 16 (DE5b); the service still rejects it. */
export const directEvalUnsupportedCapability = 16;
export const directEvalInPrivateEnvironment = 64;
// directEvalCapabilitiesConsistent adds: 64 ⇒ 1 (class code is strict).
```

64 does **not** imply 2. A computed key evaluates in the class scope, outside any function, as
in `class K{#x; static [eval("String(#x in {})")]=1}`, which gives word 65 [node]. Example
words:

| Caller                                                 | Word |
| ------------------------------------------------------ | ---- |
| Class computed key, outside any function               | 65   |
| `function(){eval()}` nested in a class method          | 67   |
| Class method, accessor, static block, base constructor | 71   |
| Derived constructor                                    | 79   |
| Field initializer (public or private field)            | 103  |

### 5.2 Runtime (`environments/global/direct-eval.ts`, exported from `global/index.ts`)

```ts
import type { PrivateName } from "../../objects/index.ts"; // existing edge
/** One visible Private Name; the chain lists the caller's environment innermost first. */
export interface DirectEvalPrivateName {
  readonly name: PrivateName;
  readonly outer: DirectEvalPrivateName | undefined;
}
export interface DirectEvalSite {
  /* nine existing fields unchanged, in order */
  /** Present iff flag 64. Shadowing resolves by first match. */
  readonly privateEnvironment: DirectEvalPrivateName | undefined;
}
/** ResolvePrivateIdentifier over the whole caller chain; undefined is EDI step 7's failure. */
export function resolveDirectEvalPrivateName(
  environment: DirectEvalPrivateName | undefined,
  description: string,
): PrivateName | undefined {
  let cursor = environment;
  while (cursor !== undefined) {
    if (cursor.name.description === description) return cursor.name;
    cursor = cursor.outer;
  }
  return undefined;
}
```

Both are non-generic. The return is `PrivateName | undefined`, not an error record, so no
result record is added. The entry narrows the value with its own `if`.

### 5.3 Binder (`typescript/src/binding/index.ts`)

```ts
export interface EvalBindingContext {
  /** Caller PrivateEnvironment is nonempty: identifiers no enclosing eval-local
   * class declares are deferred to EvalDeclarationInstantiation. */
  readonly privateEnvironment: boolean;
  readonly fieldInitializer: boolean;
}
// BoundModule gains:
readonly externalPrivateNames?: readonly string[]; // unique, first occurrence, with '#'
```

- Delete the context-seeded scope (`:557-564`); `privateNames` is removed, not kept beside it.
  In `checkPrivateName` (`:781-788`), when the local walk misses and the mode is on, record
  the spelling once (Set plus array) and return; otherwise INVALID_CONTEXT as today.
- This defers only genuinely external names. A reference inside an eval-local class that
  declares the name resolves locally and is not recorded. The heritage is bound before the push
  (`:734`), so `class D extends (this.#x, Object){#x}` records `#x`. A computed key is bound
  after the push (`:771`), so it does not.
- Other early errors (duplicates, `#constructor`, `delete this.#x`) stay compile-time. Each
  Annex B pass rebuilds the list; the final pass is authoritative.

### 5.4 Lowering (`js-engine/src/lowering/index.ts`)

**State (`:176-221`).** `privateInherited` (direct-eval entry with bit 64), `inheritedPrivate =
privateInherited ? id("$privateEnvironment") : id("undefined")`, and
`const externalPrivate = new Map<string, Expression>()`. **Lookup (`:491-499`):** after the
scope loop, return `externalPrivate.get(name)` if present, else `fail` as today.

**Site (`invokeEvalCandidate`, `:706-787`).**

- Delete `unsupported` (`:713-718`) and its guard; the site is always built. After `catches`, build the chain, outermost scope first, so the last link is the innermost:
  ```ts
  let privateEnvironment = inheritedPrivate;
  for (const privateScope of privateScopes)
    for (const name of privateScope.names.values())
      privateEnvironment = temporary(
        object(["name", "outer"], [name, privateEnvironment], span),
        false,
        false,
        named("DirectEvalPrivateName"),
      );
  ```
  Empty maps add nothing. Bit 64 is
  `privateInherited || privateEnvironment !== inheritedPrivate`.
- Append the tenth field `"privateEnvironment"`. Sites are lexical, so arrows, nested
  functions, object methods and nested classes need no per-callable state; a heritage site
  sees only outer classes and a computed-key site sees its own class.

**Entry resolution.** This goes in the `try`, immediately after the `$scope` declaration
(`:4451-4475`) and before `plan` is built, so before any function body is lowered and before
`instantiateDirectEvalDeclarations`. For each spelling `s`, in the binder's order:

```ts
const $valueN = resolveDirectEvalPrivateName($privateEnvironment, "s");
if ($valueN === undefined) throw createRuntimeError($errors, "syntax");
```

Then `externalPrivate.set(s, id("$valueN"))`. Use `temporary()` for the name and emit the `if`
directly, as the prologue does. A non-empty list without bit 64 is a lowering invariant
violation, because the binder ran in normal mode: `throw "DIRECT_EVAL_PRIVATE_INVARIANT"`.

**Prologue (`:4729-4736`).** Under bit 64, push `"privateEnvironment"` onto the existing
`fields` loop. That gives `const $privateEnvironment = $site.privateEnvironment;` and the
`"unsupported"` return on `undefined`. The loop needs no new code.

**Imports (`runtime-imports.ts`).** `resolveDirectEvalPrivateName` joins the `direct-eval`/`all`
value list beside `viewDirectEvalSite` (`:171-174`); `DirectEvalPrivateName` (type-only) joins
the `usesDirectEval || direct-eval` list (`:180-189`). No `scriptRuntimeTypeArguments` case.

### 5.5 Service (`script-evaluation.ts:91-126`)

Add bit 64 to the mask, bind with `{privateEnvironment: (flags & 64) !== 0, fieldInitializer: …}`
and update the doc comment at `:96-97`. Parse contexts are unchanged. The guard, `callEvalCandidate`, `DirectEvalCompiler`,
`ScriptEvaluationHost`, `ErrorRealm`, the frame and `tools/test262-native.ts` wiring are
**not edited**. The service is captured together with its lowering snapshot. The existing
`directEvalSiteView` capture probe (`test262-native.ts:869-873`) is unaffected.

## 6. Semantics walk-through

| Shape                                                                                 | Behaviour                                                                                                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `class C{#x=1; m(){return eval("this.#x")}}`                                          | Word 71, chain `[#x]`. The entry resolves `#x`, and the read uses the existing `getPrivateObjectValue`                |
| The brand check `C.g({})`                                                             | Resolution succeeds, then `getPrivateObjectValue` returns `type`, giving TypeError                                    |
| Undeclared `#y`, with `log.push(1); class D extends (log.push(2),Object){}` before it | SyntaxError at resolution; `log` stays empty, because the class and heritage never run                                |
| Undeclared external in an uncalled nested method                                      | Still recorded by the binder, so SyntaxError at entry                                                                 |
| Eval-local `class D{#m}` shadowing an outer `#m`                                      | Inside D the reference resolves to D's local temporary. Outside D it resolves externally. Cross-brand gives TypeError |
| `eval("eval('this.#x')")`                                                             | The inner site's chain is `$privateEnvironment` and its word keeps 64. The inner entry resolves against it            |
| Eval-local class with a nested eval                                                   | The chain is `[D.#y] → $privateEnvironment`, so the inner eval sees both                                              |
| Heritage `class I extends (r=eval("o.#o"),Object){#o=2}` inside O, which has `#o`     | Resolves to **O's** `#o`, which gives 1 [spec]. **V8 gives TypeError (D2)**                                           |
| A computed-key arrow inside I, called later                                           | Resolves to I's `#o`. An O instance gives TypeError [node]                                                            |
| Field `#x = eval('arguments')`                                                        | Word 103. The binder's arguments restriction gives a compile-time SyntaxError, before the private resolution          |
| Derived constructor `eval("this.#p")` before `super()`                                | ReferenceError from the lazy `this`, which is evaluated before the private key. After `super()` it gives 8            |

**Discrepancy D2 [node].** V8 v24.12 resolves a direct eval inside an inner class's
_heritage_ against the inner class's same-named private name. Without eval, or without the
inner name, it returns the outer value. The spec's note in 15.7.14 is explicit. Native fixtures
follow the spec, and the verifier skips the Node reference for that case, as it already does
for 3 and 26.

## 7. Exact edit list and census

1. `direct-eval-flags.ts`: bit 64, `64 ⇒ 1` in `directEvalCapabilitiesConsistent`, comment on 16.
2. `direct-eval.ts` and `global/index.ts`: `DirectEvalPrivateName`, the tenth site field,
   `resolveDirectEvalPrivateName` (§5.2).
3. `binding/index.ts`: context, deferral, `externalPrivateNames`, doc comment (§5.3).
4. `lowering/index.ts`: state, lookup fallback, site chain and bit, entry resolution, prologue
   field, `lowerDirectEvalScript` doc comment (§5.4). `runtime-imports.ts`: two names.
5. `script-evaluation.ts`: mask, bind context, comment (§5.5).
6. `privateNames: []` → `privateEnvironment: false` at `tools/verify-hosted-direct-eval-entry.ts:25`,
   `js-engine/test/script-compile.test.ts:310`, `direct-eval-lowering.test.ts:21,119`;
   `binding-eval-script.test.ts:15-21` takes a boolean; `verify-hosted-eval-context.ts` (§9).
7. Site literals gain `privateEnvironment: undefined`: `js-runtime/test/global-environment-direct-eval-site.test.ts:26`,
   `tools/verify-hosted-direct-eval-site.ts:35`, `verify-hosted-direct-eval-entry.ts` (3),
   `verify-hosted-managed-script.ts:207`.
8. Census pins, **edited only after measurement**: `runtime-surface.test.ts:54,56`;
   `tools/script-runtime-surface.test.ts:209, 252-253, 636, 376, 399-412`.
   - Registry-derived: surface 128, functions 105, types 23; generic functions 29, generic types
     11 and `roots` 29 unchanged (neither entry is generic).
   - Expected, unmeasured [assumption]: records +1 (`DirectEvalPrivateName`; the site changes
     layout, not count), signatures +1 (resolver), runtimes/anchors (79)/collections (39) +0.
     Record what is measured; never shape the implementation to these numbers.
9. Docs: parent §9 and this status line. **No backlog-table or status-table edits.**

## 8. Red-first Node tests (in this order; each starts red)

1. **`js-runtime/test/global-environment-direct-eval-site.test.ts`.** The resolver returns
   `undefined` for an `undefined` chain. Over `inner(#x) → outer(#x) → outer(#y)`, `#x` gives the
   inner identity, `#y` the outer one, and `#z` and `"x"` (no `#`) miss. The site literal has
   ten fields.
2. **`typescript/test/binding-eval-script.test.ts`**, mode true: `this.#x` → `["#x"]`;
   `#x in o; this.#x; o?.#y` → `["#x","#y"]`; `(class{#x;m(o){return o.#x}})` → `undefined`;
   `(class{#q;m(o){return o.#x+o.#q}})` → `["#x"]`; `(class extends (this.#x,Object){#x})` →
   `["#x"]`; `(class{[this.#x]=1;#x})` → `undefined`; `(class{m(){return this.#n}})` → `["#n"]`;
   `(class{#a;#a})` still DUPLICATE_NAME. Mode false: `this.#x` is INVALID_CONTEXT
   "undeclared private name: #x". Annex `{function g(){}}this.#x;g;` keeps one copy and
   `["#x"]`; empty contexts still match `bindScript`.
3. **`js-engine/test/eval-site.test.ts`.** Replace "private capabilities still defer site
   construction" (`:107-115`).
   - Words: 71 `class C{#x;m(){eval(x)}}`; 103 `class C{#x;x=eval(x)}` and `class C{#x=eval(x)}`;
     79 `class D extends B{#p;constructor(){eval(x);super()}}`; 71 `class C{#x;static{eval(x)}}`;
     67 `class C{#x;m(){(function(){eval(x)})()}}`; 71 `class C{#x;m(){({n(){eval(x)}})}}`;
     65 `class C{#x;static [eval(x)]=1}`. No bit 16; every argument is a ten-field site.
   - Chains: `class C{#a;#b;m(){eval(x)}}` has two links (site → second → first → `undefined`);
     `class O{#o;m(){class I{#i;n(){eval(x)}}}}` heads at I's `#i` with `outer` O's `#o`; an
     empty class has no links and word 7; `class O{#o;f(){class I extends (eval(x),Object){#i}}}`
     has heritage chain `[#o]` only.
   - No-eval identity: a private-heavy class (fields, methods, accessors, statics, static
     blocks, `#x in`) emits neither new name, and its import list equals that of the same source
     with every `#` member made public.
4. **`js-engine/test/direct-eval-lowering.test.ts`.**
   - Word 71, `this.#x; #x in this`: prologue has `$privateEnvironment` with its undefined
     return; the body has exactly **one** resolver call (`"#x"`) whose throw is
     `createRuntimeError($errors,"syntax")`, placed before the `instantiateDirectEvalDeclarations`
     check and the first body statement.
   - `(class{#x;m(o){return o.#x}})` under 71: zero resolver calls.
     `class D extends (this.#x,Object){#x=1}` under 71: the heritage reads the resolved temporary.
   - A nested candidate under 71 has bit 64; its chain heads at the local class link whose
     `outer` is `$privateEnvironment`, or is `$privateEnvironment` itself without local classes.
   - `this.#x` under 7 is EARLY_ERROR. Word 65 lowers `#x in {}`.
5. **`js-engine/test/script-evaluation.test.ts`.** Words 65, 71, 79 and 103 compile `this.#x`
   into one module. Words 64, 66 (no strict), 80 and 87 (64|16) stay sticky unsupported with no
   module (64 stays in `:754`). `this.#x` under 3 and 7 is an owning-realm SyntaxError with no
   module; `["#x in o", 2]` (`:777`) is unchanged.
6. Census pins (§7.8), measured. 7. Native fixtures (§9), built only after the DE5a controller.

## 9. Native acceptance (all: not built, not executed)

**AOT entry `tools/verify-hosted-direct-eval-entry.ts`** (exits 60-81 today). Add programs
`privateRead` (`this.#x;`, word 65) and `privateMissing` (`v=7;this.#y;`, word 65); build the
chain with `createPrivateName` and `addPrivateField`.

| Exit | Check                                                                                       |
| ---- | ------------------------------------------------------------------------------------------- |
| 82   | Chain `[n1 "#x"]`, `thisValue` has n1 = 42: `none`/42                                       |
| 83   | Chain `[n2 "#x"] → [n1 "#x"]`, object has only n1: `throw`, TypeError prototype (shadowing) |
| 84   | Same chain, object with n2: 42                                                              |
| 85   | `privateMissing`: `throw`, SyntaxError prototype, and `v` still 40 (no statement ran)       |
| 86   | Word 65 with `privateEnvironment: undefined`: `"unsupported"`, body not run                 |

**Site view `tools/verify-hosted-direct-eval-site.ts`** (exits 60-69). Exit 70: a two-link
site views to itself, `site.privateEnvironment.outer.name.description === "#b"`, and
`viewDirectEvalSite(site.privateEnvironment)` is `undefined`.

**Eval context `tools/verify-hosted-eval-context.ts`.** Exit 67: `this.#x` binds in mode true
with `["#x"]` and fails in mode false. Exit 69: the Annex pass in mode true. Exit 70: parity in
mode false.

**Host verifier `tools/verify-test262-native-direct-eval.ts`** (actual source, not the DE5a
draft numbering). 0-13 are DE4. 14 object method, 15 field, **16**
`class C{#m(){return eval("this.#m")}run(){…}}`, 17 derived `eval("1")`, 18 object `super.x`,
19 field `super.x`/`new.target`, 20 static block, 21 derived `this`/`super()`, 22 double super,
23 super key order, 24 field-arrow `arguments`, 25 sloppy leak, 26 static-block `arguments`
(Node skipped), **27** `class C{#x=42;m(){return eval("this.#x")}}`. Today 16 and 27 are
`unsupported` and all others `completed`. DE5b flips 16 and 27 to `completed` with sources
unchanged and appends (all `completed`; sources in `/tmp/tint-de5b-plan/cases.cjs`):

| #   | Shape                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------ |
| 28  | Brand: `C.g(new C())===1`; `C.g({})` TypeError                                                                     |
| 29  | Undeclared `#y` after `log.push(1)` and a heritage `log.push(2)`: SyntaxError, empty log                           |
| 30  | Undeclared `#nope` only in an uncalled eval-local method: SyntaxError, empty log                                   |
| 31  | Eval-local `class D{#m=2}` shadows: `[2,1]`, cross-brand TypeError                                                 |
| 32  | `eval("eval('this.#x')")===3`; eval-local class's nested eval reads outer + local = 7                              |
| 33  | Arrow and nested-function evals both read `#x` (sum 10)                                                            |
| 34  | Static method + getter = 13; getter-only write TypeError; `#x in` true/false                                       |
| 35  | **D2**: heritage eval resolves outer `#o` = 1; **Node reference skipped**                                          |
| 36  | Computed-key arrow resolves inner `#o` → TypeError; word-65 `K.false===1`                                          |
| 37  | GC: eval-made `()=>o.#x` survives 20,000 allocation iterations                                                     |
| 38  | Derived private field `#x=eval('…super.x')` = 9; private field `eval('arguments')` SyntaxError, `executed===false` |
| 39  | Derived constructor `eval("this.#p")`: ReferenceError before `super()`, 8 after                                    |
| 40  | Async `await 1; eval("this.#x")` = 4 (`asynchronous: true`)                                                        |

Exemption becomes `index !== 3 && index !== 26 && index !== 35`; async set `{11, 12, 40}`.
V8 passes 28-34 and 36-40 [node]. Run with `TINT_BUILD_ONLY=1` under LLDB per AGENTS.md,
asserting stop-at-entry and final exit; store a **new** immutable report. A new frozen
self-build is required (compiler source changes); stage identity expected [assumption].

## 10. Test262 (pinned; static census, non-native)

**Targets, 54 files** (unchanged from the parent census). `statements/class/elements` (33):
12 `private-{field,getter,setter,method}-visible-to-direct-eval{,-on-initializer}` and
`private-static-*-visible-to-direct-eval`; 6 `{,nested-,arrow-body-}private-direct-eval-err-contains-{arguments,newtarget}`;
9 `…private-derived-cls-direct-eval-err-contains-supercall{,-1,-2}`; 6
`…private-derived-cls-direct-eval-contains-superproperty-{1,2}`. `expressions/class/elements`:
the same 21 non-visibility files.

**Controls that must not move.** The 8 `statements/class/elements/privatename-not-valid-eval-earlyerr-{1..8}`
have no nonempty private environment at the call site (in -4, `D` is a sibling declared after
the eval and `C` has no names), so they are **DE5a-path** compile-time SyntaxErrors with bit 64
clear. The 7 `expressions/class/private-*-multiple-evaluations-of-class-{eval,direct-eval}`
declare the class inside eval from a caller without a private environment.

**Selections, unchanged:** `language/eval-code/direct` (286) and `language/expressions/super`
(94) as whole paths; the DE5a per-file element selections; the 54 + 15 files above as per-file
selections from one controller, against a fresh baseline taken from the DE5a snapshot after
its validation completes. `test262-native-run.ts` still takes one path per run; the whole
`class/elements` family (1,108) stays deferred. **Canaries:** host cases 16 and 27,
`private-field-visible-to-direct-eval.js`.

## 11. Validated versus assumed

**Validated.** [spec] EDI step order, the §16.1.1 exemption, resolution by description,
heritage under the outer environment, class strictness. [src] the single lookup point, empty
scopes, site and prologue patterns, the six option-A host literals, the injected `completion`
view, `$errors` as the evaluator realm, census pin locations. [probe] today's failures,
heritage/computed-key words, spellings. [node] cases 28-34 and 36-40, D2. The Test262 counts.

**Assumed, to observe natively.** (1) The native checker narrows `$valueN` after
`=== undefined … throw` when captured by eval-local closures (precedent `$site`/`$home`; DE5a is
not yet native). (2) The ten-field descriptor passes the view and rejection fixtures.
(3) Record and signature deltas. (4) Self-build stage identity.

## 12. Risks and non-goals

**Risks.** Every direct-eval site's bytes change with the descriptor; mixed-snapshot images
stay invalid, as after DE5a. Each eval call allocates O(visible names) links (accepted;
performance deferred). D2 can mislead fixture authors. The unsupported-before-SyntaxError
precedence of §4.

**Non-goals.** Decorators and auto-accessors (still failing in binder and `classValue`),
module-goal eval, caching, any new frame, host ABI or guard changes, full-suite runs.

## 13. Next focused planning recommendation

Once DE5b's Node gates pass and the serial controller has produced the DE5a native report, plan
the **DE5 native validation consolidation**: read that report against host cases 14-27 and AOT
exits 68-81, fold any native narrowing finding (assumption 1) into DE5b before its fixtures are
built, and define the single combined per-file Test262 controller selection from §10. No pass
forecast is made here.
