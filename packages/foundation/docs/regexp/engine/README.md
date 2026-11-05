# RegExp execution core

Portable compilation and matching over `@tint/foundation/regexp/syntax`, with no host RegExp
calls. The TypeScript implementation runs under Node or through Tint's native
pipeline. It owns matching state; JavaScript object construction, coercion,
`lastIndex`, and prototype methods belong to the runtime adapter.

`compileRegExp(pattern, flags)` returns an immutable control-flow program or an
explicit syntax, capacity, or unsupported diagnostic. The program records ordered
alternatives, capture boundaries, repeat state, assertions and nested lookarounds.
Execution uses an explicit backtracking stack, preserving captures and counters
when restoring a choice. Lookaround results are atomic, and lookbehind executes
its sequence in reverse while keeping returned offsets in source order.

`executeRegExp(program, input, start?, sticky?, maxSteps?)` returns a match with
UTF-16 capture ranges, `no-match`, an invalid-argument result, or a work-budget
limit. Unmatched captures are undefined. It never mutates the program or fabricates
a failed match when its work budget is exhausted. Both Unicode modes read code
points; legacy patterns read UTF-16 code units. Set expressions retain longest
string preference and backtracking to shorter alternatives.

Currently supported: literals, dot/classes/categories, anchors,
word boundaries, alternatives, captures and named/numeric backreferences, bounded
and unbounded greedy/lazy repeats, lookahead/lookbehind, scoped ignoreCase/multiline/
dotAll modifiers, and Unicode set operations with string alternatives. Legacy
uppercase canonicalization and Unicode simple folding use pinned Unicode 17.0.0
tables, including inverse equivalence classes for range matching. Regenerate with
`node tools/generate-regexp-case-data.ts` (or pass a directory containing the pinned
input files); source checksums and license are retained with the generated data.
General category, script, script-extension and binary character membership use
`@tint/foundation/unicode/properties`; Unicode properties of strings remain an explicit
compilation gap. JavaScript RegExp objects belong to the
ordinary-object adapter. See [runtime coverage](../../docs/regexp.md) for validation
and remaining integration gaps.
