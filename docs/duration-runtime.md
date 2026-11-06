# Duration arithmetic and formatting

Duration fields are validated, independently representable Number integers. Exact
clock arithmetic uses the shared big-integer and rounding packages until fields
are materialized. Calendar fields remain distinct from elapsed nanoseconds.

## Relative arithmetic

`relativeTo` is converted before choosing the arithmetic path. Branded Temporal
values use their slots; property bags retain the specified getter/coercion order.
Named-zone strings preserve supplied-offset precision when matching historical
offsets. Clock totals and comparisons use exact endpoints across offset changes.

`Duration.round` reads largestUnit, relativeTo, roundingIncrement, roundingMode,
then smallestUnit. Missing units and explicit largestUnit `auto` remain distinct.
Context-free days have 24 hours. Plain-relative calendars use civil endpoints;
zoned calendars separate calendar days from the exact clock remainder before
rounding. That separation affects half-even parity even in UTC. Both candidate
boundaries must be valid when an algorithm requires them, including a boundary
which the chosen rounding mode will not select.

Named-zone unrounded calendar differences select a local date at the origin's
clock time and retain the exact remaining epoch difference. Offset changes and
repeated local clocks therefore cannot be reduced to civil-time subtraction.
Calendar totals and single-unit calendar rounding share an exact fraction between
adjacent calendar endpoints. Rounding uses integer distances and parity rather
than first converting that fraction to Number. Clock-unit rounding retains calendar
prefixes and carries expanded results through actual zone boundaries. Non-ISO
calendar conversion remains explicitly unsupported.

## String precision

String formatting shares the precision-option reader used by other Temporal
objects, with Duration's restriction to seconds and smaller units. Formatting
preserves explicit trailing zeros. Rounding can carry clocks into days, while
leaving weeks, months and years independent. A nanosecond quantum of one preserves
the original field balance. Rounded zero has no negative sign.

Native conformance measurements belong in the [Test262 dashboard](test262.md);
focused fixtures and self-build checkpoints remain separate evidence there and
in [bootstrap status](bootstrap.md).
