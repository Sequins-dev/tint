# INTL-DISPLAYNAMES: Intl.DisplayNames

Planning document captured 2026-11-04. It records planning facts and proposals, not
run evidence. No native DisplayNames run exists; every population below is
**unmeasured**. Labels: **[current]** verified in source or data on 2026-11-04;
**[proposal]** recommended design; **[assumption]** unvalidated premise to confirm
in the named slice; **[default]** conservative choice that a decision may change.
Node probes are references only. Test tolerance never proves conformance.

## Scope

In scope: `Intl.DisplayNames` (constructor, `supportedLocalesOf`, `of`,
`resolvedOptions`) for all six types (`language`, `region`, `script`, `currency`,
`calendar`, `dateTimeField`). This covers code canonicalization, `dialect` and
`standard` language display, `long`/`short`/`narrow` style mapping, `fallback`
`code`/`none`, capitalization context, option order, abrupt completions, brand and
realm behavior. It also covers the CLDR 49 data contract and the single source for
`AvailableCanonicalCurrencies`, which `supportedValuesOf("currency")` consumes.

Out of scope: the rest of INTL-MISC, NumberFormat `currencyDisplay:"name"`
(plural names; Q4) and Unicode extension display (`of` rejects extensions).

## Pinned population

Revision `91c70759…5ba`, read-only metadata scan. No owned file has `onlyStrict`,
`noStrict`, `raw` or `module`, so each file yields two variants. The README figure
of 114 is current: the v72 group inventory also records `intl402/DisplayNames` as
114 variants with 0 recorded outcomes.

**Directly owned: 57 files / 114 variants** (`intl402/DisplayNames`). Features:
`Intl.DisplayNames` 46 files, `Intl.DisplayNames-v2` 11 (`languageDisplay`,
calendar, dateTimeField, language-invalid and `return-object.js`). Additional tags:
`Symbol` 7, `Reflect` 3, `BigInt` 2, `Proxy` 1, `cross-realm` 1,
`Symbol.toStringTag` 1. Includes: `propertyHelper.js` 14, `compareArray.js` 2.

| Class                                                                                    | Files | Needs                         |
| ---------------------------------------------------------------------------------------- | ----: | ----------------------------- |
| R: constructor, options, `resolvedOptions`, property surface, realm and brand            |    50 | Constructor and surface only  |
| O: `of` RangeError cases and `typeof … === "string"` under the default `fallback:"code"` |     7 | Code validation; no name data |

**No pinned test asserts a display string.** Valid-code tests pass by returning
the code, and no file exercises `of` for `script` or `currency`, `fallback:"none"`,
`supportedLocalesOf`, or `of.length`/`name`. Test262 therefore cannot show that names
are real. Native fixtures (§9) checked against CLDR 49 XML carry that evidence.
`type-language-valid.js` is the largest workload: about 1,480 `of` calls (estimate)
over generated tags with up to nine variants.

**Dependent, not owned (INTL-MISC).**
`intl402/Intl/supportedValuesOf/calendars-accepted-by-DisplayNames.js` and
`currencies-accepted-by-DisplayNames.js` (2 files / 4 variants) construct
`DisplayNames("en", {fallback:"none"})`. The currency file also needs
`supportedValuesOf("currency")`, which today calls `rejectUnsupportedExecution`
(`intl.ts:91`). The same enumeration gates `currencies.js` and
`currencies-accepted-by-NumberFormat.js` (2 files / 4 variants). `harness/
wellKnownIntrinsicObjects.js` names `%Intl.DisplayNames%`; `testWithIntlConstructors`
excludes DisplayNames because it requires `type`.

**Stale evidence.** [supportedValuesOf v3](../results/test262-intl-supported-values-native-v3.json)
(2026-11-03, snapshot `node-toolchain-number-affixes-v1`) records 20/50, with all
six files `unsupported`; the README INTL-MISC row still cites v1 (14/50).

## Authoritative sources

Fetched 2026-11-04 to `/tmp/tint-displaynames-plan/spec`:

- **ECMA-402 draft 2026-10-23** (<https://tc39.es/ecma402/>; same bytes as the
  DurationFormat fetch): §12.1–12.5 (constructor, slots and `[[LocaleData]]`,
  Tables 18–19, `of`, CanonicalCodeForDisplayNames); §6.2.1–2, §6.3.1, §6.4;
  §9.1 (available-locale closure); §9.2.8–10 (ResolveOptions `require-options`,
  FilterLocales, CoerceOptionsToObject).
- **UTS #35 revision 79, CLDR 49** (2026-10-21): Part 2 §Locale Display Name
  Algorithm, Locale Display Name Fields (script `stand-alone`, `short` alternates),
  Nested Bracket Replacement and Context Transforms; Part 1 §Lateral Inheritance
  (`alt` falls back to no-`alt` within a locale before its parent) and §3.3 BCP 47
  conformance; Part 4 Calendar Fields (field types and widths).
- **CLDR 49** `.tint-bootstrap/cldr-core-49.zip` (SHA-256 `78403d8d…6a89`, the
  existing pin). Members: `common/main/*.xml` (929),
  `common/supplemental/supplementalData.xml` (general `parentLocales`),
  `common/bcp47/calendar.xml` (BCP 47 names and CLDR aliases),
  `common/validity/{currency,region,script}.xml` (generator invariants only).

**Reading of the spec [current].** `[[Fields]]` is one record keyed by
canonicalized codes. `of` returns the field if present, otherwise the code
(`fallback:"code"`) or `undefined`. Membership must therefore not depend on
`fallback`. Only `language` codes go through alias canonicalization. Region,
script, currency and calendar codes are case-regularized only. `languageDisplay` is
read and validated for every type but stored only for `language`.

## Current capabilities (all [current])

- **Service template:** `intl-list-format.ts` (constructor at :146–176:
  `constructorPrototype`, `canonicalLocaleList`, GetOptionsObject via
  `viewObjectValue`, private `stringOption`/`localeMatcher`, lookup resolution,
  own-slot `requireFormatter`, `supportedLocalesOf` with CoerceOptionsToObject).
  Each service needs `functions.ts` `IntrinsicPrototype` (:39, :85), an `errors.ts`
  realm prototype (:90, :343), an `operations.ts` slot (:84–87, :363) and an
  `intl.ts` installer call (:35–39). `$262.createRealm` prototype selection already
  passes in RTF and ListFormat.
- **Locale identifiers:** `parseLocaleId` (`locale-id.ts:154`) implements the
  ECMA-402 well-formedness subset. It rejects `root`, script-first tags,
  underscores and duplicate variants. `canonicalizeLocaleId`
  (`locale-canonicalization.ts:277`) applies Annex C and sorts variants (host-Node
  probe of the TS source: `sh`→`sr-Latn`, `cmn`→`zh`, `iw-IL`→`he-IL`,
  `aa-AAAAA-BBBBB-12345`→`aa-12345-aaaaa-bbbbb`; `en-x-foo` has one extension).
- **Subtag validators (private):** `intl-locale.ts:85` `validBaseOption`
  (script/region/variant via an `und-` prefix parse) and `:168` `typeValue` (the
  `type` nonterminal via `und-u-ca-`). `intl-number-format.ts:209` `currencyCode`
  is IsWellFormedCurrencyCode.
- **Lookup and inheritance:** `localeTableValue` (sorted packed `key|value`
  binary search). `currency-symbols.ts` already resolves `locale:code:field` keys
  through a generated parents table at run time.
- **Generators:** `tools/cldr-xml.ts` (`xmlText`, `attributes`).
  `generate-relative-time-data.ts` covers archive/member hashing, general parent
  chains, `<field>` alias resolution and interning. The numeric generator
  (`generate-number-format-data.ts:370–399`) adds §9.1 structural registry aliases
  by likely-subtag preference. `generate-currency-symbol-data.ts` duplicates
  `xmlText`/`attributes` instead of importing `cldr-xml.ts` (cleanup candidate).
- **Calendars:** `supportedValuesOf("calendar")` returns the 18
  `localeCalendarTypes`, which match the harness `allCalendars()`.

## Explicit gaps

No installer, realm prototype, slot, tests, name tables (only currency symbols
exist) or `AvailableCanonicalCurrencies`. Unrelated packaging gap:
`relative-time-data-manifest.json` is absent from `package.json` `files`.

## CLDR 49 data measurement (measured 2026-11-04)

Probe `probe/size.py` resolves general parents and counts own entries that differ
from the resolved parent. It excludes `↑↑↑`, `scope="core"`, `count`, and every
`alt` except `short` and `stand-alone`. Bytes are UTF-8 code plus value plus 2
delimiters, without a locale prefix.

| Kind                                | Entries |     Bytes | Unique values (bytes) |
| ----------------------------------- | ------: | --------: | --------------------: |
| Language (incl. composite keys)     |  81,571 | 1,545,640 |      58,483 (957,396) |
| Region                              |  64,612 | 1,279,346 |      39,963 (762,551) |
| Currency `displayName`              |  37,487 | 1,159,770 |      32,937 (890,031) |
| Script                              |  19,587 |   436,111 |      14,653 (269,283) |
| Variant (language composition only) |   4,706 |   154,652 |       4,067 (107,250) |
| Calendar (non-core)                 |   2,503 |   106,043 |        2,375 (79,097) |
| Date fields (all types/widths)      |   5,199 |   109,590 |        3,771 (44,984) |
| `localeDisplayPattern`              |      50 |     1,417 |              28 (270) |
| **Total**                           | 215,715 | 4,792,569 |                     — |

- Draft grades: approved 197,096; contributed 9,093; unconfirmed 8,894; provisional 882. The repository policy keeps all grades.
- Non-root ancestry with data, of 928 locale files: language and region names 928,
  fields 885, currency 871, script 779, calendar 732. Root has no names except 15
  English-like field labels (`Era`, `Year`, …), plus patterns and the only
  `nestedBracketReplacement` set (`(`→`[`, `)`→`]`, full-width pairs).
- Restricting locales saves little. With CLDR `coverageLevels.txt`: modern-only
  (524 files) 2.95 MB; modern+moderate 3.23 MB; +basic (730 files) 4.22 MB.
- `en` resolves 671 language, 308 region, 306 currency, 220 script, 55 variant,
  45 field, 18 calendar and 3 pattern entries. All 18 CLDR calendar types map to
  BCP 47 names through `bcp47/calendar.xml` (`gregorian`→`gregory`,
  `ethiopic-amete-alem`→`ethioaa`).
- Composite language keys: 27 distinct, all of two subtags: 6 language+script
  (`az_Arab`, `bal_Latn`, `hi_Latn`, `kk_Arab`, `zh_Hans`, `zh_Hant`), 20
  language+region and 1 language+variant (`be_TARASK`).
- Currency: ISO validity has 153 regular, 153 deprecated and `XXX` (307). `en`
  names 306; only `XAD` lacks an `en` name (named only in `cv`). The union over all
  locales is 307.
- Region: `en` names all 292 regular and macro-regions, `ZZ`, and private-use
  `XA`/`XB`. Deprecated codes such as `SU` have no name. Script: `Hntl` is regular
  but unnamed in `en`.

**Generated size [estimate].** 5.0–6.1 MB of packed source, compared with
1,011,479 B for all current `*-data.ts` (measured) and 498 KB for RTF. The
interned layout saves little because unique values total about 3.1 MB. The
self-build image with RTF was 61,922,610 B (measured). Compile and self-build time
deltas are **unmeasured** (Q1 gate).

## Design

### 1. Modules and contracts [proposal]

All in `packages/js-runtime/src/objects/`; no new package, manifest dependency,
project reference or `workspace-contracts.json` change. New sources require
`node tools/generate-compiler-catalog.ts` and formatting.

- `display-names-data.ts` (generated, one file per kind if Q1 measures a need):
  `displayNamesLocales` (requested tag → data owner), `displayNamesParents`
  (non-truncation parents), entry tables keyed `ownerId:code[:alt]`,
  `displayNamesFieldProfiles` (interned, pre-resolved date fields),
  `displayNamesPatterns` and `displayNamesBrackets`.
- `display-names.ts`: pure core with no Script objects.
  `lookupDisplayNamesLocale(tag)`;
  `canonicalDisplayNamesCode(type, code): string | undefined` (`undefined` means
  RangeError); `createDisplayNamesFields(locale, type, style, languageDisplay)`;
  `displayName(fields, code): string | undefined`; `availableCanonicalCurrencies()`.
- `intl-display-names.ts`: `installDisplayNamesIntrinsic` and the adapters.
- Shared extractions (behavior-preserving): move `validBaseOption`/`typeValue`
  into `locale-id.ts` as `isRegionSubtag`, `isScriptSubtag` and `isUnicodeTypeValue`.
  Move `currencyCode` into `currency-number.ts` as `isWellFormedCurrencyCode`.
  Add `getOptionsObject` and `stringEnumOption(options, name, values, fallback)` to
  `options.ts`, and `filterSupportedLocales(requested, options, accepts)` to
  `locale-objects.ts`. Migrate ListFormat to them as continuous cleanup.

### 2. Generator and data contract [proposal]

`tools/generate-display-names-data.ts` reads only the pinned archive. A new
`tools/cldr-archive.ts` holds the archive checksum, hashed member reads and general
parent chains, and imports `cldr-xml.ts`. A new `tools/cldr-locale-registry.ts`
holds the registry and §9.1 alias rule extracted from the numeric generator; that
generator's output must stay byte-identical.

- **Entries.** Emit only values that differ from the resolved parent, so run-time
  lookup follows UTS #35 lateral then vertical inheritance. For each owner in the
  chain, try the `alt` key and then the plain key before moving to the parent. Keys
  use canonical forms: language keys `zh-Hant`/`be-tarask`, uppercase regions,
  title-case scripts, lowercase variants, uppercase currencies, BCP 47 calendars.
  Skip `↑↑↑`, `scope`, `count`, `menu`/`long`/`variant`/`secondary`/`official`
  alternates, and calendar `alt="variant"`.
- **Date fields.** For each registry owner, pre-resolve the 12 Table 19 codes × 3
  widths with the relative-time alias rules into interned profiles, because root
  `-short`/`-narrow` aliases are relative to the requesting locale.
- **Root policy (Q2).** Root contributes patterns and bracket replacements only.
  A name whose resolution reaches root is absent.
- **Invariants (generation fails otherwise):** every composite language key has
  two subtags; every calendar maps to a `bcp47/calendar.xml` name; one `{0}`/`{1}`
  each per pattern; no delimiter characters in keys or values; the `en`-named
  currency set equals the validity set minus the recorded exception list (`XAD`).
- **Manifest** `packages/js-runtime/display-names-data-manifest.json`: archive URL
  and SHA-256, per-member hashes, counts, policy and output hash. Add it, and the
  missing relative-time manifest, to `package.json` `files`.

### 3. Available locales [proposal]

`[[AvailableLocales]]` contains canonicalized CLDR main identifiers with non-root
language or region names (all 928 files qualify), plus the §9.1 structural aliases
(for example `az-AZ`, `sr-RS`) from the shared registry helper. The exact count is
measured in N1 (estimate ~970). Locales such as `agq` (no script names) are
advertised because they have real language and region names. Their `script`
lookups return the code or `undefined`, with no English substitution.
ResolveLocale and FilterLocales use the same lookup predicate (best fit = lookup,
as in every service). `[[RelevantExtensionKeys]]` is empty, so `-u-` keywords are
dropped from `locale`.

### 4. Constructor order [proposal]

Transcribe §12.1.1 with ResolveOptions `require-options`:

1. NewTarget undefined → TypeError (`undefined-newtarget-throws.js`).
2. OrdinaryCreateFromConstructor reads `newTarget.prototype` first
   (`ctor-custom-get-prototype-poison-throws.js`, `proto-from-ctor-realm.js`).
3. CanonicalizeLocaleList (`locales-*` files; `null` → TypeError).
4. `options === undefined` → TypeError. GetOptionsObject: any other non-Object
   (`null`, booleans, strings, numbers, Symbol, BigInt) → TypeError.
5. GetOption order: `localeMatcher`; ResolveLocale; `style` (default `long`);
   `type` (required, so `undefined` → TypeError after `style`); `fallback`
   (default `code`); then `languageDisplay` (default `dialect`), **for every type**.
   `{type:"region", languageDisplay:"x"}` → RangeError. Each GetOption is Get, then
   ToString (Symbol → TypeError, abrupt `toString` propagates), then membership
   RangeError. Misspelled keys are never read (`options-random-properties-unchecked`).

### 5. CanonicalCodeForDisplayNames [proposal]

After RequireInternalSlot and ToString in `of`:

- `language`: `parseLocaleId(code)` must succeed with no extension or private use
  (unicode_language_id plus IsWellFormedLanguageTag); then `canonicalizeLocaleId`.
  `en-u-hebrew`, `root`, `abcd-GB`, `en_GB`, duplicate variants → RangeError.
- `region`: `alpha{2} | digit{3}` → ASCII uppercase. **No alias replacement**
  (`SU` stays `SU`).
- `script`: `alpha{4}` → title case.
- `calendar`: `type` nonterminal with `-` separators only (no `_` backward-compatible
  syntax) → ASCII lowercase. No alias replacement.
- `dateTimeField`: exact, case-sensitive Table 19 membership.
- `currency`: IsWellFormedCurrencyCode → ASCII uppercase.

### 6. Name resolution [proposal]

`displayName` returns a string or `undefined` independent of `fallback`. Only the
adapter applies `fallback`.

- **Region:** long = default; short and narrow = `alt="short"` (lateral fallback).
- **Script:** long = `stand-alone` alternate, else default (UTS #35: a script
  alone is shown as "Simplified Han"). Short and narrow = `short`, then the long
  chain.
- **Currency:** `displayName` (no `count`) for all styles (Q4).
- **Calendar:** default `<type key="calendar">` for all styles.
- **dateTimeField:** CLDR field `era`, `year`, `quarter`, `month`, `week`
  (`weekOfYear`), `weekday`, `day`, `dayperiod`, `hour`, `minute`, `second`,
  `zone` (`timeZoneName`); long/short/narrow = `<f>`/`<f>-short`/`<f>-narrow`
  after alias resolution.
- **Language (UTS #35 Locale Display Name Algorithm):** input is the canonical
  identifier. `dialect` sets CombineLanguage = true; `standard` sets it to false.
  Style `short`/`narrow` sets PreferAlt {language, region: `short`}.
  1. Base name: in `dialect` mode, scan the 27 generated composite keys that
     match L (language plus one of script, region or a variant) and have a name in
     the chain. Prefer script, then region, then variant, then alphabetical order.
     Otherwise use the bare language name. A matched composite consumes its subtag.
     A missing base name makes the whole name absent.
  2. Qualifiers in canonical order: script (default form, not stand-alone),
     region (style alt), each variant. Any unnamed qualifier makes the whole name
     absent (Q3).
  3. Apply nested bracket replacement to a qualifier when both it and
     `localePattern` contain brackets. Join with `localeSeparator`, then apply
     `localePattern`.
- **Capitalization (Q6):** raw CLDR text, the middle-of-sentence form. ECMA-402
  defines no display context, so `contextTransforms` are not applied
  (`fr` → `anglais`).

### 7. Surface [proposal]

- Constructor length **2**, name `DisplayNames`; `prototype` non-writable,
  non-enumerable, non-configurable. `supportedLocalesOf` length 1;
  `resolvedOptions` length 0; `of` length 1; `@@toStringTag`
  `"Intl.DisplayNames"` (configurable only).
- `resolvedOptions`: method-realm ordinary object, Table 18 order `locale`,
  `style`, `type`, `fallback`, and `languageDisplay` only for `language`.
- Brand: own `internalDisplayNamesData` slot. The prototype, `Object.create(dn)`
  and proxies throw TypeError before ToString of `code`.

### 8. AvailableCanonicalCurrencies (dependent; coordinate with INTL-MISC) [proposal]

The currency set is the `en` (DefaultLocale) non-root-named set, which N1 asserts
equals ISO validity minus `XAD` (306 codes, sorted). `supportedValuesOf("currency")`
returns it as a fresh sorted Array. NumberFormat already accepts every well-formed
code, so no NumberFormat change is needed.

### 9. Native semantic fixtures (expected values from CLDR 49 XML)

1. Option log `localeMatcher,style,type,fallback,languageDisplay` for
   `type:"region"`. `{style:"x"}` → RangeError before `type`. `{}` → TypeError
   before `fallback`. `{type:"region",languageDisplay:"x"}` → RangeError.
2. `new Intl.DisplayNames()` and `("en")` → TypeError after locale processing.
   A poisoned `locales` length getter runs before the options TypeError.
3. Bad receivers (prototype, `Object.create(dn)`, proxy, other-service instance)
   throw before a `code` `toString` side effect.
4. `en` language: `en-GB` dialect/long "British English", short "UK English";
   standard long "English (United Kingdom)", short "English (UK)"; `sh` →
   "Serbian (Latin)"; `und` → "Unknown language"; `en-ZZ` → "English (Unknown
   Region)".
5. UTS #35 longest match: `nl-Cyrl-BE` → "Flemish (Cyrillic)"; `zh-Hant-TW`
   dialect → "Traditional Chinese (Taiwan)", standard → "Chinese (Traditional,
   Taiwan)". These deliberately differ from ICU 77.
6. Brackets: `en` standard `my-MM` → "Burmese (Myanmar [Burma])"; short →
   "Burmese (Myanmar)".
7. Partial data: `en-abcde`/`xx-US` with `fallback:"none"` → `undefined`; with
   `code` → `"en-abcde"`/`"xx-US"`. `en-u-ca-gregory` → RangeError.
8. Region/script: `gb` → "United Kingdom"; `SU` `none` → `undefined`; `419` →
   "Latin America"; `latn` → "Latin"; `Hans` long → "Simplified Han";
   `agq` script `none` → `undefined`.
9. Currency: `usd` → "US Dollar" in all styles; `XAD` `none` in `en` →
   `undefined`, in `cv` → "ази шутлав динарӗ"; `ABC` `code` → "ABC".
10. Calendar: `GREGORY` → "Gregorian Calendar"; `ethioaa` → "Ethiopic Amete Alem
    Calendar"; `ethiopic-amete-alem` and `islamicc` with `none` → `undefined`.
11. Fields: `weekOfYear` long "week", short and narrow "wk."; `dayPeriod` "AM/PM";
    `de` narrow `month` → "M".
12. Other locales: `fr` `en` → "anglais"; `ja` `en-US` → "アメリカ英語";
    `de-CH-u-nu-latn` resolves to `de-CH`; `zz` resolves to `en`.
13. Realm: a foreign-realm instance's `resolvedOptions` result uses the method's
    realm. Mutating `Intl.DisplayNames` does not affect `supportedValuesOf`.
14. Elapsed time for 1,500 `of("aa-abcd-ab-abcde-…")` calls (timing evidence only).

## Implementation slices

Representation: packed sorted strings with binary search, no large literals
(`docs/intl-runtime.md`), and no RegExp, Node, ICU or host-Intl calls at run time.
Fields records are descriptors (owner chain, kind, style, alt), not copied
dictionaries. The same modules serve live and AOT execution.

Each slice ends with a fail-fast `pnpm check`. Native work uses the shared AOT
pipeline under LLDB, one serial inferior at a time, with `TINT_BUILD_ONLY=1` for
hosted fixtures. Each run asserts stopped-at-entry and final exit states. Every
unchanged selection is a new immutable report, run only when the parent's native
queue and journals are idle. Never edit queues, journals or frozen snapshots.

- **N0 Red baseline.** Unchanged `intl402/DisplayNames` (114). Separately,
  `intl402/Intl/supportedValuesOf` (50) on the current source snapshot.
- **N1 Tool primitives, generator and size gate.** `cldr-archive.ts`,
  `cldr-locale-registry.ts`, generator, manifest, `package.json` files. Tool tests
  compare lookups with direct XML spot vectors for every kind, alternate and width
  (`en`, `fr`, `de`, `ja`, `zh`, `cv`, `agq`) and enforce the §2 invariants. The
  numeric generator stays byte-identical. **Gate Q1:** record generated bytes, a
  hosted fixture compile time, and the stage-image size and self-build time delta.
- **N2 Pure core.** `display-names.ts` plus the validator and currency-code
  extractions. Unit tests cover every §5 branch, every §6 rule including
  composite tie-breaking and brackets, Q3 absence and field profiles.
- **N3 Public surface.** Installer, realm wiring, shared option and
  `supportedLocalesOf` helpers, and ListFormat migration. Target: 114 owned
  variants. Native fixtures 1–14. Unchanged reruns: `intl402/ListFormat` (162);
  the complete Locale family selection, because `intl-locale.ts` changes.
- **N4 Currency enumeration (dependent).** §8 plus `intl.ts`. Unchanged rerun of
  `intl402/Intl/supportedValuesOf` (50). The 8 dependent variants are not added to
  owned totals; INTL-MISC records them.
- **N5 Consolidated rerun and self-build.** One complete unchanged run of 114 owned
  variants, `intl402/NumberFormat` (502; `currencyCode` moved), plus a frozen-source
  self-build and stage-image comparison like RTF. Record the observed size and time.

Order: N1 → N2 → N3 → N4 → N5. N2 can start beside N1 against a hand-written
miniature table, but must switch to generated data before N3.

## Validation and evidence separation

- Fixtures run through a new `tools/verify-test262-native-display-names.ts`
  (`verifyNativeScriptCases`), reported separately with `conformance: false`.
- Node 24.12 (ICU 77.1, CLDR 47) probes in `/tmp/tint-displaynames-plan/probe`
  are references only. Observed divergences from the spec and UTS #35: no case
  regularization (`latn` → "latn"), region aliases (`SU` → "Russia"), `und` →
  "root", partial composites under `code` ("English (ABCDE)"), no script
  stand-alone, ICU dialect matching, and 162 currencies.
- Owned totals count only native runs of unchanged Test262 sources.

## Decisions (recommended defaults)

- **Q1 Data breadth and size.** [default] Full CLDR 49 (all 928 locales, all
  kinds), accepted only if the N1 gate stays within a budget the parent sets.
  Alternative: modern+moderate locales (3.23 MB measured) with a smaller registry.
  Never drop codes inside an advertised locale.
- **Q2 Root names.** [default] Root supplies patterns and brackets only. Its 15
  English-like field labels are not served. Alternative: serve them as CLDR data.
- **Q3 Partial language names.** [default] Absent unless the base name and every
  qualifier are named. This keeps `[[Fields]]` independent of `fallback`. UTS #35's
  "fallback pattern with the subtag" would make every syntactically valid tag a
  field, so `fallback:"none"` would never return `undefined`.
- **Q4 Currency styles.** [default] `displayName` for all styles. CLDR has no
  short currency names, and symbols belong to NumberFormat `currencyDisplay`.
- **Q5 Alias codes.** [default] No alias data keys for region, script, calendar
  or currency. Only language codes are canonicalized, per §12.5.1.
- **Q6 Capitalization.** [default] Middle-of-sentence CLDR text.
  `contextTransforms` need an ECMA-402 context option first.
- **Q7 Currency set.** [default] DefaultLocale-named validity codes (306), the
  only locale every service advertises. The union over all locales (307) would
  list `XAD` while `en` has no name for it.

## Assumptions to confirm

- A1 (N1): the native compiler and self-build accept multi-megabyte packed
  literals at acceptable cost (RTF's 498 KB is the largest proven table), and the
  shared registry rule reproduces the numeric aliases exactly.
- A2 (N3): `type-language-valid.js` (about 1,480 canonicalizations and
  compositions) finishes inside the runner timeout. Fixture 14 measures it.
- A3: `currency-symbols.ts` resolves `alt="narrow"` across the whole chain before
  the plain symbol, which can differ from UTS #35 Part 1 lateral inheritance (data
  impact unmeasured). Investigate in its own row; this plan does not change it.

## Dependencies

All prerequisites are present [current]. Coordination only: INTL-MISC for N4. No
dependency on RT-EVAL, HOST-ESM, INTL-DTF, TEMPORAL-CAL or other Intl plans; the
date-field names here never feed DTF formatting.

## Next planning recommendation

Plan **HOST-AGENT** next: the last broad `needs plan` row not waiting on v9 (112
files use `$262.agent`; 106 waitAsync and 222 Atomics harness errors). Its blocker
is resolved (context-domain tokens are separate from logical agent identity); the
plan must budget the two-live-heap proof and thread/context lifecycle work.
