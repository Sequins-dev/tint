# Temporal formatting and locale forwarding — compile-only; native pending

DateTimeFormat now handles PlainDate, PlainYearMonth, PlainMonthDay, PlainTime,
PlainDateTime and Instant through their brands. It preserves raw options and
caches each model's format independently of legacy Date defaults. Plain values
ignore zone shifts and names, retain coordinates beyond Date's TimeClip bounds,
and enforce calendar compatibility. Instants split exact nanoseconds before local
conversion. Ranges convert both inputs before requiring matching Temporal types.
Public ZonedDateTime inputs remain rejected as required by the pinned tests.

Temporal toLocaleString uses the private service. ZonedDateTime supplies its own
zone, rejects any defined timeZone option before coercion and adds the default
specific zone label. GMT itself requires no location qualifier; numeric offset
styles retain explicit zero according to CLDR49. The required G-owned integration
is isolated in commit 45f280e0: Date's three locale methods now share the private
formatter, including their defaults, style restrictions and invalid-date order.

The single-field skeleton fallback no longer displaces real locale affixes or
implicit AM/PM. Basic matching includes the additional required fractional-second
subsets. 224 focused date/Temporal tests and all 4813 workspace tests pass.
Diagnostic Node adapters exercised 299 unchanged pinned examples, with 285
completed and 14 retained reflection/realm bridge limitations. These are not
native conformance counts.

Frozen v54 compiled the integration fixture and prepared compiler. Both signatures
and DWARF verify; all 603 copied source files match. No execution, stage comparison
or native Test262 result is claimed. The earlier v53 public-Temporal fixture also
compiled, and its descriptor/log are retained.

After HOST AUTHORIZATION RESTORED, use the original scripts in .tint-bootstrap
with direct launch, heartbeat30000 and stall150000:

- observe-hosted-temporal-date-time-format-direct-h-v54.mjs validates hashes and
  requires the entry stop and expected exit42.
- temporal-date-time-format-selfbuild-resume-driver-h-v54.mjs, under slot
  selfbuild2, verifies native stage comparison, signatures, DWARF and smoke.

Archive copies retain their original relative imports. No ready line is posted
before execution and stage comparison. DurationFormat is the next service slice.
