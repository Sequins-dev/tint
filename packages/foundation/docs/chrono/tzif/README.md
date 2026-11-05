# @tint/foundation/chrono/tzif

Portable TZif container reader, following [RFC 9636](https://www.rfc-editor.org/rfc/rfc9636.html).
It accepts byte input and returns local type records, exact two's-complement
64-bit transition timestamps and the ASCII footer. It owns no filesystem,
clock, default zone, Date/Temporal policy or OS adapter.

Version 2–4 files use their 64-bit block; the bounded legacy block is skipped.
The reader checks headers, lengths, ordered transitions, type/designation indices
and standard/UT indicators. Designations retain their original bytes because the
format does not mandate their encoding. Footer decoding uses TextDecoder.
Leap-aware tables explicitly return LEAP_SECONDS_UNSUPPORTED: treating their
transition timestamps as ordinary Unix seconds would change their meaning.

The container reader retains a raw footer; its grammar is parsed separately.
The raw footer alone does not establish a usable future transition schedule.
In particular, an empty footer after the final transition must not be interpreted
as permission to extend the final offset indefinitely.

`readPosixTimeZone` parses fixed offsets and explicit daylight-saving rules,
including Julian, ordinal and month/week/weekday dates. Extended signed transition
hours require an explicit version opt-in. Omitted implementation-defined DST
rules return DEFAULT_RULES_UNSUPPORTED instead of borrowing host defaults.

`posixOffsetSecondsAt` evaluates the parsed rules over the shared Date/Temporal
epoch-day domain with a two-day surrounding probe window for local-time
resolution before final instant clipping. It uses the offset before each transition, supports northern,
southern and negative daylight saving, and handles the RFC's all-year DST case.
Adjacent-year anchors are not clipped at Date's endpoints. The binary-reader
footer remains raw until a zone is prepared.

`createTzifZone` combines recorded transitions with parsed future rules and checks
last-transition offset consistency where the evaluation domain permits it.
`tzifOffsetSecondsAt` uses binary search for historical records and the footer
beyond their horizon. Unavailable future rules stay unknown. Unspecified -00
designations default to unavailable; callers can explicitly choose the stored
offset policy when preparing a model. Raw designation bytes remain unchanged.

`analyzeTzifLocalSeconds` exposes all verified overlap candidates or the actual
gap transition and its earlier/later projections. Callers can distinguish the
first instant of a skipped midnight from ordinary compatible clock resolution.
`resolveTzifLocalSeconds` verifies candidate instants against the full offset
model, then applies compatible/earlier/later/reject disambiguation. Gap handling
uses actual transition offsets, including half-hour and skipped-day jumps. It
reports invalid inputs, unavailable data and rejected ambiguity separately.
These APIs use integral seconds; adapters retain milliseconds or nanoseconds
independently. Filesystem lookup, default-zone policy and runtime integration
remain embedding responsibilities.

`findTzifTransition` accepts an integral-second cursor, direction, inclusivity and
explicit search bounds. It returns actual UTC offset changes, skipping changes of
abbreviation or rule with unchanged offset. Future POSIX rules are checked across
a complete Gregorian cycle, including adjacent rule years; an unknown data
horizon remains unavailable rather than becoming a claim of no transitions.
Adapters handle subsecond strictness and their own valid-instant bounds.
