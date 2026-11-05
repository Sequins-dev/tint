# String normalization

`@tint/foundation/unicode/normalization` provides a portable
`normalizeUnicode(text, form = "NFC")` algorithm. It supports NFC, NFD, NFKC and
NFKD using pinned Unicode 17 data, including Hangul decomposition/composition,
canonical ordering and composition exclusions. Lone UTF-16 surrogates are
preserved. Invalid form names return `undefined`; callers own error policy.

The live `String.prototype.normalize` adapter supplies ECMAScript coercion and
realm-specific errors. It converts the receiver before the form, defaults only
an actual `undefined` form to NFC, and throws RangeError for invalid names.
This does not register a separate strict-profile String intrinsic.

## Implementation

Generated tables encode code points and offsets in packed UTF-16 strings.
Canonical ordering uses insertion for small runs and stable counting for longer
runs, avoiding quadratic work on adversarial combining sequences. Composition
preserves blocking rules and does not introduce stream-safe text characters.

Normal builds require no Unicode downloads. The generator and corpus verifier
live in `tools/generate-unicode-normalization.ts` and
`tools/verify-unicode-normalization.ts`; input hashes and Unicode licensing are
recorded with the generated data.

## Evidence

| Scope                                        | Result                                                                               | Report                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Official Unicode 17 corpus on bootstrap host | 20,034 rows, all 400,680 relations pass                                              | [Host corpus](results/unicode-normalization-unicode17-host-v3.json) |
| Compiled native algorithm                    | 80,140 checks pass: four forms for each corpus row plus boundary and long-run checks | [Native corpus](results/unicode-normalization-native-v2.json)       |
| Unchanged Test262 normalize selection        | 25/28; three pre-entry debugger failures, no observed semantic failures              | [Native Test262](results/test262-string-normalize-native-v1.json)   |

The corpus fixtures are algorithm regressions, separate from Test262 coverage.
Host tests also cover metadata, coercion ordering, abrupt completion, borrowed
cross-realm methods and bounded work on long combining runs.
