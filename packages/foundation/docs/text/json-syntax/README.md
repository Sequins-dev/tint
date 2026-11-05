# @tint/foundation/text/json-syntax

Strict JSON grammar parsing with no host parser, evaluator or runtime dependency.
`parseJSONText` returns a syntax tree or an undefined node and an UTF16 offset.
Nodes retain exact source spans, number spelling, decoded string code units and
ordered object entries (including duplicate keys). Consumers choose numeric
conversion and object construction policies; `__proto__` has no special meaning.

This is suitable for a JSON runtime adapter, source-preserving transforms and
validation. It accepts exactly JSON whitespace and escapes, rejecting JavaScript
extensions, comments, trailing commas and extra text. Nesting uses the caller's
stack; no fixed language depth limit is imposed.
