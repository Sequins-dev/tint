# RegExp syntax

Portable ECMAScript regular-expression flag and pattern parsing. The package has
no host dependencies and does not call the host's RegExp implementation.

`parseRegExpFlags(text)` validates flag names, repetition and the `u`/`v` conflict.
`parseRegExp(pattern, flags)` returns flags, the capture count, the name-to-capture table and a structural AST,
or a diagnostic distinguishing `syntax`, `unsupported` and `limit`. Diagnostic
offsets are UTF-16 offsets in the indicated pattern or flags input. Inputs are
pattern text without slash delimiters; constructor patterns may contain newlines.

The AST represents characters, classes/ranges/categories, sequences, alternatives,
anchors/boundaries, capturing/noncapturing groups, lookahead/lookbehind, numeric
backreferences, scoped flag modifiers, and greedy/lazy repetitions. Capture numbers follow opening-group
order; forward references are resolved against the complete capture count. Unicode
mode decodes code points and rejects legacy-only escapes and range forms. Legacy
mode retains octal escapes, identity escapes, quantified lookaheads and the
literal-backslash fallback for malformed control escapes.

Capture names use the shared Unicode identifier tables, including escaped names.
Named references can precede their groups. Duplicate names are accepted only when
the groups lie in distinct alternatives of a shared disjunction; the name table
retains each capture number. Modifier nodes retain their local enable/disable sets
without changing the pattern's outer flags.

Unicode property escapes resolve exact ECMAScript aliases to canonical property
and value descriptors. General categories and Script/Script_Extensions values use
pinned Unicode 17.0.0 data; binary properties use ECMAScript's explicit whitelist.
Regenerate aliases with `node tools/generate-regexp-unicode-aliases.ts` (optionally
passing a local PropertyValueAliases.txt); the generator verifies the source hash.
Ordinary builds use the committed tables and need no network access.

Unicode set notation (`v`) has a distinct set-expression AST for nested classes,
unions, intersections, subtractions, complements and decoded `\q{...}` string
alternatives. String properties use ECMAScript's whitelist. Complement early
errors follow the grammar's static MayContainStrings rules, including intersection
and subtraction; they do not guess whether the resulting set is empty. The `u`
and `v` flag bits remain distinct while both enable code-point parsing.
Nesting over 128, more than one million atoms, and quantifier bounds beyond exact
Number integer capacity return `limit`. Unsupported and limited patterns have not
been certified valid and must not be treated as syntax errors or successful parses.

This package supplies syntax for compiler and runtime consumers; it does not match
strings or provide RegExp objects. Tests compare grammar outcomes with the host
reference, inspect AST contents, and exercise the portable parser in native output
through `tools/verify-hosted-regexp-syntax.ts`.

Reference: [ECMAScript pattern grammar and early errors](https://tc39.es/ecma262/multipage/text-processing.html#sec-patterns),
including its Annex B legacy extensions.
