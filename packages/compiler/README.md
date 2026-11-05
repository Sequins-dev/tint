# Compiler orchestration

Direct library and executable entrypoints share the existing native pipeline:

- `@tint/compiler/native`: native IR preparation/emission and managed compiler APIs.
- `@tint/compiler/build`: macOS executable build orchestration.
- `@tint/compiler/project`: explicit compiler project and runtime provider configuration.
- `@tint/compiler/catalog`: generated source-file and import-grant metadata.
- `@tint/compiler/cli`: native compiler main and its existing configuration exports.

See [native compilation](native.md), [building images](build.md) and
[native CLI](cli.md) for the existing API contracts.

The TypeScript frontend remains independent of this orchestration framework.
Compilation phase order, native host authorization and runtime namespace identities
are unchanged; native adaptation remains separate follow-up architecture work.
