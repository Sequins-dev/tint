# DateTimeFormat calendar data — compile-only; native pending

The shared presentation data resolves 13,760 profiles (860 numeric-service
locales, 16 calendars) from checksum-pinned CLDR 49. Native-compatible accessors
retain style patterns, available skeletons, interval patterns, month/day names,
modern Japanese eras, cyclic years, Hebrew leap names and lunar leap wrappers.
The extractor resolves inherited source-locale aliases, including DTD standard
format defaults. No public DateTimeFormat constructor is installed by this slice.

The hosted fixture compiled on frozen v32. Its source snapshot and image identity
come from its build manifest. Signature and DWARF verify for both this image and
the prepared compiler; all 590 copied compiler sources match. The full gate passes
4719/4719. The earlier formatting failure is retained. No native execution,
Test262 result or stage-image comparison is claimed.

After HOST AUTHORIZATION RESTORED, use the guarded original scripts in
.tint-bootstrap, with direct launch and heartbeat30000/stall150000:

- observe-hosted-date-time-calendar-direct-h-v32.mjs verifies captured hashes and
  requires the expected initial stop and final exit42.
- intl-date-time-calendar-selfbuild-resume-driver-h-v32.mjs, under slot selfbuild 2,
  verifies native stage comparison, signature, DWARF and smoke execution.

Archive copies in docs/results preserve these scripts. Frozen imports are intended
to execute from the original .tint-bootstrap copies. Arithmetic will retain its
own ready line after native evidence; no ready line is posted for this slice yet.
