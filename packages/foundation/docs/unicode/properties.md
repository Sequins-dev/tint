# Unicode character properties

Portable Unicode 17.0.0 character-property membership, with no dependencies or host
Unicode/RegExp calls. The database includes general categories and their aggregate
categories, Script, Script_Extensions, binary UCD/emoji character properties, and
ASCII/Any/Assigned. Property names and values must be canonical UCD names; aliases
and language-specific whitelists belong to callers.

- `hasUnicodeProperty(property, value, point)` returns a membership boolean, or
  `undefined` for an unknown property/value. Use an empty value for binary properties.
- `unicodePropertyRanges(property, value = "")` returns an immutable encoded set,
  or `undefined`. A known property with no members returns an empty string.
- `containsUnicodeRangeSet(set, point)` queries a set returned by that lookup.
  Invalid code points return false. Surrogate code points are valid Unicode property
  inputs; they belong to General_Category=Surrogate.

Each encoded range occupies four UTF-16 code units: start high/low words followed
by end high/low words. The generated ranges are sorted and merged. Treat the string
as opaque data; do not normalize or reinterpret it as Unicode text. This keeps
large tables in the native literal pool rather than generating instructions to
initialize each numeric boundary.

Regenerate with `node tools/generate-unicode-properties.ts`, or pass a directory
containing the pinned UCD files with their standard names/subdirectories. Every
input is checked against its recorded SHA-256 digest. Format the generated source
after regeneration. Source URLs, digests and the Unicode license accompany the data.

This package classifies individual code points. Unicode properties of strings
(such as RGI emoji sequences), case folding, normalization and locale-sensitive
behavior are separate concerns.
