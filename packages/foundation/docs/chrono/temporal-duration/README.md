# @tint/foundation/chrono/temporal-duration

Immutable numeric duration records, exact validity checks, ISO duration parsing
and default formatting. Inputs to `createDuration` are numbers in years-through-nanoseconds
constructor order; omitted entries default to zero. Invalid nonintegral/nonfinite
values, mixed signs, or out-of-range totals return `undefined`. Use the factory
rather than fabricating records, and treat returned fields as immutable.

The year/month/week bounds are checked independently. The aggregate day/time bound
uses arbitrary-precision integer nanoseconds, preserving unsafe integer inputs and
subsecond differences at the 2^53-second boundary. `durationText` preserves unit
fields while balancing subsecond fields into seconds; it does not round options,
perform calendar-relative arithmetic, or consult clocks, locales or time zones.
Observable JavaScript coercions and exceptions belong to the runtime adapter.

`parseDuration` accepts signed ISO durations, preserving integral units and expanding
1–9 decimal places on the final hours/minutes/seconds component into exact smaller
units. It accepts comma fractions and ASCII case variants, rejects out-of-order
or duplicate units, and applies the same validity bounds as `createDuration`.
Parsing has no JavaScript object-coercion or host dependency.

`durationTimeNanoseconds` sums only the clock fields into an exact integer.
`balanceTimeDuration` divides an exact signed total into hour-through-nanosecond
fields, starting at the requested largest clock unit. Each field is independently
converted to Number, including its specified floating-point precision loss;
rounding policies and observable options belong to the caller.
