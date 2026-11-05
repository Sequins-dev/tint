# Test262 progress — 2026-11-06

**The syntax gate is complete: 103,264/103,264 variants. Runtime coverage is not complete, and the current whole-suite native pass rate is unknown.**

The complete saved-report inventory covers **139 families**: **32 all passing**, **29 with a complete run but remaining non-passes**, **29 with selection evidence but no coherent complete family report**, and **49 with no saved runtime outcomes**. Saved reports contain outcomes for **33,707 distinct variants**; **69,557 have no recorded outcome**. These are historical observation footprints across frozen versions, not a combined current pass rate.

[Audited inventory and every linked report](test262-inventory.md) · [Machine-readable snapshot](results/test262-native-group-inventory-v89.json)

Of the pinned population, **8,699 variants are parse/early negatives**. Their required phase is covered by the native syntax gate. In particular, language/export (3) and language/keywords (50) are entirely syntax-only; their lack of a runtime-report row does not make them untested.

## Current language work

- Complete tagged-template directory: **48/48 pass**; the overlapping runtime-cache subset is 12/12 and is not added to that total.
- Complete top-level-await directory: **253/253 pass**.
- Assignment: **850/850**; calls **171/171**; super **184/184**; delete **103/103**.
- Binding/destructuring checkpoints: block 287/287, const 186/186, catch 186/186 and function parameters 372/372.
- Import attributes: static imports **12/17** (five text-module proposal blockers), module-code **13/13**, dynamic import **42/44** (two text-module proposal blockers).
- Runtime-compiled templates: ten native semantic checks and all 4,394 workspace tests pass; the existing 256 KiB entry cap is unchanged.

- Direct eval in progress: **141/336 recorded, 141 passing**, 0 non-passes so far. These are not complete-run results.
- For-of in progress: **195/1442 recorded, 195 passing**, 0 non-passes so far. These are not complete-run results.

Next: finish those already-started runs, then 23 function/control-flow selections (5,581 variants), followed by 29 initial class selections (2,081 variants). The full declaration/expression class population is 16,893 variants, so that initial class checkpoint is not classes complete. Broad Object/Array API work follows foundational language semantics. Full-suite measurement and compiler-performance work remain deferred.

## Every family

**Status:** A = dedicated complete run, all pass; G = dedicated complete run, gaps remain; P = partial/selection evidence only; N = no saved runtime outcome. **F/U/T/H/C** = failures / unsupported / timeouts / harness errors / crashes. S = a syntax-only family covered by the completed native syntax gate (a subset of the 49 families with no runtime-report outcome). Syn = parse/early-negative variants. A dash means no complete-family runtime report. Complete-run results below belong to their linked saved snapshots and can predate current fixes; partial footprints cannot establish a family pass rate.

### language — 28 families

| Family | Variants | Syn | Recorded | Passes in complete run | F/U/T/H/C | Status |
|---|---:|---:|---:|---:|---|:---:|
| `language/arguments-object` | 460 | 1 | 460 | 456 | 2/2/0/0/0 | G |
| `language/asi` | 204 | 70 | 0 | — | — | N |
| `language/block-scope` | 287 | 201 | 287 | 287 | 0/0/0/0/0 | A |
| `language/comments` | 81 | 33 | 1 | — | — | P |
| `language/computed-property-names` | 96 | 0 | 8 | — | — | P |
| `language/destructuring` | 37 | 0 | 37 | 34 | 0/2/0/0/1 | G |
| `language/directive-prologue` | 62 | 11 | 0 | — | — | N |
| `language/eval-code` | 454 | 0 | 454 | — | — | P |
| `language/export` | 3 | 3 | 0 | — | — | S |
| `language/expressions` | 21,386 | 3,861 | 5,277 | — | — | P |
| `language/function-code` | 281 | 0 | 1 | — | — | P |
| `language/future-reserved-words` | 85 | 34 | 0 | — | — | N |
| `language/global-code` | 75 | 27 | 75 | 74 | 0/0/1/0/0 | G |
| `language/identifier-resolution` | 22 | 2 | 0 | — | — | N |
| `language/identifiers` | 535 | 231 | 0 | — | — | N |
| `language/import` | 135 | 16 | 17 | — | — | P |
| `language/keywords` | 50 | 50 | 0 | — | — | S |
| `language/line-terminators` | 82 | 34 | 0 | — | — | N |
| `language/literals` | 1,041 | 617 | 480 | — | — | P |
| `language/module-code` | 602 | 166 | 328 | — | — | P |
| `language/punctuators` | 22 | 20 | 0 | — | — | N |
| `language/reserved-words` | 53 | 25 | 0 | — | — | N |
| `language/rest-parameters` | 22 | 2 | 22 | 21 | 0/0/0/0/1 | G |
| `language/source-text` | 2 | 0 | 0 | — | — | N |
| `language/statementList` | 160 | 0 | 0 | — | — | N |
| `language/statements` | 18,119 | 2,850 | 1,944 | — | — | P |
| `language/types` | 211 | 22 | 0 | — | — | N |
| `language/white-space` | 134 | 12 | 0 | — | — | N |

### annexB — 16 families

| Family | Variants | Syn | Recorded | Passes in complete run | F/U/T/H/C | Status |
|---|---:|---:|---:|---:|---|:---:|
| `annexB/built-ins/Array` | 2 | 0 | 2 | 2 | 0/0/0/0/0 | A |
| `annexB/built-ins/Date` | 48 | 0 | 48 | 48 | 0/0/0/0/0 | A |
| `annexB/built-ins/escape` | 32 | 0 | 32 | 32 | 0/0/0/0/0 | A |
| `annexB/built-ins/Function` | 12 | 0 | 12 | 12 | 0/0/0/0/0 | A |
| `annexB/built-ins/Object` | 2 | 0 | 2 | 2 | 0/0/0/0/0 | A |
| `annexB/built-ins/RegExp` | 124 | 0 | 124 | 120 | 0/4/0/0/0 | G |
| `annexB/built-ins/String` | 222 | 0 | 222 | 222 | 0/0/0/0/0 | A |
| `annexB/built-ins/TypedArrayConstructors` | 2 | 0 | 2 | — | — | P |
| `annexB/built-ins/unescape` | 38 | 0 | 38 | 38 | 0/0/0/0/0 | A |
| `annexB/language/comments` | 13 | 0 | 13 | 13 | 0/0/0/0/0 | A |
| `annexB/language/eval-code` | 470 | 0 | 470 | — | — | P |
| `annexB/language/expressions` | 43 | 1 | 43 | 43 | 0/0/0/0/0 | A |
| `annexB/language/function-code` | 159 | 0 | 159 | 158 | 1/0/0/0/0 | G |
| `annexB/language/global-code` | 153 | 0 | 153 | 153 | 0/0/0/0/0 | A |
| `annexB/language/literals` | 16 | 0 | 16 | — | — | P |
| `annexB/language/statements` | 41 | 11 | 41 | 41 | 0/0/0/0/0 | A |

### built-ins — 64 families

| Family | Variants | Syn | Recorded | Passes in complete run | F/U/T/H/C | Status |
|---|---:|---:|---:|---:|---|:---:|
| `built-ins/AbstractModuleSource` | 8 | 0 | 0 | — | — | N |
| `built-ins/AggregateError` | 50 | 0 | 2 | — | — | P |
| `built-ins/Array` | 6,119 | 0 | 1,223 | — | — | P |
| `built-ins/ArrayBuffer` | 442 | 0 | 442 | 442 | 0/0/0/0/0 | A |
| `built-ins/ArrayIteratorPrototype` | 46 | 0 | 46 | 46 | 0/0/0/0/0 | A |
| `built-ins/AsyncDisposableStack` | 208 | 0 | 208 | 206 | 0/2/0/0/0 | G |
| `built-ins/AsyncFromSyncIteratorPrototype` | 76 | 0 | 0 | — | — | N |
| `built-ins/AsyncFunction` | 36 | 0 | 36 | 34 | 0/0/2/0/0 | G |
| `built-ins/AsyncGeneratorFunction` | 46 | 0 | 46 | 36 | 0/9/0/0/1 | G |
| `built-ins/AsyncGeneratorPrototype` | 96 | 0 | 92 | — | — | P |
| `built-ins/AsyncIteratorPrototype` | 26 | 0 | 0 | — | — | N |
| `built-ins/Atomics` | 778 | 0 | 778 | 366 | 184/0/0/222/6 | G |
| `built-ins/BigInt` | 154 | 0 | 154 | 154 | 0/0/0/0/0 | A |
| `built-ins/Boolean` | 101 | 0 | 101 | 99 | 0/2/0/0/0 | G |
| `built-ins/DataView` | 1,120 | 0 | 1,120 | 1110 | 0/0/0/0/10 | G |
| `built-ins/Date` | 1,188 | 0 | 1,188 | 1176 | 6/6/0/0/0 | G |
| `built-ins/decodeURI` | 110 | 0 | 110 | 108 | 0/0/2/0/0 | G |
| `built-ins/decodeURIComponent` | 112 | 0 | 112 | 110 | 0/0/2/0/0 | G |
| `built-ins/DisposableStack` | 186 | 0 | 186 | 184 | 0/2/0/0/0 | G |
| `built-ins/encodeURI` | 62 | 0 | 62 | 62 | 0/0/0/0/0 | A |
| `built-ins/encodeURIComponent` | 62 | 0 | 62 | 62 | 0/0/0/0/0 | A |
| `built-ins/Error` | 186 | 0 | 24 | — | — | P |
| `built-ins/eval` | 20 | 0 | 20 | 18 | 0/2/0/0/0 | G |
| `built-ins/FinalizationRegistry` | 94 | 0 | 94 | 93 | 0/0/0/0/1 | G |
| `built-ins/Function` | 893 | 0 | 893 | 703 | 16/147/0/0/27 | G |
| `built-ins/GeneratorFunction` | 46 | 0 | 46 | 44 | 0/0/2/0/0 | G |
| `built-ins/GeneratorPrototype` | 122 | 0 | 118 | — | — | P |
| `built-ins/global` | 56 | 0 | 0 | — | — | N |
| `built-ins/Infinity` | 10 | 0 | 0 | — | — | N |
| `built-ins/isFinite` | 30 | 0 | 0 | — | — | N |
| `built-ins/isNaN` | 30 | 0 | 0 | — | — | N |
| `built-ins/Iterator` | 1,368 | 0 | 1,368 | 1350 | 12/6/0/0/0 | G |
| `built-ins/JSON` | 332 | 0 | 332 | 332 | 0/0/0/0/0 | A |
| `built-ins/Map` | 405 | 0 | 405 | 405 | 0/0/0/0/0 | A |
| `built-ins/MapIteratorPrototype` | 22 | 0 | 0 | — | — | N |
| `built-ins/Math` | 654 | 0 | 654 | 652 | 0/0/0/0/2 | G |
| `built-ins/NaN` | 10 | 0 | 0 | — | — | N |
| `built-ins/NativeErrors` | 188 | 0 | 0 | — | — | N |
| `built-ins/Number` | 680 | 0 | 104 | — | — | P |
| `built-ins/Object` | 6,802 | 0 | 938 | — | — | P |
| `built-ins/parseFloat` | 108 | 0 | 108 | 108 | 0/0/0/0/0 | A |
| `built-ins/parseInt` | 110 | 0 | 110 | 110 | 0/0/0/0/0 | A |
| `built-ins/Promise` | 1,458 | 0 | 434 | — | — | P |
| `built-ins/Proxy` | 607 | 0 | 607 | 582 | 8/14/0/0/3 | G |
| `built-ins/Reflect` | 306 | 0 | 306 | 305 | 0/0/0/0/1 | G |
| `built-ins/RegExp` | 3,756 | 384 | 510 | — | — | P |
| `built-ins/RegExpStringIteratorPrototype` | 34 | 0 | 34 | 34 | 0/0/0/0/0 | A |
| `built-ins/Set` | 764 | 0 | 764 | 764 | 0/0/0/0/0 | A |
| `built-ins/SetIteratorPrototype` | 22 | 0 | 0 | — | — | N |
| `built-ins/ShadowRealm` | 124 | 0 | 0 | — | — | N |
| `built-ins/SharedArrayBuffer` | 208 | 0 | 208 | 208 | 0/0/0/0/0 | A |
| `built-ins/String` | 2,443 | 0 | 564 | — | — | P |
| `built-ins/StringIteratorPrototype` | 14 | 0 | 0 | — | — | N |
| `built-ins/SuppressedError` | 44 | 0 | 44 | 40 | 0/4/0/0/0 | G |
| `built-ins/Symbol` | 192 | 0 | 192 | 192 | 0/0/0/0/0 | A |
| `built-ins/Temporal` | 9,210 | 0 | 5,084 | — | — | P |
| `built-ins/ThrowTypeError` | 28 | 0 | 0 | — | — | N |
| `built-ins/TypedArray` | 2,890 | 0 | 436 | — | — | P |
| `built-ins/TypedArrayConstructors` | 1,446 | 0 | 110 | — | — | P |
| `built-ins/Uint8Array` | 140 | 0 | 140 | 140 | 0/0/0/0/0 | A |
| `built-ins/undefined` | 12 | 0 | 0 | — | — | N |
| `built-ins/WeakMap` | 281 | 0 | 281 | 281 | 0/0/0/0/0 | A |
| `built-ins/WeakRef` | 58 | 0 | 58 | 58 | 0/0/0/0/0 | A |
| `built-ins/WeakSet` | 170 | 0 | 170 | 169 | 0/0/0/0/1 | G |

### intl402 — 20 families

| Family | Variants | Syn | Recorded | Passes in complete run | F/U/T/H/C | Status |
|---|---:|---:|---:|---:|---|:---:|
| `intl402 [direct files]` | 44 | 0 | 0 | — | — | N |
| `intl402/Array` | 4 | 0 | 0 | — | — | N |
| `intl402/BigInt` | 22 | 0 | 22 | 22 | 0/0/0/0/0 | A |
| `intl402/Collator` | 130 | 0 | 0 | — | — | N |
| `intl402/Date` | 24 | 0 | 0 | — | — | N |
| `intl402/DateTimeFormat` | 490 | 0 | 0 | — | — | N |
| `intl402/DisplayNames` | 114 | 0 | 0 | — | — | N |
| `intl402/DurationFormat` | 220 | 0 | 0 | — | — | N |
| `intl402/FallbackSymbol` | 4 | 0 | 2 | — | — | P |
| `intl402/Intl` | 132 | 0 | 126 | — | — | P |
| `intl402/ListFormat` | 162 | 0 | 162 | 162 | 0/0/0/0/0 | A |
| `intl402/Locale` | 380 | 0 | 380 | 338 | 42/0/0/0/0 | G |
| `intl402/Number` | 14 | 0 | 14 | 14 | 0/0/0/0/0 | A |
| `intl402/NumberFormat` | 502 | 0 | 502 | 406 | 2/92/2/0/0 | G |
| `intl402/PluralRules` | 106 | 0 | 106 | 104 | 2/0/0/0/0 | G |
| `intl402/RelativeTimeFormat` | 160 | 0 | 160 | 160 | 0/0/0/0/0 | A |
| `intl402/Segmenter` | 158 | 0 | 0 | — | — | N |
| `intl402/String` | 38 | 0 | 0 | — | — | N |
| `intl402/Temporal` | 4,058 | 0 | 340 | — | — | P |
| `intl402/TypedArray` | 2 | 0 | 0 | — | — | N |

### harness — 1 families

| Family | Variants | Syn | Recorded | Passes in complete run | F/U/T/H/C | Status |
|---|---:|---:|---:|---:|---|:---:|
| `harness [direct files]` | 232 | 0 | 0 | — | — | N |

### staging — 10 families

| Family | Variants | Syn | Recorded | Passes in complete run | F/U/T/H/C | Status |
|---|---:|---:|---:|---:|---|:---:|
| `staging [direct files]` | 8 | 0 | 0 | — | — | N |
| `staging/built-ins` | 16 | 0 | 0 | — | — | N |
| `staging/decorators` | 14 | 8 | 0 | — | — | N |
| `staging/explicit-resource-management` | 105 | 0 | 0 | — | — | N |
| `staging/set-methods` | 6 | 0 | 0 | — | — | N |
| `staging/sm` | 2,631 | 7 | 1 | — | — | P |
| `staging/source-phase-imports` | 4 | 0 | 0 | — | — | N |
| `staging/Temporal` | 4 | 0 | 0 | — | — | N |
| `staging/top-level-await` | 1 | 0 | 0 | — | — | N |
| `staging/Uint8Array` | 2 | 0 | 0 | — | — | N |

## What still blocks completion

- **Measurement:** Array, Object, String, RegExp, Promise, typed arrays and much of language have only partial or old whole-family evidence. No outcomes does not mean no implementation: Infinity, NaN, undefined, isFinite/isNaN, several iterator prototypes and grammar families have existing implementation but lack complete family runtime reports.
- **Language validation:** direct/indirect eval, functions, generators/async code, iteration, control flow, classes and their parameter/element subgroups still need complete current-source results. The saved family figures above are preserved rather than silently upgraded from focused checks.
- **Host facilities:** Test262 agent/worker coordination, wait/notify integration and `$262.gc` remain incomplete or absent.
- **Intl/Temporal:** several Intl families, non-ISO calendars and complete Temporal validation remain outstanding.
- **Proposals:** source/defer imports, text/bytes modules, decorators and much staging work remain explicit separate gaps.
- **Resources/profiles:** entry-code/arena limits and native profile restrictions still produce legitimate unsupported results. They remain in denominators; failures and infrastructure outcomes are retained.
