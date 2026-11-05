# Test262 measurement gaps and the current full run

The [group inventory](test262-inventory.md) describes completed reports across frozen historical snapshots. It records outcomes for 30,186 of 103,264 variants. This is an evidence footprint, including every non-pass; it is not the current native pass count. In-progress journals remain separate.

| Measurement gap                                      | Families | Variants |
| ---------------------------------------------------- | -------: | -------: |
| No completed selection at all                        |       55 |    7,155 |
| Unrecorded variants inside partially tested families |       24 |   65,923 |
| Total without a recorded completed-report outcome    |        — |   73,078 |

The largest gap is incomplete measurements of large implemented families, rather than wholly missing APIs. The [static scan](results/test262-unmeasured-groups-scan-v1.json) checked the pinned checkout's files, variant rules, feature tags and source-text dependency signals. Tags and text matches overlap and do not predict passes.

## Unmeasured groups with existing implementation

| Group                                      | Variants | Existing code or evidence                                                                             | What the run must establish                                                                                                                            |
| ------------------------------------------ | -------: | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `language/identifiers`                     |      535 | Lexer, parser, binder and class/private-name support in `@tint/typescript`                            | Execution behavior as well as acceptance, binding and context rules                                                                                    |
| `language/asi`                             |      204 | Parser statement and directive handling                                                               | Complete native outcomes                                                                                                                               |
| `language/white-space`, `line-terminators` |      216 | Lexer and source-text implementation                                                                  | Complete native outcomes                                                                                                                               |
| `built-ins/NativeErrors`                   |      188 | Constructors, prototypes, cause and realm handling in `objects/errors.ts`                             | All constructor, descriptor and cross-realm cases                                                                                                      |
| `built-ins/isFinite`, `isNaN`              |       60 | Global predicates in `objects/primitive-intrinsics.ts`                                                | Coercion and abrupt completion                                                                                                                         |
| `built-ins/Infinity`, `NaN`, `undefined`   |       32 | Global installation in `objects/global-properties.ts`                                                 | Complete property and execution cases                                                                                                                  |
| Map/Set/String iterator prototypes         |       58 | Iterator construction and state in `map-intrinsics.ts`, `set-intrinsics.ts`, `iterator-intrinsics.ts` | Intrinsic/prototype identity, descriptors and boundary behavior                                                                                        |
| `built-ins/ThrowTypeError`                 |       28 | The realm's throwing intrinsic and restricted accessors in `objects/errors.ts`                        | Complete intrinsic and descriptor cases                                                                                                                |
| `built-ins/AsyncFromSyncIteratorPrototype` |       76 | `objects/async-iteration.ts` and `iterators/async-from-sync.ts`                                       | Complete protocol, Promise and abrupt-completion cases                                                                                                 |
| `staging/explicit-resource-management`     |      105 | Disposal scheduling and stack implementations, with separate passing selections                       | Coverage of staging-specific cases                                                                                                                     |
| `harness` direct self-tests                |      232 | Existing captured harness execution                                                                   | All self-tests and their host dependencies                                                                                                             |
| `staging/sm`                               |    2,631 | Existing iterators, numerics, objects, realms and other runtime features                              | Mixed population: 348 variants carry iterator-helper tags; source scans find 360 eval and 28 GC references. These overlap and do not establish support |

The many remaining language keyword, reserved-word, source-text and punctuation groups also exercise existing frontend machinery. Their lack of completed behavior reports does not imply an absent implementation.

## Broad gaps already known

- `DateTimeFormat` (490 direct variants), DurationFormat (220), Segmenter (158), Collator (130) and DisplayNames (114) still need their planned implementations. Date/Temporal locale formatting and shared Intl-constructor harnesses depend on these.
- Direct/indirect eval, `$262.evalScript` and ordinary/async/generator/async-generator `Function` fallback are now implemented, with native fixture evidence. Complete-family reruns are mixed, stale or pending; the [complete inventory](test262-inventory.md) separates those reports. These paths affect outcomes beyond their own directories.
- Static modules, module dynamic import and import.meta are implemented and pass targeted native selections. Script-root dynamic import passes canaries and its directory measurements are running. Top-level await and JSON/attributes remain HOST-ESM gaps. Agent coordination and parking need HOST-AGENT and affect Atomics.
- Non-ISO calendars affect both Temporal and DateTimeFormat. `$262.gc` is a separate host gap.
- Large partially measured groups—Array, Object, String, RegExp, Promise, TypedArray, Temporal, language expressions and statements—need complete execution measurements before their remaining failures can be ranked.

## Full-run policy

The new [v10 toolchain](results/frozen-node-toolchain-native-behavior-v10-current-v1.json) freezes the current 552-file compiler/runtime, with the `native-script-v8-function-fallback` adapter and a passing 4,078-test workspace gate. It runs the entire pinned suite with batch size 64, unchanged tests and harnesses, the existing 300-second per-variant containment, and one native inferior at a time.

The old full survey and focused indirect-eval prefix are retained with interruption reports. Their observations are never reclassified or merged into v10. The [v10 attempt was stopped at the user’s request](results/test262-full-suite-native-v10-interruption.json) after 828 observations. Implementation of known gaps has resumed. Compiler/runtime reuse across batches will be addressed before attempting another full measurement run. The final rate requires all 103,264 variants, with unsupported tests, failures, harness errors, crashes and timeouts retained in the denominator. A process failure leaves a resumable journal rather than triggering automatic retries.

After the complete run, use its single-snapshot outcomes to rank failure clusters by family, unsupported reason, feature tags and shared harness requirements. This separates missing host capabilities and cross-cutting language dependencies from independent API bugs.
