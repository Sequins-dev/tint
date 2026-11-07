# PlainDate start of day — compile-only; native pending

The broader calendar probe found that PlainDate.toZonedDateTime used compatible
midnight disambiguation even when plainTime was absent. During a gap crossing
midnight, that can skip the first portion of the date. Toronto1919-03-31 starts
at00:30, while compatible disambiguation of explicit midnight yields01:00.

Commit9e9ae965 reuses the existing temporalStartOfDay algorithm for omitted or
undefined plainTime. Explicit times retain the usual disambiguation. A synthetic
TZif transition reproduces the failure without host data and verifies all three
omitted-time forms, explicit midnight, and preserved ISO/Gregorian/Japanese
calendar identity. The first test fails by1800seconds before the fix.

All4832 workspace tests pass; seven focused start-of-day/zone tests pass.
The first gate retained its test-only type-import error, corrected in52f5eec0.
Frozen v65 compiled the hosted regression and compiler. Signatures, DWARF and all607
copied source files verify. v63/v64 retain fixture dependency/global errors;
no runtime failure or native execution is claimed for any of these builds.

After HOST AUTHORIZATION RESTORED, run the original .tint-bootstrap scripts with
direct launch, heartbeat30000 and stall150000:

- observe-hosted-temporal-date-start-of-day-direct-h-v65.mjs requires entry stop
  and expected exit42.
- temporal-date-start-of-day-selfbuild-resume-driver-h-v65.mjs under slot
  selfbuild2 verifies native stage comparison, signatures/DWARF and smoke.

Then rerun the unchanged intl402/Temporal/PlainDate selection into a new complete
report. Preserve the old64-variant result and all hold journals. Resume the held
ISO PlainYearMonth journal on original v12 first. No ready line is posted during
the hold.

Diagnostic breadth after the fix:3387 ISO Temporal examples,1906 calendar Temporal
examples,299 DateTimeFormat/Temporal locale examples and86 DurationFormat/locale
examples complete with no remaining adapter errors. These populations overlap
and exclude reflection/metadata cases; they cannot be summed into coverage or
counted as native passes. Every refinement failure and adapter script is retained
in separate immutable reports. The DateTimeFormat bridge uses TZ=UTC consistently
with its Tint clock facade. Native validation and all new complete reports remain
blocked by host Developer Tools authorization.
