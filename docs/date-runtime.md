# Date and calendar runtime

## Shared calendar core

`@tint/foundation/chrono/gregorian-calendar` provides proleptic Gregorian date/epoch-day conversion,
with astronomical year numbering and one-based month/day fields. It validates
calendar dates rather than normalizing overflow. The supported domain includes
Date's range and the extra boundary day needed by Temporal. API adapters must
apply their own range checks.

The implementation has no object-model, clock, locale or time-zone dependency.
Date and Temporal can share these calculations without sharing their coercion,
mutation or overflow policies. Date/Temporal built-ins are not supplied by this
package. Its contract is exposed through the foundation chrono entrypoint.

## Integration boundaries

- Date stores a clipped numeric millisecond value in an internal slot. Gregorian
  conversion consumes the integral UTC day; time-of-day arithmetic stays separate.
  Date's constructor/setters normalize fields before clipping, whereas Temporal
  operations have their own constrain/reject rules.
- Current wall-clock time needs an explicit host capability. `@tint/native-runtime/intrinsics/clock` supplies separate wall-clock and monotonic operations.
  Keep their semantics distinct at the host boundary.
- Local-time conversion and time-zone data belong to a separate adapter. UTC
  calculations must not accidentally adopt the bootstrap Node process's zone.
- Parsing, formatting, object branding, coercion order and abrupt completion are
  independent validation slices. Implementing the calendar core is not evidence
  that Date or Temporal conformance tests pass.

## Date implementation

Date has a non-inherited, non-proxy-forwarding numeric `[[DateValue]]` slot.
Numeric construction and branded Date cloning, `Date.UTC`, UTC field accessors,
UTC setters, `getTime` and `setTime` use portable calendar arithmetic. TimeClip
checks the inclusive millisecond range before truncating and canonicalizes zero.
The prototype is unbranded; constructor fallback uses the new target's realm.

Local and UTC setters snapshot the receiver's time before coercing arguments, including
when coercion mutates it. An invalid-time early return preserves coercion side
effects; `setUTCFullYear` instead uses the epoch as its initial calendar value.
Node 24 differs on these cases; the pinned Test262 coercion tests and current
[ECMAScript algorithms](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date.prototype.setutcseconds)
are the behavioral guide.

ISO/UTC serialization, generic JSON serialization and `@@toPrimitive` have native
fixtures. Date parsing supports the interchange grammar and this implementation's
UTC/local serialization, with UTC date-only forms and explicit offsets. Offsetless
date-times use the embedding's local-to-UTC conversion. Temporal annotations and
offset seconds are not accepted as Date interchange syntax.

Wall-clock hosting is an optional realm capability. The native test host explicitly
authorizes `@tint/native-runtime/intrinsics/clock`'s separate wall-clock operation for Date.now and
zero-argument construction. Unhosted realms report unsupported. Local construction,
parsing, getters and setters share an immutable `@tint/foundation/chrono/tzif` zone model through
`installDateTimeZone`. The native test host reads the configured TZif file through
its file facade; portable runtime code performs offset lookup and local-time
resolution, including gaps and overlaps. Compatible resolution chooses the earlier
instant in an overlap and shifts forward across a gap. UTC computations never
substitute monotonic time or assume the host's zone is UTC. See the
[time-zone runtime](time-zone-runtime.md) for data availability and host boundaries.

The [local setter fixture](results/native-date-local-setters-v1.json) and
[New York setter fixture](results/native-date-local-setters-new-york-v1.json)
exercise coercion order and daylight-saving resolution. Local construction has
[host-zone](results/native-date-tzif-construction-v1.json) and
[New York](results/native-date-tzif-new-york-construction-v1.json) native evidence.

The [clock](results/native-date-clock-green-v1.json),
[serialization](results/native-date-format-green-v1.json) and
[parsing](results/native-date-parse-green-v1.json) fixtures pass independently.
The [numeric native fixture](results/native-date-utc-green-v1.json) and
[UTC setter fixture](results/native-date-utc-setters-green-v1.json) pass. Complete
selection measurements live in the [Test262 dashboard](test262.md); the current
local-time additions postdate the latest frozen self-hosting checkpoint.

The [remaining ISO boundary-test analysis](results/date-iso-historical-zone-analysis-v1.json)
identifies six variants that also fail in Node under Asia/Manila. Those files use
1970's offset to infer a date at the negative TimeClip boundary, although the zone
changed across the date line before 1845. Retain the native failures in coverage
reports and preserve historical local-time conversion.

## Verification

Host tests compare a complete 400-year cycle with Node's UTC fields, plus negative
years and boundary days. `tools/verify-hosted-gregorian-calendar.ts` exercises the
same portable algorithms through native output. The [native regression](results/native-gregorian-calendar-focused-v1.json)
passes, including a complete 400-year round trip and verified DWARF. This remains
algorithm evidence, not Date/Temporal API conformance.

## Temporal clock

`Temporal.Now.instant` uses the embedding's wall clock at millisecond resolution,
clamps to Instant bounds, floors before exact nanosecond multiplication, and allocates a fresh intrinsic
Instant in the method's realm. It shares exact conversion with Date-to-Instant
and Instant.fromEpochMilliseconds. The [controlled-clock native fixture](results/native-temporal-now-clock-v2.json)
passes, including clamping and unavailable-capability handling; the complete
[instant selection](results/test262-temporal-now-instant-native-v1.json) passes 18/18. The ISO view methods and default-zone identification use the
embedding's system-zone callback and named-zone provider. The recorded complete
[Now selection](results/test262-temporal-now-system-host-native-v1.json) passes 132/132. Clock precision
can increase without changing those object-allocation or conversion contracts.
The host clock contract follows [HostSystemUTCEpochNanoseconds](https://tc39.es/proposal-temporal/#sec-hostsystemutcepochnanoseconds).

## Temporal integration

Temporal adapters share the Gregorian calendar, ISO date/time parser, calendar
accessors and clock accessors. Each class has independent, non-proxy-forwarding
internal slots; calendar conversion reads those slots rather than public getters.

- **PlainDate:** ISO construction, fields/week accessors, string/property-bag/Temporal
  conversion with overflow options, comparison, equality, calendar copying, partial-date
  conversion, calendar-name formatting, partial-field replacement and
  calendar/time-duration arithmetic and conversion to zoned time.
- **Duration:** exact aggregate range validation, common-sign fields, negation,
  absolute value, ISO string/property-bag conversion, partial replacement and default
  formatting, context-free day/clock addition/subtraction, relative comparison,
  exact unit totals and relative rounding through shared calendar/zoned difference
  primitives. Non-ISO calendar conversion remains unsupported.
- **PlainDateTime:** ISO constructor, nanosecond clock fields, range validation,
  subclassing, string/property-bag/Temporal conversion, comparison and calendar/time
  arithmetic, partial-field/clock replacement, day/clock rounding, precision/calendar-name
  formatting and non-Intl locale serialization. Rounded results receive the
  same date-time range checks as construction.
- **PlainYearMonth/PlainMonthDay:** reference ISO components, class-specific
  calendar fields and calendar-name formatting. YearMonth checks month-level
  limits independently of PlainDate's day limits. Static conversion supports ISO
  strings and property bags, canonicalizes reference components and preserves
  them when cloning. YearMonth comparison and both equality methods include the
  complete reference ISO date. PlainDate conversion reads only the required day
  or year, constrains overflow and allocates with the intrinsic PlainDate prototype.
  YearMonth addition/subtraction accepts only years and months, derives the first
  day before shared date arithmetic and canonicalizes the result reference day.
  Its derived PlainDate and resulting date must satisfy day-level bounds.
  Partial replacement shares ISO field merging and canonicalizes reference
  components. YearMonth differences validate year/month units after ordered
  option reads, compare complete reference dates before the zero shortcut, and
  share exact date-difference and calendar-rounding primitives. Both partial-date
  prototypes own branded `toLocaleString` methods. The core non-Intl fallback
  serializes internal slots and ignores locale/options arguments without reading
  public `toString` or date fields.
- **PlainTime:** constructor, clock fields, ISO time strings with ambiguity checks,
  property-bag/Temporal conversion, overflow options and comparison. Shared clock
  records contain no artificial calendar date. Time-only arithmetic, equality,
  rounding, precision formatting and non-Intl locale serialization share the
  exact arithmetic helpers; partial replacement preserves omitted fields.
- **Instant:** exact epoch bounds and millisecond flooring, BigInt/millisecond
  factories, instant-like string coercion, offset-aware parsing, comparison,
  equality, exact time-only arithmetic, solar-day rounding increments and precision/offset
  formatting. Calendar annotations do not select an Instant calendar. Difference
  methods support exact signed differences with independent Number conversion
  of balanced fields. Zoned conversion accepts fixed/UTC identifiers, ISO strings
  carrying them and branded ZonedDateTime values.
- **ZonedDateTime:** exact BigInt epoch splitting, UTC/fixed-minute-offset
  construction, calendar/clock/epoch fields, intrinsic Instant/plain-type conversion
  and calendar/time-zone copying, partial replacement, clock replacement and
  start-of-day conversion. Calendar additions run before exact clock-duration
  arithmetic, preserving nanosecond precision and independent range validation. Static conversion accepts ISO strings, branded
  values and ISO property bags; comparison uses exact epochs, while equality also
  compares canonical zone identifiers. Property-bag reads and coercions follow
  field order before options and calendar/clock regulation. Offset use/ignore/
  prefer/reject policies share the zone interpretation path.
  Named zones use the embedding's bounded TZif provider; unavailable data remains
  explicitly unsupported. Zoned formatting controls precision,
  offset/time-zone display and calendar annotations, rounding the exact epoch before
  converting to local time. Display options are read in specification order.

PlainDate and ZonedDateTime own branded core `toLocaleString` methods. Without
Intl formatting, these serialize intrinsic slots and ignore locale/options
arguments and public `toString` overrides. The same contract applies to the
partial-date methods described above.

Exact arithmetic and rounding use shared `@tint/foundation/numeric/big-integer`,
`@tint/foundation/chrono/temporal-duration` and `@tint/foundation/numeric/integer-rounding` primitives. The object
adapters own observable option reads, coercions, branding and range checks.
Instant rounding follows the specification's positive-coordinate tie rules;
clock rounding wraps a day rather than imposing Instant's epoch bounds.

Gregorian and Japanese property bags prepare `era` and `eraYear` in field order,
including primitive coercion and abrupt completion, before the unsupported
calendar-conversion boundary. Independent options are read before that boundary.
ISO bags ignore era fields. The [red-first semantic tests](results/temporal-calendar-preparation-tdd-h-v1.json)
and [25 direct native regression cases](results/native-temporal-calendar-cumulative-green-h-v10.json)
cover preparation and the existing partial-date operations; calendar arithmetic
remains ISO only. These bespoke cases are separate from Test262 coverage.

Constructor availability does not imply complete Temporal coverage. Non-ISO
calendars, remaining methods and relative-calendar differences are separate slices.
Complete selection results and retained failures belong in the
[Test262 dashboard](test262.md); pure-algorithm and bespoke native tests are
reported separately there.

Partial date/date-time replacement shares ISO month-pair merging and preserves
omitted clock components. Native regression cases cover brands, getter order,
month-code consistency, constrain/reject overflow, intrinsic allocation and the
lower date-time boundary: [PlainDate](results/native-temporal-date-with-own-signature-v2.json),
[PlainDateTime](results/native-temporal-date-time-with-own-signature-v2.json).
These are bespoke cases; unchanged full selections are measured separately.

The [YearMonth arithmetic fixture](results/native-temporal-year-month-arithmetic-green-h-v1.json)
passes five native cases covering lower-unit rejection, coercion/option order,
reference-day normalization, intrinsic allocation and derived-date boundaries.
The [cumulative validation](results/temporal-partial-runtime-validation-h-v3.json)
includes a byte-identical native self-build and stage2 smoke, with workspace gates
and complete selection measurement still pending. The fixture contributes no
Test262 passes.
The [partial-update and difference fixture](results/native-temporal-partial-updates-green-h-v1.json)
passes eight native cases, including field order, brands, canonical references,
calendar-unit rounding, boundary dates and the existing PlainDate difference path.

The [zoned conversion native regression](results/native-temporal-zoned-bags-green-v1.json)
passes nine focused cases, including getter order, early offset-syntax errors,
subsecond offsets, overflow and range boundaries. The corresponding
[pre-implementation cases](results/native-temporal-zoned-bags-red-v1.json)
were explicitly unsupported. These are regression fixtures, not Test262 totals.

Additional native regressions cover [partial zoned replacement](results/native-temporal-zoned-with-green-v1.json),
[clock replacement and day boundaries](results/native-temporal-zoned-time-copy-green-v1.json),
and [calendar/exact-time arithmetic](results/native-temporal-zoned-arithmetic-green-v1.json).

Plain-date and date-time conversion use the shared zone resolver and
intrinsic zoned allocation. [Date conversion](results/native-temporal-date-to-zoned-green-v1.json)
and [date-time conversion](results/native-temporal-date-time-to-zoned-green-v1.json)
cover observable reads, branded zones and epoch bounds. Zoned display/precision
options have [native regression coverage](results/native-temporal-zoned-format-green-v1.json);
unchanged complete selections are indexed in the Test262 dashboard.

Clock-difference options share a validated settings record between Instant,
PlainTime and ZonedDateTime. Zoned clock units compare exact instants across
zones; calendar units first require matching zone identities. Equal instants
produce zero durations. Nonzero named-zone calendar differences retain a local
date prefix and an exact epoch remainder, with calendar and clock rounding using
actual zone endpoints. The [named-calendar fixture](results/native-temporal-zoned-calendar-v1.json)
passes five focused cases; these are separate from complete selection results.

PlainDate differences use the shared Gregorian calendar difference primitive.
Month/year decomposition compares unregulated anniversaries, constraining only
the selected anchor. `since` negates the receiver-anchored result rather than
swapping endpoints. Date rounding uses exact integer boundary distances;
month/year units do not assume a fixed number of days. Day increments preserve
calendar prefixes and carry expanded results across larger unit boundaries.
Bespoke native regressions cover [initial differences](results/native-temporal-date-difference-green-v1.json),
[day increments](results/native-temporal-date-day-rounding-green-v1.json) and
[calendar rounding](results/native-temporal-date-calendar-rounding-green-v1.json).
Complete unchanged selections remain separate conformance measurements.

Duration totals share a single relativeTo conversion with branded fast paths and
ordered calendar/clock/offset/zone property reads. Plain ISO dates use actual
calendar spans; zoned values resolve local endpoints before comparing exact
epoch differences. Conversion
of the resulting integer ratio to binary64 rounds once, including subnormal and
overflow handling, using `@tint/foundation/numeric/big-integer.divideToNumber`. Its
[native numeric fixture](results/native-integer-ratio-focused-v1.json) is separate
from conformance results. [Focused total cases](results/native-temporal-duration-total-green-v1.json)
cover observable field order, brands, fixed units and calendar contexts. The
complete total selection and subsequent boundary corrections are tracked in the
Test262 dashboard.

PlainDateTime differences retain exact civil coordinates beyond Instant bounds.
Fractional-clock calendar rounding shares PlainDate's endpoint comparisons, and
expanded clock days share its calendar carry operation. Native regressions cover
[fractional calendar boundaries](results/native-temporal-date-time-calendar-rounding-green-v1.json)
and [clock-to-calendar carries](results/native-temporal-date-time-clock-carry-green-v1.json).

Duration addition/subtraction balances exact day/clock totals using the largest
input unit; context-free arithmetic rejects years, months and weeks. Comparison
uses exact elapsed integers, with plain calendar or zoned context when required.
It reads both operands and relativeTo before the identical-fields fast path.
[Arithmetic](results/native-temporal-duration-arithmetic-green-v1.json) and
[comparison](results/native-temporal-duration-compare-green-v1.json) have focused
native coverage; full selections are recorded independently.

Local strings retain the standard `GMT±HHmm` prefix. Historical second offsets
include an implementation-defined `(UTC±HH:mm:ss)` label so Tint's own strings
round trip exactly; this does not extend the ISO interchange offset grammar.
Portable boundary tests cover both Date limits. Raw Gregorian coordinates are
separate from clipped calendar APIs so local offsets cannot erase a valid instant
at a boundary. Offsets exceeding 24 hours also retain their full value in the
optional label. The [native coordinate fixture](results/native-gregorian-coordinate-v1.json)
and [60 native serialization round trips](results/native-date-wide-offset-format-v1.json)
pass. The
[historical formatting native fixture](results/native-date-historical-format-v1.json)
passes seven cases; older complete selections retain their unsupported
historical-formatting observations.

`Date.prototype.toTemporalInstant` reads only the branded Date slot, converts
integer milliseconds to nanoseconds exactly and allocates with the method realm's
intrinsic Instant prototype. The [native fixture](results/native-date-to-temporal-instant-v1.json)
covers both Date limits, invalid/incorrect receivers, proxies and cross-realm calls.
The [complete Date selection](results/test262-date-family-native-v8.json)
passes 1,176/1,188 variants, including all 16 Date-to-Instant variants.
