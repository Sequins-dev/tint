# INTL-DTF: Intl.DateTimeFormat and locale-sensitive Date/Temporal formatting

Adjacent dependency: the two recorded failures in
[`FallbackSymbol/per-realm`](../results/evalscript-intl-child-failure-analysis-v1.json)
call the missing DateTimeFormat constructor before reaching the child realm.
They remain separate from this plan's owned population.

Planning document captured 2026-11-04. It records planning facts and proposals, not
run evidence. No native DateTimeFormat run exists; every population below is
**unmeasured**. Labels: **[current]** verified in source on 2026-11-04;
**[proposal]** recommended design; **[assumption]** unresolved premise to confirm
before the dependent slice; **[default]** conservative choice a later decision may
relax.

## Scope

In scope: `Intl.DateTimeFormat` (constructor, `supportedLocalesOf`,
`resolvedOptions`, the `format` getter, `formatToParts`, `formatRange`,
`formatRangeToParts`, normative-optional legacy chaining/unwrapping); the three
`Date.prototype.toLocale*String` methods; `toLocaleString` on the seven formattable
Temporal types (Instant, PlainDate, PlainDateTime, PlainTime, PlainYearMonth,
PlainMonthDay, ZonedDateTime); and a CLDR 49 data pipeline for date/time patterns,
symbols, day periods and time-zone display names.

Out of scope, with explicit boundary contracts (§12): **TEMPORAL-CAL** (non-ISO
calendar arithmetic, eras, month codes, non-ISO Temporal objects; DTF consumes one
narrow contract, §7), **INTL-DURATIONFORMAT** (`Duration.prototype.toLocaleString`)
and **INTL-MISC** (`supportedValuesOf` contents, cross-constructor harness checks).

## Pinned population

Revision `91c70759…5ba`. Counts come from a read-only metadata scan using the
repository variant policy (`tools/test262.ts`: `module`, `raw`, `onlyStrict` and
`noStrict` yield one variant; everything else two). They are populations, not
expected gains.

**Directly owned: 352 files / 704 variants.**

- `intl402/DateTimeFormat`: 245 files / 490 variants. `prototype/format` 88,
  `formatToParts` 76, `formatRange` 64, `formatRangeToParts` 72, `resolvedOptions`
  42; constructor-level, `supportedLocalesOf`, `constructor` and `toStringTag` 148.
  Feature tags (variants): `Temporal` 130, `Intl.DateTimeFormat-formatRange` 74,
  `-dayPeriod` 24, `-datetimestyle` 20, `-fractionalSecondDigits` 20,
  `Intl.Era-monthcode` 14, `canonical-tz` 8, `intl-normative-optional` 6,
  `-extend-timezonename` 4, `cross-realm` 2.
- `intl402/Date`: 12 files / 24 variants (`toLocale*` and DTF equivalence).
- `intl402/Temporal/<type>/prototype/toLocaleString`: 95 files / 190 variants
  (Instant 14 files, PlainDate 14, PlainDateTime 15, PlainMonthDay 12, PlainTime 12,
  PlainYearMonth 12, ZonedDateTime 16).

**Dependency split of the 704** (heuristic text scan, order of magnitude only):
Gregorian Number/Date inputs only 344; Temporal-object inputs 298; mentions a
non-ISO calendar 60; `cross-realm` 2. Of the 162 files using Temporal, 36 construct
`"gregory"` objects, which Temporal constructors do not yet accept (§7). Only about
19 files (≈38 variants) actually _format_ in a non-ISO calendar: chinese/dangi
range and parts, lunisolar leap months, related-year, `era.js`,
`bound-to-datetimeformat-instance.js`, the `intl402/Date` equivalence test and the
six Temporal `dateStyle.js` files (islamic-tbla). The rest check resolution only.

**Adjacent, not owned** (listed to prevent double counting):

- Built-in Temporal `toLocaleString` property/brand tests for PlainDate,
  PlainMonthDay, PlainYearMonth and ZonedDateTime: 28 files / 56 variants; the
  methods do not exist yet (added in D8). Instant/PlainDateTime/PlainTime (21 files /
  42 variants) and `built-ins/Date/prototype/toLocale*` (15 / 30) have methods.
- INTL-MISC: four `intl402/Intl/supportedValuesOf` files (calendars, numbering
  systems and time zones accepted by DTF; calendars required by era-monthcode),
  `intl402/FallbackSymbol` (2 files), and the two PluralRules harness failures
  (`testIntl.js` iterates Collator, NumberFormat and DTF, so INTL-COLLATOR too).
- TEMPORAL-CAL: `intl402/Temporal/*/from/islamic*.js` (10 files). STAGING-SM: 3.

**Locales with exact-text assertions:** mostly `en`/`en-US`; also `de`, `ja`,
`zh-Hans`/`zh-Hant`, `pt-BR`, `hi`, `th`, `ar`, `fr`, `ko`, `it`. Several tests
derive separators (range separator, space before the day period) from the
implementation rather than hard-coding them.

## Authoritative sources

Fetched 2026-11-04; plain-text extracts are in `/tmp/tint-intl-dtf-plan/spec`.

- **ECMA-402 draft 2026-10-23** (<https://tc39.es/ecma402/>): §11.1.2
  CreateDateTimeFormat, §11.3 prototype, §11.5.1–13 (style, Basic matcher, pattern,
  range, ToLocalTime, unwrap), §20.4 Date, §6.5 zones, §6.9.1 AvailableCalendars,
  §9.2.8 ResolveOptions.
- **Temporal Stage 4 draft 2026-07-27** (<https://tc39.es/proposal-temporal/>):
  §15.4.1 CreateDateTimeFormat (`toLocaleStringTimeZone`), §15.6.1–2
  GetDateTimeFormat/AdjustDateTimeStyleFormat, §15.6.4–23 (`isPlain`,
  HandleDateTime*, ToDateTimeFormattable, SameTemporalType), §15.11 `toLocaleString`.
- **UTS #35 Part 4 (Dates)** for patterns, skeletons, interval formats, day periods
  and zone-name fallback; data from `.tint-bootstrap/cldr-core-49.zip` (SHA-256
  `78403d8d…6a89`, the existing pin).

**Divergences**, each reconciled toward the pinned tests:

1. **Zone identifier.** ECMA-402 stores `[[PrimaryIdentifier]]`; Temporal and the
   `canonical-tz` tests keep the case-normalized `[[Identifier]]` (`Asia/Calcutta`,
   `Etc/GMT`). **[proposal]** Follow Temporal.
2. **`[[HourCycle]]`.** Temporal always sets it; ECMA-402 only with an hour field,
   and `hourCycle-dateStyle.js` requires `hourCycle`/`hour12` absent otherwise.
   **[proposal]** Always store `hc` (sub-formats need it); `resolvedOptions` emits
   it only when `[[DateTimeFormat]]` has an hour.
3. **Range fractional digits.** Temporal reads an undeclared
   `[[FractionalSecondDigits]]` slot. **[proposal]** Use ECMA-402's format field.
4. **Plain-value ranges.** Temporal compares `tm1`/`tm2` in `[[TimeZone]]` but
   formats plain values at `+00:00`. **[default]** Follow the text literally, add a
   fixture showing the effect, and record an upstream question.
5. **`islamic`/`islamic-rgsa`.** ResolveLocale ignores values absent from
   `[[LocaleData]].[[ca]]`, so the locale default applies; this is conforming.

## Current capabilities (all [current])

- **Registration.** `objects/intl.ts` `installIntlIntrinsics` installs Locale,
  ListFormat, PluralRules, NumberFormat and RelativeTimeFormat, but no
  DateTimeFormat. `supportedValuesOf("calendar")` returns all 18
  `localeCalendarTypes`, including `islamic` and `islamic-rgsa`.
- **Constructor template:** `intl-relative-time-format.ts`: `option()`,
  `optionsObject` (CoerceOptionsToObject), own-slot `requireFormatter`,
  `constructorPrototype` selection, private number setup bypassing public
  `Intl.NumberFormat`. Wiring per service: `functions.ts` (`IntrinsicPrototype`),
  `errors.ts` (`ErrorRealm` prototype) and `operations.ts` (`internal…Data` slot).
- **Legacy and bound format:** `intl-legacy.ts` `chainIntlLegacy`/`unwrapIntlLegacy`
  (`realm.intlFallbackSymbol`); NumberFormat uses both and caches `boundFormat`
  (`intl-number-format.ts:512,568`).
- **Locale and numbers:** `canonicalLocaleList`, `runtimeDefaultLocale = "en"`,
  `lookupNumberFormatLocale` (860 tags), `numberFormatLocaleData`,
  `resolveNumberingSystemOption`, `resolveNumberLocale`,
  `configureDecimalNumberFormatter`; digits for 78 systems including astral sets.
- **Locale metadata:** `locale-info.ts` `localeHourCycles` (CLDR `timeData`
  preferred then allowed; JP yields `h23,h11,h12`), `localeCalendars` (preference
  order with region, `-u-rg`/`-u-sd`, explicit `-u-ca`) and
  `availableLocaleCalendars`.
- **Time zones:** `named-time-zones.ts` (case-insensitive lookup → identifier,
  primary, TZif model); `temporal-time-zone.ts` `temporalTimeZone` and
  `temporalTimeZoneOffsetNanoseconds`. The native host installs
  `systemTimeZoneIdentifier`, `namedTimeZones` and `wallClockMilliseconds`
  (`tools/test262-native.ts:310,370`).
- **Dates and Temporal:** `date-values.ts` `dateFields` (proleptic Gregorian).
  Temporal slots exist for all types plus `internalTemporalCalendar`;
  `canonicalTemporalCalendar` accepts 18 identifiers but construction is ISO-only
  (`requireISOCalendar`). `date-intrinsics.ts:257–291` routes `toLocale*` to
  `toString`-style text; Instant/PlainDateTime/PlainTime `toLocaleString` return
  ISO text; the other four types lack it (`temporal-date-time-format.ts` is the ISO
  serializer, not Intl).
- **Generator and verifier patterns:** `tools/cldr-xml.ts` and
  `tools/generate-relative-time-data.ts` (checksum pin, member-hash manifest, parent
  locales, packed `key|value` tables searched by `localeTableValue`; packed strings
  avoid large initializers in strict native compilation, `docs/intl-runtime.md`).
  Native fixtures follow `tools/verify-test262-native-relative-time.ts`.

## Explicit gaps

- No date patterns, symbols, day-period rules, interval formats or zone names exist
  in generated tables. Raw archive XML, including markup: Gregorian blocks ~2.9 MB
  across 929 locale files; `generic` ~1.4 MB; other calendars ~1.1 MB;
  `timeZoneNames` ~6.5 MB. These are not generated-size predictions.
- CLDR date data depends on intra-locale `<alias source="locale">` paths (856 in
  root alone); the RTF generator only rejects whole-locale aliases, so a resolver
  is new work.
- No skeleton matcher, pattern tokenizer or ToLocalTime record exists; non-ISO
  fields and objects require TEMPORAL-CAL.

## Design

### 1. Modules and contracts [proposal]

New internal modules in `packages/js-runtime/src/objects/`; no new package, so no
manifest, project-reference or `workspace-contracts.json` change.

- `date-time-format-data.ts` (generated) and `date-time-format-profile.ts`:
  `lookupDateTimeFormatLocale` and `dateTimeLocaleData(locale, calendar)` (symbols,
  styles, connectors, skeletons, appendItems, intervals, day periods, zone formats).
- `date-time-pattern.ts`: pure UTS 35 tokenizer (literals, quoted text, field
  runs), pattern↔Table 16 record mapping, skeleton distance and width adjustment,
  and symbol mapping (`MMM`→short month, `LLLL`→long stand-alone, `B`→`{dayPeriod}`,
  `a`→`{ampm}`).
- `date-time-format-records.ts`: records, both matchers, DateTimeStyleFormat,
  GetDateTimeFormat, AdjustDateTimeStyleFormat, range-pattern records.
- `date-time-local.ts`: ToLocalTime records (Gregorian and iso8601 here; other
  calendars delegate to TEMPORAL-CAL, §7).
- `date-time-format.ts`: pure pattern formatting (`isPlain` aware), range
  partitioning, day-period and zone-name rendering.
- `intl-date-time-format.ts`: `installDateTimeFormatIntrinsic`, plus exported
  `createDateTimeFormat` (locales, options, required, defaults, optional
  `toLocaleStringTimeZone`) and `formatDateTimeValue` (HandleDateTimeValue). Date
  and Temporal adapters use these, never public properties.

`DateTimeFormatter` holds locale, calendar, numberingSystem, timeZone (with resolved
zone), hourCycle, dateStyle, timeStyle, `dateTimeFormat` and the six nullable
Temporal sub-formats, a mutable `boundFormat`, and cached decimal formatters `nf`,
`nf2` (`minimumIntegerDigits: 2`) and `nf3` (only with `fractionalSecondDigits`).
The formatters come from `configureDecimalNumberFormatter` with null-prototype
options, so they stay unobservable, as the spec's `! Construct` requires.

### 2. Data contract and generator [proposal]

`tools/generate-date-time-format-data.ts CLDR49.zip` follows the relative-time
generator (checksum, member hashes in `date-time-format-data-manifest.json`,
formatted output, CLDR license). Inputs: `common/main/*.xml`, `supplementalData.xml`
(parents, calendarData), `dayPeriods.xml`, `metaZones.xml` (D7 only) and `bcp47`
files (identifier cross-checks). New resolution order: parent chain → root →
intra-locale path aliases after inheritance (`iso8601/months` → that locale's
`gregorian/months`); keep all pinned draft grades; fail closed on unresolved aliases.

Packed `key|value` rows with an interned pool (like `relativeTimeStrings`). Per
locale and calendar: months (format/stand-alone × narrow/abbreviated/wide;
leap-month slot reserved), weekdays, eras, AM/PM and flexible day periods, date and
time formats × 4, standard connectors × 4, availableFormats (default variant, not
`alt="ascii"`, so CLDR's U+202F before AM/PM stays; tests derive that space),
appendItems, intervalFormats and fallback. Per locale: gmt, gmtZero, hour, region
and fallback formats plus `Etc/UTC` names. Global: day-period rules. Calendars other
than `gregorian`, `generic` and `iso8601` get the generic patterns plus month and
era names (ownership: Q2).

**[default]** The registry is the 860 numeric-service tags, as for RTF, so every
locale has a decimal profile; `supportedLocalesOf` uses `lookupNumberFormatLocale`.
**[assumption]** Generated size is unmeasured; measure in D1, before zone names.

### 3. Constructor and option order [proposal]

Implement Temporal §15.4.1. Its observable order matches the ECMA-402
ResolveOptions refactor and `constructor-options-order.js`.

1. OrdinaryCreateFromConstructor via `constructorPrototype` with a new
   `"intl-date-time-format"` key, before any coercion (`proto-from-ctor-realm.js`).
2. CanonicalizeLocaleList, then CoerceOptionsToObject (null-prototype object for
   undefined; `taint-Object-prototype*.js`).
3. Reads: `localeMatcher`; `calendar` (RangeError on `type`-nonterminal failure
   before the next read); `numberingSystem` (same); `hour12` (Boolean); `hourCycle`
   (h11/h12/h23/h24). A non-undefined `hour12` makes `hc` null, which drops `-u-hc`
   from the resolved locale.
4. ResolveLocale with relevant keys `ca`, `hc`, `nu` (§4).
5. `timeZone` via Get. If undefined, use `toLocaleStringTimeZone` when present, else
   SystemTimeZoneIdentifier. If both are supplied, TypeError. Then ToString and
   resolve (§5).
6. Components in Table 16 order (weekday, era, year, month, day, dayPeriod, hour,
   minute, second via GetOption; `fractionalSecondDigits` via GetNumberOption 1–3,
   which calls `valueOf`; timeZoneName).
7. `formatMatcher`, `dateStyle`, `timeStyle`.
8. Style/component conflicts throw TypeError (including the `required` rules).
   Compute `bestFormat` and the six Temporal formats exactly as in §15.4.1.

Reuse the RTF `option()` shape (returning `undefined` when absent) and add
GetNumberOption (precedent: `intl-number-options.ts`). Errors use
`createRuntimeError`; missing host capabilities use `rejectUnsupportedExecution`.

### 4. Locale, calendar, numbering system and hour cycle [proposal]

- **Locale.** First requested tag in the numeric registry (`resolveNumberLocale`
  policy, shared by lookup and best fit).
- **`[[LocaleData]].ca` [default].** Start with `localeCalendars(L)`, filter to DTF
  AvailableCalendars, then append the remaining available calendars.
  AvailableCalendars is the 16 values `Intl.Era-monthcode` requires: buddhist,
  chinese, coptic, dangi, ethioaa, ethiopic, gregory, hebrew, indian, islamic-civil,
  islamic-tbla, islamic-umalqura, iso8601, japanese, persian, roc. `islamic` and
  `islamic-rgsa` therefore fall back to the locale default. `CanonicalizeUValue`
  maps aliases first (`islamicc`→`islamic-civil`, `ethiopic-amete-alem`→`ethioaa`).
  Consequence: CLDR non-Gregorian defaults stay (`th`→buddhist, `fa`→persian), so
  formatting in them needs §7.
- **`nu`.** The numeric locale's `numberingSystems`, default first (native,
  traditio and finance excluded); the `-u-nu` keyword and the option follow the
  existing ResolveLocale rules.
- **`hc`.** `hourCycle` is the first of `localeHourCycles(L)`; `hourCycle12` is the
  first of h11/h12 in that list, else h12 (`ja`→h11); `hourCycle24` is always `h23`
  **[default]**, which `hourCycle-default.js` requires for all eight locales it
  checks. After matching, substitute hour symbols (h11→K, h12→h, h23→H, h24→k)
  using the matched record's `pattern`/`pattern12` pair.

### 5. Time-zone resolution [proposal]

- **Offsets.** Accept only `UTCOffset[~SubMinutePrecision]` (`±HH`, `±HHMM`,
  `±HH:MM`, ASCII minus only) and store `FormatOffsetTimeZoneIdentifier` output.
  Reuse the `foundation/chrono/iso-date-time` offset parser but reject seconds. Today's
  `temporalTimeZone` accepts more and must not be used unchanged.
- **Named zones.** `realm.namedTimeZones.lookup`: `unknown` is a RangeError;
  `unavailable` is unsupported, never a guess. Store the case-normalized
  `identifier.identifier` (`UTC`, `Etc/GMT`, `Asia/Calcutta`) and keep the TZif
  model for ToLocalTime. Without a provider, UTC and offsets still work and named
  zones are unsupported.
- **Default.** `realm.systemTimeZoneIdentifier`, resolved the same way; unhosted is
  unsupported. **[assumption]** The native host's identifier always resolves
  through the provider.

### 6. Format records and matching [proposal]

- **Format list per locale and calendar,** built lazily and cached in the profile
  module: (1) every availableFormats skeleton parsed to a record, with `h`/`H`
  variants paired into `pattern12`/`pattern`; (2) date × time combinations glued
  with the standard connector (UTS 35 "Missing Skeleton Fields"); (3) appendItems
  for `fractionalSecondDigits` and `timeZoneName`. The generator asserts that all
  13 field subsets required by ECMA-402 §11.2.3 exist after synthesis.
- **BasicFormatMatcher:** literal §11.5.2, including timeZoneName offset/generic
  penalties.
- **BestFitFormatMatcher** must be at least as good as Basic. **[default]** UTS 35
  skeleton matching: closest available skeleton, then field-width adjustment;
  numeric↔text month substitution only when CLDR has no exact match. The record's
  fields are re-derived from the _final_ pattern so `resolvedOptions` reports what
  prints (`required-date-time-formats.js` forbids unrequested components). Basic is
  the fallback; every divergence gets a fixture.
- **Styles.** DateTimeStyleFormat uses CLDR `dateFormats`/`timeFormats` × 4 and the
  standard connector (`{1}, {0}` in `en`), never `atTime`. DateTimeRangeFormat
  records come from the combined skeleton's interval formats.
- **Range patterns.** `intervalFormats` keyed by greatest-difference symbol (G, y,
  M, d, a, B, h/H, m, s). `[[Default]]` is `intervalFormatFallback` (`{0} – {1}`)
  split into startRange/shared/endRange parts; range tests derive their separator
  from it.

### 7. ToLocalTime and the TEMPORAL-CAL contract [proposal]

`toLocalTime(epochNs, calendar, zone)`:

1. Offset: fixed zones use the stored offset; named zones use
   `temporalTimeZoneOffsetNanoseconds` with the formatter's TZif model.
2. Floor-divide to milliseconds and split fields. `gregory` uses `dateFields`, with
   Era BC/AD and year ≤ 0 → 1 − year at format time. `iso8601` uses the same split
   with ISO-calendar CLDR patterns and no era. Any other calendar calls the
   TEMPORAL-CAL contract below.
3. InDST: compare the zone's offset at the instant with its standard offset.
   **[assumption]** The TZif model exposes `isdst`; confirm before D7 (Q3).

The contract requested from TEMPORAL-CAL is a pure function plus a capability
predicate:

```ts
(calendar, isoYear, isoMonth, isoDay) =>
  | { era?, eraYear?, year, relatedYear?, yearName?,
      monthOrdinal, monthCode, isLeapMonth, day }
  | "unsupported"
```

Until it exists, a format call in a non-ISO, non-Gregorian calendar returns
`rejectUnsupportedExecution` _after_ full constructor resolution. Resolution-only
tests can pass; formatting tests are recorded as unsupported. Nothing is faked.

**Gregory Temporal objects.** HandleDateTimeTemporalYearMonth and MonthDay require
`object.[[Calendar]] === dtf.[[Calendar]]`. DTF defaults to `gregory`, so ISO
PlainYearMonth/PlainMonthDay values throw RangeError unless formatted with
`-u-ca-iso8601`. The 36 `gregory`-object files need TEMPORAL-CAL construction; its
smallest slice is Gregorian arithmetic identical to ISO plus era/eraYear.

### 8. Pattern formatting and parts [proposal]

Transcribe FormatDateTimePattern (Temporal §15.6.4, `isPlain` → `+00:00`).

- **Numeric fields** use `nf`/`nf2` with no grouping and the resolved numbering
  system. `2-digit` keeps the last two _code points_, not UTF-16 units (astral
  digits). Fractional seconds are `floor(ms × 10^(d−3))` through `nf3`.
- **Text fields** map short↔abbreviated and long↔wide. The UTS 35 letter (`M` or
  `L`) decides format vs stand-alone month context.
- **Part types:** `literal`, `weekday`, `era`, `year`, `month`, `day`, `dayPeriod`
  (also `ampm`), `hour`, `minute`, `second`, `fractionalSecond`, `timeZoneName`,
  `relatedYear`, `yearName`. A pattern letter without a Table 16 mapping becomes an
  `unknown` part, never dropped text.
- **Day periods** follow dayPeriods.xml rules for the resolved language (root
  fallback), with CLDR at/from semantics (`dayPeriod-*-en.js`).
- **Zone names.** D5: `shortOffset` (`GMT+5:30`), `longOffset` (`GMT+05:30`),
  `gmtZeroFormat`, and UTC short/long names. D7: metazone-based specific and
  generic names. Missing data falls back to the CLDR GMT form (generic: the
  identifier), which the spec permits.

### 9. Range formatting [proposal]

Transcribe PartitionDateTimeRangePattern. An `undefined` argument is a TypeError
before any coercion. Both arguments are coerced (ToNumber or ToDateTimeFormattable)
before per-endpoint TimeClip/NaN RangeError checks. `x > y` is allowed. Equal
relevant fields collapse to `shared` parts. Mixed Temporal types throw TypeError
via SameTemporalType; a ZonedDateTime throws TypeError via HandleDateTimeValue.
Only the range `toParts` method adds the `source` property.

### 10. Prototype surface, realm and brand isolation [proposal]

- **Constructor:** `length` 0; a call without `new` constructs and chains through
  `chainIntlLegacy`. `supportedLocalesOf` length 1; tag `"Intl.DateTimeFormat"`.
- **`format` getter:** unwraps with `unwrapIntlLegacy`, requires the brand, caches
  one anonymous length-1 builtin in the method realm. Undefined input uses
  `realm.wallClockMilliseconds` (unhosted is unsupported); otherwise
  ToDateTimeFormattable.
- **`resolvedOptions`:** unwraps; Table 15 order with conversions (`hour12` from the
  cycle, `fractionalSecondDigits` as Number); format fields only when no style is
  set; `hourCycle`/`hour12` only with an hour field (divergence 2).
- **Brand:** `formatToParts` and both range methods require
  `internalDateTimeFormatData` directly, without unwrapping. The brand is own-slot
  only; prototypes, `Object.create(dtf)` and proxies are rejected (RTF
  `requireFormatter`).
- **Results** use the _method_ realm's intrinsics. Internal NumberFormat/DTF
  construction never reads mutable globals (`taint-Intl-DateTimeFormat.js`).

### 11. Date and Temporal adapters [proposal]

- **Date.** Replace `localText` for the three locale methods: RequireInternalSlot;
  NaN returns `"Invalid Date"` before options are read; then (any, all),
  (date, date) or (time, time) and FormatDateTime.
- **Temporal (§15.11).** Instant and PlainDateTime use (any, all); PlainDate,
  PlainYearMonth and PlainMonthDay use (date, date); PlainTime uses (time, time).
  ZonedDateTime uses (any, all, `zdt.[[TimeZone]]`), then CalendarEquals, then
  passes the epoch directly through HandleDateTimeTemporalInstant (no
  user-visible Instant). Add the missing PlainDate, PlainYearMonth, PlainMonthDay
  and ZonedDateTime methods (name, length 0, brand). Remove the ISO-text
  fallbacks on Instant, PlainDateTime and PlainTime.

### 12. Cross-feature contracts

- **INTL-MISC [proposal]:** `supportedValuesOf("calendar")` must equal DTF
  AvailableCalendars (the 16), removing `islamic`/`islamic-rgsa` in `intl.ts`.
  **[assumption]** `Intl.Locale.prototype.getCalendars` uses `localeCalendars`
  and is unaffected. Returned `timeZone` and `numberingSystem` values already come
  from the same provider and numeric registry, so each constructs a DTF resolving
  to itself.
- **TEMPORAL-CAL [proposal]**, not designed here: the §7 calendar-field function;
  CLDR month/era names (or confirmation that DTF's generator owns them, Q2);
  construction of `gregory` and other non-ISO Temporal objects; `CalendarEquals`.

## Representation and native-subset constraints

- Generated data is packed strings with binary-search lookup and an interned pool;
  no large array or object literal initializers (`docs/intl-runtime.md`).
- Decode profiles lazily into module-level Map caches (as `named-time-zones.ts`);
  build format lists on demand. Keep epochs in BigInt `Integer` helpers, split with
  `splitTemporalEpochSecond`, never via unsafe `number` conversion.
- No Node, ICU or host-Intl calls; no RegExp in hot paths (hand-written tokenizer).
  Pure, allocation-light code serves live and AOT through the shared pipeline, with
  no compiler-specific path.

## Implementation slices

Each slice is independently verifiable: native checks use the shared compiler/AOT
pipeline under LLDB, one serial inferior at a time (`TINT_BUILD_ONLY=1` for hosted
fixtures), and each slice ends with fail-fast `pnpm check`.

- **D0 Red baseline.** Unchanged native selection of the 704 owned variants as a new
  immutable report; the 56 adjacent built-in variants recorded separately.
- **D1 Data generator.** Alias/inheritance resolver; Gregorian, generic and iso8601
  tables; day-period rules; manifest; license. Unit tests: alias closure, the 13
  required subsets per locale/calendar, spot vectors against CLDR XML (not Node).
  Record the generated size.
- **D2 Pattern core.** Tokenizer, record mapping, both matchers, style and range
  records; pure unit tests (exact penalty cases) and a native fixture.
- **D3 Constructor, `resolvedOptions`, `supportedLocalesOf`.** §10 wiring, option
  order, ca/nu/hc resolution, all zone kinds, legacy chaining; formatting may stay
  unsupported. Targets: constructor files, `resolvedOptions/*`, `supportedLocalesOf`.
- **D4 Gregorian `format`/`formatToParts`** for Numbers and Dates: fields, eras,
  `ampm`, fractional seconds, UTC names, bound format. Targets: `prototype/format*`
  without Temporal or non-ISO inputs; native realm, taint and brand fixtures.
- **D5 Date adapters and offset/UTC zone names.** Targets: `intl402/Date/*`,
  `timedatestyle-en.js`, offset `timeZoneName` styles.
- **D6 Range.** Interval data, `formatRange`, `formatRangeToParts`.
- **D7 Day periods and zone names.** Flexible day periods; metazone names after a
  measured size decision. Targets: dayPeriod and extend-timezonename tests.
- **D8 Temporal integration.** ToDateTimeFormattable, HandleDateTime*, sub-formats,
  Temporal `toLocaleString`, missing built-in methods. Targets: Temporal-input tests
  using ISO or `-u-ca-iso8601` and Temporal `toLocaleString` tests not blocked on
  TEMPORAL-CAL.
- **D9 Non-ISO formatting.** Consumes the §7 contract (names, `relatedYear`,
  `yearName`, leap months); not schedulable until TEMPORAL-CAL publishes it.

Ordering: D1 → D2 → D3 → D4. D5, D6 and D7 depend only on D4 and can be reordered.
D8 needs D4 (and D6 for its range tests). D9 needs D8 and TEMPORAL-CAL. The
INTL-MISC calendar-list change can land with D3.

## Validation

- **Per slice:** semantic unit tests (ordering, abrupt completion, boundaries);
  native regressions in a new `tools/verify-test262-native-date-time-format.ts`;
  then an unchanged native selection for the slice's directories as a new immutable
  report. A full `intl402/DateTimeFormat` (490) figure comes only from one complete run.
- **Evidence separation:** Node 24.12 (ICU 77.1, CLDR 47) probes are references
  only; pinned CLDR is 49, and Node still resolves `islamic` and lists 18 calendars.
  Node, unit and fixture results never count as native conformance or get summed.
- **Self-hosting:** finish with a frozen-source self-build and stage-image
  comparison, as RTF did; record the observed build, not a predicted cost. Do not
  touch running v9 journals, frozen toolchains or native queues.

## Unresolved questions

- **Q1 Locale breadth.** [default] 860 numeric tags; if D1's size is unacceptable,
  a smaller explicit registry with honest `supportedLocalesOf`.
- **Q2 Non-Gregorian names.** DTF generator or TEMPORAL-CAL owns the month, era and
  cyclic-year names? D1 reserves slots; the TEMPORAL-CAL plan decides.
- **Q3 InDST.** TZif `isdst` vs offset comparison; check `chrono/tzif` exposure.
- **Q4 Metazones.** D7 subset, or the full `metaZones.xml` history?
- **Q5 Default `hc` source.** `timeData` preferred vs the hour symbol of the short
  time pattern. They agree for the tested locales; record divergences D1 finds.
- **Q6 Upstream text.** Record divergences 1, 3 and 4; never silently "fix" them.

**Independent dependencies.** Present [current]: NumberFormat, locale
canonicalization, CLDR 49 helpers, TZif and named zones, host zone/clock hooks,
legacy chaining. External: TEMPORAL-CAL (D9, the 36 `gregory` files),
INTL-COLLATOR (`testIntl.js`), INTL-DURATIONFORMAT.

## Next planning recommendation

Plan **TEMPORAL-CAL** next, scoped by §7 and §12. Its first deliverable should be
the pure calendar-field contract plus a `gregory`/`buddhist`/`roc`/`japanese` slice
(Gregorian arithmetic with offset eras). That unblocks DTF D9, the 36
`gregory`-object files and the `th` / `ja-u-ca-japanese` default-calendar paths.
It should settle Q2 before DTF D1 freezes the table layout.
