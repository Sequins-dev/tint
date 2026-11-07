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

Collation metadata uses the same pinned archive with per-member hashes. Its
catalog resolves collation-specific parent inheritance, canonicalizes public type
names, excludes search/standard/private tailorings and returns sorted fresh lists.
Explicit collation keywords are returned as stored; unmatched locales use
`emoji,eor`, without likely-subtag expansion.
[Five native boundary fixtures](results/native-locale-collations-validation-v1.json)
pass. `Intl.Collator` comparison remains unimplemented; metadata support does not
establish collation-service conformance. The unchanged [collation selection](results/test262-locale-collations-native-v1.json) passes 24/26 variants; both failures instantiate the missing Collator. The updated full Locale selection is pending.

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

The regular-calendar services separate field resolution, conversion queries and
arithmetic from the Temporal adapters. Gregorian-derived calendars retain ISO
month arithmetic and era offsets; Coptic, Ethiopic and Ethioaa use an exact
four-year cycle with thirteen months. Their epagomenal month has five or six days.
The Indian calendar uses Shaka years, a March new year tied to Gregorian leap
years and twelve months. Its field resolution and canonical reference selection
share the regular-calendar resolver with the Coptic families. The Persian
backend uses an exact solar cycle with the complete pinned ICU 77.1 leap-shift
correction table and proleptic AP era years. Its [semantic and reference checks](results/temporal-persian-semantic-validation-h-v1.json)
cover both date-domain limits and the documented corrections.
PlainDate, PlainDateTime, partial dates, ZonedDateTime and Duration relative
context use the same service, including calendar-grid rounding and canonical
reference dates. [Semantic validation](results/temporal-coptic-semantic-validation-h-v1.json)
passes 131 focused tests; the [Indian extension](results/temporal-indian-semantic-validation-h-v1.json)
passes 138 focused tests. Native execution of these new arithmetic families is
held for host Developer Tools authorization; this is not native conformance evidence.

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
