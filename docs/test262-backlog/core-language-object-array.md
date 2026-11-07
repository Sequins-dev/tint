# Foundational language semantics first

Current user-directed priority: foundational `language/*` execution semantics
before broad Object and Array built-in coverage. Shared property operations remain
in scope when a reproduced language failure requires them. The wider scope census
covers 57,622 variants; language itself contains 44,701. These are populations,
not pass forecasts. Full-suite measurement and compiler-performance work remain
deferred. Existing immutable observations and failures are retained.

The [Node selection census](../results/core-language-object-array-census-node-v1.json)
partitions every test in this scope by selectable directory. It performs no
native execution. The [complete coverage inventory](../test262-inventory.md)
continues to report all families, including those outside the active focus.

| Scope              | Variants | Completed-report outcome footprint |
| ------------------ | -------: | ---------------------------------: |
| `language/*`       |   44,701 |                              9,110 |
| `built-ins/Object` |    6,802 |                              6,802 |
| `built-ins/Array`  |    6,119 |                              6,119 |

Footprints include historical non-passes and syntax-negative observations. They
are not pass counts. The current native syntax gate already accepts or rejects
all pinned variants correctly; the focus here is execution semantics.

## First language checkpoints

1. `language/block-scope` (287 variants): binding lifetime, lexical shadowing,
   temporal dead zones and closure capture.
2. `language/statements/const/dstr` (186): declaration-time destructuring,
   iterator and property access, defaults and abrupt completion.
3. `language/statements/try/dstr` (186): catch binding and destructuring errors.
4. `language/statements/function/dstr` (372): parameter initialization, binding
   order, defaults and function environments.

All four [initial native checkpoints](../results/language-core-priority-checkpoints-v1.json) pass: **287/287**, **186/186**, **186/186** and **372/372**, respectively. The total is 1,031 targeted variants, not a whole-language ratio.

The complete [`language/expressions/object/dstr` selection](../results/test262-language-object-destructuring-a2-native-v1.json) passes **1,122/1,122**, with no non-passes. It is extracted from one frozen, resumed object journal with every expected variant and source/harness identity verified. The complete object-expression selection remains in progress; this subfamily is not added to its parent as a separate population.

The same preserved journal contains [178 complete standalone file selections](../results/cluster-a2-object-direct-complete-files-v1.json), passing **351/351** variants, with [ledger validation](../results/cluster-a2-object-direct-ledger-validation-v1.json). The standalone directory has 222 unobserved variants in that older prefix; the [complete full object report](../results/test262-language-object-direct-a2-native-v1.json) now records **2,249/2,252 passes**, retaining three original pre-entry authorization timeouts; the [separate direct recheck](../results/test262-object-authorization-recheck-a2-native-v1.json) now passes **3/3** on freshly frozen current main. Its [20 additional complete root syntax file selections](../results/cluster-a2-object-additional-root-syntax-files-v1.json) pass **25/25**, with [ledger validation](../results/cluster-a2-object-additional-root-ledger-validation-v1.json).

The direct-launch prefix supplies [101 complete method-definition syntax file selections](../results/cluster-a2-object-method-syntax-complete-files-v1.json), passing **194/194**, with [ledger validation](../results/cluster-a2-object-method-syntax-ledger-validation-v1.json). The 363 method-definition runtime variants remain pending.

Delete/reference semantics pass **103/103**. Calls now pass [**171/171**](../results/test262-language-call-tail-transfers-v1.json), including all six formerly faulting proper-tail-call cases. Super passes [**184/184**](../results/test262-language-super-reference-core-v1.json). The original [call-fault triage](../results/language-call-tail-fault-triage-v1.json) remains retained. The complete [assignment run](../results/test262-language-assignment-reference-core-v1.json) is **848/850**. Both failures concern function-name inference for parenthesized targets. The fix passes native regressions; the [combined frozen self-build](../results/module-await-assignment-native-compiler-acceptance-v1.json) passes with byte-identical images and verified signature/DWARF. The unchanged [focused regression](../results/test262-language-assignment-cover-name-fixed-v1.json) passes **2/2**; the complete [unchanged rerun](../results/test262-language-assignment-name-fixed-v1.json) passes **850/850**, with zero non-passes. For-of iterator completion (1,442) is next, with module execution enabled.

The [proper-tail-call implementation](language-tail-call-boundaries.md) passes all 4,334 workspace tests, ten native lowered-source cases and an in-image compilation case at 100,000 calls. Its [frozen native self-build](../results/bootstrap-language-tail-calls-v2.json) passes with byte-identical stage images and successful signature/DWARF checks. The earlier [pre-entry launch failure](../results/bootstrap-language-tail-calls-v1.json) remains retained.

A [frozen Node preparation census](../results/language-reference-preparation-census-node-v2.json)
finds all 184 super variants ready for execution, assignment split into 697
execution variants and 153 syntax negatives, and for-of split into 1,276 execution
variants, 165 syntax negatives and one module-gate blocker. Preparation is not a
native pass. The former [top-level-await blocker](../results/language-for-of-module-blocker-node-v1.json) now passes the [combined native host gate](../results/module-await-assignment-native-validation-v1.json), including async iteration/disposal and module evaluation ordering. The unchanged [await-using for-of canary](../results/test262-language-for-of-await-using-canary-v1.json) now passes **1/1**; the complete iteration-group rerun remains pending. The [complete top-level-await rerun](../results/test262-language-module-top-level-await-bounded-v2.json) passes **253/253**, including the three formerly limited nested-await cases.

The [current Node-only whole-language preparation inventory](../results/language-preparation-inventory-node-v5.json) scans all 44,701 variants: 8,288 syntax-only, 35,971 prepared, 442 explicit proposal blockers and **zero preparation exceptions**. JSON/import-attribute host integration and bounded nested-await continuations pass [native compiler acceptance](../results/json-await-native-compiler-acceptance-v1.json); complete unchanged selection reruns are running. Preparation is not a conformance pass. The three previously limited nested-await loops now prepare through a reusable continuation loop, while distinct deeply expanded suspension segments still retain the shared syntax limit. The [earlier admission decision](../results/module-generated-syntax-limit-admission-decision-v1.json) remains historical evidence; the global checker/rewriter budgets have not been raised.

The [154-group language follow-up inventory](../results/language-foundation-followup-inventory-node-v1.json) separates historical observation footprints from preparation readiness. The [class and async-iteration subgroup census](../results/language-class-async-iteration-subgroups-node-v1.json) breaks down the largest remaining language areas for subsequent unchanged selections, after active reference and function/control-flow checkpoints.

Run serially on the validated frozen runtime. Investigate each unexpected non-pass before widening measurements; keep known feature blockers in the denominator and track them explicitly.
Use red-first semantic tests, native reproductions and unchanged conformance
reruns for each fix. No pass forecast is made.

The already-running Object toString checkpoint finished 82/82; its complete
[report](../results/test262-object-tostring-core-focus-v1.json) is retained.
Array concat was removed from the next step when the user reprioritized language.
The handoff requests a between-variant pause before stopping its runner, preserves
the journal and transfers the existing serialization marker to the language
controller. The broader dynamic-import language run remains paused during these
checkpoints and resumes after them. No inferior is killed while executing a test.

The next prepared queue covers return statements, function code, arguments/rest
parameters, function declarations and expressions, arrows, construction and
new.target, try/catch, const/let, loops, conditions, switch, break/continue,
throw, blocks and with. These independent checkpoints now use the [accepted V19 frozen toolchain](../results/frozen-node-toolchain-managed-templates-v1.json) after the tagged-template selection, as recorded in the [queue handoff](../results/language-foundation-queue-supersession-node-v1.json). Existing direct-eval and for-of runs retain their own captured sources and finish before new function/class groups, per the [queue order](../results/language-foundation-queue-order-node-v2.json). Each complete selection gets a new immutable report; sources and overlapping totals are not merged.

The coordinated built-in breadth survey now has a complete [Object report](../results/test262-object-family-native-v2.json): **6,794/6,802 passes**, retaining six missing String locale-method failures and two original host-authorization timeouts. The [audit](../results/g-object-family-completion-audit-v1.json) verifies every pinned variant and the unchanged original prefix. The [separate direct-mode authorization recheck](../results/test262-object-authorization-recheck-native-v1.json) passes **2/2**; J’s [separate native locale descriptor rechecks](../results/g-object-string-locale-descriptor-resolution-v1.json) pass **6/6**. All original survey outcomes are retained. Array has a recovered [historical full-family report](../results/test262-array-family-historical-extract-native-v1.json), **5,972/6,119**, retaining 142 unsupported variants and five debugger crashes; the fresh [survey was stopped after batch 45](../results/g-array-scope-redirect-interruption-v1.json) at 2,944 passing observations under the scope directive to prioritize unmeasured and nonpass variants. Complete extracted selections are linked from the dashboard; the full family rerun is incomplete.

## Preparation inventory

The [language-only Node scan](../results/language-preparation-inventory-node-v1.json)
covers all 44,701 variants: 8,288 route to the syntax lane, 35,683 prepare for
execution, and 730 have explicit preparation blockers. Nothing threw during
preparation. These are routing/lowering facts, not native passes or a runtime
correctness claim.

The first blockers are top-level await (264), source/defer import proposal paths
(390), decorators/auto-accessors (38), attributes/JSON modules (35), and direct
eval in modules (3). Tests that prepare still require native execution, including
boundary and abrupt-completion cases. Current reference/call/iteration checks
continue before widening feature work.

## Cluster map and dependencies

| Cluster                                     | Direct population | Why it matters                                                                                                                                    |
| ------------------------------------------- | ----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class declarations and expressions          |            16,893 | Construction, inheritance, private names, accessors, method calls, evaluation order and closures; shared dependencies with subclass/species tests |
| Object literal expressions                  |             2,252 | Computed names, descriptors, getters/setters, spread and prototype behavior                                                                       |
| Object defineProperty / defineProperties    |             3,514 | Shared property-descriptor semantics used by arrays, classes, harness checks and many APIs                                                        |
| Object create / getOwnPropertyDescriptor    |             1,260 | Prototype and descriptor consistency, including observable property reads                                                                         |
| for-of / for-await-of                       |             3,873 | Iterator closing, abrupt completion, destructuring and async jobs                                                                                 |
| Assignment / compound assignment            |             1,636 | Reference evaluation, getters/setters, coercion and abrupt completion                                                                             |
| Array reduce / reduceRight                  |             1,034 | Length capture, holes, inherited elements, callbacks and mutation                                                                                 |
| Array filter / some / every / map / forEach |             2,152 | Shared indexed access and callback rules; map/filter additionally exercise species                                                                |

These rows are selection populations, not expected gains or a sum of remaining
work. Negative syntax tests stay in their populations. Existing Node tests and
older native evidence guide triage but do not replace current complete runs.

Implementation order follows observed failure clusters rather than population
alone: environment/binding and destructuring rules, evaluation order and reference
semantics, object/class behavior, then iterator/async completion paths. Shared
property operations are fixed as dependencies when needed. A small fix with a
clear native reproduction takes precedence over a speculative rewrite.

The [class queue census](../results/language-class-remaining-selection-census-node-v1.json)
keeps declaration and expression forms separate. Together they contain **16,893
variants**; the first 29 disjoint selections cover **2,081**, leaving **14,812**
outside that checkpoint. The largest remaining groups are method-parameter
destructuring (7,680 variants) and class elements (6,099). These are queue counts,
not implementation or native-pass claims; syntax negatives and 42 decorator
proposal variants remain included. Widen class execution only after the current
checkpoint, fixing reproduced failures before advancing.

## Validation and reporting

- Write a semantic regression before implementation changes.
- Use `pnpm check`, relevant native fixtures under LLDB, and the required frozen
  self-build for portable compiler/runtime changes.
- Reuse the existing frozen compiler for tools-only measurements.
- Keep complete selection reports separate from focused rechecks.
- Update the full coverage dashboard as well as this active focus; do not report
  only the latest group.
- Do not expand into unrelated Intl, host or proposal work while this focus is
  active unless a reproduced dependency requires it.

The [next class checkpoint queue](../results/language-class-foundation-selection-queue-node-v1.json)
contains 29 disjoint selections and 2,081 variants: syntax and definitions,
names, arguments/strictness, super, methods/accessors, inheritance and built-in
subclassing, then generator and async methods. It waits for the current eval,
iteration and function/control-flow gates. The queued count is not a native
result; unexpected outcomes stop widening for diagnosis. Large class elements,
class destructuring and for-await-of groups remain separate follow-ups.

The complete [object method-definition selection](../results/test262-object-method-definition-a2-native-v1.json) passes **557/557** on frozen A2 v4 under direct launch, including all 363 runtime variants. Earlier method syntax checkpoints overlap this complete report.

The complete [standalone object selection](../results/test262-object-root-a2-native-v1.json) passes **573/573**. It overlaps the full object report and the earlier standalone file checkpoints.
