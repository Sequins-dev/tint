# DateTimeFormat engine and API native validation

After host authorization was restored on 2026-11-07, the eight unchanged hosted
fixtures below completed through direct debugger launch. Each observation records
the build manifest, frozen source identity, stopped-at-entry assertion and final
expected exit42. These are bespoke native regressions, separate from Test262.

| Service | Frozen version | Native observation |
| --- | --- | --- |
| Pattern parser and matcher |31|[Completed](native-intl-date-time-pattern-h-v31.json)|
| Calendar presentation data |32|[Completed](native-intl-date-time-calendar-h-v32.json)|
| Zone data |33|[Completed](native-intl-date-time-zone-data-h-v33.json)|
| Skeleton resolution |38|[Completed](native-intl-date-time-skeleton-h-v38.json)|
| Parts renderer |41|[Completed](native-intl-date-time-parts-h-v41.json)|
| Zone names |42|[Completed](native-intl-date-time-zone-name-h-v42.json)|
| Ranges |43|[Completed](native-intl-date-time-range-h-v43.json)|
| Public constructor and API |52|[Completed](native-intl-date-time-format-api-h-v52.json)|

The [standalone frozen compiler comparison](intl-date-time-format-api-selfbuild-h-v52.json)
produced byte-identical 60095586-byte stage images from source snapshot
`50a028d9acc0ded1461cb2f0c272c31de70602a91e735312a99472a7d7abf6b5` (599 files).
Signature and DWARF checks passed. The native stage2 compiler produced an identical
smoke image, whose execution stopped at entry and exited42.
[Progress log](intl-date-time-api-selfbuild-restored-h-v52.log.gz).

The rebased branch retains exactly the same formatting sources. Its portable
snapshot differs from frozen52 only in two already-merged main files: the required
PlainDate calendar factory contract and checker closure-flow cost. Both are also
present in the separately validated full formatting snapshot69. The fresh
[rebased workspace gate](intl-date-time-api-rebased-check-h-v2.json) records the
current branch snapshot and pinned Node24.12.0 host.

The [first gate attempt](intl-date-time-api-rebased-wrong-host-h-v1.json) accidentally
used Homebrew Node26 and failed only the pinned Unicode16 oracle assertion
(4788/4789). Its original log is retained. No source was changed to address it.
Temporal-object integration and locale methods are a following slice. Complete
DateTimeFormat Test262 measurement is running on the integrated frozen69 stack;
no complete conformance result is claimed here.
