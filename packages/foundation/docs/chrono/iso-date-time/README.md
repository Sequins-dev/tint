# @tint/foundation/chrono/iso-date-time

Portable parsing of a full ISO calendar date with optional time, UTC offset,
and bracket annotations. It reuses `@tint/foundation/text/text-scanner` and the Gregorian calendar
core. `parseISODateTime` returns a structured value or an invalid-input offset.

The result preserves the time's nanosecond fraction, UTC designator, numeric
offset, raw time-zone annotation and calendar annotation. Leap seconds normalize
to second 59. Calendar and time-zone availability, API-specific UTC restrictions,
and Date/Temporal range limits belong to adapters. Parsing never consults a host
clock, time-zone database, locale service or JavaScript Date parser.

Date/time separators and basic/extended forms are checked consistently. Annotation
keys are lowercase; unknown critical annotations and duplicate critical calendar
annotations are rejected. Noncritical unknown annotations are ignored; the first
noncritical calendar annotation wins. This API requires a full date; calendar
adapters can supply reference dates when parsing year-month, month-day or time
forms. It does not parse durations or expose date arithmetic.

Portable grammar tests and native parsing/Temporal integration fixtures pass;
current evidence belongs in the Test262 dashboard. `formatISODate` and
`formatISOTime` format validated fields, leaving offsets and annotations to adapters.

`ISOTime` is the four-field clock record shared by plain/zoned date-times and times;
its nanosecond field is the complete fraction of a second. `parseISOTimeString`
accepts full date-times and bare times, retains offset/annotation metadata, and
rejects bare forms ambiguous with valid ISO year-month or month-day strings unless
prefixed with `T`. It does not apply Temporal's API-specific rejection of `Z` or
resolve named time zones. Time-only results contain no invented date.

`parseISOTimeZoneString` accepts a syntactic zone identifier or extracts one from
an ISO date/time, year-month or month-day string. Bracketed zones take precedence
over Z and UTC offsets; a selected numeric identifier has minute precision.
Zone availability and canonical spelling belong to the runtime adapter.
