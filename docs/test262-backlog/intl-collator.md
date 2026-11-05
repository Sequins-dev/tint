# INTL-COLLATOR: Intl.Collator and String.prototype.localeCompare

Planning document captured 2026-11-04. It records planning facts and proposals,
not run evidence. No native Collator run exists; every population below is
**unmeasured**. Labels: **[current]** verified in source or data on 2026-11-04;
**[proposal]** recommended design; **[assumption]** unvalidated premise to confirm
in the named slice; **[default]** conservative choice a decision may change. Node
probes are references only. Test tolerance never proves conformance.

## Scope

In scope: `Intl.Collator` (constructor, `supportedLocalesOf`, `resolvedOptions`,
the `compare` getter and its bound function), CompareStrings, ECMA-402
`String.prototype.localeCompare`, Collator locale negotiation (`co`, `kf`, `kn`),
`usage`, `sensitivity`, `numeric`, `caseFirst` and `ignorePunctuation`, canonical
equivalence, ill-formed UTF-16, the CLDR root collation and CLDR 49 tailorings.
The plan also re-points `Intl.Locale.prototype.getCollations` to Collator data,
which the spec requires.

Out of scope: `supportedValuesOf("collation")`, which belongs to INTL-MISC (K4
provides `availableCollations()` for it), plus `toLocaleLowerCase` and
`toLocaleUpperCase`, sort keys, `Intl.Segmenter` and collation-based search APIs.

## Pinned population

Revision `91c70759…5ba`, scanned read-only with the repository variant policy
(`tools/test262.ts`; scanner `/tmp/tint-collator-plan/probe/scan.mjs`). No owned
file has `onlyStrict`, `noStrict`, `raw` or `module`, so every file yields two
variants.

**Directly owned: 88 files / 176 variants** (three disjoint directories):

| Directory                                  | Files | Variants | Includes / features                                                                                                       |
| ------------------------------------------ | ----: | -------: | ------------------------------------------------------------------------------------------------------------------------- |
| `intl402/Collator`                         |    65 |      130 | propertyHelper 18, testIntl 12, compareArray 8, isConstructor 4; Reflect.construct 4, Symbol.toStringTag 4, cross-realm 1 |
| `intl402/String/prototype/localeCompare`   |    10 |       20 | testIntl 1, compareArray 1, propertyHelper 1, isConstructor 1                                                             |
| `built-ins/String/prototype/localeCompare` |    13 |       26 | propertyHelper 2, isConstructor 1                                                                                         |

The README previously counted 19 `intl402/String` files. Nine of those test
`toLocaleLowerCase`/`toLocaleUpperCase` and are not owned here.

**What the 65 Collator files exercise** (classification by body reading):

| Class                                                                                                                 | Files | Needs                                                |
| --------------------------------------------------------------------------------------------------------------------- | ----: | ---------------------------------------------------- |
| S: property surface, brand checks, toStringTag, realms, subclass construction, `supportedLocalesOf` shape and taint   |    36 | Constructor and methods, no ordering semantics       |
| O: option reading order, `testOption`, extension keys, `resolvedOptions` values and order, `supportedLocalesOf/basic` |    20 | Locale data (`co`/`kf`/`kn`, th `ignorePunctuation`) |
| C: ordering (`compare/*` 6, `usage-de`, `ignore-invalid-unicode-ext-values`, `subclassing`)                           |     9 | Root and tailored UCA                                |

The localeCompare files cover the surface (6), coercion and abrupt ordering (5),
Collator equivalence and taint (4), canonical equivalence
(`15.5.4.9_CE.js`, 25 pairs) and antisymmetry (`S15.5.4.9_A1_T2`).

**Locales asserted:** `en`, `de`, `de-u-co-phonebk`, `es`, `fr`, `it`, `sv`, `ja`,
`th` (default `ignorePunctuation: true`), `tlh`/`id` (fallback), `zxx` (must be
unsupported). Collations asserted: `phonebk` and `eor` for `de`, while
`en-u-co-phonebk` resolves to `default`.

**Conditional tests (tolerance traps).** `non-normative-phonebook` asserts only if
the resolved locale is `de-u-co-phonebk`. `non-normative-basic` and
`-sensitivity` filter through `supportedLocalesOf`. The `numeric`/`caseFirst`
files skip when the property is absent, and `collations-supported-by-collator`
skips unsupported locales. An implementation that drops `phonebk`, `kf` or locales
would pass them vacuously. Every slice below asserts the ordering directly in its
own fixtures.

**Cross-cutting, not owned** (overlaps other rows, never summed):
`intl402/Locale/prototype/getCollations/collations-supported-by-collator.js`
(1 file / 2 variants; the two failures in the
[getCollations report](../results/test262-locale-collations-native-v1.json),
24/26); `intl402/Intl/supportedValuesOf/collations*.js` (2 files / 4 variants,
INTL-MISC). Also 22 direct `intl402/*.js` files that use
`testWithIntlConstructors` (Collator, NumberFormat and DateTimeFormat, so they
also need INTL-DTF), the `this-value-ignored` files for NumberFormat and
DateTimeFormat, `built-ins/Object/getOwnPropertyDescriptor/15.2.3.3-4-81.js`, and
three `staging/sm` files. `harness/wellKnownIntrinsicObjects.js` names
`%Intl.Collator%`.

## Authoritative sources

All were fetched or extracted on 2026-11-04 to `/tmp/tint-collator-plan`.

- **ECMA-402 draft 2026-10-23** (<https://tc39.es/ecma402/>): §10.1.1 constructor
  (getter order: `usage` before ResolveOptions), §10.2.2–3 (`[[RelevantExtensionKeys]]`
  must include `co` and may include `kf`/`kn`; `standard`/`search` are banned in `co`
  lists; `[[SortLocaleData]]`/`[[SearchLocaleData]]` constraints), §10.3.2 Table 3,
  §10.3.3 bound compare and §10.3.3.1 CompareStrings (canonical equivalents return
  +0, the comparator must be consistent and total, and a surrogate pair is one code
  point), §20.1.1 `localeCompare` (`Construct(%Intl.Collator%)`), §9.2.3
  LookupMatchingLocaleByPrefix, §9.2.7 ResolveLocale, §9.2.8 ResolveOptions,
  §15.5.10 CollationsOfLocale, and AvailableCanonicalCollations.
- **UTS #10 18.0.0, revision 55**: the main algorithm, discontiguous contractions,
  implicit weights, and §10.1.1 on ill-formed code units.
- **UTS #35 Part 5 (CLDR 49)**: root collation, the rule syntax, settings, `[import]`,
  `[reorder]`, `[suppressContractions]`, radical-stroke Han order (CLDR 26+ `unihan`
  tailorings assume it), and the `numericOrdering` and `caseFirst` semantics.
- **CLDR 49** `.tint-bootstrap/cldr-core-49.zip` (SHA-256 `78403d8d…6a89`, the
  existing pin). `common/collation/*.xml` (135 files, already hash-pinned in
  `tools/locale-collation-inputs.json`) and `common/uca/`: `FractionalUCA.txt`
  `90549e48…9f4f`, `allkeys_CLDR.txt` `cd5bc104…d39d`,
  `CollationTest_CLDR_NON_IGNORABLE.txt` `950b89cb…616e`,
  `CollationTest_CLDR_SHIFTED.txt` `e0d088ef…65d7`. All declare **UCA/UCD 18.0.0**.

## Current capabilities and gaps (all [current])

- **Missing:** no Collator installer, realm prototype or slot, and no
  `String.prototype.localeCompare`. `primitive-intrinsics.ts` has no
  `localeCompare` entry, so the 13 built-ins files cannot pass. There is no
  collation data or engine.
- **Locale:** `canonicalLocaleList`, the canonicalization tables, `parseLocaleId`
  and a per-service lookup. `localeTypeAliases` has no `u:co` rows; the
  `phonebook`→`phonebk` aliases from `bcp47/collation.xml` are used only inside the
  catalog generator. K3 checks how `-u-co-phonebook` canonicalizes.
  Each constructor has its own ad hoc `resolveLocale`. No shared ResolveLocale
  handles several relevant keys, and only NumberFormat handles one key (`nu`).
- **Collation catalog:** `generate-locale-data.ts` already resolves CLDR
  collation-type inheritance into `localeCollationPreferences` (140 rows: `emoji`
  and `eor` everywhere, plus `compat`, `trad` 7, `phonebk` 2, `unihan` 9,
  `pinyin`/`stroke`/`zhuyin` 7, `searchjl`, `phonetic`, `dict`). `localeCollations`
  in `locale-info.ts` returns that table and falls back to `["emoji","eor"]`. The
  spec derives CollationsOfLocale from `%Intl.Collator%` data, so this must become
  one source of truth (K4).
- **Unicode:** foundation `normalizeUnicode` (NFC/NFD/NFKC/NFKD, **Unicode
  17.0.0**), plus properties, casing and identifiers, all at 17.0.0. The pinned
  Test262 property-escape tests are also Unicode 17.0.0. The packed-UTF-16 string
  table convention is used by `normalization/data.ts` (294 KB of source).
- **Templates:** `intl-relative-time-format.ts` and `intl-plural-rules.ts` for
  construction (`constructorPrototype`, internal slot, `requireFormatter`),
  `intl-legacy.ts` (Collator is _not_ legacy-chained), and
  `verify-test262-native-relative-time.ts` for native fixtures.

## Data measurements (read-only probes, not native evidence)

Counts come from the pinned archive (`probe/frac.py`, `probe/runs.py`). Byte
figures are arithmetic estimates from those counts. Generated sizes, compile time,
image size, first-use cost and compare throughput are **unmeasured**.

| Data                                                 | Measured counts                                                                                                                       | Packed estimate      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Root mappings (FractionalUCA, NFD-stable keys only)  | 57,637 single code points in 890 runs; 1,386 expansions; 977 contractions/prefixes; 5,362 CEs in those; 340 distinct (sec, ter) pairs | ~285 KB              |
| Root boundaries                                      | 256 `top_byte` groups, 178 `FDD1` script-first entries, `[first/last …]` anchors, `[Unified_Ideograph]` ranges                        | <8 KB                |
| Han radical-stroke order (`[radical]` lines)         | 215 lines, 135 KB of text, 24,005 range items, 101,997 Han                                                                            | ~100–145 KB          |
| Non-Han CLDR tailorings (rule text without comments) | 147 collations, 184 KB; largest are `ko` standard 35 KB, `ja` standard 19 KB, `my` 16 KB and `sa`/`kn`/`bn` traditional 14 KB         | ≤150 KB (unmeasured) |
| `zh` family (default, non-`alt` forms)               | pinyin 45,338 items / 44,767 runs; stroke 103,230 / 25,784; zhuyin 42,089 / 41,508                                                    | ~130 + 130 + 125 KB  |
| `allkeys_CLDR.txt` (for cross-checking)              | 39,493 single and 974 contraction rows; 29,809 distinct primaries                                                                     | not shipped          |

The total binary estimate is about 0.8–1.0 MB. Packed-UTF-16 sources with escapes
run 2–3× larger. For comparison, the existing `relative-time-data.ts` is 498 KB.

**Version skew [current].** CLDR 49 root data is UCA 18.0.0, while Tint's
UCD tables are 17.0.0. 708 `allkeys_CLDR` code points are unassigned in UCD 17.
Unicode 18 (`UnicodeData.txt` `0736451d…8950`) adds 768 characters, with no new
canonical decompositions but **34 new non-zero combining classes** (for example
U+05C8, U+1ADE). 3,965 of the 210,186 CollationTest lines contain code points that
are unassigned in UCD 17. See Q1.

## Design

### 1. Modules and contracts [proposal]

- **`@tint/foundation/unicode/collation`** (new subpath export; no new package or
  dependency edge). This is the portable, locale-independent UCA engine.
  - `root-data.ts` and `han-order-data.ts` (generated): packed root mappings,
    expansion/contraction pools, script-group ranges, radical-stroke ranges,
    Nd-digit ranges and boundary weights.
  - `elements.ts`: a CE iterator over NFD code points. It handles longest-match
    contractions, discontiguous contractions (UTS #10 S2.1.1–S2.1.3), prefixes,
    expansions, implicit weights (radical-stroke Han, other ideographs and
    unassigned code points), lone surrogates (Q3) and numeric digit runs.
  - `compare.ts`: level-wise comparison with strength 1–3, `caseLevel`,
    `caseFirst`, `alternate=shifted` with `maxVariable=punct`, backwards
    secondaries, and primary reordering through range tables.
  - `index.ts` public contract: `rootCollation(): CollationTable`,
    `tailorCollation(root, packed: PackedTailoring): CollationTable`,
    `compareCollated(table, settings: CollationSettings, a: string, b: string):
-1 | 0 | 1`. `CollationSettings` is
    `{strength: 1|2|3, caseLevel, caseFirst: "off"|"upper"|"lower", shifted,
backwardSecondary, numeric}`. The engine never sees locales or Script values.
- **`packages/js-runtime/src/objects/`** (same package, no manifest edges):
  - `collation-data.ts` (generated): per-locale rows and `PackedTailoring`
    records, keyed by tag and collation type.
  - `collation-locale.ts`: `collatorAvailableLocales`, `collatorLocaleData(locale,
usage)` returning the spec's `co`/`kf`/`kn`/`sensitivity`/`ignorePunctuation`
    lists, `availableCollations()`, and a `collationTable(locale, type, usage)`
    cache that builds lazily on first use.
  - `intl-collator.ts`: `installCollatorIntrinsic`, an exported
    `createCollator(locales, options, realm, hooks)` used by both construction and
    `localeCompare`, `requireCollator`, `resolvedOptions` and the `compare` getter.
  - `primitive-intrinsics.ts`: `localeCompare` (length 1). It calls
    `createCollator` and never looks up the global `Intl.Collator`.
  - `locale-info.ts`: `localeCollations` delegates to `collation-locale.ts`, and
    the `localeCollationPreferences` table is retired from `generate-locale-data.ts`.
- **Tools (Node only):** `tools/collation-rules.ts` (LDML rule parser and minimal
  UnicodeSet parser), `tools/collation-builder.ts` (tailoring builder over
  fractional root weights), `tools/generate-unicode-collation.ts` (root) and
  `tools/generate-collation-data.ts` (CLDR tailorings and locale rows). Each tool
  writes a manifest of input hashes and output hash, following
  `docs/intl-runtime.md`.

### 2. Weights and tailoring builder [proposal]

- **Root representation.** Each CE is a primary (≤4 fractional bytes as an
  unsigned 32-bit integer, strictly below 2³²; these are exact in a `number`), a 16-bit
  secondary, and a tertiary with case bits. Weights come verbatim from
  `FractionalUCA.txt`. `allkeys_CLDR.txt` is used only to assert the same relative
  order for every shared key.
- **Always NFD.** CompareStrings requires canonical equivalence. Tint therefore
  normalizes both inputs to NFD and **omits canonical-closure entries**. Prefix and
  contraction matching runs on NFD text, so `[normalization on]` has no separate
  effect. Hangul syllables decompose to jamo.
- **Build-time tailoring.** The builder resolves `[import]` chains (including
  `private-*` and `und-u-co-search`), resets (`&`, `[before n]`, `[first …]`,
  `[last …]`), relations `<`/`<<`/`<<<`/`=`, the starred lists `<*`, expansions
  (`/`), prefixes (`|`), quoting and `\u` escapes. It allocates new weights in the
  gaps between neighbouring root or tailored weights, following ICU's
  CollationWeights strategy and UTS #35 (Part 5). It applies
  `[suppressContractions]`, records `[reorder]` as primary range permutations, and
  records the settings `[caseFirst]`, `[alternate shifted]`, `[backwards 2]`,
  `[strength]` and `[caseLevel]` as data. `[optimize]` is a no-op. The output is a
  `PackedTailoring` that holds overriding mappings, reorder ranges and settings.
  The builder rejects any rule or syntax it does not implement, naming the locale
  and type; it never drops rules silently.
- **[assumption] (K2):** every CLDR 49 tailoring fits in 4-byte primaries using gap
  allocation. The builder asserts this. If the assertion fails, widen the primary
  to 48 bits (still exact in a `number`); do not prune rules.
- **Han.** The root uses radical-stroke order (Q2) through `han-order-data.ts`.
  `unihan` tailorings import `private-unihan`. The `zh` pinyin, stroke and zhuyin
  tailorings are ordered code-point lists, delta-coded and assigned consecutive
  gap weights after their reset.

### 3. Settings mapping [proposal]

| ECMA-402                            | Engine setting                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| sensitivity `base`                  | strength 1                                                                              |
| `accent`                            | strength 2                                                                              |
| `case`                              | strength 1 + `caseLevel`                                                                |
| `variant`                           | strength 3; no quaternary or identical level (Q5)                                       |
| `ignorePunctuation: true`           | `shifted` with `maxVariable=punct` (space and punctuation only), ignored at strength ≤3 |
| `numeric: true`                     | UTS #35 numeric ordering for Nd runs (value-ordered primaries, leading zeros ignored)   |
| `caseFirst` `upper`/`lower`/`false` | case bits on tertiary and case level; `false` keeps the tailoring default               |

Locale defaults come from data, never constants. `th` has `[alternate shifted]`,
so its default `ignorePunctuation` is `true`. `da` and `mt` have
`[caseFirst upper]`, so their default `kf` is `upper`. `fr-CA` has backwards
secondaries.

### 4. Locales, collation types and usage [proposal]

- **`[[AvailableLocales]]` [default].** This is the 134 CLDR collation-file
  locales (empty files mean the root is valid for that locale, for example `en`)
  together with the NumberFormat registry tags. Those tags inherit through CLDR
  `parentLocales component="collations"` and then root, which is CLDR's
  documented fallback. `zxx` is excluded. `zh`, `yue`, `zh-Hant` and their
  descendants join only in K5. Until then they are **absent and unsupported**,
  never approximated by the root. `ja` and `ko` (kana, Hangul and Hanja rules, no
  pinyin-scale data) join in K3.
- **`[[SortLocaleData]][loc]`.** `co` is `[null, …types]`, with types sorted and
  `standard`, `search` and `private-*` excluded. `kn` is `["false","true"]`. `kf`
  is the tailoring default first, then the other two values.
  `ignorePunctuation` comes from the standard tailoring. Default collation:
  CLDR `<defaultCollation>` (`zh` → pinyin, `zh-Hant` → stroke), reported as
  `"default"`.
- **`[[SearchLocaleData]][loc]` [default].** `co` is `[null]` only: search does not
  combine with specializations. `sensitivity` is `"variant"`, and
  `ignorePunctuation` comes from the search tailoring. The table is the nearest
  `search` type in the chain, falling back to root `search`.
- **ResolveLocale.** A shared helper implements §9.2.7 for the relevant keys
  `«co, kf, kn»`: an empty `kn` value means `"true"`, supported keywords are
  printed only when not superseded, and the result is canonicalized. A `co` value
  that the locale lacks is dropped (`en-u-co-phonebk` → `en`, `default`), and an
  options value overrides the extension. Matching uses LookupMatchingLocaleByPrefix
  for both `lookup` and `best fit` [default], as the other services do.
- **Option validation.** `collation` must match `(3*8alphanum)(-3*8alphanum)*`, or
  a RangeError is thrown. `numeric` is read as a boolean and passed through
  `ToString`.

### 5. Constructor, methods and localeCompare (observable order) [proposal]

1. `newTarget` and OrdinaryCreateFromConstructor (`%Intl.Collator.prototype%` from
   the realm of `newTarget`).
2. CanonicalizeLocaleList.
3. CoerceOptionsToObject. `null` throws a TypeError, and primitives are wrapped.
4. Getters in this order: `usage`, `localeMatcher`, `collation`, `numeric`,
   `caseFirst`, `sensitivity`, `ignorePunctuation`. An abrupt completion stops all
   later reads.
5. The `compare` getter does RequireInternalSlot, then caches a bound built-in with
   length 2 and name `""`. It applies `ToString(x)` before `ToString(y)`.
6. `resolvedOptions` creates a fresh object with keys in Table 3 order, omitting
   `undefined` values.
7. `localeCompare`: RequireObjectCoercible → ToString(this) → ToString(that) →
   `createCollator` → compare. It is unaffected by `taintDataProperty(Intl,
"Collator")` and throws the same errors as the constructor. A per-realm cache
   of the `(undefined, undefined)` collator is allowed only after measurement.
   Caching is unobservable because no getters run in that case.

### 6. Comparison semantics and edge cases [proposal]

- Both strings are decoded as UTF-16. Pairs become code points. A **lone
  surrogate** gets an implicit unassigned weight for its own value (Q3), so
  distinct lone surrogates stay distinct, are never ignorable, and are never
  variable.
- The comparison returns -1, 0 or +1 and never NaN or -0. Canonically equivalent
  strings return +0, including for supplementary characters and singleton
  decompositions (`Ω`/`Ω`, U+2F82B/`北`).
- Identical strings return 0 without CE work (an exact-equality fast path). There
  are no other fast paths until compare throughput is measured.
- Only `co`, `kf` and `kn` are relevant. `ka`, `kb`, `kc`, `kh`, `kk`, `kr`, `ks`
  and `vt` are ignored and never change ordering
  (`ignore-invalid-unicode-ext-values`).

### 7. Semantic test cases (unit tests and native fixtures)

1. Getter order and abrupt completion for each of the 7 option names. A
   `localeMatcher` value with an embedded NUL is a RangeError. `null` options are
   a TypeError.
2. `de-u-co-phonebk`: `["A","Ab","Ä","Af","b","od","ö","off"]` without any
   conditional. `de` sort puts `Ä` before `AE`, and search keeps them stable.
   `de-u-co-phonebk` with `collation: "eor"` resolves to `de`/`eor`.
3. `sv`: å, ä and ö sort after z. `es-u-co-trad`: ch sorts after c. `da`: default
   `caseFirst` is upper.
4. `th` and `ja` `ignorePunctuation` defaults and overrides, and
   `compare("", " ")`.
5. Numeric: `a1 < a9 < a10`, `01` equals `1`, and Arabic-Indic and Devanagari
   digits are ordered by value.
6. The 25 canonical-equivalence pairs, plus U+0344 and U+0F73 expansion
   discontiguity cases.
7. Lone surrogates: `"\uD800"` and `"\uDC00"` are unequal and antisymmetric, and
   `"a\uD800"` compares consistently against `"a�"`.
8. `localeCompare` coercion order with a throwing `toString` on `this` and on
   `that`, `taint-Intl-Collator`, and the `Object.prototype.sensitivity` taint.
9. Cross-realm `newTarget` prototype, subclassing, and brand checks through a
   Proxy and through `Object.create(collator)`.
10. `getCollations` equals the `[[SortLocaleData]]` `co` list for every
    available locale. The fallback for an unavailable locale is
    `["emoji","eor"]`.

## Representation and native-subset constraints

- Use packed strings with `charCodeAt` word readers and binary search, as
  `normalization/data.ts` does. Avoid large array and object literal initializers.
  Tables are decoded lazily per collation and cached in module state.
- Use no Node, ICU, host Intl or RegExp in the runtime path. The same modules serve
  live and AOT execution.
- The engine works on number arrays of code points and CEs. No Script objects
  cross the foundation boundary.

## Implementation slices

Each slice ends with a fail-fast `pnpm check`. New sources and exports require
`node tools/generate-compiler-catalog.ts` and formatting, and a new foundation
export updates `packages/foundation/package.json`. Native work uses the shared AOT
pipeline under LLDB, one serial inferior at a time, with `TINT_BUILD_ONLY=1` for
hosted fixtures. Each native run asserts the stopped-at-entry and final exit
states. Every unchanged selection is a new immutable report. **Run native
selections only when the parent's native queue and journals are idle; never edit
queues, journals or frozen snapshots.**

- **K0 Red baseline.** Unchanged native selections for `intl402/Collator` (130),
  `intl402/String/prototype/localeCompare` (20) and
  `built-ins/String/prototype/localeCompare` (26), each as a separate report.
  Adjacent selections: `intl402/Locale/prototype/getCollations` (26, now 24/26)
  and `intl402/Intl/supportedValuesOf` (50, now 14/50).
- **K1 Root engine and data.** `generate-unicode-collation.ts` (input checksums,
  Q1 filtering, `allkeys` order cross-check), `root-data.ts`,
  `han-order-data.ts`, `elements.ts`, `compare.ts` and `index.ts`. Unit tests: a
  committed deterministic sample of both CollationTest files (every 50th line plus
  every line with contractions, discontiguity, Hangul or supplementary code
  points), with the full run in a new `tools/verify-unicode-collation.ts <zip>`
  that reports pass and excluded-line counts (Q1). Settings tests use hand
  vectors. **Record the generated source bytes, the compile-time delta and the
  image size here.** Native fixture: the foundation engine through a hosted
  fixture.
- **K2 Rule parser and builder.** `collation-rules.ts`, `collation-builder.ts`, and
  an inventory test that parses every rule in all 135 files and rejects nothing
  unknown. Builder tests cover hand-built rule strings at each relation level, and
  `[before]`, `[import]` cycles, `[reorder]`, prefixes, expansions and suppression,
  and the 4-byte capacity assertion. No runtime change.
- **K3 Collator surface for non-zh locales.** `generate-collation-data.ts` (all
  tailorings except the zh family), `collation-locale.ts`, `intl-collator.ts`,
  realm wiring (`functions.ts` `IntrinsicPrototype`, the `errors.ts` prototype, the
  `operations.ts` `internalCollatorData` slot), the shared ResolveLocale helper and
  `localeCompare`. Unit tests and native fixtures cover §7 cases 1–9. Expected
  movement: classes S, O and C, all localeCompare files, and
  `15.2.3.3-4-81.js`. Unchanged reruns: the three owned selections and the
  `intl402/PluralRules` (106), `intl402/RelativeTimeFormat` (160) and
  `intl402/ListFormat` (162) regression checks, because `primitive-intrinsics.ts`
  and shared locale helpers change.
- **K4 Single source for collation lists.** Re-point `localeCollations`, retire
  `localeCollationPreferences` (its manifest and the generator output change),
  and export `availableCollations()` for INTL-MISC. Fixture: §7 case 10. Rerun
  `intl402/Locale` completely (getCollations must reach 26/26 or the report keeps
  its failures).
- **K5 Han tailorings.** Add the zh family (pinyin, stroke, zhuyin, unihan,
  `zh-Hant` stroke default) and `yue`. Fixtures take pinyin, stroke and zhuyin
  vectors directly from adjacent entries in the pinned `zh.xml` rules. Measure
  the size and compile-time delta again. Rerun the owned selections and
  `intl402/Locale`.
- **K6 Consolidated rerun and self-build.** Run one complete unchanged rerun of
  all three owned selections plus the adjacent selections. Then run a frozen-source
  native self-build and a stage-image comparison as RTF did, and record the
  observed build size and time.

Ordering: K1 → K2 → K3 → K4 → K5 → K6. K2 can proceed in parallel with K1 once the
CE contract (§2) is fixed. K4 can merge into K3 if the diff stays reviewable.

## Validation and evidence separation

- Add `tools/verify-test262-native-collator.ts` using `verifyNativeScriptCases`
  (as RTF does), recorded in its own report with `conformance: false`.
- Node 24.12 probes (ICU 77.1, CLDR 47, Unicode 16) are references only, and they
  use an older CLDR than the pin. Observed: `th` `ignorePunctuation` true, `da`
  `caseFirst` `upper`, search sensitivity `variant`, `"\uD800"` and `"\uDC00"`
  unequal, `"a"` and `"a\u0000"` equal, and zh/ja/ko supported but `yue` and
  `ast` not. Any disagreement is investigated against the CLDR 49 rules and UTS
  #10, never copied.
- CollationTest validates only the root. Per-locale correctness rests on fixtures
  derived from the rule text. **Passing Test262 does not establish tailoring
  conformance.**
- Owned totals count only native runs of unchanged Test262 sources. Unit, fixture
  and Node results are never summed into them, and no overall rate is claimed.

## Decisions (recommended defaults)

- **Q1 UCA 18 data vs UCD 17 engine.** [default] Keep UCD 17 everywhere, because
  the pinned Test262 property escapes are 17.0.0. The generator removes root
  entries for code points unassigned in UCD 17, so those code points get
  unassigned implicit weights, consistent with the engine's normalization. It
  fails if any tailoring reset is anchored on such a code point. CollationTest
  lines containing them (3,965) are reported as a separate count, never silently
  dropped. This filtering is a proposed hybrid, not proof of version-17 collation
  conformance: compare assigned-17 ordering, contractions and canonical-equivalence
  behavior with a version-matched UCA 17 reference before enabling it. If that
  comparison fails, choose a version-matched root or plan a coherent Unicode 18
  upgrade; do not hide the difference by excluding more reference cases.
- **Q2 Root Han order.** [default] Radical-stroke (FractionalUCA `[radical]`), as
  CLDR `unihan` tailorings assume. The cost is the ~100–145 KB table. The
  alternative (UCA implicit block order) is allowed by UTS #35 but makes `unihan`
  inconsistent.
- **Q3 Lone surrogates.** [default] UTS #10 §10.1.1 approach 2: an implicit
  unassigned weight per surrogate code point. Approach 1 (weight as U+FFFD) is also
  conforming. No pinned test observes the difference.
- **Q4 Available locales.** [default] As §4. Rejected: advertising `zh` before K5
  with root order, which would make `supportedLocalesOf` claim data Tint lacks.
- **Q5 Identical level.** [default] None. Strings that differ only in completely
  ignorable characters compare 0. ECMA-402 allows this ("zero in all other cases"),
  and it keeps the comparator a consistent total preorder.
- **Q6 `best fit` matcher.** [default] Same as `lookup`, as the other services do.
- **Q7 `alt="short"` Han rules.** [default] Not used. These are ICU size variants.
  The pin's default (non-`alt`) data defines the order.

## Unresolved assumptions and risks

- 4-byte gap capacity for the largest Han tailorings (K2 asserts it).
- Case bits derived from FractionalUCA tertiaries match UTS #35 `caseFirst` for
  every tailored character. The K2 builder must propagate case for `<<<` inserts.
- Reorder groups map onto `top_byte` and `FDD1` boundaries without splitting a
  script. K1 asserts this.
- Compare cost on long Hangul and Han strings, data source size, compile time,
  self-build time and image growth are all **unmeasured**. K1, K5 and K6 record them.

## Dependencies

Present [current]: locale canonicalization and aliases, `canonicalLocaleList`,
NumberFormat registry, foundation NFD, the CLDR 49 pin, and the collation
inheritance generator. There is no dependency on RT-EVAL, HOST-ESM, INTL-DTF or
TEMPORAL-CAL. The 22 `testWithIntlConstructors` files also need INTL-DTF.
INTL-MISC consumes `availableCollations()`.

## Next planning recommendation

Plan **INTL-SEGMENTER** next (`intl402/Segmenter`, 158 variants). It is the
largest remaining independent Intl constructor without a plan. It reuses this
plan's packed Unicode-table generators and faces the same UCD 17 vs CLDR 49
alignment question for UAX #29 break data. It does not wait on RT-EVAL or the v9
survey.
