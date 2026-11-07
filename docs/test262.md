# Test262 coverage

## Current status

**Syntax and early errors are complete for the pinned suite. Whole-suite native behavior coverage is not yet measured; the target remains over 90%.**

- [Latest coverage ledger](results/test262-coverage-ledger-v16.md): deduplicated aggregate of separate complete native runs on varying toolchains; not a whole-suite measurement.
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

Native primitive-union storage now uses inline tag/payload fields, with adjacent-block fallthrough and direct boolean branches. A [matched three-million-store benchmark](results/native-codegen-inline-primitive-unions-v2.json) records **130.598 → 44.463 ms median inferior CPU (2.94×)** over four alternating pairs, with eight expected native exits. The [post-C2 frozen compiler validation](results/native-codegen-inline-post-C2-v1.json) produces byte-identical 69,486,994-byte stage images, with valid signature and DWARF. The focused addition A1 recheck retains **0/2, two post-entry timeouts**, so this benchmark does not establish a Test262 execution speedup.

Private dense arrays now admit inline union and boolean cells. The [matched native compiler comparison](results/native-codegen-dense-inline-selfbuild-v1.json) records **1,576.460 → 397.927 seconds of inferior CPU (3.96×)** on the same sealed compiler sources, with identical 60,838,434-byte emitted images and verified production-host equivalence. The [repeated array-read benchmark](results/native-codegen-dense-inline-elements-v1.json) records **9.59×** median CPU improvement and eight equivalent native exits. Managed Test262 images retain their private-array boundary; these measurements do not change native coverage totals or establish a suite execution-time gain.

Unused-local frame normalization records **487.451 → 399.786 seconds of native compiler CPU (1.22×)** in a separate [matched pair](results/native-codegen-frame-normalization-v1.json), with identical 60,079,074-byte stage images, eight equivalent managed-callback/GC fixture exits and 4,583 passing workspace tests. This is a separate source graph from the dense-array pair; it does not establish a combined or Test262 execution-time gain.

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

String normalization now passes **28/28** in its [current complete native selection](results/test262-cluster-j-current-built-ins-String-prototype-normalize-v21.json). The earlier [25/28 report](results/test262-string-normalize-native-v1.json) retains its three pre-entry debugger failures. The [native Unicode corpus fixture](results/unicode-normalization-native-v2.json) separately passes 80,140 checks; see [the algorithm and API contract](string-normalization.md).

The [current complete `built-ins/Iterator` rerun](results/test262-iterator-family-current-native-v1.json) passes **1,364/1,368** on the frozen [iterator/generator toolchain](results/frozen-node-toolchain-iterator-generator-v1.json). All twelve earlier zip/zipKeyed ReferenceError failures and both `proto-from-ctor-realm.js` unsupported variants pass. The four timeouts are the zip/zipKeyed `result-is-iterator.js` variants. Their harness includes 87 dynamic `Function` sources, but the [retained timeout reassessment](results/cluster-f-retained-iterator-timeout-reassessment-v1.json) leaves debugger and compilation causes unresolved; focused direct-launch rechecks remain pending. There are no failures, crashes or unsupported variants. The earlier [74/76 zip](results/test262-iterator-zip-native-v2.json), [86/88 zipKeyed](results/test262-iterator-zip-keyed-native-v2.json) and [whole-Iterator](results/test262-iterator-native-v1.json) reports remain separate historical measurements. A [six-case native fixture](results/native-iterator-realm-order-validation-v1.json) separately covers disposal, cross-realm helper realms, reentrancy and zip close order. The separate [complete `staging/sm/Iterator` selection](results/test262-staging-sm-iterator-native-v1.json) passes **348/348**, with no non-passes; it is outside the `built-ins/Iterator` denominator.

The consolidated toolchain passes **99/101 (98.02%) Boolean** in its [complete native selection](results/test262-boolean-framework-native-v1.json). Two eval-dependent variants remain unsupported; there are no semantic failures or infrastructure errors.

The complete [Reflect selection](results/test262-reflect-framework-native-v1.json) passes **305/306 (99.67%)** with no semantic failures or unsupported variants. One pre-entry debugger failure remains in the denominator. The [inherited v2 rerun](results/test262-builtins-reflect-phase1-interruption-v1.json) was stopped at a confirmed between-variant pause after over five hours without progress; it recorded 0/306 variants and does not replace that complete result.

The complete [Promise family](results/test262-promise-keyed-native-v3.json) passes **1,458/1,458**, with zero failures, unsupported variants or infrastructure errors, including [**90/90 `allKeyed`**](results/test262-promise-allkeyed-native-v1.json) and [**88/88 `allSettledKeyed`**](results/test262-promise-allsettledkeyed-native-v1.json). Both keyed APIs also pass [12 separate native semantic fixtures](results/native-promise-keyed-validation-v3.json) and the [native compiler acceptance gate](results/promise-keyed-native-compiler-acceptance-v1.json). The [completion audit](results/test262-promise-keyed-completion-audit-v1.json) verifies every pinned source/harness identity and the byte-exact continuation of the same frozen experiment; the [earlier inherited interruption](results/test262-builtins-promise-phase1-interruption-v1.json) remains separate evidence.

The complete [Object survey](results/test262-object-family-native-v2.json) records **6,794/6,802 passes** on [frozen Object v4](results/frozen-node-toolchain-builtins-object-v4.json): six [missing String locale-method failures, owned by J](results/g-object-string-locale-descriptor-blocker-v1.json), and two original pre-entry host-authorization timeouts. The [completion audit](results/g-object-family-completion-audit-v1.json) verifies the full pinned denominator, all source/harness/fixture identities, the unchanged 706-observation prefix, and the terminal completion record. It separately retains the known slot-wrapper parse error after the completed report; the [separate fresh direct-mode recheck](results/test262-object-authorization-recheck-native-v1.json) passes **2/2**. Original survey outcomes remain unchanged.

Fresh Array breadth is running on [rebased main with P’s word captures](results/frozen-node-toolchain-builtins-array-v1.json), with [eleven complete child selections, **709/709 passes**](results/g-array-complete-selections-v6.json). The full **6,119-variant** family remains incomplete. The earlier [historical report](results/test262-array-family-historical-extract-native-v1.json), including all 142 unsupported variants and five debugger crashes, remains unchanged.

The complete historical [`built-ins/Array` selection](results/test262-array-family-historical-extract-native-v1.json), extracted from one frozen full-suite journal, records **5,972/6,119** passes, 142 unsupported variants and five debugger attach failures retained as crashes. All unsupported variants load `resizableArrayBufferUtils.js`. The [extraction audit](results/test262-array-historical-extraction-audit-v1.json) verifies every pinned source/harness identity and the original compiler snapshot; no retries or snapshots are combined. This is an older snapshot, not a current-main rerun. A fresh Array measurement remains queued after Object.

Two more complete families extracted from that historical survey retain [**49/50 AggregateError**](results/test262-aggregateerror-family-historical-extract-native-v1.json), with one pre-entry LLDB attach failure, and [**0/8 AbstractModuleSource**](results/test262-abstractmodulesource-family-historical-extract-native-v1.json), whose older adapter reported module execution unsupported. These are historical observations; current-toolchain reruns remain queued after the larger breadth gaps.

The complete [`Intl.Locale.getCalendars` selection](results/test262-locale-calendars-native-v1.json) passes **16/16**, with no failures or infrastructure errors. [Six native boundary fixtures](results/native-locale-calendars-validation-v1.json) also pass. The full Locale family still needs a rerun after the remaining collation work.

The complete [`Intl.Locale.getCollations` selection](results/test262-locale-collations-native-v1.json) passes **24/26 (92.31%)**, with no infrastructure errors. Both failures require the missing `Intl.Collator`. [Five native boundary fixtures](results/native-locale-collations-validation-v1.json) pass.

The complete [`Intl.RelativeTimeFormat` family](results/test262-relative-time-native-v1.json) passes **160/160**, with no failures, unsupported cases or infrastructure errors. [Eight native boundary regressions](results/native-relative-time-validation-v1.json) cover coercion order, negative zero, localized parts, intrinsic isolation and realms.

The complete weak-family selections pass [WeakMap **281/281**](results/test262-weak-map-native-v1.json), [WeakSet **169/170**](results/test262-weak-set-native-v1.json), [WeakRef **58/58**](results/test262-weak-ref-native-v1.json), and [FinalizationRegistry **93/94**](results/test262-finalization-registry-native-v1.json). WeakSet and FinalizationRegistry each retain one pre-entry launch failure, with no semantic failures or unsupported cases. The [real-GC lifetime fixture](results/native-weak-lifetimes-v2.json) also passes. These reports retain their own source snapshots.

Each row below is a complete iteration, generator or async language selection on its recorded frozen source snapshot. All expected variants and non-passes are retained.

| Selection | Pass/total | Report |
| --- | ---: | --- |
| `language/statements/async-generator` | 590/590 | [Report](results/test262-async-generator-statements-current-native-v1.json) |
| `language/expressions/yield` | 123/123 | [Report](results/test262-cluster-f-yield-expressions-v1.json) |
| `language/statements/generators` | 510/510 | [Report](results/test262-cluster-f-generator-statements-v1.json) |
| `language/expressions/generators` | 546/546 | [Report](results/test262-cluster-f-generator-expressions-v1.json) |
| `language/statements/for-in` | 206/206 | [Report](results/test262-cluster-f-remaining-small-language-v1-language-statements-for-in.json) |
| `language/statements/async-function` | 133/133 | [Report](results/test262-cluster-f-remaining-small-language-v1-language-statements-async-function.json) |
| `language/expressions/async-function` | 161/161 | [Report](results/test262-cluster-f-remaining-small-language-v1-language-expressions-async-function.json) |
| `language/expressions/await` | 44/44 | [Report](results/test262-cluster-f-remaining-small-language-v1-language-expressions-await.json) |
| `language/expressions/async-arrow-function` | 108/110 | [Report](results/test262-cluster-f-remaining-small-language-v1-language-expressions-async-arrow-function.json) |
| `language/expressions/async-generator` | 1212/1212 | [Report](results/test262-cluster-f-async-generator-expressions-v1.json) |

The [native self-hosting gate](results/cluster-f-phase2-ready-v3.json) passes with byte-identical stage images and smoke output, native smoke exit 42, and verified signing/DWARF.

Async-arrow-function retains [two CPU-bound, after-entry timeouts](results/cluster-f-intrinsic-enumeration-native-timeouts-v1.json) in `prototype.js`, with zero assertion failures or unsupported variants. Both received more than 250 CPU seconds before containment; [same-image controls pass 2/2](results/test262-cluster-f-async-arrow-intrinsic-control-v1.json). The unchanged intrinsic harness eagerly constructs 87 Function bodies; shared eval/Function profiling is the next step (D/P).

For-await-of has [passing native observations for 2,431/2,431 pinned variant keys](results/cluster-f-for-await-passing-variant-coverage-audit-v1.json), across three separate frozen snapshots. The fresh [61/61 direct recheck](results/test262-cluster-f-for-await-preentry-direct-recheck-v1.json) covers all retained pre-entry failures; original [connected 570/626](results/cluster-f-for-await-connected-interruption-v1.json) and [direct unobserved 1,800/1,805](results/test262-cluster-f-for-await-unobserved-direct-v1.json) totals remain unchanged.

The complete [`language/statements/for-of` selection](results/test262-cluster-f-for-of-statements-v1.json) passes **1,442/1,442**, with zero failures, unsupported variants or infrastructure errors. The [validation record](results/cluster-f-for-of-complete-validation-v1.json) verifies all pinned variants and source identities; the runner and slot launcher exited 0.

Builtin subset checkpoint: [four complete family reports](results/cluster-f-builtins-complete-families-v1.json) record AsyncGeneratorPrototype 96/96, AsyncFromSyncIteratorPrototype 76/76, AsyncGeneratorFunction 44/46 and AsyncFunction 34/36. The [four retained after-entry timeouts](results/cluster-f-builtins-intrinsic-timeouts-v1.json) each consumed over 250 native CPU seconds; shared eval/Function profiling is the next step (D/P). The encompassing 448-variant subset is still running.

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

The reference checkpoints now pass **103/103 delete variants**, [**171/171 call variants**](results/test262-language-call-tail-transfers-v1.json) and [**184/184 super variants**](results/test262-language-super-reference-core-v1.json). All six call-group tail-call cases that previously faulted pass on the validated 566-file snapshot. The original [165/171 report and fault triage](results/language-call-tail-fault-triage-v1.json) remain retained. The complete [assignment run](results/test262-language-assignment-reference-core-v1.json) recorded **848/850**, with two failures in `fn-name-lhs-cover.js`: parenthesized assignment targets incorrectly inferred a function name. The fix passes Node and native regressions; its [combined frozen self-build](results/module-await-assignment-native-compiler-acceptance-v1.json) passes with byte-identical images and verified signature/DWARF. The complete unchanged [assignment rerun](results/test262-language-assignment-name-fixed-v1.json) now passes **850/850**, with no failures, unsupported cases, crashes or timeouts. The formerly blocked [await-using for-of canary](results/test262-language-for-of-await-using-canary-v1.json) now passes unchanged **1/1**. The complete for-of selection passes 1,442/1,442 with the module host enabled, as linked above. Top-level await, its former preparation blocker, now passes the [43-case native host gate](results/module-await-assignment-native-validation-v1.json) and 4,359 workspace tests; formal conformance remains pending.

The [new top-level-await canaries](results/language-module-await-feature-canaries-v1.json) pass **3/3 unchanged variants**: await-using iteration, dynamic-import rejection and self-import resolution order. The [current Node-only whole-language scan](results/language-preparation-inventory-node-v5.json) has 8,288 syntax-only variants, 35,971 prepared variants, 442 explicit proposal blockers and zero preparation exceptions. The three former nested-await limits now execute through bounded continuation loops. The [complete top-level-await rerun](results/test262-language-module-top-level-await-bounded-v2.json) passes **253/253**, with no failures, unsupported variants or infrastructure errors. The complete assignment rerun passes 850/850; the complete for-of report passes 1,442/1,442, as linked above.

Module direct eval now passes the [three unchanged module variants](results/module-direct-eval-selection-checkpoints-v1.json) and all [eight bespoke native host cases](results/module-direct-eval-native-validation-v1.json). Its [frozen native compiler acceptance](results/module-direct-eval-native-compiler-acceptance-v1.json) passes with byte-identical stage images, signature/DWARF verification and confirmed native entry/exit. The pre-entry launch failure remains retained. JSON/import-attribute host factories and bounded await chains pass [combined native compiler acceptance](results/json-await-native-compiler-acceptance-v1.json): eleven JSON host cases, eight await cases including runtime-compiled async code, native in-image lowering, and a byte-identical frozen self-build with signature/DWARF verification. Unchanged selection reruns remain pending; the tools-only resolver passes [five native cases](results/import-resolution-native-validation-v2.json) and all [24 unchanged former bare-specifier non-passes](results/test262-dynamic-import-bare-specifiers-native-v1.json). Its focused result overlaps the retained 1,900-variant directory report and is not merged into it. The complete [static import-attributes selection](results/test262-language-import-attributes-json-v2.json) records 12/17 passes, with five explicit text-module proposal blockers and no failures, crashes or timeouts. The complete [module-code import-attributes selection](results/test262-language-module-import-attributes-json-v2.json) passes 13/13. The complete [dynamic-import attributes selection](results/test262-language-dynamic-import-attributes-json-v2.json) records 42/44 passes; its two text-module proposal tests remain unsupported, with no failures or infrastructure outcomes. These bespoke fixtures add no conformance outcomes. Runtime-compiled imports from eval and Function entries pass [eight native cases and all workspace gates](results/managed-dynamic-import-feature-acceptance-v1.json); both [unchanged eval-import variants pass](results/test262-dynamic-import-eval-native-v1.json).

C2's complete native selections pass **6,781/6,783**: [expressions/class/elements](results/test262-c2-expressions-elements-native-v1.json) **2,941/2,943** on frozen-v19 direct, and [statements/class/dstr](results/test262-c2-statements-dstr-native-v2.json) **3,840/3,840** on frozen-v20 direct, both at batch64. The [elements validator](results/c2-expressions-elements-complete-validation-v1.json) and [destructuring validator](results/c2-statements-dstr-complete-validation-v1.json) accept every pinned variant. The two non-passes are [unsupported auto-accessors](results/c2-class-auto-accessor-blocker-v1.json); there are zero failures, timeouts, harness errors or native crashes in these complete selections. The elements run's [post-run wrapper error](results/c2-post-run-slot-wrapper-error-v1.json) is recorded separately. Earlier complete-file and family extracts overlap these complete reports. [Frozen-v20 provenance](results/c2-statements-dstr-main-provenance-v1.json) confirms its implementation was already on main.

Statements/class/elements still has a partial [file index](results/c2-elements-complete-file-index-v6.json): **1,294/1,390** across699 complete files,96 pre-entry errors; its parent remains incomplete. Separate direct rechecks pass [37/37](results/test262-c2-syntax-negative-direct-recheck-v1.json) and [44/44](results/test262-c2-retained44-direct-native-v1.json); [16 old pre-entry variants](results/c2-statements-elements-remaining16-preentry-plan-v1.json) remain prepared for recheck. A complete [3,156-variant elements manifest](results/c2-statements-elements-complete-preparation-v1.json) is prepared. Expressions/class/dstr has **480/480 passes across240 complete files** in its [first frozen-v21 direct harvest](results/c2-expressions-dstr-complete-file-harvest-v1.json), batch64; its parent remains incomplete. Complete statements/elements and expressions/class/dstr remain pending across the [13,779-variant scope](results/c2-scope-census-v1.json).

C1's complete scope covers **3,114 variants in 1,625 files**, excluding the class `elements/` and `dstr/` directories owned by C2. All **33 disjoint selections** are measured: **3,076 passes, 34 unsupported decorators, and four retained infrastructure timeouts**, each separately rechecked with a passing result. The [complete scope index](results/c1-complete-scope-native-index-v1.json) verifies pinned source hashes, coverage and every remaining non-pass. Expression selections record **1,327/1,344** and statement selections **1,749/1,770** in their original complete reports. The [decorator execution blocker](results/c1-class-decorator-blocker-v2.json) identifies the missing executable binding/lowering semantics for all 34 unsupported variants. Parent subsets, directory extracts, complete-file checkpoints and focused rechecks overlap and must be deduplicated.

| Class selection | Pass / total | Fail / unsupported / infrastructure |
| --- | ---: | ---: |
| [`language/expressions/class/accessor-name-inst`](results/test262-c1-breadth-language-expressions-class-accessor-name-inst-v1.json) | 42 / 42 | 0 / 0 / 0 |
| [`language/expressions/class/accessor-name-static`](results/test262-c1-breadth-language-expressions-class-accessor-name-static-v1.json) | 42 / 42 | 0 / 0 / 0 |
| [`language/expressions/class/async-gen-method-static`](results/test262-c1-breadth-language-expressions-class-async-gen-method-static-v1.json) | 191 / 191 | 0 / 0 / 0 |
| [`language/expressions/class/async-method`](results/test262-c1-breadth-language-expressions-class-async-method-v1.json) | 59 / 59 | 0 / 0 / 0 |
| [`language/expressions/class/async-method-static`](results/test262-c1-breadth-language-expressions-class-async-method-static-v1.json) | 59 / 59 | 0 / 0 / 0 |
| [`language/expressions/class/decorator`](results/test262-c1-breadth-language-expressions-class-decorator-v1.json) | 0 / 13 | 0 / 13 / 0 |
| [`language/expressions/class/gen-method`](results/test262-c1-breadth-language-expressions-class-gen-method-v1.json) | 55 / 55 | 0 / 0 / 0 |
| [`language/expressions/class/gen-method-static`](results/test262-c1-breadth-language-expressions-class-gen-method-static-v1.json) | 55 / 55 | 0 / 0 / 0 |
| [`language/expressions/class/method`](results/test262-c1-breadth-language-expressions-class-method-v1.json) | 35 / 35 | 0 / 0 / 0 |
| [`language/expressions/class/method-static`](results/test262-c1-breadth-language-expressions-class-method-static-v1.json) | 35 / 35 | 0 / 0 / 0 |
| [`language/expressions/class/subclass-builtins`](results/test262-c1-breadth-language-expressions-class-subclass-builtins-v1.json) | 72 / 72 | 0 / 0 / 0 |
| [`language/expressions/class/async-gen-method`](results/test262-c1-breadth-language-expressions-class-async-gen-method-v1.json) | 191 / 191 | 0 / 0 / 0 |
| [`language/expressions/class/*.js`](results/test262-c1-breadth-language-expressions-class-direct-files-v2.json) | 491 / 495 | 0 / 0 / 4 |
| [`language/statements/class/accessor-name-inst`](results/test262-c1-breadth-language-statements-class-accessor-name-inst-v1.json) | 42 / 42 | 0 / 0 / 0 |
| [`language/statements/class/accessor-name-static`](results/test262-c1-breadth-language-statements-class-accessor-name-static-v1.json) | 42 / 42 | 0 / 0 / 0 |
| [`language/statements/class/async-gen-method`](results/test262-c1-breadth-language-statements-class-async-gen-method-v1.json) | 191 / 191 | 0 / 0 / 0 |
| [`language/statements/class/async-gen-method-static`](results/test262-c1-breadth-language-statements-class-async-gen-method-static-v1.json) | 191 / 191 | 0 / 0 / 0 |
| [`language/statements/class/async-method`](results/test262-c1-breadth-language-statements-class-async-method-v1.json) | 59 / 59 | 0 / 0 / 0 |
| [`language/statements/class/async-method-static`](results/test262-c1-breadth-language-statements-class-async-method-static-v1.json) | 59 / 59 | 0 / 0 / 0 |
| [`language/statements/class/decorator`](results/test262-c1-breadth-language-statements-class-decorator-v1.json) | 0 / 21 | 0 / 21 / 0 |
| [`language/statements/class/gen-method`](results/test262-c1-breadth-language-statements-class-gen-method-v1.json) | 55 / 55 | 0 / 0 / 0 |
| [`language/statements/class/gen-method-static`](results/test262-c1-breadth-language-statements-class-gen-method-static-v1.json) | 55 / 55 | 0 / 0 / 0 |
| [`language/statements/class/method`](results/test262-c1-breadth-language-statements-class-method-v1.json) | 35 / 35 | 0 / 0 / 0 |
| [`language/statements/class/method-static`](results/test262-c1-breadth-language-statements-class-method-static-v1.json) | 35 / 35 | 0 / 0 / 0 |
| [`language/statements/class/subclass`](results/test262-c1-breadth-language-statements-class-subclass-v1.json) | 217 / 217 | 0 / 0 / 0 |
| [`language/statements/class/subclass-builtins`](results/test262-c1-breadth-language-statements-class-subclass-builtins-v1.json) | 72 / 72 | 0 / 0 / 0 |
| [`language/statements/class/*.js`](results/test262-c1-breadth-language-statements-class-direct-files-v3.json) | 504 / 504 | 0 / 0 / 0 |
| [`language/statements/class/syntax`](results/test262-c1-foundation-language-statements-class-syntax-v2.json) | 26 / 26 | 0 / 0 / 0 |
| [`language/statements/class/definition`](results/test262-c1-foundation-language-statements-class-definition-v2.json) | 130 / 130 | 0 / 0 / 0 |
| [`language/statements/class/name-binding`](results/test262-c1-foundation-language-statements-class-name-binding-v2.json) | 12 / 12 | 0 / 0 / 0 |
| [`language/statements/class/arguments`](results/test262-c1-foundation-language-statements-class-arguments-v2.json) | 4 / 4 | 0 / 0 / 0 |
| [`language/statements/class/strict-mode`](results/test262-c1-foundation-language-statements-class-strict-mode-v2.json) | 4 / 4 | 0 / 0 / 0 |
| [`language/statements/class/super`](results/test262-c1-foundation-language-statements-class-super-v2.json) | 16 / 16 | 0 / 0 / 0 |

The arguments selection also retains a [post-completion launcher failure](results/c1-slot-launcher-reexecution-v1.json): its four original native variants passed, and journal exclusivity rejected an unintended second runner invocation before any further native execution. The [immutable-source launcher correction](results/c1-slot-snapshot-launch-validation-v1.json) completed the next selection with a single invocation and exit 0.

The separate derived-constructor completion-realm fix passes all eight [native cases](results/class-caller-context-native-validation-v1.json) and a byte-identical self-build. Base-class construction now performs OrdinaryCreateFromConstructor in the caller's context (ECMA-262 10.2.2 step 5.a). It passes seven [baseline native cases](results/native-class-construction-realm-validation-v3.json) and **331/331** unchanged variants on its [frozen host](results/frozen-node-toolchain-class-realm-v1.json): `built-ins/Function/internals` (16/16, including the three formerly unsupported cross-realm cases), `super/realm.js` and ten private-element realm files (15/15), and the 14 private-method, private-accessor, evaluation-error, generator and async private-method subfamilies of statement and expression `class/elements` (300/300). See the [controller report](results/class-realm-native-v7.json) and the [grant reconciliation](results/class-realm-native-grant-reconciliation-v1.json). These are focused selections, not the full `class/elements` directories. Those images were built from source snapshot `08b02d1c`; main's later lowering and Promise changes were validated natively on their own snapshots, as the [integration provenance](results/class-realm-main-integration-provenance-v1.json) records. The Stage 3 `nonextensible-applies-to-private` proposal is validated separately in [11 native regression cases](results/c1-instance-elements-native-v1.json), matching the pinned subclass/elements tests; it is not part of the 331-variant baseline measurement. Its [frozen native self-build](results/c1-frozen-selfbuild-v2.json) produces byte-identical 71,847,842-byte debug stage images with passing signature and DWARF checks. Tail-call lowering passes 4,334 workspace tests, [ten lowered-JavaScript native cases](results/tail-lowering-native-validation-v1.json) and [in-image compilation](results/tail-in-image-native-validation-v1.json), each at 100,000 calls. Its [native compiler gate](results/language-tail-call-native-compiler-acceptance-v1.json) passes stage identity, signature and DWARF checks. [Implementation boundaries](test262-backlog/language-tail-call-boundaries.md) still exclude raw class-constructor callbacks and Proxy trap forwarding; the call-group pass does not claim those paths are complete.

The [20-case native arguments/parameter/eval-scope fixture](results/native-arguments-scope-validation-v1.json) completes 19 cases; [case 16](results/native-arguments-scope-case-16-analysis-v1.json) exposes a direct-eval lowering defect that copies Annex B block functions to the global object instead of the caller variable environment. That failure is retained. After the lowering fix, a [new image completes all 20 cases](results/annexb-eval-copy-arguments-scope-validation-v2.json) under LLDB, and the [direct-eval Annex B fixture](results/annexb-eval-copy-direct-eval-annex-validation-v2.json) passes 15/15. Neither fixture adds conformance outcomes.

The complete operator selections pass [equals **93/93**](results/test262-operator-equals-current-v3.json), [less-than **89/89**](results/test262-operator-less-than-current-v3.json), [exponentiation **88/88**](results/test262-operator-exponentiation-current-v3.json), [subtraction **75/75**](results/test262-operator-subtraction-current-v3.json) and [multiplication **79/79**](results/test262-operator-multiplication-current-v4.json), with zero non-passes. The complete [coalesce selection passes **46/46**](results/test262-operator-coalesce-native-v1.json). The new complete [prefix-increment rerun passes **57/57**](results/test262-operator-prefix-increment-native-v1.json), with zero non-passes. The complete [modulus selection records **77/79**](results/test262-operator-modulus-native-v1.json), retaining two post-entry eval timeouts and no other non-passes; its [driver diagnostic](results/operator-modulus-throughput-diagnostic-v1.json) preserves the rejected duplicate launch after report completion. [Addition records **94/95**](results/test262-operator-addition-current-v1.json), retaining one timeout after the initial stop and no assertion failures. The complete [resumed division run records **87/89**](results/test262-operator-division-resumed-v1.json), retaining two post-entry timeouts in the whitespace-and-eval test and no other non-passes; its [initial interruption](results/operator-v5-direct-handoff-v1.json) remains separate. The [separate native coercion fixture](results/native-operator-coercion-validation-v3.json) retains a post-entry timeout in case 1; [case 7 passes separately](results/native-operator-coercion-case-7-validation-v1.json). These reports retain their own frozen provenance.

The next queue continues function environments, arguments/rest parameters, function and arrow bodies, construction, and control flow using the same frozen compiler. It stops for triage on an unexpected non-pass. Full-suite measurement, compiler-performance work and broad Object/Array expansion remain deferred.

The complete [logical-assignment selection](results/test262-reference-keys-logical-assignment-v4.json) passes **132/132** unchanged variants with the computed-reference-key fix. The three focused assignment computed-reference files pass **2/2 each** ([ordinary](results/test262-reference-keys-assignment-target-member-computed-reference-v6.json), [null](results/test262-reference-keys-assignment-target-member-computed-reference-null-v6.json), [undefined](results/test262-reference-keys-assignment-target-member-computed-reference-undefined-v6.json)); these overlap the complete assignment family and do not add to its denominator. The [Phase 1 handoff](results/cluster-e-phase1-handoff-v1.json) preserves the inherited controller retirement and validation provenance. The fresh complete [compound-assignment selection](results/test262-compound-assignment-phase2-v1.json) passes **786/786**, with zero non-passes; [acceptance and toolchain provenance](results/assignment-phase2-compound-acceptance-v1.json) retain the measurement identity. The fresh complete [assignment rerun](results/test262-assignment-phase2-v1.json), including `dstr`, passes **850/850**, with zero non-passes. Its [acceptance](results/assignment-phase2-complete-acceptance-v1.json) preserves the 702-observation emergency prefix, original frozen toolchain and successful completion after resuming the remaining 148 variants.

## Behavior inventory

The [measurement-gap scan](test262-measurement-gaps.md) identifies unmeasured groups
with existing implementation and the dependencies the current full survey will
measure. Implementation of known gaps has resumed; the full baseline run is deferred until those gaps and compile-performance work are addressed.

The complete [tagged-template directory passes **48/48 unchanged variants**](results/test262-language-tagged-template-current-v1.json), with no failures, unsupported cases or infrastructure errors. Runtime-compiled sites also pass [ten native semantic checks](results/managed-template-feature-acceptance-v1.json). The [12/12 cache subset](results/managed-template-cache-conformance-acceptance-v1.json) overlaps that full report and is not added to its totals. The 256 KiB entry cap is unchanged; the retained oversized async fixture remains an explicit budget limit.

The [complete group inventory](test262-inventory.md) lists all **139 families**, including every measured, partially measured and unmeasured group. Its [v91 evidence snapshot](results/test262-native-group-inventory-v91.json) inherits the [v89](results/test262-native-group-inventory-v89.json) audit of 710 completed native reports and conservatively replaces only the re-verified complete arguments-object and Annex B function-code reports ([v90](results/test262-native-group-inventory-v90.json)) and the complete built-ins/Proxy report ([v91 diff](results/test262-native-group-inventory-v91-refresh-v1.json)) listed above; it is not a new full rescan.

| Evidence status | Families |
| --- | ---: |
| Complete family report, all passing | 33 |
| Complete family report, non-passes remain | 28 |
| Selection evidence, no dedicated complete family report | 29 |
| No recorded outcomes in completed reports | 49 |

Completed reports contain outcomes for **33,707 distinct variants**; **69,557** have no outcome in those reports. This is a historical evidence footprint, not a combined pass rate. In-progress journals are excluded. All **103,264 variants** separately pass native syntax validation. Historical family ratios can predate current fixes.

### Language execution inventory

The [language execution inventory](results/test262-language-execution-inventory-v1.json)
splits all **44,701 `language/*` variants** (23,828 files) into 125 subgroups:
families, plus subdirectories of `expressions`, `statements` and `eval-code`.
A subgroup is complete only when one clean native report covers its whole
population at the pinned revision. Reports bound to a frozen toolchain are
listed separately from older workspace-snapshot and unattributed reports. Node
reference reports are excluded. Partial reports add an outcome footprint only;
overlapping reports are never summed.

Complete core-family reports use LLDB entry/exit containment and unchanged
harnesses. Each report retains its own frozen source identity; the inherited
reports use the [annexb-eval-copy host](results/frozen-node-toolchain-annexb-eval-copy-v1.json),
and later reruns freeze current main. These selections are not a combined
current-toolchain pass rate:

| Family | Passed / total | Report |
| --- | ---: | --- |
| `language/source-text` | 2/2 | [Report](results/test262-language-core-source-text-v2.json) |
| `language/identifier-resolution` | 22/22 | [Report](results/test262-language-core-identifier-resolution-v2.json) |
| `language/punctuators` | 22/22 | [Report](results/test262-language-core-punctuators-v2.json) |
| `language/reserved-words` | 53/53 | [Report](results/test262-language-core-reserved-words-v2.json) |
| `language/directive-prologue` | 62/62 | [Report](results/test262-language-core-directive-prologue-v2.json) |
| `language/comments` | 81/81 | [Report](results/test262-language-core-comments-v2.json) |
| `language/computed-property-names` | 96/96 | [Report](results/test262-language-computed-property-names-direct-v3.json) |
| `language/future-reserved-words` | 85/85 | [Report](results/test262-language-future-reserved-words-direct-v3.json) |
| `language/line-terminators` | 82/82 | [Report](results/test262-a1-phase1-language-line-terminators-heartbeat-v1.json) |
| `language/white-space` | 134/134 | [Report](results/test262-a1-phase1-language-white-space-heartbeat-v1.json) |

The inherited [integrated-main controls](results/language-main-controls-interruption-v3.json) stopped at the coordinator-directed case boundary after four passing class-realm cases; 81 controls remain unexecuted. These bespoke cases are separate from native conformance and do not gate the already-validated frozen host used for the queued language selections.

The current direct-eval rerun passes [**336/336**](results/test262-language-direct-eval-current-v1.json).
Proper tail calls remain a standard gap: the six `tail-call-optimization`
variants in the complete [call report](results/test262-language-call-reference-core-v1.json)
exhaust the native stack.

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
| `built-ins/Proxy`                         |        607/607 | [Report](results/test262-proxy-reflect-built-ins-proxy-v2.json)       |
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
| `language/eval-code/direct`              |        336/336 | [Report](results/test262-language-direct-eval-current-v1.json) |

### Measured families with remaining work

Counts below retain every failure, unsupported case and infrastructure error. Partial reruns do not replace an older full-family total.

| Family                                                                                                              |         Passed / total | Remaining outcomes                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------: | --------------------------------------------------------------------------------------------------------- |
| [`built-ins/Array/prototype/toLocaleString`](results/test262-array-tolocalestring-native-v1.json)                   |       16 / 22 (72.73%) | 6 unsupported variants use dynamically compiled subclasses in the resizable-buffer harness                |
| [`built-ins/TypedArray/from`](results/test262-typedarray-from-cluster-k-v1.json) | 42 / 42 (100%) | Complete verified extraction; overlaps the held TypedArray survey |
| [`built-ins/TypedArray/Symbol.species`](results/test262-typedarray-species-cluster-k-v1.json) | 8 / 8 (100%) | Complete verified extraction; overlaps the held TypedArray survey |
| [`built-ins/TypedArray/of`](results/test262-typedarray-of-cluster-k-v2.json) | 16 / 16 (100%) | Direct-mode complete extraction; overlaps the running TypedArray survey; earlier launch failure retained |
| [`built-ins/TypedArray/prototype/Symbol.iterator`](results/test262-typedarray-iterator-cluster-k-v1.json) | 2 / 2 (100%) | Complete verified extraction; overlaps the held TypedArray survey |
| [`built-ins/TypedArray/prototype/Symbol.toStringTag`](results/test262-typedarray-tostringtag-cluster-k-v2.json) | 36 / 36 (100%) | Direct-mode complete extraction; overlaps the running TypedArray survey; earlier launch failure retained |
| [`built-ins/TypedArray/prototype/at`](results/test262-typedarray-at-cluster-k-v1.json) | 30 / 30 (100%) | Complete verified extraction; overlaps the held TypedArray survey |
| [`built-ins/TypedArray/prototype/buffer`](results/test262-typedarray-buffer-cluster-k-v1.json) | 24 / 24 (100%) | Complete verified extraction; overlaps the held TypedArray survey |
| [`built-ins/TypedArray/prototype/byteLength/BigInt`](results/test262-typedarray-bigint-bytelength-cluster-k-v1.json) | 8 / 8 (100%) | Complete verified extraction; overlaps the held TypedArray survey |
| [`built-ins/TypedArray/prototype/byteLength`](results/test262-typedarray-bytelength-cluster-k-v1.json) | 36 / 36 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey and BigInt subset |
| [`built-ins/TypedArray/prototype/byteOffset`](results/test262-typedarray-byteoffset-cluster-k-v1.json) | 32 / 32 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/copyWithin/BigInt`](results/test262-typedarray-copywithin-bigint-cluster-k-v1.json) | 48 / 48 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/copyWithin`](results/test262-typedarray-copywithin-cluster-k-v1.json) | 129 / 130 (99.23%) | Complete verified direct-mode extraction; one retained post-entry timeout; overlaps the parent and BigInt subset |
| [`built-ins/TypedArray/prototype/entries`](results/test262-typedarray-entries-cluster-k-v1.json) | 38 / 38 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/every`](results/test262-typedarray-every-cluster-k-v1.json) | 88 / 88 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/fill`](results/test262-typedarray-fill-cluster-k-v1.json) | 104 / 104 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/filter`](results/test262-typedarray-filter-cluster-k-v1.json) | 174 / 174 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/find`](results/test262-typedarray-find-cluster-k-v1.json) | 72 / 72 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/findIndex`](results/test262-typedarray-findindex-cluster-k-v1.json) | 72 / 72 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/findLast`](results/test262-typedarray-findlast-cluster-k-v1.json) | 72 / 72 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/findLastIndex`](results/test262-typedarray-findlastindex-cluster-k-v1.json) | 72 / 72 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/forEach`](results/test262-typedarray-foreach-cluster-k-v1.json) | 84 / 84 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/includes`](results/test262-typedarray-includes-cluster-k-v1.json) | 90 / 90 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/indexOf`](results/test262-typedarray-indexof-cluster-k-v1.json) | 86 / 86 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/join`](results/test262-typedarray-join-cluster-k-v1.json) | 64 / 64 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/keys`](results/test262-typedarray-keys-cluster-k-v1.json) | 38 / 38 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/prototype/lastIndexOf`](results/test262-typedarray-lastindexof-cluster-k-v1.json) | 84 / 84 (100%) | Complete verified direct-mode extraction; overlaps the running TypedArray survey |
| [`built-ins/TypedArray/out-of-bounds-behaves-like-detached.js`](results/test262-typedarray-out-of-bounds-behaves-like-detached-cluster-k-v2.json) | 2 / 2 (100%) | Complete verified direct-mode file extraction; earlier timeouts retained |
| [`built-ins/TypedArray/out-of-bounds-get-and-set.js`](results/test262-typedarray-out-of-bounds-get-and-set-cluster-k-v2.json) | 2 / 2 (100%) | Complete verified direct-mode file extraction; earlier timeout retained |
| [`built-ins/TypedArray/out-of-bounds-has.js`](results/test262-typedarray-out-of-bounds-has-cluster-k-v2.json) | 2 / 2 (100%) | Complete verified direct-mode file extraction; earlier timeouts retained |
| [`built-ins/TypedArray/prototype/toLocaleString`](results/test262-typed-array-tolocalestring-native-v1.json)        |       72 / 78 (92.31%) | 6 unsupported variants use that same harness; no failures or infrastructure errors                        |
| [`intl402/NumberFormat`](results/test262-intl-number-format-family-native-v4.json)                                  |     406 / 502 (80.88%) | 2 shared-harness failures; 92 unsupported variants; 2 pre-entry timeouts                                  |
| [`intl402/PluralRules`](results/test262-plural-rules-native-v1.json)                                                |     104 / 106 (98.11%) | 2 shared harness failures: missing Intl service constructors                                              |
| [`built-ins/RegExp` — 704 complete files](results/cluster-j-regexp-completed-files-v23.json) | 1404 / 1408 (99.72%) | Frozen965c43d4:384 syntax-negative and1024 runtime observations;4 original unsupported variants retained beside successful focused rechecks; parent run held after [host OOM](results/cluster-j-regexp-host-oom-interruption-v1.json); overlaps child reports |
| [`RegExp` generated ASCII](results/test262-cluster-j-current-built-ins-RegExp-property-escapes-generated-ASCII-v20.json) | 2 / 2 (100%) | Complete current4337c648 file; [historical timeouts](results/test262-regexp-ascii-generated-native-v5.json) retained; other generated files in [focused index](results/cluster-j-generated-property-first-passes-v20.json) |
| [`RegExp` nested-group recheck](results/test262-cluster-j-regexp-nesting-recheck-v19.json) | 4 / 4 (100%) | Complete affected files on iterative parser880a705b; original four unsupported variants retained in the broad965c43d4 report |
| [`built-ins/RegExp/CharacterClassEscapes`](results/test262-cluster-j-current-built-ins-RegExp-CharacterClassEscapes-v17.json) | 24 / 24 (100%) | Complete current frozen965c43d4 run; [historical12/24](results/test262-cluster-j-character-class-escapes-baseline-v1.json) and timeout rechecks retained; overlaps file index |
| [`built-ins/RegExp/Symbol.species`](results/test262-cluster-j-current-built-ins-RegExp-Symbol.species-v17.json) | 8 / 8 (100%) | Complete frozen965c43d4 selection; overlaps the complete-file index |
| [`built-ins/RegExp/dotall`](results/test262-cluster-j-current-built-ins-RegExp-dotall-v17.json) | 8 / 8 (100%) | Complete frozen965c43d4 selection; overlaps the complete-file index |
| [`built-ins/RegExp/escape`](results/test262-cluster-j-current-built-ins-RegExp-escape-v17.json) | 40 / 40 (100%) | Complete frozen965c43d4 selection; overlaps the complete-file index |
| [`built-ins/RegExp/lookBehind`](results/test262-cluster-j-current-built-ins-RegExp-lookBehind-v17.json) | 34 / 34 (100%) | Complete frozen965c43d4 selection; overlaps the complete-file index |
| [`built-ins/RegExp/match-indices`](results/test262-cluster-j-current-built-ins-RegExp-match-indices-v17.json) | 28 / 28 (100%) | Complete frozen965c43d4 selection; overlaps the complete-file index |
| [String locale casing and primitive protocol regressions](results/test262-cluster-j-string-locale-protocol-native-v26.json) | 158 / 158 (100%) | Complete casing108, primitive protocol46 and G casing descriptors4; full G6 remains pending localeCompare; source9f9d7480; overlaps family/method reports |
| [`built-ins/String` — complete family](results/test262-cluster-j-string-family-native-v21.json) | 2267 / 2443 (92.80%) | Frozen4337c648;176 assertion failures:2 signed-zero (fixed separately),46 primitive protocols,104 locale casing,24 localeCompare; no infrastructure errors; overlaps file and method reports |
| [`built-ins/String` — 993 complete files](results/cluster-j-string-completed-files-v25.json) | 1807 / 1983 (91.12%) | Frozen4337c648,993 complete files;176 failures retained, one extra pass in1984-observation prefix; full2443 family complete above; overlaps method reports |
| [`built-ins/String` — historical320 complete files](results/cluster-j-string-completed-files-v13.json) | 639 / 639 (100%) | Older frozen5fa3391 retained; overlaps current file reports |
| [`built-ins/String/fromCharCode`](results/test262-cluster-j-current-built-ins-String-fromCharCode-v21.json) | 34 / 34 (100%) | Current balanced-builder snapshot4337c648; overlaps file indices |
| [`built-ins/String/fromCodePoint`](results/test262-cluster-j-current-built-ins-String-fromCodePoint-v21.json) | 22 / 22 (100%) | Current balanced-builder snapshot4337c648; overlaps file indices |
| [`built-ins/String/prototype/Symbol.iterator`](results/test262-cluster-j-current-built-ins-String-prototype-Symbol.iterator-v21.json) | 12 / 12 (100%) | Current frozen4337c648 complete selection; overlaps file indices |
| [`built-ins/String/prototype/at`](results/test262-cluster-j-current-built-ins-String-prototype-at-v21.json) | 22 / 22 (100%) | Current frozen4337c648 complete selection; overlaps file indices |
| [`built-ins/String/prototype/charAt`](results/test262-cluster-j-current-built-ins-String-prototype-charAt-v21.json) | 60 / 60 (100%) | Current frozen4337c648 complete selection; overlaps file indices |
| [`built-ins/String/prototype/charCodeAt`](results/test262-cluster-j-current-built-ins-String-prototype-charCodeAt-v21.json) | 50 / 50 (100%) | Current frozen4337c648 complete selection; overlaps file indices |
| [`built-ins/String/prototype/codePointAt`](results/test262-cluster-j-current-built-ins-String-prototype-codePointAt-v21.json) | 32 / 32 (100%) | Current frozen4337c648 complete selection; overlaps file indices |
| [`built-ins/String/prototype/concat`](results/test262-cluster-j-current-built-ins-String-prototype-concat-v21.json) | 44 / 44 (100%) | Current frozen4337c648 complete selection; overlaps file indices |
| [`built-ins/String/prototype/constructor`](results/test262-cluster-j-current-built-ins-String-prototype-constructor-v21.json) | 4 / 4 (100%) | Current frozen4337c648 complete selection; overlaps file indices |
| [`built-ins/String/prototype/endsWith`](results/test262-cluster-j-current-built-ins-String-prototype-endsWith-v21.json) | 54 / 54 (100%) | Current frozen4337c648 complete selection; overlaps file indices |
| [`built-ins/String/prototype/includes`](results/test262-cluster-j-current-built-ins-String-prototype-includes-v21.json) | 54 / 54 (100%) | Current frozen4337c648 complete selection; overlaps file indices |
| [`built-ins/String/prototype/indexOf`](results/test262-cluster-j-string-indexof-native-v22.json) | 94 / 94 (100%) | Signed-zero clamp fixed; complete frozen3b02635c rerun, integratedaa2de862 two-case recheck2/2; old failures retained |
| [`built-ins/String/prototype/isWellFormed`](results/test262-cluster-j-current-built-ins-String-prototype-isWellFormed-v21.json) | 16 / 16 (100.00%) | Current direct-launch complete selection; overlaps file index |
| [`built-ins/String/prototype/lastIndexOf`](results/test262-cluster-j-current-built-ins-String-prototype-lastIndexOf-v21.json) | 50 / 50 (100.00%) | Current direct-launch complete selection; overlaps file index |
| [`built-ins/String/prototype/localeCompare`](results/test262-cluster-j-current-built-ins-String-prototype-localeCompare-v21.json) | 2 / 26 (7.69%) | 24 failures: missing method; Collator and String locale implementation now assigned to J; overlaps file index |
| [`built-ins/String/prototype/match`](results/test262-cluster-j-current-built-ins-String-prototype-match-v21.json) | 94 / 102 (92.16%) | Primitive symbol-dispatch failures retained; fix in native validation; frozen4337c648, overlaps file index |
| [`built-ins/String/prototype/matchAll`](results/test262-cluster-j-current-built-ins-String-prototype-matchAll-v21.json) | 44 / 50 (88.00%) | Primitive symbol-dispatch failures retained; fix in native validation; frozen4337c648, overlaps file index |
| [`built-ins/String/prototype/normalize`](results/test262-cluster-j-current-built-ins-String-prototype-normalize-v21.json) | 28 / 28 (100.00%) | Complete direct native selection; frozen4337c648, overlaps file index |
| [`built-ins/String/prototype/padEnd`](results/test262-cluster-j-current-built-ins-String-prototype-padEnd-v21.json) | 26 / 26 (100.00%) | Complete direct native selection; frozen4337c648, overlaps file index |
| [`built-ins/String/prototype/padStart`](results/test262-cluster-j-current-built-ins-String-prototype-padStart-v21.json) | 26 / 26 (100.00%) | Complete direct native selection; frozen4337c648, overlaps file index |
| [`built-ins/String/prototype/repeat`](results/test262-cluster-j-current-built-ins-String-prototype-repeat-v21.json) | 32 / 32 (100.00%) | Complete direct native selection; frozen4337c648, overlaps file index |
| [`built-ins/String/prototype/toLowerCase`](results/test262-cluster-j-current-built-ins-String-prototype-toLowerCase-v21.json) | 60 / 60 (100.00%) | Complete frozen4337c648 native selection; 0 failures retained; overlaps file index |
| [`built-ins/String/prototype/toLocaleUpperCase`](results/test262-cluster-j-string-tolocaleuppercase-native-v26.json) | 52 / 52 (100%) | Complete frozen9f9d7480 native rerun after Unicode locale casing implementation; old failures retained; overlaps focused158 and full String |
| [`built-ins/String/prototype/toLocaleLowerCase`](results/test262-cluster-j-string-tolocalelowercase-native-v26.json) | 56 / 56 (100%) | Complete frozen9f9d7480 native rerun after Unicode locale casing implementation; old failures retained; overlaps focused158 and full String |
| [`built-ins/String/prototype/substring`](results/test262-cluster-j-current-built-ins-String-prototype-substring-v21.json) | 92 / 92 (100.00%) | Complete frozen4337c648 native selection; 0 failures retained; overlaps file index |
| [`built-ins/String/prototype/startsWith`](results/test262-cluster-j-current-built-ins-String-prototype-startsWith-v21.json) | 42 / 42 (100.00%) | Complete frozen4337c648 native selection; 0 failures retained; overlaps file index |
| [`built-ins/String/prototype/split`](results/test262-cluster-j-current-built-ins-String-prototype-split-v21.json) | 232 / 240 (96.67%) | Complete frozen4337c648 native selection; 8 failures retained; overlaps file index |
| [`built-ins/String/prototype/slice`](results/test262-cluster-j-current-built-ins-String-prototype-slice-v21.json) | 76 / 76 (100.00%) | Complete frozen4337c648 native selection; 0 failures retained; overlaps file index |
| [`built-ins/String/prototype/search`](results/test262-cluster-j-current-built-ins-String-prototype-search-v21.json) | 78 / 86 (90.70%) | Complete frozen4337c648 native selection; 8 failures retained; overlaps file index |
| [`built-ins/String/prototype/replaceAll`](results/test262-cluster-j-current-built-ins-String-prototype-replaceAll-v21.json) | 82 / 90 (91.11%) | Complete frozen4337c648 native selection; 8 failures retained; overlaps file index |
| [`built-ins/String/prototype/replace`](results/test262-cluster-j-current-built-ins-String-prototype-replace-v21.json) | 100 / 108 (92.59%) | Complete frozen4337c648 native selection; 8 failures retained; overlaps file index |
| [`annexB/built-ins/RegExp`](results/test262-annexb-regexp-native-v2.json)                                           |     120 / 124 (96.77%) | 4 unsupported                                                                                             |
| [`annexB/language/function-code`](results/test262-annexb-function-code-current-v3.json)                             |     158 / 159 (99.37%) | 1 failure: pinned implicit-arguments expectation predates current B.3.2.1                                 |
| [`annexB/language/eval-code/direct`](results/test262-annexb-closure-annexB-language-eval-code-direct-v3.json) | 309 / 310 (99.68%) | 1 native timeout after entry; 0 unsupported ([harvest](results/annexb-closure-native-harvest-v4.json)); [focused recheck](results/d-catch-single-phase2-analysis-v1.json) is load-induced/inconclusive |
| [`language/module-code/ambiguous-export-bindings`](results/test262-module-ambiguous-exports-a3-v1.json) |        8 / 10 (80.00%) | 1 unsupported source-phase import; 1 pre-entry LLDB launch failure; no semantic failures or timeouts |
| [`language/expressions/import.meta`](results/test262-import-meta-a3-ordering-v1.json) | 26 / 27 (96.30%) | 1 pre-entry LLDB launch failure; no semantic failures, unsupported cases or timeouts |
| [`language/global-code`](results/test262-language-core-global-code-v3-direct-v1.json) | 70 / 75 (93.33%) | 5 post-entry timeouts; saturated-host outcomes retained; separate focused rechecks pending |
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
| [`built-ins/Iterator`](results/test262-iterator-family-current-native-v1.json)                                      | 1,364 / 1,368 (99.71%) | 4 timeouts in intrinsic enumeration (zip/zipKeyed `result-is-iterator.js`); no failures or unsupported    |
| [`built-ins/Math`](results/test262-math-family-native-v1.json)                                                      |     652 / 654 (99.69%) | 2 pre-entry debugger failures                                                                             |
| [`built-ins/SuppressedError`](results/test262-suppressed-error-native-v1.json)                                      |       40 / 44 (90.91%) | 4 unsupported                                                                                             |
| [`built-ins/ArrayBuffer`](results/test262-arraybuffer-shared-native-v2.json)                                        |       442 / 442 (100%) | No failures or infrastructure errors                                                                      |
| [`built-ins/Atomics`](results/test262-atomics-family-native-v1.json)                                                |     366 / 778 (47.04%) | Wait/notify/agents incomplete; six pre-entry failures                                                     |
| [`built-ins/DataView`](results/test262-dataview-shared-native-v2.json)                                              | 1,110 / 1,120 (99.11%) | 10 pre-entry LLDB attach failures; no semantic failures                                                   |
| [`built-ins/SharedArrayBuffer`](results/test262-sharedarraybuffer-native-v4.json)                                   |       208 / 208 (100%) | No failures or infrastructure errors                                                                      |
| [`language/arguments-object`](results/test262-language-arguments-object-current-v1.json)                            |     458 / 460 (99.57%) | 2 optional legacy `arguments.caller` failures (sloppy); former strict eval unsupported cases pass         |
| [`language/destructuring`](results/test262-destructuring-native-v2.json)                                            |       34 / 37 (91.89%) | 2 unsupported resizable-buffer variants; 1 LLDB startup failure                                                                                  |
| [`language/rest-parameters`](results/test262-rest-parameters-native-v2.json)                                        |       21 / 22 (95.45%) | 1 LLDB startup failure; native outcome unestablished                                                                                                 |
| [`intl402/Locale`](results/test262-locale-family-native-v4.json)                                                    |     338 / 380 (88.95%) | 42 unavailable calendar/collation-service variants                                                        |
| [`built-ins/FinalizationRegistry`](results/test262-finalization-registry-native-v1.json)                            |       93 / 94 (98.94%) | 1 pre-entry launch failure; no semantic failures or unsupported cases                                     |
| [`built-ins/WeakSet`](results/test262-weak-set-native-v1.json)                                                      |     169 / 170 (99.41%) | 1 pre-entry launch failure; no semantic failures or unsupported cases                                     |

The Annex B function-code failure is a [pinned implicit-arguments expectation that differs from current specification rules](results/test262-annexb-implicit-arguments-spec-v1.json); Node reproduces it, and native fixture case 19 confirms the current-rule replacement. The rerun's [grant accounting](results/test262-annexb-function-code-current-grants-v3.json) retains one 65-variant lane grant (a scheduling breach; observations remain valid). Date’s six historical-zone failures are also [reproduced in Node](results/test262-date-to-iso-string-node-v1.json). These remain failures in the native denominator.

The BigInt family report predates the `toString.length` correction. Its [focused Test262 run](results/test262-bigint-tostring-length-native-v1.json) retained two pre-entry failures; the separate [native fixture](results/native-bigint-metadata-v3.json) verifies the corrected descriptor and decimal/binary calls. Neither replaces the complete family total.

## Recent selections within larger families

The [complete object report](results/test262-language-object-direct-a2-native-v1.json) records **2,249/2,252 passes**, retaining three pre-entry host-authorization timeouts. Its [separate explicit recheck](results/test262-object-authorization-recheck-a2-native-v1.json) passes **3/3** on freshly frozen current main; the original outcomes remain unchanged. The complete [standalone selection, **573/573**](results/test262-object-root-a2-native-v1.json), and [method-definition selection, **557/557**](results/test262-object-method-definition-a2-native-v1.json), overlap the full report and earlier file checkpoints. [Completion evidence](results/cluster-a2-object-direct-completion-v1.json) preserves the interrupted prefix and post-report wrapper error.

The [focused object-literal recheck](results/test262-object-load-timeout-recheck-a2-native-v1.json) passes **2/2** on the new direct-launch snapshot. The [original connected prefix](results/cluster-a2-object-connected-supersession-interruption-v1.json) retains its load-induced timeout and pre-entry failure for that file.

The [A2 scope audit](results/cluster-a2-scope-complete-final-v1.md) combines complete reports and separate focused rechecks from frozen runs: **4,973/4,973** latest passing variants across 18 owned expression families (3,753 runtime; 1,220 native syntax/early-error variants). Original reports and timeout observations remain unchanged. [Final merge validation](results/cluster-a2-final-readiness-v1.json) records the covering workspace gate.

These selections overlap other reports and cannot be added into an overall coverage percentage. The group inventory retains the other complete selections.

| Selection                    |      Passed / total | Remaining                           | Report                                                                       |
| ---------------------------- | ------------------: | ----------------------------------- | ---------------------------------------------------------------------------- |
| Block scope                  |    287 / 287 (100%) | None                                | [Report](results/test262-language-block-scope-core-v1.json)                  |
| Const destructuring          |    186 / 186 (100%) | None                                | [Report](results/test262-language-const-destructuring-core-v1.json)          |
| Catch destructuring          |    186 / 186 (100%) | None                                | [Report](results/test262-language-catch-destructuring-core-v1.json)          |
| Parameter destructuring      |    372 / 372 (100%) | None                                | [Report](results/test262-language-parameter-destructuring-core-v1.json)      |
| Grouping expressions         |      15 / 16 (93.75%) | 1 original timeout; isolated recheck 1/1 | [Report](results/test262-expressions-grouping-a2-native-v1.json) / [Recheck](results/test262-grouping-strict-isolated-recheck-a2-native-v1.json)      |
| Member expressions           |         2 / 2 (100%) | None                                | [Report](results/test262-expressions-member-expression-a2-native-v1.json)   |
| Conditional expressions      |      41 / 42 (97.62%) | 1 original timeout; isolated recheck 1/1 | [Report](results/test262-expressions-conditional-a2-native-v1.json) / [Recheck](results/test262-conditional-strict-isolated-recheck-a2-native-v1.json)   |
| Comma expressions            |       11 / 11 (100%) | None                                | [Report](results/test262-expressions-comma-a2-native-v1.json)               |
| `new.target` expressions     |       28 / 28 (100%) | None | [Report](results/test262-expressions-new.target-a2-native-v1.json) |
| `this` expressions           |       11 / 11 (100%) | None | [Report](results/test262-expressions-this-a2-native-v1.json) |
| Template literals            |     114 / 114 (100%) | None | [Report](results/test262-expressions-template-literal-a2-native-v1.json) |
| Tagged templates             |       48 / 48 (100%) | None | [Report](results/test262-expressions-tagged-template-a2-native-v1.json) |
| Property accessors           |       41 / 42 (97.62%) | 1 original timeout; isolated recheck 1/1 | [Report](results/test262-expressions-property-accessors-a2-native-v1.json) / [Recheck](results/test262-property-eval-sloppy-isolated-recheck-a2-native-v1.json) |
| Optional chaining            |       75 / 76 (98.68%) | 1 original timeout; isolated recheck 1/1 | [Report](results/test262-expressions-optional-chaining-a2-native-v1.json) / [Recheck](results/test262-optional-eval-sloppy-isolated-recheck-a2-native-v1.json) |
| New expressions              |    114 / 118 (96.61%) | 4 original timeouts; isolated rechecks 4/4 | [Report](results/test262-expressions-new-a2-native-v1.json) / [Rechecks](results/cluster-a2-new-isolated-rechecks-summary-v1.json) |
| Call expressions             |     171 / 171 (100%) | None                                | [Report](results/test262-expressions-call-a2-native-v1.json)                |
| Array expressions            |     104 / 104 (100%) | None                                | [Report](results/test262-expressions-array-a2-native-v1.json)               |
| Function expressions         |     484 / 484 (100%) | None                                | [Report](results/test262-function-a2-native-v1.json)                        |
| Arrow functions              |     643 / 643 (100%) | None                                | [Report](results/test262-arrow-function-a2-native-v1.json)                  |
| Assignment target type       |     627 / 627 (100%) | None                                | [Report](results/test262-assignmenttargettype-a2-native-v1.json)             |
| Object method destructuring  | 1,122 / 1,122 (100%) | None                                | [Report](results/test262-language-object-destructuring-a2-native-v1.json)     |
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
| Temporal.ZonedDateTime.from  | 176 / 182 (96.70%) | 6 pre-entry debugger failures        | [Report](results/test262-temporal-zoned-from-h-v1.json)                      |
| Temporal.ZonedDateTime.compare | 100 / 100 (100.00%) | None                              | [Report](results/test262-temporal-zoned-compare-h-v1.json)                    |
| Temporal.PlainTime.from | 85 / 102 (83.33%) | 17 initial-stop debugger failures; no semantic failures | [Report](results/test262-temporal-plain-time-from-h-v1.json) |
| Temporal.PlainTime.add | 59 / 64 (92.19%) | 5 pre-entry debugger failures; no semantic failures | [Report](results/test262-temporal-plain-time-add-h-v1.json) |
| Temporal.PlainTime.compare | 57 / 64 (89.06%) | 7 initial-stop debugger failures; no semantic failures | [Report](results/test262-temporal-plain-time-compare-h-v1.json) |
| Temporal.ZonedDateTime.from  | 182 / 182 (100.00%) | None                                | [Report](results/test262-temporal-zoned-from-named-native-v1.json)           |
| Temporal.ZonedDateTime.until |  194 / 198 (97.98%) | 4 pre-entry debugger failures       | [Report](results/test262-temporal-zoned-until-duration-native-v3.json)       |
| Temporal.ZonedDateTime.since |  193 / 202 (95.54%) | 9 pre-entry debugger failures       | [Report](results/test262-temporal-zoned-since-duration-native-v3.json)       |
| Intl Temporal.Duration.round |    16 / 18 (88.89%) | 2 Gregorian-era variants            | [Report](results/test262-intl-temporal-duration-round-prefix-native-v3.json) |
| Intl Temporal.Duration.total |    12 / 14 (85.71%) | 2 Gregorian-era variants            | [Report](results/test262-intl-temporal-duration-total-prefix-native-v3.json) |
| Temporal.PlainYearMonth | 1,014 / 1,018 (99.61%) | Frozen12: four toLocaleString branding/descriptor failures; recheck pending | [Report](results/test262-temporal-plain-year-month-family-h-v2.json) |
| Intl.getCanonicalLocales     |      76 / 76 (100%) | No remaining outcomes               | [Report](results/test262-canonical-locales-native-v2.json)                   |
| Intl.supportedValuesOf       |    14 / 50 (28.00%) | 2 failures, 34 unsupported variants | [Report](results/test262-intl-supported-values-native-v1.json)               |

## Not completed

- **Whole-suite behavior measurement and >90% passes.** The full run and compile-performance work are deferred while known coverage gaps are addressed; broad Object, RegExp, TypedArray, language-expression and language-statement families still lack complete saved reports. Array now has a complete historical report; its fresh rerun remains queued.
- **Runtime source compilation:** `$262.evalScript`, indirect eval and direct eval use the shared native compiler, linker and executable arena. Direct-eval [environment](results/native-test262-direct-eval-validation-v1.json), [class-context](results/native-test262-direct-eval-class-validation-v2.json) and [private-name](results/native-test262-eval-private-validation-v1.json) fixtures pass their expected cases. Ordinary, async, generator and async-generator dynamic-constructor fallback paths are implemented; their bespoke native evidence is listed in the [capability inventory](test262-inventory.md). Complete family reports may predate these changes, and focused native fixtures do not replace conformance reruns. Module direct eval passes its [native compiler gate](results/module-direct-eval-native-compiler-acceptance-v1.json) and three unchanged focused variants. See [native code loading](native-code-loading.md).
- **Native ESM execution:** the opt-in module adapter executes static graphs, cycles, live bindings and namespaces. Namespace passes 38/38 and ambiguous exports 9/10. Module dynamic import and import.meta pass 24/24 targeted variants, with fixture syntax 6/6 on the same frozen toolchain. Script-root dynamic import passes 12/12 canaries; the [complete dynamic-import directory](results/test262-script-dynamic-import-directory-v1.json) records 1,559/1,900 with 341 unsupported and no failures, crashes or timeouts. Top-level await and JSON/import attributes pass [combined native compiler acceptance](results/json-await-native-compiler-acceptance-v1.json); their complete selection reruns are running. Source/defer and text/bytes proposals remain explicit gaps. Reports and retained earlier failures are linked above.
- **Remaining semantics and APIs:** finish failures in measured families, refresh reports predating later fixes, expand Temporal calendar/era support and broader Intl coverage, and cover the unmeasured families.
- **Host conformance facilities:** agents, shared-memory/worker scheduling and other unsupported host operations need explicit runtime contracts. They remain in the suite denominator.

## Native verification

The latest completed [tail-call frozen self-build](results/bootstrap-language-tail-calls-v2.json) produces byte-identical **71,847,842-byte** stage1/stage2 images from 566 frozen sources. [Artifact validation](results/language-tail-calls-selfbuild-artifact-validation-v2.json) verifies signatures and DWARF. This compiler acceptance is separate from the running Test262 call-group rerun. Earlier [compiler](results/framework-compiler-migration-checkpoint-v1.json) and [backend](results/framework-backend-migration-checkpoint-v1.json) migration checkpoints retain their separate smoke, managed-call and metadata evidence.

Bespoke [dynamic-constructor coercion](results/native-dynamic-coercion-v1.json), [disposal scheduling](results/native-disposal-jobs-v2.json), [async resources](results/native-await-using-handoff-v1.json), and [Annex B binding](results/native-annex-functions-v2.json) regressions are separate from Test262 conformance. [Bootstrap](bootstrap.md) owns reproducibility evidence; the [runner contract](test262-runner.md) owns execution policies. Older selections and infrastructure failures remain in immutable reports and the [retained evidence index](archive/test262-selection-evidence-through-zoned-conversions.md).
