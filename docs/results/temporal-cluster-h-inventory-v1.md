# Cluster H Temporal inventory

Pinned Test262 revision: `91c70759363c46557b694792bf34a2551a7af5ba`. Counts include every strict/sloppy variant and exclude only fixture files. This inventory is not native conformance evidence.

| Selection | Files | Variants | Latest complete class report |
| --- | ---: | ---: | --- |
| `built-ins/Temporal/ZonedDateTime` | 901 | 1802 | None |
| `built-ins/Temporal/PlainDateTime` | 773 | 1546 | None |
| `built-ins/Temporal/PlainDate` | 652 | 1304 | None |
| `intl402/Temporal/ZonedDateTime` | 583 | 1166 | None |
| `built-ins/Temporal/Duration` | 540 | 1080 | None |
| `built-ins/Temporal/PlainYearMonth` | 509 | 1018 | None |
| `built-ins/Temporal/PlainTime` | 493 | 986 | None |
| `intl402/Temporal/PlainDate` | 493 | 986 | None |
| `intl402/Temporal/PlainDateTime` | 483 | 966 | None |
| `built-ins/Temporal/Instant` | 467 | 934 | [346/934](test262-temporal-instant-native-v1.json) (older snapshot) |
| `intl402/Temporal/PlainYearMonth` | 327 | 654 | None |
| `built-ins/Temporal/PlainMonthDay` | 199 | 398 | None |
| `intl402/Temporal/PlainMonthDay` | 90 | 180 | None |
| `built-ins/Temporal/Now` | 66 | 132 | [132/132](test262-temporal-now-system-host-native-v1.json) (older snapshot) |
| `intl402/Temporal/Duration` | 21 | 42 | None |
| `intl402/Temporal/Instant` | 17 | 34 | None |
| `intl402/Temporal/PlainTime` | 12 | 24 | None |
| `intl402/Temporal/Now` | 3 | 6 | None |
| `built-ins/Temporal/toStringTag` | 2 | 4 | None |
| `built-ins/Temporal/getOwnPropertyNames.js` | 1 | 2 | None |
| `built-ins/Temporal/keys.js` | 1 | 2 | None |
| `built-ins/Temporal/prop-desc.js` | 1 | 2 | None |

Total: 13268 variants. Instant v1 is stale relative to subsequent implementation; Now system-host v1 is the newest complete Now selection. Method-level reports in the dashboard do not establish class totals.

Source-level prerequisites (not measured outcomes):

- Non-ISO calendars are recognized by `canonicalTemporalCalendar` but rejected by `requireISOCalendar` in `packages/js-runtime/src/objects/temporal-coercion.ts`. Complete support requires calendar field conversion, era/year resolution, arithmetic and differences across the date-bearing adapters; merely accepting the identifier would silently compute ISO semantics.
- Localized string paths require Intl.DateTimeFormat and Intl.DurationFormat, which the Intl runtime documents as unimplemented. Several adapters currently alias locale output to ISO serialization, and ZonedDateTime lacks the method. This needs coordination with the Intl service implementation rather than a locale-string stub.
