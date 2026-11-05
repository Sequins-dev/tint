# RT-EVAL S5-de DE3: `parseEvalScript` / `bindEvalScript` context entry points

Implementation status: the parser and binder context APIs, eight semantic test
groups and the native fixture are implemented. All 4,078 workspace tests pass.
The [native fixture](../results/native-eval-context-v1.json) passes on the exact
source frozen for the v10 full survey; see the [checkpoint](../results/eval-context-checkpoint-v1.json).
Direct string execution remains blocked. Further implementation is deferred
while the complete current-source Test262 run establishes the baseline.

Research status: **implemented plan; native self-build remains deferred.** Parents:
[direct environments](rt-eval-direct-environments.md) §6.3/§7 DE3 and
[site plumbing](rt-eval-site-plumbing.md) §6.1/§11. One implementation-ready commit inside
`@tint/typescript`; DE4 owns engine wiring (`lowerDirectEvalScript`, `createDirectEvaluator`,
the flag mapping call). Direct string eval stays sticky unsupported after DE3.

**Capture.** 2026-11-05, live source; DE2 in progress in main's tree.
`lowering/direct-eval-flags.ts` has the fixed bits (strict 1, inFunction 2, inMethod 4,
inDerivedConstructor 8, unsupportedCapability 16), and `invokeEvalCandidate`
(`js-engine/src/lowering/index.ts:658-720`) builds the six-field `DirectEvalSite`. The view passes
[native-direct-eval-site-v2](../results/native-direct-eval-site-v2.json); 4,060 workspace tests
pass; DE1: [checkpoint](../results/direct-eval-declarations-checkpoint-v1.json).

**Evidence.** **[spec]** ECMAScript 2027 draft (multipage), cached at
`/tmp/tint-eval-guard-plan/global.html` and `/tmp/tint-eval-context-plan/{scripts,functions,source}.html`.
**[src]** live source. **[probe]** read-only Node scripts in `/tmp/tint-eval-context-plan/`:
`probe.mjs` and `c4.mjs` over the built `typescript/dist` (timestamps equal `src`), and `v8.cjs`
plus `vm.runInThisContext` for real Script top level (Node v24.12.0). **[t262]** the pinned
`.tint-bootstrap/test262`, read as text, never run. **[unknown]** not observed. I ran no native
process and touched no queue, journal, report, snapshot, marker, catalog or active process.

## 1. Answer in brief

1. **No grammar change.** Eval code is `ParseText(sourceString, Script)` [spec]. The parser
   already has every switch: `strict` comes from the goal, and `superProperty`, `superCall`
   and `newTargetAllowed` (`parser.ts:249-252`) are closure-local and start false. DE3 seeds
   those four from a typed context. `return`, `break`/`continue`/labels, `await`, `yield`,
   `using`, `import`/`export` and HTML comments keep their Script defaults.
2. **The binder needs two seeds:** a pre-pushed private scope of the caller's visible names, and
   the initial `restrictedArguments` (`binding/index.ts:538-539`). `restrictedArguments`
   already matches ContainsArguments exactly, including arrows, methods and computed keys
   [probe, §5].
3. **Typed context objects, not numeric flags:** `@tint/typescript` cannot import `js-engine`
   (`workspace-contracts.json:12`). DE4 maps bits to fields in js-engine (§6.4).
4. **No new flag bit in DE3.** Fields, methods, private scopes and derived constructors carry
   bit 16 in DE2, so DE4 never parses them. DE3 still implements `superProperty`, `superCall`,
   `privateNames` and `fieldInitializer` so DE5 only flips lowering; DE5 adds
   `directEvalInFieldInitializer = 32` (additive; frozen DE4 images keep decoding 1–16).
5. **Strict callers use the existing `"strict-script"` goal**, which differs from `"script"` only
   in the initial `strict` (`parser.ts:249`); every strict-mode early error already fires [probe].
6. **First runnable step:** the red `packages/typescript/test/syntax-eval-script.test.ts` (§7.1).

## 2. Primary specification [spec]

**PerformEval (19.2.1.1)** for `direct-eval`:

- From `GetThisEnvironment()`: if it is a Function Environment Record, `inFunc = true`,
  `inMethod = HasSuperBinding()`, `inDerivedCtor` when `[[ConstructorKind]]` is derived, and
  `inClassFieldInitializer` when `[[ClassFieldInitializerName]]` is not empty.
- "In an implementation-defined order, possibly interleaving parsing and error detection":
  `ParseText(sourceString, Script)` (errors → SyntaxError); no ScriptBody → `undefined`; then
  SyntaxError when `!inFunc` and Contains NewTarget, `!inMethod` and Contains SuperProperty,
  `!inDerivedCtor` and Contains SuperCall, or `inClassFieldInitializer` and ContainsArguments.
- `strictEval = strictCaller || ScriptIsStrict(script)`.

**Script early errors (16.1.1), `ScriptBody : StatementList`.** `super` and NewTarget are errors
"unless the source text … is eval code that is being processed by a direct eval".
ContainsDuplicateLabels / UndefinedBreakTarget / UndefinedContinueTarget start from « », so
caller labels are invisible. AllPrivateIdentifiersValid with « » applies "unless … eval code …
processed by a direct eval". ContainsUsing is an error. Nothing admits `return` outside
`[+Return]`.

**Strict mode code (11.2.2).** "Eval code is strict mode code if it begins with a Directive
Prologue that contains a Use Strict Directive or if the call to eval is a direct eval that is
contained in strict mode code." So every strict-mode early error applies under `strictCaller`.
"All parts of a ClassDeclaration or a ClassExpression are strict mode code": every eval in a
field, method or static block is strict.

**EvalDeclarationInstantiation (19.2.1.4).** After the sloppy var-conflict walk and before the
global CanDeclare checks, it collects each `[[Description]]` on the PrivateEnvironment chain;
"If AllPrivateIdentifiersValid of body with argument privateIdentifiers is false, throw a
SyntaxError". A Description is a PrivateIdentifier StringValue, which **includes** `#`.

**ContainsArguments (15.7.9).** True for `IdentifierReference : arguments`; false for every
function, generator and async declaration or expression; for MethodDefinition and the
generator/async/accessor method forms, only ContainsArguments of the **ClassElementName**
(computed key). Everything else, arrows included, recurses. BindingIdentifiers do not count.

**ClassStaticBlockDefinitionEvaluation (15.7.11)** makes `bodyFunc` via `OrdinaryFunctionCreate`
and `MakeMethod` and does **not** set `[[ClassFieldInitializerName]]` (only 15.7.10 does). By the
text, a static-block `eval("arguments")` is not a PerformEval error; V8 throws (§5); no Test262
file covers it [t262]. That is R5, owned by DE5; DE3 must not decide it.

## 3. Script grammar versus function grammar (the DE3 rule table)

The eval body is always a Script. Only the four PerformEval facts and strictness come from the
caller. Columns: the rule; where it is enforced today; whether DE3 changes it.

| Rule (eval code)                                                                              | Enforced at                                                                                   | DE3                                                      |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `new.target` (also in arrows, arrow params, nested non-function code)                         | `newTargetAllowed` check `parser.ts:2134-2146`                                                | seed from `context.newTarget`                            |
| `super.x` / `super[x]`                                                                        | `superProperty` check `:2100-2105`                                                            | seed from `context.superProperty`                        |
| `super(...)`                                                                                  | `superCall && allowCalls` `:2093-2099`                                                        | seed from `context.superCall`                            |
| Nested `function`/generator/async: `new.target` ok, `super.*` reset                           | declaration `:3085-3095`, expression `:1517-1523`                                             | none (already save/restore)                              |
| Methods: `super.x` ok, `super()` only derived constructor; fields and static blocks reset too | `:1344-1355`, `functionExpression(method)`, `:1219-1256`, `:1432-1453`                        | none                                                     |
| `return`                                                                                      | `functions === 0` `:3451`                                                                     | none; stays an error even when `inFunction`              |
| `break` / `continue` / labels                                                                 | `loops`, `switches`, `labels` start at 0/[] (`:3462-3483`)                                    | none; caller loops and labels are invisible              |
| `await`                                                                                       | `reservedName` `:147-156`, `awaitContext = 0` for Script                                      | none; an identifier even inside async callers and strict |
| `yield`                                                                                       | `yieldContext = false`; reserved only when strict                                             | none; generator callers do not make it a keyword         |
| Static-block `await` ban                                                                      | `staticAwait` false at root                                                                   | none; `eval("var await")` is legal in a static block     |
| top-level `using`                                                                             | `(top && goal !== "module")` `:3017`                                                          | none; a block `using` stays legal                        |
| `import` / `export` declarations                                                              | `:2879`, `:2885`                                                                              | none                                                     |
| HTML-like comments                                                                            | scanner flag `goal !== "module"` `:173`                                                       | none; `"strict-script"` keeps them                       |
| strictness                                                                                    | `strict = goal !== "script"` `:249`; directives `:3533`; `take()` legacy checks `:353`        | `context.strict` selects `"strict-script"`               |
| `#x` validity                                                                                 | binder `checkPrivateName` `binding/index.ts:753-760`                                          | seed an outer private scope                              |
| ContainsArguments in a field initializer                                                      | binder `reference()` `:466-475` under `restrictedArguments`, reset by non-arrow `fn()` `:568` | seed root `restrictedArguments`                          |
| var/lexical conflicts with the caller                                                         | runtime EDI (DE1 `instantiateDirectEvalDeclarations`)                                         | none; not a parse or bind check                          |

## 4. Source facts this plan depends on [src]

- `parseScript`/`parseStrictScript` (`parser.ts:135-141`) wrap `parseSource(source,
"javascript", goal)`, goal `"module" | "strict-script" | "script"`. State is closure-local;
  `parserCheckpoint` (`:488-525`) saves and restores the three capability flags, so
  arrow-parameter probing cannot leak a seed.
- `bindScript` (`binding/index.ts:162-170`) calls `bindProgram` twice when Annex B copies
  exist: **the context must reach both calls.** It is exported inline; the `export {…}` block at
  `:1340` only re-exports `script.ts`, so the new names are inline exports too.
- `privateScopes` is read only by `checkPrivateName` (`.has`, `:753-760`); class bodies push
  their own map (`:731`) and masks matter only there, so a seeded scope may use value `0`.
- `lowerScriptEntry` (`lowering/index.ts:134-151`) calls `bindScript` itself and maps
  `INVALID_CONTEXT` → `EARLY_ERROR`; `createEntryEvaluator` turns that and parser
  `SYNTAX_ERROR`/`LEXICAL_ERROR` into `createRuntimeError(realm, "syntax")`, any other code into
  sticky unsupported (`script-evaluation.ts:186-201`). DE4 reuses both mappings.
- **No parser public-API census exists** (no test enumerates `syntax`/`binding` exports); the
  §7 `typeof` assertions stand in for parent §6.3's "census". The compiler catalog is
  file-based (`tools/generate-compiler-catalog.ts:4`) and DE3 adds no source file: **no
  catalog regeneration**.
- [probe `c4.mjs`] Parse and bind results contain no `Map`/`Set`, so §7's `JSON.stringify`
  identity comparisons are meaningful.

## 5. Probe results

**Tint today (`parseScript`/`bindScript`, built `dist`).**

| Source                                                     | Result today                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `new.target`, `() => new.target`, `(a=new.target)=>a`      | `SYNTAX_ERROR` (needs the seed)                               |
| `super.x`, `super()`                                       | `SYNTAX_ERROR` (needs the seed)                               |
| `return`, `break`, `continue`, `L:{break M}`               | `SYNTAX_ERROR`                                                |
| `await` (sloppy/strict), `var await=1;await`               | ok                                                            |
| `await 1`                                                  | `SYNTAX_ERROR`                                                |
| `yield`, `var yield=1`                                     | ok sloppy, `SYNTAX_ERROR` strict                              |
| `with(o){}`, `010`, `08`, `'\07'`, `'\8'`                  | ok sloppy, `SYNTAX_ERROR` strict                              |
| `var public`, `eval=1`, `delete x`, `function f(a,a){}`    | ok sloppy, `SYNTAX_ERROR` strict                              |
| `'\07'; 'use strict'`                                      | `SYNTAX_ERROR` sloppy (prologue retroactivity holds)          |
| `using x = null` / `{ using x = null; }`                   | `SYNTAX_ERROR` / ok                                           |
| `export default 1`, `import x from 'y'`                    | `SYNTAX_ERROR`                                                |
| `1 <!-- c`                                                 | ok                                                            |
| `this.#x`, `#x in o`                                       | parse ok; bind `INVALID_CONTEXT: undeclared private name: #x` |
| inside `class C{x=…}`: `()=>arguments`, `typeof arguments` | bind `INVALID_CONTEXT`                                        |
| same: `({arguments})`, `{[arguments]:1}`                   | bind `INVALID_CONTEXT`                                        |
| same: `class{[arguments](){}}`                             | bind `INVALID_CONTEXT`                                        |
| same: `function(){return arguments}`, `{m(){…arguments}}`  | bind ok                                                       |
| same: `{get a(){…}}`, `class{m(){…}}`                      | bind ok                                                       |

**V8 (Node 24.12)** agrees with the spec on every DE3 rule except the static block:

- Script top level (`vm`): `new.target`, its arrow form, `super.x` and the nested
  `eval("eval('new.target')")` throw SyntaxError (nested sites inherit the caller's facts).
  Function callers: `new.target` → `undefined`, `super.x` throws.
- Method: `super.x` works, also via an inner arrow; `super()` and an inner `function(){super.x}`
  throw. Derived constructor and its arrows: `super()` works; base constructor or inner function
  throws. `return`, `break`, `break L` throw.
- Async caller: `await 1` throws, `var await=3;await` → 3. Generator: `yield 1` throws,
  `var yield=4;yield` → 4. Strict callers reject `with`, `010`, `'\07'`, `var yield`,
  `var public`, allow `var await`.
- Field: `arguments`, `() => arguments`, `var arguments` throw; a nested function's `arguments`
  works; `new.target` → `undefined`; `super.x`, `this.#p` and an inner class reading outer `#p`
  work; unknown `#q` throws.
- **Static block: `eval("arguments")` → SyntaxError**, unlike the §2 spec text; `new.target` →
  `undefined`, `var await=9;await` → 9, `super.y` works. Top-level `using` throws, block `using`
  works, `1 <!-- c` → 1.

## 6. Contracts and exact edits (one commit)

### 6.1 `packages/typescript/src/syntax/parser.ts`

Add after `parseScript` (`:141`):

```ts
/** PerformEval facts that change eval-code early errors (ECMA-262 19.2.1.1).
 * Eval code is always Script grammar; the caller never admits return,
 * loop labels, await or yield. strict is strictCaller: directives may still
 * make eval code strict when it is false. */
export interface EvalScriptContext {
  readonly strict: boolean;
  readonly newTarget: boolean; // inFunction
  readonly superProperty: boolean; // inMethod
  readonly superCall: boolean; // inDerivedConstructor
}
/** Direct-eval Script goal with the caller's PerformEval context. */
export function parseEvalScript(
  source: SourceTextView,
  context: EvalScriptContext,
): Result<Module> {
  const goal = context.strict ? "strict-script" : "script";
  return parseSource(source, "javascript", goal, context);
}
```

`parseSource` gains a trailing `context: EvalScriptContext | undefined = undefined`. Replace
`:250-252` with:

```ts
let superProperty: boolean = context !== undefined && context.superProperty;
let superCall: boolean = context !== undefined && context.superCall;
let newTargetAllowed: boolean = context !== undefined && context.newTarget;
```

Nothing else changes: every function, class, static-block and checkpoint boundary already
saves and restores these flags. Explicit `boolean` annotations avoid literal-type widening in
the self-hosted checker; no `as`, `!` or `any` (`tools/boundaries.ts:137-145`).

### 6.2 `packages/typescript/src/syntax/index.ts`

Extend the parser export line to `export { parseModule, parseStrictScript, parseScript,
parseEvalScript, type EvalScriptContext } from "./parser.ts";` (the `type` modifier is already
used natively in this file, `type TokenScanner`).

### 6.3 `packages/typescript/src/binding/index.ts`

```ts
/** Caller facts visible to direct-eval binding (ECMA-262 19.2.1.1, 19.2.1.4).
 * privateNames are PrivateIdentifier StringValues, including '#', from the
 * caller's PrivateEnvironment chain. fieldInitializer makes ContainsArguments
 * an early error. */
export interface EvalBindingContext {
  readonly privateNames: readonly string[];
  readonly fieldInitializer: boolean;
}
export function bindScript(script: Module): BindingResult {
  return bindScriptProgram(script, undefined);
}
/** Bind direct-eval code: caller private names are visible and a field-initializer
 * caller forbids arguments references. */
export function bindEvalScript(
  script: Module,
  context: EvalBindingContext,
): BindingResult {
  return bindScriptProgram(script, context);
}
function bindScriptProgram(
  script: Module,
  context: EvalBindingContext | undefined,
): BindingResult {
  const initial = bindProgram(script, [], true, "script", false, [], context);
  if (!initial.ok) return initial;
  const copies = initial.value.annexFunctionCopies ?? [];
  return copies.length === 0
    ? initial
    : bindProgram(script, [], true, "script", false, copies, context);
}
```

Keep the existing doc comment of `bindScript` on the new wrapper. `bindProgram` gains a
trailing `evalContext: EvalBindingContext | undefined = undefined`, and `:538-539` become:

```ts
const privateScopes: { names: Map<string, number> }[] = [];
if (evalContext !== undefined && evalContext.privateNames.length !== 0) {
  const names = new Map<string, number>();
  for (const name of evalContext.privateNames) names.set(name, 0);
  privateScopes.push({ names }); // caller PrivateEnvironment; never declared into
}
let restrictedArguments: boolean =
  evalContext !== undefined && evalContext.fieldInitializer;
```

The loop avoids `new Map(list.map(...))` tuple inference in the self-hosted checker (untested,
so avoided). `fn()` already restores `restrictedArguments` and resets it for non-arrows; class
`finally` pops only its own scope, so the seed is never popped. `BindingError` codes are
unchanged: an invalid `#x` or field `arguments` stays `INVALID_CONTEXT` → SyntaxError.

**Ordering (intentionally spec-equivalent).** The spec checks private names in EDI after the
sloppy conflict walk; Tint rejects them at bind time. Both are SyntaxErrors in `evalRealm`
before any binding or user code, so only the message differs; both precede EDI's TypeErrors.

### 6.4 Flag mapping (specified here; **lands in DE4**, not DE3)

The DE4 code in `script-evaluation.ts` uses only the fixed bits:

```ts
if ((flags & directEvalUnsupportedCapability) !== 0)
  return rejectUnsupportedExecution(realm);
const parsed = parseEvalScript(createSourceTextView(source), {
  strict: (flags & directEvalStrict) !== 0,
  newTarget: (flags & directEvalInFunction) !== 0,
  superProperty: (flags & directEvalInMethod) !== 0, // always false until DE5
  superCall: (flags & directEvalInDerivedConstructor) !== 0, // always false until DE5
});
// bindEvalScript(…, { privateNames: [], fieldInitializer: false }) until DE5
```

The bit-16 check comes **before** the parse, so an unsupported site never reports a SyntaxError
that DE5 would reverse (e.g. `super.x` in a method must not throw under DE4).

### 6.5 What does not change

`parseScript`, `parseStrictScript`, `bindScript`, `bindStrictScript` and
`validateJavaScriptBindings` give identical results. No AST, visitor, rewrite, lowering, runtime,
vocabulary, surface, manifest, `workspace-contracts.json` or catalog change. The Test262 syntax
gate (`parseScript`, `parseModule`, `validateJavaScriptBindings`) is untouched.

## 7. Red-first tests (Node, `node:test`, source imports so no rebuild is needed while red)

### 7.1 `packages/typescript/test/syntax-eval-script.test.ts` (new)

The helper imports `* as api from "../src/syntax/index.ts"` and `createSourceTextView` from
`@tint/source/text`. It asserts `typeof api.parseEvalScript === "function"`; this is red first
and serves as the export census. Set `none = {strict:false,newTarget:false,superProperty:false,superCall:false}`
and `ctx(partial) = {...none, ...partial}`. Every rejection asserts
`error.code === "SYNTAX_ERROR"`.

1. **Each capability is gated by its own flag.** Each row is rejected under `none`, rejected
   with the other three flags all true, and accepted with its own flag alone:
   `new.target`, `() => new.target`, `(a = new.target) => a` (checkpoint probe) → `newTarget`;
   `super.x`, `super[k]`, `() => super.x` → `superProperty`; `super(1)`, `() => super()` →
   `superCall`. Bare `super` is rejected under every context.
2. **Function boundaries reset `super`, never `new.target`.** With all flags true,
   `(function(){ super.x })`, `(function*(){ super() })`, `async function f(){ super.x }` and
   `({ m(){ super() } })` are rejected. `({ m(){ return super.x } })`,
   `(function(){ return new.target })` and `class D extends B { constructor(){ super() } }` are
   accepted with all flags **and** under `none`.
3. **Script goal regardless of context.** With all four flags, and again plus `strict`:
   `return`, `return 1`, `break`, `continue`, `L: { break M }`, `await 1`, `using x = null`,
   `export default 1`, `import x from "y"` and `class C { static { await } }` are rejected;
   `var await = 1; await`, `{ using x = null; }` and `1 <!-- c` are accepted;
   `var yield = 1; yield` is accepted only without `strict`.
4. **The strict caller forces strict eval code.** Under `ctx({strict:true})`, `with(o){}`,
   `010`, `08`, `'\\07'`, `'\\8'`, `var public`, `var yield`, `var arguments`, `eval = 1`,
   `delete x` and `function f(a,a){}` are rejected; under `none` they are accepted with
   `value.strict === false`. `1` under strict has `value.strict === true`.
   `'use strict'; with(o){}` and `'\\07'; 'use strict'` are rejected under `none`.
5. **The empty context is the existing entry.** For a 12-source corpus (directives, classes,
   Annex B blocks, regexps, templates, an HTML comment, and failing sources),
   `JSON.stringify(parseEvalScript(s, none))` equals `JSON.stringify(parseScript(s))`, and
   `parseEvalScript(s, ctx({strict:true}))` equals `parseStrictScript(s)`. This pins "no
   grammar change".

### 7.2 `packages/typescript/test/binding-eval-script.test.ts` (new)

The helper parses with `parseScript`, or `parseStrictScript` when the case is strict, through
the `src` index. It asserts `typeof bindEvalScript === "function"`. `bindEval(text, names,
field)` returns the result.

1. **Caller private names.** `this.#x` and `#x in o` succeed with `["#x"]`. With `[]`, and with
   `["x"]` (the spelling must include `#`), they fail with `INVALID_CONTEXT`,
   `undeclared private name: #x`. `this.#y` with `["#x"]` fails.
   `(class { #q; m(o){ return o.#x + o.#q } })` with `["#x"]` succeeds (outer name visible in a
   nested class); `(class { #x; m(o){ return o.#x } })` succeeds with `[]`.
2. **Field initializer ContainsArguments** (`field = true`, strict parse). Rejected with
   `INVALID_CONTEXT`: `arguments`, `() => arguments`, `x => () => arguments`,
   `typeof arguments`, `({arguments})`, `({[arguments]: 1})`, `(class { [arguments](){} })`.
   Accepted: `(function(){ return arguments })`, `({ m(){ return arguments } })`,
   `({ get a(){ return arguments } })`, `(class { m(){ return arguments } })`,
   `function* g(){ arguments }`. With `field = false`, all are accepted.
3. **Both Annex B passes see the context.** The source
   `{ function g(){} } this.#x; g;` with `["#x"]` succeeds and
   `annexFunctionCopies.length === 1`. This is red if only the first `bindProgram` receives the
   context, because the second pass then fails `#x`.
4. **The empty context is `bindScript`.** For a corpus with annex copies, direct-eval owners,
   classes with private names, catch aliases and parameter expressions, assert
   `JSON.stringify(bindEvalScript(m, {privateNames: [], fieldInitializer: false}))` equals
   `JSON.stringify(bindScript(m))`.

### 7.3 Existing tests

No existing test changes. The relevant files must stay green unchanged:
`syntax-script-modes`, `binding-classes`, `binding-annex-functions`, `direct-eval-binding`,
`binding-syntax-validation`, `js-engine/test/eval-*.test.ts`, `script-evaluation.test.ts`
and `tools/test262-native-syntax.test.ts`.

## 8. Native fixture (portable parser and binder change)

**`tools/verify-hosted-eval-context.ts`** (new), modeled on `verify-hosted-script-modes.ts` and
`verify-hosted-private-syntax.ts`. Its modules are `syntax`, `binding` and `source`, with the
same mappings as `verify-hosted-private-syntax.ts:41-46`. It is a bespoke regression, not
conformance. It never evaluates eval code; it only parses and binds strings.

| Exit | Failed check                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------- |
| 1    | source construction failed                                                                            |
| 60   | `new.target` accepted under the empty context, or rejected with `newTarget`                           |
| 61   | `super.x` / `() => super.x` gating by `superProperty` wrong                                           |
| 62   | `super()` gating by `superCall` wrong, or `super.x` accepted with only `superCall`                    |
| 63   | `(function(){ super.x })` accepted with all flags (the function boundary did not reset)               |
| 64   | `(a = new.target) => a` result differs from §7.1 (checkpoint leak)                                    |
| 65   | `return`, `break`, `await 1` or `export default 1` accepted with all flags                            |
| 66   | strict context accepts `with(o){}` or `'\07'`, or `value.strict !== true`                             |
| 67   | the empty context changes `strict`, statement count or error code against `parseScript` on the corpus |
| 68   | `bindEvalScript` rejects `this.#x` with `["#x"]`, or accepts it with `[]`                             |
| 69   | a field context accepts `() => arguments`, or rejects `(function(){ return arguments })`              |
| 70   | the Annex B second pass loses the context (§7.2.3)                                                    |
| 42   | success                                                                                               |

**Command**, run in main's serial queue only after the active self-builds and conformance
controllers. Nothing is retried, and the manifest is kept:

```sh
pnpm build
TINT_BUILD_ONLY=1 TINT_KEEP_NATIVE=1 node tools/verify-hosted-eval-context.ts   # prints the image path; manifest beside it
# then run the printed image under main's LLDB containment (stop-at-entry asserted, exit 42 asserted),
# exactly as for native-direct-eval-site-v2.json, and record docs/results/native-eval-context-v1.json
```

[unknown] Native behavior of the seeded boolean captures in the self-hosted `parseSource` and
`bindProgram` closures (C1) is not claimed until this fixture passes.

## 9. Test262 mapping (unchanged files; which slice can pass them)

DE3 makes no Test262 file pass by itself, because direct string eval is still sticky. The
table shows which DE3 rule each early error depends on, and which slice enables the call site.

| Files ([t262], `test/language/…`)                                                                                                                        | Rule                                          | Enabled by |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------- |
| `eval-code/direct/new.target.js`, `new.target-arrow.js` (SyntaxError at Script/arrow top); `new.target-fn.js` (`undefined`, then the constructor)        | `newTarget` = bit 2                           | DE4        |
| `eval-code/direct/super-prop.js`, `super-prop-arrow.js`, `super-prop-dot-no-home.js`, `super-prop-expr-no-home.js`, `super-prop-expr-no-home-no-eval.js` | `superProperty` false                         | DE4        |
| `eval-code/direct/super-call.js`, `super-call-arrow.js`, `super-call-fn.js` (`executed` stays false)                                                     | `superCall` false                             | DE4        |
| `eval-code/direct/super-prop-method.js`, `super-call-method.js`                                                                                          | method site (bit 4, no 8)                     | DE5        |
| `eval-code/direct/parse-failure-1…6.js` (ASI `++`, `continue`, `break`, `return` in a function, `for(;false;)`)                                          | Script goal                                   | DE4        |
| `eval-code/direct/export.js`, `import.js`                                                                                                                | Script goal                                   | DE4        |
| `eval-code/direct/strict-caller-function-context.js`; `strict-caller-global.js` (`onlyStrict`, **negative phase runtime**)                               | `strict` = bit 1                              | DE4        |
| `eval-code/direct/strictness-override.js`                                                                                                                | eval-code directive                           | DE4        |
| `statements/class/elements/privatename-not-valid-eval-earlyerr-5,6,7,8.js`                                                                               | `privateNames: []`                            | DE4        |
| `…/privatename-not-valid-eval-earlyerr-1…4.js`, `private-*-visible-to-direct-eval*.js` (12 files)                                                        | `privateNames` seed                           | DE5        |
| `{statements,expressions}/class/elements/*direct-eval-err-contains-arguments.js` (6 + 6)                                                                 | `fieldInitializer`                            | DE5        |
| `…/*direct-eval-err-contains-newtarget.js` (allowed; `undefined`)                                                                                        | field `newTarget` true                        | DE5        |
| `…/*derived-cls-direct-eval-contains-superproperty-*.js`, `…-err-contains-supercall*.js`                                                                 | field `superProperty` true, `superCall` false | DE5        |

Note that `strict-caller-global.js` is a runtime-phase negative. The runner must execute it,
not treat it as parse-negative, as AGENTS.md requires.

## 10. Commit and gates

Commit: "typescript: add direct-eval parse and bind context entries".

1. Add the §7.1/§7.2 files; run
   `node --test packages/typescript/test/syntax-eval-script.test.ts packages/typescript/test/binding-eval-script.test.ts`
   and confirm both fail on the missing exports (inspect the exit status).
2. Make the §6.1–6.3 edits; rerun step 1 (green), then `node --test packages/typescript/test/*.test.ts`.
3. `pnpm build`, then `node --test packages/js-engine/test/*.test.ts tools/test262-native-syntax.test.ts`
   (downstream unchanged against fresh `dist`).
4. `pnpm check`. Expect 4,060 plus the new tests; measure, do not predict.
5. The §8 native fixture under LLDB; a new immutable report.
6. Frozen self-build and stage comparison: deferred to the DE4 batch per the DE0 precedent
   (no conformance effect). The parser is compiler source, so main may instead fold DE3 into the
   next scheduled self-build; record which.

## 11. Decisions, unknowns and risks

**Decided here:** typed contexts in `@tint/typescript`; `"strict-script"` for strict callers; no
grammar, AST or lowering change; field and private-name seeds land now, unused until DE5; no
new flag bit (DE5 adds 32); bit 16 rejects before the parse; private-name validity at bind time
(spec-equivalent, §6.3). **Resolved during research:** inline exports are correct (`:1340`
only re-exports `script.ts`); results contain no `Map`/`Set`, so JSON identity is valid.

| Id  | Unknown                                                                                               | Resolved by  | If it fails                                                         |
| --- | ----------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| C1  | Native self-compilation of the optional trailing parameters and seeded boolean captures               | §8 fixture   | pass `context` explicitly at every `parseSource`/`bindProgram` call |
| C2  | Static-block `eval("arguments")`: spec text allows it (§2), V8 throws, no Test262 file covers it (R5) | DE5 research | keep static blocks unsupported; never encode V8's behavior silently |

**Risks.** The parser is shared by the native self-host, so a regression changes every image;
§7.1.5/§7.2.4 identity tests and the unchanged syntax-gate tests guard it. DE4 must not reach
`bindScript` through `lowerScriptEntry` for direct eval: it needs a binding-context parameter
there, or the seeds are silently dropped.

**Non-goals:** module-goal eval; changes to indirect eval, `Function` or the guard; DE4 engine
wiring; DE5 class capabilities.

## 12. Next focused planning task (not started)

**DE4 entry plan.** Specify `lowerDirectEvalScript(script, sourceText, binding:
EvalBindingContext)` threading the binding context into `lowerScriptEntry` instead of
`bindScript`; `createDirectEvaluator(context, host)` with the §6.4 mapping; the
`ErrorRealm.directEvalCompiler` slot; and the capture-marker-gated Test262 adapter. Give exact
red tests and the N-DE4 native acceptance cases from parent §7. Research only.
