# DateTimeFormat time-zone services — compile-only; native pending

The presentation data resolves all 860 numeric-service locales from checksum-pinned
CLDR 49: 421 zone naming identities, 155 metazones and 248 territories. It retains
localized specific/generic names, exemplar cities, offset/location patterns,
reference zones, half-open UTC metazone histories and formatting day-period rules.
Monrovia's historical boundary retains second precision. BCP47 zone home territories
remain separate from metazone reference membership. Primary-territory extraction
preserves the numeric attribute name iso3166. Missing explicit city/territory names
and optional zero-offset patterns remain available to the formatter's fallback
rules; this data API does not synthesize names or install DateTimeFormat.

TZif/POSIX services expose seasonal identity separately from offset values,
including equal-offset seasons, negative adjustments and unavailable horizons.
43 focused tests pass, including every locale's patterns and hourly day periods.
The full workspace gate passes 4726/4726. One incorrect Paris test oracle is
retained in green-h-v1; v2 checks the actual explicit French label for London.
Generator failures are retained, including the second-precision boundary and
numeric-attribute discoveries.

Frozen v33 compiled the hosted fixture and prepared compiler. Signature and DWARF
verify for both; all 592 copied compiler sources match. No native execution,
Test262 result or stage comparison is claimed.

After HOST AUTHORIZATION RESTORED, use the original guarded .tint-bootstrap scripts
with direct launch and heartbeat30000/stall150000:

- observe-hosted-date-time-zone-data-direct-h-v33.mjs verifies captured image and
  source hashes, then requires the expected entry stop and exit42.
- intl-date-time-zone-data-selfbuild-resume-driver-h-v33.mjs, under slot selfbuild 2,
  verifies native stage comparison, signature, DWARF and smoke execution.

Archive copies preserve the scripts; imports are relative to the original ignored
copies. No ready line is posted before native execution and stage comparison.
