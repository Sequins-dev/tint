# Shared duration units — compile-only; native pending

CLDR49 profiles cover all 860 locales, ten duration units in three widths,
plural categories, unit lists and numbering-system-specific digital separators.
NumberFormat now renders these time units through the shared private engine,
including Arabic singular/dual patterns without a numeric placeholder and
microsecond/nanosecond identifiers required by pinned DurationFormat tests.
Other NumberFormat units remain in cluster I scope.

25 focused tests and all 4822 workspace tests pass. Frozen v55 compiled the
native unit fixture and prepared compiler; signatures, DWARF and all 605 copied
source files verify. No native execution or stage comparison is claimed.

After HOST AUTHORIZATION RESTORED, run the original .tint-bootstrap scripts with
TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct, heartbeat30000 and stall150000:

- observe-hosted-unit-format-direct-h-v55.mjs requires entry stop and exit42.
- unit-format-selfbuild-resume-driver-h-v55.mjs under slot selfbuild2 requires
  byte-identical native stage images and a native smoke test.

Archive copies retain their original relative imports. No ready line is posted
before this evidence is obtained. Generator failures and red/green test logs are
retained alongside the successful build and gate reports.
