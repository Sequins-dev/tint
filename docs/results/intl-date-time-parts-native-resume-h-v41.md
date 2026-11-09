# DateTimeFormat parts rendering — compile-only; native pending

The renderer shares calendar arithmetic, presentation data and private decimal
number formatting. It emits literal/numeric fields, related and cyclic years,
era years and labels, stable lunisolar month names and leap wrappers, weekdays,
flexible periods and supplied exact-input time-zone labels. Short weekday names
now retain LDML's distinct six-letter form for every locale/calendar profile.
Gregorian/ISO BCE, modern Japanese eras, Islamic AH/BH, Ethiopic AA/AM and
single-era signed years share the calendar backend. Pre-modern Japanese CE/BCE
labels use the Gregorian presentation profile, matching Temporal's proleptic
modern-era arithmetic. Time-zone label resolution is the next service layer;
this renderer requires it as explicit input when a zone token is present.

39 focused tests pass. Lunisolar labels and periods are checked across all 860
locales; numeric checks include Arabic and astral digits. The initial bare-ar
Arabic-digit assumption is retained; the corrected test requests arab explicitly
because pinned CLDR49's bare-ar numeric profile defaults to latn. The short-weekday
red test is retained. The full workspace gate passes 4742/4742.

Frozen v39 and v40 compile failures are retained: replaceAll was outside the strict
native surface, and an inferred am/pm literal union needed an explicit string
annotation before receiving flexible period names. Frozen v41 compiled the hosted
fixture and prepared compiler. Signature and DWARF verify for both; all 594 copied
sources match. No native execution, Test262 result or stage comparison is claimed.
Public DateTimeFormat remains later work.

After HOST AUTHORIZATION RESTORED, use the original guarded .tint-bootstrap scripts
with direct launch and heartbeat30000/stall150000:

- observe-hosted-date-time-parts-direct-h-v41.mjs verifies captured image and source
  hashes, then requires the expected entry stop and exit42.
- intl-date-time-parts-selfbuild-resume-driver-h-v41.mjs, under slot selfbuild 2,
  verifies native stage comparison, signature, DWARF and smoke execution.

Archive copies preserve the scripts; imports are relative to the original ignored
copies. No ready line is posted before native execution and stage comparison.
