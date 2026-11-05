# @tint/foundation/unicode/casing

Unicode 17 default full upper/lower casing for UTF-16 strings. Supports expanding
mappings, supplementary characters, unpaired surrogates and context-dependent
Greek final sigma. It does not implement locale tailoring or normalization.

`unicodeUppercase(text)` and `unicodeLowercase(text)` are independent of the object
runtime and host locale. Immutable mapping tables come from checksum-pinned
UnicodeData and SpecialCasing inputs; context properties reuse
`@tint/foundation/unicode/properties`. Regenerate with `node tools/generate-unicode-casing.ts`
(optionally pass a local UCD directory). The generator rejects unknown conditional
rules instead of silently omitting them. Unicode data licensing is included.

Tests cover every code point against Node, with explicit Unicode 17 additions
beyond Node 24's Unicode 16 data, plus multi-character context and expansion cases.
