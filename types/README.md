# Trusted global type contracts

`text-encoding.d.ts` is a type-only view of the standard TextEncoder/TextDecoder
surface consumed by `@tint/source/text`. Its package tsconfig explicitly includes this
file. Other portable packages keep the ES2023-only baseline; ambient declarations
inside package source remain rejected by the boundary checker.

These declarations do not install globals or implement a codec. Node supplies the
standard implementations for bootstrap. Tint's native runtime must implement the
corresponding standard globals in TypeScript before compiling their callers.
This is the currently consumed subset of the standard typing surface, not a claim
that a complete native Encoding API already exists. Tests use Node's normal types.

`runtime-fs.d.ts` defines the seven synchronous `node:fs` exports consumed by the
compiler file adapter. `tsconfig.host.json` checks that adapter with Node ambient
types disabled, and `pnpm typecheck` runs this check. It does not implement native
filesystem operations or make Node modules available to portable packages. The
[host surface](../docs/runtime-host-surface.md) records the implementation boundary.

`runtime-events.d.ts` and `web-events.d.ts` describe Tint's ESM events export
and Web event globals for TypeScript tooling. Event maps associate emitter event
names with argument tuples and target event names with event objects. Tint's
runtime shares one implementation across callers.

`runtime-path.d.ts`, `runtime-url.d.ts`, and `web-url.d.ts` describe the ESM
path variants, URL helpers, and realm-local Web URL constructors.

`runtime-util.d.ts`, `runtime-assert.d.ts`, and `runtime-node-codecs.d.ts`
describe the utility and assertion ESM exports, incremental string decoding,
and query strings. The byte-returning APIs import their Buffer type from the
explicit module contract in `runtime-buffer.d.ts`.
