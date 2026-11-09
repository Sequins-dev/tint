# DateTimeFormat zone-name rendering — compile-only; native pending

The pure service renders localized specific/generic names, metazone type fallback,
reference-country/city qualifiers and localized GMT offsets for all 860 locales.
Short country labels use explicit CLDR alternate selectors; ordinary lookups still
ignore alternates. Numeric rendering reuses the existing parts service's private
decimal formatters. Offset formatting preserves locale signs, separators, direction
marks, padding and historical seconds. CLDR49 has no explicit gmtZeroFormat in the
shipped locale registry; numeric zero-offset forms retain the explicit offset.
UTC specific names remain distinct from fixed numeric offsets.

The 184-day stability check inspects all recorded transitions and future POSIX
anchors, including short seasons and equal-offset flag changes hidden between
identical endpoint samples. Negative future-rule pairs select conventional CLDR
season labels when the exact current offset/type matches that pair; raw TZif
flags remain unchanged. Metazone history gaps fall back to location or offset
forms rather than extrapolating another metazone.

48 focused tests pass, including all locale hour-pattern shapes and both recorded
and future short seasons. The full workspace gate passes 4751/4751. Frozen v42
compiled the hosted fixture and prepared compiler. Signature and DWARF verify for
both; all 595 copied sources match. No native execution, Test262 result or stage
comparison is claimed. The public DateTimeFormat constructor remains later work.

After HOST AUTHORIZATION RESTORED, use the original guarded .tint-bootstrap scripts
with direct launch and heartbeat30000/stall150000:

- observe-hosted-date-time-zone-name-direct-h-v42.mjs verifies captured image and
  source hashes, then requires the expected entry stop and exit42.
- intl-date-time-zone-name-selfbuild-resume-driver-h-v42.mjs, under slot selfbuild 2,
  verifies native stage comparison, signature, DWARF and smoke execution.

Archive copies preserve the scripts; imports are relative to the original ignored
copies. No ready line is posted before native execution and stage comparison.
