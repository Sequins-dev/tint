# Tint Language, Feature & Builtin Benchmark Scorecard

This document summarizes Tint's benchmark coverage across ECMAScript/TypeScript language syntax, OOP, control flow, async, and standard builtins, along with how to run the unified holistic scorecard.

## Quick Start

```bash
# Quick holistic scorecard (typed + untyped twins, general realm, async, Test262 canary)
node tools/scorecard.ts --quick --label local-quick

# Full holistic scorecard (adds existing typed-bench, string-bench, general-call-bench)
node tools/scorecard.ts --full --label local-full

# Run specific suites only
node tools/scorecard.ts --suite language-typed,language-untyped --rounds 3 --label twins

# Run individual language-bench suites directly
node tools/language-bench/bench.ts check-node
node tools/language-bench/bench.ts prepare /opt/homebrew/bin/node /tmp/typed.json --suite typed
tools/gate/with-lock.sh both lang-typed node tools/language-bench/bench.ts measure /tmp/typed.json /tmp/typed-report.json 5

# Run the Test262 batch-throughput canary directly
node tools/language-bench/test262-canary.ts prepare /opt/homebrew/bin/node /tmp/canary.json --allow-missing
tools/gate/with-lock.sh both t262-canary node tools/language-bench/test262-canary.ts measure /tmp/canary.json /tmp/canary-report.json 3
```

`tools/scorecard.ts` compiles native images and verifies Node checksum parity **outside** the shared lock, then automatically acquires `tools/gate/with-lock.sh both` for the timed execution phase (or honors an outer lock when `TINT_SCORECARD_LOCKED=1` / `--locked` is set). Reports are written as both JSON (`docs/results/scorecard-<label>.json`) and Markdown (`docs/results/scorecard-<label>.md`).

All existing benchmark CLIs (`tools/typed-bench/bench.ts`, `tools/string-bench/bench.ts`, `tools/general-call-bench/benchmark.ts`, `tools/feature-bench/measure.ts`, `tools/pattern-bench/compare.ts`, `tools/worker-bench/`, `tools/gc-weak-bench.ts`, `tools/node-ffi-benchmark.ts`, `tools/node-crypto-microbench.ts`, `tools/zlib-microbench.ts`) remain unchanged and backwards-compatible.

## Benchmark Coverage Matrix

### Existing Specialized Suites

| Suite | Focus | Modes |
| --- | --- | --- |
| `tools/typed-bench/` | Core typed codegen (`allocation`, `numeric`, `calls`, `strings`, `compiler`, `typedArrays`, `typedArrayKinds`, `typedArrayFill`, `stringEquality`, `stringBuild`, `mapSet`, `closures`, `arrays`, `escape`, `classes`, `basicClasses`) | Typed (`TINT_GENERAL_FALLBACK=0`) vs Node |
| `tools/general-call-bench/` | Untyped call/IC/element microbenchmarks (`kernels`, `generality`, `elements`) + Chromium Octane (`Richards`, `DeltaBlue`, `NavierStokes`, `RayTrace`) | Untyped (+ typed for `kernels`) vs Node |
| `tools/string-bench/` | 1-byte vs 2-byte strings, UTF-8 encode/decode, structured clone, slicing, concatenation | Typed + general vs Node |
| `tools/feature-bench/` | Whole-process feature workloads (`interpreter`, `records`, `closures`, `pipelines`, `collections`, `strings`, `numeric`, `recursion`, `exceptions`, `optionals`, `sorting`, hand-rolled `serialization`) | Typed vs Node |
| `tools/pattern-bench/` | Compiler source-pattern microbenchmarks (`sha256`, `switchKind`, `spreadCopy`, `filterMap`, etc.) | Typed vs Node |
| `tools/worker-bench/`, `tools/gc-weak-bench.ts`, `tools/node-ffi-benchmark.ts`, `tools/node-crypto-microbench.ts`, `tools/zlib-microbench.ts`, `tools/bench-script-array-elements.ts` | Workers, generational weak slots, `node:ffi`, `node:crypto`, `node:zlib`, Script array elements | Specialized native vs Node/C |

### Comprehensive Language & Builtin Suite (`tools/language-bench/`)

Every kernel in `kernels-typed.ts` is compiled twice:
1. **`language-typed`**: verified with `TINT_GENERAL_FALLBACK=0` (`requireTyped: true`, zero general fallback).
2. **`language-untyped`**: exact same source stripped via `stripTypeScriptTypes` with a realm guard, measuring the untyped/JS general path twin on the identical workload.

Kernels in `kernels-general.ts` and `kernels-async.ts` measure ECMAScript constructs and standard builtins currently lowered via the general realm (`typedStatus: "fallback"`), so graduation to the typed path is explicitly tracked in `tools/language-bench/registry.ts`.

| Category | Kernels | Typed Native (`TINT_GENERAL_FALLBACK=0`) | Untyped / General Twin |
| --- | --- | :---: | :---: |
| **Serialization & Binary Data** | `jsonRoundtrip`, `jsonEscapeStrings`, `dataViewEndian`, `sharedArrayBufferViews`, `bigintArithmetic`, `bigintParse`, `bigintTypedArrays`, `float16Array`, `atomicsOps` | 9 / 9 | 9 / 9 |
| **Classes & Modern OOP** | `privateFieldsMethods`, `privateBrandChecks`, `staticBlocksExpressions`, `deepInheritanceSuper`, `classAccessorsInstanceof` | 5 / 5 | 5 / 5 |
| **Math Builtins** | `mathTranscendental`, `mathBitwiseRounding`, `mathHypotPowLog` | 3 / 3 | 3 / 3 |
| **String Builtins & Templates** | `stringReplaceAll`, `stringNormalizeUnicode`, `stringCaseAsciiUnicode`, `stringTrimPadSearch`, `taggedTemplates` | 4 / 5 | 5 / 5 |
| **Control Flow, Syntax & Functional** | `destructuringPatterns`, `spreadArrayObjectCall`, `switchDenseSparseString`, `tryCatchNoThrow`, `tryCatchThrowError`, `optionalChainingNullish`, `defaultRestParams`, `nestedClosures`, `forOfCollections`, `generatorsYield`, `customIterators` | 9 / 11 | 11 / 11 |
| **Collections & Objects** | `mapSetDeleteRehash`, `mapSetBigIntKeys`, `mapSetObjectKeys`, `objectDynamicOps`, `weakMapSet`, `objectAssignFromEntries`, `arrayHofsFull` | 4 / 7 | 7 / 7 |
| **Standard Builtins** | `errorConstruction`, `regexpMatchExecReplace`, `dateOperations`, `symbolKeysRegistry`, `proxyReflect` | 1 / 5 | 5 / 5 |
| **Async & Promises** | `promiseChains`, `promiseAllBatch`, `asyncAwaitMicrotasks` | 0 / 3 | 3 / 3 |
| **Test262 Batch Canary** | 95 unchanged synchronous Test262 semantic tests across 34 `language/*` and `built-ins/*` families in 8 execution buckets (`tools/language-bench/test262-canary-manifest.json`) | — | 8 groups (95 tests) |

### Test262 Batch-Throughput Canary

`tools/language-bench/test262-canary.ts` loads the 95 unchanged Test262 files listed in `tools/language-bench/test262-canary-manifest.json` directly from a local Test262 checkout (discovered automatically from `--test262`, `TINT_TEST262_DIR`, `.tint-bootstrap/test262`, or the shared git common-dir's `.tint-bootstrap/test262`), wraps each file in an isolated strict function, and measures looped execution throughput (cases/sec and Tint/Node ratio) across 8 semantic buckets. No Test262 sources are copied into git; when no local Test262 checkout is present, `--allow-missing` and `tools/scorecard.ts` skip the canary cleanly.

### Hosted Realm Coverage Note

Three general/untyped workloads (`sharedArrayBufferViews` untyped, `atomicsOps` untyped, and `weakMapSet`) currently require the full script-host runtime (`requiresScriptHostInGeneral: true` in `tools/language-bench/registry.ts`) because Tint's hosted program realm does not yet wire `WeakMap`/`WeakSet` storage, `SharedArrayBuffer`, or `Atomics` (filed in the shared perf queue). Default `scorecard.ts` runs use the fast hosted-fixture path (`verifyHostedFixture`) for all 88 measurements (`35` typed, `33` untyped twins, `9` general, `3` async, `8` Test262 canary groups), while explicitly selecting any of those 3 kernels via `tools/language-bench/bench.ts --kernel ...` automatically switches to the script-host batch builder.

## Recorded Baselines

- [scorecard-language-baseline-v1.md](results/scorecard-language-baseline-v1.md) ([JSON](results/scorecard-language-baseline-v1.json)) — locked quick holistic baseline on `origin/main` (`dbf0054b4`, Apple M5 Max, Node v26.13.1).
