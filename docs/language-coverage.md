# Language coverage inventory

The active project goal is close to complete JavaScript/TypeScript language coverage,
with actual Test262 execution results comparable to established runtimes. The former
60-second compiler-build target is retired. Parser acceptance is not a conformance
pass. Comparisons must use the same pinned suite revision, test selection and variant
policy, and disclose unsupported, skipped, timed-out and failed cases alongside passes.

The pinned Test262 suite now has **100% native syntax validation**: all 94,565
valid variants are accepted and all 8,699 parse/early-negative variants rejected.
Test sources were never executed by that validation; behavior coverage is separate. The [coverage dashboard](test262.md)
owns measured results and limitations. Native Script execution includes classes,
iterators, generators, Promise jobs and async execution, with incomplete semantics
and APIs. Whole-suite native coverage has not yet been measured.

Initial audit: 2026-10-30; current status updated 2026-11-01. Historical probes below
are retained as historical evidence, not descriptions of current parser behavior.

## Baseline and evidence

Keep the existing **ECMAScript 2025 / TypeScript 6.0.3** baseline. The development
package pins TypeScript 6.0.3. The living ECMAScript draft and current Test262 main
include newer material; neither should silently expand the baseline.

Reference map:

- [ECMAScript 2025](https://262.ecma-international.org/16.0/): clauses 6–10 for values,
  abstract operations and object machinery; 12–16 for grammar and execution;
  18–28 for standard objects; Annex B for legacy web compatibility.
- [TypeScript type manipulation](https://www.typescriptlang.org/docs/handbook/2/types-from-types.html),
  [functions](https://www.typescriptlang.org/docs/handbook/2/functions.html),
  [classes](https://www.typescriptlang.org/docs/handbook/2/classes.html), and
  [6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html):
  documentation plus the pinned compiler's behavior are our practical TypeScript
  oracle. Do not treat an old TypeScript specification as a complete 6.0 definition.
- [Test262 execution contract](https://github.com/tc39/test262/blob/main/INTERPRETING.md)
  and [contribution rules](https://github.com/tc39/test262/blob/main/CONTRIBUTING.md):
  use a pinned revision when implementing the runner, not floating main.

Current implementation evidence comes from the syntax model/parser/lexer,
closure checker and type resolver, linker/specializer, closure/scalar lowering,
portable runtime packages, and their tests. The original scalar checker is a
smaller API; its restrictions do not describe the full compiler pipeline.
Package READMEs contain chronological additions and stale introductory claims.
Source and current tests take precedence over those claims.

The initial audit used Node parser/checker probes. Current native conformance
results and self-build evidence are maintained in the [coverage dashboard](test262.md)
and [bootstrap status](bootstrap.md); historical probes below are not current
completion claims.

Statuses below: **partial** means a useful implemented subset, never the entire
specification feature; **missing** means no general source-to-native path found;
**syntax only** means parsing does not establish execution support. An unsupported
feature is not an intentional strict-profile exclusion unless a named soundness
rule explains it. No feature family below is certified complete.

## JavaScript grammar and execution

Evidence: [syntax model](../packages/ts-syntax/src/model.ts),
[parser](../packages/ts-syntax/src/parser.ts),
[lexer](../packages/ts-syntax/src/lexer.ts),
[checker](../packages/ts-checker/src/closures.ts),
[lowering](../packages/ts-native/src/scalar.ts).

| Family                            | Current coverage                                                                                                                                                                                                                | Remaining work / boundaries                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source goals | TS/JS Module and directive-sensitive JS Script parsing; all 103,264 pinned native syntax variants validated (separate from behavior). | Remaining execution coverage and grammar beyond the pinned population; TS syntax must not leak into JavaScript acceptance. |
| Identifiers                       | Partial: Unicode 16.0 names, supplementary code points and Unicode escapes                                                                                                                                                      | Complete contextual-name and early-error rules.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Trivia and ASI                    | Partial: comments, hashbang, line terminators, ASI                                                                                                                                                                              | Full grammar-sensitive ASI/early-error matrix; Annex B behavior separately.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Number/string literals            | Partial: ordinary numeric forms/separators, quoted strings/escapes                                                                                                                                                              | Complete lexical edge matrix and legacy script forms. BigInt expressions/property names parse exactly and have initial native Script execution; BigInt literal types remain unsupported.                                                                                                                                                                                                                                                                                                 |
| Templates | Script substitutions, tagged calls and frozen cooked/raw caches; runtime-compiled tagged sites pass ten [native semantic checks](results/managed-template-feature-acceptance-v1.json). Typed primitive substitutions are supported. | The [complete unchanged tagged-template selection passes 48/48](results/test262-language-tagged-template-current-v1.json); typed tag calls and mixed-union substitutions remain separate. The per-entry code budget still applies. |
| RegExp literals                   | Partial: parser-directed lexical goals, shared pattern AST/validation, fresh runtime objects and native matching                                                                                                                | Case-sensitive matching, constructor, exec/test, source/flags accessors, captures/indices and lastIndex are native-fixture validated. Legacy/Unicode case folding is native-validated. General category/script/binary property matching is native-validated. Match/search/replace/split/matchAll symbol and String protocols pass native fixtures, including iterator state and realm checks. Unicode properties of strings remain missing. Test262 selections are still being measured. |
| Variables                         | Partial: let/const, initialization checks                                                                                                                                                                                       | var, full hoisting/global declaration rules, general definite assignment and binding patterns.                                                                                                                                                                                                                                                                                                                                                                                           |
| Functions                         | Partial: declarations, named/anonymous Script expressions, arrows, recursion, closures, explicit receivers                                                                                                                      | Typed named-expression lowering, contextual receiver inference, arguments and remaining call/apply/bind coverage; typed new.target.                                                                                                                                                                                                                                                                                                                                                      |
| Parameters                        | Script: identifier rest, defaults, omission, unmapped arguments and callable lengths; typed: contextual/default parameters                                                                                                      | Destructuring parameters, typed rest layouts and remaining parameter-environment edge cases.                                                                                                                                                                                                                                                                                                                                                                                             |
| Arithmetic/comparison             | Partial: numeric operations, coercing Script operators, Script exponentiation (fractional powers implemented; native regression queued)                                                                                         | Typed exponentiation, exotic coercion and broader BigInt conformance.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Assignments                       | Partial: simple/numeric updates and primitive local logical assignments                                                                                                                                                         | General logical-assignment targets/types, property-reference semantics and destructuring assignment.                                                                                                                                                                                                                                                                                                                                                                                     |
| Logical/nullish/conditional/comma | Partial: implemented checked representations                                                                                                                                                                                    | General values, coercion effects and abrupt completions across every representation.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Optional chains                   | Script: member/index/call chains, grouped receivers, delete, private access and super method calls; typed profile has checked lowering                                                                                          | Spread arguments, tagged templates, async/generator dependencies and remaining typed-profile edge cases.                                                                                                                                                                                                                                                                                                                                                                                 |
| Object literals                   | Script: fixed/dynamic computed keys, shorthand, methods, accessors, prototype setters and spread; typed: fixed fields and ordered spread                                                                                        | Super home objects, symbol keys and typed dynamic/accessor/prototype layouts.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Array literals                    | Partial: dense/sparse literals and supported array spread                                                                                                                                                                       | Arbitrary iterable spread and generic array object behavior.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Destructuring                     | Script object declarations, parameters, catch bindings, assignments and loop heads; flat array iteration bindings with defaults/elisions/rest                                                                                   | Nested array patterns and general array declarations/assignments/parameters; broader typed-profile support.                                                                                                                                                                                                                                                                                                                                                                              |
| Loops and switch                  | Script while/do/for, for-in/for-of/for-await-of, switch/fallthrough, labelled break/continue and per-iteration lexical environments                                                                                             | Annex B labelled functions and broader typed-profile integration.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| For-of                            | Script: custom synchronous iterators, declaration/assignment heads, recursive object/array patterns/defaults/rest, labelled jumps, per-iteration lexical environments and IteratorClose; typed profile has selected collections | Async iteration and broader typed-profile integration.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Exceptions                        | Partial: throw, catch unknown, finally and completion routing                                                                                                                                                                   | Complete Error objects, all implicit runtime exceptions and dynamic thrown values.                                                                                                                                                                                                                                                                                                                                                                                                       |
| in / instanceof                   | Script: ordinary property membership and ordinary/bound function prototype checks; typed profile remains limited                                                                                                                | Proxy capabilities, private-field membership and broader typed-profile integration.                                                                                                                                                                                                                                                                                                                                                                                                      |
| this/super/delete                 | Partial: typed this; Script receivers, delete and method super properties                                                                                                                                                       | Super argument spread, strict-profile class receivers and contextual inference.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Classes                           | Partial: base/derived constructors and super calls, public/private fields, private brand checks, static blocks, public/private methods and accessors in native Scripts                                                          | Strict-profile class typing/linking, super argument spread and typed new.target.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Generators | Source declarations/expressions/methods, native suspension, yield/yield*, suspended cleanup and general constructed generator/async-generator bodies. | Broader unchanged conformance and typed-profile integration; see [generator implementation](generators.md). |
| Async functions/iteration | Native Promise jobs, async functions/generators/arrows, await, for-await, delegation and asynchronous module evaluation. | Complete iteration and function-family reruns remain separate obligations; strict-profile Promise typing remains limited. See [async integration](async-runtime.md). |
| eval / Function constructor | Native Script evaluation, indirect/direct string eval, class/private caller context and general bodies for all four constructor kinds; [code loading](native-code-loading.md). | Complete unchanged-family reruns, remaining entry-profile limits and code/arena budgets. Runtime template checks are separate from whole-family conformance. |
| with / legacy grammar | Sloppy native object environments, unscopables, call receivers, closures and generator suspension; strict code rejects with. Direct eval retains caller scopes. | Proxy-backed environments and broader unchanged conformance; Annex B declarations have native binding/copy regressions. |

## Runtime semantics and built-ins

The runtime currently implements selected operations on checked representations.
A method name recognized by the checker is not a complete standard prototype method.
For example, it does not imply arbitrary receivers, prototype overrides, coercing
arguments, reflective property descriptors or subclass behavior.

Evidence: [intrinsic recognition](../packages/ts-checker/src/closures.ts),
[record lowering tests](../packages/ts-native/test/closure-records.test.ts),
[native construction fixtures](../tools/verify-construction.ts),
[primitive values](../packages/native-runtime/src/values/index.ts), and
[host surface](runtime-host-surface.md).

| Family                               | Current coverage                                                                                                                                                                                                                                                                                                                                                                                            | Remaining work / boundaries                                                                                                                                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Values                               | Partial: primitives, finite unions, references, unknown storage                                                                                                                                                                                                                                                                                                                                             | Fully general dynamic values; remaining BigInt intrinsics and symbol protocols; annotation violations must not authorize fixed layouts in live mode.                                                                                                                             |
| Conversion/equality                  | Script string/number/default-hint conversion with Symbol.toPrimitive, equality, arithmetic/order, updates and Number/Boolean/String/Symbol wrappers                                                                                                                                                                                                                                                         | Date default-hint behavior and remaining wrapper APIs; Intl formatting is separate.                                                                                                                                                                                              |
| Ordinary objects                     | Script: string/symbol descriptors, prototypes, accessors, extensibility, arrays and mapped arguments; typed structural records remain separate                                                                                                                                                                                                                                                              | Additional exotic internal methods and broader integration between profiles.                                                                                                                                                                                                     |
| Object/Reflect/Proxy                 | Shared ordinary/exotic dispatch; Object and Reflect property/prototype/integrity APIs, Object entries/values/fromEntries/groupBy, assign, hasOwn and getOwnPropertyDescriptors; Object.prototype coercion, membership and legacy accessor methods; Proxy traps, revocation, invariant validation, call/construct forwarding and proxy-aware array detection                                                 | Broader native Proxy/Reflect conformance, cross-realm behavior and remaining Object APIs.                                                                                                                                                                                        |
| Function objects                     | Script call/construct distinction, metadata, prototypes, call/apply/bind, restricted accessors and shared function-realm lookup through bound/Proxy targets                                                                                                                                                                                                                                                 | Dynamic Function compilation and broader conformance; source stringification passes 150/160 variants.                                                                                                                                                                            |
| Number/Boolean/Math                  | Partial: selected conversions, predicates, min/max/ceil/floor/trunc/abs/sign; hypot/fround/f16round/sumPrecise pass complete native selections; cube roots, exponentials and logarithms pass native fixtures ([algorithms](math-runtime.md))                                                                                                                                                                | Full constructors/prototypes and Math operations, coercion/arity/error matrices.                                                                                                                                                                                                 |
| Strings                              | Strict lowering: UTF-16 storage, code-point iteration, character access, concat/trim/repeat/padding, slice/substring/split/search. Live intrinsics include raw, fromCodePoint, fromCharCode, charAt/charCodeAt, slice/substring/substr, indexOf/lastIndexOf, startsWith/endsWith/includes, trim aliases, concat/repeat/padStart/padEnd, at/codePointAt and isWellFormed/toWellFormed with generic coercion. | Port remaining strict operations to live prototype methods with generic coercion; Unicode 17 default casing passes four native regression cases; [Unicode 17 normalization](string-normalization.md) is implemented with native corpus validation; locale formatting and broader native conformance remain. Annex B HTML helpers pass four native regression cases. |
| Arrays                               | Partial: checked array storage/methods; Script map/filter/forEach/every/some, find/findLast families, reduce/reduceRight, indexOf/lastIndexOf/includes, push/pop/shift/unshift/splice/join, at/slice/reverse/stable sort/fill/copyWithin/concat/flat/flatMap; toReversed/toSorted/toSpliced/with and values/keys/entries; Array.from/of; Symbol.unscopables                                                 | Generic property semantics, species, length descriptors, missing methods/overloads.                                                                                                                                                                                              |
| Typed arrays/buffers                 | Live ArrayBuffer lifecycle; DataView integer/float/BigInt accessors; TypedArray constructors, indexed properties, resizing, iteration and collection/search/copying/sorting methods ([scope](typed-arrays.md))                                                                                                                                                                                              | SharedArrayBuffer single-agent API 208/208 passes; shared view integration and immutable-buffer APIs implemented. Broader view conformance, locale formatting, blocking Atomics and agents remain.                                                                               |
| Map/Set                              | Partial: checked layouts plus live Map construction, arbitrary keys, mutation-aware iterators, forEach, groupBy and upsert; live Set basic APIs and all seven algebra methods implemented                                                                                                                                                                                                                   | Set native validation and complete-selection conformance.                                                                                                                                                                                                                        |
| Errors                               | Native exception transport, Error family constructors/prototypes, cause and AggregateError                                                                                                                                                                                                                                                                                                                  | Broader constructor/coercion/descriptor matrices and correct realm selection for implicit failures.                                                                                                                                                                              |
| JSON / Date / RegExp                 | Complete JSON family passes 332/332 Test262 variants; see [JSON runtime](json-runtime.md). Partial native RegExp syntax and matching/intrinsics; see [RegExp runtime](regexp.md)                                                                                                                                                                                                                            | Date APIs and remaining RegExp execution/string integration.                                                                                                                                                                                                                     |
| Symbol / BigInt                      | Script Symbols; BigInt literals, arithmetic, updates, comparison, conversions, boxing, constructor, valueOf, radix toString, fixed-width conversions and non-Intl decimal toLocaleString                                                                                                                                                                                                                    | Broader BigInt conformance and Intl formatting; remaining well-known-symbol consumers.                                                                                                                                                                                           |
| Promise / jobs                       | Native resolution/thenables, reactions, then/catch/finally, resolve/reject, all/race/allSettled/any/withResolvers and shared-agent jobs                                                                                                                                                                                                                                                                     | Broader conformance and remaining APIs; see [async runtime](async-runtime.md).                                                                                                                                                                                                   |
| WeakMap/WeakSet/WeakRef/finalization | Missing                                                                                                                                                                                                                                                                                                                                                                                                     | Weak reachability/ephemerons, kept-alive jobs and nondeterministic cleanup integration.                                                                                                                                                                                          |
| SharedArrayBuffer/Atomics            | SharedArrayBuffer 208/208 native single-agent API variants pass; stable native shared blocks and shared views implemented. Non-waiting [Atomics](atomics.md) implemented; full-family run pending                                                                                                                                                                                                           | Agents, synchronization and memory-model semantics.                                                                                                                                                                                                                              |
| Standard iterator objects/helpers    | Shared protocol; Iterator base/from; eager consumers and lazy helpers. Includes/join, chunks/windows, concat and disposal pass native regressions.                                                                                                                                                                                                                                                          | Complete Iterator-family selection is in progress.                                                                                                                                                                                                                               |
| Globals/realms                       | Native Script globals/globalThis, realm-local intrinsics, shared agent/symbol registry, Test262 createRealm host, parseInt/parseFloat and coercing isNaN/isFinite                                                                                                                                                                                                                                           | Dynamic eval/evalScript and broader cross-realm conformance; URI globals pass all six native regression cases, including malformed UTF8 and lone surrogates.                                                                                                                     |
| Intl                                 | Time-zone primary-name enumeration through supportedValuesOf; native timezone database and identity policy                                                                                                                                                                                                                                                                                                  | Other enumeration data and locale-formatting constructors remain pending. ECMA-402 results are measured separately.                                                                                                                                                              |
| TextEncoder/Decoder, files, clocks   | Selected host support                                                                                                                                                                                                                                                                                                                                                                                       | Separate standards/host contracts; not evidence of ECMAScript built-in conformance.                                                                                                                                                                                              |

## Modules

The typed-source [linker](../packages/ts-native/) supports closed graphs,
identity-preserving imports/re-exports, specialization and instance evaluation.
The ECMAScript module host now builds on `@tint/js-runtime/modules` and shared
JavaScript lowering, using the same native compiler pipeline. Static linking,
loading, evaluation and source-module lowering pass
[native fixtures](results/module-source-native-validation-v1.json),
[host acceptance](results/module-host-native-validation-v1.json) and
[the frozen self-build](results/bootstrap-module-source-v1.json).
The [first unchanged Test262 module](results/test262-module-eval-this-native-v1.json)
passes. The complete [namespace group](results/test262-module-namespace-native-v1.json)
passes 38/38 and [ambiguous-export group](results/test262-module-ambiguous-export-bindings-native-v1.json)
passes 9/10, with one unsupported source-phase import. Broad module conformance remains unmeasured.

| Area | Coverage / next obligations |
| --- | --- |
| Named imports/re-exports | Identity, ambiguity, cycles and normalized namespace re-exports implemented; ambiguous-export selection passes 9/10 (one unsupported proposal). |
| Evaluation | Loading/linking, synchronous and asynchronous SCC evaluation, cached errors and Promise jobs are implemented; see the top-level-await evidence below. |
| Default exports | ECMAScript default declarations, expressions, classes and live named bindings implemented and exercised natively; typed-source profiles remain separate. |
| Namespace imports/exports | Live namespace objects, TDZ, immutable import bindings, sorted keys and identity exercised by native fixtures; the unchanged 38-variant namespace selection passes. |
| Live bindings | Importers share exporter cells; writes to imported names throw before TDZ checks. |
| Module dynamic import / import.meta | Implemented with [native lowered-module and host evidence](results/dynamic-import-host-native-validation-v1.json); [24/24 targeted unchanged variants pass](results/dynamic-import-module-selection-acceptance-v1.json), with static-module regressions preserved and the [combined frozen fixed point](results/bootstrap-dynamic-import-v1.json) passing. |
| Script-root dynamic import | The retained [complete 1,900-variant report](results/test262-script-dynamic-import-directory-v1.json) has 1,559 passes and 341 unsupported cases. Later bare-specifier, eval, fixture-binding, JSON and async-cycle fixes have focused unchanged-source evidence; they are not merged into that older total. The current complete rerun remains pending. |
| Top-level await | Asynchronous module evaluation and bounded nested continuation loops are implemented; the [complete unchanged selection passes 253/253](results/test262-language-module-top-level-await-bounded-v2.json), with [native compiler acceptance](results/json-await-native-compiler-acceptance-v1.json). |
| Attributes and non-JS modules | JSON modules and import attributes have native host/self-build evidence and [completed unchanged selections](results/json-await-language-checkpoints-v2.json): 12/17 static imports, 13/13 module-code attributes and 42/44 dynamic attributes. Remaining cases in these selections require text-module proposals; source/defer/text/bytes are separate gaps. |
| CommonJS and package resolution | Host/tooling scope, distinct from core ECMAScript and TypeScript source compatibility. |

## TypeScript coverage

Evidence: [type syntax](../packages/ts-syntax/src/model.ts),
[type resolution](../packages/ts-checker/src/interfaces.ts),
[closure checking](../packages/ts-checker/src/closures.ts),
[specialization](../packages/ts-native/), and
[type-system tests](../packages/ts-checker/test/interfaces.test.ts).

| Family                                    | Current coverage                                                                                                                                                                                                    | Remaining work                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Basic types/literals/arrays               | Partial                                                                                                                                                                                                             | Full inference/widening/contextual typing; any must be a live-mode capability, not a fixed-layout proof.                              |
| unknown/never                             | Partial                                                                                                                                                                                                             | Full flow/exhaustiveness behavior and unrestricted dynamic-value operations after guards.                                             |
| Records/interfaces/aliases                | Partial: recursion, generic types, inheritance, methods, readonly/optional fields, single call/construct signatures                                                                                                 | Overloaded and index signatures, declaration merging, full structural compatibility.                                                  |
| Unions/intersections                      | Partial: finite variants, discriminants, structural intersections                                                                                                                                                   | General intersection normalization and inference; separate representation support from type acceptance.                               |
| Indexed access                            | Partial: supported object/union/array keys                                                                                                                                                                          | Full key types, index signatures, generic relationships.                                                                              |
| Tuples                                    | Missing                                                                                                                                                                                                             | Optional/rest/variadic/labeled/readonly tuples and contextual inference.                                                              |
| Generics                                  | Partial: explicit concrete specialization, including some nested helpers                                                                                                                                            | Argument inference, constraints/defaults, generic arrows/values, checking template bodies independently of instantiated uses.         |
| keyof / type-position typeof              | Missing                                                                                                                                                                                                             | Property-key algebra and value-to-type lookup. Runtime typeof does not implement type queries.                                        |
| Conditional/mapped/template literal types | Missing                                                                                                                                                                                                             | infer, distribution, key remapping, recursive evaluation and explicit complexity limits.                                              |
| Utility types                             | No general standard library coverage                                                                                                                                                                                | Implement underlying type operators; avoid hardcoding every utility alias.                                                            |
| Function typing                           | Partial: explicit/contextual signatures, receiver contracts and closure contracts                                                                                                                                   | Overloads, generic signatures, rest tuples and complete variance/inference rules.                                                     |
| Assertions                                | Missing syntax for as/angle assertions, as const and non-null assertions                                                                                                                                            | Safe strict assertions require proof; live assertions erase without changing JS behavior.                                             |
| satisfies                                 | Partial: checked constraints, erased native expressions, fresh object/array inference and specialization                                                                                                            | Remaining contextual inference, mutable-reference widening constraints and unsupported type forms.                                    |
| Predicates/assertion signatures           | Missing                                                                                                                                                                                                             | Live typing compatibility; strict trust policy remains explicit, never assume a user annotation proves a fact.                        |
| Classes and modifiers                     | Partial: class AST and typed member syntax; base classes execute through Script lowering                                                                                                                            | Strict-profile class typing/linking, public/private/protected/abstract/override, parameter properties and definite-assignment checks. |
| Enums/namespaces                          | Missing                                                                                                                                                                                                             | Runtime emission and merging semantics, const-enum policy.                                                                            |
| Ambient declarations/augmentation         | Missing                                                                                                                                                                                                             | Declaration-file consumption, module augmentation, namespaces and external boundary validation.                                       |
| Decorators                                | Missing                                                                                                                                                                                                             | Separate standard-style and legacy TS configurations; metadata is not implicitly core JS.                                             |
| JSX/TSX                                   | Missing                                                                                                                                                                                                             | Parsing/transform configuration and runtime-library contract.                                                                         |
| using / await using                       | Parsed; synchronous lexical and loop-header disposal has native regressions, including generator cleanup. Async lexical disposal is under native validation. Strict-profile source declarations remain unsupported. | TS syntax/emission plus disposal protocols, cleanup order and suppression; track standard edition separately.                         |
| TS module forms                           | Partial                                                                                                                                                                                                             | import types/qualified names, import-equals/export-equals and resolution-specific semantics.                                          |

Most of these omissions are implementation gaps, not soundness requirements. In
particular, tuples, keyof, mapped types, inference, safe assertions and satisfies
are useful to strict mode too. Adding richer types need not force generic runtime
storage. Conversely, whole-program compilation cannot make arbitrary casts,
external inputs or mutable aliasing sound merely because declarations are visible.

## Historical audit probes and incomplete-coverage risks

The initial audit (before the implementation updates below) invoked parseModule(createSourceText(UTF8(source))) and, on parser
success, checkClosureModule. These are frontend probes, not native execution claims.

| Representative source                                                               | Observed result                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `const café = 1;`, template literal, `/x/`, `1n`                                    | Parser rejection.                                                                          |
| `const x = [1,,2];`, quoted object key, object method                               | Parser rejection.                                                                          |
| Function expression, var, ordinary object destructuring, rest parameter             | Parser rejection.                                                                          |
| `x ** 2`, `x \|\|= 1`                                                               | Parser rejection.                                                                          |
| `x as number`, satisfies, tuple, keyof, mapped/conditional type, generic constraint | Parser rejection.                                                                          |
| Class, enum, namespace, using, async function, default function export              | Parser rejection.                                                                          |
| Typed `x?.a`, fixed-object spread, catch unknown                                    | Parser and closure checker accept. Existing lowering/native fixtures cover selected cases. |
| `"a" in x`                                                                          | Parser accepts; checker rejects with UNSUPPORTED.                                          |
| `x instanceof TypeError`                                                            | Parser/checker accept special intrinsic; arbitrary constructors remain unsupported.        |
| Arrow capturing a classic-for let binding                                           | Frontend accepts; per-iteration lifetime requires a targeted native behavioral audit.      |

High-priority follow-up investigations (not all are confirmed wrong-code bugs):

1. **Captured loop bindings.** Closure lowering explicitly rejects captured simple
   for-of bindings with an environment. Inspect classic-for and Map destructuring
   paths too; one shared cell is not a valid replacement for per-iteration bindings.
   Test arrays of closures returning distinct iteration values, break/continue,
   mutation in the update expression and GC between calls.
2. **Observable property operations.** Existing record/spread tests preserve closed
   shapes and optional absence. Add adversarial tests for wider aliases, overwrite
   timing and future getters/prototypes before generalizing to dynamic objects.
3. **Builtin contracts.** Inventory each supported method's receiver, argument,
   result and exceptional cases. Test extra/missing arguments, undefined, NaN/-0,
   holes, mutation during callbacks and coercion ordering. Strict rejections must
   remain distinct from incorrect results on accepted input.
4. **Early errors versus unsupported syntax.** Rejection of valid unsupported JS
   must never pass a negative Test262 test merely because both reject. Parameter
   duplication, lexical conflicts, await/yield context and directive rules need
   explicit JS-goal checks.
5. **Runtime exceptions versus compiler traps.** Invalid program operations need the
   specified catchable exception in compatible mode. Allocation/invariant traps are
   not substitutes for TypeError/ReferenceError behavior.
6. **Type facts across effects.** Preserve current effect invalidation tests; add
   alias writes, callbacks and future accessors. Live annotations alone must never
   suppress checks. Semantic IR proof origins are useful infrastructure, not proof
   that a complete live runtime exists.

## Implementation slice reference

Use the [implementation goal](implementation-goal.md) for current priorities and
completion criteria, and the [Test262 dashboard](test262.md) for measured gaps.
The original dependency inventory below is architectural background, not a queue
of unimplemented features or a current progress report.

Each slice should include syntax, checking/profile policy, semantic operations,
lowering, native behavior tests and an explicit remaining-gap list.

1. **Coverage ledger and frontend goal contract.** Introduce stable feature IDs and
   structured unsupported reasons; distinguish JS Script, JS Module and TS Module.
   Add differential positive/negative frontend fixtures and audit captured loops.
   These are prerequisites for trustworthy upstream conformance results.
2. **Low-dependency strict-language expansion.** Unicode identifiers, function
   expressions, literal property keys, exponentiation/logical assignment and
   ordinary destructuring in separate vertical slices. Destructuring must use the
   right property/iteration contracts, not a universal array-index rewrite.
3. **Shared object/reference and conversion core.** Complete explicit receiver,
   property-key, get/set/has/delete and completion semantics in semantic IR. Fixed
   records use proved fast paths; dynamic objects use general operations. Then add
   methods/accessors, this, prototype behavior and reflective built-ins.
4. **Iteration and calls.** Standard iterator objects, IteratorClose, parameter/rest
   handling and spread. Reuse these for arrays, collections and destructuring.
5. **Richer static types.** Tuples, keyof/type queries, generic inference and
   constraints, then mapped/conditional/template types. Develop alongside runtime
   slices because most add no new execution machinery.
6. **ESM and compatible native execution.** Realm/global environment, full module
   bindings/namespaces, dynamic value fallback and native runtime compilation.
   Extend classes and standard libraries against these shared semantics.
7. **Suspension and advanced runtime families.** Generators, Promise/jobs, async,
   weak APIs and shared memory as separately verified projects. Regex/JSON/Date can
   be independent library projects once their value/object contracts exist.

Do not wait for all of these to begin importing conformance cases. Do not describe
strict-profile tests as a substitute for compatible-mode JavaScript conformance.

## Test262 adoption plan

First build a read-only manifest from a pinned Test262 revision: test path, spec
reference, features, flags, includes, negative expectation and fixture dependencies.
Retain source bytes and upstream provenance. Track post-2025/proposal, Annex B and
Intl selections explicitly. Feature tags alone are not a complete dependency map.

The runner must respect Script/Module goals, strict/sloppy variants, raw sources,
ordered harness includes, fresh realms, module fixtures, asynchronous completion,
and expected error phase/type. Unsupported harness capabilities are recorded as
blocked, not passes. Start with frontend tests, then native scalar/control tests,
then broaden through object/collection/module families. Test262's execution rules
are specified in [INTERPRETING.md](https://github.com/tc39/test262/blob/main/INTERPRETING.md).

Suggested independent contracts:

- Manifest reader: metadata and selection, no compiler dependencies.
- Case planner: source goal, variants, harness and module graph requirements.
- Compiler adapter: compile/resolve/execute outcomes with phase and error identity.
- Native host adapter: realm/global hooks, print, later jobs/agents/buffer controls.
- Reporter: stable JSON records and regression comparison, no semantic decisions.

Keep upstream cases unchanged except runner-prescribed transformations. A TS-typed
rewrite is a useful derived regression but must not count as the original Test262
case passing. A compiler abort or arbitrary unsupported diagnostic must not satisfy
an expected JavaScript SyntaxError. Test execution should be isolated with time and
memory limits; use the existing debugger/crash-report suppression arrangement for
native failures on macOS.

Record revision, feature, variant, profile, goal, compiler build, optimization mode,
expected/actual phase and error, duration, and outcome. Outcomes should distinguish
pass, semantic failure, unsupported syntax/type/lowering/runtime, missing harness,
intentional strict rejection, timeout, crash, and excluded scope. Report both the
full selected denominator and runnable subset; never hide skipped cases in a
headline pass rate. Unexpected passes should trigger removal of stale exclusions.

Keep three complementary suites: unchanged Test262 for JavaScript; TypeScript
6.0.3 differential acceptance/type fixtures; Tint strict-profile soundness and
representation regressions. Run accepted runtime fixtures with optimization off
and on, and eventually through both AOT and live compilation. No Test262 run or
coverage percentage is claimed by this inventory.

## Incremental implementation: literal property names (2026-10-31)

Object literals and property signatures now accept quoted keys and numeric keys.
Quoted keys use decoded strings; numeric spellings normalize through Number-to-string
conversion, so hexadecimal/exponent/separator spellings identify the same property.
Literal keys cannot be shorthand. Explicit `__proto__` setters remain explicitly
unsupported; general prototype semantics are still missing. Computed keys and
fixed-record string-index access remain separate work.

Tests cover parsing, decoded names, modifiers, malformed shorthand, numeric
normalization and quoted-key record lowering. The frozen quoted-properties
self-build snapshot deliberately uses quoted keys inside the parser's own record
construction. This does not imply full object-literal or descriptor conformance.

The quoted-properties snapshot completed a native self-build with exit 0. Its
30,735,082-byte debug output matches the Node-built output for the same frozen
sources and debug directory byte-for-byte. Numeric property names and the later
prototype-setter rejection have portable checks but are not part of that snapshot.

The subsequent literal-properties snapshot (numeric keys and prototype-setter
rejection included) also self-built with exit 0 and byte-identical 30,735,082-byte
stage-one/stage-two debug binaries. Logs: `/tmp/tint-literal-properties-bootstrap.log`
and `/tmp/tint-literal-properties-selfbuild.log`.

The captured-loop follow-up found `copyIterationCells` and `perIteration` metadata
already present for owned classic-for closures. A new lowering regression passes;
the behavioral native regression now passes, retaining iteration values 0 and 1
after the loop. Its success image exits 0; its exhausted image reaches the expected
allocation trap under LLDB. The construction runner had stale SHA-256 fixture setup
after compression moved to a separate module. Those fixtures now use actual module
linking and instance initialization; success and exhaustion validation passed.

## JavaScript module goal and anonymous functions (2026-10-31)

`parseModule(source, "javascript")` now selects JavaScript module grammar within
our supported syntax subset. The default remains TypeScript. JavaScript mode
rejects TypeScript-only declarations, annotations, type parameters and type-only
imports/exports. `f<T>(x)` retains JavaScript relational-expression parsing rather
than acquiring TypeScript generic-call semantics. Script/sloppy goals and complete
early errors remain pending. The JavaScript-module snapshot completed a native
self-build with byte-identical 30,751,690-byte stage-one/stage-two outputs.

Anonymous ordinary function expressions now have a distinct AST kind and share
callable binding, contextual checking and closure lowering. Named expressions,
generators, receivers/arguments and constructor semantics remain uncovered.
The parser's property-name helper uses an ordinary anonymous function so future
self-builds exercise this syntax and capture path. Its native validation is pending.

The migrated SHA-256/signature fixtures and captured-loop fixture passed 48 native
runs under LLDB: both success and exhaustion images twice for all 12 cases. The
ordinary-function variant of the loop fixture is a subsequent change and still
needs its native run. Workspace checks also pass before that subsequent adoption.

## Object methods and strict Script parsing (2026-10-31)

Simple object methods and interface method signatures now parse and lower through
contextual callable contracts. Method syntax is retained in AST metadata; getters,
setters, computed names, generators and receiver/super behavior remain missing.
`@tint/key-index` now uses method syntax for its returned operations. This source
snapshot self-built with byte-identical 30,801,322-byte debug outputs. Anonymous
functions separately self-built with byte-identical 30,768,298-byte outputs and
passed four native closure success/exhaustion runs.

`parseStrictScript(source)` is an explicit ECMAScript strict Script syntax entry
point. It rejects static imports/exports and permits ordinary `await` identifiers
outside async functions, unlike Module grammar. It does not implement sloppy Script
semantics, a global execution environment, or a general Script host. Script runtime
and Test262 harness integration remain separate tasks.

## Logical assignments, literal inference and diagnostic contracts

`&&=` and `||=` now execute conditionally for present primitive locals (number,
string and boolean). They preserve skipped RHS behavior and merge type facts
rather than treating a conditional write as unconditional. Four native success/
exhaustion runs pass for the side-effect fixture. `??=` additionally supports
optional primitive locals. Its native tests cover skipped effects, undefined,
negative zero, NaN, empty strings and false. General property targets and arbitrary
nullable unions remain pending. `@tint/scalar-ir` uses `??=` to initialize its cached
layout analysis. The nullish-assignment snapshot self-built with byte-identical
30,917,562-byte debug binaries.

Unannotated const primitive literals and conditional trees of primitive literals
now preserve literal types and finite unions. Let initializers retain widening.
This is not yet complete TypeScript freshness/contextual inference. The scalar
checker's selected primitive contract now relies on this inference in real source.

Unsupported syntax diagnostics carry optional stable feature IDs for templates,
Unicode identifiers, BigInt, named/generator functions and prototype setters.
Module loading preserves the full syntax diagnostic. IDs identify the blocker;
they do not certify that the rest of unsupported source is valid JavaScript.
The ledger is intentionally incomplete until remaining reject paths are classified.

## Callable AST and union field refinements (2026-10-31)

Ordinary function expressions and arrows have separate discriminated AST branches;
ordinary functions require block bodies in the public type contract. Readonly
optional fields now narrow across object unions when every variant declares the
field readonly. Calls still invalidate observed field facts; writable variants
remain conservatively rejected. Nested member paths are not fully narrowed yet;
rewriting binds the body to a local before discriminating it.

All 1,278 workspace tests passed for this slice. Its native self-build exited zero
and produced byte-identical 30,934,170-byte debug outputs. Logs:
`/tmp/tint-contract-check5.log`, `/tmp/tint-contract-selfbuild.log`.

## No-substitution template literals (2026-10-31)

Untagged templates without substitutions now share quoted-string escape decoding,
normalize CR/CRLF to LF, support multiline text and preserve cooked UTF-16. Tokens
remain distinct from quoted strings, and string AST nodes retain a template marker.
Template tokens cannot stand in for import specifiers or literal property names.
The compiler CLI uses a multiline template for usage text. Tagged templates and
substitutions remain explicit unsupported diagnostics; raw template objects and
invalid cooked escapes in tagged forms remain future work.

The static-template snapshot self-built with byte-identical 30,967,194-byte debug
outputs. Its native construction test exits zero and the exhausted variant stops
at the expected allocator trap. A stage-two compiler also built the combined
literal-key/method/anonymous-function closure smoke: its output matches Node's
1,255,194-byte output and exits with the expected status 42 under LLDB.

## Test262 syntax inventory and early errors (2026-10-31)

[The syntax inventory adapter](test262.md) records source modes, metadata, source
hashes and diagnostics without claiming execution or conformance passes. It has
already supplied regression cases for strict `eval`/`arguments` bindings and
assignment/update targets, default parameters with own use-strict directives, and
classic-for initializer grammar's `In` parameter. Type-only names and property
names remain distinct from runtime binding restrictions. Escaped strings and
no-substitution templates do not become use-strict directives.

## Escaped identifiers and native string/number operations (2026-10-31)

ASCII identifier characters may now be written with Unicode escapes, including
code-point escapes. Tokens retain an escaped marker so escaped keyword spellings
cannot become keyword syntax; property IdentifierNames can still use them. Unicode
escape decoding is shared with strings. Non-ASCII identifier tables remain missing.
The escaped-identifiers snapshot self-built with byte-identical 31,050,202-byte
debug outputs; the static-template native fixture also exercises an escaped local.

String `endsWith`, `indexOf` and `lastIndexOf` now lower through the existing UTF-16
prefix comparison primitive. Forward/reverse search share one loop implementation;
position clamping is shared. Tests cover empty needles, absent/NaN/infinite/fractional
positions, surrogate code units and receiver/argument evaluation order. The native
success/exhaustion tests pass. These checked contracts currently require a string
search value and optional numeric position; general JavaScript coercion, RegExp
rejection and unrestricted arity adaptation remain uncovered. The compiler CLI uses
`endsWith` for path separators. The suffix and search snapshots self-built with
byte-identical outputs of 31,116,634 and 31,116,538 bytes respectively.

`Number.isNaN` shares non-coercing predicate lowering for numeric, optional,
primitive-union and general values. Optional absence is distinguished from actual
NaN. Native tests cover nonnumeric inputs and evaluation effects; the numeric
formatter and binary float encoder now use the intrinsic. The isNaN snapshot
self-built with byte-identical 31,133,146-byte debug outputs. Calls currently require
one argument; complete JavaScript argument adaptation remains future work.

## Record property updates (2026-10-31)

Prefix/postfix numeric updates and arithmetic/bitwise compound assignments now
support mutable numeric fields in checked records. The receiver is evaluated once,
the old value is read before the RHS, and the write uses the saved receiver even
when the RHS rebinds the original local. Readonly, optional and literal-only numeric
contracts remain rejected where the resulting write cannot satisfy the declared
type. The UTF-8 decoder uses `state.seen++` as real compiler/runtime adoption.
Native success/exhaustion regressions pass; the property-updates snapshot self-built
with byte-identical 31,166,170-byte outputs.

`&&=` and `||=` also support present primitive record fields through the same
short-circuit helper used for local bindings. Native tests verify skipped RHS
side effects and single receiver evaluation, plus regressions for local assignments.
`??=` for optional primitive fields is being validated separately. Array/indexed
updates, general dynamic properties/accessors, and arbitrary union contracts remain
uncovered.

The logical-property slice passed all 1,298 workspace tests and four native
success/exhaustion runs covering both property and local short-circuit assignments.
The nullish-property slice subsequently passed all 1,299 workspace tests and its
native success image, including optional strings/booleans and NaN/-0 retention;
its exhaustion image and self-build are still pending at this checkpoint.

The nullish-property snapshot self-built with byte-identical 31,232,618-byte debug
outputs; success and exhaustion tests both passed. The prior logical-property
snapshot likewise matched byte-for-byte at 31,215,978 bytes.

## Literal bracket access and computed names (2026-10-31)

Literal string/number bracket keys now use the same record contracts as named
member access. Reads, assignments, numeric updates, logical assignments and optional
chains are covered by portable and native regressions. Numeric spellings normalize
to the same key as object literal property names. Unknown/dynamic keys and readonly
writes remain rejected. The literal-index snapshot self-built with byte-identical
31,298,762-byte debug outputs.

Object literals, methods and type/interface property signatures also accept
computed literal names. Computed metadata distinguishes `["__proto__"]` as an
ordinary data field from the still-unsupported prototype setter syntax. A small
syntax literals module provides shared normalization, independent of tree rewriting.
Dynamic computed property names remain explicitly unsupported with their own
feature identifier. Structural widening to a view containing optional fields absent
from an existing fixed record remains restricted; fresh record construction can
materialize the required representation.

Computed literal declarations passed portable checks and native success/exhaustion
runs, including `__proto__` data fields. The computed-literals snapshot self-built
with byte-identical 31,397,850-byte debug outputs. Signed numeric computed keys now
normalize negative zero and grouped numeric literals as well.

Bracket access additionally recognizes singleton string/number key types, including
const-inferred keys, literal-typed parameters and literal-returning function calls.
The shared checker/lowerer key-resolution contract does not erase key evaluation.
Native regressions verify key effects occur before the field read and that optional
chains skip key calls for absent receivers. Arbitrary string keys and finite unions
of multiple keys are not implemented yet.

The singleton-key snapshot passed 1,308 workspace tests and native success/exhaustion
regressions, then self-built with byte-identical 31,430,970-byte debug outputs.

## String character access (2026-10-31)

`charAt`, `at` and `codePointAt` now accept absent/undefined or numeric positions.
The first two return single UTF-16 code units; `at` supports negative offsets and
returns undefined outside the string, whereas `charAt` returns an empty string.
`codePointAt` combines valid surrogate pairs and preserves unpaired surrogate code
units, returning undefined outside the string. These use existing scalar operations
and string kernels rather than introducing separate machine-code implementations.
The native hosted text regression covers boundary indices, NaN/infinities,
fractional truncation, surrogate boundaries and evaluation order.

The number formatter now uses `charAt`; the UTF-8 encoder uses `codePointAt` while
retaining replacement of unpaired surrogates. General receiver/index coercions,
method extraction and excess argument semantics remain outside this strict slice.
Semantics reference: [ECMAScript string methods](https://tc39.es/ecma262/multipage/text-processing.html).
The hosted text fixture's outdated GC metadata capacity was corrected to meet the
copying collector's forwarding-table requirement, and it now executes under LLDB
with stop-at-entry to avoid macOS crash-report windows.

The character-access snapshot self-built with byte-identical 31,480,602-byte debug
outputs. The code-point snapshot, including the UTF-8 encoder adoption, passed
1,310 workspace tests and self-built with byte-identical 31,546,746-byte outputs.

`substring` now clamps both indices, defaults an absent end to the string length,
and swaps reversed bounds. It shares index normalization and slicing with existing
methods; end-bound normalization is also reused by `endsWith`. The lexer adopts
`substring` for numeric token text and `charAt` for single-character punctuation.
Native hosted tests cover bounds, UTF-16 halves and argument evaluation order.

`Math.trunc`, `Math.abs`, and `Math.sign` accept numeric arguments through existing
numeric IR. Native tests cover signed zero, NaN, infinities, fractional values and
single argument evaluation. Number formatting uses `Math.abs` for exponent
magnitudes. Full coercion and arbitrary argument counts remain pending.

The substring slice passed 1,311 workspace tests and self-built with byte-identical
31,596,378-byte debug outputs. The Math slice passed native numeric regressions and
all 1,312 workspace tests; its native self-build is in progress.

The Math snapshot self-built with byte-identical 31,629,690-byte debug outputs.
Numeric string bracket access now returns optional UTF-16 units, rejects writes,
and distinguishes fractional/NaN indices from truncating string methods. Optional
chains skip index effects. Its 1,314-test snapshot self-built byte-for-byte at
31,695,834 bytes. String-keyed generic property access remains pending.

String `for…of` now yields code-point strings, sharing surrogate handling with
`codePointAt`. Native regressions cover empty strings, lone surrogates, iterable
evaluation once, break/continue, and escaping per-iteration closures. Encoding-label
normalization uses this feature. This is a specialization for primitive strings,
not an implementation of general user-modifiable iterator protocols.

The string-iteration snapshot passed 1,316 workspace tests and self-built with
byte-identical 31,729,130-byte debug outputs. `Math.imul` passed 256 deterministic
full-width product comparisons against Node and its snapshot self-built at
31,762,154 bytes. `Math.clz32` passed all 32 power-of-two boundaries and 256 sampled
words against Node; the 1,318-test snapshot self-built at 31,778,666 bytes.
`Math.round` preserves negative zero and avoids the double-rounding error from
adding 0.5; its 1,319-test snapshot self-built at 31,795,370 bytes.

`Math.sqrt` now has numeric IR, constant folding and direct AArch64 FSQRT output.
The optional independent LLVM assembler/disassembler check passed 1,016 encodings,
and native tests compare finite extremes, subnormals, signed zero and exceptional
values with Node. The compiler constant folder uses the new operation.

Standard global `NaN`/`Infinity`, Number numeric constants and Math constants now
use shared checked constant resolution, replacing the bespoke MAX_SAFE_INTEGER
intrinsic. Local bindings take precedence; writes and unknown members are rejected.
The number parser uses the named globals. Linker/audit/test host global allowlists
were updated alongside the checker.

## Unicode identifier coverage (2026-10-31)

`@tint/unicode-identifiers` provides independently reusable Unicode 16.0 ID_Start
and ID_Continue queries. Checked-in tables derive from a checksum-pinned official
Unicode source and carry its license. Normal builds require no download. All
1,114,112 code points are compared with the matching Node Unicode implementation.
The lexer retains its ASCII scan path, decodes raw supplementary code points and
escapes, adds ECMAScript join controls, and preserves spelling without normalization.
Native regressions distinguish composed/decomposed names and mix escaped/raw
supplementary identifiers; the standard constant resolver uses a local π binding.

The refreshed Test262 syntax inventory is
`.tint-bootstrap/test262-language-syntax-unicode.json`. It still executes no tests
and makes no conformance claim; many identifier tests encounter another unsupported
statement form before their declarations can be checked.

The numeric-constants snapshot self-built byte-for-byte at 31,845,002 bytes. The
Unicode snapshot passed 1,327 workspace tests and self-built byte-for-byte at
32,225,258 bytes.

## Function-scoped variables and discarded values (2026-10-31)

`var` declarations now hoist across blocks and loop headers to their function or
module scope. Redeclarations share storage, including parameter/function bindings;
an uninitialized redeclaration does not reset an existing value. Captured `var`
loop bindings share one cell, while lexical loop bindings retain their distinct
per-iteration cells. Native tests exercise both behaviors, initialization before
declaration, optional values, primitive redeclaration inference and empty loops.
The Unicode range search adopts `var` to exercise this in the compiler itself.
The snapshot self-built byte-for-byte at 32,556,730 bytes.

This remains a strict-profile subset: nonoptional reads require definite-assignment
proof; complex forward inference may require annotations. A `var` redeclaration of
a catch parameter remains explicitly unsupported because its initializer and
hoisted declaration require different bindings. General sloppy-mode semantics are
not implemented. The refreshed Test262 syntax inventory is
`.tint-bootstrap/test262-language-syntax-var.json`; parsing alone does not perform
all binding early errors and this report still executes no tests.

Unary `void` now evaluates its operand, preserves effects and exceptions, and
produces `undefined`, including when the operand is a void-returning call. Native
binding regressions and the complete workspace checks passed.

## Trimming and optional calls (2026-10-31)

`trim`, `trimStart`, and `trimEnd` now scan with existing character-access and
control-flow IR, then use the existing string-slice operation. Their whitespace
set follows [ECMAScript 2025 TrimString](https://262.ecma-international.org/16.0/index.html#sec-trimstring).
Native comparisons cover every Node-recognized whitespace character and neighboring
non-whitespace characters, empty/all-whitespace input, supplementary characters,
lone surrogates and single receiver evaluation. The strict profile accepts string
receivers and no arguments; borrowed generic receivers and surplus arguments
remain outside this slice. The numeric parser replaces its own whitespace scanner
with `trim`. All 1,336 workspace tests passed and the snapshot self-built
byte-for-byte at 32,622,778 bytes.

Optional string method receivers now share the chain lowering used for property
reads: arguments are skipped with absent receivers, and live results can continue
through further calls or property reads. Native tests cover string, numeric and
array-valued results. Parentheses still terminate the chain; ordinary undefined
results are not silently treated as a skipped chain.

Optional managed callbacks (`callback?.(args)`) and function-valued record methods
now use the same native chain path. Tests cover skipped arguments, live evaluation
order, void callbacks, exceptions and a callable returned by another optional
call. Syntax rewrite hooks use optional calls with `??` fallback in compiler code;
that snapshot self-built byte-for-byte at 32,688,826 bytes.

The chain path also supports the existing typed-array, array, Map and Set builtin
methods. Live collection encodings flow through receiver/result metadata rather
than being inferred from the full optional union. Optional typed-array receivers
unwrap to their actual element encoding, fixing direct optional length/index
access too. Native collection regressions passed twice under interactive LLDB;
all 1,341 workspace tests passed. General `this`-dependent receivers, arbitrary
builtin extraction, and null-containing optional chains still need further work.

During verification, LLDB intermittently failed to attach before program entry,
including to an older smoke binary. Such runs are failures, not test passes;
interactive stop-at-entry launches supplied the native execution evidence above.

The collection-enabled compiler self-built byte-for-byte at 32,688,826 bytes.
Optional chains on nullable primitive strings now remove both null and undefined
from the live contract. The native path reuses the nullish predicate used by `??`
and extracts the proven string after the guard. Empty strings remain live; native
regressions passed twice. Nullable references to objects and functions still need
an encoding that preserves null separately from undefined.

`String.prototype.concat` accepts zero or more string arguments in the strict
profile, evaluates receiver/arguments in order, and supports optional receivers.
It shares concatenation emission with binary `+`, code-point construction and
array joining. Native fixtures passed twice, including surrogate pairs and skipped
argument effects. Number formatting adopts `concat`; all 1,343 workspace tests
passed for that snapshot. Arbitrary JavaScript argument coercion remains pending.

The concat/nullable-string snapshot self-built byte-for-byte at 32,722,042 bytes.
Array and typed-array `.at()` now normalize integer indices, resolve negative
positions from the current length, and return undefined outside the valid range.
Native comparisons cover all four supported typed-array encodings, numeric/string/
record arrays, readonly arrays, empty inputs, optional receivers and evaluation
order when the index expression grows the array. Both native runs and all 1,344
workspace tests passed. The AArch64 source-range collector and module-linking stack
now use `.at(-1)`.

The `.at()` snapshot self-built byte-for-byte at 32,771,690 bytes. Builtin range
checks for `String.fromCodePoint`, typed-array `set`, and array splice length
validation now create and throw `RangeError` through the existing exception path
instead of terminating with a compiler trap. Native tests passed twice for invalid
code points, same/cross-element typed-array copies, unchanged destinations, eager
argument evaluation and `finally` during propagation. All 1,344 workspace tests
passed. The older construction harness's standard-global allowlists were updated
for the number parser's `NaN` and `Infinity` use; seven code-point modes build.

The construction harness also now checks an uncaught exception's ABI status before
mapping it to its expected invalid-input termination. Previously it assumed every
invalid input trapped inside the callee and ignored returned exception status.
Catchable error identity is verified separately by the hosted range-error fixture.

The range-error snapshot self-built byte-for-byte at 32,837,738 bytes.
`String.repeat` now normalizes numeric counts, rejects negative/infinite counts
and oversized results with catchable RangeErrors, and uses repeated doubling
through the ordinary string IR. The shared maximumStringLength contract is
2,147,483,628 UTF-16 units, matching the existing align16(24 + 2 * length) uint32
allocation constraint. This representational limit is separate from available
heap capacity. Native comparisons passed twice for fractional/NaN counts, empty
strings, huge finite counts on empty input, surrogate halves, argument ordering
and optional chains. Number formatting uses `repeat` for zero padding; all 1,345
workspace tests passed.

The repeat snapshot self-built byte-for-byte at 32,903,786 bytes. The updated
uncaught-error construction fixture reaches the expected harness trap after
checking exception status; the valid code-point construction fixture exits zero.
Numeric arrays and the four supported numeric typed arrays now share the existing
join loop and shortest-decimal formatter. Undefined elements and holes produce
empty fields; separators retain their optional string contract. Numeric native
checks cover signed zero, NaN, infinities, subnormals and finite extremes against
Node. All 1,346 workspace tests passed. Object-element coercion remains pending.

Mutable arrays now support `.length` assignment, prefix/postfix updates and
numeric/logical compound assignments. Shrinking deletes truncated elements;
growing creates holes without allocating every absent element. Invalid lengths
throw RangeError before mutation, while assignment expressions preserve their
original numeric result (including negative zero). Readonly arrays and typed-array
length writes remain rejected. Native regressions passed twice, all 1,348 tests
passed, and the compiler adopted `stack.length--` in module linking. This snapshot
self-built byte-for-byte at 33,036,170 bytes.

Array and numeric typed-array `reverse()` now return the original receiver and
swap elements in place. Ordinary arrays preserve the distinction between holes
and present undefined values using the runtime presence/deletion contracts.
Native tests passed twice for empty/odd/even lengths, all four typed-array
encodings, aliases, record identity, sparse numeric/string arrays, optional
receivers, NaN and negative zero. All 1,351 workspace tests passed. This is the
strict-profile array model; generic borrowed receivers, inherited indexed
properties, proxies and detached/resizable buffers remain outside this coverage.
See [ECMAScript reverse](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.reverse).

String `padStart`/`padEnd` now accept optional numeric lengths and optional string
fillers, default to spaces, and truncate repeated fillers by UTF-16 code units.
They share the checked repetition loop with `repeat`; oversized nonempty padding
throws RangeError, while empty fillers return the input. Native Node comparisons
passed twice. Number formatting adopts both methods; all 1,352 workspace tests
passed and the snapshot self-built byte-for-byte at 33,201,562 bytes.
See [StringPad](https://tc39.es/ecma262/multipage/text-processing.html#sec-stringpad).

Ordinary arrays now support typed `fill` with optional relative bounds, including
holes, undefined elements and shared object references. Typed-array `fill` now
also accepts explicit undefined bounds. Relative-bound normalization is shared
with array slicing and typed-array subarrays. Native comparisons passed twice
before and after replacing the number-list truncation loop with typed-array fill.
All 1,355 tests passed at that checkpoint. General coercion and borrowed generic
receivers remain pending.

Effect-free indexed reads now preserve reconstructed short-circuit narrowing
facts, matching ordinary member reads in the strict profile. Effectful receivers
or keys still invalidate unsafe facts. Returning-disjunction and continuing-
conjunction regressions cover this distinction; all 1,357 workspace tests passed.

The fill/indexed-guard compiler snapshot self-built byte-for-byte at 33,185,050
bytes. Singleton computed `"length"` reads now work for arrays, typed arrays and
strings, including readonly/optional receivers. Native checks passed twice for
key evaluation order, skipped optional keys, key expressions that resize the
receiver, UTF-16 lengths and the indexed-guard fallthrough regression. All 1,359
workspace tests passed. Arbitrary string-key indexing remains outside this slice.

Typed-array `slice` now copies a normalized relative range into independent
storage, using the same element-copy loop as typed-array constructors and
cross-encoding `set`. Native Node comparisons passed twice for all four encodings,
empty/reversed ranges, explicit undefined bounds, offset views, buffer identity,
argument effects, optional receivers and NaN/negative-zero payloads. The bit-vector
copy helper now uses `slice`; all 1,360 workspace tests passed. The adopted compiler
self-built byte-for-byte at 33,234,714 bytes. Species constructors, detached or
resizable buffers and unsupported typed-array encodings remain pending.

Array `shift`/`unshift` now preserve sparse indexed properties and element identity,
return the removed element/new length, and evaluate arguments before moving values.
They share the presence-aware copying primitive with `splice`. Native fixtures
passed twice for empty arrays, holes versus present undefined, strings, records,
negative zero, optional calls and effectful arguments. All 1,362 workspace tests
passed. These operate on the strict-profile mutable array representation, not
arbitrary borrowed array-like receivers.

The shift/unshift compiler snapshot self-built byte-for-byte at 33,300,858 bytes.
TypeScript `satisfies` now has an explicit typed AST node at relational precedence.
Binding/rewrite/link/specialization traverse its expression and constraint;
native lowering erases the check after validation. Fresh objects retain inferred
field types with contextual checking, including contextual boolean literals.
Checks reject missing/excess/mismatched fields and validate chained constraints.
Native tests passed twice for single evaluation, erased direct/closure calls,
alias identity, optional-chain values and const literal inference. Closure layout
construction adopts `satisfies CellLayout`; its compiler snapshot self-built
byte-for-byte at 33,515,514 bytes. A differential suite compares supported cases
against the pinned TypeScript checker, including imported aliases and specialization
in separate linker tests. This remains a strict-profile subset: richer nested
contextual inference and constraints requiring mutable-reference widening need
further work; unsupported type forms retain their existing diagnostics.
See [TypeScript satisfies](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator).

Nonempty `satisfies` arrays retain their inferred mutable element types, including
under readonly constraints. Empty arrays infer `never[]`; the checked contract
forbids inserting values, and the existing numeric list carrier represents holes.
Native tests passed twice for mutation of inferred string arrays and hole-only
empty-array operations. All 1,371 workspace tests passed; the array-enabled
compiler self-built byte-for-byte at 33,532,122 bytes.

Fresh nested object/array literals now carry separate contextual-validation
witnesses, so checking a wider contract does not erase narrower inferred fields.
The witnesses are not reference conversions and are not propagated through an
independently checked nested satisfies expression. Native nested fixtures passed
twice and all 1,372 workspace tests passed. The nested compiler self-built
byte-for-byte at 33,565,322 bytes. Conditional branches now similarly retain their
inferred types after both satisfy the expected contract; their native fixtures
passed twice and all 1,373 workspace tests passed.

`satisfies unknown` now checks without imposing a contextual shape, retaining the
original object and array encodings. Boolean arrays use the generic sparse-list
runtime with optional-boolean payloads, including false versus absent values.
Native fixtures passed twice for mutations, callbacks, searches, sorting, copying
and boolean `join`; no numeric formatter is needed for boolean string conversion.
All 1,376 workspace tests passed. The combined compiler snapshot self-built
byte-for-byte at 33,565,418 bytes.

Ordinary arrays now support `findLast` and `findLastIndex` through the same callback
lowering as forward searches. Descending traversal snapshots length, visits holes
and deleted positions, reads mutations when visited, and preserves the value read
before invoking the predicate. Native fixtures passed twice for callback order,
early exit, empty/sparse arrays, mutation, optional receivers, exceptions, object
identity, boolean/string elements and negative zero. Scope lookup in the scalar
checker now uses `findLast`; the workspace library declarations advance to ES2023
while bootstrap emitted syntax remains ES2022. Explicit `thisArg`, arbitrary
borrowed receivers, prototype lookup and typed-array callbacks remain pending.
See [FindViaPredicate](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-findviapredicate).

The reverse-search adoption snapshot self-built byte-for-byte at 33,582,010 bytes.
The shared indexed callback loop now also handles typed-array `find`, `findIndex`,
`findLast`, `findLastIndex`, `some` and `every`, with numeric callback parameters.
Native typed-array fixtures passed twice across all four supported encodings,
offset views, mutations, early exit, empty arrays, exceptions and floating-point
edge values. Bit-vector equality adopts `every`. All 1,379 workspace tests passed;
the compiler snapshot self-built byte-for-byte at 33,615,034 bytes. Detached and
resizable buffers and explicit callback `thisArg` remain outside this slice.

Block-bodied array callbacks now infer return types, including missing-return
paths, bare returns, nested callbacks and never-returning bodies. Native fixtures
passed twice for optional numbers, booleans, strings and objects. `forEach` works
for ordinary and supported typed arrays; predicates may return void, which is
false under the builtins' truthiness conversion. Sparse `forEach` skips absent
properties while `find` still visits them. Native tests passed twice for mutation,
length snapshots, exceptions, skipped optional calls and discarded results.
Bit-vector intersection adopts `forEach`. All 1,382 workspace tests passed; the
compiler snapshot self-built byte-for-byte at 33,665,146 bytes. Additional unit
coverage verifies bare and implicit returns across optional scalar encodings.

Array literal elisions now have explicit AST nodes, preserving the distinction
between holes, trailing commas and present `undefined` values. Rewriting/linking
retain those nodes, type inference includes undefined and native construction
advances length without creating properties. Differential tests compare inferred
and contextual contracts against TypeScript 6.0.3. All 1,385 workspace tests passed.

The elision-enabled compiler snapshot self-built byte-for-byte at 33,698,346 bytes.
The execution accounting/reference adapter is described in [Test262 integration](test262.md).
Node passed all 104 upstream array-expression variants through that adapter;
these are runner-validation results, not Tint conformance passes. The next core
runtime prerequisites are the Script/global environment, ordinary object property
semantics and callable objects needed by the unmodified Test262 harness.

Ordinary-object foundations now include immutable descriptor validation, prototype
lookup, receiver-aware accessors and writes, own-key ordering, deletion, extension
prevention and To/FromPropertyDescriptor conversion. Differential tests compare
17,408 descriptor transitions and 80 receiver-write combinations with JavaScript.
The extended descriptor-conversion native fixture passed twice under LLDB. These
are reusable semantic primitives, not yet general language-level object support.

The isolated Test262 reference adapter now supports async Script completion with
the original harness print protocol, missing-completion timeouts and duplicate
completion detection. Promise rejection notifications are not thrown exceptions;
valid upstream tests may deliberately leave rejections unhandled. The reference
run passed all 60 Promise.resolve variants at the pinned suite revision. Modules
and agents remain unsupported; no Tint runtime-conformance percentage is claimed.

Ordinary-object sealing/freezing now reuses descriptor validation, preserving
accessor setters and shallow semantics while preventing extension and data writes
as appropriate. Differential tests cover data/accessor attributes, symbol keys,
idempotence and empty objects. The expanded native object fixture passed twice
under LLDB; all 1,408 workspace tests and dependency/format checks passed. This is
native validation of the reusable object operations, not yet source-level
`Object.freeze` support or a Test262 execution result.

The immediate integration priority is the native call/reference path: simple
object methods currently lower as closures without a `this` receiver. The
semantic IR already describes receiver-bearing calls, but that contract must
reach binding, checking, closure lowering and the native calling convention.
Follow with ordinary-object builtin bindings and Script/global execution so the
original Test262 harness can execute in compiled output. Node reference work
remains a separately labelled comparison and must not substitute for this path.

Receiver integration begins with a dedicated `this` syntax node and explicit
receiver ownership in binding. Ordinary functions own a receiver; arrows inherit
the nearest ordinary function's receiver, including in parameter defaults. Module
or Script receiver ownership remains distinct from lexical variable lookup.
Rewriting and linking preserve receiver nodes. The native receiver-binding fixture
passed twice under LLDB. Native receiver execution is still explicitly unsupported
until typing, closure captures and the calling convention carry this information;
this is not yet usable `this` or class support.

The receiver-binding compiler snapshot self-built successfully and stage1/stage2
matched byte-for-byte at 33,714,858 bytes. All 1,411 workspace tests passed, including
receiver ownership in defaults and nested ordinary/arrow functions and explicit
unsupported-execution diagnostics. The next step is receiver contracts in function
types and their propagation through native calls and lexical captures.

Function type contracts now carry an optional receiver type independently of their
positional parameter list. Calls check an explicitly supplied receiver type;
`undefined` at an unbound call must be represented by its actual type ID rather
than omission. Receiver requirements are contravariant and cannot be erased by
assignment in the strict type model. Receiver IDs participate in validation,
graph edges, copying and exact type interning. Unconstrained functions continue
to accept any receiver. Source-level `this` annotations and method inference still
need wiring into these contracts; native receiver passing remains outstanding.

Receiver contracts now also survive graph-to-syntax reification, alias resolution,
type-syntax rewriting and generic-specialization keys. Callback signature lookup
must not reuse a receiver-constrained function for an unconstrained callback.
The receiver-contract native fixture passed twice, and its compiler snapshot
self-built byte-for-byte at 33,731,370 bytes. A subsequent snapshot includes the
syntax-preservation changes and is undergoing its own self-build validation.

TypeScript function-type and interface-method receiver annotations now parse into
separate receiver contracts; `this` is excluded from positional parameters.
Misplaced, optional, missing-type, initialized and duplicate receiver annotations
are rejected. Ordinary function-definition receiver annotations and execution
remain pending. Native fixture construction exposed existing narrowing gaps for
optional-chain equality guards and nested property discriminants; follow-up work
must cover those forms rather than treating explicit-local workarounds as support.

The syntax-preservation snapshot self-built byte-for-byte at 33,764,394 bytes.

The receiver-annotation native fixture passed twice under LLDB, checking source
parsing, rewriting, binding ownership and receiver type relations together. All
1,417 workspace tests passed. The annotation-enabled compiler self-build is
running; it is not yet counted as a verified self-build. The next implementation
step is receiver annotations on function definitions, receiver-aware body checking,
and native argument/capture lowering.

Function definitions and object methods now parse receiver annotations separately
from positional parameters; arrows reject explicit receiver parameters. Body
checking tracks receiver types by binding owner, so arrows inherit a typed receiver
and ordinary functions establish their own. Method calls preserve receiver typing
through grouping and computed property access; detached calls and incompatible
receivers are rejected. Explicit receiver requirements survive contextual function
typing. The native lowering boundary still rejects execution of `this` explicitly.

Native receiver passing must use the existing `x2` caller-rooted general-value
pointer convention from the macOS target contract. Do not prepend receivers to
positional signatures: receiver-independent functions remain assignable to method
contracts and must keep compatible call layouts. Receiver operands must participate
in IR validation, substitution, liveness, rooting and optimization; callee receiver
storage and lexical arrow captures must remain live across calls and moving GC.

The receiver-annotation compiler snapshot self-built byte-for-byte at 33,764,490
bytes. The body-checking changes pass all 1,421 workspace tests; native fixture and
self-build validation are in progress.

The native fixture now runs the checker on receiver-bearing function bodies and
method calls, and passed twice under LLDB. This verifies the compiler machinery
natively; it does not claim native execution of those checked `this` expressions.
The body-checking snapshot self-build completed successfully and matched its
bootstrap image byte-for-byte at 33,979,338 bytes.

Receiver transport now has an explicit scalar IR contract: a separate general-value
entry slot and optional general-value operands on direct and indirect calls. The
AArch64 backend copies the caller-rooted `x2` value into callee storage before any
safepoint; an absent receiver initializes to undefined. Operand walking,
substitution, definite initialization, slot compaction, SSA promotion and
conservative value facts account for this storage. Inlining receiver-reading
functions is deferred until the inliner can preserve entry initialization.

Direct and indirect native ABI fixtures both returned their expected result under
LLDB, with receiver 19 and positional argument 23. The allocation-exhaustion image
trapped under LLDB as expected. These are IR/backend tests, not source-level `this`
execution or Test262 passes. All 1,425 workspace tests pass, including omitted-receiver IR cases;
type checking, package boundaries and formatting checks also pass. The receiver-IR bootstrap image builds at
34,045,386 bytes; its native self-build matched byte-for-byte. Both direct and indirect
omitted-receiver native fixtures passed under LLDB. An additional focused emitter
test verifies that receiver entry storage and its loaded value have general-value
root descriptors; the five receiver IR tests and subsequent type check pass.

### Native source receivers and lexical arrow captures

Ordinary functions with a checked receiver contract now read `this` through the
separate native receiver slot. Property calls snapshot their receiver before
computed keys and arguments; grouping and `satisfies` preserve the reference.
Grouped method checking now records wrapper types, and fixed computed keys can
retain their proof through comma expressions without discarding side effects.

Seven source fixtures passed in native output under LLDB: member, grouped,
computed and optional calls, borrowed methods, receiver-variable mutation while
evaluating arguments, and mutation while evaluating a computed key. These are
source-to-native fixtures, not Test262 runtime results.

When an arrow captures `this`, the binder creates one hidden immutable binding
owned by the enclosing ordinary function. Nested arrows forward the same binding
through the existing owned closure environments. Entry lowering initializes its
cell from the incoming receiver before parameter defaults. A returned-arrow native
fixture passed after the method returned; the nested forwarding fixture also
passed in native output under LLDB.
No separate receiver lifetime mechanism or permanent method binding is introduced.

Remaining receiver coverage includes contextual inference without explicit receiver
annotations, Script/global receiver semantics and broader dynamic invocation.
The forced-moving-GC fixture is described below. Class syntax and semantics remain
outstanding.

The receiver source/capture slice passes all 1,433 workspace tests, type checking,
package-boundary checks and formatting. The new bootstrap compiler builds at
34,854,650 bytes. Its native self-build exits successfully with the same image
size, but byte comparison fails: the native compiler omits receiver operands that
the Node bootstrap emits. This is an open self-hosting correctness regression;
source execution fixtures alone do not establish compiler equivalence.

`TINT_RECEIVER_RUNTIME=1 TINT_COPYING_RUNTIME=1` adds a moving-runtime fixture
with an 8 KiB heap. It allocates during a method call whose receiver has no other
source reference and retains another receiver solely through a returned arrow.
The native fixture returned 42 under LLDB. The relocation-rejection negative control exited 70 under LLDB, confirming
that the successful execution requires relocation.
`TINT_BUILD_ONLY=1` now permits this verifier to build without launching binaries,
so debugger attach failures can be retried without rebuilding the fixture.

The receiver self-build mismatch was traced to conditional spread inference:
`{...(condition ? {} : {receiver}), ...otherFields}` lost `receiver` through width
subtyping to `{}`. Inferred spread checking now retains those alternatives and
combines presence-only differences into optional fields. Variants with conflicting
field types retain their correlations. A native probe that parses, checks and
lowers a method call now returns 42, verifying that its generated call IR retains
the receiver; the same probe returned 5 before the fix.

This exposed heterogeneous optional spread encodings in the full compiler.
Lowering now packs and unpacks optional number, boolean, string and reference
values through general-value snapshots using explicit presence checks. Focused
regressions and all 1,435 workspace tests pass, including the linked compiler
checks. IR emission helpers now accept the minimal IR source-span contract rather
than requiring syntax-node hash metadata. The new bootstrap builds at 35,135,450
bytes. The native self-build completed and matched that bootstrap byte-for-byte,
closing the self-hosting regression recorded above. Additional native optional
spread fixtures for number, undefined-number, object and undefined-object all
passed under LLDB. Debugger attach failures were retried against the same binaries.

### Explicit receiver invocation

The strict native profile now recognizes typed `fn.call(thisArg, ...args)` and
grouped calls. It checks the supplied receiver against the function contract and
uses the existing indirect-call receiver operand, preserving callable evaluation
before the receiver and positional arguments. Omitted receivers become undefined;
lexical arrows retain their captured receiver. Optional `fn?.call(...)` uses the
existing chain machinery to skip receiver and argument evaluation.

This implements the invocation behavior described by
[Function.prototype.call](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-function.prototype.call)
for supported typed callable values. It is not a complete Function prototype
object implementation: extracted/computed intrinsic access, prototype overrides,
sloppy receiver boxing/global substitution, apply and bind remain outstanding.
The full 1,445-test workspace check passes. All seven native cases pass under LLDB: object, number, undefined, evaluation
order, lexical arrow, and optional calls with present and absent functions. The
35,168,474-byte compiler self-build matches its bootstrap byte-for-byte. A further
focused test verifies that an ordinary object method named call is not treated as
the intrinsic.

### Ordinary data-property copying

`@tint/js-runtime/objects` now provides the ordinary-object portion of
[CopyDataProperties](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-copydataproperties),
for future dynamic spread/rest integration. It snapshots ordered keys, skips
excluded keys before reading values, rechecks each descriptor after earlier
getters, copies only enumerable own properties, and creates data properties
without invoking target setters. Getter exceptions propagate; rejected creation
returns false for the embedding runtime to translate into a TypeError.

The embedding layer must still skip null/undefined and perform ToObject; exotic
object hooks and integration into general dynamic source expressions remain
outstanding. This semantic primitive is not a claim of new Test262 runtime passes.

Five focused tests cover getter mutation and receiver identity, numeric/string/
symbol ordering, exclusions, setter bypass, partial failure, and data-property
creation compared with JavaScript descriptors. `createDataProperty` is shared by
copying and descriptor export. A native fixture validates getter mutation,
ordered snapshotting, exclusions, setter bypass, and rejected creation under
LLDB (expected exit 42). The implementation and shared-helper cleanup both passed natively. The full
workspace check after that cleanup passed all 1,451 tests.

### Declarative environment storage

`@tint/js-runtime/environments/records` implements a reusable declarative binding record with
uninitialized versus initialized state, mutable/immutable bindings, binding and
assignment strictness, and deletion. Its explicit reference/type error results
must become realm-specific JavaScript exceptions at the runtime boundary.
This follows the [ES2025 declarative environment algorithms](https://262.ecma-international.org/16.0/#sec-declarative-environment-records).

Focused tests cover TDZ, initialized undefined values, strict and non-strict
immutable assignment, missing bindings, deletion, and initialization invariants.
The native fixture passes under LLDB (exit 42). This does not yet provide global object
bindings, outer-environment resolution, Script declaration instantiation, or
compiler integration. Those are the next runtime layers needed for native Test262.

### Ordinary global environment composition

`@tint/js-runtime/environments/global` composes lexical binding storage with the ordinary
object contract. Identifier reads/writes prefer lexical bindings; object-backed
bindings use prototype-aware reads and receiver-aware writes. Missing strict
writes produce reference errors and failed strict property writes produce type
errors. The global this value is distinct from the binding-object value.
Declaration admission checks own property attributes and extensibility; var
creation preserves existing properties, while function creation uses the specified
data descriptor replacement rules. Canonical key mapping is supplied by the
embedding runtime, so name resolution does not constrain its property-key encoding.

This is ordinary-object machinery, not a full realm or Script executor. The caller
must validate lexical conflicts and declaration admission, instantiate declarations
in specification order, supply callable function values, and translate error
results to realm exceptions. Proxy globals remain unsupported. The full current
workspace check passes 1,459 tests and verifies 72 package contracts. Native lexical
and global environment fixtures pass under LLDB (exit 42).

### Strict Script declarations and binding

Global declaration plans now distinguish early conflicts within one Script from
runtime conflicts with existing global bindings. Instantiation checks admission
before creating bindings, leaves lexicals uninitialized, selects the last function
declaration for each name, and initializes functions before variables. The native
fixture validates ordering and conflict handling. Factories create function objects;
they must not execute function bodies or arbitrary user code. Exotic globals and
Annex B additions remain outside this ordinary strict-Script path.

`collectStrictScriptDeclarations` traverses supported control flow for var names,
retains top-level lexical declarations and function nodes, and stops at function
boundaries. Its parser-to-environment native fixture passes. `bindStrictScript`
adds an explicit Script scope, runtime-resolved external names, deferred immutable
assignment errors, and duplicate top-level function aliases. Full nested-function
and sloppy binding conformance remain incomplete; collection is not itself a full
early-error validator. Original typed module binding behavior remains unchanged.

The collector snapshot self-build (`stage1/2-script-environments-v2`) matches
byte-for-byte at 35,201,498 bytes. The subsequent Script binder addition passes its native fixture and all 1,468
workspace tests. Its fresh self-build (`stage1/2-script-binding-v1`) matches
byte-for-byte at 35,218,186 bytes. No native Test262 test-body execution is
claimed by these infrastructure fixtures.

### Function stringification

Script lowering accepts the original source string and retains exact function,
arrow, method and class text in runtime metadata. Offsets are UTF-16 indices;
comments, whitespace and escaped identifiers are preserved. Class method spans
exclude the `static` modifier, while object method spans include accessor, async
and generator prefixes. The native Test262 adapter supplies unchanged source.
Callers which omit source retain an explicit unsupported stringification path.

Built-ins retain their initial names independently of mutable `.name` properties.
Bound functions and callable proxies use native-function formatting without
reading user properties or invoking proxy traps. All 7 exact-source native
regressions and 5 native-formatting regressions pass. The complete
`Function.prototype.toString` selection passes 150/160 variants (93.75%), with no
failures or crashes. Its 10 unsupported variants require dynamic `Function`
construction, directly or through the unchanged intrinsic-discovery harness. See the [native regression evidence](test262.md).

### Live keyed collections

Live Map and Set use the existing linked-map storage with an explicit key
hash/equality contract. Equality supports SameValueZero and value-equal BigInts;
collection keys canonicalize negative zero. The default strict-profile map ABI
retains its zero-argument constructor. Live cursors preserve insertion order and
observe deletion, reinsertion and clearing without exposing storage internals.

Map includes iterable construction, ordinary methods, iterators, `groupBy`,
`getOrInsert` and `getOrInsertComputed`. Set includes iterable construction,
ordinary methods and all seven algebra operations. Set-like argument validation
is shared; algorithms retain their required getter order, snapshot/live traversal
and iterator-closing differences. Results use the intrinsic Set prototype and do
not invoke user-defined `add` or species constructors.

The complete Map family passes 334/405 variants in its pre-Set snapshot; detailed
dependency, unsupported-path and debugger-failure counts are in the
[dashboard](test262.md). The complete Set family passes 730/764 variants (95.55%);
remaining outcomes require weak collections, dynamic Function construction or
were blocked before entry by LLDB. Weak collections
remain unimplemented and require genuine weak reachability, not strong storage
under weak collection names.

### General-value arrays and object-runtime transport

`unknown[]` now uses the existing specialized sparse-list runtime, with general
16-byte values in its managed element records. The checker accepts general array
reads/writes and treats an unknown context as supplying no object/array shape.
Runtime-generated nested unions containing unknown retain the general encoding,
including optional read results. No second dynamic value representation or new
container implementation was added. Set/Map unknown element support remains
separate; this slice enables arrays and arguments passed to object hooks.

The native `verify-hosted-dynamic-object-values.ts` fixture passes with mixed
primitive/object elements, growth/shrinkage, object identity, descriptor values,
getter receivers and setter arguments. All 1,472 workspace tests pass. A small-heap
copying-GC fixture also passes with general arrays holding strings and objects;
its reject-relocation control exits with the expected status 70, proving that
relocation occurred. The compiler self-build (`stage1/2-general-arrays-v1`)
matches byte-for-byte at 35,234,890 bytes. These remain infrastructure fixtures, not Test262 runtime passes.

### Array-view representation boundary

A native probe exposed an unsafe representation crossing: assigning `number[]`
to `readonly unknown[]` passed semantic checking but read numeric-list storage
as a general-value sparse list, trapping under LLDB. Checked type-flow facts now
allow lowering to reject incompatible array views before emission. Regression
coverage includes local aliases, parameters, results, nested object properties,
conditional joins, and contravariant callback parameters. All 1,473 workspace
tests, type checks, dependency checks, and formatting checks pass.

This diagnostic is a temporary implementation limitation, not a deliberate
TypeScript language restriction. Compatible views must preserve identity, observe
subsequent writes through other aliases, and use the actual backing layout on
each access; see [runtime type contracts](runtime-types.md#unknown-values-and-representation-preserving-views).
Neither a copy nor an unchecked pointer reinterpretation implements that contract.

The updated Node bootstrap emits `stage1-array-view-guards-v2` (35,367,978 bytes).
Native validation of this snapshot is pending: repeated LLDB stop-at-entry launches
failed to attach before compiler execution. Those failures are not compiler test
results, and the earlier general-array self-build does not validate this change.

Strict Script binding now also merges duplicate function declarations in function
bodies (ordinary declarations, function expressions, and arrows), preserving the
last declaration node and aliases for earlier declarations. Strict block functions
and conflicts with lexical declarations still reject. The regression checks both
binding identities and Node's strict Script acceptance; all 1,474 workspace tests
pass. The native Script-declaration fixture includes this case and builds, but
execution and the `stage1-script-function-bindings-v1` self-build remain unverified
because debugger attachment still fails before execution.

Strict Script functions with parameter default expressions now bind body variables
in a separate function-body scope. Default-created closures retain the parameter
binding even when a same-named body variable exists. `FunctionBinding.parameterCopies`
records the parameter-to-body initialization required after defaults finish;
same-named body function declarations initialize their own binding instead. Lexical
declarations still cannot redeclare parameters, while nested blocks can shadow them.
This implements binding/instantiation inputs, not execution of parameter copies in
a native Script adapter. Typed module lowering is not switched to this new contract.
Simple parameter lists continue to share their binding with same-named body function
declarations; these no longer produce an incorrect duplicate-name diagnostic.
All 1,478 workspace tests pass, with strict Node Script comparisons and binding/capture
identity assertions. The expanded native Script-binder fixture builds successfully.
The parameter-environment snapshot `stage1-script-parameter-environments-v1`
builds at 35,401,082 bytes; it predates the subsequent simple-parameter redeclaration
fix and is not evidence of native execution or a verified self-build.

Strict Script binding now accepts `var` redeclarations of simple catch parameters.
The declaration still belongs to the enclosing var scope, while initializer and
iteration writes resolve to the nearest catch binding. `varInitializerTargets`
records those overrides separately from declaration aliases; declarations without
initializers do not introduce a write. Enclosing lexical conflicts remain errors.
The existing typed-module lowering still rejects this case until it consumes the
separate initialization contract. Node comparisons and binding tests cover the
Script semantics; all 1,480 workspace tests pass. Native Script execution and
Test262 passes are still not claimed by these binder changes.

The subsequent `stage1/2-runtime-scopes-v1` self-build completes successfully and
matches byte-for-byte at 35,401,082 bytes. This snapshot includes the parameter
environment and catch initializer binding changes. The separate runtime scope and
function-body instantiation fixtures also pass natively; see [Test262 infrastructure](test262.md).
A live breakpoint during self-compilation produced a symbolized caller backtrace
with original TypeScript lines, recorded in [profiling](profiling.md).

## Constructor type contracts (2026-10-31)

The reusable value-type graph now models object call and construct capabilities
independently, with static properties on the same object contract. Each capability
references a function signature. Calls check receiver requirements; construction
has no caller-supplied receiver. Constructor results, parameter variance,
recursive contracts, immutable graph snapshots, canonical identities and mutable
property invariance are covered by focused tests. Ordinary property initialization
cannot manufacture a constructor or callable capability.

Type syntax now accepts `new (x: number) => Value` and single call/construct members
in object types and interfaces, including generic/recursive definitions, inherited
signatures and disjoint-signature intersections. Rewriting, import renaming,
specialization identity and type reification preserve those signatures. The pinned
TypeScript checker agrees on the selected positive and negative contract examples.
Overloaded signatures and intersections requiring multiple signatures remain
explicitly unsupported. This is type-contract infrastructure, not executable
strict-profile class support or an additional Test262 pass.

The contract-only native snapshot `stage1-constructor-types-v1` rebuilt its frozen
source into byte-identical `stage2-constructor-types-v1` (36,772,986 bytes with debug
symbols). The expanded native fixture exercises source parsing, interface
resolution and type reification as well as contract relations. Full source class
linking/checking and constructor code generation are still the next integration
steps before compiler-source adoption.

A representation-boundary regression was caught while enabling these relations:
a function widened to `{}` was accepted and emitted with an incorrect `typeof`
result. The shared `representation-views` check now diagnoses callable/object
conversions requiring adapters, including nested field/result views. Plain-record
layout selection rejects callable/constructible object contracts. These are pending
native representation capabilities, not permanent strict-profile type exclusions.
The logical type relation stays available for checking and future class lowering.

Validation for the combined signature work: all 1,564 workspace tests pass, along
with the pinned TypeScript comparisons and public-import/dependency checks. The
full 528-semantic-case native Script fixture plus four unsupported-outcome checks
still passes. The constructor-contract fixture runs the parser, resolver, reifier
and lowering boundary checks as native code; none of these type-contract tests is
counted as a Test262 runtime pass.

The final combined snapshot, including representation guards, preserves native
self-hosting: `stage1-callable-contracts-v2` compiled `source-callable-contracts-v2`
into `stage2-callable-contracts-v2`, exited normally with status zero, and matched
byte-for-byte at 37,020,906 bytes. Both images have SHA-256
`baea81e5c1e028a3f55b2176185f83a829eeed063a0c0179c2c3bdbd1ed09d6a`.
DWARF verification reports no errors. The native constructor-contract fixture also
passes its explicit rejection probes for unsupported callable/object conversions
and plain-record representations of callable contracts.

### Class linking and lexical type identity

The linker now preserves classes in both value and type namespaces, including
aliased imports, generic instance annotations, the distinct immutable inner class
name, and named class expressions. Block-local classes and classes across shared
switch-clause scopes shadow outer generic type names without leaking out of their
scope. Class definitions and members retain original source-node mappings.

All 1,569 workspace tests pass, including five class-linking regressions; TypeScript
project checks, the 73-package dependency boundary check, and formatting pass.
`verify-hosted-class-linking.ts` builds and executes the parser, binder and linker
as native code and exits with the expected status 42. This validates compiler
infrastructure, not additional Test262 passes or typed native class execution.
Top-level class linking requires instance evaluation; type-only class dependencies
still fail explicitly pending declaration-contract extraction. Typed class
checking, module-instance preparation and construction remain integration work.

Native self-hosting is preserved: `stage1-class-linking-v1` compiled the frozen
`source-class-linking-v1` into `stage2-class-linking-v1` and exited normally with
status zero. Both debug-enabled images are 38,128,282 bytes and byte-identical,
with SHA-256 `5d2fdf453e4b6ac9db07e00d3da88fe4ff459819e47bba4b5d80084bc299c22e`.
The stage-two image passes DWARF verification with no errors.

### Annotated base-class contracts

Declaration resolution now derives separate instance and constructor/static
contracts for annotated base classes. Instance and static methods carry distinct
receiver contracts; constructors expose construction rather than ordinary calling.
The default base constructor has zero parameters. Recursive generic instances and
linked inner/outer class names resolve to canonical types. Static members reject
class type-parameter references even when an outer type has the same name. Member
metadata retains original syntax nodes for the subsequent body-checking pass.

Five focused class-contract tests and the selected pinned-TypeScript declaration
comparisons pass. All 1,575 workspace tests pass; the native class-contract fixture
parses, links and resolves recursive generic classes and checks receiver/construction
relations, exiting with status 42. This is type infrastructure, not a new Test262
pass. Accessors, inference, computed keys, inheritance, initializer/constructor
body checking and typed native construction remain pending integration.

An independent bootstrap probe also exposed an existing narrowing limitation:
`try/finally` loses an outer loop value's non-undefined refinement even when both
blocks are empty. The contract resolver avoids a redundant inner `finally`; its
outer declaration-resolution `finally` still restores type-parameter state.
Fixing that general control-flow limitation remains follow-up work.

The debug-enabled `stage1-class-contracts-v1` successfully rebuilt its frozen
`source-class-contracts-v1` into `stage2-class-contracts-v1`. The native compiler
exited with status zero; both images are byte-identical at 38,244,330 bytes, with
SHA-256 `d7f051fe18db3740df841191718390c92b0923f7d3e443dfbec9767bb62775e4`.
The stage-two image passes DWARF verification with no errors.

### Construction through typed values

The executable checker now accepts `new` through construct-signature values,
including constructor-valued properties and bindings that shadow built-in names.
Declared parameter types provide context for arrow/object arguments and optional
arguments. Call-only values, incompatible arguments and unspecialized generic
construction fail explicitly. Constructor calls invalidate aliased-property and
mutable captured-binding refinements through the same mechanism as ordinary calls.

All 1,580 workspace tests pass, including selected positive/negative comparisons
with the pinned TypeScript checker. The expanded native class-contract fixture
checks a contextual constructor call and rejects a call-only value, exiting with
status 42. Native lowering still rejects general constructor calls until their
representation and invocation are implemented; a lowering regression test protects
that boundary. These checks are compiler-infrastructure evidence, not additional
Test262 passes or executable typed-class support.

Native self-hosting remains intact: `stage1-construction-checking-v1` rebuilt its
frozen `source-construction-checking-v1` into `stage2-construction-checking-v1`,
exiting with status zero. The debug-enabled images are byte-identical at
38,260,922 bytes, with SHA-256
`9724f8606d141d3aaf75feb6830fe6d7d192f21d4c7d786518a58c3cc7530a12`.
The stage-two image passes DWARF verification with no errors.

### Executable annotated base-class checking

Top-level nongeneric annotated base classes now use the contextual function checker
for instance/static methods, constructor bodies and field initializers. Binding
identities preserve the inner class name and receiver captures. Borrowed methods
retain receiver requirements; strict detached calls without a receiver fail.

The separate initialization analysis tracks required instance/static fields in
source order, direct assignments, branches, short-circuit expressions and early
throws. Every returning path must initialize fields whose type excludes undefined.
Early reads, method calls and exposure/capture of incomplete receivers are rejected.
Conditional parameter defaults cannot establish unconditional initialization; later
field declarations overwrite earlier assignments. Static class-name references are
identified by binding identity. Methods, constructor values and field initializer
bodies remain attached to their original syntax nodes for eventual lowering.

This is an initial conservative strict-profile analysis. Loops, switch and try
statements before initialization completes, deferred captures of incomplete
receivers, constructor object-return overrides, generic/local class bodies and class
expressions still require further support. Inference, accessors, computed keys and
inheritance retain the previously documented contract-resolution boundaries.

A new lowering regression caught class declarations being silently omitted by the
existing emitter path. Typed class declarations now fail explicitly until class
initialization/construction and prototype-aware storage are implemented. This does
not change the already-supported Script class runtime.

All 1,586 workspace tests pass, including selected pinned-TypeScript comparisons.
The native `verify-hosted-class-bodies.ts` fixture checks eleven valid/invalid
class-body cases and the lowering boundary, exiting with status 42. TypeScript
project checks, package boundaries and formatting pass. These are native compiler
checks, not additional Test262 passes or typed class machine-code execution.

The existing native Script corpus also passes all 532 cases: 528 semantic cases
and four explicit unsupported-outcome checks. The debug-enabled native compiler
`stage1-class-bodies-v1` rebuilt the frozen `source-class-bodies-v1` into
`stage2-class-bodies-v1` and exited with status zero. Both images are byte-identical
at 43,588,314 bytes, with SHA-256
`08285162ab46920194d2826ac62f9a32c225ae848e934c6bc618ff33c36d521d`.
The stage-two image passes DWARF verification with no errors.

### Separate prototype contracts

Class prototypes now have their own canonical type IDs, containing methods and the
constructor back-reference without instance fields. The prior prototype-as-instance
contract could incorrectly certify reads of uninitialized numeric fields. Strict
checking now rejects those reads and rejects calling an instance-field-dependent
method with the prototype as receiver; borrowing the method onto a valid instance
works. This intentionally tightens an unsound TypeScript behavior and does not alter
the live Script runtime's JavaScript semantics.

Instance structural compatibility remains independent of unrelated static members.
The precise static constructor type is not injected into the instance contract;
the general inherited Function/Object surface remains pending. Tests cover recursive
generic prototype references, receiver safety, and assignment between classes with
identical instance members but incompatible static properties.

All 1,588 workspace tests pass, including the selected pinned-TypeScript comparison
for instance compatibility. The updated native class-contract fixture checks the
separate prototype and constructor back-reference and exits with status 42. Package
boundaries, TypeScript project checks and formatting pass. The next storage work is
described in [native class emission](native-classes.md); typed class emission remains
explicitly unsupported, and these checks add no Test262 runtime passes.

The debug-enabled `stage1-class-prototype-v1` rebuilt the frozen
`source-class-prototype-v1` into `stage2-class-prototype-v1`, exiting with status
zero. Both images are byte-identical at 43,621,338 bytes, with SHA-256
`ae31cfa1cff2d7db84c01aaaf822fbbfcb4250445cc53a475e8ec993f8097fd5`.
Both images pass DWARF verification with no errors.

### Typed prototype lookup lowering

Scalar record-access contracts now describe an optional prototype field and nested
read contract for each concrete layout. Lowering checks the descriptor, uses the
existing own-presence bit, and follows the prototype only when the own property is
absent. An own `undefined` remains an override. Each fallback keeps its own shape
guards and managed reference slots. Writes retain their own-property destination.
The shared `RecordAccessChoice` type replaces duplicate physical-access contracts
in the closure adapter.

The workspace suite passes 1,591 tests. Sixteen native fixture variants pass under
LLDB: one- and two-level lookup, absent/undefined/value own properties, each with
direct and optimized IR, plus repeated reads after own or prototype writes. The
fixtures include a mismatching first layout to check
dispatch and assert both results and exact allocator accounting. TypeScript checks,
package boundaries and formatting pass. These are physical lowering tests, not
Test262 passes or completed class emission; class layout planning, construction and
module integration still need to supply and use the new contracts.

The debug-enabled `stage1-prototype-lookup-v2` rebuilt its frozen
`source-prototype-lookup-v2` into `stage2-prototype-lookup-v2`, exiting with status
zero. Both images are byte-identical at 43,653,434 bytes, with SHA-256
`a68977ecc4481eee2d2bb28a6769da7c05a0912d24841f39f931e345f887cbda`.
Both images pass DWARF verification with no errors.

### Class storage planning and initialized access

Checked closure modules now retain their canonical class contracts. The record
planner gives each class separate instance and prototype descriptors while keeping
ordinary structural layouts available. Instances have initialization-tracked data
fields, optional own method overrides, and a hidden prototype pointer. Prototypes
hold shared methods and an initialization-tracked constructor back-reference.
Member access selects the concrete layout, follows the prototype for absent own
methods, and uses `record-cell` guards for data fields. A shared layout helper now
serves plain records and class storage.

Native testing exposed an unsafe contextual-spread shortcut: joining a conditional
spread with an empty object could discard a branch's incompatible property before
validation. The checker now retains all branch fields. Two syntax/linker rewrites
use explicit variant branches to preserve their correlations, and nested access
metadata is constructed against explicit contracts. The strict restriction against
recovering optional properties through empty structural views remains in place;
relaxing it would permit hidden incompatible fields to be reinterpreted.

All 1,595 workspace tests pass. The storage planner executes natively, and separate
native fixtures allocate planned storage, initialize a field and read it through
the generated contract, with both direct and optimized IR. The 532-case native
Script corpus still passes (528 semantic cases and four unsupported-outcome checks).
TypeScript checks, package boundaries and formatting pass. Typed class declaration
emission remains explicitly unsupported pending constructor representation, ordered
initialization and module integration; these results add no Test262 runtime passes.

The updated native planner fixture also rejects the incompatible conditional
spread. The debug-enabled `stage1-class-records-v2` rebuilt its frozen
`source-class-records-v2` into `stage2-class-records-v2` and exited with status zero.
Both images are byte-identical at 43,804,394 bytes, with SHA-256
`5d0ff6a91fd87c807c0aee548bb8071565d73f3cf8e6997e6980bd61b525bef8`.
Both images pass DWARF verification with no errors.

### Constructor environment inspection

The scalar IR now supports guarded `function-environment` inspection using the
existing function object's managed environment edge. Noncapturing functions return
an absent optional reference; consumers must establish presence and guard the
record layout before accessing fields. Operand substitution, effects, lifetimes,
managed result encodings and closure spill rewriting support the operation.

Captured and empty environment fixtures pass direct and optimized native execution
under LLDB (four construction binaries, each exit 0). Their function entry traps if
invoked, so inspection cannot pass by executing it. An emission test also verifies
that inspection alone supplies the function descriptor and managed edge at byte 24.
The workspace suite passes 1,599 tests; build/test/host type checks, package boundaries
and formatting pass. These are IR/native checks, not additional Test262 passes.

`stage1-function-environment-v1` compiled the frozen
`source-function-environment-v1` snapshot under LLDB into
`stage2-function-environment-v1` with exit 0. Both images are byte-identical,
43,853,930 bytes, SHA-256
`6ed2cd87b3befc76b586361bcab0f460a0a57ea16cb395ad2d8f9cf2623cb0cf`;
both pass DWARF verification. Typed class construction, static member lowering and
ordered module initialization remain pending; the explicit lowering guard remains.

### Constructor static-state layout and access

Class storage planning now supplies a managed constructor environment containing
its prototype, static fields/methods, and a hidden initialization-tracked construction
entry. The constructor value remains a function; its environment is not registered
as a plain structural object layout. `RecordAccess.functionEnvironment` explicitly
routes property operations through function-brand validation and the existing record
layout/initialization guards. Construct-signature receiver types select compatible
constructor states, with cached classification for repeated access planning.

Four direct/optimized native fixtures pass reads and writes through a structural
constructor alias, including a nonmatching first descriptor with different field
offsets. Writes are read back independently and the returned value is also checked.
The class call entry traps if invoked, so property access must not call it. The
native hosted class planner also checks static layouts and read/write access choices
and returns 42. The workspace suite passes 1,601 tests, with build/test/host type
checks, package boundaries and formatting passing. These are native infrastructure
checks, not additional Test262 passes. Source class-definition evaluation, general
function/object views and constructor invocation remain unfinished.

The `stage1-class-constructor-state-v3` native compiler built the frozen
`source-class-constructor-state-v3` snapshot with exit 0 under LLDB. Its
`stage2-class-constructor-state-v3` output is byte-identical to the Node bootstrap:
43,936,714 bytes, SHA-256
`751aba01f0ed6a8e36597143c0ed797ed63883b8d3e4742439d96e478ba62d23`.
Both images pass DWARF verification. Earlier v1/v2 snapshots failed bootstrap source
checking and are not successful compiler artifacts.

### Separate construction calls

`RecordOperations.constructors` now maps checked `new` expressions to a hidden
construction-entry access and an indirect-call signature witness. The class planner
selects compatible constructor-state layouts and initialization-tracked entry fields.
Scalar lowering retains the evaluated callee while arguments execute, then resolves
and invokes the construction entry. A shared invocation helper keeps ordinary calls
and construction aligned for argument conversions, omitted optional arguments and
exception propagation. Construction results must be managed object references.

Native direct/optimized fixtures exercise constructor rebinding during argument
evaluation, left-to-right argument side effects, omitted optional arguments, throwing
arguments and throwing construction entries with source `catch` recovery. Class
ordinary-call entries trap if invoked. The native planner checks construction-entry
selection, and the existing 532-case Script fixture passes (including its four
explicit unsupported outcomes). These are native semantic/infrastructure checks,
not newly counted Test262 passes. The full workspace suite passes 1,603 tests;
build/test/host type checks, package boundaries and formatting pass.

`stage1-class-new-v1` builds the frozen `source-class-new-v1` snapshot under LLDB
with exit 0. Its `stage2-class-new-v1` output is byte-identical to the Node bootstrap:
44,071,066 bytes, SHA-256
`37657743cd67444110b04a57d7103afee6302f2129d4b573ed41d7def417e731`.
Both images pass DWARF verification. Source class-definition emission, generated
construction bodies, constructor-return handling and ABI adapters for differently
encoded constructor signatures remain unfinished. The explicit typed-class lowering
guard remains until those paths are connected and verified.

### Generated base construction bodies

`buildClassConstruction` emits instance allocation, shared-prototype installation,
source-ordered field initializer calls, initialization-tracked field writes, and a
constructor-body call after the fields are ready. Initializers and bodies use managed
closures with the fresh instance as their ordinary receiver. Explicit undefined
initialization handles optional number/boolean/string/reference and general fields;
other encodings need an appropriate initializer. The body contract is currently void,
so constructor object-return overrides and derived construction remain pending.

The generic typed block/slot builder moved from scalar optimization into `scalar-ir`,
while optimization-specific policies remain separate. Source metadata copies only
`start` and `end`; a regression test prevents structural span objects from overwriting
instruction IDs, slots or values. Both existing optimization users use this shared
builder rather than retaining a parallel implementation.

Six direct/optimized native fixtures verify field ordering, field-dependent constructor
parameter defaults, and exact exceptions propagated from field initializers and body
calls. Unexpected success in an exception case traps. A separate native fixture runs
the generator itself and verifies its output IR, returning 42. The full workspace
suite passes 1,609 tests; build/test/host type checks, package boundaries and formatting
pass. These are native infrastructure/semantic checks, not additional Test262 passes.
Typed source class-definition evaluation and member/body integration remain guarded.

`stage1-class-construction-body-v4` compiled the frozen
`source-class-construction-body-v4` snapshot under LLDB with exit 0. Its
`stage2-class-construction-body-v4` output is byte-identical to the Node bootstrap:
44,534,138 bytes, SHA-256
`65518fcff6e8ad1b0c848dccbea0bbd98230dfe2bbc298435ed650fd7a293511`.
Both images pass DWARF verification. Earlier v1–v3 bootstrap attempts failed parsing
or lowering and are not successful compiler artifacts. Class-definition evaluation,
lexical capture/member integration and the typed source lowering gate remain open.

### Ordered static-field initialization

`buildClassStaticInitialization` now emits the static-field phase using an existing
constructor and its managed state. The same generator core handles instance and
static initialization, sharing closure invocation, field initialization state,
undefined encodings and abrupt completion. Static initializer receivers retain the
constructor's callable identity instead of exposing its backing record.

Four direct/optimized native fixtures verify that later static fields observe earlier
values, `typeof this` is `function`, and a throwing initializer propagates its exact
exception. All six existing construction fixtures still pass after the refactor.
A native hosted fixture runs both generators and validates their IR, exiting 42.
The workspace suite passes 1,611 tests, along with build/test/host type checks,
73-package boundary checks and formatting. These checks do not add Test262 passes.
Class-definition allocation, inner/outer binding publication and typed source
integration remain unfinished.

`stage1-class-static-v3` compiled the frozen `source-class-static-v3` snapshot
under LLDB with exit 0. Its `stage2-class-static-v3` output is byte-identical:
44,633,450 bytes, SHA-256
`7bea901f4e93f51a48c997f94fff814047f80b6af7ce693583a664c961e22df2`.
Both images pass DWARF verification. Earlier v1/v2 attempts exposed unsupported
narrowing of nested plan properties and optional values inside callbacks; the shared
implementation now passes explicit layout inputs and captures the prototype field
index before the callback. Those attempts are not successful compiler artifacts.

### Base class-definition generation

`buildClassDefinition` now composes the prototype, constructor state, managed
construction entry and static-initialization entry. Lexical method and initializer
closures arrive through an explicit environment contract; binding cells remain
managed references. The generator installs the prototype/constructor cycle and
construction entry, initializes the inner class name, runs the static phase, then
publishes the outer binding. An abrupt static initializer leaves that outer binding
uninitialized while preserving already-created state and effects.

Four direct/optimized native fixtures compose the definition, construction and
static generators. They verify constructor/prototype back-references, shared
prototype and method identities across two instances, independent instance fields,
method receivers, inner-name availability during static initialization, outer TDZ,
and exact static exceptions with no outer publication. A separate native fixture
executes the definition generator itself and verifies its output IR, exiting 42.
The 1,613-test workspace suite, build/test/host type checks, package boundaries and
formatting pass. These are native infrastructure checks, not new Test262 passes.

The typed source class guard remains: checked lexical capture/member planning,
module-instance execution and scoped class contracts still need integration. The
caller supplies the class [[Call]] TypeError entry; the generator does not implement
heritage, computed-key evaluation, derived constructors or private state by itself.

`stage1-class-definition-v3` compiled frozen `source-class-definition-v3` under
LLDB with exit 0. The `stage2-class-definition-v3` binary is byte-identical:
44,898,874 bytes, SHA-256
`d3045738157aeff87ba3c9f7fe0d29442bee57b367c07fdafa7ffe6c8bcd324a`.
Both images pass DWARF verification. Earlier bootstrap attempts exposed empty-array
inference and structural source-metadata spread limitations; the final generator
uses explicit argument-list typing and copies source coordinates directly.

### Directive-sensitive Script parsing

`parseScript` now records effective Script/function strictness while retaining
`parseStrictScript` for callers that explicitly request strict code. A token-level
directive scan checks raw spelling and expression continuation across line breaks;
escaped strings, templates, parenthesized expressions and non-directive expressions
do not accidentally activate strict mode. Ordinary functions inherit or establish
strictness before parameter parsing, classes enforce their implicit strict context,
and function/class parsing restores the enclosing context afterward.

Basic sloppy bindings, restricted-word identifiers and duplicate simple ordinary
parameters now parse. Arrow/class/strict parameters remain unique; duplicates in
non-simple ordinary lists still reject. Sloppy `let` expressions remain distinct
from lexical declarations, whose binding names cannot be `let`. Legacy numeric
literals/escapes and further Annex B syntax remain incomplete. Strict Script binding
rejects explicitly sloppy ASTs until runtime support is connected.

A native parser fixture validates Script/function modes and early errors, exiting 42. The workspace suite passes 1,621 tests, with type checks, formatting and package
boundaries passing. The complete pinned Test262 syntax inventory now inspects all
103,264 variants, accepting 25,626 additional sloppy/raw non-syntax-negative inputs.
These are parser observations, not new runtime conformance passes. Native sloppy
binding, receiver coercion, reference writes and Annex B execution remain next.

`stage1-script-modes-v1` compiled frozen `source-script-modes-v1` under LLDB with
exit 0. Its `stage2-script-modes-v1` output is byte-identical: 45,015,002 bytes,
SHA-256 `5a1a105af558749efe3114fc3db123fc95b9abbe43e9fe2470cbbfbf9fda6c9b`.
Both images pass DWARF verification. The existing native Script corpus also exits
42, preserving its semantic and explicit-unsupported checks. Directive handling
follows the [ECMAScript strict-mode rules](https://tc39.es/ecma262/multipage/ecmascript-language-source-code.html#sec-strict-mode-code);
this does not imply that the remaining sloppy grammar or runtime is complete.

### Native Script modes and duplicate parameters

`bindScript` and `lowerScript` now carry parsed strictness through supported
synchronous Script forms. The explicit strict APIs remain guarded contracts.
Unresolvable sloppy writes use the existing global-reference machinery; failed
ordinary-property writes are ignored only for non-strict references. Nullish bases,
const writes and user-thrown setters still preserve their errors. Source functions
bind nullish receivers to their defining global this value in non-strict code and
retain object receivers; strict functions and class bodies retain strict behavior.
Primitive receiver boxing remains explicitly unsupported, rather than returning a
primitive where JavaScript requires an object. Arrows preserve their lexical receiver.

Sloppy simple duplicate parameters share one binding, initialized in parameter
order so the last argument wins even when missing. Non-simple/strict/arrow parameter
duplicates remain errors. Annex B block functions remain an explicit unsupported
binding path; arguments objects and further sloppy-mode behavior still need work.
The declaration and runtime helpers share their existing implementations rather than
forking a separate sloppy evaluator. This remains direct native execution.

Twenty added native semantic cases pass alongside the existing 532-case Script
corpus (552 total, including four explicit-unsupported checks). The full workspace
suite passes 1,624 tests; type checks, formatting and package boundaries pass.
The native Test262 adapter now prepares strict/sloppy/raw synchronous scripts and
parses each original harness file in its own mode. At the clean pinned revision,
continue/shadowing passes 2/2, duplicate-parameter behavior 1/1, raw hashbang 1/1 and
class accessors 8/8. Reports are linked from [Test262 integration](test262.md).
These 12 selected passes do not establish whole-suite coverage or a performance target.

`stage1-sloppy-script-v1` compiled frozen `source-sloppy-script-v1` under LLDB
with exit 0. Its `stage2-sloppy-script-v1` output is byte-identical: 45,116,538 bytes,
SHA-256 `ed3023c913c4aa1041e4e8d6c5e3122309887c79d152ee4af827b7ffe9cc656c`.
Both images pass DWARF verification. Sloppy Script support remains partial despite
these successful native and conformance selections; the >90% suite goal is open.

## Named function expressions and source-function metadata

Named ordinary function expressions now parse and execute through the native Script
pipeline. Their self-name is a separate immutable environment binding, visible in
parameter defaults, the body and nested closures, but absent from the surrounding
scope. Parameters and body declarations can shadow it. Writes throw in strict code
and are ignored in sloppy code. The implementation follows
[InstantiateOrdinaryFunctionExpression](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-runtime-semantics-instantiateordinaryfunctionexpression).
Own strict directives also constrain the expression name. The shared source-function
factory now installs non-writable, non-enumerable, configurable `name` and `length`
properties for ordinary functions and arrows; length stops at the first default.
The lowerer supplies declared, explicit or context-inferred names, including object
methods. Existing property helpers also replace duplicate prototype descriptor code.

Nineteen added native fixtures bring the Script corpus to 571 cases. They cover
recursion, name isolation, parameter/local shadowing, default evaluation, escaping
closures, strict/sloppy writes, thrown function identity, construction, and metadata.
All 571 execute successfully under LLDB. Parser/binder tests exercise early errors
and self-name resolution; runtime unit tests inspect metadata descriptors directly.

Four unchanged Test262 tests pass natively at the existing clean pinned revision:
self-name assignment in strict and sloppy code, directly and through arrows. See
[Test262 results](test262.md#historical-reports). These are selected
results, not a full-suite coverage percentage. The function-name descriptor test
remains unsupported because its original propertyHelper.js needs `delete` syntax.
Typed-profile named function expressions are explicitly rejected by binding until
their recursive self environment has typed closure lowering. Arguments objects,
primitive boxing, Annex B functions, generators and async execution remain gaps.

The refreshed [full pinned syntax inventory](results/test262-full-syntax-summary-v3.json)
accepts 50,580 positive variants, 285 more than v2. Across all 103,264 variants the
remaining counts are 21,428 rejected, 25,455 unsupported, 5,561 negative rejections
not yet certified for the required phase, and 240 unexpectedly accepted negative
variants. These are parser-only observations. All 1,627 workspace tests, TypeScript
build/test/host checks, package boundaries and formatting checks pass for this slice.

Self-hosting remains verified: `stage1-named-functions-v1` rebuilt frozen
`source-named-functions-v1` into `stage2-named-functions-v1` with native exit zero.
Both debug-enabled images are byte-identical at 45,133,050 bytes, SHA-256
`04ddee13b7a96b56e3328300ed6998b47e6be8fd9187141206159912529f3044`.
Both pass DWARF verification.

## Native deletion

Script `delete` now uses resolved references and existing property/environment
primitives. Strict identifier deletion is an early syntax error, while failed strict
property deletion throws TypeError. Sloppy non-deletable references return false;
unresolvable references return true. Property deletion evaluates the base and key
once without invoking a getter. Deleting a non-reference evaluates its operand and
returns true. String wrapper length and canonical in-range indices are protected;
other primitive property deletion avoids allocating wrappers. This follows the
[delete evaluation rules](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-delete-operator).

All 599 native Script fixtures and 1,630 workspace tests pass. The 28 added fixtures
cover configurable/inherited properties, strict/sloppy failures, evaluation order,
nullish bases, non-reference operands, TDZ/global/parameter/self bindings, and
primitive deletion. TypeScript build/test/host checks, package boundaries and
formatting pass. Full syntax acceptance rises by 1,082 positive variants in
[inventory v4](results/test262-full-syntax-summary-v4.json); this is not conformance.
The unchanged descriptor harness now stops at `for…in`, after passing its previous
`delete` parser blocker. Optional chaining, super/private names, object property-key
coercion and typed-profile deletion remain separate work.

The full native delete-family run records 47 passes, 29 failures, 25 unsupported
variants and two explicit LLDB attachment failures across 103 variants. Both launch
failures pass in separate rechecks; the original report remains unchanged. Missing
Object/reflection, Math, JSON, RegExp and eval explain the failing sources. See the
[full selection and rechecks](test262.md#historical-reports) rather than
inferring family completeness from the native fixtures.

The debug-enabled `stage1-delete-v1` self-build exits zero and recreates
`stage2-delete-v1` from frozen `source-delete-v1` byte-for-byte: 45,149,562 bytes,
SHA-256 `6da46760e1ce5047ef284a7e2b66cd92330bdbdf12fa50802f41af8bfb78a9ef`.
Both images pass DWARF verification.

## Ordinary enumeration and for-in declaration heads

`@tint/js-runtime/objects` now exposes reusable ordered, prototype-aware enumeration
state and stepping. It checks descriptors when visiting a key, never invokes
getters, remembers non-enumerable shadows, ignores symbols, and observes deletion
without losing access to inherited keys. Mutation choices follow the specification's
[For-In Iterator reference algorithm](https://tc39.es/ecma262/2025/multipage/ecmascript-language-statements-and-declarations.html#sec-for-in-iterator-objects).
A standalone native fixture verifies the helper independent of Script lowering.

Declaration-form for-in now parses, binds, rewrites and lowers for ordinary-object
sources, with per-iteration lexical environments and TDZ on the head RHS. The 615-case
native Script corpus passes; six selected unchanged Test262 variants pass while two
fresh-binding variants fail at missing Object.create. See the complete
[selection evidence](test262.md#historical-reports), including the unchanged
harness's next arguments-object blocker. Assignment heads, binding patterns, wrappers,
Annex B initializers and typed-profile for-in are not claimed implemented.

The full syntax inventory accepts 52,465 positive variants, 803 more than v4.
Eight newly parser-accepted negative variants are rejected by binding before
execution; inventory v5 deliberately reports the parser-only result separately.

All 1,636 workspace tests pass, along with TypeScript build/test/host checks,
package boundaries and formatting. The expanded native fixture corpus also covers
nested loops, continue/return through finally, catch-parameter var writes, and
single evaluation of the iteration source.

The debug-enabled `stage1-forin-declarations-v1` rebuilds frozen
`source-forin-declarations-v1` into byte-identical `stage2-forin-declarations-v1`,
exiting zero. Both images are 45,182,586 bytes with SHA-256
`588430f272145a2385d306cbb7bc1f2398743e8c8b24638cb29c276cf4eb7a2b` and both
pass DWARF verification. Remaining for-in forms are still part of the active goal.

## For-in assignment heads

Reference heads now parse, bind and execute through the same enumeration loop as
declaration heads. Each iteration captures its identifier or property reference
once after obtaining the key; empty sources never evaluate the target. Existing
write operations enforce strictness, TDZ/const checks and receiver-aware setters.
Native fixtures additionally verify no getter reads and deletion during setter calls.

The 632-case native Script corpus and all 1,637 workspace tests pass, along with
TypeScript build/test/host checks, boundaries and formatting. Six unchanged native
Test262 variants pass, while the larger sloppy-let test remains explicitly unsupported
at an array expression. [Recorded results](test262.md#historical-reports)
separate these outcomes from the 48 additional positive syntax acceptances in v6.

The debug-enabled `stage1-forin-assignment-v1` rebuilds frozen
`source-forin-assignment-v1` into byte-identical `stage2-forin-assignment-v1` and
exits zero. Both images are 45,314,682 bytes, SHA-256
`6d164b0b2775f66f386b081ddaf74e3c21de5911c06c9d075b90d6d3b9ed5a41`.
Both pass DWARF verification. Remaining iteration forms and arguments/reflection
infrastructure remain within the active coverage goal.

Optional-chain Script execution is verified by 35 new native cases and the complete
76-variant Test262 selection: 28 pass, 4 fail, 44 unsupported; see
[test262.md](test262.md#historical-reports).

Identifier rest parameters now execute in native functions, arrows and classes.
The complete rest-parameter Test262 selection passes 14 of 22 variants; two need
Function.prototype.apply and six remain unsupported. Syntax inventory v14 accepts
56,599 variants, up 50 without losing any previously accepted input.

Template substitutions now execute natively. Syntax inventory v15 accepts 59,360
variants, up 2,761 from v14 without regressions. The full template-literal selection
records 52 passes, two eval-dependent failures and 60 unsupported variants. Native
fixtures also cover debugger statements and the array-stringification prerequisite;
see [the execution record](test262.md#historical-reports).

Typed templates now cover fixed string, number, boolean, undefined and null inputs.
Binder diagnostics exercise them in compiler source; the native typed-template and
private-syntax fixtures pass. Broad tagged-template and iterator work remains.

## Tagged templates and property-helper prerequisite (2026-10-31)

Scripts support tag references, receiver/evaluation-order preservation, raw/cooked
segments, invalid cooked escapes, and frozen template objects cached by source
site within each realm. The v16 syntax inventory accepts 59,449 variants (+89,
no accepted variants lost). The compiler self-build remains byte-identical.
Typed tag calls and proper tail calls remain gaps.

The original tagged-template native report has 25 passes of 48 variants, including
14 pre-execution debugger failures and two actual deep-tail-call faults among its
16 crash outcomes. The remaining failures/unsupported cases involve eval, Function
source compilation or realm host support. Its two property-helper harness errors
are fixed by adding the initial Math.pow surface; the unchanged descriptor test
passes both variants in a separate report. Math.pow supports integral exponents
and special values; general positive-base fractional powers remain unsupported.

## Exponentiation (2026-10-31)

Syntax accepts ** and **= with right associativity and rejects unparenthesized
unary bases. Scripts use the same numeric power core as Math.pow; compound
assignment captures the reference and reads its value once before evaluating the
right side. Integral powers and specified special-value cases are implemented;
general positive-base fractional powers and strict typed-profile exponentiation
remain unsupported. Math constants are now available for numeric-language tests.

The v17 syntax inventory accepts 59,641 variants (+192, no lost accepted cases or
newly accepted negatives). The 1,215-case native Script fixture and native lowerer
pass. The refreshed self-build is byte-identical and passes DWARF verification. The
first exponentiation report has 50 passes, 10 failures and 28 unsupported variants
out of 88. Eight Math-constant-dependent failures pass in focused reruns after
adding constants; the other failing test requires Symbols. The full v2 report
records 53 passes, two Symbol-dependent failures, 28 unsupported variants and five
pre-execution debugger attach failures.

## Object binding patterns (2026-10-31)

Declarations and catch parameters support object patterns with aliases, nested
patterns, computed keys, undefined-only defaults and rest. Script lowering creates
bindings before ordered initialization, preserving TDZ and abrupt completions.
Catch-pattern var conflicts are early errors; simple catch identifiers retain their
existing exception. Object spread and rest share CopyDataProperties.

Syntax v18 adds 429 accepted declaration variants; v19 adds 62 catch variants,
reaching 60,132 without accepted-input regressions or new accepted negatives.
The const/dstr native selection records 51 passes, 130 unsupported variants and
five pre-execution attach failures out of 186. Array patterns, parameter/assignment
patterns, object for-in/of heads and typed-profile destructuring remain gaps.

Object iteration declarations now parse in for-in/of heads. Script for-in lowers
patterns per enumerated string key with fresh lexical bindings, computed keys,
defaults and rest. The expanded 1,270-case native fixture and native lowerer pass.
Syntax v20 adds 324 accepted variants (60,456 total), with no accepted-input
regressions or new accepted negatives. Generic Script for-of and typed object
iteration remain gaps; the earlier object-head gap above is superseded by this
syntax and for-in execution extension.

Object parameters now parse and execute in Scripts, including functions, arrows,
methods, constructors and rest-argument object patterns. Shared parameter visitors
preserve bound names, nested defaults and computed-key evaluation. Parameter/body
environments, TDZ, closures, unmapped arguments and function length are covered by
native cases. Syntax v21 accepts 61,716 variants (+1,260, no accepted-case regressions
or new accepted negatives). The 1,292-case native fixture and native lowerer pass.
Array parameters, assignment patterns and strict typed-profile parameter patterns
remain gaps.

Object assignment patterns now parse and lower in Scripts, including nested
patterns, defaults, property references, rest and for-in assignment heads. The
parser defers cover-grammar errors while retaining ordinary object-literal
restrictions. Syntax v22 adds 249 accepted variants (61,965 total) without
accepted-input regressions or new accepted negatives. The separate 15-variant
assignment/destructuring native selection records four passes and 11 unsupported,
with no failures, crashes, harness errors or timeouts. The larger assignment/dstr
selection and final custom native execution validation are running. Array patterns,
strict typed-profile destructuring and the legacy Object.prototype.**proto**
accessor remain gaps.

Final custom assignment validation passes all 1,315 native Script cases and the
native parser/lowerer. All 1,752 workspace tests and type checks pass. The legacy
accessor dependency described above was isolated from the syntax fixture; the
unchanged Test262 own-property duplicate-name case continues to pass.

Symbol primitives now execute in Scripts through native code. Coverage includes
construction, registry operations, description/valueOf/toString, boxing, property
keys, object-rest copying and reflection, symbol-named fields/methods, function-name
inference, typeof, equality and conversion errors. ToPrimitive observes the
well-known hook with the correct hint; Object.prototype.toString observes
Symbol.toStringTag. Registries can be explicitly shared across realms while
prototype identities remain realm-local.

The 1,352-case native Script fixture and native parser/lowerer pass. The previously
failing six Symbol-dependent assignment/dstr variants pass in separate new reports.
Object.getOwnPropertySymbols now passes 16/24 selected variants; the remaining
eight require Proxy. The broader Symbol suite is running. Symbol.iterator identity
is exposed, but generic iteration/array iterators are not implemented by that fact.
Other well-known hook consumers, cross-realm host APIs, Proxy and BigInt remain gaps.

### Iterator protocol and synchronous for-of

The portable `@tint/js-runtime/iterators` package supplies iterator acquisition,
cached next methods, stepping, value extraction and IteratorClose through explicit
host hooks. The Script adapter uses ordinary property access and calls, preserving
receiver identity and abrupt-completion precedence. Next/done/value failures mark
the iterator done; early exit closes it, while normal exhaustion does not.

Script arrays expose values/keys/entries and their default iterator; strings iterate
Unicode code points. Iterator prototypes, brands, result objects and toStringTag
properties are installed per realm. Arguments objects retain the original array
values intrinsic as their default iterator. Array-like length conversion and array
creation now live in shared helpers.

Synchronous for-of uses this protocol for declaration and assignment heads,
recursive binding patterns, per-iteration lexical environments and cleanup on
abrupt completion. Spread, generators and async iteration have since gained
separate implementations and regression coverage; see their sections and the
[Test262 dashboard](test262.md) for measured selections.

The abstract Iterator constructor and its inherited constructor/tag accessors are
installed per realm. Iterator.from preserves existing Iterator instances and wraps
other iterable or direct iterator objects, caching next and forwarding return.
Eager consumers share the existing stepping/close primitives. Lazy helpers use
the generator state machine with a separate brand, including reentrancy rejection
and cleanup before the first yield. Mapping/filtering and flatMap regression fixtures pass natively; take/drop passed
7 of 8 cases with one pre-entry debugger failure. Complete-selection validation
continues. Live Map and Set iterators share the common iterator prototype; the
complete Set family passes 730/764 variants. Includes/join, chunks/windows and static concat
reuse the same protocol and helper state machine. Iterator disposal forwards to
`return` without requiring an object result. All 23 native regressions for these
additions pass. The complete Iterator family passes 1,350/1,368 variants: 12 failures
need JSON.stringify in the unchanged harness and six require dynamic Function construction. See the
[dashboard](test262.md) for immutable evidence. Zip and zipKeyed share that helper
prototype and support shortest, longest and strict modes, padding and reverse
cleanup. Their 9 native regressions pass. The [joint-iteration/URI self-build](results/bootstrap-joint-iteration-uri-v1.json)
is byte-identical with verified DWARF.

Take/drop follow the pinned suite and current ECMAScript rule rejecting finite
limits above Number.MAX_SAFE_INTEGER while accepting positive infinity ([current specification](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.prototype.drop)). This is
newer than the ECMAScript 2025 text and Node 24 reference behavior; the limit fixture
therefore uses specification assertions rather than Node as its oracle.

Flat array bindings in iteration heads now use the shared iterator protocol.
Elisions do not access value getters; empty patterns close without stepping;
defaults run only for undefined and observe the per-iteration lexical environment.
The nested iterator closes on early completion, and a failure propagating to the
outer loop closes that iterator according to the same completion rules. A shared
lowering helper now generates both cleanup paths. All 1,400 native Script fixture
cases and the native parser/lowerer pass under LLDB. Both Test262 variants of
`for-of/head-let-destructuring.js` pass in
`results/test262-for-of-array-head-native-v1.json`.

This slice does not add nested/rest array patterns or array declarations outside
iteration heads. The typed profile explicitly rejects array iteration defaults
until its lowering supports them; it must not silently ignore the initializer.

The subsequent array-default syntax inventory v24 accepts 62,294 variants
(+118 from v23), with no previously accepted inputs lost and no newly accepted
negatives. See `results/test262-full-syntax-summary-v24.json`.
All 1,769 workspace tests and both host/test type checks pass.

Frozen self-hosting checkpoint `iteration-v1` completed with identical stage 1
and stage 2 images (47,952,138 bytes; SHA-256
`0ec107c1fe79bea3dc9565c0d4e2a0780f3351bf2ea203f7e59300ae1c3899e6`).
Both images pass DWARF verification. This snapshot includes iteration assignment
heads and precedes the later flat array-binding/default changes, whose native
parser/lowerer and Script fixtures pass independently.

The frozen `iteration-v2` checkpoint includes flat array bindings and defaults.
Stage 1 and stage 2 are identical (47,968,650 bytes; SHA-256
`a94bfdcc4836d40fa911a7531f85f9780cf83d320fd0d92c3904c1e3f83306ab`),
and both pass DWARF verification. Rest-element support follows this snapshot.

Array rest bindings in iteration heads now collect remaining iterator values into
a fresh Script array, preserving elisions, defaults, lexical scope and exhaustion.
The shared syntax traversal/rewriting/linking contracts retain the rest binding.
The typed profile rejects rest heads explicitly until its lowering implements
them. The native fixture passes all 1,405 cases; the native parser/lowerer passes
after one recorded LLDB attach failure and a successful same-binary retry.
Both variants of `for-of/dstr/const-ary-ptrn-rest-id-direct.js` pass in
`results/test262-for-of-array-rest-native-v1.json`.

Full syntax inventory v25 accepts 62,698 variants (+404), with no accepted-input
regressions or newly accepted negatives. General/nested array binding patterns
and array assignment patterns remain the next syntax expansion.

Final validation for the iteration/rest slice: all 1,771 workspace tests pass;
production, test and host type checks pass; formatting and dependency boundaries
pass across 74 portable packages. The 1,405-case native Script fixture and native
parser/lowerer pass. The latest frozen self-build remains the byte-identical
`iteration-v2` checkpoint described above.

### Completed broad Symbol run

The restarted `built-ins/Symbol` native run completed with 192 variants:
135 passed, 42 failed and 15 reported crashes. Every crash is an LLDB attach/pause
failure before execution; none is evidence of a target-code fault. There were no
unsupported outcomes, timeouts or harness errors.
Report: `results/test262-symbol-native-v2.json`. The interrupted v1 artifacts
remain separate.

The failures comprise 34 cross-realm variants requiring missing host facilities,
two constructor-capability checks, two removed-ToPrimitive coercion cases and four
species getter/subclassing cases. The constructor check also requires
Reflect.construct, but inspection exposed a separate implementation defect:
Symbol was marked nonconstructible instead of having a throwing [[Construct]].
The removed-ToPrimitive cases throw TypeError and require further isolation;
they are not attributed solely to their later Date dependency. Species tests need
missing intrinsic getters and built-ins.

The Symbol constructor-capability defect is now corrected: Symbol has a throwing
[[Construct]], allowing a class to extend it while rejecting a super call before
description conversion. A derived constructor can return its own object without
calling super. All 1,409 native Script fixture cases, 1,771 workspace tests, type
checks, formatting and dependency checks pass. The broad Symbol v2 report predates
this correction and remains unchanged; its Reflect.construct-dependent test is
not claimed to pass.
Reference: https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-symbol-constructor

### Iterator-based array literal spread

Script array literals now consume arbitrary synchronous iterables for spread
elements through the shared iterator adapter. Index tracking preserves ordinary
elements, elisions and trailing holes around spreads. Unicode strings use their
code-point iterator. Iterator stepping failures propagate without an extra close.
The same lowering supports multiple spreads and evaluates each operand in order.

All 1,772 workspace tests, host/test type checks, formatting and package boundaries
pass. The expanded 1,413-case native Script fixture and the native parser/lowerer
fixture both exit with the expected status under LLDB. This does not yet implement
call/constructor spread or nested/general array binding patterns, and does not
change the previously recorded Test262 runtime counts.

### Call, constructor and super argument spread

Argument-list parsing now accepts spread expressions. Script lowering shares one
argument collector across ordinary calls, method calls, construction and super
calls. The collector consumes the existing synchronous iterator adapter into an
internal argument list. Callees/receivers and the super constructor are captured
before argument evaluation; optional-call short-circuiting skips collection.
Prepared argument lists used by other lowering paths retain their explicit
contract.

All 1,773 workspace tests, host/test type checks, formatting and package boundary
checks pass. The native Script fixture passes 1,418 cases, and the native
parser/lowerer fixture passes with call and constructor spread syntax. Nested and
general array binding/assignment patterns remain outstanding.

### Recursive array assignment patterns

Script array assignments now support elisions, defaults, rest and recursively
nested object/array targets, including for-of assignment heads. Reference targets
are captured before stepping the iterator; nested patterns begin after extraction.
The existing shared cleanup helper handles early completion and assignment errors.
The binder now propagates write access through array and spread targets.
Rest trailing commas, misplaced rest and non-reference targets are rejected.

All 1,775 workspace tests, host/test type checks, formatting and package boundaries
pass. The 1,426-case native Script fixture and native parser/lowerer pass after
preserved pre-execution LLDB attach failures and successful same-binary retries.
The targeted Test262 for-of array-assignment report records one strict-mode pass
and one sloppy-mode LLDB attach failure, with no semantic failures:
`results/test262-for-of-array-assignment-native-v1.json`.
Nested/general array declaration bindings and parameters remain outstanding.

Syntax inventory v26, after call spread and recursive array assignments, accepts
63,674 variants (+976 from v25). No previously accepted inputs were lost and no
new negative tests were accepted; 542 accepted negative variants remain.
See `results/test262-full-syntax-summary-v26.json`. The broad assignment/dstr
native rerun is in progress in `results/test262-assignment-dstr-native-v2.json`;
an unfinished report must not be treated as final conformance evidence.

### Shared recursive binding patterns

Array and object patterns now share VariableBinding across declarations, loop
heads, parameters and catch bindings. Arrays carry recursive elements/rest,
annotations and outer defaults. Parsing uses the common recursive binding parser;
name/expression traversal, rewriting, linking and Script initialization follow the
same structure. Rewrites retain hashes and source origins. Typed-profile paths
explicitly reject unsupported nested patterns rather than silently lowering them.

Native validation passes 1,435 Script cases and the parser/lowerer fixture
(after a recorded pre-execution attach failure and same-binary retry). All 1,778
workspace tests, type checks, formatting and package boundaries pass. Additional
catch-array early-error checks confirm duplicate names and conflicting var names
are rejected by the binder.

The enlarged fixture exposed the export resolver's graph-wide name cross product.
Resolution now enumerates each module's own and star-reachable export names,
preserving explicit-export validation, cycles, ambiguity and depth/work guards.
A 710-module regression reproduces the former budget failure and now passes.

Syntax inventory v27 accepts 67,237 variants (+3,563), with no lost accepted
positives. Two newly parsed negative variants are duplicate catch bindings;
binder rejection is independently verified, while the parse-only inventory
honestly retains them in its accepted-negative count (544).
See `results/test262-full-syntax-summary-v27.json`.

### Symbol.hasInstance and ordinary fallback

Script instanceof now obtains Symbol.hasInstance before requiring a callable
fallback, invokes custom hooks with the right-hand object as receiver and the
left-hand value as its sole argument, and converts the result to Boolean.
Function.prototype installs its non-writable/non-configurable ordinary hook.
OrdinaryHasInstance returns false for non-callable receivers and delegates bound
targets through InstanceofOperator, so target overrides remain observable.
The former combined ordinaryInstanceOf API is replaced by explicit operator and
ordinary-operation contracts, and all callers are migrated.

All 1,779 workspace tests, type checks, formatting and boundaries pass. The native
Script fixture passes 1,445 cases, and the native parser/lowerer passes.
Both variants of the focused Test262 hook-invocation case pass in
`results/test262-hasinstance-invocation-native-v1.json`.

The frozen `bindings-v1` native self-build completed successfully. Stage 1 and
stage 2 are byte-identical (48,216,010 bytes; SHA-256
`9305000b0958dba5c11671d50540fb0f48a368a57f5cc0fea0b1e0796dd1b6f1`).
Both images pass DWARF verification. This checkpoint includes recursive binding
patterns and the export-resolution work fix; it precedes Symbol.hasInstance.

### Labelled statements and targeted control flow

Labels now flow through parsing, binding, syntax rewriting, linking, checking
and native lowering. The parser rejects duplicate active labels, undefined
jump targets, continues to non-iteration labels, and jumps across function or
class static-block boundaries. Chained labels can designate the same iteration.
Annex B labelled function declarations remain unsupported.

Script lowering attaches iteration labels to generated loops inside their
IteratorClose scopes. Scalar lowering resolves named break/continue destinations
and unwinds the finally scopes between source and destination. Classic-for
updates and do-while tests still run on labelled continues. Typed checking keeps
conservative entry facts across labels; precise named-target completion and
assignment inference remain follow-up work.

The native Script fixture passes 1,463 cases, including nested labelled jumps,
finally overrides and iterator cleanup. The native parser/lowerer also passes,
and all 1,781 unit tests pass. Focused Test262 labelled outer-loop continue and
IteratorClose-on-outer-continue each pass both variants. Full syntax inventory
v28 accepts 67,362 variants (+125), with no previously accepted inputs lost and
no newly accepted negative tests. Native self-build validation of this revision
is being run separately; these fixtures do not establish self-build parity.

The `verify-hosted-labels.ts` native fixture executes a labelled-loop program and
then parses, checks, lowers and emits that program natively. Its machine-code
bytes exactly match the Node bootstrap output; the fixture exits 42. This also
exercises mutable label-target registration in the native compiler itself.

The broader labelled-statement Test262 run completed with 37 variants: 8 passed,
4 failed, 24 unsupported, and one genuine native crash. The four runtime failures
are the completion tests requiring missing eval. The crash is the proper-tail-call
stress test (EXC_BAD_ACCESS after execution began), not an LLDB attach failure.
Twenty-two unsupported variants are unverified parse negatives or module negatives;
the other two exposed sloppy `let`-expression ASI in Statement-only positions.
See `results/test262-labelled-statements-native-v1.json`.

That ASI gap is now fixed, preserving the `let [` expression restriction.
The two previously unsupported labelled-let tests each pass natively in focused
reports `results/test262-labelled-let-block-native-v1.json` and
`results/test262-labelled-let-identifier-native-v1.json`. Syntax inventory v29
accepts 67,374 variants (+12 from v28), also covering the corresponding if/while/
for/for-in/for-of cases, with no accepted-input losses or new negative acceptance.
All 1,782 unit tests pass. The frozen labels-v1 self-build precedes this ASI fix.

The final labelled-control-flow native fixture passes 1,465 cases, including the
ASI fix. The frozen labels-v1 self-build completed successfully: both images are
48,716,234 bytes and have SHA-256
`de0610c1d2f55be9df1ddf6f0c35270e7fc7d50554f224962321929ab76c14a5`.
Both pass DWARF verification. This snapshot validates the compiler changes for labelled control flow; it
precedes the subsequent sloppy-let ASI adjustment and does not execute Script
intrinsics.

The completed assignment/destructuring native run v2 has 640 variants: 439 passes,
zero semantic failures, 189 unsupported and 12 LLDB attach/pause failures before
execution. Its runtime graph was captured before the subsequent recursive-binding
and labelled-control-flow changes, so it does not certify those later changes.
See `results/test262-assignment-dstr-native-v2.json`. The function/destructuring v2
run completed against the expanded recursive binding implementation: 292 of 372
variants passed (78.5% of that selection), 80 were unsupported, with no semantic
failures, crashes, timeouts or harness errors. Of the unsupported cases, 56 use
generators and 24 are parse-negative variants whose rejections are not yet
certified by the native adapter. See
`results/test262-function-destructuring-native-v2.json`.

Synchronous generators execute through native continuation segments, including
blocks, branches, loops, labels, switch, delegation, catch/finally and IteratorClose.
Pending completions survive suspended finalizers. Async generators and dynamic
GeneratorFunction construction remain unavailable. See [generator architecture and
verification](generators.md) and [current Test262 measurements](test262.md#current-coverage).

Syntax inventory v31 accepts 74,262 of 103,264 variants (71.9%, not a native pass
rate), adding 6,888 accepted positives over v29 without acceptance losses. Of 63
newly parsed negatives, binding rejects 59 and reports four unsupported Annex B
block-function cases. See [syntax report](results/test262-full-syntax-summary-v31.json)
and [negative binding audit](results/test262-generator-negative-binding-v1.json).
