# DateTimeFormat skeleton resolution — compile-only; native pending

The shared resolver matches field coverage before width distance, preserves locale
numeric/text overrides and time padding, retains calendar-required eras and joins
date/time patterns with locale glue. It supports standalone period/fraction
patterns, fractional seconds, append patterns with localized labels and style
clock-cycle changes. ECMA-402 calendar-year patterns normalize locale week-year Y
when a calendar-year skeleton requested it (the Kölsch yM entry). Cyclic year
names no longer overwrite an explicit related-year width.

The generator now distinguishes appendItem records by request and requires every
append pattern. Its localized labels are emitted for all 860 locales and 16
calendars. This corrects the earlier calendar presentation data's empty append
sets; earlier immutable build-only evidence remains unchanged.

28 focused tests pass, including all seven required component subsets across all
860 locales. The full workspace gate passes 4735/4735. Retained failures include
incorrect space/Paris-style test assumptions, missing append labels and numeric
calendar-year handling. Frozen v34–v37 compile failures capture native surface and
narrowing limitations. Integer priority masks, typed indexed token copies,
checked immutable sources and direct style-key narrowing correct those failures.

Frozen v38 compiled the hosted fixture and prepared compiler. Signature and DWARF
verify for both; all 593 copied sources match. No native execution, Test262 result
or stage-image comparison is claimed. Public DateTimeFormat remains later work.

After HOST AUTHORIZATION RESTORED, use the original guarded .tint-bootstrap scripts
with direct launch and heartbeat30000/stall150000:

- observe-hosted-date-time-skeleton-direct-h-v38.mjs verifies captured image and
  source hashes, then requires the expected entry stop and exit42.
- intl-date-time-skeleton-selfbuild-resume-driver-h-v38.mjs, under slot selfbuild 2,
  verifies native stage comparison, signature, DWARF and smoke execution.

Archive copies preserve the scripts; imports are relative to the original ignored
copies. No ready line is posted before native execution and stage comparison.
