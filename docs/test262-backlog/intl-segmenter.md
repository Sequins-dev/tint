# INTL-SEGMENTER: Intl.Segmenter, Segments and segment iterators

Planning document captured 2026-11-04. It records planning facts and proposals,
not run evidence. No native Segmenter run exists, and every population below is
**unmeasured**. Labels: **[current]** verified in source or data on 2026-11-04;
**[proposal]** recommended design; **[assumption]** unvalidated premise to confirm
in the named slice; **[default]** conservative choice a decision may change.
Node probes are references only. Tolerant tests never prove conformance.

## Scope

In scope: `Intl.Segmenter` (constructor, `supportedLocalesOf`, `resolvedOptions`,
`segment`), Segments objects (`containing`, `[Symbol.iterator]`), Segment
Iterators (`next`, toStringTag), Segment Data objects (`isWordLike`), FindBoundary
for the `grapheme`, `word` and `sentence` granularities, locale negotiation, CLDR 49
segmentation tailorings, and the requirements for dictionary segmentation (slice B6,
gated).

Out of scope: line breaking (UAX #14; ECMA-402 rejects `granularity: "line"` and
never reads `lineBreakStyle`), the `-u-lb`/`-u-lw`/`-u-ss`/`-u-dx` keys
(Segmenter's `[[RelevantExtensionKeys]]` is empty), `Intl.supportedValuesOf`
(INTL-MISC), and the harness-only `wellKnownIntrinsicObjects.js` users (RT-EVAL).

## Pinned population

Revision `91c70759…5ba`, scanned read-only. **Owned: `intl402/Segmenter`, 79 files /
158 variants.** No file has `onlyStrict`, `noStrict`, `raw` or `module`, so each
file yields two variants. Includes: propertyHelper 20, compareArray 9, testIntl 2.
Two files use `cross-realm`. The [v67 inventory](../results/test262-native-group-inventory-v67.json)
records 0 outcomes, and the v9 journal has no Segmenter rows.

| Class                                                                                                                                              | Files | Needs                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | -------------------------------------- |
| S: property descriptors, `length`/`name`, toStringTag, brand checks, extensibility, `[Symbol.iterator]` name                                       |    30 | Object model only                      |
| O: option order, coercion and abrupt completion, `locales-*`, `supportedLocalesOf`, `resolvedOptions` order/caching, newTarget realms, subclassing |    34 | Options and locale data                |
| B: `containing/*` (8) and `segment/*` behaviour (iterables, nested/interleaved iteration, ToString)                                                |    15 | Boundaries, iterator state, isWordLike |

**Locales asserted.** `en-US` must resolve to itself (`type-without-lbs`). `sr`,
`fr`, `ar`, `de` and `zh` (via `zh-CN`) must be available; `sr-Thai-RS` must match
by prefix; `xyz` and `zxx` must be unavailable; `en-GB-oed` and `x-private` throw.

**Tolerance traps [current].** Boundary correctness is barely tested. The 16-script
corpora in `segment-*-iterable`, `iswordlike` and `word-iswordlike` check only that
segments rejoin to the input, indices are in range and `isWordLike` is a boolean
present only for `word`. Thai, Chinese and Japanese assertions therefore pass with
or without dictionaries. Exact boundaries are asserted only for ASCII (`a c`,
`a b c`, `ABCD`), Hangul jamo, emoji, surrogates, `ซิ่` and `台`.
`constructor/options-getoptionsobject.js` is **vacuous**: it calls
`new Intl.Segment(...)`, so any engine throws a TypeError before reaching
Segmenter. The spec does require that TypeError (ResolveOptions uses
GetOptionsObject), so B4 fixtures assert it directly. `locales-valid` and
`supportedLocalesOf/basic` accept any default locale. UCD test files (B1/B2) are
the conformance oracle for boundaries.

**Cross-cutting, not owned.** `harness/wellKnownIntrinsicObjects.js` names
`%Intl.Segmenter%`, `%IntlSegmentsPrototype%` and `%IntlSegmentIteratorPrototype%`
and is included by 9 tests (for example
`built-ins/Function/prototype/toString/built-in-function-object.js`). It evaluates
through `new Function`, so those tests belong to RT-EVAL and are never summed here.

## Authoritative sources

Fetched to `/tmp/tint-segmenter-plan` on 2026-11-04 (scripts in `probe/`, Node
probes in `node/`).

- **ECMA-402 draft 2026-10-23** §19: constructor (OrdinaryCreateFromConstructor
  before ResolveOptions; `granularity` after locale resolution), §19.2.3 (empty
  `[[RelevantExtensionKeys]]`), §19.3.3 `segment`, §19.5 Segments and `containing`
  (ToIntegerOrInfinity, `n < 0 or n ≥ length` → undefined), §19.6 iterator
  (`[[Prototype]]` `%Iterator.prototype%`, toStringTag `"Segmenter String
Iterator"`), §19.7.1 CreateSegmentDataObject (property order `segment`, `index`,
  `input`, `isWordLike`), §19.8.1 FindBoundary, §9.1 available-locale fallback
  constraint, §9.2.8 ResolveOptions (no special behaviours → **GetOptionsObject**),
  §9.2.9 FilterLocales (→ **CoerceOptionsToObject**).
- **UAX #29 revision 47 (Unicode 17.0.0)**, rules GB1–GB999, WB1–WB999,
  SB1–SB998. Revision 49 (Unicode 18.0.0, 2026-09-01) changes GB9c to
  `InCB=Linker InCB=Extend* × InCB=Consonant`.
- **UCD 17.0.0** (new pins, SHA-256): `auxiliary/GraphemeBreakProperty.txt`
  `d6b51d1d…ae89`, `WordBreakProperty.txt` `72274cac…9852`,
  `SentenceBreakProperty.txt` `871c0c98…0a18`, `GraphemeBreakTest.txt`
  `e2d134d2…93ec`, `WordBreakTest.txt` `1de23a75…19b2`, `SentenceBreakTest.txt`
  `12cb47d0…c6e4`, `LineBreak.txt` `e6a18fa9…92e6`. `DerivedCoreProperties.txt`
  (InCB) and `emoji/emoji-data.txt` hash-match the existing property-generator pins.
- **CLDR 49** `.tint-bootstrap/cldr-core-49.zip` (`78403d8d…6a89`, existing pin):
  `common/segments/root.xml` plus 13 locale files,
  `common/testData/segmentation/graphemeCluster/*` (218 Indic vectors) and
  `common/bcp47/segmentation.xml`.
- **ICU** (reference only, never linked or built): 78.1 is Unicode 17 and 79.1 is
  Unicode 18. `brkitr/root.txt` keys dictionaries by script (Hani, Hira, Kana →
  cjdict; Thai, Laoo, Khmr, Mymr). `ja.txt` tailors only line breaking and
  `el.txt` uses `sent_el`.

## Version coherence [current]

Tint's UCD tables are 17.0.0. CLDR 49 root GB/WB/SB rule text is structurally
identical to UAX #29 rev 47, including the **Unicode 17 form** of GB9c (rule 9.3).
So UCD 17 + rev 47 + CLDR 49 root is coherent. Unicode 18 drift (probe
`diff18.py`): GCB 37, WB 558, SB 12,864 and InCB 42 changed code points, all
previously unassigned; 18 ExtPict changes. Word and sentence test strings are
identical. Grapheme tests grow from 764 unique strings (766 lines) to 851, and
**4 shared strings break differently** (for example `094D ÷ 0915` becomes `094D ×
0915`). A 17/18 hybrid is therefore **unproved and rejected**. The CLDR 49
`properties/segments/GraphemeBreakTest.txt` is stale (`cldr-15.1.0`, 2023) and is
not used. The 218 CLDR Indic vectors agree with both versions after normalizing a
BOM and trailing `÷` format artifacts, so they do not discriminate.

**Required comparison tests (B1):** all UCD 17 test files pass; the 4
discriminating strings assert Unicode 17 results; and a generator assertion checks
that each CLDR root GB/WB/SB rule matches the rev 47 rule table. Any move to
Unicode 18 must update UCD tables, rules and these tests together.

## Current capabilities and gaps [current]

- **Missing:** no installer, realm prototypes, slots or `IntrinsicPrototype` entry,
  and no `Segmenter` identifier under `packages/*/src` or `tools`.
- **Unicode primitives:** `@tint/foundation/unicode/properties` (17.0.0) packs
  range sets (4 UTF-16 units per range) with `containsUnicodeRangeSet`. It already
  has `Extended_Pictographic` (156 ranges), `Regional_Indicator`, `Ideographic`,
  `Script=*`, `Grapheme_Extend` and `Emoji_Modifier`. It has **no**
  Grapheme_Cluster_Break, Word_Break, Sentence_Break, Indic_Conjunct_Break or
  Line_Break. Deriving those at run time from the existing sets would re-implement
  UAX #29 Tables 2–4, including exceptions, so B1 generates them from the auxiliary
  files and uses the existing tables only as equality cross-checks.
- **Locales:** `canonicalLocaleList`, `runtimeDefaultLocale = "en"`, and
  per-service prefix lookups (`lookupListFormatLocale` strips `-u-`, truncates
  prefixes and returns the base tag). The ListFormat registry (749 CLDR tags)
  contains `en-US`, `sr`, `zh`, `ja`, `th` and `el`, and lacks `zxx`.
- **Templates:** `intl-list-format.ts` for construction, `regexp-iterator.ts` and
  `iterator-intrinsics.ts` for iterator prototypes and `createIteratorResult`,
  `coercion.ts` `integerOrInfinity`, and `verify-test262-native-relative-time.ts`
  for native fixtures.

## Data measurements (read-only probes, not native evidence)

| Data (UCD 17)                                         | Measured                                                                    | Packed estimate |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | --------------- |
| Grapheme classes (GCB × InCB, Hangul LV/LVT computed) | 1,062 runs, 15 class tuples; LV/LVT arithmetic matches all 11,172 syllables | 6.4 KB          |
| Word classes (WB, 19 values)                          | 1,909 runs                                                                  | 11.5 KB         |
| Sentence classes (SB, 15 values)                      | 3,363 runs                                                                  | 20.2 KB         |
| Line_Break=SA (for isWordLike and B6)                 | 757 code points, 34 ranges                                                  | <0.3 KB         |

Runs are encoded as start (2 units) + class (1 unit): about **38 KB** of binary data,
or 80–115 KB of packed-escape source (an estimate). Folding the ExtPict and
word-like bits adds runs; that count is **unmeasured** until B1. Generated bytes,
compile time, image size, first-use cost and throughput are **unmeasured**.
Comparisons: `properties/data.ts` 601 KB, `normalization/data.ts` 294 KB.

## Dictionary requirements (honest determination)

UAX #29 states that Thai, Lao, Khmer and Myanmar (LB=SA) and ideographic text need
dictionary or other non-rule methods for word boundaries. Without them, WB999 breaks
SA text at each grapheme cluster and Han text at each ideograph. CLDR supplies
**no** dictionaries: every locale, `th` and `zh` included, inherits root rules.
ICU's are script-keyed and apply in every locale. Node (`en`) produces
`วัด|ไทร|ตี|ระฆัง` and `台北|抹黑`.

| ICU 78.1 dictionary |   Words | Text bytes | Trie nodes (4 B/node, unminimized) |
| ------------------- | ------: | ---------: | ---------------------------------: |
| thai                |  26,383 |    493,054 |                  72,022 (~0.29 MB) |
| lao                 |  30,550 |    673,894 |                  98,055 (~0.39 MB) |
| khmer               |  81,028 |  2,031,114 |                 284,288 (~1.14 MB) |
| burmese             |  41,120 |  1,164,408 |                 170,780 (~0.68 MB) |
| cj (with costs)     | 315,964 |  4,195,904 |                 441,461 (~1.77 MB) |

That totals about 4.3 MB unminimized, more than 100 times the rule tables. Equivalent output also
needs ICU's engines: DictionaryBreakEngine look-ahead for SA, and the CjkBreakEngine
cost search with katakana penalties plus the ICU word-rule deviations (`$ALetterPlus`,
Hangul/KanaKanji grouping, Han excluded from Extend). ICU 77.1 (Node 24.12) and 78.1
have byte-identical dictionaries and `word`/`sent`/`char` rules. Node is therefore a
valid differential oracle, but **only** for text whose properties are unchanged
between UCD 16 and 17: U+00B8 is a counterexample, splitting in Node but forming an
ALetter run in 17. Licences: ICU (Unicode-3.0), with cjdict notices for Google BSD,
IPADIC and TaBE, and a BSD laodict (Q1).

**Decision [default]:** B0–B5 ship UAX #29/CLDR root boundaries with no
dictionaries and no substitute heuristics. Docs and the Intl status must say SA and
CJ word boundaries are UAX #29 defaults, not dictionary segmentation. B6 is the
only route to dictionary output and must prove ICU equivalence on a filtered corpus
before any claim is made.

## Design

### 1. Modules and contracts [proposal]

**`@tint/foundation/unicode/segmentation`** is a new subpath export. It adds no
package or dependency edge (`@tint/js-runtime` already depends on foundation). It
is portable and locale-free, and works on strings and UTF-16 indices.

- `data.ts` (generated): packed class runs for grapheme, word and sentence, plus
  the SA ranges. The header records source hashes and the Unicode version.
- `classes.ts`: `graphemeClass(cp)`, `wordClass(cp)` and `sentenceClass(cp)`, each
  one binary search returning a class code with flag bits (InCB, ExtPict,
  word-like extra). Hangul LV/LVT are computed arithmetically.
- `grapheme.ts`, `word.ts`, `sentence.ts`: forward cursors that carry rule state
  (RI parity, the GB9c conjunct state, WB4 ignore spans, and the SB `ATerm Close*
Sp*` context) and memoize look-ahead (WB6/7/11/12 and SB8). They also expose
  internal reference predicates `isBoundaryAt(text, i)` for tests. Rules come from
  rev 47 and CLDR 49 root, numbered as in the spec.
- `index.ts` public contract:

```ts
export const segmentationUnicodeVersion = "17.0.0";
export type BoundaryGranularity = "grapheme" | "word" | "sentence";
export interface BoundaryProfile {
  readonly granularity: BoundaryGranularity;
  readonly extraSentenceTerminators: string; // packed ranges; "" for root
}
export interface BoundaryRun {
  /* opaque: text, profile, computed boundaries */
}
export function createBoundaryRun(
  text: string,
  profile: BoundaryProfile,
): BoundaryRun;
export function boundaryAfter(run: BoundaryRun, index: number): number; // least b > index
export function boundaryAtOrBefore(run: BoundaryRun, index: number): number; // greatest b ≤ index
export function isWordLikeSegment(
  text: string,
  start: number,
  end: number,
): boolean;
```

Callers must pass `0 ≤ index < text.length`; the engine throws an invariant string
otherwise. A `BoundaryRun` computes lazily from 0 and caches sorted boundaries
(binary search). This is unobservable, because text and profile are immutable.

**`packages/js-runtime/src/objects/`** (same package):

- `segmenter-data.ts` (generated): rows of `tag|profile` and the profile table.
- `segmenter.ts`: `lookupSegmenterLocale(tag)`, `segmenterProfile(locale,
granularity)`, `availableSegmenterLocales()`.
- `intl-segmenter.ts`: `installSegmenterIntrinsic(intl, realm, hooks)`, plus
  `requireSegmenter`, `requireSegments` and `requireSegmentIterator`.
- Realm wiring: `errors.ts` gets `segmenterPrototype` and `segmentsPrototype`
  (both `objectPrototype`) and `segmentIteratorPrototype` (`iteratorPrototype`).
  `functions.ts` gets `"intl-segmenter"`. `operations.ts` gets the three own slots
  `internalSegmenterData {locale, granularity, profile}`,
  `internalSegmentsData {segmenter, run}` and
  `internalSegmentIteratorData {segmenter, run, next}`. `intl.ts` installs them.
- Cleanup: move the duplicated `stringOption`/`localeMatcher` helpers into
  `options.ts` and use them from Segmenter and ListFormat (rerun ListFormat).

**Tools (Node only):** `tools/generate-unicode-segmentation.ts <ucd17-dir>` and
`tools/generate-segmenter-data.ts <cldr-zip>`, each writing a manifest of input and
output hashes (`docs/intl-runtime.md` convention), and
`tools/verify-unicode-segmentation.ts <ucd17-dir>` for full UCD test runs.

### 2. isWordLike [proposal]

A word segment is word-like when it contains at least one code point in
WB ∈ {ALetter, Hebrew_Letter, Numeric, Katakana}, Ideographic, Script=Hiragana, or
LB=SA without WB=Extend. ExtendNumLet, punctuation, spaces, emoji, RI and lone
marks are not word-like (`_` false, `a_` true). This mirrors ICU's rule statuses
100/200/400 for the ECMA-402 note. It matched Node on 24 probe strings (`wl.mjs`),
apart from the expected U+00B8 version skew. **[assumption] (B2):** parity on the
Test262 corpora and a Node differential corpus filtered to code points unchanged
since UCD 16, with mismatches recorded rather than tuned away.

### 3. Locales and tailorings [proposal]

- **`[[AvailableLocales]]` [default]:** every CLDR 49 `common/main` locale except
  `root` and `en_US_POSIX`, which is 927 by file count. The generator asserts the
  final count, the §9.1 fallback closure, `en` and `en-US` present, and `zxx`
  absent. All inherit root, which is CLDR's documented data. `th`, `lo`, `km`, `my`,
  `zh` and `ja` are included because CLDR has no locale-keyed dictionary data. The
  limitation in the Dictionary section is script-wide and is documented, not hidden
  by excluding locales.
- **Lookup:** prefix lookup for both `lookup` and `best fit` (as other services do).
  The resolved locale is the matched available tag with no extensions; `-u-ss`,
  `-u-lb` and the rest are dropped.
- **Tailorings** (generator rejects anything it cannot express, naming the file):
  `el` sentence adds `;` (U+003B) and U+037E to STerm (ICU applies `sent_el` too).
  The 7 suppression files (de, en, es, fr, it, pt, ru) apply only with `-u-ss-standard`,
  which Segmenter cannot select, so they are recorded and unused. `ja` word rules
  13.3/13.4 reference an **undefined `$FE`** and ICU does not use them, so they are
  excluded [default] (Q2). `en_US_POSIX` word needs `-u-va-posix`, which is not
  selectable. `zh`, `zh_Hant` and `ja` LineBreak are out of scope.

### 4. Observable order and abrupt completion [proposal]

1. **Constructor:** a call without NewTarget throws a TypeError.
   `constructorPrototype(newTarget, "intl-segmenter")` runs first (a poisoned
   `prototype` getter throws before locales are read).
2. CanonicalizeLocaleList.
3. GetOptionsObject: `undefined` becomes a null-prototype object, objects pass
   through, and every primitive (including `null`, booleans, strings, numbers,
   Symbol and BigInt) throws a TypeError.
4. Read `localeMatcher`: Get, then ToString, then validate (RangeError).
5. ResolveLocale.
6. Read `granularity`: Get, then ToString, then validate against
   `grapheme|word|sentence` (`"line"` is a RangeError); `undefined` means
   `grapheme`. `lineBreakStyle` is never read.
7. **`supportedLocalesOf`:** CanonicalizeLocaleList, then CoerceOptionsToObject
   (primitives wrapped, `null` a TypeError), then `localeMatcher`, then filter.
   The result is a fresh Array in the method's realm.
8. **`resolvedOptions`:** brand check, then a fresh `%Object.prototype%` object
   with `locale` and `granularity` only.
9. **`segment(string)`:** brand check **before** ToString (a throwing `toString`
   on a non-Segmenter receiver is never called), then a Segments object with the
   method realm's `%IntlSegmentsPrototype%`.
10. **`containing(index)`:** brand check, then ToIntegerOrInfinity (Symbol and
    BigInt throw a TypeError; `-0`, NaN and fractions truncate). `n < 0` or
    `n ≥ length` returns `undefined`. Otherwise it creates the data object.
11. **`[Symbol.iterator]`** (name `"[Symbol.iterator]"`, length 0): brand check, then
    a new iterator at index 0 that shares the Segments `BoundaryRun`.
12. **`next`** (length 0): brand check through the own slot (proxies,
    `Object.create(iterator)` and the prototype fail). At `next ≥ length` it
    returns `{value: undefined, done: true}` on every call. Otherwise it advances
    to `boundaryAfter`. No user code runs inside, so it has no executing flag.

Lengths: constructor 0 (name `Segmenter`), `supportedLocalesOf` 1, `segment` 1,
`containing` 1, `resolvedOptions` 0. `%IntlSegmentsPrototype%` has **no**
toStringTag. Results (iterator results, data objects, arrays) use the realm of the
running built-in, not the segmenter's realm.

### 5. UTF-16 index edge cases [proposal]

Boundaries fall only between code points, never inside a well-formed surrogate
pair. A lone surrogate is its own code point with default classes (GCB, WB and SB
`Other`; Cs is not Control in UCD 17). `containing` on the trailing unit of a pair
returns the segment that starts at the lead unit. Expected results:

- `"\udc00\ud800"` is two graphemes.
- `" \ud800"` breaks at index 1 for `grapheme` and `word`.
- `""` gives `containing(0) === undefined` and an iterator that is done at once.
- `index` is a Number code-unit offset, and `segment` is
  `input.slice(index, end)`.
- CR LF never splits.
- Text that starts with `́` keeps the mark as its own segment (WB4 does not
  apply after sot).

## Semantic test cases (unit tests and native fixtures)

1. **UCD 17 test files**, run in full by the verify tool, with a committed
   deterministic sample in unit tests (every 10th line plus every line with
   surrogates, RI, ZWJ, InCB or SB8). Grapheme has 766 lines, word 1,944 and
   sentence 512. Also the 218 CLDR Indic vectors (normalized) and the 4
   Unicode-18-discriminating strings, which must give Unicode 17 results.
2. **Differential checks:** the forward cursor equals the reference predicate on
   seeded random strings drawn from every class, lone surrogates included. An
   adversarial 10⁵-unit case each for RI runs, `a. ` plus digits (SB8 look-ahead)
   and ExFm runs must finish within a recorded budget (performance unmeasured).
3. **Option order and abrupt completion:** each getter and `toString` throws in
   turn and later reads stop. A poisoned `prototype` getter beats a throwing
   locales getter. `["en-GB-oed"]` with `null` options gives a RangeError (locales
   are processed first). GetOptionsObject rejects `true`, `"x"`, `7`, Symbol and
   `1n`.
4. **Brand-before-coercion:** `segment`, `containing` and `next` are called with
   bad receivers and side-effecting arguments, and the side effects never run.
5. **Iteration:** nested and interleaved iterators, `containing` inside a loop, a
   done iterator that stays done, and iterators that are independent of the
   Segments object.
6. **Realms:** a foreign segmenter or Segments used with local methods yields local
   prototypes; a foreign newTarget with a non-object `prototype` falls back to the
   foreign `%Intl.Segmenter.prototype%`.
7. **Locales:** `en-US`, `sr-Thai-RS` → `sr`, `zh-CN` → `zh`, `zxx` unsupported,
   `en-u-ss-standard` resolves to `en` with no suppression (`Mr. ` breaks), and
   `el` sentence breaks after `;`.
8. **Exact boundaries:** `can't`, `3.14`, `e.g.`, `a_b`, Hebrew gershayim, Katakana
   runs, emoji ZWJ and modifier sequences, flags (odd and even RI), Devanagari
   conjuncts, Hangul jamo, U+00B8 (Unicode 17 ALetter), and SA/CJ text documented
   as UAX #29 default boundaries.

## Representation and native-subset constraints

Use packed strings read with `charCodeAt` and binary search, as `properties/data.ts`
does, with no large array or object literal initializers. Tables decode lazily.
There is no Node, ICU, host Intl, RegExp or C in the runtime path, and the same
modules serve live and AOT execution. The engine sees only strings and numbers, and
no Script objects cross the foundation boundary.

## Implementation slices

Each slice ends with a fail-fast `pnpm check`. New sources and exports require
`node tools/generate-compiler-catalog.ts`, formatting, and the foundation
`package.json` export. Native work uses the shared AOT pipeline under LLDB, one
serial inferior at a time, with `TINT_BUILD_ONLY=1` for hosted fixtures, and asserts
the stopped-at-entry and final exit states. Each unchanged selection becomes a new
immutable report. **Run native selections only when the parent's native queue and
journals are idle, and never edit queues, journals or frozen snapshots.**

- **B0 Red baseline.** One unchanged native selection of `intl402/Segmenter` (158)
  as a new report, expected all non-passing (no installer).
- **B1 Foundation grapheme engine and data.** `generate-unicode-segmentation.ts`
  (all three tables plus SA; the asserts from Version coherence; ExtPict, RI,
  Ideographic and Hiragana equality against the existing 17.0.0 property tables;
  Hangul arithmetic), `data.ts`, `classes.ts`, `grapheme.ts`, `index.ts` and
  `verify-unicode-segmentation.ts`. Tests: §Semantic tests case 1 (grapheme) and
  case 2. `properties/data.ts` and `normalization/data.ts` must stay byte-identical.
  Hosted foundation fixture (extend `build-foundation-unicode-fixture.ts`).
  **Record the generated bytes, compile-time delta and image-size delta.**
- **B2 Word, sentence and isWordLike.** `word.ts`, `sentence.ts` and
  `isWordLikeSegment`, the `extraSentenceTerminators` profile input, and the full
  word and sentence UCD runs. Also the isWordLike assumption (Design §2) and its
  differential corpus, plus the native foundation fixture.
- **B3 Locale data and runtime core.** `generate-segmenter-data.ts` (locale set,
  `el` profile, the recorded exclusions for suppressions, `ja` and POSIX, and
  `segmenter-data-manifest.json`) and `segmenter.ts`. Unit tests cover lookup, the
  §9.1 closure and profiles. No public surface yet.
- **B4 Intl.Segmenter surface.** `intl-segmenter.ts`, realm/slot wiring, the
  `options.ts` helper extraction, and `tools/verify-test262-native-segmenter.ts`
  (native fixtures for semantic test cases 3–8 and the vacuous GetOptionsObject
  case). Unchanged reruns: `intl402/Segmenter` (158), plus regression selections
  `intl402/ListFormat` (162), `intl402/RelativeTimeFormat` (160) and
  `intl402/PluralRules` (106), because `intl.ts`, `options.ts` and the realm records
  change. Expected movement: classes S, O and B. Remaining failures are retained
  and investigated against the spec, never tolerated.
- **B5 Consolidated rerun and self-build.** One complete unchanged rerun of all four
  selections, `docs/intl-runtime.md` and dashboard updates (complete reruns only),
  and the documented SA/CJ limitation. The frozen-source native self-build,
  stage-image comparison, and post-build native/JIT verification are **owned by the
  parent**. This slice records their report links before claiming completion.
- **B6 Dictionary segmentation (gated on Q1; not needed for Test262).** Port ICU
  78.1's DictionaryBreakEngine family, CjkBreakEngine and word-rule dictionary
  deviations into `foundation/unicode/segmentation/dictionary/`, using generated
  DAFSA/trie data from the pinned ICU 78.1 dictionaries (hashes `3166abde…`,
  `3c876934…`, `87bee2d1…`, `61d8abc3…`, `e73fd720…`). Prerequisites: licence
  approval, a measured size and compile budget, and a differential corpus with 100%
  agreement against Node's ICU 77.1 on filtered text. Without all three, nothing is
  described as ICU-equivalent and SA/CJ stay at UAX #29 defaults.

## Open questions and decisions

- **Q1 (owner decision):** whether to accept ICU dictionaries and engine ports
  (about 4.3 MB unminimized, plus third-party notices). Default: defer, which keeps
  B0–B5 complete and honest.
- **Q2:** the CLDR 49 `ja.xml` undefined `$FE`. Default: exclude and record. Revisit
  only with upstream clarification.
- **Q3:** the boundary-cache memory policy for very long strings (an `O(n)` number
  array per run). Default: keep the cache and measure in B4. Bounding it needs a
  safe-restart proof for each rule family.
- **Q4:** a Unicode 18 migration is a workspace-wide decision (properties,
  normalization, casing and segmentation together), never Segmenter-only.

## Next broad feature (not planned here)

**INTL-DISPLAYNAMES** is the last Intl constructor without a plan (114 variants,
CLDR pipeline). It is independent of RT-EVAL and reuses the CLDR 49 generator
conventions. HOST-AGENT is broader but still waits on RT-EVAL open question 3.
