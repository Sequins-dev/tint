# TEMPORAL-CAL: non-ISO calendars, eras and month codes

Planning document captured 2026-11-04. It records planning facts and proposals, not
run evidence. No non-ISO native selection exists; every population below is
**unmeasured**. Labels: **[current]** verified in source on 2026-11-04;
**[verified]** checked against a primary source or the pinned tests;
**[proposal]** recommended design; **[assumption]** premise to confirm in the named
slice; **[reference]** a Node/ICU observation, never conformance evidence.

## Scope

In scope: the 15 non-ISO calendars and two aliases required by `Intl.Era-monthcode`;
calendar identifier canonicalization; eras, arithmetic years, month codes and leap
months; calendar-sensitive Temporal operations (field read/merge/resolve,
overflow, `add`/`subtract`, `since`/`until`, `with`, `withCalendar`, year-month and
month-day reference dates, getters, `equals`/`compare`, string annotations); and
the calendar-field and name-key contracts that `Intl.DateTimeFormat` consumes.

Out of scope: DateTimeFormat itself ([INTL-DTF](intl-dtf.md) keeps its slices);
ISO Temporal arithmetic, rounding and zones (TEMPORAL-CORE);
`Duration.prototype.toLocaleString` (INTL-DURATIONFORMAT); and
`supportedValuesOf` lists other than calendars.

## Authoritative sources

Primary sources only. Plain-text extracts are in `/tmp/tint-calendar-plan/spec` and
`/tmp/tint-intl-dtf-plan/spec`.

- **Intl era and monthCode proposal**, Stage 4 draft 2026-03-19
  (<https://tc39.es/proposal-intl-era-monthcode/>): Tables 1–4 and 6 (calendar
  types, eras, extra month codes, epoch years, chinese/dangi reference years) and
  §4.1.1–24 (CalendarSupportsEra … NonISOResolveFields, including NonISODateAdd,
  NonISODateUntil and NonISODateSurpasses). It supersedes Temporal §12.2–12.3 for
  non-ISO calendars.
- **Temporal Stage 4 draft 2026-07-27**: §12.1 CanonicalizeCalendar, §12.2 month
  codes, §12.3.3 PrepareCalendarFields, §12.3.5 CalendarMergeFields, §12.3.7–16
  (add, until, from-fields, FormatCalendarAnnotation, CalendarEquals).
- **ECMA-402 draft 2026-10-23**: §6.9.1 AvailableCalendars, §8.3.2
  `supportedValuesOf` (canonical ids only), and CalendarsOfLocale (which filters by
  AvailableCalendars).
- **CLDR 49** (`.tint-bootstrap/cldr-core-49.zip`, the existing pin):
  `bcp47/calendar.xml` (aliases), `supplementalData.xml` `calendarData` (era codes,
  aliases and starts) and `common/main/*.xml` (names).
- **Iranian calendar authority** leap table, 1206–1498 AP, pinned by
  `intl402/Temporal/PlainDate/prototype/inLeapYear/persian-calendar-authority.js`.

### Identifier facts [verified]

- **AvailableCalendars has 18 entries.** It is `iso8601` plus every Table 1 row:
  15 non-ISO calendars and the aliases `ethiopic-amete-alem` (→ `ethioaa`) and
  `islamicc` (→ `islamic-civil`). Aliases are mandatory ("either both or
  neither"). The INTL-DTF plan's "16" is the _canonical_ count.
- **`supportedValuesOf("calendar")` returns exactly 16:** buddhist, chinese,
  coptic, dangi, ethioaa, ethiopic, gregory, hebrew, indian, islamic-civil,
  islamic-tbla, islamic-umalqura, iso8601, japanese, persian, roc
  (`calendars-required-by-intl-era-monthcode.js` asserts the exact array).
- **`islamic` and `islamic-rgsa` are not Temporal calendars.** Temporal
  CanonicalizeCalendar throws RangeError, as ten `intl402/Temporal/*/from/islamic*.js`
  files assert. Only DTF falls back. The draft maps a resolved `islamic` to
  `islamic-tbla`. The pinned test cites an older step that covered both ids and
  accepts any available calendar. Both versions are satisfied when DTF
  [[LocaleData]] omits the two ids. CLDR 49 still lists both as valid, undeprecated
  types, so `Intl.Locale` keeps accepting them.
- **Canonicalization** is ASCII-lowercase membership, then CanonicalizeUValue
  (`ISLAMICC` → `islamic-civil`). `gregorian` is a CLDR alias but not a Table 1
  row, so it is rejected. `TemporalHelpers.NotYetSupportedCalendars` (bangla …
  vikram) must throw RangeError (22 `future-calendar.js` files).
- **Removal recommendation.** Drop `islamic`/`islamic-rgsa` from Temporal
  canonicalization and from `supportedValuesOf`/DTF AvailableCalendars, and add the
  two aliases. Locale keyword validation is unchanged. CalendarsOfLocale then
  omits them from `getCalendars()` defaults (`ar-SA` → `gregory,islamic-umalqura`);
  an explicit `-u-ca-islamic` is returned as stored.

## Pinned population

Revision `91c70759…5ba`. A read-only text scan
(`/tmp/tint-calendar-plan/scripts/inventory.mjs`) uses the repository variant
policy (`module`, `raw`, `onlyStrict` and `noStrict` give one variant, others
two). A file counts if it has the `Intl.Era-monthcode` feature or a calendar
literal (`"x"`, `u-ca=x`, `-u-ca-x`). These are populations, not expected gains;
overlapping rows are not summed.

- **Calendar-relevant:** 1,920 files / 3,840 variants; 1,566 / 3,132 are tagged
  `Intl.Era-monthcode`.
- **By owner:** `intl402/Temporal` without `toLocaleString`, 1,803 / 3,606;
  DTF-owned (DateTimeFormat, `intl402/Date`, Temporal `toLocaleString`), 61 / 122;
  Locale, `Intl` and root `intl402` files, 21 / 42; `built-ins/Temporal`, 35 / 70.
  The built-ins are mostly `[u-ca=hebrew]` annotations that ISO paths already
  ignore, so they are text-scan false positives until measured.
- **`intl402/Temporal` overall:** 2,029 files / 4,058 variants, 340 of them recorded
  ([inventory](../test262-inventory.md)). The remainder is DTF `toLocaleString` and
  TEMPORAL-CORE zone/duration tests. ZonedDateTime `since`/`until` (0/134 and
  0/132, all unsupported) contain 116 calendar-relevant files.

**Cumulative slice sets** (non-DTF files whose named calendars all fall within the
cumulative set; each file is counted in its first slice only):

- C0 identifiers (no calendar named, or only `islamic`/`islamic-rgsa`): 46 / 92.
- C1 + gregory, buddhist, roc, japanese: 603 / 1,206.
- C2 + tabular Islamic, coptic, ethiopic, ethioaa, indian, persian: 651 / 1,302.
- C3 + hebrew: 158 / 316. C4 + islamic-umalqura: 98 / 196.
- C5 + chinese, dangi: 303 / 606.

Single-family files: Gregorian-arithmetic 639, coptic/Ethiopic 275,
chinese/dangi 264, tabular Islamic 211, hebrew 155, persian 84, umalqura 83,
indian 74; 46 files name six or more families. The largest groups are
`add`/`subtract`/`with`/`since`/`until` on PlainDate, PlainDateTime and
ZonedDateTime (about 46 variants per operation for the Gregorian family alone).

## Current capabilities and gaps [current]

- **Slots** already follow the spec model: ISO fields plus
  `internalTemporalCalendar: string` (`operations.ts:74–81`). Non-ISO support
  needs **no slot or layout change**.
- **Canonicalization.** `temporal-coercion.ts` `canonicalTemporalCalendar` accepts
  18 ids, wrongly including `islamic`/`islamic-rgsa` and missing both aliases.
  `requireISOCalendar` maps every non-ISO id to `rejectUnsupportedExecution`; 12
  files reach it, and about 28 `temporal-*.ts` files hard-code ISO.
- **ISO engine.** `foundation/chrono/gregorian-calendar`: epoch-day conversion,
  `addGregorianDate`, jump-based `differenceGregorianDates`, ISO weeks and
  `maximumCalendarEpochDay`. Native coverage comes from
  `tools/verify-hosted-gregorian-calendar.ts`.
- **Fields.** `temporal-date-fields.ts` `readTemporalDateFields` reads a fixed
  sorted list with no `era`/`eraYear`. `mergeISODateFields` does only the ISO
  month/monthCode pairing, and `regulateISODateFields`/`resolveISOFieldMonth` do
  ISO overflow. `temporal-month-code.ts` `parseMonthCodeText` is ParseMonthCode.
- **Getters.** `temporal-calendar-fields.ts` `installISOCalendarAccessors` derives
  all 16 from ISO. Non-ISO calendars must return `undefined` for
  `weekOfYear`/`yearOfWeek` (Calendar Date Record Note 5; `non-iso-week-of-year.js`).
- **Partial dates.** `temporal-partial-date*.ts` range-check non-ISO strings, then
  report them unsupported (correct ordering).
- **Locale data.** `locale-data.ts` `localeCalendarTypes` has the same 18. The
  `u:ca` alias rows and CLDR preferences exist. `locale-info.ts` feeds
  `supportedValuesOf` and `Intl.Locale` (`getCalendars` is 16/16 natively).
- **Generators.** `tools/generate-locale-data.ts` and the relative-time generator
  provide checksum pins, manifests and packed `key|value` tables
  (`docs/intl-runtime.md`).
- **Missing entirely:** non-ISO conversion, eras, leap months,
  CalendarExtraFields, CalendarFieldKeysToIgnore, and any lunisolar or Umm al-Qura
  data.

## Design

### 1. Layering and ownership [proposal]

- **`packages/foundation/src/chrono/calendar-systems/`** is a new subpath of the
  existing package: an `exports` entry and a catalog regeneration, with no new
  package or `workspace-contracts.json` change. It holds pure, realm-free,
  number-only code: `index.ts` (dispatch and types), `eras.ts` (Tables 2 and 4),
  `month-codes.ts` (Tables 3 and 6), `solar.ts`, `islamic.ts`, `hebrew.ts`,
  `lunisolar.ts`, `arithmetic.ts` (add, until, balance, surpasses) and
  `calendar-data.ts` (generated). It reuses `gregorian-calendar`.
- **js-runtime** (`temporal-calendar*.ts`) owns property order, coercion, error
  choice, Calendar Fields Records, merge/resolve and getters. It is Temporal's only
  caller of the foundation module.
- **INTL-DTF** calls the same foundation functions through §11, never through
  Temporal objects. It owns all localized text.

### 2. Core types and functions [proposal]

```ts
type NonISOCalendar = "gregory" | "buddhist" | "roc" | "japanese" | "coptic"
  | "ethiopic" | "ethioaa" | "indian" | "persian" | "islamic-civil"
  | "islamic-tbla" | "islamic-umalqura" | "hebrew" | "chinese" | "dangi";
interface CalendarDate {                     // Table 5 subset; MonthCode exists
  year: number; month: number; monthCode: MonthCode; day: number;
  era: string | undefined; eraYear: number | undefined; dayOfYear: number;
  daysInMonth: number; daysInYear: number; monthsInYear: number;
  inLeapYear: boolean;
}
calendarDateFromEpochDay(cal, epochDay): CalendarDate | undefined
epochDayFromCalendarDate(cal, year, ordinalMonth, day): number | undefined
monthsInCalendarYear(cal, year): number | undefined
daysInCalendarMonth(cal, year, ordinalMonth): number | undefined
absoluteCalendarMonth(cal, year, ordinalMonth): number | undefined  // + inverse
```

- `undefined` means the input lies outside the calendar's **computable span** (§8).
  It never means "unimplemented".
- Weekday is ISO for all calendars, `daysInWeek` is 7, and non-ISO calendars have
  no week-of-year API. `iso8601` is dispatched first and never enters this module,
  so the existing ISO code and its native validation stay unchanged.

### 3. Eras and arithmetic years [proposal; rules verified]

- **Data** transcribes Table 2 (codes, aliases, eraYear bounds, kind
  epoch/negative/offset, offset) and Table 4. It agrees with CLDR 49: japanese has
  exactly five coded eras (meiji 1868-10-23, taisho 1912-07-30, showa 1926-12-25,
  heisei 1989-01-08, reiwa 2019-05-01) plus gregorian `bce`/`ce`.
- **`canonicalizeEra`** maps a code or alias (`ad`/`bc` for gregory and japanese)
  after ToString and is case-sensitive. **`arithmeticYearForEra`** follows
  §4.1.12: epoch → eraYear, negative → 1 − eraYear, offset → offset + eraYear − 1.
  Table 2's eraYear bounds never reject. Resolve erases era/eraYear, so regnal
  years remap (Reiwa 1 in January → Heisei 31; `remapping-era.js`,
  `era-boundary-japanese.js`).
- **Era of a date.** The Gregorian family follows the ISO year. Japanese uses the
  latest era start on or before the date, and `ce`/`bce` up to 1872-12-31, which is
  why Meiji's minimum eraYear is 6. Ethiopic is `aa` while the AM year is ≤ 0
  (eraYear = year + 5500). Islamic uses `ah`/`bh`, and roc uses `roc`/`broc`.
  Chinese, dangi and iso8601 have no eras (`calendar-not-supporting-eras.js`).
  CalendarHasMidYearEras is true only for `japanese`.

### 4. Month codes and overflow [proposal; per §4.1.4–7, 4.1.20]

- M01–M12 are always valid. M13 applies to coptic, ethiopic and ethioaa; M05L to
  hebrew (skip-forward → M06); and M01L–M12L to chinese/dangi (skip-backward →
  M##). `parseMonthCodeText` stays the syntax check. Calendar validity is checked
  in Resolve, after options.
- `yearContainsMonthCode`, `constrainMonthCode` and `monthCodeToOrdinal` take the
  leap-month position from the year record, never from a walk. Overflow
  `constrain` clamps the month and then the day; `reject` throws RangeError.

### 5. Fields: read, merge, resolve [proposal]

- **Read.** `readTemporalDateFields` takes the calendar. For era calendars, when
  `year` is requested, `era` (ToString) and `eraYear` (ToIntegerWithTruncation)
  enter the sorted order: `day`, `era`, `eraYear`, `hour`, … `month`, `monthCode`,
  … `year`. The `calendarresolvefields-error-ordering-*` tests and harness
  observers check this order.
- **Merge.** One CalendarMergeFields with NonISOFieldKeysToIgnore replaces
  `mergeISODateFields`. `month` and `monthCode` exclude each other. In era
  calendars, any of era/eraYear/year drops all three. In japanese,
  day/month/monthCode also drop era/eraYear.
- **Resolve** transcribes §4.1.24's TypeError/RangeError sequence literally. It
  runs after the overflow option is read, as today. Fields use one plain record
  type for every calendar, with `undefined` meaning unset.

### 6. Add and until [proposal]

- **NonISODateAdd** (§4.1.18) is transcribed literally, except that BalanceNonISODate
  uses `absoluteCalendarMonth` (O(1)) and weeks/days use epoch-day arithmetic.
  The result must satisfy ISODateWithinLimits.
- **NonISODateUntil** (§4.1.19) is specified as per-unit candidate loops: about
  550,000 iterations for years and about 6.8 million for months at the limits.
  Implement an **equivalent jump**: estimate years from the arithmetic-year
  difference and months from the absolute-month difference, then correct with the
  monotone NonISODateSurpasses until the loop postcondition holds. This is the
  pattern `differenceGregorianDates` already uses. **[assumption]** At most two
  correction steps per unit; unit tests prove it against a literal loop
  transcription.
- A single js-runtime dispatch, `calendarDateAdd`/`calendarDateUntil`, replaces the
  direct Gregorian calls in date arithmetic and difference, the zoned modules, and
  Duration `round`/`total` with `relativeTo`.

### 7. Year-month and month-day [proposal]

- **PlainYearMonth** stores the ISO date of the month's first day. Limits apply to
  that date (`extreme-unsupported-dates.js` pins the first and last month per
  calendar).
- **PlainMonthDay** follows §4.1.21. It uses the latest ISO year in 1900–1972
  containing the month code and day, else the earliest in 1973–2035. Chinese and
  dangi use Table 6 literally, including "—" rows and the split M11L row. A supplied
  `year` gets a cheap span check before any month data is computed
  (`dont-calculate-month-info-for-out-of-range-year.js`). Reference years are
  precomputed per month code by the generator or in closed form.

### 8. Calendar families and range requirements

Each family converts every date in ISODateWithinLimits (−271821-04-19 …
+275760-09-13) and ±1 arithmetic year beyond, for balancing. The **computable
span** is that interval widened by two years. The pinned `extreme-dates.js`
vectors give exact endpoints (persian −272442 M01 9 … 275139 M07 12; hebrew
−268058 M11 4 … 279517 M09 11) and serve as unit anchors. Epochs are CLDR 49 era
starts in proleptic Gregorian **[verified]**. Constants are **[assumption]** until
each slice's vectors pass.

- **Gregorian family (C1).** ISO identity. Year offsets: gregory/japanese 0,
  buddhist +543, roc −1911. Japanese needs only the five era starts.
- **Coptic, ethiopic, ethioaa (C2).** Twelve 30-day months plus M13 of 5 or 6
  days; leap when `year mod 4 = 3`. Epochs 284-08-29, 8-08-27 and −5492-07-17.
- **Indian (C2).** Saka year = ISO year − 78. The year starts 22 March (21 March in
  Gregorian leap years). Chaitra has 30 or 31 days, months 2–6 have 31, 7–12
  have 30.
- **Persian (C2).** 33-year rule: leap when `(25y + 11) mod 33 < 8`. A read-only
  check matched the authority list for all 293 pinned years 1206–1498
  **[verified]**, so no correction table is needed for these tests. Era `ap`
  starts 622-03-21. Months 1–6 have 31 days, 7–11 have 30, 12 has 29/30;
  `persian-new-year-dates.js` pins Nowruz.
- **Tabular Islamic (C2).** Leap years 2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29 of 30. Months alternate 30/29, and month 12 has 30 in leap years. Civil epoch
  622-07-19, tbla 622-07-18.
- **Hebrew (C3).** Molad arithmetic in integer parts with the four postponements.
  Leap years are 3, 6, 8, 11, 14, 17, 19 of 19. Heshvan and Kislev vary
  (`hebrew-keviah.js`). Ordinals are Tishrei-first, M05L is Adar I and M06 is
  Adar/Adar II. Peak intermediates ≈ 3×10¹² parts (safe).
- **Umm al-Qura (C4).** Month-length bits for 1300–1600 AH plus one anchor epoch
  day; tabular civil outside that range.
- **Chinese and dangi (C5).** Exact data for chinese years 1899–2100 and dangi
  1899–2050 (UTC+8 and the Korean meridian). `chinese-calendar-dates.js` starts at
  1899 M12, and `extreme-dates.js` needs ISO 1900-01-31 … 2101-01-28 exact.
  Outside the data, an implementation-defined approximation must still construct
  ±250,000 years. **[proposal]** Use a mean-value model in exact integer arithmetic
  (lunation 2,551,443 s; tropical year as a rational in seconds; months start at
  mean new moons; solstice-to-solstice years; the leap month is the first without
  a mean major term), spliced so that years tile without gaps. This avoids libm
  transcendentals that could differ between Node and native output. The pinned
  leap-month tests accept ICU4X or ICU4C answers and skip absent combinations, so
  determinism and test tolerance alone do not establish conformance. Before
  enabling this approximation, verify calendar invariants, round trips, monotonic
  continuity and table-boundary behavior across the supported range, and document
  its accuracy and consistency. Do not tune to gaps in the tests.

### 9. Data, caching and native encoding [proposal]

- **Generator.** `tools/generate-calendar-data.ts` emits `calendar-data.ts` as
  packed base-36 strings with checksums and a manifest. Contents: chinese/dangi
  year records (new-year delta, 13-bit month lengths, leap index), Umm al-Qura
  bits, and Table 6 reference years. Inputs are committed `tools/data/calendar-*.txt`
  tables with provenance headers (Q1). It emits no large literals.
- **Invariants:** months of 29 or 30 days, years of 12 or 13 months, valid leap
  codes, tiling years, and matches with pinned spot vectors (used as checks, not as
  a source).
- **Caches.** Lazily decoded module-level `Map<number, YearRecord>` for
  table-driven calendars (the `named-time-zones.ts` pattern), plus a last-year
  entry. Arithmetic calendars use closed forms.
- **Native subset:** safe-integer `number` math, with no BigInt on hot paths, no
  RegExp and no host Intl. Live and AOT share the normal pipeline, with no C
  intermediate or platform linker.

### 10. Errors versus unsupported [proposal]

- RangeError covers only spec cases: unknown or deprecated ids, invalid era or
  month code, `reject` overflow, out-of-limits results, and inconsistent
  month/monthCode or era/year.
- **Gate.** `calendarImplemented(cal)` replaces `requireISOCalendar` and gains
  families slice by slice. A valid operation in a gated calendar reaches
  `rejectUnsupportedExecution` only _after_ every spec-ordered step before calendar
  computation (field reads, option reads, syntax RangeErrors). It is never
  computed as ISO or reported as a RangeError.

### 11. DTF contract and name ownership [proposal]

This refines INTL-DTF §7; DTF's slices are unchanged.

```ts
calendarFieldsForFormatting(cal, isoYear, isoMonth, isoDay):
  | { era?: string; eraYear?: number; year: number; relatedYear?: number;
      cyclicYear?: number /* 1–60, chinese/dangi */; month: number;
      monthCode: MonthCode; day: number; inLeapYear: boolean }
  | "unsupported"
cldrMonthSymbolKey(cal, monthCode, inLeapYear):
  { index: number; leapYearVariant: boolean; leapPattern: boolean }
```

- `era` is the Table 2 code. DTF keys era names by the CLDR 49 `code` attribute
  (era `type` → code), so no index map is shared. `relatedYear` is the ISO year in
  which a chinese or dangi year begins.
- `cldrMonthSymbolKey` holds the calendar semantics. Hebrew: M01–M05 → 1–5,
  M05L → 6, M06 → 7 (`yeartype="leap"`, "Adar II", in leap years), M07–M12 → 8–13.
  Chinese/dangi: M## or M##L → ##, plus the leap `monthPattern`. M13 → 13. All
  others are the identity.
- **Names decision (resolves INTL-DTF Q2): the DTF generator owns all localized
  calendar text**: months (both contexts, three widths), leap patterns, era names
  and `cyclicNameSets`. TEMPORAL-CAL owns codes and name keys. Rationale: Temporal
  exposes no localized names, and `common/main` parsing, the intra-locale alias
  resolver (chinese `monthPatterns` use `alias source="locale"`), size
  measurement and licensing already live in DTF D1. One CLDR reader cannot drift.
  **Before D1 freezes its layout,** reserve per-calendar rows for month indices
  1–13, the leap-year variant, `monthPatterns` and `cyclicNameSets`.
- `compare-to-temporal.js` requires DTF numeric year/month/day to equal Temporal
  `eraYear ?? year`/`month`/`day` across 1950–2050 for 12 calendars. Sharing one
  function guarantees that by construction.

## Implementation slices

Each slice ends with fail-fast `pnpm check`. Native work uses the shared AOT
pipeline under LLDB, one serial inferior at a time (`TINT_BUILD_ONLY=1` for hosted
fixtures), and asserts both the stopped-at-entry and final exit states. Each slice
gets a new frozen source snapshot and an immutable report of an **unchanged**
Test262 selection. The parent's live queues, journals and v9 snapshots are not
touched.

- **C0 Identifiers and gate.** AvailableCalendars becomes 18 (with aliases,
  without islamic/rgsa) and `supportedValuesOf` becomes 16. Add
  `calendarImplemented`, canonical `internalTemporalCalendar`,
  `calendarId`/FormatCalendarAnnotation, CalendarEquals, and non-ISO pass-through
  for `withCalendar`/`equals`/`compare`. Selection: the 46 C0 files, the 10
  `islamic*` files, 26 `canonicalize-calendar.js` files,
  `supportedValuesOf/calendars*` (DTF-dependent files stay unsupported), and an
  `intl402/Locale` rerun.
- **C1 Engine and Gregorian family.** Foundation skeleton, eras, month codes,
  read/merge/resolve, add/until, getters (non-ISO weeks undefined), year-month and
  month-day, and gregory, buddhist, roc and japanese. It publishes §11
  (`"unsupported"` for later families), which unblocks DTF D9 for these calendars
  and the 36 `gregory`-object DTF files. Selection: the C1 set (603 files). New
  native fixture `tools/verify-hosted-calendar-systems.ts` covers boundaries, era
  remapping, and add/until against literal-loop oracles.
- **C2 Arithmetic calendars:** coptic, ethiopic, ethioaa, indian, persian,
  islamic-civil and islamic-tbla, all closed-form with no data. Selection: the C2
  set (651 files). The fixture adds extreme-date and Nowruz vectors.
- **C3 Hebrew:** the first leap-month calendar (M05L constrain/reject, ordinal
  shifts, M05L reference year 1970). Selection: the C3 set (158 files).
- **C4 Umm al-Qura:** generator, table and civil fallback. Selection: the C4 set
  (98 files).
- **C5 Chinese and dangi:** data, approximation, Table 6, and
  `cyclicYear`/`relatedYear`. Selection: the C5 set (303 files). The fixture adds
  boundary tiling and ±250,000-year construction.
- **C6 Consolidated rerun:** the complete `intl402/Temporal` (4,058 variants) as
  one unchanged selection. Remove the gate once it is all-true. ZonedDateTime
  `since`/`until` results come from this run, not from slice sums.

Order: C0 → C1 → C2, C3 and C4 (independent) → C5 → C6. DTF D9 starts after C1
and widens per slice.

## Validation

- **Unit tests:** round trips across each computable span (sampled and boundary
  days), leap-cycle and era edges, month-code constrain/reject tables, read order
  with observers, ignore-key merges, abrupt-completion order, and the jump-until
  against a literal §4.1.19 transcription on bounded spans.
- **Native:** extend the hosted fixture each slice so generated tables run
  natively. Run a frozen-source self-build and stage-image comparison at C1 and
  C6, recording only observed results.
- **Evidence separation:** native reports, unit tests, fixtures and Node probes
  never share a total. The slice sets are planning sets; only C6 measures
  `intl402/Temporal`.
- **Node limits [reference].** Node 24.12 ships ICU 77.1 and CLDR 47; the pin is
  CLDR 49. `node --harmony-temporal` aborts (V8 "unimplemented") on non-ISO `era`,
  so it is no Temporal oracle. Its DateTimeFormat uses Julian dates before 1582 for
  the Gregorian family (buddhist minimum shown as 11/20). For coptic, ethiopic,
  hebrew, indian, persian and Islamic calendars, its −271821-04-20 output matched
  the pinned vectors, one day after Temporal's minimum. It still lists 18
  calendars, including islamic and rgsa. Resolve any discrepancy against the
  spec, not Node.

## Unresolved decisions

- **Q1 Data provenance (C4/C5).** Primary publishers are KACST (Umm al-Qura), PMO
  (GB/T 33661-2017) and the Hong Kong Observatory (chinese), and KASI (dangi).
  Their redistribution terms are **unverified**. Default: committed transcriptions
  that cite the primary publication, cross-checked against Unicode-licensed
  ICU4C/ICU4X data and the pinned vectors. Licence approval is needed before C4.
- **Q2 Chinese approximation.** Default: the §8 mean model. Reingold–Dershowitz
  astronomy needs libm parity across targets, so use it only at generator time,
  if at all.
- **Q3 Pre-1899 exact data.** No pinned test requires it. Default: none.
- **Q4 Locale defaults.** Confirm in the C0 rerun that `getCalendars` stays 16/16
  after islamic/rgsa leave CalendarsOfLocale.
- **Q5 Upstream note.** Record the test's two-id fallback step versus the draft's
  `islamic` → `islamic-tbla` step. Both conform, so behaviour does not change.

## Next planning recommendation

Plan **INTL-DURATIONFORMAT** (220 variants) next. Its dependencies (NumberFormat,
ListFormat) are present, it is independent of the v9 survey and of this plan's
data, and it owns `Duration.prototype.toLocaleString`, the last Temporal
formatting surface that INTL-DTF excluded.
