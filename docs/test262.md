# Test262 coverage

## Current status

**Syntax and early errors are complete for the pinned suite. Whole-suite native behavior coverage is not yet measured; the target remains over 90%.**

- Pinned revision: `91c70759363c46557b694792bf34a2551a7af5ba`; 53,751 files / 103,264 variants.
- The [latest complete native parser/binder gate](results/test262-full-native-syntax-source-views-summary-v6.json) accepts all **94,565 valid variants** and rejects all **8,699 parse/early negatives**, with no mismatches, unsupported cases or crashes. Sources are never evaluated.
- The [independent bootstrap-host check](results/test262-full-early-errors-source-views-summary-v4.json) agrees.
- Harness error classification now preserves intentional `Test262Error` throws by the captured harness prototype. The [complete Annex B comment selection](results/test262-annex-comments-native-v3.json) passes **13/13**; the earlier compiler-link failure is retained separately.
- The [latest complete `Function` run](results/test262-function-managed-access-native-v1.json) passes **703/893 (78.72%)**, with 16 failures, 147 unsupported variants and 27 retained pre-entry debugger failures. The previous run passed 728/893 with 149 unsupported and no infrastructure errors; these run-specific outcomes remain separate. The newer async-generator report passes **36/46**, with nine unsupported variants and one pre-entry failure. The [interrupted older rerun](results/test262-function-family-native-v2-interruption.json) remains recorded separately.
- The [pre-consolidation v7 survey](results/test262-full-suite-native-v7-interruption.json) was retired at a quiet checkpoint with all 4,201 observations preserved, including 47 launch failures. The [v8 survey](results/test262-full-suite-native-v8-interruption.json) was cancelled by the server restart after 316 observations; all outcomes are retained. The older [v9 survey was retired at a quiet checkpoint](results/test262-full-suite-native-v9-interruption.json), preserving 10,814 observations. The [v10 survey was stopped at the user’s request](results/test262-full-suite-native-v10-interruption.json), preserving 828 observations (513 passes and 315 unsupported). Known coverage gaps are the current priority; compile-performance work and a complete measurement run are deferred. Its [frozen toolchain](results/frozen-node-toolchain-native-behavior-v10-current-v1.json) and journal remain unchanged. The [start record](results/test262-full-suite-native-v10-start.json) identifies the process, resources and resumable journal. Interrupted surveys and their journals do not establish a whole-suite pass rate.

- The completed [Annex B prefix of v9](results/test262-annexb-v9-prefix-native-v1.json) records **875/1,377 (63.54%)** on that frozen 506-file source: 489 unsupported, one known pinned-specification discrepancy and 12 retained pre-entry attach failures. All expected variants and source/harness hashes were verified. This is an extracted selection, not a new run or a measurement of current code.

- Array iterator slot semantics now preserve state after abrupt completion and permit reentry. The complete family passes **46/46**; six separate native boundary cases and the 1,750-case Script fixture also pass. [Regression evidence](results/native-script-array-iterator-slots-v1.json).

The new native Intl selections pass **162/162 ListFormat** and **104/106 PluralRules**. All six additional PluralRules boundary fixtures pass. Its two remaining variants require other Intl service constructors through the shared harness; no crashes, timeouts or unsupported outcomes occurred. The latest BigInt rerun passes **154/154**.

NumberFormat passes **406/502 (80.88%)** in its [complete native selection](results/test262-intl-number-format-family-native-v4.json), up from 398/502, with 2 shared-harness failures, 92 unsupported variants and 2 retained pre-entry timeouts. Percent/unit-percent, ranges and legacy chaining pass [six native boundary fixtures](results/native-number-affixes-validation-v1.json). Currency formatting also passes [six native boundary fixtures](results/native-currency-validation-v1.json). The newer complete range selections pass [22/22 formatRange](results/test262-number-range-native-v2.json) and [20/20 formatRangeToParts](results/test262-number-range-parts-native-v2.json). The full-family rerun includes these paths. Number and BigInt locale forwarding pass **14/14** and **22/22**, respectively.

The signature-pointer compiler slice now passes [seven native regressions](results/native-local-signature-pointer-validation-v1.json), including moving-GC closure calls. Its [native self-build](results/bootstrap-signature-pointer-v1.json) produces byte-identical stage images. Trusted function-identity reflection also passes a [moving-GC native regression](results/native-managed-function-identities-v1.json). The [managed-call bridge](results/native-managed-invocation-validation-v1.json) also passes allocating/throwing callback and moving-GC regressions. These are compiler regressions, separate from Test262 conformance.

Ordinary `Function` bodies returning one global identifier now use the managed
pipeline and a persistent constructor-realm environment. [Nine native cases](results/native-managed-globals-validation-v1.json)
and four unchanged Test262 variants pass, including late creation and missing
names. The complete Function-family rerun includes this path; Broader ordinary bodies now pass a [16-case native verifier](results/native-test262-function-fallback-validation-v1.json);
the complete Function-family rerun remains pending.

SharedArrayBuffer now passes **208/208 (100%)** in its [complete native selection](results/test262-sharedarraybuffer-native-v4.json),
with no failures, unsupported cases or infrastructure errors. Its pre-implementation
[baseline](results/test262-sharedarraybuffer-baseline-native-v3.json) passed 0/208.
The new backing service, SAB API and shared DataView/typed-array paths also pass
[native regression fixtures](results/shared-array-buffer-api-native-v1.json).
Agent coordination remains separate work.

ArrayBuffer now passes **442/442 (100%)** in its [complete rerun](results/test262-arraybuffer-shared-native-v2.json),
with no failures or infrastructure errors, resolving all 24 pre-SAB failures.
DataView now passes **1,110/1,120 (99.11%)** in its [complete rerun](results/test262-dataview-shared-native-v2.json).
There are no semantic failures or unsupported outcomes; ten variants retain
pre-entry LLDB attach failures in the denominator.

The complete frozen [Atomics baseline](results/test262-atomics-family-native-v1.json)
passes **366/778 (47.04%)**: 184 failures, 222 harness errors and six pre-entry
debugger failures. Non-waiting operations and namespace tests account for
**314/318**, with four pre-entry failures and no semantic failures. The
[method breakdown](results/test262-atomics-family-breakdown-v1.json) retains all
outcomes. Waiting and the agent host remain incomplete; this baseline predates
the newer notify and CanBlock-policy work. The unchanged ordinary-buffer notify
file now passes [2/2](results/test262-atomics-notify-ordinary-native-v1.json),
and the [combined native regression](results/atomics-notify-native-v1.json) passes.

The newer complete [`Atomics.waitAsync` selection](results/test262-wait-async-immediate-native-v1.json) passes **88/202 (43.56%)**, with no semantic failures, crashes or timeouts. Its remaining 106 harness errors require `$262.agent`; eight unsupported variants require parking. [Five native immediate-wait regressions](results/native-immediate-waits-validation-v1.json) pass. The older full-family Atomics ratio above remains separate.

String normalization now passes **25/28** in its [complete native selection](results/test262-string-normalize-native-v1.json). All three non-passes are pre-entry debugger failures. The [native Unicode corpus fixture](results/unicode-normalization-native-v2.json) separately passes 80,140 checks; see [the algorithm and API contract](string-normalization.md).

The complete joint-iteration reruns pass [74/76 zip](results/test262-iterator-zip-native-v2.json) and [86/88 zipKeyed](results/test262-iterator-zip-keyed-native-v2.json). All twelve previously failing variants pass on this frozen compiler; four intrinsic-discovery variants remain unsupported. There are no semantic failures or infrastructure errors. The older whole-Iterator report remains its own historical measurement.

The consolidated toolchain passes **99/101 (98.02%) Boolean** in its [complete native selection](results/test262-boolean-framework-native-v1.json). Two eval-dependent variants remain unsupported; there are no semantic failures or infrastructure errors.

The complete [Reflect selection](results/test262-reflect-framework-native-v1.json) passes **305/306 (99.67%)** with no semantic failures or unsupported variants. One pre-entry debugger failure remains in the denominator.

The complete [`Intl.Locale.getCalendars` selection](results/test262-locale-calendars-native-v1.json) passes **16/16**, with no failures or infrastructure errors. [Six native boundary fixtures](results/native-locale-calendars-validation-v1.json) also pass. The full Locale family still needs a rerun after the remaining collation work.

The complete [`Intl.Locale.getCollations` selection](results/test262-locale-collations-native-v1.json) passes **24/26 (92.31%)**, with no infrastructure errors. Both failures require the missing `Intl.Collator`. [Five native boundary fixtures](results/native-locale-collations-validation-v1.json) pass.

The complete [`Intl.RelativeTimeFormat` family](results/test262-relative-time-native-v1.json) passes **160/160**, with no failures, unsupported cases or infrastructure errors. [Eight native boundary regressions](results/native-relative-time-validation-v1.json) cover coercion order, negative zero, localized parts, intrinsic isolation and realms.

The complete weak-family selections pass [WeakMap **281/281**](results/test262-weak-map-native-v1.json), [WeakSet **169/170**](results/test262-weak-set-native-v1.json), [WeakRef **58/58**](results/test262-weak-ref-native-v1.json), and [FinalizationRegistry **93/94**](results/test262-finalization-registry-native-v1.json). WeakSet and FinalizationRegistry each retain one pre-entry launch failure, with no semantic failures or unsupported cases. The [real-GC lifetime fixture](results/native-weak-lifetimes-v2.json) also passes. These reports retain their own source snapshots.

ScriptRecord host migration passes the complete
[`GeneratorPrototype.next` selection](results/test262-generator-next-script-records-native-v3.json)
with **27/28** native passes: one pre-entry timeout, no semantic failures or
unsupported variants. The [Script host fixture](results/native-script-record-host-v1.json)
and [job/identity fixture](results/native-script-record-jobs-v1.json) also pass.
The [production Script evaluator](results/script-evaluator-service-checkpoint-v1.json) passes
native compile/link/publish/invoke checks. Test262 host integration is implemented,
with its [seven-case native fixture](results/native-test262-script-service-validation-v1.json) passing and unchanged selection reruns running.
String eval is now implemented; complete-selection evidence and pending reruns
are listed below.

The opt-in native module host passes the unchanged
[`language/module-code/eval-this.js`](results/test262-module-eval-this-native-v1.json)
selection (**1/1**) and its gate-off Script compatibility control
[passes both variants](results/test262-module-host-script-guard-v1.json).
[Seven native host cases](results/module-host-native-validation-v1.json) and the
[byte-identical native self-build](results/bootstrap-module-source-v1.json) also
pass. The complete [ambiguous-export group](results/test262-module-ambiguous-export-bindings-native-v1.json)
passes **9/10**, with one source-phase import variant explicitly unsupported
and no failures or infrastructure errors. The complete [namespace selection](results/test262-module-namespace-native-v1.json)
passes **38/38**, with no unsupported cases, failures or infrastructure errors.
The new [11-case native fixture-syntax validation](results/module-fixture-verdict-native-validation-v1.json) also matches every expected outcome, including rejecting invalid fixtures before execution. The unchanged [fixture-syntax selections](results/module-fixture-syntax-selection-acceptance-v3.json) have **5/6 passes**, with one retained timeout before LLDB confirmed the initial stop. The remaining test passed after a separate launch control; the timed-out test was not retried. The new-toolchain namespace and ambiguous-export regressions preserve 38/38 and 9/10 respectively. The six-test slice is not fully accepted.
Module-referrer dynamic import and import.meta are implemented: [17 native host cases](results/dynamic-import-host-native-validation-v1.json) match their expected outcomes, and the [workspace gate](results/frozen-node-toolchain-dynamic-import-v1.json) passes 4,281 tests. The [combined frozen self-build](results/bootstrap-dynamic-import-v1.json) produces byte-identical stage images; [signature and DWARF validation](results/dynamic-import-selfbuild-artifact-validation-v1.json) also pass. The [unchanged native selection acceptance](results/dynamic-import-module-selection-acceptance-v1.json) records **24/24 targeted module variants passing**, plus namespace **38/38**, ambiguous exports **9/10** (the same unsupported proposal), and fixture syntax **6/6** under this frozen toolchain. The earlier pre-entry timeout remains in its original report.
Script-root dynamic import is implemented in the live tools and passes 4,288 workspace tests. Its [Node preparation census](results/script-root-preparation-census-node-v1.json) identifies **849 prepared Script-root variants**; the [native Script-root host validation](results/script-root-host-native-validation-v1.json) matches all **29 expected outcomes**, and the lowered-Script native proof passes. All [12 unchanged-source canary variants pass](results/script-root-canary-acceptance-v1.json). The [frozen directory census](results/script-dynamic-import-frozen-directory-census-v1.json) records 1,900 dynamic-import variants and 27 import.meta variants; The [complete dynamic-import directory](results/test262-script-dynamic-import-directory-v1.json) records **1,559/1,900**, with 341 unsupported and no failures, crashes or timeouts; the 27 import.meta variants remain running. Preparation is not a conformance pass. Top-level await, JSON and import attributes pass [combined native compiler acceptance](results/json-await-native-compiler-acceptance-v1.json); complete unchanged selections are running. These focused results are not a whole-module or whole-suite pass rate. The [fixture-binding extension](results/fixture-binding-verdict-node-checkpoint-v1.json) passes 4,290 workspace checks and prepares [16 additional module variants](results/fixture-binding-verdict-census-node-v1.json) for native syntax proof; its original 31 cases are byte-equivalent to the first 31 of the accepted [43-case native gate](results/module-await-assignment-native-validation-v1.json). All [16 unchanged fixture-binding variants pass](results/test262-dynamic-import-fixture-binding-native-v2.json); [obsolete waiting controllers were retired](results/fixture-binding-verdict-queue-supersession-v1.json).

The first [foundational language checkpoints](results/language-core-priority-checkpoints-v1.json) pass **1,031/1,031** targeted variants: block scope **287/287**, const destructuring **186/186**, catch destructuring **186/186** and function-parameter destructuring **372/372**. These disjoint selections share the validated 565-file source snapshot; they are not a whole-language pass rate. Current work proceeds to references, calls, `super`, assignments and iterator completion, stopping at the first non-pass for triage.

The reference checkpoints now pass **103/103 delete variants**, [**171/171 call variants**](results/test262-language-call-tail-transfers-v1.json) and [**184/184 super variants**](results/test262-language-super-reference-core-v1.json). All six call-group tail-call cases that previously faulted pass on the validated 566-file snapshot. The original [165/171 report and fault triage](results/language-call-tail-fault-triage-v1.json) remain retained. The complete [assignment run](results/test262-language-assignment-reference-core-v1.json) recorded **848/850**, with two failures in `fn-name-lhs-cover.js`: parenthesized assignment targets incorrectly inferred a function name. The fix passes Node and native regressions; its [combined frozen self-build](results/module-await-assignment-native-compiler-acceptance-v1.json) passes with byte-identical images and verified signature/DWARF. The complete unchanged [assignment rerun](results/test262-language-assignment-name-fixed-v1.json) now passes **850/850**, with no failures, unsupported cases, crashes or timeouts. The formerly blocked [await-using for-of canary](results/test262-language-for-of-await-using-canary-v1.json) now passes unchanged **1/1**. The complete for-of selection (1,442) follows with the module host enabled. Top-level await, its former preparation blocker, now passes the [43-case native host gate](results/module-await-assignment-native-validation-v1.json) and 4,359 workspace tests; formal conformance remains pending.

The [new top-level-await canaries](results/language-module-await-feature-canaries-v1.json) pass **3/3 unchanged variants**: await-using iteration, dynamic-import rejection and self-import resolution order. The [current Node-only whole-language scan](results/language-preparation-inventory-node-v5.json) has 8,288 syntax-only variants, 35,971 prepared variants, 442 explicit proposal blockers and zero preparation exceptions. The three former nested-await limits now execute through bounded continuation loops. The [complete top-level-await rerun](results/test262-language-module-top-level-await-bounded-v2.json) passes **253/253**, with no failures, unsupported variants or infrastructure errors. The complete assignment rerun passes 850/850; the complete for-of report remains pending.

Module direct eval now passes the [three unchanged module variants](results/module-direct-eval-selection-checkpoints-v1.json) and all [eight bespoke native host cases](results/module-direct-eval-native-validation-v1.json). Its [frozen native compiler acceptance](results/module-direct-eval-native-compiler-acceptance-v1.json) passes with byte-identical stage images, signature/DWARF verification and confirmed native entry/exit. The pre-entry launch failure remains retained. JSON/import-attribute host factories and bounded await chains pass [combined native compiler acceptance](results/json-await-native-compiler-acceptance-v1.json): eleven JSON host cases, eight await cases including runtime-compiled async code, native in-image lowering, and a byte-identical frozen self-build with signature/DWARF verification. Unchanged selection reruns remain pending; the tools-only resolver passes [five native cases](results/import-resolution-native-validation-v2.json) and all [24 unchanged former bare-specifier non-passes](results/test262-dynamic-import-bare-specifiers-native-v1.json). Its focused result overlaps the retained 1,900-variant directory report and is not merged into it. The complete [static import-attributes selection](results/test262-language-import-attributes-json-v2.json) records 12/17 passes, with five explicit text-module proposal blockers and no failures, crashes or timeouts. The complete [module-code import-attributes selection](results/test262-language-module-import-attributes-json-v2.json) passes 13/13. The complete [dynamic-import attributes selection](results/test262-language-dynamic-import-attributes-json-v2.json) records 42/44 passes; its two text-module proposal tests remain unsupported, with no failures or infrastructure outcomes. These bespoke fixtures add no conformance outcomes. Runtime-compiled imports from eval and Function entries pass [eight native cases and all workspace gates](results/managed-dynamic-import-feature-acceptance-v1.json); both [unchanged eval-import variants pass](results/test262-dynamic-import-eval-native-v1.json).

The separate derived-constructor completion-realm fix passes all eight [native cases](results/class-caller-context-native-validation-v1.json) and a byte-identical self-build. Tail-call lowering passes 4,334 workspace tests, [ten lowered-JavaScript native cases](results/tail-lowering-native-validation-v1.json) and [in-image compilation](results/tail-in-image-native-validation-v1.json), each at 100,000 calls. Its [native compiler gate](results/language-tail-call-native-compiler-acceptance-v1.json) passes stage identity, signature and DWARF checks. [Implementation boundaries](test262-backlog/language-tail-call-boundaries.md) still exclude raw class-constructor callbacks and Proxy trap forwarding; the call-group pass does not claim those paths are complete.

The [20-case native arguments/parameter/eval-scope fixture](results/native-arguments-scope-validation-v1.json) completes 19 cases; [case 16](results/native-arguments-scope-case-16-analysis-v1.json) exposes a direct-eval lowering defect that copies Annex B block functions to the global object instead of the caller variable environment. That failure is retained. After the lowering fix, a [new image completes all 20 cases](results/annexb-eval-copy-arguments-scope-validation-v2.json) under LLDB, and the [direct-eval Annex B fixture](results/annexb-eval-copy-direct-eval-annex-validation-v2.json) passes 15/15. Neither fixture adds conformance outcomes.

The next queue continues function environments, arguments/rest parameters, function and arrow bodies, construction, and control flow using the same frozen compiler. It stops for triage on an unexpected non-pass. Full-suite measurement, compiler-performance work and broad Object/Array expansion remain deferred.

## Behavior inventory

The [measurement-gap scan](test262-measurement-gaps.md) identifies unmeasured groups
with existing implementation and the dependencies the current full survey will
measure. Implementation of known gaps has resumed; the full baseline run is deferred until those gaps and compile-performance work are addressed.

The complete [tagged-template directory passes **48/48 unchanged variants**](results/test262-language-tagged-template-current-v1.json), with no failures, unsupported cases or infrastructure errors. Runtime-compiled sites also pass [ten native semantic checks](results/managed-template-feature-acceptance-v1.json). The [12/12 cache subset](results/managed-template-cache-conformance-acceptance-v1.json) overlaps that full report and is not added to its totals. The 256 KiB entry cap is unchanged; the retained oversized async fixture remains an explicit budget limit.

The [complete group inventory](test262-inventory.md) lists all **139 families**, including every measured, partially measured and unmeasured group. Its [v90 evidence snapshot](results/test262-native-group-inventory-v90.json) inherits the [v89](results/test262-native-group-inventory-v89.json) audit of 710 completed native reports and conservatively replaces only the re-verified complete arguments-object and Annex B function-code reports listed above; it is not a new full rescan.

| Evidence status | Families |
| --- | ---: |
| Complete family report, all passing | 32 |
| Complete family report, non-passes remain | 29 |
| Selection evidence, no dedicated complete family report | 29 |
| No recorded outcomes in completed reports | 49 |

Completed reports contain outcomes for **33,707 distinct variants**; **69,557** have no outcome in those reports. This is a historical evidence footprint, not a combined pass rate. In-progress journals are excluded. All **103,264 variants** separately pass native syntax validation. Historical family ratios can predate current fixes.

### Fully passing family reports

Each row retains its own frozen source; these totals are not a combined current pass rate.

| Family                                    | Passed / total | Report                                                                |
| ----------------------------------------- | -------------: | --------------------------------------------------------------------- |
| `annexB/built-ins/Array`                  |            2/2 | [Report](results/test262-annex-array-survey-native-v1.json)           |
| `annexB/built-ins/Date`                   |          48/48 | [Report](results/test262-annex-date-survey-native-v1.json)            |
| `annexB/built-ins/escape`                 |          32/32 | [Report](results/test262-escape-native-v1.json)                       |
| `annexB/built-ins/Function`               |          12/12 | [Report](results/test262-annex-function-survey-native-v1.json)        |
| `annexB/built-ins/Object`                 |            2/2 | [Report](results/test262-annex-object-survey-native-v1.json)          |
| `annexB/built-ins/String`                 |        222/222 | [Report](results/test262-annexb-string-native-v3.json)                |
| `annexB/built-ins/unescape`               |          38/38 | [Report](results/test262-unescape-native-v1.json)                     |
| `annexB/language/comments`                |          13/13 | [Report](results/test262-annex-comments-native-v3.json)               |
| `annexB/language/expressions`             |          43/43 | [Report](results/test262-annexb-expressions-native-v1.json)           |
| `annexB/language/global-code`             |        153/153 | [Report](results/test262-annexb-global-code-admission-native-v1.json) |
| `annexB/language/statements`              |          41/41 | [Report](results/test262-annexb-statements-native-v2.json)            |
| `built-ins/ArrayBuffer`                   |        442/442 | [Report](results/test262-arraybuffer-shared-native-v2.json)           |
| `built-ins/ArrayIteratorPrototype`        |          46/46 | [Report](results/test262-array-iterator-family-native-v2.json)        |
| `built-ins/BigInt`                        |        154/154 | [Report](results/test262-bigint-family-native-v2.json)                |
| `built-ins/encodeURI`                     |          62/62 | [Report](results/test262-encode-uri-native-v2.json)                   |
| `built-ins/encodeURIComponent`            |          62/62 | [Report](results/test262-encode-uri-component-native-v2.json)         |
| `built-ins/JSON`                          |        332/332 | [Report](results/test262-json-native-v1.json)                         |
| `built-ins/Map`                           |        405/405 | [Report](results/test262-map-weak-followup-native-v1.json)            |
| `built-ins/parseFloat`                    |        108/108 | [Report](results/test262-parse-float-native-v2.json)                  |
| `built-ins/parseInt`                      |        110/110 | [Report](results/test262-parse-int-native-v2.json)                    |
| `built-ins/RegExpStringIteratorPrototype` |          34/34 | [Report](results/test262-regexp-string-iterator-native-v1.json)       |
| `built-ins/Set`                           |        764/764 | [Report](results/test262-set-weak-followup-native-v1.json)            |
| `built-ins/SharedArrayBuffer`             |        208/208 | [Report](results/test262-sharedarraybuffer-native-v4.json)            |
| `built-ins/Symbol`                        |        192/192 | [Report](results/test262-symbol-native-v3.json)                       |
| `built-ins/Uint8Array`                    |        140/140 | [Report](results/test262-uint8-family-native-v3.json)                 |
| `built-ins/WeakMap`                       |        281/281 | [Report](results/test262-weak-map-native-v1.json)                     |
| `built-ins/WeakRef`                       |          58/58 | [Report](results/test262-weak-ref-native-v1.json)                     |
| `intl402/BigInt`                          |          22/22 | [Report](results/test262-bigint-locale-intl-native-v3.json)           |
| `intl402/ListFormat`                      |        162/162 | [Report](results/test262-list-format-native-v1.json)                  |
| `intl402/Number`                          |          14/14 | [Report](results/test262-number-locale-intl-native-v3.json)           |
| `intl402/RelativeTimeFormat`              |        160/160 | [Report](results/test262-relative-time-native-v1.json)                |

### Measured families with remaining work

Counts below retain every failure, unsupported case and infrastructure error. Partial reruns do not replace an older full-family total.

| Family                                                                                                              |         Passed / total | Remaining outcomes                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------: | --------------------------------------------------------------------------------------------------------- |
| [`built-ins/Array/prototype/toLocaleString`](results/test262-array-tolocalestring-native-v1.json)                   |       16 / 22 (72.73%) | 6 unsupported variants use dynamically compiled subclasses in the resizable-buffer harness                |
| [`built-ins/TypedArray/prototype/toLocaleString`](results/test262-typed-array-tolocalestring-native-v1.json)        |       72 / 78 (92.31%) | 6 unsupported variants use that same harness; no failures or infrastructure errors                        |
| [`intl402/NumberFormat`](results/test262-intl-number-format-family-native-v4.json)                                  |     406 / 502 (80.88%) | 2 shared-harness failures; 92 unsupported variants; 2 pre-entry timeouts                                  |
| [`intl402/PluralRules`](results/test262-plural-rules-native-v1.json)                                                |     104 / 106 (98.11%) | 2 shared harness failures: missing Intl service constructors                                              |
| [`annexB/built-ins/RegExp`](results/test262-annexb-regexp-native-v2.json)                                           |     120 / 124 (96.77%) | 4 unsupported                                                                                             |
| [`annexB/language/function-code`](results/test262-annexb-function-code-current-v3.json)                             |     158 / 159 (99.37%) | 1 failure: pinned implicit-arguments expectation predates current B.3.2.1                                 |
| [`annexB/language/eval-code/direct`](results/test262-annexb-eval-copy-annexB-language-eval-code-direct-v2.json)     |     254 / 310 (81.94%) | 56 unsupported ([analysis](results/annexb-eval-copy-direct-unsupported-analysis-v1.json)); no failures    |
| [`language/module-code/ambiguous-export-bindings`](results/test262-module-ambiguous-export-bindings-native-v1.json) |        9 / 10 (90.00%) | 1 unsupported source-phase import; no failures, crashes or timeouts                                       |
| [`language/global-code`](results/test262-global-code-direct-eval-native-v1.json)                                    |       74 / 75 (98.67%) | 1 pre-entry debugger timeout; no failures or unsupported                                                  |
| [`built-ins/AsyncDisposableStack`](results/test262-async-disposable-stack-native-v1.json)                           |     206 / 208 (99.04%) | 2 unsupported                                                                                             |
| [`built-ins/AsyncFunction`](results/test262-async-function-body-native-v1.json)                                     |       34 / 36 (94.44%) | 2 timeouts in intrinsic enumeration ([triage](results/async-function-intrinsic-harness-timeouts-v1.json)) |
| [`built-ins/AsyncGeneratorFunction`](results/test262-async-generator-function-family-native-v4.json)                |       36 / 46 (78.26%) | 9 unsupported, 1 pre-entry debugger failure                                                               |
| [`built-ins/Date`](results/test262-date-family-native-v8.json)                                                      | 1,176 / 1,188 (98.99%) | 6 failures, 6 unsupported                                                                                 |
| [`built-ins/decodeURI`](results/test262-decode-uri-native-v1.json)                                                  |     108 / 110 (98.18%) | 2 timeouts                                                                                                |
| [`built-ins/decodeURIComponent`](results/test262-decode-uri-component-native-v1.json)                               |     110 / 112 (98.21%) | 2 timeouts                                                                                                |
| [`built-ins/DisposableStack`](results/test262-disposable-stack-native-v2.json)                                      |     184 / 186 (98.92%) | 2 unsupported                                                                                             |
| [`language/eval-code/indirect` baseline](results/test262-indirect-eval-baseline-native-v1.json)                     |        4 / 118 (3.39%) | 114 unsupported before host wiring; capable-host rerun pending                                            |
| [`built-ins/eval`](results/test262-eval-family-native-v1.json)                                                      |       18 / 20 (90.00%) | 2 unsupported                                                                                             |
| [`built-ins/Function`](results/test262-function-managed-access-native-v1.json)                                      |     703 / 893 (78.72%) | 16 failures, 147 unsupported, 27 pre-entry debugger failures                                              |
| [`built-ins/GeneratorFunction`](results/test262-generator-function-fallback-native-v1.json)                         |       44 / 46 (95.65%) | 2 timeouts in intrinsic enumeration (same harness as AsyncFunction)                                       |
| [`built-ins/Iterator`](results/test262-iterator-native-v1.json)                                                     | 1,350 / 1,368 (98.68%) | 12 failures, 6 unsupported                                                                                |
| [`built-ins/Math`](results/test262-math-family-native-v1.json)                                                      |     652 / 654 (99.69%) | 2 pre-entry debugger failures                                                                             |
| [`built-ins/Proxy`](results/test262-proxy-reflect-built-ins-proxy-v2.json)                                          |       607 / 607 (100%) | No failures or infrastructure errors                                                                      |
| [`built-ins/SuppressedError`](results/test262-suppressed-error-native-v1.json)                                      |       40 / 44 (90.91%) | 4 unsupported                                                                                             |
| [`built-ins/ArrayBuffer`](results/test262-arraybuffer-shared-native-v2.json)                                        |       442 / 442 (100%) | No failures or infrastructure errors                                                                      |
| [`built-ins/Atomics`](results/test262-atomics-family-native-v1.json)                                                |     366 / 778 (47.04%) | Wait/notify/agents incomplete; six pre-entry failures                                                     |
| [`built-ins/DataView`](results/test262-dataview-shared-native-v2.json)                                              | 1,110 / 1,120 (99.11%) | 10 pre-entry LLDB attach failures; no semantic failures                                                   |
| [`built-ins/SharedArrayBuffer`](results/test262-sharedarraybuffer-native-v4.json)                                   |       208 / 208 (100%) | No failures or infrastructure errors                                                                      |
| [`language/arguments-object`](results/test262-language-arguments-object-current-v1.json)                            |     458 / 460 (99.57%) | 2 optional legacy `arguments.caller` failures (sloppy); former strict eval unsupported cases pass         |
| [`language/destructuring`](results/test262-destructuring-native-v2.json)                                            |       34 / 37 (91.89%) | 2 unsupported, 1 crashes                                                                                  |
| [`language/rest-parameters`](results/test262-rest-parameters-native-v2.json)                                        |       21 / 22 (95.45%) | 1 crashes                                                                                                 |
| [`intl402/Locale`](results/test262-locale-family-native-v4.json)                                                    |     338 / 380 (88.95%) | 42 unavailable calendar/collation-service variants                                                        |
| [`built-ins/FinalizationRegistry`](results/test262-finalization-registry-native-v1.json)                            |       93 / 94 (98.94%) | 1 pre-entry launch failure; no semantic failures or unsupported cases                                     |
| [`built-ins/WeakSet`](results/test262-weak-set-native-v1.json)                                                      |     169 / 170 (99.41%) | 1 pre-entry launch failure; no semantic failures or unsupported cases                                     |

The Annex B function-code failure is a [pinned implicit-arguments expectation that differs from current specification rules](results/test262-annexb-implicit-arguments-spec-v1.json); Node reproduces it, and native fixture case 19 confirms the current-rule replacement. The rerun's [grant accounting](results/test262-annexb-function-code-current-grants-v3.json) retains one 65-variant lane grant (a scheduling breach; observations remain valid). Date’s six historical-zone failures are also [reproduced in Node](results/test262-date-to-iso-string-node-v1.json). These remain failures in the native denominator.

The BigInt family report predates the `toString.length` correction. Its [focused Test262 run](results/test262-bigint-tostring-length-native-v1.json) retained two pre-entry failures; the separate [native fixture](results/native-bigint-metadata-v3.json) verifies the corrected descriptor and decimal/binary calls. Neither replaces the complete family total.

## Recent selections within larger families

These selections overlap other reports and cannot be added into an overall coverage percentage. The group inventory retains the other complete selections.

| Selection                    |      Passed / total | Remaining                           | Report                                                                       |
| ---------------------------- | ------------------: | ----------------------------------- | ---------------------------------------------------------------------------- |
| Block scope                  |    287 / 287 (100%) | None                                | [Report](results/test262-language-block-scope-core-v1.json)                  |
| Const destructuring          |    186 / 186 (100%) | None                                | [Report](results/test262-language-const-destructuring-core-v1.json)          |
| Catch destructuring          |    186 / 186 (100%) | None                                | [Report](results/test262-language-catch-destructuring-core-v1.json)          |
| Parameter destructuring      |    372 / 372 (100%) | None                                | [Report](results/test262-language-parameter-destructuring-core-v1.json)      |
| Synchronous `using`          |  146 / 154 (94.81%) | 8 module/eval variants              | [Report](results/test262-using-annex-native-v3.json)                         |
| Async `using`                |  180 / 188 (95.74%) | 8 module/eval variants              | [Report](results/test262-await-using-handoff-native-v4.json)                 |
| `await` expressions          |   44 / 44 (100.00%) | None                                | [Report](results/test262-await-handoff-native-v6.json)                       |
| Array.fromAsync              | 186 / 186 (100.00%) | None                                | [Report](results/test262-array-from-async-native-v1.json)                    |
| Temporal.Now                 | 132 / 132 (100.00%) | None                                | [Report](results/test262-temporal-now-system-host-native-v1.json)            |
| Temporal.Duration.total      | 156 / 156 (100.00%) | None                                | [Report](results/test262-temporal-duration-total-native-v3.json)             |
| Temporal.Duration.round      |  251 / 252 (99.60%) | 1 pre-entry debugger failure        | [Report](results/test262-temporal-duration-round-native-v4.json)             |
| Temporal.Duration.toString   |   88 / 88 (100.00%) | None                                | [Report](results/test262-temporal-duration-string-native-v1.json)            |
| Temporal.PlainDate.until     | 172 / 172 (100.00%) | None                                | [Report](results/test262-temporal-date-until-native-v2.json)                 |
| Temporal.PlainDateTime.until | 196 / 196 (100.00%) | None                                | [Report](results/test262-temporal-date-time-until-native-v3.json)            |
| Temporal.ZonedDateTime.from  | 182 / 182 (100.00%) | None                                | [Report](results/test262-temporal-zoned-from-named-native-v1.json)           |
| Temporal.ZonedDateTime.until |  194 / 198 (97.98%) | 4 pre-entry debugger failures       | [Report](results/test262-temporal-zoned-until-duration-native-v3.json)       |
| Temporal.ZonedDateTime.since |  193 / 202 (95.54%) | 9 pre-entry debugger failures       | [Report](results/test262-temporal-zoned-since-duration-native-v3.json)       |
| Intl Temporal.Duration.round |    16 / 18 (88.89%) | 2 Gregorian-era variants            | [Report](results/test262-intl-temporal-duration-round-prefix-native-v3.json) |
| Intl Temporal.Duration.total |    12 / 14 (85.71%) | 2 Gregorian-era variants            | [Report](results/test262-intl-temporal-duration-total-prefix-native-v3.json) |
| Intl.getCanonicalLocales     |      76 / 76 (100%) | No remaining outcomes               | [Report](results/test262-canonical-locales-native-v2.json)                   |
| Intl.supportedValuesOf       |    14 / 50 (28.00%) | 2 failures, 34 unsupported variants | [Report](results/test262-intl-supported-values-native-v1.json)               |

## Not completed

- **Whole-suite behavior measurement and >90% passes.** The full run and compile-performance work are deferred while known coverage gaps are addressed; broad Object, Array, RegExp, TypedArray, language-expression and language-statement families still lack complete saved reports.
- **Runtime source compilation:** `$262.evalScript`, indirect eval and direct eval use the shared native compiler, linker and executable arena. Direct-eval [environment](results/native-test262-direct-eval-validation-v1.json), [class-context](results/native-test262-direct-eval-class-validation-v2.json) and [private-name](results/native-test262-eval-private-validation-v1.json) fixtures pass their expected cases. Ordinary, async, generator and async-generator dynamic-constructor fallback paths are implemented; their bespoke native evidence is listed in the [capability inventory](test262-inventory.md). Complete family reports may predate these changes, and focused native fixtures do not replace conformance reruns. Module direct eval passes its [native compiler gate](results/module-direct-eval-native-compiler-acceptance-v1.json) and three unchanged focused variants. See [native code loading](native-code-loading.md).
- **Native ESM execution:** the opt-in module adapter executes static graphs, cycles, live bindings and namespaces. Namespace passes 38/38 and ambiguous exports 9/10. Module dynamic import and import.meta pass 24/24 targeted variants, with fixture syntax 6/6 on the same frozen toolchain. Script-root dynamic import passes 12/12 canaries; the [complete dynamic-import directory](results/test262-script-dynamic-import-directory-v1.json) records 1,559/1,900 with 341 unsupported and no failures, crashes or timeouts. Top-level await and JSON/import attributes pass [combined native compiler acceptance](results/json-await-native-compiler-acceptance-v1.json); their complete selection reruns are running. Source/defer and text/bytes proposals remain explicit gaps. Reports and retained earlier failures are linked above.
- **Remaining semantics and APIs:** finish failures in measured families, refresh reports predating later fixes, expand Temporal calendar/era support and broader Intl coverage, and cover the unmeasured families.
- **Host conformance facilities:** agents, shared-memory/worker scheduling and other unsupported host operations need explicit runtime contracts. They remain in the suite denominator.

## Native verification

The latest completed [tail-call frozen self-build](results/bootstrap-language-tail-calls-v2.json) produces byte-identical **71,847,842-byte** stage1/stage2 images from 566 frozen sources. [Artifact validation](results/language-tail-calls-selfbuild-artifact-validation-v2.json) verifies signatures and DWARF. This compiler acceptance is separate from the running Test262 call-group rerun. Earlier [compiler](results/framework-compiler-migration-checkpoint-v1.json) and [backend](results/framework-backend-migration-checkpoint-v1.json) migration checkpoints retain their separate smoke, managed-call and metadata evidence.

Bespoke [dynamic-constructor coercion](results/native-dynamic-coercion-v1.json), [disposal scheduling](results/native-disposal-jobs-v2.json), [async resources](results/native-await-using-handoff-v1.json), and [Annex B binding](results/native-annex-functions-v2.json) regressions are separate from Test262 conformance. [Bootstrap](bootstrap.md) owns reproducibility evidence; the [runner contract](test262-runner.md) owns execution policies. Older selections and infrastructure failures remain in immutable reports and the [retained evidence index](archive/test262-selection-evidence-through-zoned-conversions.md).
