# @tint/foundation/text/text-scanner

Reusable mutable cursor over an immutable JavaScript string. No package dependencies,
encoding, language grammar, filesystem access or binary-format policy.

`createScanner(text)` provides `offset`, `done`, `peekCode`, `advance`, `match`,
`mark`, `restore` and `eatWhile`. Coordinates and peeked values are **UTF-16 code
units**, matching `@tint/source/text` and JavaScript string indexing. Astral characters
occupy two units; this cursor does not classify Unicode identifiers.

`peekCode(ahead = 0)` returns -1 at EOF or for invalid lookahead. `advance(count = 1)`
and `restore(offset)` return false on noninteger/out-of-range arguments without
changing position. Marks are plain offsets into this string, including EOF.
`match(text)` consumes an exact nonempty prefix only on success; empty matches fail.
`eatWhile(predicate)` returns the consumed substring. Predicates must not mutate
or reenter this cursor. A thrown predicate propagates, retaining prior progress.
Each scanner owns its cursor; callers must serialize access.

The design adapts Fino's generalized scanner's cursor/matching/checkpoint operations.
See [NOTICE](NOTICE.md) and the retained [MIT license](LICENSE.fino). Its binary and
encoding machinery is not included. Byte decoding belongs to standard TextDecoder
and source snapshots, not this module.
