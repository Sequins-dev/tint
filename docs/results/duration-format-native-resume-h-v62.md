# DurationFormat — compile-only; native pending

The private engine formats all ten duration units using shared CLDR49 profiles,
plural patterns, inherited lists and numbering-system-specific digital separators.
It preserves overflowed clock fields, inserts bridge minutes, displays one leading
sign and combines subsecond fields using exact binary64 integer values before
truncation. Parts retain singular unit names on NumberFormat-origin records and
omit them on digital/list separators.

The public service implements construction, supportedLocalesOf, resolvedOptions,
format and formatToParts with realm-local results, receiver brands, observable
option/field reads and abrupt completion. Temporal.Duration.toLocaleString uses
this private service independently of mutable public Intl properties.

All 4831 workspace tests pass. 17 focused numerical/unit/duration tests pass.
The managed surface gains one unit-options list class and eight operations.
Frozen v62 compiled the hosted fixture and compiler; signatures, DWARF and all607
copied source files verify. Six preceding compile failures retain their frozen
identities and corrective commits. No native execution or stage comparison is
claimed.

Node adapters exercised86 selected unchanged DurationFormat/locale examples:
85 completed, with one retained proxy reflection limitation around deleting a
configurable symbol property. Direct API unit tests verify that descriptor.
Broader diagnostics completed1791 selected ISO and1511 non-ISO calendar examples
without remaining adapter errors. These are not native conformance counts, full
family reports, or additions to the coverage ledger.

After HOST AUTHORIZATION RESTORED, use the original .tint-bootstrap scripts with
TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct, heartbeat30000 and stall150000:

- observe-hosted-duration-format-direct-h-v62.mjs requires entry stop and exit42.
- duration-format-selfbuild-resume-driver-h-v62.mjs under slot selfbuild2 requires
  byte-identical native stage images, signatures/DWARF and smoke execution.

Resume the held ISO PlainYearMonth journal on its original v12 identity first.
Then measure complete intl402/DurationFormat (220variants), intl402/DateTimeFormat
(490variants) and transferred Temporal locale selections with batch64, a fresh
journal/report for each and the frozen v62 runner. Arithmetic receives a separate
ready line after its own execution evidence. No ready line is posted during the
hold. Archived scripts retain their original relative imports.
