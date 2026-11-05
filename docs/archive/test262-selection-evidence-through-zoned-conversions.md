# Retained Test262 selection evidence

Dashboard snapshot before consolidating current status and moving the complete
selection index to the generated group inventory. Historical counts can predate
current implementation; linked immutable reports retain the evidence.

# Test262 coverage

## Current status

- **Target:** over 90% native passes; whole-suite native coverage is **not yet measured**.
  The [latest interrupted baseline](../results/test262-full-suite-native-v2-interruption.json)
  retains its observations. The replacement full-suite run is in progress with
  development-image debugger entitlements; incomplete observations are not a pass rate.
  Prior infrastructure failures remain recorded.
- **Pinned suite:** `91c70759363c46557b694792bf34a2551a7af5ba`, clean checkout;
  53,751 files / 103,264 variants, including proposals newer than ES2025.
- **Valid syntax acceptance:** [current inventory](../results/test262-full-syntax-function-source-summary-v1.json)
  accepts **94,565 / 94,565 expected-to-parse variants (100%)**, with no outcomes
  changed from v71. The denominator excludes parse/early negatives but
  includes runtime/resolution negatives. This is a parser inventory, not native
  execution coverage or complete early-error validation.

- **Native syntax gate complete:** the [full native parser/binder run](../results/test262-full-native-syntax-summary-v4.json)
  accepted **94,565 / 94,565 valid variants** and rejected **8,699 / 8,699
  parse/early-negative variants**, with no mismatches, unsupported outcomes or
  crashes across **103,264 variants**. Sources were never evaluated. This uses
  the compiler host's standard memory budgets; earlier undersized-fixture faults
  remain linked in the report.

The labelled-function binding update preserves these totals. Its
[native regression](../results/native-labelled-functions-own-signature-v2.json)
passes all three regression cases; the earlier
[staging failures](../results/native-labelled-functions-focused-v1.json) remain recorded.

The [bootstrap-host early-error inventory](../results/test262-full-early-errors-labelled-summary-v2.json)
independently records the same acceptance/rejection totals.

The [full lowering inventory](../results/test262-full-lowering-summary-v1.json) has
92,235 lowered variants, 2,330 unsupported, and 8,699 parse negatives handled
separately. Remaining lowering families are dynamic imports, modules, disposal,
sloppy block functions and decorators. This does not measure runtime API coverage.

## Population and prioritization

The [pinned-suite population inventory](../results/test262-suite-population-v1.json)
counts variants without executing them. Language expressions/statements, Object,
Array and RegExp are the largest core semantic families. Temporal's built-in and
Intl directories contain 13,268 variants (12.85% of the suite), so the stated
whole-suite target requires substantial Temporal coverage too; these tests remain
in the denominator. Population counts are planning evidence, not pass estimates.

See the [complete group inventory](../test262-inventory.md) for all 139 directory
families, recorded-evidence ratios, execution restrictions and every latest
complete native selection. Unmeasured families are explicitly marked.

## Native selection results

Selections overlap and may predate fixes; their totals cannot establish whole-suite
coverage. Counts include unsupported cases and infrastructure failures.

| Selection                            | Passed / total | Remaining outcomes at capture                                                                                          | Report                                                                                                                               |
| ------------------------------------ | -------------: | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Annex B RegExp (complete family) | 120 / 124 (96.77%) | 4 unsupported dynamic-eval variants; no failures, crashes or timeouts | [v2](../results/test262-annexb-regexp-native-v2.json) |
| Temporal.ZonedDateTime.with | 82 / 82 (100%) | No failures or unsupported cases | [v1](../results/test262-temporal-zoned-with-native-v1.json) |
| Temporal.ZonedDateTime.compare | 100 / 100 (100%) | No failures or unsupported cases | [v2](../results/test262-temporal-zoned-compare-native-v2.json) |
| Temporal.ZonedDateTime.equals | 110 / 110 (100%) | No failures or unsupported cases | [v1](../results/test262-temporal-zoned-equals-native-v1.json) |
| Temporal.ZonedDateTime.withTimeZone | 32 / 32 (100%) | No failures or unsupported cases | [v1](../results/test262-temporal-zoned-withTimeZone-native-v1.json) |
| Temporal.ZonedDateTime.from | 180 / 182 (98.90%) | 2 offset primitive-coercion failures; captured before the correction | [v2](../results/test262-temporal-zoned-from-native-v2.json) |
| Temporal.PlainDate.with | 50 / 50 (100%) | No failures or unsupported cases | [v2](../results/test262-temporal-date-with-native-v2.json) |
| Temporal.PlainDateTime.from | 140 / 140 (100%) | No failures or unsupported cases | [v2](../results/test262-temporal-date-time-from-native-v2.json) |
| Temporal.PlainDateTime.with | 58 / 60 (96.67%) | 2 missing ZonedDateTime.from/Temporal.Now dependency failures | [v1](../results/test262-temporal-date-time-with-native-v1.json) |
| Temporal.ZonedDateTime.withCalendar | 30 / 32 (93.75%) | 2 failures; some tests require missing static from | [v1](../results/test262-temporal-zoned-withCalendar-native-v1.json) |
| Temporal.ZonedDateTime.toPlainDateTime | 18 / 20 (90.00%) | 2 failures; some tests require missing static from | [v1](../results/test262-temporal-zoned-toPlainDateTime-native-v1.json) |
| Temporal.ZonedDateTime.toPlainTime | 16 / 18 (88.89%) | 2 failures; some tests require missing static from | [v1](../results/test262-temporal-zoned-toPlainTime-native-v1.json) |
| Temporal.ZonedDateTime.toPlainDate | 12 / 14 (85.71%) | 2 failures; some tests require missing static from | [v1](../results/test262-temporal-zoned-toPlainDate-native-v1.json) |
| Temporal.ZonedDateTime.toInstant | 12 / 20 (60.00%) | 8 failures; some tests require missing static from | [v1](../results/test262-temporal-zoned-toInstant-native-v1.json) |
| Temporal.Instant initial baseline | 346 / 934 (37.04%) | Predates arithmetic, round and precision implementation; 495 failures, 90 unsupported, 3 pre-entry crashes | [v1](../results/test262-temporal-instant-native-v1.json) |
| Annex B String (complete family) | 222 / 222 (100%) | No failures or unsupported cases; prior [interrupted run](../results/test262-annexb-string-native-v2-interruption.json) retained | [v3](../results/test262-annexb-string-native-v3.json) |
| Number.prototype.toExponential | 30 / 30 (100%) | No failures or unsupported cases | [v1](../results/test262-number-exponential-native-v1.json) |
| Number.prototype.toPrecision | 34 / 34 (100%) | No failures or unsupported cases | [v1](../results/test262-number-precision-native-v1.json) |
| Temporal.PlainDate basic constructor | 2 / 2 | Complete file selection | [v1](../results/test262-temporal-date-basic-native-v1.json) |
| Temporal.PlainDate constructor coercion | 2 / 2 | Complete file selection | [v1](../results/test262-temporal-date-argument-convert-native-v1.json) |
| Temporal.PlainDate constructor limits | 2 / 2 | Complete file selection | [v1](../results/test262-temporal-date-limits-native-v1.json) |
| Temporal.Duration basic, sign, range and subclass constructors | 2 / 2 per file | Four complete file selections, each passing | [basic](../results/test262-temporal-duration-basic-native-v1.json), [mixed](../results/test262-temporal-duration-mixed-native-v1.json), [range](../results/test262-temporal-duration-out-of-range-native-v1.json), [subclass](../results/test262-temporal-duration-subclass-native-v1.json) |
| Temporal.PlainDateTime basic, limits and subclass constructors | 2 / 2 per file | Three complete file selections, each passing | [basic](../results/test262-temporal-date-time-basic-native-v1.json), [limits](../results/test262-temporal-date-time-limits-native-v1.json), [subclass](../results/test262-temporal-date-time-subclass-native-v1.json) |
| Temporal.PlainYearMonth basic, limits and subclass constructors | 2 / 2 per file | Three complete file selections, each passing | [basic](../results/test262-temporal-year-month-basic-native-v1.json), [limits](../results/test262-temporal-year-month-limits-native-v1.json), [subclass](../results/test262-temporal-year-month-subclass-native-v1.json) |
| Temporal.PlainYearMonth.prototype.toString | 34 / 34 (100%) | No failures or unsupported cases | [v1](../results/test262-temporal-year-month-string-native-v1.json) |
| Temporal.PlainMonthDay basic, invalid-date and subclass constructors | 2 / 2 per file | Three complete file selections, each passing | [basic](../results/test262-temporal-month-day-basic-native-v1.json), [invalid](../results/test262-temporal-month-day-argument-invalid-native-v1.json), [subclass](../results/test262-temporal-month-day-subclass-native-v1.json) |
| Temporal.PlainMonthDay.prototype.toString | 32 / 32 (100%) | No failures or unsupported cases | [v1](../results/test262-temporal-month-day-string-native-v1.json) |
| Temporal.ZonedDateTime coercion, limits, subclass and fixed-offset IDs | 2 / 2 per file | Four complete file selections, each passing | [coercion](../results/test262-temporal-zoned-argument-convert-native-v1.json), [limits](../results/test262-temporal-zoned-limits-native-v1.json), [subclass](../results/test262-temporal-zoned-subclass-native-v1.json), [offset IDs](../results/test262-temporal-zoned-timezone-string-native-v1.json) |
| Temporal.PlainDate.prototype.toString | 36 / 36 (100%) | No failures or unsupported cases; prior [16/36](../results/test262-temporal-date-tostring-native-v1.json) retained | [v2](../results/test262-temporal-date-tostring-native-v2.json) |
| Number.prototype.toFixed | 32 / 32 (100%) | No failures or unsupported cases | [v1](../results/test262-number-fixed-native-v1.json) |
| Number.prototype.toLocaleString (non-Intl) | 8 / 8 (100%) | Prior [compile-blocked run](../results/test262-number-locale-native-v1.json) retained | [v2](../results/test262-number-locale-native-v2.json) |
| Math.pow | 56 / 56 (100%) | Prior [compile-blocked run](../results/test262-math-pow-native-v1.json) retained | [v2](../results/test262-math-pow-native-v2.json) |
| Temporal.PlainDateTime.from | 140 / 140 (100%) | No failures or unsupported cases | [v1](../results/test262-temporal-date-time-from-native-v1.json) |
| Temporal.PlainYearMonth.from | 124 / 128 (96.88%) | Four unsupported variants exposed abbreviated non-ISO calendar handling; fixed and queued for full rerun | [v1](../results/test262-temporal-year-month-from-native-v1.json) |
| Temporal.PlainDate.from | 142 / 142 (100%) | No failures or unsupported cases. Prior [128/142](../results/test262-temporal-date-from-native-v2.json) retained | [v3](../results/test262-temporal-date-from-native-v3.json) |
| Math.random | 10 / 10 (100%) | No failures or unsupported cases | [v1](../results/test262-math-random-native-v1.json) |
| Math.cbrt | 10 / 10 (100%) | No failures or unsupported cases | [v1](../results/test262-math-cbrt-native-v1.json) |
| Annex B escape | 32 / 32 (100%) | No failures or unsupported cases | [v1](../results/test262-escape-native-v1.json) |
| Annex B unescape | 38 / 38 (100%) | No failures or unsupported cases | [v1](../results/test262-unescape-native-v1.json) |
| String.prototype.toLowerCase | 58 / 60 (96.67%) | 2 unsupported eval variants; no runtime failures, crashes or timeouts | [v1](../results/test262-string-lower-native-v1.json) |
| String.prototype.toUpperCase | 50 / 52 (96.15%) | 2 unsupported eval variants; no runtime failures, crashes or timeouts | [v1](../results/test262-string-upper-native-v1.json) |
| Error.isError | 22 / 24 (91.67%) | 2 unsupported cross-realm Function-constructor variants; no runtime failures, crashes or timeouts | [v1](../results/test262-error-brand-native-v1.json) |
| decodeURIComponent | 110 / 112 (98.21%) | 2 timeouts in the exhaustive supplementary-codepoint test; no runtime failures or crashes | [v1](../results/test262-decode-uri-component-native-v1.json) |
| decodeURI | 108 / 110 (98.18%) | 2 timeouts in the exhaustive supplementary-codepoint test; no runtime failures or crashes | [v1](../results/test262-decode-uri-native-v1.json) |
| encodeURIComponent | 62 / 62 (100%) | No failures or unsupported cases; Unicode casing resolved the prior 12 failures | [v2](../results/test262-encode-uri-component-native-v2.json), [prior v1](../results/test262-encode-uri-component-native-v1.json) |
| encodeURI | 62 / 62 (100%) | No failures or unsupported cases; Unicode casing resolved the prior 12 failures | [v2](../results/test262-encode-uri-native-v2.json), [prior v1](../results/test262-encode-uri-native-v1.json) |
| Math.f16round | 10 / 10 (100%) | No failures or unsupported cases | [v1](../results/test262-math-f16round-native-v1.json) |
| Math.sumPrecise | 20 / 20 (100%) | No failures or unsupported cases | [v1](../results/test262-math-sum-precise-native-v1.json) |
| Math.hypot | 24 / 24 (100%) | No failures or unsupported cases | [v1](../results/test262-math-hypot-native-v1.json) |
| Math.fround | 18 / 18 (100%) | No failures or unsupported cases | [v1](../results/test262-math-fround-native-v1.json) |
| JSON (complete family) | 332 / 332 (100%) | No failures, unsupported cases, crashes, timeouts or harness errors | [v1](../results/test262-json-native-v1.json) |
| JSON.parse (complete group) | 154 / 154 (100%) | No failures, unsupported cases, crashes or timeouts | [v1](../results/test262-json-parse-native-v1.json) |
| JSON.stringify (complete group) | 134 / 134 (100%) | No failures, unsupported cases, crashes or timeouts | [v1](../results/test262-json-stringify-native-v1.json) |
| Iterator (complete family) | 1350 / 1368 (98.68%) | 12 missing JSON.stringify harness failures; 6 unsupported dynamic-Function variants; no crashes or timeouts | [v1](../results/test262-iterator-native-v1.json), [analysis](../results/test262-iterator-native-v1-analysis.json) |
| Function.prototype.toString | 150 / 160 (93.75%) | 10 unsupported dynamic-Function variants; no failures, crashes, timeouts or harness errors | [v1](../results/test262-function-tostring-native-v1.json) |
| Set (complete family) | 730 / 764 (95.55%) | 16 missing weak-collection failures; 2 unsupported dynamic-Function cases; 16 pre-entry LLDB failures | [v1](../results/test262-set-native-v1.json), [analysis](../results/test262-set-native-v1-analysis.json) |
| Map (complete family) | 334 / 405 (82.47%) | 50 missing collection dependency failures; 6 function-related unsupported paths; 15 pre-entry LLDB failures | [v1](../results/test262-map-native-v1.json), [analysis](../results/test262-map-native-v1-analysis.json) |
| Destructuring (complete language family) | 34 / 37 | 2 dynamic Function harness cases unsupported; 1 pre-entry LLDB failure; no semantic failures | [v2](../results/test262-destructuring-native-v2.json) |
| Rest parameters | 21 / 22 | 1 LLDB attach failure before execution; no semantic failures or unsupported variants | [v2](../results/test262-rest-parameters-native-v2.json) |
| Iterator.prototype.reduce | 64 / 64 | Complete selection; no failures | [v1](../results/test262-iterator-reduce-native-v1.json) |
| Iterator.prototype.forEach | 53 / 56 | 3 LLDB attachment failures before execution; no semantic failures | [v1](../results/test262-iterator-foreach-native-v1.json) |
| Iterator.prototype.toArray | 35 / 38 | 3 LLDB attachment failures before execution; no semantic failures | [v1](../results/test262-iterator-toarray-native-v1.json) |
| Iterator.from | 36 / 38 | 2 failures depend on missing toArray in this snapshot | [v1](../results/test262-iterator-from-native-v1.json) |
| Iterator.prototype.constructor | 4 / 4 | Complete selection | [v1](../results/test262-iterator-constructor-property-native-v1.json) |
| Object.prototype.toString | 66 / 82 | 14 missing-API failures; 2 dynamic Function variants unsupported | [v1](../results/test262-object-tostring-native-v1.json) |
| Iterator.prototype[Symbol.toStringTag] | 4 / 4 | Complete selection | [v1](../results/test262-iterator-tag-native-v1.json) |
| Object.prototype (complete family) | 474 / 494 | 16 failures: missing APIs and iterator/Symbol tags; 2 dynamic Function variants unsupported; 2 LLDB attach failures | [v1](../results/test262-object-prototype-native-v1.json) |
| String.prototype.substr (Annex B) | 30 / 30 | Complete selection | [v1](../results/test262-string-substr-native-v1.json) |
| String.raw | 60 / 60 | Complete selection | [v1](../results/test262-string-raw-native-v1.json) |
| String.prototype.toWellFormed | 11 / 16 | 5 LLDB attach failures before execution; no assertion failures | [v1](../results/test262-string-towellformed-native-v1.json) |
| String.prototype.isWellFormed | 11 / 16 | 5 LLDB attach failures before execution; no assertion failures | [v1](../results/test262-string-iswellformed-native-v1.json) |
| String.prototype.startsWith | 42 / 42 | None | [v1](../results/test262-string-starts-with-native-v1.json) |
| parseInt | 110 / 110 | None | [v2](../results/test262-parse-int-native-v2.json) |
| parseFloat | 108 / 108 | None | [v2](../results/test262-parse-float-native-v2.json) |
| Math.round | 22 / 22 | None | [v1](../results/test262-math-round-native-v1.json) |
| Math.clz32 | 20 / 20 | None | [v1](../results/test262-math-clz32-native-v1.json) |
| Array.from | 86 / 90 | 2 ArrayBuffer-dependent failures; 2 cross-realm host failures | [v1](../results/test262-array-from-native-v1.json) |
| Proxy (before own-key/metadata fixes) | 582 / 607 | 8 failures, 14 unsupported, 3 LLDB attach failures | [v2](../results/test262-proxy-native-v2.json) |
| Proxy ownKeys | 54 / 54 | No failures or unsupported variants | [v1](../results/test262-proxy-ownkeys-native-v1.json) |
| TypedArray.prototype.with | 54 / 54 | No failures, unsupported cases, crashes or timeouts | [v1](../results/test262-typed-array-with-native-v1.json) |
| TypedArray.prototype.toReversed | 18 / 18 | Complete selection; prior reports retained | [v3](../results/test262-typed-array-toreversed-native-v3.json) |
| Object.prototype.toLocaleString | 21 / 22 | 1 LLDB attach failure before execution | [v1](../results/test262-object-localestring-native-v1.json) |
| Object.prototype.isPrototypeOf | 14 / 20 | 6 LLDB attach failures before execution; prior [build-blocked run](../results/test262-object-isprototypeof-native-v1.json) retained | [v2](../results/test262-object-isprototypeof-native-v2.json) |
| Object.getOwnPropertyDescriptors | 32 / 36 | 4 LLDB attach failures before execution; no assertion failures | [v1](../results/test262-object-descriptors-native-v1.json) |
| Object.hasOwn | 124 / 124 | Complete selection | [v1](../results/test262-object-hasown-native-v1.json) |
| Object.assign | 76 / 76 | Complete selection | [v1](../results/test262-object-assign-native-v1.json) |
| Object.groupBy | 28 / 28 | Complete selection | [v1](../results/test262-object-groupby-native-v1.json) |
| Object.fromEntries | 50 / 50 | Complete selection | [v1](../results/test262-object-fromentries-native-v1.json) |
| Object.entries | 40 / 42 | 2 unsupported global-object tampering variants | [v1](../results/test262-object-entries-native-v1.json) |
| Object.values | 38 / 40 | 2 unsupported global-object tampering variants | [v1](../results/test262-object-values-native-v1.json) |
| TypedArray.prototype.set | 188 / 220 | 20 failures (14 SharedArrayBuffer, 2 immutable-buffer, 4 missing join in this image); 12 unsupported resizable-buffer harness variants | [v1](../results/test262-typed-array-set-native-v1.json) |
| TypedArray.prototype.at | 24 / 30 | 6 unsupported variants require dynamic Function construction in the resizable-buffer harness | [v1](../results/test262-typed-array-at-native-v1.json) |
| TypedArray.of | 52 / 54 | 2 failures require immutable ArrayBuffer support | [v1](../results/test262-typed-array-of-native-v1.json) |
| TypedArray indexed Get | 52 / 56 | 4 failures require missing SharedArrayBuffer | [v1](../results/test262-typed-array-get-native-v1.json) |
| TypedArray.prototype.length | 30 / 36 | 6 unsupported variants use dynamic Function construction in the resizable-buffer harness | [v1](../results/test262-typed-array-length-native-v1.json) |
| RegExp.escape | 40 / 40 | No failures or unsupported cases | [v2](../results/test262-regexp-escape-native-v2.json) |
| RegExpStringIteratorPrototype | 34 / 34 | No failures or unsupported variants | [v1](../results/test262-regexp-string-iterator-native-v1.json) |
| RegExp.prototype[Symbol.matchAll] | 52 / 52 | No failures or unsupported variants | [v1](../results/test262-regexp-symbol-matchall-native-v1.json) |
| RegExp.prototype[Symbol.split] | 84 / 88 | 2 missing-Date failures, 2 unsupported dynamic-source variants | [v1](../results/test262-regexp-symbol-split-native-v1.json) |
| RegExp.prototype[Symbol.replace] | 138 / 138 | No failures or unsupported variants | [v1](../results/test262-regexp-symbol-replace-native-v1.json) |
| DataView.prototype.setBigInt64 | 44 / 48 | 2 immutable-buffer and 2 typed-array-dependent failures | [v1](../results/test262-dataview-setbigint64-native-v1.json) |
| DataView.prototype.getUint8 | 28 / 34 | 2 missing-typed-array failures; 4 LLDB attach failures | [v1](../results/test262-dataview-getuint8-native-v1.json) |
| DataView.prototype.byteLength | 13 / 26 | 9 failures, 4 LLDB attach failures; [spec comparison](../results/test262-dataview-bytelength-spec-comparison-v1.json) | [v1](../results/test262-dataview-bytelength-native-v1.json) |
| ArrayBuffer.prototype.byteLength | 16 / 20 | 4 failures requiring typed arrays or SharedArrayBuffer | [v1](../results/test262-arraybuffer-bytelength-native-v1.json) |
| Proxy get | 32 / 38 | 2 cross-realm host failures; 4 debugger attach failures | [v1](../results/test262-proxy-get-native-v1.json) |
| Array.prototype.toSorted | 42 / 42 | None | [v1](../results/test262-array-tosorted-native-v1.json) |
| String.prototype.codePointAt | 32 / 32 | None | [v1](../results/test262-string-code-point-at-native-v1.json) |
| Array.prototype.flatMap | 41 / 47 | 4 typed-array and 2 Proxy-dependent failures | [v1](../results/test262-array-flatmap-native-v1.json) |
| Array.prototype.flat | 36 / 38 | 2 Proxy-dependent failures | [v1](../results/test262-array-flat-native-v1.json) |
| Array.prototype.concat | 117 / 137 | 12 Proxy, 4 typed-array and 4 cross-realm host failures | [v1](../results/test262-array-concat-native-v1.json) |
| Array.prototype.fill | 40 / 44 | 4 unsupported resizable typed-array variants | [v1](../results/test262-array-fill-native-v1.json) |
| Array.prototype.every | 406 / 433 | 18 runtime failures; 6 unsupported; 2 harness errors; 1 debugger launch failure. Predates Math tag fix. | [v1](../results/test262-array-every-native-v1.json) |
| Array.prototype.includes | 52 / 60 | 2 Proxy-dependent failures; 6 unsupported resizable-buffer variants | [v2](../results/test262-array-includes-native-v2.json) |
| Array.prototype.find | 36 / 44 | 2 resizable-buffer harness errors; 6 unsupported | [v2](../results/test262-array-find-native-v2.json) |
| Annex B call assignment targets | 7 / 7 | None | [v1](../results/test262-call-assignment-targets-native-v1.json) |
| Block function declarations | 10 / 12 | 2 unsupported sloppy block functions | [v1](../results/test262-block-function-declarations-native-v1.json) |
| Annex B for-in initializers | 12 / 12 | None | [v1](../results/test262-for-in-initializers-native-v1.json) |
| String.fromCodePoint                 |        22 / 22 | None                                                                                                                   | [v1](../results/test262-string-from-code-point-native-v1.json)                                                                          |
| String.fromCharCode                  |        34 / 34 | None | [v2](../results/test262-string-from-char-code-native-v2.json) |
| String.prototype.charCodeAt          |        48 / 50 | 2 eval-dependent ReferenceErrors | [v1](../results/test262-string-char-code-at-native-v1.json) |
| String.prototype.charAt | 58 / 60 | 2 eval-related ReferenceErrors; batched runner matches single-case outcomes | [v3](../results/test262-string-char-at-native-v3.json) |
| Generated RegExp ASCII property      |          0 / 2 | 2 timeouts with indexed maps and a uniform 64 MiB heap; earlier allocation traps retained in v3                        | [v5](../results/test262-regexp-ascii-generated-native-v5.json)                                                                          |
| RegExp literals (older snapshot)     |      152 / 480 | 48 failures, 280 unsupported; predates named groups, modifiers, property escapes and sets                              | [v1](../results/test262-regexp-literals-native-v1.json)                                                                                 |
| RegExp prototype source              |        12 / 24 | 12 ReferenceError failures in tests requiring eval or the cross-realm host; no crashes or timeouts                     | [v1](../results/test262-regexp-source-native-v1.json)                                                                                   |
| RegExp prototype exec (post-folding) |      154 / 158 | 4 unsupported: function string conversion and Han properties; predates property matching                               | [v2](../results/test262-regexp-exec-native-v2.json)                                                                                     |
| RegExp simple Unicode folding        |          2 / 2 | Unchanged canonicalization selection; simple/common mappings, no full multi-character folding                          | [v1](../results/test262-regexp-simple-fold-native-v1.json)                                                                              |
| RegExp property character class      |          2 / 2 | None                                                                                                                   | [v1](../results/test262-regexp-property-class-native-v1.json)                                                                           |
| RegExp u/v property execution        |          2 / 2 | Unchanged Han, ASCII, Unicode capture and offset selection                                                             | [v1](../results/test262-regexp-property-exec-native-v1.json)                                                                            |
| RegExp set punctuation               |          2 / 2 | Unchanged parse-negative selection; no matching                                                                        | [v1](../results/test262-regexp-set-punctuation-native-v1.json)                                                                          |
| RegExp property alias                |          2 / 2 | Unchanged parse-negative selection; no matching                                                                        | [v1](../results/test262-regexp-property-alias-native-v1.json)                                                                           |
| RegExp duplicate names / modifiers   |     2 / 2 each | Two focused parse-negative selections; no matching                                                                     | [Names](../results/test262-regexp-duplicate-name-native-v1.json), [modifiers](../results/test262-regexp-duplicate-modifier-native-v1.json) |
| Arrow syntax early errors            |        43 / 43 | Native parse-negative checks; no evaluation                                                                            | [v2](../results/test262-arrow-early-errors-native-v2.json)                                                                              |
| Function destructuring               |      292 / 372 | 80 unsupported                                                                                                         | [v2](../results/test262-function-destructuring-native-v2.json)                                                                          |
| Assignment destructuring             |      439 / 640 | 189 unsupported; 12 pre-execution debugger failures                                                                    | [v2](../results/test262-assignment-dstr-native-v2.json)                                                                                 |
| GeneratorFunction                    |        18 / 46 | 22 unsupported; 4 realm failures; 2 harness errors                                                                     | [v1](../results/test262-generator-function-native-v1.json)                                                                              |
| Generator.next                       |        28 / 28 | None                                                                                                                   | [v1](../results/test262-generator-next-native-v1.json)                                                                                  |
| Generator.return                     |        46 / 46 | None                                                                                                                   | [v2](../results/test262-generator-return-native-v2.json)                                                                                |
| Generator.throw                      |        44 / 44 | None                                                                                                                   | [v1](../results/test262-generator-throw-native-v1.json)                                                                                 |
| Yield expressions                    |      120 / 123 | 3 unsupported (with, RegExp)                                                                                           | [v7](../results/test262-yield-native-v7.json)                                                                                           |
| Promise.then                         |      146 / 146 | None                                                                                                                   | [v2](../results/test262-promise-then-native-v2.json)                                                                                    |
| Promise.finally                      |        56 / 58 | 2 Proxy failures                                                                                                       | [v2](../results/test262-promise-finally-native-v2.json)                                                                                 |
| Promise.all                          |      190 / 196 | 2 unsupported (BigInt); 4 eval/indexOf failures                                                                        | [v1](../results/test262-promise-all-native-v1.json)                                                                                     |
| Promise.withResolvers                |        10 / 12 | 2 eval failures                                                                                                        | [v1](../results/test262-promise-with-resolvers-native-v1.json)                                                                          |
| Async function declarations          |       52 / 133 | 78 unsupported; 3 eval/globalThis failures                                                                             | [v1](../results/test262-async-function-declaration-native-v1.json)                                                                      |
| Await expressions                    |        44 / 44 | None; includes native parse-negative checks                                                                            | [v5](../results/test262-await-native-v5.json)                                                                                           |
| AsyncGenerator.next                  |        22 / 22 | None¹                                                                                                                  | [v1](../results/test262-async-generator-next-native-v1.json)                                                                            |
| AsyncGenerator.return                |        38 / 38 | None¹                                                                                                                  | [v1](../results/test262-async-generator-return-native-v1.json)                                                                          |
| AsyncGenerator.throw                 |        32 / 32 | None                                                                                                                   | [v1](../results/test262-async-generator-throw-native-v1.json)                                                                           |
| Binding redeclarations               |      170 / 189 | 19 unsupported; predates module-name additions                                                                         | [v1](../results/test262-binding-redeclarations-native-v1.json)                                                                          |
| Array.prototype Symbol.unscopables   |        10 / 10 | None                                                                                                                   | [v1](../results/test262-array-unscopables-native-v1.json)                                                                               |
| With statements                      |      120 / 182 | 59 runtime failures; 3 unsupported; predates Array unscopables                                                         | [v1](../results/test262-with-native-v1.json)                                                                                            |
| BigInt.prototype.valueOf             |        14 / 16 | 2 cross-realm failures                                                                                                 | [v1](../results/test262-bigint-valueof-native-v1.json)                                                                                  |
| BigInt.asIntN                        |        28 / 28 | None                                                                                                                   | [v1](../results/test262-bigint-asintn-native-v1.json)                                                                                   |
| Async generator expressions          |  1,037 / 1,212 | 6 eval-related failures; 168 unsupported; 1 pre-execution debugger failure; captured before later parser/runtime fixes | [v1](../results/test262-async-generator-expression-native-v1.json)                                                                      |

¹ AsyncGenerator.next/return report scope text predates source support.

Destructuring results predate later binding/control-flow work; async declaration
results predate async arrows, await and globalThis.

### Focused checks

These validate specific behavior, not coverage of their containing directories.

| Focused selection                        | Passed / total | Evidence                                                                 |
| ---------------------------------------- | -------------: | ------------------------------------------------------------------------ |
| Math.random: host entropy, range, metadata and unused arguments | 2 / 2 | [Summary](../results/native-math-random-focused-v1.json) |
| IsHTMLDDA semantics | 3 / 4; 1 pre-entry LLDB attach failure | [Original](../results/native-html-dda-focused-v1.json); [separate case-0 diagnostic passes](../results/native-html-dda-entry-diagnostic-v1.json) |
| Fractional powers: ranges, signs and coercion | 3 / 3 | [Summary](../results/native-math-power-focused-v1.json) |
| Number precision formatting: rounding, receiver checks and coercion order | 4 / 4 | [Summary](../results/native-number-format-focused-v1.json) |
| Number non-Intl locale fallback | 2 / 2 | [Summary](../results/native-number-locale-focused-v1.json) |
| Fractional power-of-two radix formatting | 1 / 1 | [Summary](../results/native-number-radix-fractional-v1.json) |
| Gregorian calendar and ISO week boundaries | 1 / 1 | [Summary](../results/native-gregorian-week-focused-v1.json) |
| Temporal.PlainDate: ISO constructor, fields, limits and brand checks | 4 / 4 | [Summary](../results/native-temporal-date-focused-v1.json) |
| Temporal calendarName options | 3 / 3 | [Summary](../results/native-temporal-options-focused-v1.json) |
| Temporal.PlainDate conversion and comparison | 3 / 3 | [Summary](../results/native-temporal-conversion-focused-v1.json) |
| ISO date/time parser | 1 / 1 | [Summary](../results/native-iso-date-time-focused-v1.json) |
| Temporal ISO conversion and month-code ordering | 3 / 3 | [Summary](../results/native-temporal-iso-focused-v1.json) |
| Temporal.Duration fields, bounds, formatting and branding | 4 / 4 in separate diagnostic | [v2](../results/native-temporal-duration-focused-v2.json); [prior pre-entry launch failure](../results/native-temporal-duration-focused-v1.json) retained |
| Temporal partial-date fields, reference dates, ranges and brands | 3 / 3 | [v1](../results/native-temporal-partial-date-focused-v1.json) |
| Temporal UTC/fixed-offset ZonedDateTime and PlainDate conversion | 3 / 3 | [v2](../results/native-temporal-zoned-date-time-focused-v2.json); prior [unsupported Z identifier](../results/native-temporal-zoned-date-time-focused-v1.json) and [isolated diagnostic](../results/native-temporal-zoned-boundary-probe-focused-v1.json) retained |
| Temporal partial-date conversion and reference canonicalization | 3 / 3 | [v1](../results/native-temporal-partial-date-from-focused-v1.json) |
| Temporal PlainDateTime conversion and comparison | 3 / 3 | [v1](../results/native-temporal-date-time-from-focused-v1.json) |
| Temporal date/date-time copy methods | 2 / 2 each | [date](../results/native-temporal-date-methods-focused-v1.json), [date-time](../results/native-temporal-date-time-methods-focused-v1.json) |
| Temporal date-to-date-time conversion and boundary | 2 / 2 | [v1](../results/native-temporal-date-to-date-time-focused-v1.json) |
| Temporal Duration conversion and replacement | 2 / 2; 1 / 1 | [from](../results/native-temporal-duration-from-focused-v1.json), [with](../results/native-temporal-duration-with-focused-v1.json) |
| Temporal PlainTime constructor and conversion | 2 / 2; 3 / 3 | [constructor](../results/native-temporal-plain-time-focused-v1.json), [from](../results/native-temporal-time-from-focused-v1.json) |
| Temporal Instant construction, factories, parsing and epoch bounds | 3 / 3 | [v1](../results/native-temporal-instant-focused-v1.json) |
| Temporal.PlainDateTime fields and limits | 2 / 3; 1 pre-entry LLDB failure | [v1](../results/native-temporal-date-time-focused-v1.json) |
| Partial date limits | 2 / 2 | [v1](../results/native-temporal-partial-limits-focused-v1.json) |
| Hour-only offset annotations | 1 / 1 | [v1](../results/native-temporal-offset-annotations-focused-v1.json) |
| Instant arithmetic | 2 / 2 | [v1](../results/native-temporal-instant-arithmetic-focused-v1.json) |
| PlainTime arithmetic | 2 / 2 | [v1](../results/native-temporal-time-arithmetic-focused-v1.json) |
| Instant rounding | 3 / 3 | [v1](../results/native-temporal-instant-round-focused-v1.json) |
| Instant precision formatting | 3 / 3 | [v1](../results/native-temporal-instant-precision-focused-v1.json) |
| Exact integer rounding including 2^200 | 1 / 1 | [v1](../results/native-integer-rounding-focused-v1.json) |
| Instant/PlainTime signed differences and option ordering | 4 / 4 | [v1](../results/native-temporal-difference-focused-v1.json) |
| PlainTime precision/round/equality | 1 / 3; 2 pre-entry failures | [v1](../results/native-temporal-time-precision-focused-v1.json); [separate transport diagnostic 3 / 3](../results/native-debugger-time-precision-diagnostic-v1.json), original failures retained |
| PlainTime partial replacement and operation ordering | 3 / 3 | [v1](../results/native-temporal-time-with-focused-v1.json) |
| Instant zoned conversion and ISO time-zone parsing | 2 / 2 | [v1](../results/native-temporal-instant-zoned-focused-v1.json) |
| PlainDate/PlainDateTime calendar arithmetic and carry | 3 / 3 | [v1](../results/native-temporal-date-arithmetic-focused-v1.json) |
| PlainDateTime precision, calendar annotations and clock replacement | 3 / 3 | [v1](../results/native-temporal-date-time-precision-focused-v1.json) |
| PlainDateTime day/clock rounding and boundaries | 2 / 2 | [v1](../results/native-temporal-date-time-round-focused-v1.json) |
| PlainTime shared-rounding regression | 3 / 3 | [v2](../results/native-temporal-time-precision-shared-rounding-v2.json); earlier pre-entry failures remain above |
| Live Set basics | 5 / 7; 2 pre-entry LLDB failures | [Summary](../results/native-live-sets-focused-v1.json) |
| Hyperbolic functions: domains, signed zero, tiny inputs and overflow boundaries | 4 / 4 | [Summary](../results/native-math-hyperbolic-focused-v1.json) |
| Inverse angles and atan2: domains, quadrants, signed zero and binary coercion order | 3 / 3 | [Summary](../results/native-math-angle-focused-v1.json) |
| Sine/cosine/tangent: quadrant reduction, huge inputs and coercion | 3 / 3 | [Summary](../results/native-math-trigonometry-focused-v1.json) |
| Math.cbrt: exact cubes, subnormals, coercion and metadata | 4 / 4 | [Summary](../results/native-math-cbrt-focused-v1.json) |
| Math.exp/expm1: range reduction, subnormal tail and tiny inputs | 4 / 4 | [Summary](../results/native-math-exp-focused-v1.json) |
| Math logarithms: range reduction, log1p precision and coercion | 4 / 4 | [Summary](../results/native-math-log-focused-v1.json) |
| Error.isError: internal branding, subclasses, proxies and metadata | 3 / 3 | [Summary](../results/native-error-brand-focused-v1.json) |
| Unicode casing: expansions, supplementary characters, final sigma and coercion | 4 / 4 | [Summary](../results/native-string-casing-focused-v1.json) |
| Math.sumPrecise: exact cancellation, rounding and iterator closing | 6 / 6 | [Summary](../results/native-math-sum-precise-focused-v1.json) |
| Legacy escape/unescape: UTF-16, malformed escapes and coercion | 4 / 4 | [Summary](../results/native-legacy-uri-focused-v1.json) |
| Annex B HTML string helpers: coercion, escaping and metadata | 4 / 4 | [Summary](../results/native-string-html-focused-v1.json) |
| Math.hypot: scaling, exceptional values and ordered coercion | 4 / 4 | [Summary](../results/native-math-hypot-focused-v1.json) |
| Math.fround/f16round: ties, subnormals, coercion and metadata | 4 / 4 | [Summary](../results/native-math-float-round-focused-v1.json) |
| Raw JSON: primitive grammar, frozen branding, proxies and lossless serialization | 6 / 6 | [Summary](../results/native-json-raw-focused-v1.json) |
| JSON.parse: strict grammar, reviver traversal/mutation and source context | 10 / 10 | [Summary](../results/native-json-parse-focused-v1.json) |
| JSON.stringify: replacers, coercion, ordering, cycles, proxies and UTF16 | 10 / 10 | [Summary](../results/native-json-stringify-focused-v1.json) |
| URI globals, corrected escaped-source fixture | 6 / 6 | [v2](../results/native-uri-focused-v2.json); original failed fixture retained below |
| Async iterator disposal: promise adoption, abrupt completion and metadata | 5 / 5 | [Summary](../results/native-async-dispose-focused-v1.json) |
| URI globals (initial fixture) | 5 / 6 | [v1](../results/native-uri-focused-v1.json); lone-surrogate source was replaced during UTF-8 fixture transport; corrected fixture passes in v2 |
| Iterator.zip/zipKeyed, padding, strict lengths and reverse cleanup | 9 / 9 | [Summary](../results/native-iterator-zip-focused-v1.json) |
| Iterator includes/join and cleanup | 6 / 6 | [Summary](../results/native-iterator-search-focused-v1.json) |
| Iterator chunks/windows and partial exhaustion | 7 / 7 | [Summary](../results/native-iterator-chunking-focused-v1.json) |
| Iterator.concat, lazy acquisition and cleanup | 6 / 6 | [Summary](../results/native-iterator-concat-focused-v1.json) |
| Iterator disposal and abrupt completion | 4 / 4 | [Summary](../results/native-iterator-dispose-focused-v1.json) |
| Function exact source retention | 7 / 7 | [Summary](../results/native-function-source-focused-v1.json) |
| Built-in, bound and proxy function stringification | 5 / 5 | [Summary](../results/native-function-text-focused-v1.json) |
| Set union/symmetricDifference | 2 / 6; 4 pre-entry LLDB failures | [Summary](../results/native-set-combinations-focused-v1.json) |
| Set relations/intersection/difference | 2 / 6; 4 pre-entry LLDB failures | [Summary](../results/native-set-relations-focused-v1.json) |
| Set finite-subset identities | 0 / 1; 1 pre-entry LLDB failures | [Summary](../results/native-set-identities-focused-v1.json) |
| Array binding reference ordering | 1 / 4; 3 pre-entry LLDB failures | [Summary](../results/native-array-binding-order-focused-v1.json) |
| Var destructuring binding resolution and with side effects | 4 / 4 | [Summary](../results/native-binding-order-focused-v1.json) |
| Live Map groupBy and upsert; shared Object.groupBy regression | 6 / 6 | [Summary](../results/native-map-additions-focused-v1.json) |
| Live Map constructors, keys, mutation and iterators | 5 / 7; 2 pre-entry LLDB failures | [Summary](../results/native-live-maps-focused-v2.json) |
| Iterator flatMap, nested cleanup and reentrancy | 8 / 8 | [Summary](../results/native-iterator-flatmap-focused-v1.json) |
| Iterator take/drop, coercion and cleanup | 7 / 8; 1 pre-entry LLDB failure | [Summary](../results/native-iterator-limits-focused-v1.json) |
| Iterator lazy map/filter, brands and reentrancy | 9 / 9 | [Summary](../results/native-iterator-mapping-focused-v1.json) |
| Iterator eager consumers and cleanup precedence | 5 / 8; 3 pre-entry LLDB failures | [Summary](../results/native-iterator-consumers-focused-v1.json) |
| Iterator.from forwarding, brands and abrupt completion | 7 / 7 | [Summary](../results/native-iterator-from-focused-v1.json) |
| Iterator base, subclassing and inherited accessors | 6 / 6 | [Summary](../results/native-iterator-base-focused-v1.json) |
| Object.toString primitive wrapper fallback tags | 3 / 3 | [Summary](../results/native-object-tags-focused-v2.json); [failing baseline](../results/native-object-tags-focused-v1.json) |
| Gregorian calendar core (bespoke, not API conformance) | 1 / 1 | [Summary](../results/native-gregorian-calendar-focused-v1.json) |
| For-await scheduling and cleanup         |        10 / 10 | [Summary](../results/test262-for-await-focused-summary-v1.json)             |
| Array callback, search, mutation and sorting methods | 32 / 32 | [Summary](../results/native-array-methods-focused-v4.json) |
| RegExp and String protocols, split and matchAll | 16 / 16 | [Summary](../results/native-regexp-matchall-focused-v1.json) |
| RegExp.escape | 2 / 2 | [Summary](../results/native-regexp-escape-focused-v1.json) |
| RegExp iterator state and cross-realm resumption | 2 / 2 | [Summary](../results/native-regexp-iterator-state-focused-v2.json) |
| DataView integer, float and BigInt accessors | 8 / 8 | [Shared-codec regression](../results/native-dataview-numeric-codec-focused-v1.json) |
| TypedArray length/buffer construction and indexed properties | 7 / 7 | [Summary](../results/native-typed-array-intrinsics-focused-v1.json) |
| TypedArray iterable, array-like and typed-array copying | 5 / 5 | [Summary](../results/native-typed-array-copy-focused-v1.json) |
| TypedArray iterators | 2 / 2 | [Summary](../results/native-typed-array-iterators-focused-v1.json) |
| Array iterator completion, re-entry and creation realm | 5 / 5 | [Summary](../results/native-array-iterator-state-focused-v1.json) |
| TypedArray.from/of | 6 / 6 | [Summary](../results/native-typed-array-static-focused-v3.json) |
| TypedArray at/includes/indexOf/lastIndexOf | 5 / 5 | [Summary](../results/native-typed-array-search-focused-v1.json) |
| TypedArray set and overlapping storage | 8 / 8 | [Summary](../results/native-typed-array-set-focused-v1.json) |
| TypedArray join/toString | 3 / 3 | [Summary](../results/native-typed-array-text-focused-v1.json) |
| TypedArray reverse | 4 / 4 | [Summary](../results/native-typed-array-reverse-focused-v1.json) |
| TypedArray fill | 5 / 5 | [Summary](../results/native-typed-array-fill-focused-v1.json) |
| TypedArray copyWithin | 5 / 5 | [Summary](../results/native-typed-array-copywithin-focused-v2.json) |
| TypedArray copyWithin shrinking overlap correction | 1 / 1 | [Summary](../results/native-typed-array-copywithin-shrink-focused-v1.json) |
| TypedArray callbacks and reductions | 7 / 7 | [Summary](../results/native-typed-array-callbacks-focused-v1.json) |
| TypedArray map/filter species and callback order | 8 / 8 | [Summary](../results/native-typed-array-composition-focused-v2.json) |
| TypedArray empty species content-kind validation | 1 / 1 | [Summary](../results/native-typed-array-species-kind-focused-v1.json) |
| TypedArray toReversed | 4 / 4 | [Summary](../results/native-typed-array-copying-focused-v1.json) |
| TypedArray with | 6 / 6 | [Summary](../results/native-typed-array-with-focused-v1.json) |
| TypedArray sort/toSorted | 6 / 6 | [Summary](../results/native-typed-array-sorting-focused-v1.json) |
| TypedArray subarray sharing and species order | 4 / 4 | [Summary](../results/native-typed-array-subarray-focused-v1.json) |
| TypedArray tracking subarray species argument count | 1 / 1 | [Summary](../results/native-typed-array-subarray-arguments-focused-v1.json) |
| TypedArray slice copying, aliasing and coercion | 7 / 7 | [Summary](../results/native-typed-array-slice-focused-v1.json) |
| Legacy Object prototype accessor | 4 / 6 | [Summary](../results/native-object-proto-accessor-focused-v1.json); 2 LLDB attach failures |
| Legacy Object accessor helpers | 4 / 6 | [Summary](../results/native-object-legacy-accessors-focused-v1.json); 2 LLDB attach failures |
| Object prototype locale/prototype queries | 3 / 7 | [Summary](../results/native-object-prototype-focused-v1.json); 4 LLDB attach failures, prototype-chain cases passed |
| Object.groupBy ordering and iterator cleanup | 8 / 8 | [Summary](../results/native-object-groupby-focused-v1.json) |
| Object.fromEntries | 7 / 7 | [Summary](../results/native-object-fromentries-focused-v1.json) |
| Object.fromEntries iterator step failures | 3 / 3 | [Summary](../results/native-object-fromentries-step-focused-v1.json) |
| Object assign/hasOwn/property descriptors | 7 / 7 | [Summary](../results/native-object-reflection-focused-v1.json) |
| Object entries/values enumeration | 6 / 6 | [Summary](../results/native-object-entries-focused-v1.json) |
| Object reflection Proxy regressions | 9 / 9 | [Summary](../results/native-object-reflection-proxy-focused-v1.json) |
| ArrayBuffer lifecycle and slice/species | 7 / 7 | [Summary](../results/native-array-buffer-focused-v2.json) |
| Reflect internal-method APIs | 6 / 6 | [Summary](../results/native-reflect-focused-v1.json) |
| Proxy cross-realm trap error and eval target | 4 / 4 | [Trap](../results/test262-proxy-get-cross-realm-native-v1.json), [target](../results/test262-proxy-eval-target-native-v1.json) |
| Native realms and constructor/Proxy/species realm semantics | 10 / 10 | [Summary](../results/native-realms-focused-v4.json) |
| Proxy traps, reflection and revocation | 9 / 9 | [Summary](../results/native-proxy-focused-v4.json) |
| Array copying methods | 5 / 5 | [Summary](../results/native-array-copying-focused-v1.json) |
| Array sort/toSorted | 3 / 3 | [Summary](../results/native-array-sorting-focused-v1.json) |
| Array flat/flatMap | 5 / 5 | [Summary](../results/native-array-flatten-focused-v1.json) |
| Array.from and Array.of | 6 / 6 | [Summary](../results/native-array-factories-focused-v1.json) |
| String.substr boundaries and coercion | 0 / 5; 5 LLDB attach failures | [Summary](../results/native-string-substr-focused-v1.json) |
| String.raw coercion and metadata | 2 / 6; 4 LLDB attach failures | [Summary](../results/native-string-raw-focused-v1.json) |
| String UTF-16 well-formed checks and repair | 6 / 6 | [Summary](../results/native-string-wellformed-focused-v1.json) |
| String padding and indexed access | 4 / 4 | [Summary](../results/native-string-indexing-focused-v1.json) |
| String trimming, searching, repetition and concatenation | 4 / 4 | [Summary](../results/native-string-methods-focused-v2.json) |
| Async delegation to async/sync iterators |        12 / 12 | [Summary](../results/test262-async-delegation-focused-summary-v1.json)      |
| Native binding and export errors         |          6 / 6 | [Summary](../results/test262-native-binding-focused-summary-v1.json)        |
| Native parse-negative execution          |          2 / 2 | [Await operand](../results/test262-native-parse-await-no-operand-v1.json)   |
| Yield inside with                        |          1 / 1 | [Native result](../results/test262-yield-with-native-v1.json)               |
| BigInt addition arithmetic               |          2 / 2 | [Native result](../results/test262-bigint-addition-native-v1.json)          |
| BigInt postfix increment                 |          2 / 2 | [Native result](../results/test262-bigint-postfix-increment-native-v1.json) |

## Next priorities

1. Preserve the completed native syntax gate while completing execution paths
   for parsed syntax and expanding behavior validation.
2. Validate native behavior against unchanged Test262 sources, targeting over 90%
   passes across the full pinned population. Bring forward required harness APIs.
3. Preserve native self-hosting and record full-suite execution evidence.

## Maintaining this dashboard

Update rows in place after complete selection reruns; do not append a progress diary
or merge focused passes into older totals. Preserve each run as an immutable
[JSON report](../results/). Regression fixtures and self-builds are not Test262 passes.

Keep commands and adapter limitations in the [runner contract](../test262-runner.md),
and implementation details in [language coverage](../language-coverage.md) or the
[async runtime design](../async-runtime.md).
