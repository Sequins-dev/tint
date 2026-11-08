# Complete built-ins/Temporal native coverage

All **9,210/9,210 runtime variants** across **4,605 pinned files** pass. There are no remaining failures, unsupported cases, crashes, timeouts, harness errors or unmeasured variants.

The standard coverage-ledger validator selected the latest valid complete evidence for each variant from 179 accepted reports; none were rejected. These counts combine frozen toolchains and overlapping reports. They are not a single-toolchain full-family rerun. Original non-passes remain in their immutable reports.

| Family | Native pass / total |
| --- | ---: |
| Duration | 1,080 / 1,080 |
| Instant | 934 / 934 |
| Now | 132 / 132 |
| PlainDate | 1,304 / 1,304 |
| PlainDateTime | 1,546 / 1,546 |
| PlainMonthDay | 398 / 398 |
| PlainTime | 986 / 986 |
| PlainYearMonth | 1,018 / 1,018 |
| ZonedDateTime | 1,802 / 1,802 |
| Temporal namespace | 10 / 10 |

The [machine-readable audit](temporal-builtins-complete-native-audit-h-v1.json) records every input report hash, pinned revision, complete denominator and canonical variant-table digest. The [core locale acceptance](temporal-core-locale-and-zoned-gaps-acceptance-h-v1.json) preserves the four original PlainDate failures and records complete passing rechecks for PlainDate and ZonedDateTime locale methods.

The locale fixes add own branded core fallback methods and preserve intrinsic serialization and ignored locale/options arguments. DateTimeFormat and DurationFormat work remains parked on `park/intl-formatting-service-h` at `1a0d439e455d17022a031f3a05026efeaebcd919`; intl402 is deferred.

Validation on the final main-derived integration snapshot: Node 24.12.0, workspace gate, native regression fixtures, frozen native self-build, strict signatures/DWARF, byte-identical stage images and smoke execution with entry-stop/exit-42 checks. See [final integration](temporal-core-locale-latest-integration-h-v145.json).

Canonical variant table SHA-256: `ef2550a2734517df85c7dff7dbb01b4d2e2b86d00902ca8b5d4974e9addd4595`.
