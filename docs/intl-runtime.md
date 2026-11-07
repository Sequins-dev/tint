# Internationalization runtime

Intl services run through the TypeScript runtime and native compiler. Portable
locale algorithms do not call Node's Intl, ICU or platform locale services.

## Locale identifiers

`js-runtime/src/objects/locale-id.ts` parses the Unicode BCP47 subset required by
[ECMA-402](https://tc39.es/ecma402/#sec-iswellformedlanguagetag). It validates
ASCII subtags, language/script/region/variants, Unicode and transformed extensions,
other singleton extensions and private use. Duplicate variants and singleton
extensions are rejected. This is deliberately narrower than arbitrary BCP47 or
CLDR identifiers: underscores, grandfathered tags and standalone private-use tags
are not repaired into valid input.

`locale-canonicalization.ts` applies [UTS35 Annex C](https://unicode.org/reports/tr35/#LocaleId_Canonicalization):
ordered multimap alias rules, context-sensitive territory replacements using
likely subtags, transformed language aliases, Unicode type/subdivision aliases,
casing and extension ordering. Unicode attributes are deduplicated and sorted;
the first occurrence of a Unicode keyword wins. Only Unicode `true` values are
omitted; transformed `true` values remain.

`Intl.getCanonicalLocales` uses these algorithms with language-level ToObject,
LengthOfArrayLike, HasProperty, Get and ToString operations. It snapshots length,
skips absent properties, includes inherited indices, propagates abrupt completion
and deduplicates canonical identifiers in first-seen order. Its result is a fresh
Array created through own data properties. Locale arguments use their internal
canonical string directly, bypassing public `toString` and other user properties.

## Locale objects

`intl-locale.ts` implements `Intl.Locale` construction, canonical stringification
and the base-name, language, script, region, variants and Unicode-option accessors.
An object's own `internalLocaleData` is the brand: the prototype, objects inheriting
from instances and proxies around instances do not acquire it. Construction
preserves newTarget prototype selection and option getter/coercion order, with
canonicalization before base-language overrides and after keyword overrides.

`locale-likely.ts` implements likely-subtag maximization and region-favoring
minimization. Unknown languages with no matching data retain their canonical
input; explicit fields, variants and extensions are preserved. Fourteen public API
fixtures pass through native output, including these methods. Their new Locale
result uses the intrinsic
constructor rather than the mutable public `Intl.Locale` property.

`locale-info.ts` implements hour-cycle preferences, text direction, week info and
common-use territory timezone lists using complete pinned CLDR metadata. Region
selection uses explicit region, subdivision and likely-subtag preferences, with
separate region overrides. Timezone queries use the explicit region only. Week
results contain `firstDay` and `weekend` under the current specification.

These queries return fresh method-realm objects and arrays, including nested
weekend arrays. Unknown script direction remains undefined. The timezone catalog
comes from CLDR windowsZones/metaZones mappings with BCP47 primary identifiers;
it is not an exhaustive tzdb zone.tab territory assignment.

`getNumberingSystems` uses the actual NumberFormat registry and honors explicit
Unicode numbering-system keywords. Four native API boundary fixtures cover this
interface, service enumeration and locale forwarding. The earlier [complete Locale
selection](results/test262-locale-family-native-v4.json) passed 338/380 variants.
New calendar metadata passes [16/16 unchanged variants](results/test262-locale-calendars-native-v1.json)
and [six native boundary fixtures](results/native-locale-calendars-validation-v1.json).
It preserves explicit keywords and territory preference order using pinned CLDR 49
calendar vocabulary and preferences.

The complete raw collation metadata catalog uses the pinned CLDR 49 archive
with per-member hashes. It resolves collation-specific parent inheritance and
canonical public names. `collation-locales.ts` supplies the actual service types
for `Locale.getCollations()`. Explicit keywords are returned as stored; unmatched
locales use `emoji,eor`, without likely-subtag expansion. `collator.ts` resolves
service options and locale extensions; `intl-collator.ts` installs the constructor,
branded accessors and methods, and `String.prototype.localeCompare`. Both interfaces
share the comparison engine and preserve receiver/string/locale/option coercion order.

`collation-engine.ts` uses the Unicode 17 CLDR 48 fractional root table, matching
the existing normalization and casing version. Identifier and locale metadata
remain pinned to CLDR 49. The generator verifies the archive, each interpreted
member and UnicodeData before producing packed lazy tables. It retains script
boundary contractions, resolves implicit Han references and interprets the three
reference forms separately. Comparison normalizes to NFD, handles contiguous and
discontiguous contractions and prefix contexts, and applies sensitivity, case
ordering, arbitrary-length decimal runs and punctuation shifting.

Available service languages are `de,en,es,fr,it,sv,th`; script/region requests use
ordinary language lookup, and unmatched locales use the shared default `en`.
The service includes root search/EOR, German phonebook/search, Spanish
standard/search, Swedish standard and Thai standard data. Unapproved provisional
German EOR data is excluded; German EOR uses the approved root profile.
For supported locales, `Locale.getCollations()` uses the same service registry;
explicit keywords and the specified `emoji,eor` unmatched-locale fallback remain
independent of service support. The complete CLDR metadata catalog stays pinned
and independently verified.
Constructors and resolved-options queries do not decode the large tables; the
first comparison does. The [complete native rerun](results/test262-cluster-j-collator-localecompare-g6-localeinfo-native-v29.json)
passes 186/188: Collator128/130, localeCompare26/26, Locale.getCollations26/26 and
G’s String-locale descriptors6/6. Two `this-value-ignored` cases use an unchanged
harness that also requires the missing DateTimeFormat; they remain failures with
a handoff to H. The [acceptance record](results/cluster-j-collator-acceptance-v29.json)
links the native API fixture, byte-identical frozen self-build, semantic corpus,
workspace gate and matched 64-variant non-Intl compile CPU measurements.


## Calendar algorithms

`calendar.ts` is the shared portable calendar boundary. Identifier validation and
canonicalization reuse the pinned CLDR calendar vocabulary and Unicode type
aliases already used by Locale. Temporal applies its primitive-string and error
semantics around this pure operation. Calendar identity does not imply that
non-ISO date conversion or arithmetic is implemented. The [corrected semantic
regression record](results/temporal-calendar-alias-tdd-h-v2.json) passes 18 tests,
and the [native primitive fixture](results/native-calendar-identifiers-green-h-v13.json)
validates 19 identifier/alias pairs and seven rejection cases through direct LLDB
launch. These are separate from Test262 selection results.

`calendar-query.ts` chooses the arithmetic backend behind `calendar.ts`. ISO
storage stays separate from the exposed calendar fields. PlainDate, PlainDateTime,
partial dates, ZonedDateTime and Duration use the same queries and operations.
Gregorian-derived calendars apply their arithmetic year offsets and eras;
Coptic, Ethiopic and Ethioaa share an exact four-year, thirteen-month cycle.
Indian years follow Gregorian leap years with a March new year. Persian
reckoning includes the complete pinned ICU 77.1 leap-shift corrections.

`calendar-regular-fields.ts` shares field resolution and canonical reference-date
selection for regular month sequences. Islamic civil and Thursday variants use
exact tabular arithmetic. Umm al-Qura uses all 301 published year records and the
specified civil rules outside that interval. Its [data verification](results/calendar-islamic-data-verification-h-v1.json)
and [complete interval reference check](results/calendar-islamic-reference-probe-h-v2.json)
are separate from native results. Temporal rejects the Intl-only `islamic` and
`islamic-rgsa` fallback names before checking arithmetic availability.

`calendar-hebrew.ts` implements proleptic postponements, variable month lengths
and stable leap month codes. `calendar-lunisolar-arithmetic.ts` retains month codes
when adding years and balances actual month serials when adding months or taking
differences. Shared reference-date limits remain in `calendar-date-limits.ts`.
[Semantic validation](results/temporal-hebrew-semantic-validation-h-v1.json)
passes 164 focused tests, including full-domain reconstruction and exact
conjunction thresholds. A [postponement correction](results/temporal-hebrew-postponements-semantic-h-v1.json)
retains the original conjunction weekday when applying special deferrals, matching
an independent neighboring-year formula across 550,001 years. Older ICU reference
comparisons remain retained and do not override the corrected kevi'ah rules.
The [native calendar regression](results/calendar-native-restored-h-v68.md)
completes all57 cases across the requested families. Native stage comparison and
smoke execution pass; complete unchanged Test262 reruns remain separate.

`calendar-chinese.ts` implements Chinese and Dangi month identities and arithmetic.
Complete pinned ICU4X year tables cover 1900–2102, including published Chinese and
Korean calendar differences and the two continuity years. Outside that interval,
`calendar-astronomy.ts` computes new moons and winter solstices with portable math.
Stable solar-cycle labels preserve a contiguous proleptic reckoning across the
Temporal date domain. Dangi calculation offsets remain calendar rules independent
of user time zones. Bounded caches retain year records and winter windows.

Leap months repeat the preceding month code; absent leap months constrain backward.
Month-day references use the specified rare-month table. Year differences compare
the original month code before constraining it, as required by CompareSurpasses.
[Semantic checks](results/temporal-chinese-semantic-validation-h-v1.json) and
[algorithm invariants](results/calendar-east-asian-invariants-h-v1.json) remain
separate from the [completed native regression and stage comparison](results/calendar-native-restored-h-v68.md).
Per-calendar Test262 selections remain to measure.

## Date and time presentation data

`date-time-pattern.ts` parses LDML quoting and field runs, computes ECMA-402
BasicFormatMatcher scores and splits interval patterns at repeated fields.
`date-time-calendar.ts` provides inherited CLDR 49 calendar presentation data for
860 locales and 16 calendars. Packed profiles retain styles, skeletons, intervals,
calendar names, eras, cyclic years and leap-month wrappers. The generator uses
checksum-pinned archive members and resolves parent locales and source-locale
aliases, including implicit standard format types. Generated manifests record
input hashes and the output hash.

The [pattern core](results/intl-date-time-pattern-native-resume-h-v31.md) and
[calendar presentation data](results/intl-date-time-calendar-native-resume-h-v32.md)
have semantic tests and completed native fixtures. The public DateTimeFormat
adapter composes these services; the [restored native validation](results/intl-date-time-format-native-restored-h-v52.md) records direct-launch observations and the frozen compiler stage comparison.

`date-time-zone-data.ts` resolves localized zone/metazone names, reference regions,
exact metazone history bounds and flexible day-period rules for the same 860
locales. CLDR naming aliases remain separate from public IANA primary identity.
Zone home territories determine location names; reference-zone membership can
serve another territory without moving the city. Missing explicit display names
remain inputs to the formatter's fallback rules. TZif/POSIX seasonal flags are
available independently of offsets, including negative or equal-offset seasons.
[Time-zone service validation](results/intl-date-time-zone-data-native-resume-h-v33.md)
passes 43 focused tests and its original 4726-test workspace gate; its native
fixture now completes with the required entry stop and exit42.

`date-time-skeleton.ts` matches LDML skeleton fields, adapts widths with locale
numeric/text overrides, composes date/time and append patterns and resolves style
clock changes. Localized append labels share the calendar profiles. Calendar-year
requests normalize week-year symbols found in locale patterns to ECMA-402's year
component. [Skeleton validation](results/intl-date-time-skeleton-native-resume-h-v38.md)
checks required subsets across all 860 locales and passes its original 4735-test
workspace gate. Its native fixture now completes.

`date-time-parts.ts` renders calendar fields through the private decimal service,
preserving astral digits, era years, related/cyclic years, lunar leap labels and
Hebrew Adar identities. Names and short weekdays come from calendar profiles;
flexible periods use the shared day-period rules. Time-zone tokens require a label
resolved for the exact input by the zone-name service. [Parts validation](results/intl-date-time-parts-native-resume-h-v41.md)
passes 39 focused and its original 4742-test workspace gate. Its native fixture
now completes.

`date-time-zone-name.ts` renders specific/generic names, reference-zone qualifiers,
location fallback and exact localized GMT offsets using the same zone models as
Temporal. Type fallback checks the full 184-day stability interval, including
recorded and future flag changes with identical offsets. Short country labels use
explicit CLDR alternate selectors. [Zone-name validation](results/intl-date-time-zone-name-native-resume-h-v42.md)
passes 48 focused and its original 4751-test workspace gate; its native fixture
now completes.

`date-time-range.ts` selects compact CLDR intervals and tags shared/start/end
parts. It compares fields through the requested precision, preserves reversed
arguments and composes shared dates with time intervals or time-only fallback.
Related and cyclic years retain their separate part identities. Structural
date/time connector metadata avoids inferring composition from rendered text.
[Range validation](results/intl-date-time-range-native-resume-h-v43.md) passes 57
focused tests and its original 4760-test workspace gate; its native fixture
now completes.

`intl-date-time-format.ts` installs the constructor, supportedLocalesOf, bound
format getter, parts, ranges and resolvedOptions. Configuration preserves
observable option order, legacy chaining and realm-local result records. Locale
negotiation handles calendar/numbering/hour-cycle extensions independently;
available time-zone alias identities are preserved. The shared assembly clips
legacy inputs before local conversion and keeps local coordinates outside Date's
bounds available to the parts engine. Two-digit clocks select inherited CLDR
ASCII alternates when available; explicit padding remains a minimum.
[Public API validation](results/intl-date-time-format-api-native-resume-h-v52.md)
passes 53 focused and its original 4786-test workspace gate. The restored native
validation records its completed fixture and compiler stage comparison. Temporal-object formatting and locale forwarding are the next slice.

`date-time-format-options.ts` preserves raw component options and applies model
defaults without mutation. `date-time-temporal-pattern.ts` caches model-specific
formats and adjusts styles only when fields conflict. `intl-date-time-value.ts`
uses Temporal brands, checks calendar/type compatibility, keeps plain coordinates
zone-independent and converts Instant nanoseconds exactly before rendering.
Temporal locale methods use this private service; ZonedDateTime supplies its own
zone and rejects a defined timeZone option. Date's locale methods share the same
formatter defaults and validation. [Integration validation](results/temporal-date-time-format-native-resume-h-v54.md)
passes 224 focused and 4813 workspace tests. Native fixtures and compiler images
remain compiled only while authorization is pending.

## Duration formatting

`duration-format.ts` composes private number and list engines with the shared
CLDR unit profiles. Exact integer arithmetic combines fractional units before
truncation, preserving low bits of unsafe binary64 integers. Digital clocks retain
field magnitudes, locale separators, padding and bridge minutes. Part records
identify their unit; digital and list separators omit that property.

`intl-duration-format.ts` implements the public constructor, supportedLocalesOf,
resolvedOptions, format and formatToParts. It preserves option and field conversion
order, brands receivers, creates method-realm results and keeps private formatting
independent of mutable public constructors. Temporal.Duration.toLocaleString uses
the same service. Strings and branded duration objects reuse Temporal's conversion
and exact range validation.

The [DurationFormat checkpoint](results/duration-format-native-resume-h-v62.md)
passes all4831 workspace tests and compiles its fixture and frozen compiler.
Execution, stage comparison and complete native selections remain held for host
Developer Tools authorization.

## List formatting

`Intl.ListFormat` implements conjunction, disjunction and unit formatting in long,
short and narrow styles. Its locale registry contains 749 supported tags backed
by complete CLDR 49 pattern inheritance; lookup and best-fit currently use the
same lookup policy, with a deterministic default locale of `en`.

The portable formatter emits parts first and joins them for string output. It
preserves empty elements and literal braces. Spanish conjunction/disjunction
selection uses canonical Unicode prefixes and exact decimal grouping; Hebrew
conjunction selection uses Unicode Script data. Input strings remain unchanged.

The object adapter validates the receiver before consuming its iterable, requires
primitive string elements and implements the specified iterator-closing boundary.
Options and coercions preserve observable order. Results are fresh objects and
arrays in the method's realm; constructor prototype selection follows newTarget.

`tools/generate-list-format-data.ts` consumes the pinned CLDR 49 archive and
Unicode 17 UnicodeData.txt. It resolves parent locales and aliases, validates
pattern structure and emits packed native-friendly tables. The accompanying
`list-format-data-manifest.json` records all interpreted input hashes and the
formatted output hash. Licenses accompany the package.

The [complete native Test262 selection](results/test262-list-format-native-v1.json)
passes 162/162 variants. Independent template-folding checks cover every supported
locale, type and style; separate native fixtures cover contextual patterns,
coercion, iterator closing, realms and result freshness.

## Relative time formatting

`Intl.RelativeTimeFormat` reuses the standard-decimal formatter, numbering-system
negotiation and cardinal plural rules. Its pure core selects tense before taking
the absolute numeric value, preserving negative zero, and returns parts before
joining text. Numeric `auto` phrases are literal results; only inserted number
parts carry a singular `unit` property. Formatting methods coerce the value and
unit in order before range validation. Results use the method realm, and private
numeric setup bypasses mutable public Intl constructors.

The pinned CLDR49 generator resolves general locale parents and field aliases,
including short/narrow fallback and category-specific patterns without a number
placeholder. It supplies complete profiles for all 860 numeric-service locales;
source-member and formatted-output hashes are recorded in
[the data manifest](../packages/js-runtime/relative-time-data-manifest.json).
The shared XML extraction leaves ListFormat's generated output byte-identical.

The [complete native selection](results/test262-relative-time-native-v1.json)
passes **160/160**. [Eight native boundary fixtures](results/native-relative-time-validation-v1.json)
pass separately. The [frozen self-build checkpoint](results/relative-time-checkpoint-v1.json) produces byte-identical stage images and passes signing and DWARF verification.

## Shared numerical and plural machinery

`@tint/foundation/numeric/number-text` keeps exact decimal coefficients and powers of ten separate
from presentation precision. Number inputs use shortest decimal spelling; exact
strings retain their digits. All nine rounding modes and the sanctioned increments
use exact remainders, including quotient parity for half-even ties. Fixed and
significant presentation preserve visible zeroes and report the rounding magnitude
needed for precision-priority decisions, including carries.

`intl-mathematical-value.ts` supplies the shared ECMA-402 coercion boundary.
String inputs classify overflow and underflow before preserving finite nonzero
values; direct BigInt inputs bypass that range classification.

The plural engine uses complete CLDR 49 cardinal, ordinal and range rules. Its
operands preserve visible fractional zeroes and compute large integer/fraction
remainders without binary64 conversion. Plural component inheritance is separate
from general locale inheritance. Compact metadata uses resolved `latn` skeletons;
this is an explicit PluralRules policy, not a claim about all NumberFormat systems.
The public PluralRules adapter preserves option/coercion order, own-slot branding,
method-realm results and formatted-endpoint range equality. The [complete native
selection](results/test262-plural-rules-native-v1.json) passes 104/106 variants;
the two remaining variants construct other missing Intl services through the
shared harness. All six separate native boundary fixtures pass.

Native [decimal presentation](results/native-intl-numeric-decimal-v1.json) and
[plural-rule](results/native-intl-numeric-plural-rules-v1.json) fixtures pass.
All 3,907 CLDR sample vectors are also checked independently of the native suite.
These lower-level checks do not count as public API Test262 passes. The [bound
mathematical-value fixture](results/native-intl-mathematical-value-bound-v2.json)
also passes; the initial fixture omitted its required native view bindings and
its failed observation remains recorded separately.

## Number formatting

The shared renderer partitions rounded unsigned decimal text into integer,
group, decimal, fraction, sign and special-value parts. Grouping honors primary
and secondary widths and locale minimum grouping digits. Numeric digit tables
contain ten complete code points, including astral and noncontiguous systems.
Direction marks in signs become literal parts; marks inside special words stay
intact.

The numeric profile generator resolves complete CLDR 49 decimal symbols and
patterns for 860 locale tags and 78 numeric systems. Independent extraction
checks all 67,080 advertised configurations. The manifest retains source hashes
and the explicit policy of preserving all pinned CLDR draft grades. These tables
establish real standard-decimal capabilities. The NumberFormat object adapter
preserves branding, option/coercion order, cached bound format functions and fresh
method-realm parts. Its [complete native selection](results/test262-intl-number-format-family-native-v4.json)
passes 406/502 variants, with two shared-harness failures, 92 unsupported variants
and two retained pre-entry timeouts. Boundary fixtures are recorded separately.

Percent scaling, the percent unit, legacy constructor chaining and decimal ranges
pass [all six native boundary fixtures](results/native-number-affixes-validation-v1.json).
The complete selection above includes these paths. Range output preserves endpoint source labels. A general middle-affix AUTO
policy now collapses identical full affixes longer than one Unicode code point
and pads repeated affixes around the locale separator. Unit modifiers retain
their uncollapsed policy until plural/sign layers are represented separately.
The new policy passes six native boundary fixtures and complete native selections of [22/22 formatRange](results/test262-number-range-native-v2.json) and [20/20 formatRangeToParts](results/test262-number-range-parts-native-v2.json). Other units and nonstandard notations remain unsupported. These newer paths
do not update the older full-selection total.

Standard currency symbol, narrow-symbol and code displays now pass
[all six native boundary fixtures](results/native-currency-validation-v1.json).
The shared formatter uses ordinary currency fraction defaults, exact rounding,
real standard/accounting patterns, currency-specific separators and Unicode
currency-spacing rules. Missing localized labels fall back to the validated code.
The pinned data contains 2,858 ordinary/narrow symbol fields with independent
field inheritance and actual numeric-locale ownership. Currency names remain
unsupported until their plural-name and unit-pattern data is implemented.
The complete native selection above includes currency output.

Number and BigInt `toLocaleString` forward to the shared formatter after receiver
validation. Complete native selections pass [14/14 Number variants](results/test262-number-locale-intl-native-v3.json)
and [22/22 BigInt variants](results/test262-bigint-locale-intl-native-v3.json).

Array and TypedArray locale-string methods now share the indexed joining
algorithm with their ordinary `join` methods. Locale methods invoke each present
non-nullish element's own method with the original primitive/object receiver and
exactly two locale/options arguments. They snapshot length before callbacks;
TypedArrays validate their initial witness and read subsequent elements through
current indexed access after resizing. The initial localized list separator is
comma. [Six native boundary fixtures](results/native-array-locale-validation-v1.json)
pass. Complete native selections pass [16/22 Array variants](results/test262-array-tolocalestring-native-v1.json)
and [72/78 TypedArray variants](results/test262-typed-array-tolocalestring-native-v1.json).
The six unsupported variants in each selection use a resizable-buffer harness
that builds subclasses through dynamic `Function` compilation.

## Data and regeneration

`node tools/generate-locale-data.ts /path/to/cldr-core-49.zip` verifies the CLDR 49
archive and every interpreted XML member against pinned SHA-256 checksums. It
extracts complete language/script/region/variant alias rules, likely subtags,
subdivision aliases and structurally representable Unicode/transformed type
aliases. XML comments are excluded. Lookup keys are sorted independently of the
row separator so prefix keys remain searchable.

Generated tables are packed strings, avoiding expansion of large constant array
initializers in strict native compilation. Sorted key/value tables are searched
without constructing a full dictionary. The archive URL and checksum accompany
the generated source; upstream notices are retained in `LICENSE-CLDR.txt` and
included in the package. The generator also pins the official canonicalization
test corpus.

## Validation boundaries

Unit tests cover grammar, alias/context rules, keyword behavior, data ordering and
all 1,777 official CLDR corpus vectors, including canonicalization idempotence,
and all 7,868 likely-subtag mappings and minimization roundtrips.
`tools/verify-test262-native-locales.ts` exercises public API behavior, coercion
ordering, inherited/sparse properties, abrupt completion and poisoned Array
prototypes through native output. Native Test262 results belong in the
[coverage dashboard](test262.md); unit tests and prototype results do not count as
native conformance passes.

Other formatting engines and their service-specific locale registries remain
to implement. Existing `supportedValuesOf("timeZone")` consumes the
agent's stable primary-zone inventory.

The shared duration-unit profiles now cover all 860 CLDR49 locales with plural
patterns, inherited lists and digital time separators. NumberFormat consumes
these profiles for the ten time units, including microseconds and nanoseconds;
other measurement-unit support remains separate. This prerequisite has
[compile-only evidence](results/unit-format-native-resume-h-v55.md); native
execution remains held pending host authorization.
