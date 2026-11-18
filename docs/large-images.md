# Large AArch64 executable images

Tint automatically selects address, unwind and image layouts from the final
code and metadata placements. The compiler writes Mach-O and ELF directly.

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
- **Stack maps**: compact v4 tables switch to the wide version (v3, 64-bit return
  offsets) when a return offset reaches 2^32; the runtime walk already reads
  full-word offsets and the registry holds 64-bit code ranges.
- `forceFarReach` (EmissionOptions, `compileArm64Program`, `BuildRequest`,
  `TINT_FORCE_FAR_REACH=1` for hosted fixtures) emits every module with the far
  model, register-indirect calls and far branches everywhere: the forms a large
  image uses where reach requires them, exercised natively on small programs.

### Mach-O layout selection

The compact layout has a VM extent ceiling of 1,920 MiB, including its
page-rounded signature segment. This leaves 128 MiB below the shared region
for the main stack and ASLR. XNU's 16 KiB-page arm64 slide is less than 80 MiB.
The compact layout and its signature are unchanged below the ceiling.
[XNU slide calculation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/mach_loader.c)
and [slide limits](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_map.c).

When the compact extent reaches the ceiling, Tint links the executable at
`0x300000000` with the following order in its segment commands, file and VM.

```
__PAGEZERO  [0, 4 GiB), no file bytes
__TEXT      header, signature loader, __eh_frame
__DATA      imports and writable payload, followed by the signature table
__DWARF     optional source-level debug sections
__LINKEDIT  chained fixups, symbol table and main signature
__TEXT_1   [code chunk][its signature blob, outside the segment]
__TEXT_2   [code chunk][its signature blob, outside the segment]
...
```

- All metadata and the main signature fit below 4 GiB of file. Runtime CFI
  stays in `__TEXT,__eh_frame` so dyld can return it to the system unwinder.
  In the large layout all FDEs use signed 64-bit PC-relative fields. The
  normal layout still uses compact entries and falls back to FDEs as before.
  [dyld unwind-section lookup](https://github.com/apple-oss-distributions/dyld/blob/main/dyld/DyldAPIs.cpp).
- Chunk segments have contiguous VM addresses. The default signing unit is
  1 GiB, and a chunk's CodeDirectory covers its file bytes relative to the
  chunk start, including its final page padding. The next file segment starts
  on a 16 KiB boundary. A relocation can span a chunk boundary, and always
  uses the virtual placement for its PC-relative displacement.
- `LC_MAIN` enters the loader in the main signature's range. The loader opens
  the executable path from the Darwin `apple` vector, calls
  `fcntl(F_ADDFILESIGS_RETURN)` on each chunk, closes the file and transfers
  control with the original argument registers. Failure exits with status
  126 before entering the hosted code or its callback thunks.
- Far section offsets are zero because Mach-O section file offsets are
  32-bit. The segment file offsets and symbol values are 64-bit and LLDB
  reads far instructions from the inferior. Symbol section indexes identify
  the particular chunk. Up to 255 sections can be represented.
- `LARGE_METADATA_LIMIT` and `LARGE_SECTION_LIMIT` identify bounds the
  format cannot represent. `SIZE_LIMIT` marks a caller's lower byte budget.

### ELF and diagnostics

ELF's file and VM layout uses 64-bit fields. The writer widens `.eh_frame`
and `.eh_frame_hdr` to `sdata8` when the signed 32-bit fields cannot reach.
Both writers keep DWARF32 section offsets while encoding code addresses and
large PC extents at full width. Runtime trace table v2 uses full-width
code offsets while retaining 32-bit metadata offsets. Compact stack map v4
still falls back to v3 for return offsets beyond 4 GiB within a module.

Startup uses far windows when the combined code extent requires them.
A diagnostics call without BL reach, or a late image relocation without
relative address reach, causes one rebuild in the far model. Far
diagnostics calls preserve the trace-capture argument registers across their
address calculation. Individual signpost-entry branches still require
the single-instruction B reach and fail with an explicit range error.
Managed-factory service-unit linking retains its near-model contract.

The executable writers accept images larger than 4 GiB on a host whose
typed arrays can hold the image. They materialize contiguous buffers. The
native self-host has a smaller contiguous managed allocation domain, so
use the Node host for multi-GiB image generation.

## Verification

`pnpm check` exercises scaled layout thresholds, signatures, VM-relative
patches, wide offsets and the Darwin multi-chunk GC fixture. On arm64 you can
run the same fixture with a gap of just over 4 GiB inserted between the
compiled runtime and application. It uses the hosted compiler, startup,
collecting runtime, fixups and executable writer, then requires a debugger
breakpoint and unwind from the far function through Tint's hosted entry.
The program must survive a copying collection with a live far root and
exit with status 42. The verifier removes the temporary image.

```sh
pnpm build
TZ=UTC node tools/verify-large-image.ts --full-size
container machine run -n dev -w "$PWD" -- env TZ=UTC node tools/verify-large-image.ts --full-size
```

The full runs need a Node 24 build host with memory for several image-sized
buffers and free space for the executable. The macOS run uses LLDB and the
Linux run uses GDB. For a quick verification omit `--full-size`.

The native FFI and weak-reference tests can exercise a forced large Mach-O
layout with 64 KiB signing chunks without requiring multi-GiB files.

```sh
TZ=UTC TINT_FORCE_FAR_REACH=1 TINT_FORCE_LARGE_IMAGE=1 \  node --test tools/native-ffi.test.ts tools/native-weak.test.ts
```
