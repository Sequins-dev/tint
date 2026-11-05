# @tint/codegen/aarch64/isa

A focused A64 instruction encoder. Depends only on the public `@tint/foundation/binary/bytes` contract.
No OS, ABI, executable format, register allocator, symbol resolver or compiler IR.

## Public contract

- `encode(instruction)` returns a validated unsigned 32-bit instruction word.
- `writeInstruction(bytes, offset, instruction)` writes its four little-endian bytes.
- `patchBranch(bytes, fixup)` resolves a branch using an explicit instruction offset,
  target offset and branch template. It verifies the existing instruction's opcode
  and non-immediate fields before changing the displacement.

- `patchAddress(bytes, { offset, targetOffset, rd })` resolves an ADR address and
  checks its opcode and destination register before writing.

All operations return `{ ok: true, value }` or `{ ok: false, error }`. Failed writes
and patches leave every destination byte unchanged. Only one instruction is written
per call; there is no implicit macro expansion or partial multi-instruction result.

Numeric integer registers are 0..30. Floating-point registers are numbered 0..31. Use `sp` and `zr` explicitly for register 31; the encoder
validates their roles for each form. General register width is explicitly 32 or
64; acquire/release and exclusive memory forms also accept 8 and 16 bits. x18 is encodable:
platform-specific reservation is the ABI layer's responsibility. RET/BR/BLR currently
accept only numbered registers 0..30. This is an initial API scope choice.

## Supported forms

- ADR with a signed 21-bit byte displacement, including unaligned data targets.
- NOP; MOVZ/MOVK with a 16-bit immediate and an explicit 16-bit lane shift.
- ADD/SUB immediate with optional flag updates and an explicit 0/12-bit shift.
- ADD/SUB shifted-register, LSL/LSR/ASR, with optional flag updates.
- Integer LDR/STR unsigned scaled immediate, 32/64-bit data.
- LDAR/STLR and LDAXR/STLXR, with 8/16/32/64-bit memory widths; STLXR status
  always uses a W register. Invalid status/source/base overlaps are rejected.
- DMB ISH/ISHLD/ISHST/SY, CLREX and YIELD. These encodings do not by themselves
  establish an ECMAScript memory-order mapping or implement Atomics.
- Integer LDP/STP signed scaled offset, pre-index or post-index, 32/64-bit data.
- B/BL, B.cond (all 16 condition encodings), CBZ/CBNZ, BR/BLR/RET.
- Binary64 FADD/FSUB/FMUL/FDIV/FNEG/FCMP, FMOV from X to D and scaled D loads/stores.
- CSET to W for conditions other than AL/NV; signed W/D FCVTZS and SCVTF.
- MRS/MSR FPCR for explicit floating-point-environment boundaries.
- Unshifted-register AND/ORR/EOR/ORN, variable LSLV/LSRV/ASRV, and UBFM (32/64-bit).
- Binary64 FABS, D-to-D FMOV and unsigned W-to-D UCVTF.

Immediate offsets and branch displacements are in **bytes**, except the unshifted
MOV and ADD/SUB immediate fields. Branch displacement is relative to the address of
the instruction itself, not its end. Conditions AL/NV retain their architectural
meaning; NV must not be treated as an intuitive "never" predicate by callers.

Reject out-of-range integers, fractional values, incorrect alignment, illegal shifts,
invalid selectors, ambiguous register 31 and supported pair forms with constrained-
unpredictable register overlap. Do not truncate an operand to make it fit.

Not yet supported: other floating-point/SIMD forms, ADRP, other logical instruction forms,
unscaled memory forms, extensions, other system instructions, automatic constants,
veneers, relaxation or stack-frame synthesis. Encoding instructions does not establish
ABI conformance, valid memory accesses or safe execution.

## Relocation boundary

BranchFixup and ADR address patches are **resolved** architecture relocations. The caller resolves symbol
identities and addends first, using a linker/layout contract. Both offsets must be
nonnegative safe integers in the same contiguous address coordinate system, whose
base is 4-byte aligned. Instruction offsets are relative to the supplied byte view;
targets may lie outside that view. A sliced view must use correspondingly rebased
coordinates and an aligned logical base. These are not arbitrary native pointers.

For the current flat layout, its file offsets can supply this coordinate system when
virtual placement has the same relative distances and an aligned base. Nonlinear
segment mappings require a different address adapter; do not feed unrelated file
and virtual coordinates into the same fixup. Branch range failure is explicit and
never silently inserts a veneer. Repatching the same branch form is permitted;
changing its condition, register, width or opcode through this API is not. ADR
targets need not be four-byte aligned; its instruction site must be. Its signed
range is -1,048,576 through 1,048,575 bytes.

There is no dependency between this package and `@tint/image/layout`. The integration test
in `tools/aarch64-layout.test.ts` composes their public APIs. It emits fragments,
obtains resolved offsets, then patches the final output. Later publication must wait
until all fixups succeed; individual patch atomicity is not a whole-image transaction.

## Buffer ownership

Buffers are borrowed exclusively for synchronous writes. Bounds apply to the supplied
view. Detached, resizable/shared buffers and concurrent mutation are outside this
initial contract. Typed object shapes are assumed; field domains are validated, but
the API is not a decoder for arbitrary untrusted JSON objects. It does not allocate
executable memory or execute emitted instructions.

## Evidence and provenance

`test/fixtures.ts` contains 32 committed golden encodings obtained independently with
Homebrew LLVM 22.1.8, `llvm-mc --triple=aarch64 --show-encoding`. They were captured
before implementing the encoder; they are not generated from its output. Ordinary
tests require no assembler/disassembler installation.

The encoding field and operand rules were checked against Arm-authored A64 instruction
reference pages (2026-03 release), available through the Stanford mirror:
[MOVZ](https://www.scs.stanford.edu/~zyedidia/arm64/movz.html),
[ADD immediate](https://www.scs.stanford.edu/~zyedidia/arm64/add_addsub_imm.html),
[B](https://www.scs.stanford.edu/~zyedidia/arm64/b_uncond.html),
[LDP](https://www.scs.stanford.edu/~zyedidia/arm64/ldp_gen.html),
[STP](https://www.scs.stanford.edu/~zyedidia/arm64/stp_gen.html).
Arm's official DDI0602 pages were inaccessible through the research tool. No Arm
pseudocode or documentation corpus is vendored into the package.

```sh
pnpm check
pnpm verify:aarch64
```

The second command is an optional independent oracle requiring `llvm-mc` on PATH
(or the LLVM_MC environment variable). It checks 923 cases across widths, register
positions, condition codes, modes and range boundaries against LLVM assembly, verifies
golden bytes, and disassembles the emitted bytes without warnings. It fails if the
oracle is unavailable; it does not silently report a skip as success. External tools
are verification-only and never used by the package build or production encoder.

The optional `pnpm verify:macos` gate also executes generated instructions in
Tint-produced images, including ADR references to writable data and imported slots.
The encoder remains independent of both layout and platform publication.

FRINTP and FRINTZ binary64 forms are now supported with normal FP register validation.
Independent LLVM fixtures check their encodings, including boundary registers; the
optional oracle covers 32 additional register combinations. They do not depend on
FPCR's rounding direction, though the surrounding floating-point environment contract
(such as subnormal handling) still applies.

Unsigned-offset `ldrb`/`strb` are also supported, with explicit WZR/SP roles and byte
offsets 0–4095. They support guarded cell state access and byte-exact payload copying.
The LLVM oracle covers both instructions, register roles and offset boundaries.

Byte and halfword unsigned-offset loads/stores use `ldrb/strb` and `ldrh/strh`.
Halfword offsets are even byte offsets from 0 through 8190; encoding scales them
by two. BRK accepts a 16-bit immediate for explicit terminal contract failures.
