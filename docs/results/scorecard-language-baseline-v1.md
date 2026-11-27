# Tint Holistic Language & Builtin Scorecard (language-baseline-v1)

- **Recorded:** 2026-11-27T03:24:07.236Z
- **Profile:** `quick` (rounds=2, steady=2)
- **Commit:** `dbf0054b4caeba3235aa345ef8ca5ae53f4b09bd`
- **Host:** darwin-arm64 (Apple M5 Max)
- **Node:** v26.13.1 (`/opt/homebrew/bin/node`)

## Executive Summary

| Metric | Value |
| --- | ---: |
| Total measurements (Node checksum verified) | 88 |
| **Overall Geomean (Tint / Node)** | **7.29×** |
| **Typed Geomean (35 measurements)** | **2.97×** |
| **Untyped / General / Async / Canary Geomean (53 measurements)** | **13.18×** |
| **Typed Speedup vs Untyped Twin Geomean (33 pairs)** | **6.85×** |
| Deficits > 2.00× slower than Node | 62 |

## Suite Status

| Suite | Status | Measurements | Notes |
| --- | --- | ---: | --- |
| `language-typed` | completed | 35 | - |
| `language-untyped` | completed | 33 | - |
| `language-general` | completed | 9 | - |
| `language-async` | completed | 3 | - |
| `test262-canary` | completed | 8 | - |

## Per-Suite Summary (Tint / Node, lower is better)

| Suite | Count | Geomean | Best | Worst | < 1.0× | <= 1.25× | > 2.0× |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `language-async` | 3 | 22.26× | 16.07× | 26.53× (`language-async:promiseAllBatch`) | 0 | 0 | 3 |
| `language-general` | 9 | 10.91× | 2.37× | 42.44× (`language-general:regexpMatchExecReplace`) | 0 | 0 | 9 |
| `language-typed` | 35 | 2.97× | 0.25× | 1782.60× (`language-typed:mathTranscendental`) | 14 | 15 | 16 |
| `language-untyped` | 33 | 20.23× | 0.74× | 2083.70× (`language-untyped:mathTranscendental`) | 2 | 2 | 30 |
| `test262-canary` | 8 | 2.29× | 1.11× | 6.46× (`test262-canary:statements`) | 0 | 1 | 4 |

## Per-Category Summary (Tint / Node, lower is better)

| Category | Count | Geomean | Best | Worst | < 1.0× | <= 1.25× | > 2.0× |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `async-promises` | 3 | 22.26× | 16.07× | 26.53× (`language-async:promiseAllBatch`) | 0 | 0 | 3 |
| `classes-oop` | 10 | 6.63× | 0.61× | 104.20× (`language-untyped:classAccessorsInstanceof`) | 3 | 3 | 6 |
| `collections-objects` | 10 | 12.20× | 1.38× | 30.23× (`language-untyped:mapSetDeleteRehash`) | 0 | 0 | 9 |
| `control-flow-syntax` | 20 | 3.15× | 0.25× | 60.44× (`language-untyped:spreadArrayObjectCall`) | 9 | 9 | 10 |
| `math-builtins` | 6 | 42.51× | 1.37× | 2083.70× (`language-untyped:mathTranscendental`) | 0 | 0 | 5 |
| `serialization-binary` | 16 | 16.36× | 0.77× | 494.69× (`language-untyped:bigintTypedArrays`) | 1 | 1 | 15 |
| `stdlib-builtins` | 6 | 3.16× | 0.52× | 42.44× (`language-general:regexpMatchExecReplace`) | 2 | 2 | 4 |
| `string-builtins` | 9 | 7.27× | 0.92× | 32.94× (`language-untyped:stringNormalizeUnicode`) | 1 | 2 | 6 |
| `test262-canary` | 8 | 2.29× | 1.11× | 6.46× (`test262-canary:statements`) | 0 | 1 | 4 |

## Typed vs Untyped Twin Comparison

| Kernel | Category | Typed / Node | Untyped / Node | Typed Speedup vs Untyped |
| --- | --- | ---: | ---: | ---: |
| `forOfCollections` | `control-flow-syntax` | 0.29× | 53.50× | 192.82× |
| `classAccessorsInstanceof` | `classes-oop` | 0.61× | 104.20× | 181.29× |
| `destructuringPatterns` | `control-flow-syntax` | 0.25× | 41.32× | 174.66× |
| `spreadArrayObjectCall` | `control-flow-syntax` | 0.73× | 60.44× | 82.14× |
| `deepInheritanceSuper` | `classes-oop` | 0.71× | 38.85× | 53.66× |
| `defaultRestParams` | `control-flow-syntax` | 1.48× | 60.37× | 37.27× |
| `staticBlocksExpressions` | `classes-oop` | 1.34× | 47.49× | 36.72× |
| `privateFieldsMethods` | `classes-oop` | 2.08× | 61.19× | 29.59× |
| `switchDenseSparseString` | `control-flow-syntax` | 0.44× | 12.41× | 28.43× |
| `privateBrandChecks` | `classes-oop` | 0.71× | 16.37× | 22.94× |
| `nestedClosures` | `control-flow-syntax` | 0.90× | 18.48× | 22.87× |
| `mapSetDeleteRehash` | `collections-objects` | 1.38× | 30.23× | 21.97× |
| `tryCatchNoThrow` | `control-flow-syntax` | 0.43× | 4.20× | 9.70× |
| `optionalChainingNullish` | `control-flow-syntax` | 0.31× | 2.90× | 9.23× |
| `float16Array` | `serialization-binary` | 2.33× | 19.03× | 8.12× |
| `mathBitwiseRounding` | `math-builtins` | 1.37× | 11.33× | 7.76× |
| `stringTrimPadSearch` | `string-builtins` | 0.92× | 5.15× | 5.65× |
| `mathHypotPowLog` | `math-builtins` | 4.37× | 23.35× | 5.28× |
| `dataViewEndian` | `serialization-binary` | 15.49× | 55.54× | 3.47× |
| `mapSetObjectKeys` | `collections-objects` | 6.80× | 21.89× | 3.44× |
| `bigintTypedArrays` | `serialization-binary` | 173.51× | 494.69× | 2.41× |
| `stringReplaceAll` | `string-builtins` | 1.14× | 1.94× | 1.64× |
| `bigintParse` | `serialization-binary` | 15.38× | 21.39× | 1.42× |
| `errorConstruction` | `stdlib-builtins` | 0.52× | 0.74× | 1.38× |
| `tryCatchThrowError` | `control-flow-syntax` | 0.55× | 0.77× | 1.34× |
| `bigintArithmetic` | `serialization-binary` | 15.03× | 18.92× | 1.34× |
| `jsonEscapeStrings` | `serialization-binary` | 5.62× | 6.55× | 1.17× |
| `stringCaseAsciiUnicode` | `string-builtins` | 24.31× | 26.73× | 1.06× |
| `stringNormalizeUnicode` | `string-builtins` | 32.87× | 32.94× | 1.03× |
| `mathTranscendental` | `math-builtins` | 1782.60× | 2083.70× | 1.02× |
| `mapSetBigIntKeys` | `collections-objects` | 20.53× | 16.88× | 0.80× |
| `objectDynamicOps` | `collections-objects` | 10.55× | 6.94× | 0.65× |
| `jsonRoundtrip` | `serialization-binary` | 17.50× | 9.77× | 0.56× |

## Deficits > 2.00× Slower Than Node (Perf-Queue Candidates)

| Suite | Mode | Category | Kernel | Node ms | Tint ms | Tint / Node |
| --- | --- | --- | --- | ---: | ---: | ---: |
| `language-untyped` | untyped | `math-builtins` | `mathTranscendental` | 0.04 | 91.90 | **2083.70×** |
| `language-typed` | typed | `math-builtins` | `mathTranscendental` | 0.05 | 89.95 | **1782.60×** |
| `language-untyped` | untyped | `serialization-binary` | `bigintTypedArrays` | 0.23 | 111.42 | **494.69×** |
| `language-typed` | typed | `serialization-binary` | `bigintTypedArrays` | 0.27 | 46.15 | **173.51×** |
| `language-untyped` | untyped | `classes-oop` | `classAccessorsInstanceof` | 0.45 | 46.43 | **104.20×** |
| `language-untyped` | untyped | `classes-oop` | `privateFieldsMethods` | 0.16 | 9.95 | **61.19×** |
| `language-untyped` | untyped | `control-flow-syntax` | `spreadArrayObjectCall` | 0.72 | 43.42 | **60.44×** |
| `language-untyped` | untyped | `control-flow-syntax` | `defaultRestParams` | 0.21 | 12.64 | **60.37×** |
| `language-untyped` | untyped | `serialization-binary` | `dataViewEndian` | 0.37 | 20.55 | **55.54×** |
| `language-untyped` | untyped | `control-flow-syntax` | `forOfCollections` | 0.94 | 50.03 | **53.50×** |
| `language-untyped` | untyped | `classes-oop` | `staticBlocksExpressions` | 0.20 | 9.56 | **47.49×** |
| `language-general` | general | `stdlib-builtins` | `regexpMatchExecReplace` | 0.23 | 9.63 | **42.44×** |
| `language-untyped` | untyped | `control-flow-syntax` | `destructuringPatterns` | 0.71 | 29.13 | **41.32×** |
| `language-untyped` | untyped | `classes-oop` | `deepInheritanceSuper` | 0.45 | 17.57 | **38.85×** |
| `language-untyped` | untyped | `string-builtins` | `stringNormalizeUnicode` | 0.34 | 11.06 | **32.94×** |
| `language-typed` | typed | `string-builtins` | `stringNormalizeUnicode` | 0.33 | 10.73 | **32.87×** |
| `language-untyped` | untyped | `collections-objects` | `mapSetDeleteRehash` | 1.72 | 51.94 | **30.23×** |
| `language-general` | general | `collections-objects` | `arrayHofsFull` | 0.71 | 20.68 | **28.97×** |
| `language-untyped` | untyped | `string-builtins` | `stringCaseAsciiUnicode` | 0.25 | 6.59 | **26.73×** |
| `language-async` | async | `async-promises` | `promiseAllBatch` | 0.30 | 7.86 | **26.53×** |
| `language-async` | async | `async-promises` | `promiseChains` | 0.16 | 4.07 | **25.86×** |
| `language-typed` | typed | `string-builtins` | `stringCaseAsciiUnicode` | 0.26 | 6.23 | **24.31×** |
| `language-untyped` | untyped | `math-builtins` | `mathHypotPowLog` | 0.23 | 5.44 | **23.35×** |
| `language-untyped` | untyped | `collections-objects` | `mapSetObjectKeys` | 0.99 | 21.67 | **21.89×** |
| `language-general` | general | `control-flow-syntax` | `generatorsYield` | 0.29 | 6.24 | **21.80×** |
| `language-untyped` | untyped | `serialization-binary` | `bigintParse` | 0.14 | 3.07 | **21.39×** |
| `language-typed` | typed | `collections-objects` | `mapSetBigIntKeys` | 1.18 | 24.17 | **20.53×** |
| `language-untyped` | untyped | `serialization-binary` | `float16Array` | 3.79 | 72.19 | **19.03×** |
| `language-untyped` | untyped | `serialization-binary` | `bigintArithmetic` | 0.35 | 6.65 | **18.92×** |
| `language-untyped` | untyped | `control-flow-syntax` | `nestedClosures` | 0.27 | 4.90 | **18.48×** |
| `language-typed` | typed | `serialization-binary` | `sharedArrayBufferViews` | 0.23 | 3.95 | **17.67×** |
| `language-typed` | typed | `serialization-binary` | `jsonRoundtrip` | 0.65 | 11.37 | **17.50×** |
| `language-untyped` | untyped | `collections-objects` | `mapSetBigIntKeys` | 1.14 | 19.22 | **16.88×** |
| `language-untyped` | untyped | `classes-oop` | `privateBrandChecks` | 0.77 | 12.64 | **16.37×** |
| `language-async` | async | `async-promises` | `asyncAwaitMicrotasks` | 0.13 | 1.97 | **16.07×** |
| `language-general` | general | `collections-objects` | `objectAssignFromEntries` | 0.14 | 2.19 | **16.03×** |
| `language-typed` | typed | `serialization-binary` | `dataViewEndian` | 0.38 | 5.92 | **15.49×** |
| `language-typed` | typed | `serialization-binary` | `bigintParse` | 0.14 | 2.16 | **15.38×** |
| `language-typed` | typed | `serialization-binary` | `bigintArithmetic` | 0.33 | 4.98 | **15.03×** |
| `language-untyped` | untyped | `control-flow-syntax` | `switchDenseSparseString` | 0.14 | 1.73 | **12.41×** |

## Full Kernel Table

| Suite | Mode | Category | Kernel | Node ms | Tint ms | Tint / Node |
| --- | --- | --- | --- | ---: | ---: | ---: |
| `language-typed` | typed | `serialization-binary` | `jsonRoundtrip` | 0.65 | 11.37 | 17.50× |
| `language-typed` | typed | `serialization-binary` | `jsonEscapeStrings` | 0.29 | 1.62 | 5.62× |
| `language-typed` | typed | `serialization-binary` | `dataViewEndian` | 0.38 | 5.92 | 15.49× |
| `language-typed` | typed | `serialization-binary` | `sharedArrayBufferViews` | 0.23 | 3.95 | 17.67× |
| `language-typed` | typed | `serialization-binary` | `bigintArithmetic` | 0.33 | 4.98 | 15.03× |
| `language-typed` | typed | `serialization-binary` | `bigintParse` | 0.14 | 2.16 | 15.38× |
| `language-typed` | typed | `serialization-binary` | `bigintTypedArrays` | 0.27 | 46.15 | 173.51× |
| `language-typed` | typed | `serialization-binary` | `float16Array` | 3.81 | 8.89 | 2.33× |
| `language-typed` | typed | `serialization-binary` | `atomicsOps` | 0.36 | 0.27 | 0.77× |
| `language-typed` | typed | `classes-oop` | `privateFieldsMethods` | 0.16 | 0.34 | 2.08× |
| `language-typed` | typed | `classes-oop` | `privateBrandChecks` | 0.78 | 0.55 | 0.71× |
| `language-typed` | typed | `classes-oop` | `staticBlocksExpressions` | 0.19 | 0.26 | 1.34× |
| `language-typed` | typed | `classes-oop` | `deepInheritanceSuper` | 0.46 | 0.33 | 0.71× |
| `language-typed` | typed | `classes-oop` | `classAccessorsInstanceof` | 0.42 | 0.26 | 0.61× |
| `language-typed` | typed | `math-builtins` | `mathTranscendental` | 0.05 | 89.95 | 1782.60× |
| `language-typed` | typed | `math-builtins` | `mathBitwiseRounding` | 0.24 | 0.33 | 1.37× |
| `language-typed` | typed | `math-builtins` | `mathHypotPowLog` | 0.24 | 1.03 | 4.37× |
| `language-typed` | typed | `string-builtins` | `stringReplaceAll` | 0.86 | 0.98 | 1.14× |
| `language-typed` | typed | `string-builtins` | `stringNormalizeUnicode` | 0.33 | 10.73 | 32.87× |
| `language-typed` | typed | `string-builtins` | `stringCaseAsciiUnicode` | 0.26 | 6.23 | 24.31× |
| `language-typed` | typed | `string-builtins` | `stringTrimPadSearch` | 0.78 | 0.71 | 0.92× |
| `language-typed` | typed | `control-flow-syntax` | `destructuringPatterns` | 0.68 | 0.17 | 0.25× |
| `language-typed` | typed | `control-flow-syntax` | `spreadArrayObjectCall` | 0.73 | 0.53 | 0.73× |
| `language-typed` | typed | `control-flow-syntax` | `switchDenseSparseString` | 0.14 | 0.06 | 0.44× |
| `language-typed` | typed | `control-flow-syntax` | `tryCatchNoThrow` | 0.14 | 0.06 | 0.43× |
| `language-typed` | typed | `control-flow-syntax` | `tryCatchThrowError` | 0.49 | 0.27 | 0.55× |
| `language-typed` | typed | `control-flow-syntax` | `optionalChainingNullish` | 0.12 | 0.04 | 0.31× |
| `language-typed` | typed | `control-flow-syntax` | `defaultRestParams` | 0.23 | 0.34 | 1.48× |
| `language-typed` | typed | `control-flow-syntax` | `nestedClosures` | 0.24 | 0.21 | 0.90× |
| `language-typed` | typed | `control-flow-syntax` | `forOfCollections` | 0.91 | 0.26 | 0.29× |
| `language-typed` | typed | `collections-objects` | `mapSetDeleteRehash` | 1.72 | 2.36 | 1.38× |
| `language-typed` | typed | `collections-objects` | `mapSetBigIntKeys` | 1.18 | 24.17 | 20.53× |
| `language-typed` | typed | `collections-objects` | `mapSetObjectKeys` | 0.93 | 6.30 | 6.80× |
| `language-typed` | typed | `collections-objects` | `objectDynamicOps` | 0.55 | 5.82 | 10.55× |
| `language-typed` | typed | `stdlib-builtins` | `errorConstruction` | 1.79 | 0.93 | 0.52× |
| `language-untyped` | untyped | `serialization-binary` | `jsonRoundtrip` | 0.66 | 6.40 | 9.77× |
| `language-untyped` | untyped | `serialization-binary` | `jsonEscapeStrings` | 0.29 | 1.89 | 6.55× |
| `language-untyped` | untyped | `serialization-binary` | `dataViewEndian` | 0.37 | 20.55 | 55.54× |
| `language-untyped` | untyped | `serialization-binary` | `bigintArithmetic` | 0.35 | 6.65 | 18.92× |
| `language-untyped` | untyped | `serialization-binary` | `bigintParse` | 0.14 | 3.07 | 21.39× |
| `language-untyped` | untyped | `serialization-binary` | `bigintTypedArrays` | 0.23 | 111.42 | 494.69× |
| `language-untyped` | untyped | `serialization-binary` | `float16Array` | 3.79 | 72.19 | 19.03× |
| `language-untyped` | untyped | `classes-oop` | `privateFieldsMethods` | 0.16 | 9.95 | 61.19× |
| `language-untyped` | untyped | `classes-oop` | `privateBrandChecks` | 0.77 | 12.64 | 16.37× |
| `language-untyped` | untyped | `classes-oop` | `staticBlocksExpressions` | 0.20 | 9.56 | 47.49× |
| `language-untyped` | untyped | `classes-oop` | `deepInheritanceSuper` | 0.45 | 17.57 | 38.85× |
| `language-untyped` | untyped | `classes-oop` | `classAccessorsInstanceof` | 0.45 | 46.43 | 104.20× |
| `language-untyped` | untyped | `math-builtins` | `mathTranscendental` | 0.04 | 91.90 | 2083.70× |
| `language-untyped` | untyped | `math-builtins` | `mathBitwiseRounding` | 0.23 | 2.57 | 11.33× |
| `language-untyped` | untyped | `math-builtins` | `mathHypotPowLog` | 0.23 | 5.44 | 23.35× |
| `language-untyped` | untyped | `string-builtins` | `stringReplaceAll` | 0.83 | 1.61 | 1.94× |
| `language-untyped` | untyped | `string-builtins` | `stringNormalizeUnicode` | 0.34 | 11.06 | 32.94× |
| `language-untyped` | untyped | `string-builtins` | `stringCaseAsciiUnicode` | 0.25 | 6.59 | 26.73× |
| `language-untyped` | untyped | `string-builtins` | `stringTrimPadSearch` | 0.79 | 4.04 | 5.15× |
| `language-untyped` | untyped | `control-flow-syntax` | `destructuringPatterns` | 0.71 | 29.13 | 41.32× |
| `language-untyped` | untyped | `control-flow-syntax` | `spreadArrayObjectCall` | 0.72 | 43.42 | 60.44× |
| `language-untyped` | untyped | `control-flow-syntax` | `switchDenseSparseString` | 0.14 | 1.73 | 12.41× |
| `language-untyped` | untyped | `control-flow-syntax` | `tryCatchNoThrow` | 0.14 | 0.60 | 4.20× |
| `language-untyped` | untyped | `control-flow-syntax` | `tryCatchThrowError` | 0.47 | 0.36 | 0.77× |
| `language-untyped` | untyped | `control-flow-syntax` | `optionalChainingNullish` | 0.12 | 0.35 | 2.90× |
| `language-untyped` | untyped | `control-flow-syntax` | `defaultRestParams` | 0.21 | 12.64 | 60.37× |
| `language-untyped` | untyped | `control-flow-syntax` | `nestedClosures` | 0.27 | 4.90 | 18.48× |
| `language-untyped` | untyped | `control-flow-syntax` | `forOfCollections` | 0.94 | 50.03 | 53.50× |
| `language-untyped` | untyped | `collections-objects` | `mapSetDeleteRehash` | 1.72 | 51.94 | 30.23× |
| `language-untyped` | untyped | `collections-objects` | `mapSetBigIntKeys` | 1.14 | 19.22 | 16.88× |
| `language-untyped` | untyped | `collections-objects` | `mapSetObjectKeys` | 0.99 | 21.67 | 21.89× |
| `language-untyped` | untyped | `collections-objects` | `objectDynamicOps` | 0.55 | 3.81 | 6.94× |
| `language-untyped` | untyped | `stdlib-builtins` | `errorConstruction` | 1.75 | 1.29 | 0.74× |
| `language-general` | general | `string-builtins` | `taggedTemplates` | 0.25 | 1.94 | 7.72× |
| `language-general` | general | `control-flow-syntax` | `generatorsYield` | 0.29 | 6.24 | 21.80× |
| `language-general` | general | `control-flow-syntax` | `customIterators` | 0.36 | 3.92 | 10.87× |
| `language-general` | general | `collections-objects` | `objectAssignFromEntries` | 0.14 | 2.19 | 16.03× |
| `language-general` | general | `collections-objects` | `arrayHofsFull` | 0.71 | 20.68 | 28.97× |
| `language-general` | general | `stdlib-builtins` | `regexpMatchExecReplace` | 0.23 | 9.63 | 42.44× |
| `language-general` | general | `stdlib-builtins` | `dateOperations` | 0.18 | 0.43 | 2.37× |
| `language-general` | general | `stdlib-builtins` | `symbolKeysRegistry` | 0.20 | 0.67 | 3.33× |
| `language-general` | general | `stdlib-builtins` | `proxyReflect` | 0.18 | 1.38 | 7.71× |
| `language-async` | async | `async-promises` | `promiseChains` | 0.16 | 4.07 | 25.86× |
| `language-async` | async | `async-promises` | `promiseAllBatch` | 0.30 | 7.86 | 26.53× |
| `language-async` | async | `async-promises` | `asyncAwaitMicrotasks` | 0.13 | 1.97 | 16.07× |
| `test262-canary` | canary | `test262-canary` | `expressions` | 0.57 | 1.27 | 2.23× |
| `test262-canary` | canary | `test262-canary` | `statements` | 0.05 | 0.32 | 6.46× |
| `test262-canary` | canary | `test262-canary` | `destructuring-classes` | 0.12 | 0.48 | 4.11× |
| `test262-canary` | canary | `test262-canary` | `arrays-binary` | 0.91 | 1.01 | 1.11× |
| `test262-canary` | canary | `test262-canary` | `numbers-math-date` | 0.10 | 0.18 | 1.78× |
| `test262-canary` | canary | `test262-canary` | `json-strings-regexp` | 0.53 | 0.88 | 1.66× |
| `test262-canary` | canary | `test262-canary` | `collections` | 0.26 | 0.51 | 1.95× |
| `test262-canary` | canary | `test262-canary` | `objects-proxy-symbol` | 0.48 | 0.95 | 2.00× |
