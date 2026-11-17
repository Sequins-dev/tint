# @tint/image

Link code fragments and construct native executable images. Explicit compiled
entrypoints keep generic layout and debug information separate from the Darwin
and Linux image formats. There is no root export.

| Entrypoint                            | API                         | Purpose                                                                    |
| ------------------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| `@tint/image/layout`                  | `link`                      | Align fragments, resolve symbols and apply checked fixups.                 |
| `@tint/image/executable`              | `ExecutableImageRequest`    | Format-neutral executable description that target image writers lay out.   |
| `@tint/image/dwarf`                   | `buildDebugInfo`            | Encode source lines, function ranges, variables and frame information.     |
| `@tint/image/darwin/dyld-fixups`      | `buildImportFixups`         | Encode chained import fixups with explicit library ordinals.               |
| `@tint/image/darwin/signature`        | `signatureSize`, `signCode` | Size and serialize Apple ad-hoc signatures independently of Mach-O.        |
| `@tint/image/darwin/macho`            | `buildExecutable`           | Package supplied position-independent arm64 code as a macOS executable.    |
| `@tint/image/linux/elf`               | `buildElfExecutable`        | Package supplied position-independent AArch64 code as a glibc Linux PIE.   |
| `@tint/image/darwin/macho/jit-object` | `buildJitObject`            | In-memory Mach-O describing runtime-published code for LLDB's JIT loader.  |
| `@tint/image/linux/elf/jit-object`    | `buildElfJitObject`         | In-memory ELF describing runtime-published code for GDB and LLDB on Linux. |

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

## Linux ELF executables

`buildElfExecutable` writes an ELF64 AArch64 PIE (`ET_DYN`) for glibc: PT_INTERP
`/lib/ld-linux-aarch64.so.1`, DT_NEEDED `libc.so.6` plus `linux.needed`, and
`DT_FLAGS` BIND_NOW / `DT_FLAGS_1` NOW|PIE. Each import gets an 8-byte GOT slot
bound by `R_AARCH64_GLOB_DAT`; `linux.weakImports` are `STB_WEAK` and resolve to
0 when absent. Imports are resolved through the global lookup scope without
symbol versions, so each binds to its library's default version. All code
addressing is pc-relative, so no other relocations exist.

One R+X PT_LOAD maps the headers, `.interp`, the build-ID note, `.hash`,
`.dynsym`, `.dynstr`, `.rela.dyn`, code (4 KiB-aligned at its file offset, so
ADRP arithmetic on offsets matches addresses), read-only tail sections
(`cstring` as `.rodata.str1.1`, `rodata` as `.rodata`), `.eh_frame_hdr` and
`.eh_frame`. One R+W PT_LOAD follows in the file without padding, at the next
64 KiB-aligned address congruent to its offset: `.dynamic`, `.got` (covered by
PT_GNU_RELRO) and `.data`. Both load segments are 64 KiB-aligned so one binary
runs on 4, 16 and 64 KiB page kernels. PT_GNU_STACK is non-executable.

Unwind ranges become `.eh_frame` FDEs indexed by a sorted `.eh_frame_hdr`
search table (PT_GNU_EH_FRAME). Symbols are sized locals in `.symtab`; DWARF
uses the code's virtual address. Section headers let readelf, gdb and perf read
the image. `.note.gnu.build-id` holds the first 20 bytes of SHA-256 over the
finished image (zero ID) followed by `linux.identifier`; output is a pure
function of the request. The caller supplies the process entry (`_start`, which
calls `__libc_start_main`). `packages/image/test/elf-linux.test.ts` runs a
hand-assembled program on Linux arm64 and skips elsewhere.

`buildElfJitObject` describes code published at runtime for the GDB JIT
interface (docs/runtime-diagnostics.md): a relocatable object (`ET_REL`) that is
already relocated in place, the shape LLVM's JITs register. `.text` carries the
live address in `sh_addr` and a copy of the code; function symbols are global,
sized and section-relative, as `ET_REL` symbol values are; DWARF (from the
shared encoder, as for the Mach-O form) uses absolute addresses, so no
relocation sections exist. Both JIT object builders share request validation
and DWARF through `src/jit-object.ts`; the ELF writers share their header,
section, symbol and string-table primitives through `src/linux/elf/format.ts`.
