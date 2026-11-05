# JSON runtime

Semantics follow the [ECMAScript JSON algorithms](https://tc39.es/ecma262/multipage/structured-data.html#sec-json-object).

## Boundaries

`@tint/json-syntax` parses strict JSON without host evaluation. Its immutable tree
retains UTF16 spans, decoded strings, number spellings and duplicate object entries.
It does not create JavaScript objects or decide numeric encodings. The ordinary-object
adapter realizes the tree using realm-local object and array prototypes. Duplicate
keys overwrite earlier values; `__proto__` is an ordinary data property.

## Observable behavior

- Parse revivers walk properties after their children, using captured key lists or
  array lengths. They read each current value through ordinary object operations,
  so mutations, inherited properties and proxies remain observable. Failed deletion
  or redefinition returns are ignored as required; thrown exceptions propagate.
- Each reviver call receives a fresh context object. Primitive source text is
  available only when the current value matches its original parse record under
  SameValue. Replacing a parent discards its descendants' original source context.
- Stringify applies `toJSON`, then the replacer, then wrapper conversion. It snapshots
  enumerable string keys, preserves whitelist order, tracks active ancestors for
  cycles, and quotes lone surrogates without altering paired UTF16. Array holes
  use ordinary property access and unsupported element values become null.
- Raw JSON objects have a null prototype, one frozen `rawJSON` data property and an
  internal brand. They accept only a primitive JSON text without surrounding
  whitespace. Proxies and inherited properties cannot impersonate the brand.
  Raw numeric spelling survives serialization without a binary64 round trip.

## Validation

The complete JSON family passes **332/332** Test262 variants, with no failures,
unsupported cases, crashes, timeouts or harness errors
([report](results/test262-json-native-v1.json)). Focused native
[stringify](results/native-json-stringify-focused-v1.json),
[parse](results/native-json-parse-focused-v1.json) and
[raw-value](results/native-json-raw-focused-v1.json) regressions pass all 26 cases.
Selection totals and older reports remain in the [dashboard](test262.md).

The parser and serializer use recursive traversal. They have no explicit language
nesting cap; native stack limits still apply. Date serialization depends on the
separate Date implementation. This module does not implement dynamic evaluation.
