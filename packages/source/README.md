# Source framework

Portable source snapshots, logical module catalogs and explicit import resolution.
Each entrypoint is independently reachable and has no host or language-frontend
dependency:

- `@tint/source/text`: `createSourceText`, `createSourceTextView` and position types.
- `@tint/source/catalog`: `createCatalog`, `isModuleId` and catalog types.
- `@tint/source/resolver`: `createResolver`, import grants and resolution diagnostics.

## Text and positions

`createSourceText(bytes, maxByteLength)` copies the input view and decodes strict
UTF-8 with the standard global `TextDecoder`, preserving the BOM and line endings.
The standard `TextEncoder` supplies encoded widths for byte indexing. Node provides
these globals during bootstrap; native Tint supplies its existing TypeScript
encoding runtime through the compiler's explicit global-constructor bindings.
The framework has no alternate codec or runtime-provider dependency.

A snapshot exposes `text`, `byteLength`, `lineCount`, `copyBytes()`,
`byteToUtf16(offset)`, `utf16ToByte(offset)`, `positionAt(offset)` and
`offsetAt(line, column)`. Byte/UTF-16 conversions require exact boundaries, including
rejecting the interior of an encoded scalar or surrogate pair. Line/column queries
can address every UTF-16 code unit and use one-based coordinates. EOF is valid.
LF, CR, LS and PS terminate lines; CRLF counts once. Columns count code units,
not display width or graphemes. Position failures are explicit result values.

`createSourceTextView(text)` retains the exact UTF-16 string, including lone
surrogates, and provides line/column queries without a byte encoding round trip.
The TypeScript parser consumes these views; parsing belongs to the language
frontend rather than this framework.

## Logical catalogs

`createCatalog<T>(entries)` snapshots `{ id, value }` registrations. `ids()` returns
fresh arrays in ascending ASCII order; `lookup(id)` is exact and case-sensitive,
distinguishing a present undefined value from a missing entry. Registration
rejects malformed IDs, duplicates and ASCII case collisions.

IDs are project-relative ASCII paths with `/` separators and letters, digits,
underscore, hyphen or dot in nonempty components. Absolute paths, empty components,
`.`/`..`, backslashes, escapes, queries and fragments are rejected. Catalogs do
not normalize IDs or interpret physical filesystem paths.

## Explicit resolution

`createResolver(catalog, mappings)` snapshots exact
`{ packageId, specifier, target }` grants. Package identity scopes the importing
consumer; mappings do not grant access to another consumer. Exact declared public
subpaths are supported, including nested entries. Ungranted deep imports remain
`DEEP_IMPORT`; no wildcard, extension or internal-source fallback is inferred.

Relative `.ts` requests normalize `.`/`..` but must remain within the importing
package and resolve to an existing catalog member. The literal `node:fs` facade
also needs an explicit grant; arbitrary Node modules are not supported by that
exception. Resolution validates UTF-16 spans and returns precise diagnostics with
positions and optional candidate IDs.

Resolution does not evaluate modules, reject all cycles or implement Node package
search. Source graph loading and parsing are composed by `@tint/typescript/modules`;
ESM binding, linking and evaluation semantics belong to later compiler stages.
The flat test suites preserve text ownership/Unicode cases, catalog identity and
isolation, and exact relative/public/facade grant behavior.
