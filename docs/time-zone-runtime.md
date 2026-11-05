# Time-zone runtime

`@tint/tzif` supplies portable transition data and local-time resolution. It owns
no filesystem or default-zone selection. The pipeline is binary TZif → recorded
transitions plus parsed POSIX future rules → offset lookup and local resolution.
Date and Temporal adapters retain their own coercion, fractional precision and
range policies.

## Contracts

- The reader preserves signed 64-bit timestamps exactly using Word64. Prepared
  lookup saturates transitions beyond Number's safe range for safe-integer queries;
  the original words remain available. Leap-aware files are explicitly unsupported.
- Historical lookup uses binary search. A missing future footer does not authorize
  extending the last recorded offset indefinitely. Unspecified -00 types remain
  unavailable. Future rules distinguish Julian and ordinal days and support signed
  transition hours, southern seasons, negative DST and all-year DST.
- Local resolution verifies every candidate offset against the model. Compatible
  chooses the earlier occurrence in an overlap and shifts forward through a gap.
  Earlier, later and reject policies are explicit. Actual transition offsets
  determine half-hour and skipped-day gaps; no fixed one-hour assumption is used.
- Model APIs consume integral Unix seconds. Adapters preserve millisecond or
  nanosecond remainders separately, including negative timestamps. Invalid input,
  unavailable data and rejected ambiguity remain distinct results.

## Hosting and integration

Date binds both conversion directions to the same prepared model. The native test
host reads /etc/localtime through the existing file-service/native-fs boundary;
configured TZ names select /usr/share/zoneinfo entries. The configuration and read
budget are recorded in execution resources. Node only generates the executable;
zone data is loaded and evaluated by native output. Missing data leaves the
capability unavailable. Filesystem policy stays outside the portable model.

`@tint/time-zone-identifiers` extracts Zone and Link records from zic metadata,
resolves chains and preserves case-correct identifiers separately from terminal
data targets. It rejects duplicate names, cycles, missing targets and unsafe paths.
The [Node system index inventory](results/time-zone-identifier-system-index-node-v1.json)
contains 598 identifiers with no missing file targets. The
[native index fixture](results/native-time-zone-identifiers-v1.json) verifies all
598 identifiers and targets against the recorded checksum.
Database links do not by themselves define ECMA-402 primary identifiers.

The ordinary-object adapter uses 601 mappings from checksum-pinned CLDR 48 data,
including country-primary exceptions, UTC aliases and IANA replacement names.
The [native primary-identity fixture](results/native-time-zone-primary-identifiers-v1.json)
checks all 598 host identifiers. `Factory` has no available primary-policy target;
that state remains distinct from an unrecognized name. New unmapped Zone records
can retain their own primary identity; unmapped Links require explicit policy.
An unavailable replacement identifier is never invented for an older database.
Generate the table with `tools/generate-time-zone-primary-identifiers.ts`; the
source URL, digest and Unicode license accompany the generated data.

`createNamedTimeZoneProvider` composes that metadata with bounded host reads and
cached TZif models. Aliases share transition models without merging their language
identities. Missing files and invalid data remain separate cached outcomes. The
[native provider fixture](results/native-named-zone-provider-v1.json) covers real
New York daylight-saving transitions, cross-country identity separation and cached
failures. The native Test262 host installs this provider from bounded reads below
`/usr/share/zoneinfo`, independently of the default Date time-zone file.

## Temporal adapters

Zoned values retain either a fixed offset or a named transition model. Their cached
local fields describe one instant; conversions and arithmetic query the model again
rather than treating that observation as a permanent offset. Primary identifiers
control equality without merging country identities or changing public aliases.

Local interpretation supports earlier/later/compatible/reject disambiguation and
use/ignore/prefer/reject offset policies. String offsets without explicit seconds
can match a historical offset rounded to a minute; property bags and explicit
seconds match exactly. Day boundaries use the first instant of the local date,
including midnight gaps. Calendar additions resolve local time before adding exact
clock units; day rounding and hoursInDay use actual consecutive day boundaries.

The [native public-API fixture](results/native-temporal-named-host-green-v1.json)
checks overlap selection, gaps, historical seconds, primary equality, calendar
addition, startOfDay, hoursInDay and rounding. Temporal.Now's ISO views share that
model and an explicit system-zone identifier callback; a separate
[native controlled-clock fixture](results/native-temporal-now-views-v1.json) checks
intrinsic allocation, clock precision and conversion-before-clock ordering. Its
[missing-host observation](results/native-temporal-named-host-red-v1.json) remains
recorded separately. Full Test262 selection reports belong in the dashboard.

Named-zone Duration relativeTo totals and nonzero calendar differences remain
explicitly unsupported. Fixed-offset calendar differences reuse the civil-calendar
algorithm while validating zoned rounding endpoints against Instant limits. The native Test262 host obtains the system zone from explicit TZ configuration
or the /etc/localtime symlink, then validates it through the database and primary
identifier policy. Equal TZif bytes never determine identity. The
[native system-host fixture](results/native-temporal-now-system-host-v1.json) and
[complete Now selection](results/test262-temporal-now-system-host-native-v1.json)
exercise this path. Link reading uses the finite filesystem facade; missing or
unrecognized identity remains explicitly unavailable. Inline POSIX TZ
environment settings also need a hosting policy; footer parsing alone does not
supply one.

The language adapters explicitly use encoded offsets for -00 unspecified civil
prehistory, matching established JavaScript behavior for uninhabited periods.
Generic TZif models keep an unavailable default and retain the original
designation. The Date adapter prepares its own policy view without mutating a
caller's model; missing data and unknown future rules remain separate conditions.

## Transition and enumeration contracts

`findTzifTransition` searches within explicit integral-second bounds, skips
changes that preserve the UTC offset, and distinguishes an unknown horizon from
no transition. POSIX rules are checked across a Gregorian cycle with adjacent
rule years. The Temporal adapter preserves nanosecond strictness and returns an
intrinsic ZonedDateTime with the receiver's zone and calendar.

`Intl.supportedValuesOf("timeZone")` uses a stable, sorted primary-name inventory,
including UTC and non-continental zones. It allocates a fresh Array without
exposing the inventory. Other enumeration keys await their own data services;
locale-formatting constructors are separate pending features. The
[native inventory/API fixture](results/native-intl-zone-enumeration-v1.json) and
[native Script fixture](results/native-intl-zone-system-host-v1.json) cover the
445-name system inventory, fresh arrays, coercion and error behavior.

## Evidence

The [binary reader](results/native-tzif-reader-green-v1.json),
[footer parser](results/native-posix-time-zone-parser-v1.json),
[future rule evaluation](results/native-posix-time-zone-offset-v1.json) and
[local resolution](results/native-tzif-local-resolution-v1.json) have independent
native fixtures. Local resolution includes New York, Lord Howe and Apia, and a
future-rule gap beyond recorded transitions. A separate
[system-data inventory](results/tzif-system-zone-inventory-v1.json) parsed all 599
system files in Node; this is neither native conformance nor a Test262 percentage.
