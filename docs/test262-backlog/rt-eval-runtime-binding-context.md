# RT-EVAL D6a: runtime binding context for `RuntimeModuleTransform`

Status: **implemented with Node and native fixtures passing.** The pass-scoped
context, shared element relation, final agreement and retry-consultation guard
are covered by unit tests and the full 78-alias Script vocabulary. The
[focused native fixture](../results/native-runtime-binding-context-direct-v2.json)
covers numeric/string helpers, invalid subjects, expired contexts and missing
helper diagnostics. Its current-source fixed point remains pending. Parent:
[managed-entry lowering](rt-eval-managed-entry.md), slice D6a.

Captured 2026-11-04 against live source identity `0b92e7c7…` (530 files,
`workspaceSourceIdentity`). The probes are read-only Node scripts in
`/tmp/tint-runtime-binding-context-plan` (`p0`–`p5`). `runtime-ctx.mts` is a copy
of `ts-native/src/runtime/index.ts` with the proposed context added. The probes
import public `dist` entry points and `tools/workspace-sources.ts`. They emit no
image, execute no native code and write nothing in the workspace. **Every time and
count below is Node-only, from single runs. No native or performance claim follows
from them.**

## 1. Answer in brief

1. **The cycle is real.** `prepareCollectionPass` calls `transform` (index.ts:238)
   before the final `checkClosureModule` (:240). The binding index (:249), the final
   demand (:299) and every `ListRuntimeBinding`/`SetRuntimeBinding`/`MapRuntimeBinding`
   are computed from that check. The D6 bind body must name runtime instances inside
   the transform, so the eager `RuntimeBindingNames { checked, lists, … }` in the
   original D6a cannot exist when the transform runs.
2. **What is known before the transform.** The pass input graph (`observed`), its
   demand, the extended type array `types`, every request and
   `specializedValue.roots`. Final selection is a deterministic function of the
   final element and those requests. It picks the **first** start whose specialized
   parameter type is mutually assignable with the element.
3. **Chosen design: a lazy, subject-based context with same-pass agreement.** The
   transform asks `context.collection({function, parameter})` about a top-level
   function in the pass input, normally a compiler collection anchor. The context
   applies the final selection rule, but in the observed graph against request
   arguments. It records the answer. After the final check and final selection _of
   the same pass_, every record is re-derived in the final graph. Agreement is
   checked by function identity, and any difference is a hard error. Type IDs never
   cross graphs. Only names (strings) and request indexes link the two sides.
4. **Probe result.** With the real `scriptRuntimeSurface` vocabulary, all 78
   collection anchors (71 array, 6 Map, 1 Set) agree on the final pass. They resolve
   to 35 distinct operation sets (300 names), and 43 anchors share an
   earlier equal-class set. The final binding counts (79/1/17) are unchanged by the
   bind body. On a small fixture the bind body forces a retry, and the Map/Set names
   **change between passes** (`__tint_specialized_37` → `_61`). Names are therefore
   per-pass facts.
5. **Cost.** If the transform is absent, no context is created. An unused context
   builds nothing (0 type systems, 0 binding indexes). Using 78 subjects costs about
   3.8 ms over 2 passes. A provisional full check of the transform input would cost
   124 + 256 ms per preparation, against about 450 ms for the whole preparation.
6. **One hazard needs a rule.** A transform that caches pass-1 names and skips the
   context on retry passes silently in the probe. On pass 2 those names denote
   other functions. D6a adds two rules for this: a context is closed when its
   transform returns, and every subject asked in an earlier pass must be asked again
   in the final pass.

## 2. The dependency, from source

| Step (one `prepareCollectionPass`)                      | Graph                     | Known names                         |
| ------------------------------------------------------- | ------------------------- | ----------------------------------- |
| `collectRuntimeRequirements(checked)` → `demand`        | observed (pass input)     | —                                   |
| `request(…)` per demand entry; `optional`/`primitive`   | `types` = observed + tail | helper (generic) names              |
| `specializeCheckedRoots(module, types, requests)`       | re-specializes `module`   | `specializedValue.roots[start + k]` |
| **`transform(specializedValue.module)`**                | syntax only               | roots, helpers                      |
| `checkClosureModule(transformed)` → `prepared`          | final (prepared)          | function IDs                        |
| `collectRuntimeRequirements(prepared)` → `current`      | final                     | —                                   |
| `listStarts.find(matches(element, param(root(s,2),2)))` | final                     | the options lowering uses           |
| `missing(…)` → `retry = prepared`, next pass            | final becomes observed    | everything is recomputed            |

Facts that constrain the design:

- `module` is always the normalized `application`. Each pass re-specializes it
  from scratch with that pass's requests. `__tint_specialized_n` numbering
  therefore depends on the request list, which grows on retry.
- Generic helpers are gone from the specialized module (p4: `createList`,
  `createMap` and `createSet` are absent, 0 generic functions remain). Number-list,
  primitive-value and number-text helpers are nongeneric and survive under their
  linked names. Rerunning preparation recursively on the specialized module
  therefore cannot find its templates.
- Lowering looks bindings up by exact element ID (`lists.find(l => l.element ===
element)`, `closure/lowering/index.ts:1633`), where `element` is
  `arrayElement(prepared, type)`. Equal-class duplicates with different IDs are
  separate bindings. All of them select the first matching start, so they share
  instances. The fixture's `A = P[]` and `B = {x:number}[]` both use
  `__tint_specialized_0…7`.
- Dense reference lists (`compiler/src/native/index.ts:821`) key their known
  method set off `options.lists` runtime IDs. An instance that is equal in class
  but _not selected_ (an unused duplicate start) is outside that set. Exporting it
  would bypass the dense rewrite's final-instance semantics. Exact final names
  are a correctness requirement, not just a tidiness one.

## 3. Designs considered

| Design                                                             | Verdict                                                                                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Eager `RuntimeBindingNames` argument (original D6a)             | Impossible as specified: the final bindings do not exist yet, and its element IDs would belong to a graph the transform never sees.                 |
| B. Provisional full check of `specializedValue.module` per pass    | Correct only with agreement anyway. Costs 124 + 256 ms (p4), and the default pipeline would pay it unless gated. Rejected.                          |
| C. Transform after final selection, then re-check                  | A second full check per pass, and the transform output can add demand, so the loop still needs agreement. Rejected.                                 |
| D. Recursive `prepareCollectionRuntimes` on the specialized module | Generic templates are absent (p4), and it would amount to a second generic specialization pass. Rejected.                                           |
| E. Placeholder names renamed after the check                       | Renaming invalidates span-keyed checked identity (`createPreparedBindingIndex`). Rejected.                                                          |
| F. Match by physical ABI or layout equality                        | Grants authority from ABI equality. Forbidden.                                                                                                      |
| **G. Lazy subject context + same-pass agreement**                  | **Chosen.** It predicts with the final rule in the observed graph, verifies in the final graph by function identity, and costs nothing when unused. |

## 4. Contract

### 4.1 Public types (`@tint/ts-native/runtime`)

```ts
export type ListOperationName =
  "create" | "read" | "write" | "push" | "length" | "has" | "delete" | "resize";
export type SetOperationName =
  | "create"
  | "has"
  | "add"
  | "delete"
  | "clear"
  | "size"
  | "clone"
  | "iterator.create"
  | "iterator.advance"
  | "iterator.read";
export type MapOperationName =
  | "create"
  | "get"
  | "has"
  | "set"
  | "delete"
  | "clear"
  | "size"
  | "iterator.create"
  | "iterator.advance"
  | "iterator.key"
  | "iterator.value";
/** A top-level, nongeneric function of the pass input (normally a compiler
 * collection anchor) whose parameter type is the collection to name. */
export interface RuntimeBindingSubject {
  readonly function: string;
  readonly parameter: number;
}
/** Element IDs index `RuntimeBindingContext.observed` only. */
export type RuntimeCollectionNames =
  | {
      readonly kind: "list";
      readonly element: CollectionElement;
      readonly operations: ReadonlyMap<ListOperationName, string>;
    }
  | {
      readonly kind: "set";
      readonly element: CollectionElement;
      readonly operations: ReadonlyMap<SetOperationName, string>;
    }
  | {
      readonly kind: "map";
      readonly key: CollectionElement;
      readonly value: CollectionElement;
      readonly operations: ReadonlyMap<MapOperationName, string>;
    };
export type RuntimeCollectionLookup =
  | { readonly ok: true; readonly value: RuntimeCollectionNames }
  | { readonly ok: false; readonly error: string };
/** Valid only during one transform call of one pass. */
export interface RuntimeBindingContext {
  /** The pass input graph (the caller's graph on pass 1, the previous final graph on retries). */
  readonly observed: CheckedClosures;
  collection(subject: RuntimeBindingSubject): RuntimeCollectionLookup;
  primitives(): ReadonlyMap<keyof PrimitiveRuntime, string> | undefined;
  numberText():
    { readonly toString: string; readonly fromString: string } | undefined;
}
export type RuntimeModuleTransform = (
  module: Module,
  context: RuntimeBindingContext,
) =>
  | { readonly ok: true; readonly value: Module }
  | { readonly ok: false; readonly error: string };
```

Operation names are the `ListRuntime`/`SetRuntime`/`MapRuntime` field paths, so the
D6d directory and the D6f matcher reuse one vocabulary. Existing callers of the form
`(module) => …` still type-check and ignore the argument. List `sort` is not
exposed: the census excludes it (parent §7.5). Number-element lists (`"number"`,
including optional-number and never-element arrays) return the fixed number-list
helper names. `primitives()` and `numberText()` return the linked helper names that
the final options use (`helper("primitive-value", …)` and
`helper("number-text", "numberToString" | "stringToNumber")`). They return
`undefined` exactly when the final options omit them. These names are
graph-independent and need no prediction.

### 4.2 Prediction rule (inside `collection`)

1. On first use only: `index = createPreparedBindingIndex(observed)` and
   `matcher = createElementMatcher(types)`, where `types` is the pass's extended
   array (observed types plus appended primitives and `optional` unions, complete
   before `specializeCheckedRoots`).
2. `fn = index.functionId(subject.function)` (a top-level declaration of the
   observed module), then `t = index.parameterType(fn, subject.parameter)`.
3. Classify with the lowering's own `arrayElement` / `setElement` / `mapEncoding`
   on `observed`, in that order.
4. Select a start using the final rule's order and relation. The difference is that
   the specialized parameter is replaced by the request argument it was reified
   from:
   - list: the first `s ∈ listStarts` with `matcher.matches(E, requests[s].arguments[0], optional = true)`;
   - Set: the first `s ∈ setStarts` with `matches(E, requests[s].arguments[0], false)`;
   - Map: the first `s ∈ mapStarts` with both key and value `matches(…, false)` on arguments 0 and 1.
5. Return `roots[s + k]` keyed by the operation table, and record
   `{subject, kind, start}` (or `number`).

`createElementMatcher` is the current `presentAssignable`/`matches` pair, moved out
unchanged and parameterized by a type array. The final selection uses it over
`prepared.types` and the context uses it over `types`. One relation is shared and
neither graph's IDs reach the other.

### 4.3 Agreement rule (after final selection, same pass)

The rule runs only when records exist. It runs after the existing `missing`
checks, so a pass that will retry discards its records with the pass. For each record:

1. Re-derive `t'` from `bindingIndex` (the final index already built at :249). If
   it is absent, fail with
   `runtime binding subject disappeared after transform: <function>`.
2. Classify `t'` in `prepared`. The final binding is the one lowering would use:
   `lists.find(b => b.element === arrayElement(prepared, t'))`, and the same for
   Sets and Maps.
3. Every operation's function ID must equal `functionId(name)` for the recorded
   name. Otherwise fail with
   `runtime binding names changed after transform: <function>`.

Agreement failures are hard errors, not retries. A deterministic divergence
between the observed-side and final-side relations would recur on every pass.

### 4.4 Pass discipline

- A new context is created for each pass and **closed** when the transform returns.
  Calls after that return `{ok:false, error:"runtime binding context is closed"}`.
- **Consult on retry.** `prepareCollectionRuntimes` keeps the union of subjects
  asked in earlier passes. The final successful pass must have asked each of them,
  or it fails with `runtime binding context was not consulted on retry: <function>`.
  This catches the probe-reproduced stale-cache case (§5.3). Emitting stale strings
  while still asking cannot be detected. The transform contract documents that names
  are valid only for the pass that returned them.
- Convergence is unchanged. The requirement count must grow on every retry (:76).
  The context neither adds demand nor relaxes the check.
- **Subjects must exist before the transform.** A subject declared by the transform
  itself is not in `observed` and fails with
  `runtime binding subject is not a top-level function: <name>`. Collection anchors
  therefore belong in the application before the pre-transform check (the D4 anchor
  placement). The transform must keep them, because agreement re-reads them in the
  final graph. Closed pruning removes them later.

### 4.5 Errors

| Case                                             | Error (`runtime` stage)                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Subject not a top-level function of `observed`   | `runtime binding subject is not a top-level function: <name>`       |
| Parameter index out of range                     | `runtime binding subject has no parameter <i>: <name>`              |
| Parameter not a supported list/Set/Map           | `runtime binding subject is not a collection: <name>`               |
| No start matches (internal invariant)            | `runtime binding subject has no <list\|Set\|Map> demand: <name>`    |
| Use after the transform returned                 | `runtime binding context is closed`                                 |
| Subject removed or retyped by the transform      | `… disappeared after transform` / `… names changed after transform` |
| Subject asked earlier, skipped on the final pass | `runtime binding context was not consulted on retry: <name>`        |

## 5. Probe evidence (Node-only)

### 5.1 Fixture (`p1-fixture.mts`, `p2-negative.mts`)

The fixture has `A = P[]`, `B = {x:number}[]`, `Map<string, A>`, `Set<string>` and
`number[]`, each with an exported anchor. The transform asks for all five and
appends `function $probe_bind(): unknown[] { const fs: unknown[] = [names…]; return fs; }`.
It uses AST identifiers, because linked names such as `@2:value:5` are not
parseable source.

| Mode                       | Passes | Result | Context builds | Subjects | Verified (final pass) |
| -------------------------- | ------ | ------ | -------------- | -------- | --------------------- |
| context unused             | 2      | ok     | 0              | 0        | 0                     |
| bind body                  | 2      | ok     | 2              | 10       | 5                     |
| bind body + new `string[]` | 2      | ok     | 2              | 10       | 5                     |

The unused mode also takes 2 passes, so the baseline retries on helper-internal
demand. `A` and `B` return identical names. The Map and Set names change between
pass 1 and the final pass (`_37` → `_61`, `_26` → `_50`). The number list stays
`@2:value:5`. The bind body adds a list binding (`unknown[]`, 7 → 8 lists) and still
agrees. Negative runs produce the errors in §4.5. Retyping the subject's parameter
after asking yields `names changed after transform`.

### 5.2 Real vocabulary (`p3-real.mts`, `p4-alternatives.mts`)

The input is the canonical 919-alias `scriptRuntimeSurface` declarations, with one
exported anchor per collection alias, linked with the nine runtime sources.

| Run                                | Result | Node-only ms | Context deltas                             |
| ---------------------------------- | ------ | ------------ | ------------------------------------------ |
| `dist` baseline, no transform      | ok     | 470          | —                                          |
| copy, transform absent             | ok     | 443          | 0 contexts                                 |
| copy, transform ignores context    | ok     | 433          | 2 contexts, 0 builds                       |
| copy, 78 subjects + bind body      | ok     | 451          | 2 builds, 156 lookups, 78 verified, 3.8 ms |
| extra provisional check (design B) | —      | +124, +256   | per pass                                   |

All 78 subjects agree. They give 35 distinct operation sets (28 list classes × 8, 1
Set × 10, 6 Maps × 11 = 300 names), which matches the parent census. 43 anchors
reuse an earlier set. The final options have 79 lists, 1 Set and 17 Maps with or
without the bind body. Single-run differences of ±40 ms are noise.

### 5.3 Stale cache (`p5-stale.mts`)

The transform asks on pass 1, then reuses those names on pass 2 without calling
`collection`. Without §4.4 the preparation succeeds with 0 verifications, and the
bind body references pass-2 functions that happen to carry the old names. The
consult-on-retry rule turns this into an error.

## 6. Files and refactor boundaries

All changes are in `packages/ts-native/src/runtime/`. The public entry stays
`./runtime`, and `workspace-contracts.json` is unchanged (no new package or
dependency). The compiler is **not** changed in D6a. Its existing transform keeps
compiling, and D6d consumes the context.

| File                  | Change                                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `operations.ts` (new) | Ordered tables pairing helper export and operation name (`["createList","create"]`, …) for sparse-list, linked-set, linked-map and number-list. `listNames`/`setNames`/`mapNames` and the `root(start, k)` offsets derive from them. Exports the three `…OperationName` types. |
| `elements.ts` (new)   | `createElementMatcher(types: readonly Type[]): { matches(a, b, optional): boolean }`, moved from `presentAssignable`/`matches` without behavior change. It throws the existing `checked runtime type graph invariant` if `createTypeSystem` fails.                             |
| `context.ts` (new)    | `createRuntimeBindingContext(input)` → `{ context, records(), close() }` (lazy §4.2), and `verifyRuntimeBindingRecords(records, final)` (§4.3). `input` holds `observed`, `types`, `requests`, `roots`, the start arrays, `helper` and the availability flags.                 |
| `index.ts`            | Pass the context only when `transform !== undefined`. Close it after the call. Verify after selection. Track asked subjects across passes in `prepareCollectionRuntimes`. Re-export the §4.1 types. Build `runtime` objects from `operations.ts`.                              |
| `bindings.ts`         | Unchanged. It serves the observed index (lazily) and the final index.                                                                                                                                                                                                          |

The cleanup is in scope (AGENTS.md: continuous cleanup). The operation tables
remove the positional `root(start, 9)`-style magic numbers. The matcher removes the
`system.ok &&` repetition inside closures.

## 7. Tests (`ts-native/test/runtime-context.test.ts`, tests first)

Use the existing `runtime-index.test.ts` helpers (`testWorkspaceModules`, linked
runtime sources). Fixtures follow §5.1.

1. **Names equal the final options.** For each subject, map every returned name
   through the final graph's binding index. The resulting function IDs equal the
   operation IDs of the binding found by `lists.find(b => b.element ===
arrayElement(final, t'))`, and the same for Sets and Maps.
2. **Equal-class order.** `A` and `B` return identical maps, equal to the first
   binding in `options.lists` order among mutually equivalent elements.
3. **Retry.** A transform that adds collection demand runs twice. Each pass gets a
   fresh context object. Final-pass names satisfy test 1, and pass-1 names are not
   reused (assert at least one Map/Set name differs in the fixture).
4. **Observed IDs.** `element`/`key`/`value` equal `arrayElement(observed, t)` (or
   `setElement`/`mapEncoding`) and index `context.observed.types`.
5. **Number, primitives, number text.** `number[]` returns the number-list linked
   names. `primitives()`/`numberText()` equal the names of the final option IDs, and
   both are `undefined` when the helpers are not linked.
6. **Negatives.** Each §4.5 row, including a subject declared only by the
   transform, a subject retyped after asking, a context used after return, and a
   transform that caches pass-1 names.
7. **Performance guard.** (a) Without a transform the options deep-equal the
   current behavior. (b) A transform that ignores the context yields deep-equal
   options and an identical final module statement list, and it never reads
   `observed.bindings`. Wrap the observed graph in an object whose `bindings` getter
   counts reads, and assert 0. Nothing else in the pass reads `checked.bindings`.
8. **Existing gates.** `runtime-index.test.ts`, the compiler's managed-surface
   tests and the `compileArm64Program` byte-identity tests pass unchanged.

The parent then runs `pnpm build` and `pnpm check`. D6a touches no IR, codegen or
image code. A frozen self-build stays required by AGENTS.md before claiming it.
Its stages should be byte-identical, because no default caller uses the context.

## 8. Changes to the remaining D6 plan

- **Parent §4.2 item 2** (the eager `RuntimeBindingNames`) is replaced by §4.1.
- **Parent §4.2 item 3 / D6d bind body.** `materializeManagedSurfaceExports` takes
  the context and, for each collection anchor in census order, calls
  `context.collection({function: anchor, parameter: 0})`. It appends the returned
  names after the table fields and witnesses. It deduplicates by identical operation
  map, keeping the first occurrence: equal classes already share names, so this is
  "first binding per class" without a type-contract index in the transform. The
  anchor → `$Tn` relation comes from the anchor plan, not from type IDs.
- **Anchors.** Collection anchors are created with the D4 anchors, before the
  pre-transform check. Unlike D4 generic anchors, the transform must not delete
  them (§4.4).
- **D6d agreement.** The directory ABI check compares against the lowered ABI of
  the functions named here. Under §4.3 those are exactly the final options' IDs,
  so the dense rewrite sees them as known list methods.
- **D6f (JIT).** The JIT pipeline does not use the context. It imports every option
  function and matches by directory key. That is unchanged.

## 9. Open decisions (defaults)

1. **Subject granularity.** Default: function plus parameter index. An
   alias-name subject would need a type-name lookup in the observed graph and
   adds nothing for anchors.
2. **Expose observed element IDs.** Default: yes, read-only and documented as
   observed-only. They are useful for tests and diagnostics, but D6 does not need
   them for authority.
3. **Enumerating all bindings** (`context.bindings()`). Default: no. Every eager
   enumeration would pay the build for unused classes, and no D6 consumer needs it.
4. **List `sort`.** Default: not exposed until the census anchors demand sorts.
   It is then added as an optional `sort` operation with the same agreement rule.
5. **Agreement failure kind.** Default: a hard error. Retrying on mismatch could
   hide a relation divergence.
6. **Context in default builds.** Default: the compiler transform keeps receiving it
   but calls nothing when `surfacePlans.length === 0`. This preserves the empty
   surface short-circuit added in D4.

## 10. Risks and unknowns

1. **Relation drift.** The prediction relies on reification preserving mutual
   assignability between a request argument and the specialized parameter. That
   held for 78/78 real subjects. Agreement turns any future drift into an explicit
   error, never a wrong export.
2. **Stale strings.** §4.4 catches skipped consultation, but not a transform that
   asks and then emits other strings. The compiler transform is the only producer.
   Review and test 6 cover it.
3. **Native.** Nothing here proves native behavior. D6g fixtures and a frozen
   self-build remain the evidence.

**Next:** implement D6a §6–§7 behind Node gates, then continue with D6b–D6g as
planned in the [parent](rt-eval-managed-entry.md#5-implementation-slices-tests-first).
