# @tint/foundation/chrono/time-zone-identifiers

Portable identifier indexing for standard and compact zic source data. The reader
extracts `Zone`/`Z` and `Link`/`L` records, validates relative ASCII names, rejects
case-insensitive duplicates, dangling links and cycles, and resolves link chains.
It ignores rule and continuation records; `@tint/foundation/chrono/tzif` handles transition data.

Lookup is ASCII case-insensitive and preserves database spelling separately from
the terminal Zone target. Entries are sorted by identifier in code-unit order.
Malformed input returns a typed error and line number; no partial index escapes.
An empty index is valid. File loading, caching and resource budgets belong to hosts.

`targetIdentifier` describes the zic link graph. It is **not** an ECMA-402 primary
identifier: country-specific exceptions, UTC normalization and rename policies
belong to the language adapter. The package has no filesystem, object-model or
runtime dependency and does not itself enable named Temporal zones.
