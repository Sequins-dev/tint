# @tint/foundation/unicode/identifiers

Dependency-free Unicode 17.0.0 `ID_Start` and `ID_Continue` membership queries over
integer code points. Surrogates and invalid numeric inputs are rejected. The API
does not normalize text or add language-specific identifier characters.

The JavaScript lexer adds `$`, `_`, ZWNJ and ZWJ according to its own grammar.
Ranges are generated from the pinned Unicode Character Database using
`node tools/generate-unicode-identifiers.ts [path-to-DerivedCoreProperties.txt]`.
The generator verifies the source SHA-256; generated tables are committed, so
ordinary builds do not access the network. Format generated output with Prettier.
Characters assigned in Unicode 16 are checked against Node's independent
Unicode 16.0 property escapes; newer additions have focused tests and are exercised
by the pinned Test262 Unicode 17 identifier sources. See `LICENSE-UNICODE.txt` for data terms.
