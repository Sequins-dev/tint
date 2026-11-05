# INTL-DURATIONFORMAT: Intl.DurationFormat and Duration.prototype.toLocaleString

Planning document captured 2026-11-04. It records planning facts and proposals, not
run evidence. No native DurationFormat run exists; every population below is
**unmeasured**. Labels: **[current]** verified in source or data on 2026-11-04;
**[proposal]** recommended design; **[assumption]** unvalidated premise to confirm
in the named slice; **[default]** conservative choice a decision may change. Node
probes are references only; test tolerance never proves conformance.

## Scope

In scope: `Intl.DurationFormat` (constructor, `supportedLocalesOf`,
`resolvedOptions`, `format`, `formatToParts`); `Temporal.Duration.prototype.
toLocaleString` under ECMA-402; the NumberFormat **duration-unit** capability that
both the algorithm and the Test262 harness need; and CLDR 49 data contracts for
unit patterns and digital separators.

Out of scope: NumberFormat units outside the ten duration units (stay unsupported,
owned by the NumberFormat row), `Intl.supportedValuesOf("unit")` (INTL-MISC), and
INTL-DTF. DurationFormat has no calendar, time-zone or TEMPORAL-CAL dependency.

## Pinned population

Revision `91c70759…5ba`, read-only metadata scan with the repository variant policy
(`tools/test262.ts`). No owned file has `onlyStrict`, `noStrict`, `raw` or `module`,
so every file yields two variants. The v67 inventory records
`intl402/DurationFormat` as 220 variants, 0 recorded.

**Directly owned: 112 files / 224 variants.**

- `intl402/DurationFormat`: 110 files / 220 variants. Features: all tag
  `Intl.DurationFormat` except one untagged file; `Temporal` 6 files,
  `Reflect.construct` 2, `Symbol.toStringTag` 2. Includes: `testIntl.js` 39,
  `propertyHelper.js` 18, `compareArray.js` 4, `isConstructor.js` 2,
  `temporalHelpers.js` 1.
- `intl402/Temporal/Duration/prototype/toLocaleString`: 2 files / 4 variants
  (`returns-same-results-as-DurationFormat.js` over `undefined`, `en`, `de`,
  `th-u-nu-thai`, `["ar-u-nu-arab"]` × `{undefined, {style:"long"}}`;
  `taint-duration-prototype.js`).

**What the 110 DurationFormat files exercise** (classification by body scan;
per-file list in `/tmp/tint-durationformat-plan/probe/classify.txt`):

| Class                                                                                                                                                                | Files | Needs                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | -------------------------------------------------------- |
| R: construction, options, `resolvedOptions`, `supportedLocalesOf`, property surface                                                                                  |    50 | Constructor slice only                                   |
| E: argument errors and method shape (`invalid-*`, `not-a-constructor`)                                                                                               |     6 | Methods; throws before formatting                        |
| X: format with literal expectations or self-consistency (digital strings, out-of-range "returns a string", Temporal object/string/taint equivalence, trunc rounding) |    16 | Full algorithm                                           |
| H: expected value computed by the harness or by public NumberFormat `style:"unit"` and ListFormat                                                                    |    38 | Full algorithm **and** public duration-unit NumberFormat |

**Harness dependency [current].** `testIntl.js` `partitionDurationFormatPattern`
(35 files) is an `en`-only reimplementation that constructs public
`Intl.NumberFormat` with `style:"unit"`, `unit` ∈ the ten singular duration units,
`unitDisplay`, `roundingMode:"trunc"`, `maximumFractionDigits` up to 9,
`minimumIntegerDigits:2`, `useGrouping:false`, `signDisplay:"never"` and
`numberingSystem`, then public `Intl.ListFormat` `type:"unit"`. Three more files
build the same NumberFormat calls directly (`mixed-non-numeric-styles-es.js` uses
`es`). Today Tint's public NumberFormat rejects every unit except `percent`
(`intl-number-format.ts` `supportedStyle`), so class H cannot pass until F1.

**Locales with exact or derived assertions:** `en` (53 constructions), `es`;
`de`, `th`, `ar` (Temporal equivalence, self-consistency only); `sr`,
`sr-Thai-RS`, `de`, `zh-CN` in `supportedLocalesOf` (lookup must succeed).

**Adjacent, not owned:** `built-ins/Temporal/Duration/prototype/toLocaleString`
7 files / 14 variants (name, length, brand, `return-string.js`). The method exists
today and returns ISO text; F5 replaces its body, so this selection is an
unchanged-regression check. `harness/wellKnownIntrinsicObjects.js` names
`%Intl.DurationFormat%` (resolved by its `Intl.DurationFormat` source). No other
pinned file mentions DurationFormat; `testWithIntlConstructors` does not iterate it.

## Authoritative sources

Fetched 2026-11-04 to `/tmp/tint-durationformat-plan/spec` (HTML plus text
extracts; byte-identical to the INTL-DTF fetch of the same day).

- **ECMA-402 draft 2026-10-23** (<https://tc39.es/ecma402/>): §13.1.1 constructor,
  Table 20, §13.2.2–3 (`supportedLocalesOf`, `[[RelevantExtensionKeys]]` «nu»,
  `[[LocaleData]].[[DigitalFormat]]`), §13.3.2–4, Table 21, §13.5.1–15
  (ToDurationRecord, IsValidDuration, GetDurationUnitOptions,
  ValidateDurationUnitStyle, ComputeFractionalDigits, NextUnitFractional,
  FormatNumericHours/Minutes/Seconds/Units, ListFormatParts,
  PartitionDurationFormatPattern, Table 24), §9.2.8 ResolveOptions (no special
  behaviours, so GetOptionsObject), §9.2.14 GetNumberOption, §16.5.15
  ToIntlMathematicalValue.
- **Temporal draft 2026-07-27** (<https://tc39.es/proposal-temporal/>): §15.10.1–2
  (`format`/`formatToParts` use ToTemporalDuration), §15.11.1.1
  (`Duration.prototype.toLocaleString`), §15.9.6–8 (algorithm with Temporal
  inputs), §7.3.24 (non-402 fallback, which Tint must stop using).
- **CLDR 49** `.tint-bootstrap/cldr-core-49.zip` (SHA-256 `78403d8d…6a89`, the
  existing pin): `<unit type="duration-*">` under `<unitLength>`;
  `<symbols numberSystem><timeSeparator>`; `<durationUnit type="hm|hms|ms">`.

**Divergences**, each reconciled toward the pinned tests or recorded upstream:

1. **Input conversion.** ECMA-402 uses ToDurationRecord (rejects every string);
   Temporal uses ToTemporalDuration (ISO strings, Duration slots without getters).
   `temporal-duration-string-arg.js` and `taint-*` require Temporal. **[proposal]**
   Follow Temporal; both agree on the error kinds the other tests check.
2. **Unconditional TwoDigitHours.** GetDurationUnitOptions sets hours to
   `"2-digit"` whenever `twoDigitHours` is true, even for `long`/`short`/`narrow`.
   §13.2.3 defines the flag only "when using style numeric". Decision Q2.
3. **DigitalFormat keying.** §13.2.3 keys `[[DigitalFormat]]` by numbering system,
   but §13.1.1 reads `[[HourMinuteSeparator]]` from it directly before `nu` is
   applied. **[proposal]** Select the record for the resolved `[[nu]]`.
4. **Exact values.** PartitionNumberPattern receives exact mathematical values,
   while the harness passes non-fractional unit values as Numbers (shortest
   spelling via ToIntlMathematicalValue). They differ only for unsafe integers in
   non-fractional units; no pinned test observes it. **[proposal]** Follow the
   spec (Q4).
5. **Temporal text lag.** Temporal §15.9.7–8 names `[[HoursDisplay]]`-style slots and
   repeats an Append step; ECMA-402's Duration Unit Options Records are newer.
   **[proposal]** Transcribe ECMA-402 §13.5 with Temporal's input operation.

## Current capabilities (all [current])

- **Constructor template:** `intl-relative-time-format.ts` (newTarget via
  `constructorPrototype`, `canonicalLocaleList`, `matcher`,
  `resolveNumberingSystemOption`, `resolveNumberLocale`, own-slot
  `requireFormatter`, null-prototype private NumberFormat options). Wiring per
  service: `functions.ts` `IntrinsicPrototype`, `errors.ts` realm prototype,
  `operations.ts` `internal…Data` slot. RTF coerces options with ToObject;
  ListFormat (`intl-list-format.ts:155`) implements GetOptionsObject, which
  DurationFormat needs.
- **Numbers:** `configureDecimalNumberFormatter` supports `minimumIntegerDigits`,
  fraction digits, `roundingMode` (all nine modes), `useGrouping:false`,
  `signDisplay`, numbering systems, exact `DecimalQuantity` input, and negative
  zero. `decimalNumberParts` returns typed parts; unit style is percent-only, via
  `percentUnitPattern` (generated, plural-category selected) and
  `renderPercentUnit`. `resolvedOptions` hard-codes `unit: "percent"`
  (`intl-number-format.ts:663`).
- **Lists:** `list-format.ts` `lookupListFormatLocale`, `createListFormatter`
  (`unit` type, three styles), `formatListParts` (element/literal records).
- **Durations:** `temporal-duration-conversion.ts` `durationFrom` is
  ToTemporalDuration (strings, slots, property bag in alphabetical order with
  interleaved ToIntegerIfIntegral, all-undefined TypeError, normalizes −0);
  foundation `createDuration` implements IsValidDuration with exact `Integer`
  sums. Foundation `big-integer.ts` (`fromNumber`, `add`, `multiply`,
  `formatInteger`) and `number-text` `DecimalQuantity` cover exact arithmetic.
- **Generators:** `tools/generate-number-affix-data.ts` already resolves
  `unitLength` width aliases, general parents and plural categories for
  `concentr-percent`, excluding `case`/`gender` variants; manifests and packed
  `key|value` tables follow `docs/intl-runtime.md`.

## Explicit gaps

- No DurationFormat installer, realm prototype, slot or tests.
- No duration unit patterns. CLDR has `duration-{year…nanosecond}` in all three
  widths with plural categories; raw XML for these blocks (including case variants
  and markup) is ~790 KB across 929 locale files. Root defines only `short`
  (`{0} y`, `{0} ms`) and aliases `long` and `narrow` to it.
- No time-separator data (`timeSeparator` is not in `NumberSymbols`).
- `Duration.prototype.toLocaleString` shares the generic ISO-text loop
  (`temporal-duration.ts:256`).

## Design

### 1. Modules and contracts [proposal]

All in `packages/js-runtime/src/objects/`; no new package, so no manifest,
project-reference or `workspace-contracts.json` change. New source files require
`node tools/generate-compiler-catalog.ts` and formatting; new manifests join the
package `files` list.

- `duration-format-data.ts` (generated) and `duration-format-profile.ts`:
  `lookupDurationFormatLocale(tag)` and `durationDigitalFormat(locale, nu)`.
- `duration-format.ts`: pure core. `DurationFormatter` record (locale,
  numberingSystem, style, ten `{style, display}` unit options, separators,
  `fractionalDigits`, lazily cached decimal formatters keyed by
  unit × width/numeric × signed); `partitionDurationFormat(formatter, duration)`
  returning `{type, value, unit?}` records. No Script objects.
- `intl-duration-format.ts`: `installDurationFormatIntrinsic` and exported
  `createDurationFormat(locales, options, realm, hooks)` (shared with Temporal),
  method adapters and `resolvedOptions`.
- NumberFormat side (F1): generalize `percentUnitPattern`/`renderPercentUnit` into
  `unitPattern(locale, unit, width, category)` and a sign-preserving
  `renderUnitPattern`, with percent keeping its current ILD sign policy.

### 2. Data contracts and generators [proposal]

**Duration units (NumberFormat-owned, F1).** Extend
`generate-number-affix-data.ts` from `concentr-percent` to the ten
`duration-*` types under the same policy: unmarked patterns only, general parent
inheritance, `unitLength` aliases, missing categories fall back to `other`, all
draft grades kept, one `{0}` per pattern. Emit interned rows keyed by
locale profile × unit × width × category. The NumberFormat output for existing
paths stays byte-identical except the new tables; the manifest records it.

**Digital format (DurationFormat-owned, F2).** New
`tools/generate-duration-format-data.ts` with its own manifest. Rows hold
`timeSeparator` per (locale, numbering system) _only where it differs from `:`_;
the generator asserts every other resolved pair is `:`. Pinned data has exceptions
for `fi`, `da`, `id`, `en_DK`, `en_FI`, `ms_ID` (latn `.`), root arabext `٫` (`fa`
overrides `:`). Resolve symbols with the numeric generator's inheritance; extract it
to a shared `tools/cldr-number-symbols.ts` so NumberFormat output stays
byte-identical. Record the generated size in F2 (unmeasured now).

**Available locales [default].** `[[AvailableLocales]]` is the numeric registry
(860 tags) filtered to tags whose `lookupListFormatLocale` succeeds. A probe of
current tables (`probe/reg.mjs`) finds 105 numeric tags with no ListFormat match
(for example `agq`, `bo`, `ce`, `ckb`), leaving **755**. Every unit lookup
succeeds through root inheritance (root `short` defines all ten units, `other`
only; checked 2026-11-04). `supportedLocalesOf` and resolution share this
predicate, so neither advertises a locale whose list data is absent.

### 3. Constructor and option order [proposal]

Transcribe §13.1.1; observable order is pinned by `constructor-options-order.js`.

1. NewTarget undefined → TypeError (`newtarget-undefined.js`), before any argument
   access. OrdinaryCreateFromConstructor via `constructorPrototype(target,
"intl-duration-format")` (newTarget `prototype` read precedes locales).
2. CanonicalizeLocaleList; then GetOptionsObject: `undefined` → null-prototype
   object; any non-Object (including strings) → TypeError
   (`constructor-options-invalid.js` uses `null`).
3. `localeMatcher` (`lookup`/`best fit`); `numberingSystem` through
   `resolveNumberingSystemOption` (type-nonterminal RangeError, the 14 invalid
   strings in `constructor-options-numberingSystem-invalid.js`).
4. ResolveLocale with relevant key `nu` (§4). Separators come from the resolved
   locale and `nu`.
5. `style` ∈ {long, short, narrow, digital}, default `short`.
6. Table 20 rows in order (years … nanoseconds). Per row: GetOption unit style
   (row's list), defaulting per GetDurationUnitOptions; `numeric` on a sub-second
   unit becomes `fractional` with display default `auto`; GetOption `<unit>Display`
   ∈ {auto, always}; **ValidateDurationUnitStyle immediately** (RangeError stops
   all later reads); then the 2-digit adjustments. `prevStyle` updates only for
   hours…microseconds.
7. `fractionalDigits` via GetNumberOption(0, 9, undefined): ToNumber (valueOf
   observable), NaN or out-of-range RangeError, floor. Export the existing private
   `defaultNumberOption` from `intl-number-options.ts` rather than copy it.

GetOption converts with ToString (Symbol → TypeError) before membership checks.

### 4. Locale and numbering-system resolution [proposal]

Refactor `resolveNumberLocale(requested, optionSystem)` to take an optional
`accepts(base)` predicate (behavior-preserving for NumberFormat/RTF/PluralRules);
DurationFormat passes the §2 registry predicate. `-u-nu` and the option follow the
existing rules, matching `resolved-numbering-system-unicode-extensions-and-
options.js` (identical to NumberFormat's copy). The default is `en`.

### 5. Format input and output [proposal]

- `format`/`formatToParts` (length 1): RequireInternalSlot on the **own** slot
  first (no unwrap, no legacy chaining); then `durationFrom` (Temporal Duration
  slots read directly; strings parsed; bags read alphabetically; first abrupt
  completion wins; mixed signs and IsValidDuration failures → RangeError).
- `format` concatenates values. `formatToParts` creates a method-realm Array of
  method-realm ordinary objects with `type`, `value`, then `unit` only when the
  record has one. Every NumberFormat-derived part, including its `literal` and
  `unit` parts, carries the singular unit; separators and list literals do not.

### 6. PartitionDurationFormatPattern [proposal]

Transcribe §13.5.15 with these representation rules:

- **Exact values.** Convert fields with `fromNumber` to `Integer`, never
  `decimalFromNumber`. ComputeFractionalDigits builds one scaled `Integer`
  (for example `seconds·10⁹ + ms·10⁶ + µs·10³ + ns`) and a `DecimalQuantity`
  with exponent −9/−6/−3. `precision-exact-mathematical-values.js` and
  `duration-out-of-range-4.js` require this (`4503599627370497024` ms).
- **Sign.** DurationSign from the validated record. The first displayed unit uses
  `signDisplay:"auto"`; a zero first value in a negative duration becomes negative
  zero (`-0 hr`, `-1 day, 01:02`). Later units use `"never"`. `{unit: -0}` is +0.
- **Numeric run.** FormatNumericUnits decides hours/minutes/seconds visibility
  exactly as written (minutes forced when hours and seconds both show; seconds
  visibility ignores `fractionalDigits`), emits locale separators as unit-less
  literals, `useGrouping:false`, `minimumIntegerDigits:2` for `2-digit`, seconds with
  `trunc` and 0–9 or fixed fraction digits. Non-numeric units keep grouping
  (`"1,234,567 days, 3:20:45"`).
- **Loop termination.** Stop after the first numeric row or after a row whose
  next unit is fractional (that row still formats). Zero units with `auto`
  display are omitted; an empty result yields `""`.
- **List.** ListFormatParts with `type:"unit"`, style (`digital` → `short`),
  through `createListFormatter`, never public `Intl.ListFormat`.
- **NumberFormat.** Configure through `configureDecimalNumberFormatter` with
  null-prototype option objects equal to the spec's, cached per formatter. They
  are unobservable and never read mutable globals.

### 7. resolvedOptions and surface [proposal]

- `resolvedOptions` (length 0): method-realm object; Table 21 order `locale`,
  `numberingSystem`, `style`, then `<unit>`, `<unit>Display` × 10 (`fractional`
  → `numeric`), then `fractionalDigits` only when defined
  (`return-keys-order-default.js`).
- Constructor `length` 0, name `DurationFormat`; `prototype` non-writable;
  `supportedLocalesOf` length 1 (FilterLocales: CoerceOptionsToObject, then
  `localeMatcher`); `@@toStringTag` `"Intl.DurationFormat"` (configurable only).
  `format`/`formatToParts` are ordinary methods (no bound getter).
- The brand is own-slot only: prototypes, `Object.create(df)` and proxies throw
  TypeError (`branding.js`).

### 8. Temporal.Duration.prototype.toLocaleString [proposal]

Remove `toLocaleString` from the generic ISO loop. New body: RequireInternalSlot
(Duration), then `createDurationFormat(locales, options)` (constructor order and
abrupt completions as §3, with %Intl.DurationFormat.prototype%), then partition the
**internal** Duration record (no getters, `taint-duration-prototype.js`) and join.
It never reads the global `Intl`; Temporal still installs without Intl because
the realm prototype exists independently of `installIntlIntrinsics`.

### 9. Semantic ordering and abrupt-completion cases (unit and native fixtures)

1. NewTarget-undefined TypeError precedes locale and options access.
2. Options log stops at the first invalid unit style or display (for example
   `{hours:"numeric", minutes:"long"}` → RangeError, `seconds` never read).
3. `fractionalDigits: {valueOf}` called once; `10`, `-1`, `NaN` → RangeError.
4. Bad receiver: TypeError before any argument getter runs.
5. Bag getters run in alphabetical order; a non-integral `hours` stops before
   `microseconds`; all-undefined → TypeError after all ten reads.
6. Mixed signs, `|years| ≥ 2³²` and normalized seconds ≥ 2⁵³ → RangeError
   (`duration-out-of-range-1..3.js`); a Duration object bypasses getters.
7. Mutating `Intl.NumberFormat`, `Intl.ListFormat` or `Intl.DurationFormat` does
   not change `format` or `Duration#toLocaleString` results.
8. `formatToParts` uses the method's realm for a foreign-realm formatter.
9. `Duration#toLocaleString` with a throwing options getter propagates the error;
   with a non-Duration receiver it throws before reading options.

## Representation and native-subset constraints

- Packed strings with binary-search lookup and interned pools; no large array or
  object literal initializers (`docs/intl-runtime.md`).
- Exact arithmetic through foundation `Integer`/`DecimalQuantity`, never unsafe
  `number` multiplications by 10⁻³ (IsValidDuration note).
- No Node, ICU or host-Intl calls and no RegExp in the runtime path. The same
  modules serve live and AOT execution.

## Implementation slices

Each slice ends with a fail-fast `pnpm check`. Native work uses the shared AOT
pipeline under LLDB, one serial inferior at a time, `TINT_BUILD_ONLY=1` for hosted
fixtures, and asserts stopped-at-entry and final exit states. Every unchanged
selection is a new immutable report. Run it only when the parent's native queue
and journals are idle; never edit queues, journals or frozen snapshots.

- **F0 Red baseline.** Unchanged native selections for `intl402/DurationFormat`
  (220) and `intl402/Temporal/Duration/prototype/toLocaleString` (4); the adjacent
  `built-ins/Temporal/Duration/prototype/toLocaleString` (14) separately.
- **F1 NumberFormat duration units.** Generator extension (§2), `unitPattern`,
  public and internal `style:"unit"` for the ten duration units only (others
  stay `rejectUnsupportedExecution`), `resolvedOptions.unit` reports the actual
  unit. Unit tests: generated rows against CLDR XML spot vectors per width and
  category (`en`, `es`, `de`, `ar`, `th`, `ru`), root alias closure, sign
  placement. Native fixtures:
  `new Intl.NumberFormat('en',{style:'unit',unit:'hour',unitDisplay:'long'})
.format(1.5)` plus `formatToParts` types, `es` narrow/long, `-0`, `trunc` with
  string input, `kilometer` still unsupported. Unchanged reruns:
  `intl402/NumberFormat` (502), Number (14) and BigInt (22) `toLocaleString`.
- **F2 Digital data and registry.** Generator, manifest, profile lookups,
  `resolveNumberLocale` predicate refactor. Unit tests: exception rows, `:`
  assertion, registry count, `sr-Thai-RS` → `sr`. Unchanged reruns:
  `intl402/RelativeTimeFormat` (160) and `intl402/PluralRules` (106), because
  their resolver changes.
- **F3 Constructor, `resolvedOptions`, `supportedLocalesOf`.** Realm wiring and §3,
  §4, §7. Targets: class R (50 files); `format` methods are added in F4, not
  stubbed. Native fixtures: cases 1–3 and brand isolation.
- **F4 `format`/`formatToParts`.** Pure core (§6) with unit tests for every
  FormatNumericUnits branch, exact fractions, sign and loop termination; methods
  (§5). Targets: classes E, X and H. Native fixtures: cases 4–8; `style:"digital"`
  `{hours:1,minutes:22,seconds:33,milliseconds:111}` → `1:22:33.111`;
  `en-u-nu-arab`; `da` digital → `1.02.03`.
- **F5 Duration toLocaleString.** §8. Targets: the 4 owned variants; the 14 adjacent
  variants must not regress. Native fixtures: case 9 and Intl-free Temporal install.
- **F6 Consolidated rerun and self-build.** One complete unchanged run of the 224
  owned variants, adjacent 14, plus `intl402/ListFormat` (162). Frozen-source
  self-build and stage-image comparison as RTF did; record the observed build.

Ordering: F1 → F2 → F3 → F4 → F5 → F6. The F4 pure core can start after F1 in
parallel with F2/F3 because it consumes only records.

## Validation and evidence separation

- New `tools/verify-test262-native-duration-format.ts` using
  `verifyNativeScriptCases` (as RTF), recorded in its own validation report with
  `conformance: false`.
- Node 24.12 (ICU 77.1, CLDR 47) probes in `/tmp/tint-durationformat-plan/probe`
  are references only. They show that V8 uses per-numbering-system
  `timeSeparator` (`en-DK` `1.02.03`, `en-u-nu-arabext` `۱٫۰۲٫۰۳`, `fa` `:`) and
  ignores CLDR `hh` patterns (`lt` digital `0:02:03`). Neither is proof of
  conformance; F2 fixtures check Tint against pinned CLDR 49 XML.
- Owned totals count only native runs of unchanged Test262 sources. Fixture, unit
  and Node results are never summed into them.

## Decisions (recommended defaults)

- **Q1 Separator source.** [default] CLDR `timeSeparator` for the resolved locale
  and numbering system, both separators equal. Basis: §13.2.3 keys data by
  numbering system, and the reference engine agrees. Alternative: parse
  `durationUnit` `hms` (22 locale files define it; `nds` `h.mm:ss` yields different
  separators, `ee` adds literal words the record cannot hold). Either is
  conforming locale data; only `en` is asserted.
- **Q2 TwoDigitHours.** [default] Derive the locale flag from documented digital
  format data and follow the pinned normative GetDurationUnitOptions algorithm,
  including its unconditional hours override when the flag is true. Keep the
  apparent conflict with the internal-slot prose explicit and investigate it
  upstream before adopting a different interpretation. Include a flag-true locale
  under numeric and nonnumeric styles in independent fixtures. Do not force every
  flag false merely to avoid the discrepancy or satisfy existing tests.
- **Q3 Locale registry.** [default] numeric ∩ ListFormat-resolvable (755).
  Rejected: all 860 with ListFormat falling back to `en`, which would mix
  languages in one string.
- **Q4 Unsafe integers in non-fractional units.** [default] Exact per spec, with a
  fixture (`{milliseconds: 4503599627370497000}`, `style:"short"`). Record that
  the harness simplification would print the shortest Number spelling.
- **Q5 NumberFormat unit breadth.** [default] Duration units only in F1. The other
  Table 2 units and `-per-` compounds are a separate NumberFormat slice.
- **Q6 Sign in prefixed unit patterns.** [assumption] The sign stays inside
  `{0}` for duration units (no percent-style hoisting). Confirm in F1 against
  CLDR and UTS #35 Part 6 for every locale whose pattern does not start with
  `{0}`.

## Dependencies

Present [current]: NumberFormat core, PluralRules, ListFormat, locale
canonicalization, ToTemporalDuration, exact integer helpers. New and internal to this
plan: the F1 duration-unit capability. No dependency on RT-EVAL, HOST-ESM,
INTL-DTF or TEMPORAL-CAL. F1 also moves some NumberFormat unit variants from
unsupported to supported; any new NumberFormat figure comes only from the F1
rerun, never from this plan.

## Next planning recommendation

Plan **INTL-COLLATOR** next (`intl402/Collator` 65 files / 130 variants,
`String.prototype.localeCompare` 13 files, two `getCollations` failures). It is the
only constructor in `testIntl.js` `testWithIntlConstructors` (Collator,
NumberFormat, DateTimeFormat; 26 files) with no plan. With INTL-DTF it completes
that harness path, which also unblocks the PluralRules and INTL-MISC harness
failures. The main risk is UCA/CLDR tailoring data size, which the planning task
should measure first.
