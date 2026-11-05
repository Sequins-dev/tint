The cursor API and matching/checkpoint/predicate-scanning design are adapted from
Fino's MIT-licensed js/parsing/scanner.ts, copyright 2026 Fino contributors.
Reference checkout: 3c78f3b07e5bd2cd3d885437b8de3db6d05a12a4.
See LICENSE.fino for the retained license. Tint uses UTF-16 string offsets, bounded
result-style movement and closure-owned state instead of Fino's binary/text class.
No Fino encoding implementation or runtime import was copied.
