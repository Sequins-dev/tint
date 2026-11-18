# Large images (> 2 GiB VM, > 4 GiB file)

Status: research complete; the codegen far forms are implemented and tested
(see [Status](#status)); the Mach-O and ELF large layouts are designed, not
yet implemented. Tint must produce executables of any size its programs need
(the whole-program Test262 suite image projects to 8.8–15.6 GB, see
[the suite program report](results/test262-suite-program-v1.md)), selecting the
large layout automatically and failing explicitly at any limit it does not
handle.

## Findings

Primary sources: `mach-o/loader.h` and `kern/cs_blobs.h` from the macOS 26 SDK;
XNU `bsd/kern/ubc_subr.c`, `bsd/kern/mach_loader.c`, `bsd/kern/kern_descrip.c`,
`bsd/sys/fcntl.h`, `osfmk/mach/shared_region.h`, `osfmk/mach/arm/vm_param.h`
(apple-oss-distributions/xnu, main); dyld `mach_o/UnsafeHeader.cpp` and
`mach_o/Image.cpp` (apple-oss-distributions/dyld, main). Probes were
hand-built with the repo's signature and chained-fixup code and run on
Darwin 25.6 (arm64) and on `dev` (Debian 12 arm64, kernel 6.1).

### Mach-O

- **The compact layout's real limit is about 2 GiB of VM, not 4 GiB.** Images
  load at `0x100000000` (plus a small slide), and the arm64 shared region is
  fixed at `SHARED_REGION_BASE_ARM64 = 0x180000000`, size `0x180000000`
  (to `0x300000000`). An image overlapping it makes dyld fail to map the shared
  cache ("dyld cache not loaded … Library not loaded: libSystem"): verified with
  a probe whose segments spanned that range. A probe based at `0x400000000`
  (with `__PAGEZERO` still covering the low 4 GiB) loads normally. The user VA
  limit on macOS arm64 is `0x7FFFFE000000`.
- 32-bit fields: `section_64.offset/reloff`, `symtab_command` (`symoff`,
  `stroff`), every `linkedit_data_command` (`LC_CODE_SIGNATURE`,
  `LC_DYLD_CHAINED_FIXUPS`, `LC_DYLD_EXPORTS_TRIE`, `LC_FUNCTION_STARTS`, …:
  `dataoff`, `datasize`). 64-bit: `segment_command_64` `vmaddr/vmsize/fileoff/
filesize`, `section_64.addr/size`, `entry_point_command.entryoff`,
  `nlist_64.n_value`, `dyld_chained_starts_in_segment.segment_offset`.
  Compact unwind (`__unwind_info`) function offsets are 32-bit, relative to the
  mach header.
- **Code signing.** XNU ignores `codeLimit64`: `csb_end_offset` is computed from
  the 32-bit `codeLimit` (ubc_subr.c), and hash-page indexes are `uint32_t`.
  The signature (`LC_CODE_SIGNATURE.dataoff`, 32-bit) and therefore all of
  `__LINKEDIT` must lie in the first 4 GiB of the file, and the main
  signature covers at most `[0, codeLimit)` below it.
- dyld requires segment load-command order = file order = VM order, unique
  names, non-overlapping file and VM ranges, `__TEXT` r-x containing the load
  commands, and every `__LINKEDIT` blob inside the `__LINKEDIT` segment
  (UnsafeHeader.cpp `validSemanticsSegments`, Image.cpp `validLinkedit`). It does
  not require `__LINKEDIT` to be the last segment and does not check section
  file offsets.
- The kernel maps segments with 64-bit file offsets (`load_segment`); its
  "segment outside code signature" check is vacuous for segments wholly past
  `cs_end_offset` (unsigned wrap in mach_loader.c). Processes on macOS have no
  global code-signing enforcement (`cs_process_global_enforcement()` is false),
  so pages past the signed range are not validated.
- Additional signatures: `fcntl(F_ADDFILESIGS_RETURN)` attaches a signature blob
  read from the file at `fs_file_start + fs_blob_start` with base
  `fs_file_start` (64-bit `off_t`); non-overlapping blobs coexist on one vnode
  (`ubc_cs_blob_add`), each covering `[base, base + codeLimit)`. Blob size limit
  `CS_MAX_BLOB_SIZE` = 40 MiB (a 4 GiB chunk's SHA-256 page hashes are 32 MiB).

Verified probes (5 GiB sparse files, ad-hoc signed, run directly and under
LLDB; all exit 42):

| Probe     | Content                                                                | Result                                                           |
| --------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `data`    | r-- segment at file offset 5 GiB, read from `__TEXT`                   | ok                                                               |
| `bigseg`  | one r-- segment with filesize 5 GiB, its last page read                | ok                                                               |
| `code`    | r-x segment at 5 GiB, no signature covering it, called from `__TEXT`   | ok; process stays `CS_VALID`, also with `CS_HARD`\|`CS_KILL` set |
| `addsigs` | as `code`, its own signature blob registered by `F_ADDFILESIGS_RETURN` | ok; registration succeeds, process stays `CS_VALID`              |

LLDB resolves symbols in a far segment, sets breakpoints, backtraces and
disassembles when the far `__text` section's 32-bit `offset` is 0 (LLDB then
reads its bytes from memory). A truncated offset would make static reads wrong.

### ELF (Linux)

ELF64 offsets, addresses and sizes are 64-bit throughout. Static `ET_EXEC` and
`ET_DYN` probes with a second `PT_LOAD` at file offset and VM distance 5 GiB
run on `dev` (exit 42). PIE images load at `ELF_ET_DYN_BASE`, far from anything
they could collide with. DWARF32 section offsets are 32-bit per section
(sections stay < 4 GiB each); `.eh_frame` pointers default to `pcrel|sdata4`
(±2 GiB) and need `sdata8` past that.

### AArch64 reach

ADR ±1 MiB; ADRP+ADD and Tint's ADR+MOVZ+MOVK+ADD sequence ±4 GiB; B/BL
±128 MiB; B.cond/CBZ ±1 MiB; TBZ ±32 KiB (not emitted). Codegen already
relaxes conditional branches (islands, then inverted skip + B) and makes calls
register-indirect (x16) when BL cannot reach. Tint emits no jump tables.

## Code model

- **Near model** (default; byte-identical to before): ADR, ADRP+ADD or the
  16-byte ADR/MOVZ/MOVK/ADD sequence (±4 GiB).
- **Far model** (`farRelativeAddress`, 20 bytes: ADR, MOVZ, MOVK #16, MOVK #32,
  ADD/SUB; ±2^48): every relocatable address, register-indirect call and import
  or data site of the module. Selected automatically for a module of
  `farModuleBytes` (2 GiB) or more, or when a near patch reports
  `OUT_OF_RANGE` (one re-emission); `EmissionOptions.farAddresses` forces or
  pins it. `patchRelativeAddress` recognizes the form from the site's fourth
  instruction, so every patcher (emitter, startup, image writers) handles both;
  a near site out of reach is `OUT_OF_RANGE`, never truncated. Far import sites
  carry `far: true` (`NativeImportReference`, `AArch64AddressReference`), giving
  their 20-byte extent.
- **Far branches**: an unconditional B whose target is beyond ±128 MiB (blocks
  of functions larger than 128 MiB, e.g. a whole-suite `__tint_initialize`)
  moves its target function's long branches to `ADR/MOVZ/MOVK[/MOVK]/ADD x16`
  - `BR x16` (x16/x17 are the reserved call/address scratch), with the inverted
    conditional skipping the whole sequence.
- **Stack maps**: tables switch to the wide version (v3, 64-bit return
  offsets) when a return offset reaches 2^32; the runtime walk already reads
  full-word offsets and the registry holds 64-bit code ranges.
- `forceFarReach` (EmissionOptions, `compileArm64Program`, `BuildRequest`,
  `TINT_FORCE_FAR_REACH=1` for hosted fixtures) emits every module with the far
  model, register-indirect calls and far branches everywhere: the forms a large
  image uses where reach requires them, exercised natively on small programs.

### Mach-O large layout (designed)

Selected automatically when the compact layout's VM end would reach the shared
region (about 2 GiB) or any 32-bit field would overflow; until implemented,
such images must fail explicitly in the writer.

```
base ≥ 0x300000000 (past the shared region); __PAGEZERO still [0, 4 GiB)
[__TEXT    header + load commands + signature-loader stub ] ┐ main signature
[__DATA    import slots, writable data                     ] │ (codeLimit < 4 GiB)
[__DWARF / __eh_frame (sdata8) / __unwind_info (near part) ] │
[__LINKEDIT chained fixups, symtab, main signature         ] ┘ all < 4 GiB of file
[__TEXT_1  code chunk ≤ ~4 GiB][its signature blob]
[__TEXT_2  …                  ][its signature blob]          contiguous VM
```

- Code is contiguous in VM across the chunk segments (each segment's
  `vmaddr - fileoff` may differ; only VM matters to page-relative code). Each
  chunk's ad-hoc signature (CodeDirectory `codeLimit` relative to the chunk's
  file start) follows it in the file, outside any segment.
- The signature-loader stub (in `__TEXT`, covered by the main signature) runs
  first from `LC_MAIN`: it opens the executable (`apple[0]`
  `executable_path=`), registers each chunk's blob with
  `fcntl(F_ADDFILESIGS_RETURN)` from a writer-filled table in `__DATA`, closes
  it, then enters the hosted entry. It must precede any far code, including far
  callback thunks. A failed registration leaves the pages unvalidated, which
  current kernels execute (documented, not relied on).
- Far `__text` sections carry `offset` 0 (LLDB reads memory; dyld ignores
  section offsets); symbols use per-chunk section numbers (`n_sect` ≤ 255).
- Explicit errors: region-0 metadata (DWARF, unwind, `__LINKEDIT`) beyond
  4 GiB of file; compact-unwind entries beyond 4 GiB of the header are left to
  `__eh_frame` FDEs (`sdata8`).

### ELF large layout (designed)

64-bit fields throughout; `.eh_frame`/`.eh_frame_hdr` switch to `sdata8`
encodings past ±2 GiB; DWARF sections stay DWARF32 unless one exceeds 4 GiB
(explicit error).

## Limits that fail explicitly

- A near site out of reach in a module pinned to the near model
  (`farAddresses: false`): the emitter's "local address failed"/"helper call
  failed", the writers' `ADDRESS_OUT_OF_RANGE`.
- Service-unit linking (managed-factory units) handles near units only and
  rejects far ones ("managed reference bytes differ" / "relative address
  exceeds target range").
- Diagnostics calls (`startupCalls`, BL into the hosted diagnostics block)
  beyond ±128 MiB: "diagnostics call: OUT_OF_RANGE" (to be relaxed with the
  startup slice).
- JIT-published live code: modules published at run time are small and use the
  near model; published code addresses image code only through registered
  tables and absolute pointers.

## Status

Implemented (branch `image/large-images`): `farRelativeAddress` and the
self-describing `patchRelativeAddress` (isa.ts); far-model selection, far
import sites, register-indirect far branches and `forceFarReach` in the scalar
emitter; wide stack maps past 2^32; `far` propagation through startup imports,
callback-key references, `aarch64ImageRelocations` and build.ts; the
`forceFarReach` build/hosted-fixture option. Tests:
`packages/codegen/test/isa-far-address.test.ts`,
`packages/codegen/test/scalar-far-model.test.ts`, the wide-offset case in
`scalar-stack-maps.test.ts`. Native: `TINT_FORCE_FAR_REACH=1` runs of
`tools/native-ffi.test.ts` (C calls, optional libraries, callbacks and their
contract traps) and `tools/native-weak.test.ts` (generational, copying and
parallel collection) pass, 29/29, with images whose code holds ~15k far
address sequences, ~13k far branches and no BL.

Not yet implemented: the Mach-O and ELF large layouts and the signature
loader, large-layout selection and the explicit compact-layout 2 GiB error in
the writers, `maxByteLength` beyond 4 GiB in build.ts and the emitter calls,
far forms in startup's own cross-module references and diagnostics calls, the
pnpm-check fixture (forced far reach + forced large layout with small chunks)
and the full-size (> 4 GiB) verifier on macOS and Linux.
