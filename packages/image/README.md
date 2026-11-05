# @tint/image

Link code fragments and construct native executable images. Five explicit compiled
entrypoints keep generic layout and debug information separate from Darwin image
formats. There is no root export.

| Entrypoint                       | API                         | Purpose                                                                 |
| -------------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `@tint/image/layout`             | `link`                      | Align fragments, resolve symbols and apply checked fixups.              |
| `@tint/image/dwarf`              | `buildDebugInfo`            | Encode source lines, function ranges, variables and frame information.  |
| `@tint/image/darwin/dyld-fixups` | `buildImportFixups`         | Encode chained import fixups with explicit library ordinals.            |
| `@tint/image/darwin/signature`   | `signatureSize`, `signCode` | Size and serialize Apple ad-hoc signatures independently of Mach-O.     |
| `@tint/image/darwin/macho`       | `buildExecutable`           | Package supplied position-independent arm64 code as a macOS executable. |

```ts
import { buildExecutable } from "@tint/image/darwin/macho";

const result = buildExecutable({
  code,
  entryOffset: 0,
  identifier: "example.program",
  minimumOS: { major: 26, minor: 6, patch: 2 },
  sdk: { major: 26, minor: 6, patch: 0 },
  maxByteLength: 1024 * 1024,
});
```

Successful builders return newly owned output bytes; supplied buffers are borrowed
synchronously and must not be mutated concurrently. Failures return explicit
errors without partial output. Allocation and internal invariant failures may
throw. The caller owns filesystem writes, executable permissions and publication.

The Mach-O entry accepts encoded A64 instructions; it does not compile TypeScript
or validate instruction semantics. Code and entry offsets must be aligned to four
bytes, with the entry inside nonempty code. The output budget covers the final
file including its signature. The platform entry uses Darwin's native `main` ABI;
this is separate from Tint's managed-function calling convention.

Optional imports use explicit names and library ordinals. Optional data, address
references, symbols, source lines and frames are validated before serialization.
MAP_JIT entitlements require explicit permission from the caller. The image
builder does not resolve symbols in the host or authorize runtime calls.

The UUID is derived from SHA-256 of the finalized unsigned image with a zero UUID
field followed by its explicit ASCII identifier. Signing hashes the finalized
prefix, including that UUID, in 4096-byte pages. Signatures support explicit
special blobs; inputs, identifiers, offsets, flags and byte budgets are checked.
Neither UUID construction nor ad-hoc signing introduces clock or random inputs.

Generic layout and DWARF entries depend only on foundation algorithms. Darwin
Mach-O currently also uses `@tint/codegen/aarch64/isa` to patch relative address
references. OS services and compiler orchestration remain outside this framework.
