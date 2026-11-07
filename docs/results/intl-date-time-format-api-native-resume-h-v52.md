# DateTimeFormat public API — compile-only; native pending

The constructor and non-Temporal methods compose the shared calendar, skeleton,
parts, zone-name and range services. Configuration reads options once in order;
legacy chaining unwraps only format/resolvedOptions. Results use the method realm
and own data properties. Locale keywords negotiate independently, unsupported
options preserve valid extensions, and named-zone aliases preserve their available
identifier and canonical casing. Two-digit clock matching uses inherited CLDR
ASCII alternates where available, consistently across numbering systems.

53 focused tests and the full 4786-test workspace gate pass. The first full gate
retains one stale Script-surface census failure; comparison with frozen v43
confirmed the new readonly pattern-token list provider, five aliases and eight
operations. The updated inventory also passes runtime specialization, directory
materialization and physical ABI checks.

Frozen v52 compiled the public API fixture and prepared compiler. Signatures and
DWARF verify for both images; all 599 copied sources match the frozen snapshot.
Earlier failed native compilations v44–v51 remain recorded, including fixture
generic arguments, optional binding/property guards and an explicit default-
parameter annotation. No execution, stage comparison or native Test262 result is
claimed. Temporal object paths and locale forwarding remain the next slice.

After HOST AUTHORIZATION RESTORED, run the original guarded scripts in
.tint-bootstrap with direct launch, heartbeat 30000 and stall 150000:

- observe-hosted-date-time-format-api-direct-h-v52.mjs verifies image/source hashes
  and requires the expected entry stop and exit 42.
- intl-date-time-format-api-selfbuild-resume-driver-h-v52.mjs, under slot
  selfbuild 2, verifies stage comparison, signatures, DWARF and smoke execution.

Archive copies preserve the scripts; imports resolve from their original ignored
locations. No ready line is posted before execution and stage comparison.
