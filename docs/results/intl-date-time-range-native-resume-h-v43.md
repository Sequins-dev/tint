# DateTimeFormat ranges — compile-only; native pending

The service selects compact CLDR intervals, preserves argument order, collapses
equal displayed precision and tags shared/start/end parts. Same-date fallback
shares the date while repeating only time fields. Calendar/era and hidden
more-significant fields prevent incorrect collapse. Related/cyclic year interval
patterns follow the pinned CLDR data, including related-year-only variants.

57 focused tests pass, including interval/source checks across all 860 locales.
The full workspace gate passes 4760/4760. Frozen v43 compiled the hosted fixture
and prepared compiler; signatures and DWARF verify for both, and all 596 copied
sources match. Execution, Test262 measurement and stage comparison are pending
HOST AUTHORIZATION RESTORED. No ready line has been posted.

After restoration, run the original guarded scripts in .tint-bootstrap with
TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct,
TINT_TEST262_HEARTBEAT_MS=30000 and TINT_TEST262_STALL_MS=150000:

- observe-hosted-date-time-range-direct-h-v43.mjs verifies captured hashes and
  requires the expected entry stop and exit 42.
- intl-date-time-range-selfbuild-resume-driver-h-v43.mjs, under slot selfbuild 2,
  verifies native stage comparison, signature, DWARF and smoke execution.

Archive copies preserve the scripts; imports resolve from their original ignored
locations. The earlier green-v1 log retains an incorrect Chinese yearName oracle;
the corrected expectation follows the compact CLDR related-year-only pattern.
