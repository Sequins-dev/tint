# @tint/foundation/numeric/integer-rounding

Exact rounding of arbitrary-precision signed integers to positive increments.
Nine modes control direction and half-way ties. `roundInteger` uses the value's
sign for expand/trunc; `roundIntegerAsIfPositive` uses a positive coordinate system,
as required for Temporal.Instant rounding before the epoch.

Invalid increments return `undefined`; `parseRoundingMode` validates external mode
strings. Results use canonical `@tint/foundation/numeric/big-integer` values, with no binary64
conversion, calendar, object model, locale or host dependency.
