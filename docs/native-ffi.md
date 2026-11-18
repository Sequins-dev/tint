# Native FFI: direct C calls from TypeScript

Status: Phases 1 and 2 implemented on darwin-arm64 and linux-arm64: leaf calls
into any library in the C library manifest (libSystem family or glibc, zlib),
raw addresses, external storage, C views (property syntax over struct memory),
availability queries for optional libraries (Darwin), the C stack reserve and
`node:zlib`'s sync codecs. Declarations that differ between targets use
`ByTarget` (below).
Phase 3a implemented: views over memory C owns (`tint:ffi/unsafe`) on both
targets, and `node:os`'s `userInfo`, `networkInterfaces` and `loadavg` over
them on both targets. Phase 3 b1/b2 implemented on both targets: dlopen,
dlsym, dlclose and dlerror as leaf c-calls, and dynamic calls of any C
function address through one AOT-compiled universal trampoline. The exact
`node:ffi` layer over them waits for the typed/untyped convergence
([what it needs](#what-nodeffi-needs-from-the-convergence)).
Phase 6a implemented: the clang-driven binding generator
([binding generator](#binding-generator)), verified on both targets and
regenerating every hand-written binding with equal layouts and signatures.
Later phases are planned below. The exploration that chose this design (prior
art, `node:ffi`, the GC argument) is summarized here; this document is the
design of record.

Calling C should feel like calling TypeScript. A C library is described once,
by a TypeScript declaration module; Tint reads that declaration as an interface
definition language (IDL), synthesizes the implementation, and compiles each call
to an inline C call. The same declaration also yields a runtime descriptor
(`node:ffi` definitions and struct layouts) for dynamic consumers.

## Layering

| Layer             | Where                                            | Role                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C model and ABI   | `@tint/abi/c`                                    | C types and signatures, target facts, struct layout, the AAPCS64/Apple classifier, runtime descriptors. Portable; shared by AOT, live code and dynamic runtimes.                                          |
| Binding front end | `@tint/compiler/native` (`native/foreign/`)      | Parses `declare module "tint:c/<library>"` files into the model and expands them into generated TypeScript modules plus c-call bindings.                                                                  |
| IR                | `@tint/ir/scalar` (`c-call`, `bindForeignCalls`) | One instruction per C call, with its concrete prototype.                                                                                                                                                  |
| Codegen           | `@tint/codegen/aarch64/scalar`                   | Lowers `c-call` inline from the classified layout, through the image's import slots.                                                                                                                      |
| Library manifest  | `@tint/abi/c` (`libraries.ts`)                   | Maps each `tint:c/<library>` to its image per target (Darwin install name, Linux soname), and whether it is optional.                                                                                     |
| Image             | `@tint/image` (`darwin/macho`)                   | libSystem is ordinal 1; further libraries are `LC_LOAD_DYLIB` (or `LC_LOAD_WEAK_DYLIB` for optional ones) with ordinals from 2, and their chained-fixup imports carry those ordinals (and `weak_import`). |
| Runtime           | `@tint/native-runtime` (`ffi/`, `node/`)         | `tint:ffi` external storage and its trusted primitives; `tint:ffi/unsafe` foreign memory; `node:zlib`, `node:os`.                                                                                         |

No C compiler or platform linker participates. clang is used only as a
test-time oracle (below) and as the dev-time binding generator
([below](#binding-generator)), whose output is checked in.

## Declarations as IDL

A binding is a `.d.ts` file under a package's `src/c/` whose only statement is
`declare module "tint:c/<library>"`. The real CommonCrypto binding:

```ts
declare module "tint:c/commoncrypto" {
  import type { i32, u8, u32, Ptr, FixedArray, Layout } from "tint:ffi";
  type CC_LONG = u32;
  export interface CC_SHA256_CTX {
    count: FixedArray<CC_LONG, 2>;
    hash: FixedArray<CC_LONG, 8>;
    wbuf: FixedArray<CC_LONG, 16>;
  }
  export const CC_SHA256_CTX: Layout<CC_SHA256_CTX>;
  export function CC_SHA256_Init(c: Ptr<CC_SHA256_CTX>): i32;
  export function CC_SHA256_Update(
    c: Ptr<CC_SHA256_CTX>,
    data: Ptr<u8>,
    len: CC_LONG,
  ): i32;
  export function CC_SHA256_Final(md: Ptr<u8>, c: Ptr<CC_SHA256_CTX>): i32;
}
```

and its use, which is ordinary TypeScript:

```ts
import {
  CC_SHA256_CTX,
  CC_SHA256_Init,
  CC_SHA256_Update,
} from "tint:c/commoncrypto";
const context = new Uint8Array(CC_SHA256_CTX.size); // 104
CC_SHA256_Init(context);
CC_SHA256_Update(context, bytes, bytes.length); // one inline blr
```

The declaration is not a change to TypeScript semantics: the marker types
(`packages/native-runtime/src/c/ffi.d.ts`, module `tint:ffi`) erase to the values
callers pass (`number`, `boolean`, `string`, `Uint8Array`, objects), so stock
`tsc` checks call sites and the declaration file itself. Tint reads the widths
and shapes syntactically from the declaration; types still only select
specializations.

### Vocabulary

| Declaration                               | C                                                | TypeScript value               | Notes                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bool`                                    | `_Bool`                                          | `boolean`                      |                                                                                                                                                                                                                                                                                 |
| `char i8 u8 i16 u16 i32 u32`              | fixed-width integers                             | `number`                       | Exact conversion; inexact or out-of-range values trap. `char` signedness is the target's.                                                                                                                                                                                       |
| `i64 u64 isize usize`                     | 64-bit integers                                  | `number`                       | Arguments and results must be exact numbers; a value a number cannot hold exactly traps (no silent rounding, cf. fino's `usize` bug), including the saturation bounds 2^64−1 and 2^63−1, which a float round trip alone would accept. BigInt forms come with the dynamic layer. |
| `f32 f64`                                 | `float`, `double`                                | `number`                       | `f32` rounds like `Math.fround`.                                                                                                                                                                                                                                                |
| `Ptr<T>`                                  | `T *` (argument)                                 | `Uint8Array`                   | The data pointer, borrowed for the call. A record pointee requires at least the record's size (checked); scalar pointees are buffers whose extent the C function defines.                                                                                                       |
| `Address<T>`                              | `T *` (result, member, argument)                 | `number`                       | A raw address: an exact unsigned 64-bit integer. Values a number cannot hold exactly trap, never round. Only external storage has an address that stays valid across calls.                                                                                                     |
| `(): Available<"f">`                      | `&f != NULL` (weak import)                       | `boolean`                      | Availability query: whether declared function `f`'s symbol is bound. An optional library's imports are weak and read as 0 when it is absent; the query is one load of the import slot and a comparison.                                                                         |
| `View<R>`, `R.view(bytes)`                | `R *` as an object                               | `R`'s members as properties    | A C view ([C views](#c-views)): `v.m` is one load and `v.m = x` one store at the member's constant offset; nested records and fixed arrays are views too. `Layout<R>` constants make views. A view is a `Ptr<R>`.                                                               |
| `viewAt(R, a)`, `arrayAt(R, a, n)`        | `R *`, `R[n]` C owns                             | `View<R>`, `View<R>[]`         | Foreign views from `tint:ffi/unsafe` ([foreign memory](#foreign-memory)): the same views over memory at an address; `bytesAt(a, n)` and `cStringAt(a)` read raw bytes and C strings.                                                                                            |
| `CString`                                 | `const char *`                                   | `string`                       | NUL-terminated UTF-8 copy; lone surrogates become U+FFFD.                                                                                                                                                                                                                       |
| `CStringBytes`                            | `const char *`                                   | `Uint8Array`                   | Must be nonempty and end in NUL (checked).                                                                                                                                                                                                                                      |
| `interface R { ... }`                     | `struct R`                                       | object with R's fields         | Members in declaration order. By value: copied to/from the C image.                                                                                                                                                                                                             |
| `extends Packed` / `Union` / `Aligned<N>` | `__attribute__((packed))`, `union`, `aligned(N)` |                                |                                                                                                                                                                                                                                                                                 |
| `FixedArray<T, N>`                        | `T m[N]` (member)                                | `number[]` etc.                | Members only; C never passes arrays by value.                                                                                                                                                                                                                                   |
| `const R: Layout<R>`                      |                                                  | `{ size, alignment, offsets }` | Generated from the shared layout computation.                                                                                                                                                                                                                                   |
| `OrErrno<i32 \| i64 \| isize>`            | result                                           | `number`                       | Negative results become `-errno`, captured immediately after the call.                                                                                                                                                                                                          |
| `Variadic<T>`                             | `...`                                            | as T                           | Marks this and all later parameters as variadic arguments of this prototype (C default promotion applies).                                                                                                                                                                      |
| `name$variant`                            | symbol `name`                                    |                                | Several prototypes of one symbol (e.g. variadic shapes).                                                                                                                                                                                                                        |
| `type A = T`                              | `typedef`                                        |                                |                                                                                                                                                                                                                                                                                 |
| `const NAME: 0x20`                        | `#define NAME 0x20`                              | `number`                       | A non-negative integer header constant; the generated module exports it.                                                                                                                                                                                                        |
| `ByTarget<{ "darwin-arm64": A; ... }>`    | per-target type or constant                      | any of the choices             | Wherever a type or constant literal goes: the build target's choice (`mode_t` is `u16` on Darwin, `u32` in glibc; `MAP_ANONYMOUS` is 0x1000 or 0x20). A target without a choice cannot use the declaration; one file serves every target.                                       |
| `MayCallback<T>`, `Async<T>`              | call classes                                     |                                | Parsed into the model; rejected until Phases 4–5.                                                                                                                                                                                                                               |

Everything else fails explicitly with a located diagnostic: unions of types,
optional or rest parameters, bodies, `Ptr<T>` results or members (use
`Address<T>`), self-containing records (a self-referential `Address` member is
fine: it points to opaque memory), unknown names, names not imported from
`tint:ffi`, libraries outside the manifest. Nothing is silently degraded.

`Ptr` and `Address` are distinct on purpose: a `Ptr<T>` argument is a view the
call only borrows (safe for movable storage), while an `Address<T>` is a value
C may keep. The only way to obtain the address of managed-heap-adjacent memory
is `address()` of external storage, so retaining a pointer into movable
storage cannot be written.

### Expansion and authority

`expandForeignInputs` (compiler CLI, Node bootstrap and hosted fixtures alike)
replaces each binding input with a generated TypeScript module under the same id
and grants the owning package the `tint:c/<library>` specifier. The generated
module contains:

- for each function, an exported bodyless stub with the machine-level signature
  (`number`, `boolean`, `Uint8Array`), which binding replaces by one `c-call`;
- a TypeScript wrapper when conversions are needed (`CString` arguments become
  NUL-terminated bytes, records their C images, record results a buffer the C
  call fills; the stub is then `name$c`);
- for each availability query, a stub bound to one `c-memory available`;
- record interfaces (`Address` members are numbers) and `Layout` constants;
  alongside the text, the record's C view shapes (`foreignViews`, from
  `cLayout`), which the checker uses for property syntax.

A generated module the program loads becomes a trusted runtime module; its stubs
are the only functions bound to its declarations. Explicit `NativeForeignBinding`s
bind other declared runtime exports to a declaration (as the file operations
below do). Names in source alone grant nothing: the compiler's list of linked
libraries (`linkedForeignLibrary`) and the build request are the authority. The
workspace boundary check accepts ambient declarations only in these binding files,
which import only `tint:ffi`; other packages cannot import another package's
bindings.

## Libraries

`cLibraryManifest` (`@tint/abi/c`) is the authority for which binding modules a
program may use and how each target loads them:

| Module                              | darwin-arm64                             | linux-arm64 |
| ----------------------------------- | ---------------------------------------- | ----------- |
| `tint:c/libsystem`, `tint:c/memory` | `/usr/lib/libSystem.B.dylib`             | `libc.so.6` |
| `tint:c/commoncrypto`               | `/usr/lib/libSystem.B.dylib` (re-export) | none        |
| `tint:c/zlib`                       | `/usr/lib/libz.1.dylib`                  | `libz.so.1` |

`prepareForeignLibrary` resolves the module's image (a build may pass extra
entries, e.g. an optional library in a test) and records it on the
`ForeignLibrary`. When the image is written, every imported symbol declared by a
non-system library binds to that library: `buildMacOSProgram` emits one
`LC_LOAD_DYLIB` per install name in first-use order (ordinals from 2; libSystem
stays 1) and the chained-fixup import table stores each import's ordinal. An
optional library becomes `LC_LOAD_WEAK_DYLIB` and its imports set
`weak_import`, so dyld launches the image without it and binds its symbols as 0.
When a required binding loads the same image, the library stays a required
`LC_LOAD_DYLIB` but the symbols only optional bindings declare are still
imported weakly (`ImageLibrary.weakSymbols`), so a symbol the library lacks
binds as 0 instead of failing the launch. A loaded library whose functions are never called adds nothing, so images
without such calls are byte-identical to before. The native probe
(`tools/ffi-dylib-probe.ts`) imports `getpid`, libz's `zlibVersion` and a symbol
of an absent optional library and checks (under LLDB) that the first two are
bound and the third is 0. Calling an absent optional symbol jumps to address 0
and faults, so a binding declares availability queries for the functions
callers may need to test:

```ts
declare module "tint:c/tint-absent" {
  import type { i32, Available } from "tint:ffi";
  export function tint_absent_symbol(value: i32): i32;
  export function hasAbsentSymbol(): Available<"tint_absent_symbol">;
}
// caller
const result = hasAbsentSymbol() ? tint_absent_symbol(value) : fallback;
```

A query names a declared C function of the same binding (a `name$variant`
names its symbol) and takes no parameters; its stub binds to one `c-memory
available` access (no operands, no effects: an import slot never changes after
launch), which inlines to the slot's address, one load and a compare:

```
adr x9, #0 ; mov x10, #off ; movk x10, #0, lsl #16 ; add x9, x9, x10   ; slot address (import fixup)
ldr x9, [x9]
cmp x9, #0x0 ; cset w9, ne
```

A library is present exactly when its symbols are bound, so a query on any of
its functions also answers for the library. For a non-optional library the
query is always true (dyld refuses to launch without the library). The native
availability fixture (`verifyAvailabilityFixture`) declares an absent optional
library and libz as an optional library (with a function libz has and one it
lacks) and checks every answer, a guarded call in a loop and a call with
arguments under LLDB, on both targets.

On Linux every required library is a `DT_NEEDED` entry after `libc.so.6`
(glibc, libz, libm in the ABI probe), which the loader resolves at launch with
`BIND_NOW`.

### Optional libraries on ELF

ELF has no optional `DT_NEEDED`, and a weak import of a library nobody loads
always reads 0, so optional libraries load at first use through the dynamic
layer ([dynamic calls](#dynamic-calls)) instead. On linux-arm64 the binding
expansion of an optional library (`prepareForeignLibrary` passes its image
name to `expandForeignLibrary`) generates, per symbol, a cached address
(`at$sym`: 0 not yet resolved, −1 absent) resolved by `optionalSymbol(image,
symbol)` of `tint:ffi/unsafe` (`dlopen(image, RTLD_LAZY)` once per library,
then `dlsym`; a failed `dlopen` marks the whole library absent). Each
function becomes a wrapper that resolves the address and throws TypeError
("optional C function f is not available") when it is absent, then calls a
stub bound to an **indirect** `c-call`: the declared prototype with the
callee address as a leading operand, converted exactly into x15 before any
argument register is loaded and `blr x15` instead of the import slot (a null
callee traps, so nothing ever jumps to 0). An availability query is
`address$sym() > 0`: false for an absent library or symbol, never a fault.
The image imports none of the library's symbols and so does not name it;
Mach-O keeps weak imports, where a query is one slot load.

The indirect `c-call` (`ForeignCall.indirect`) is general: it is also how
constant `node:ffi` definitions will lower to direct calls through address
slots (Phase 3 b4).

## Struct layout and classification

Layouts (`cLayout`) use the arm64 data model: natural alignment equal to scalar
size, members in order at their alignment (1 when packed), record alignment the
largest member alignment raised by `Aligned<N>`, size rounded to it; unions place
every member at offset 0. Empty records and zero-length arrays are rejected.

The classifier (`classifyCCall`) implements AAPCS64 stages A–C: X and V registers
are allocated independently; homogeneous floating-point aggregates (1–4 equal
`f32`/`f64` members after flattening, exact coverage) take consecutive V registers
or go wholly to the stack and close the V registers (C.3); other records up to
16 bytes take consecutive X registers or go wholly to the stack and close the X
registers (C.11); larger records pass a pointer to a caller-owned copy; record
results come back in X0–X1 or V0–V3, else through the X8 address. Target facts
(`CTarget`) carry the platform differences:

| Fact                          | darwin-arm64                      | linux-arm64 (AAPCS64)                                                  |
| ----------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| Variadic arguments            | always on the stack, 8-byte slots | like named arguments                                                   |
| Named stack arguments         | packed at natural alignment       | 8-byte slots                                                           |
| Narrow integer extension      | caller extends to 32 bits         | callee extends                                                         |
| 16-byte-aligned record start  | any X register                    | even X register (C.8)                                                  |
| `char`                        | signed                            | unsigned                                                               |
| Composite placement alignment | declared (`aligned` counts)       | natural: largest member alignment, ignoring the record's own `aligned` |

The fourth row was found by the oracle: Apple clang starts an `aligned(16)`
record in an odd register. The last was found by running the oracle on Linux:
glibc's clang starts a record whose 16-byte alignment comes only from its own
attribute in any register and an 8-byte stack slot (AAPCS64's natural
alignment), but rounds to an even pair and a 16-byte slot when a member is
16-byte aligned; Apple honours the attribute on the stack and never pairs. **Oracle:** `packages/abi/test/c-abi-oracle.test.ts`
compiles C callers of naked capture/produce stubs with clang and checks that every
argument byte arrives where `classifyCCall` predicts (registers, stack,
indirect copies, extension bits) and every result byte returns where predicted,
over 25 shapes (scalars, narrow types, natural packing, float spills, composites,
HFAs including nested and spilled ones, unions, packed records, records aligned
by attribute and by member in registers and on the stack, indirect records in
registers and on the stack, variadics with records, results of every class). It
runs for the host's target on darwin-arm64 and linux-arm64 (where the caller
need not extend narrow arguments, so extension bits are checked only for Apple)
and skips with a visible reason without clang. Header layout checks compare the
`CC_SHA256_CTX` (Darwin) and `z_stream` (both targets) declarations with the
system headers.

## The `c-call` instruction

`{ kind: "c-call", call: { symbol, signature, operands, result }, arguments, id }`
calls the imported C `symbol` with one concrete prototype. Operands are
`number`, `boolean`, `bytes`, `terminated-bytes` or `record` (a Uint8Array holding
the C image); a record result is written into a trailing Uint8Array operand.

Semantics and analyses:

- **Effects:** `effectReadHeap | effectWriteHeap` (C may read and write memory its
  byte operands reach). It never allocates, throws, invokes managed code or
  escapes a managed pointer, so it is **not a safepoint**: callers keep no stack
  map for it and `provenNoSafepoints` holds through it.
- Passes that reason about managed structures (cells, list headers, record
  layouts, local slot constants) need no barrier: a leaf call cannot reach them.
  The verifier checks operand and result types against the prototype; operand
  visitors, substitution, printing and inlining handle it like other
  instructions; leaf-register and temporary-register planning treat it as a call
  (C clobbers x0–x17 and d0–d7, d16–d31).
- **Codegen** classifies the prototype on the target's `CTarget` and emits stack
  arguments and indirect copies first, then X registers (and X8), then V
  registers last (integer conversions use d0/d1 as scratch), then
  `adr/movz/add/ldr x16; blr x16` through the import slot. Managed values live in
  x19–x28 and d8–d15 homes, which AAPCS64 preserves, so no spills surround the
  call. Conversions check exactness and range and trap; f32 rounds with `fcvt`;
  narrow results are extended; 64-bit results must convert exactly. Record
  operands are length-checked and loaded without reading past their size.
- **Inlining:** bound stubs are a single `c-call`, which the inliner accepts, so
  call sites get the direct call. Inlined calls sit inside large functions that
  may be re-emitted with long branch forms; that exposed a latent emitter bug
  (re-emission did not roll back recorded import call sites), now fixed with a
  regression test.

### `c-memory`

`{ kind: "c-memory", access: { operation, type, offset, minimum, stride?, length?, symbol? }, arguments, id }`
is the companion for memory C shares with Tint:

- `load`/`store`: a C view member ([C views](#c-views)) at a constant
  `offset` (plus a proven element index times `stride`) through a view whose
  creation proved it holds `minimum` bytes. Only the view lowering emits
  them, after checking a stored value (`fits`) and an element index, so they
  have no length check and their conversions cannot fail; no stub can bind to
  one;
- `fits`: whether a number converts exactly to an integer or pointer type
  (the c-call round trip as a boolean): a view store's contract check;
- the external-storage primitives `address`, `adopt` and `retarget` (below)
  and `available` (optional libraries).

Like a leaf c-call it never allocates, throws or re-enters managed code and is
not a safepoint; loads read the heap, stores and the header-rewriting
primitives write it, `fits` and `available` have no effect. Bindings are
single-instruction functions, so availability queries inline.

## Call classes and the GC invariant

| Class        | Phase | Safepoint    | Callbacks   | Managed memory as arguments                      |
| ------------ | ----- | ------------ | ----------- | ------------------------------------------------ |
| **leaf**     | 1     | no           | forbidden   | any byte view, including owned (movable) storage |
| may-callback | 4     | yes          | same thread | non-moving storage, or copy-in/copy-out          |
| async        | 5     | n/a (worker) | queued      | external storage kept alive and non-detachable   |

> **GC invariant: leaf calls require a single mutator and no concurrent
> collection.** A leaf call relies on nothing moving, being replaced or detached
> while C runs. That holds today because each heap has exactly one mutator and a
> collection starts only when that mutator asks (allocation slow path or an
> explicit request); parallel GC workers run only inside a stop-the-world
> collection the mutator started; other agents have other heaps. Any future
> concurrent or incremental marking, concurrent evacuation, or multiple mutators
> per heap must revisit leaf calls (pin borrowed views, or transition around the
> call) before it lands.

Consequences: C may use a borrowed view only until it returns (memory C
retains, such as zlib's `z_stream` and windows, must be external storage); a
long blocking leaf call blocks only its own context (an event-loop concern,
solved by the async class, not a GC hazard); a C library that unexpectedly
calls back during a leaf call is undefined behaviour until Phase 4's
trampolines detect it.

## Raw addresses

`Address<T>` values are numbers in typed code: the c-call and c-memory
conversions treat a C pointer as an unsigned 64-bit integer and convert it
exactly or trap (`fcvtzu`/`ucvtf` round trip plus `cmn x, #1` for the
saturation bound). Every user-space address is exact, and so is any value a
binary64 holds: the storage fixture round-trips 2^60 and 2^63 + 2^11 through a
member and reads C's own pointers back (`strchr`, `memchr` results, `strlen`
of an `Address` argument). Values that are not exact (2^53 + 1, 2^64 − 1)
trap instead of rounding. Phase 1's 64-bit conversions had the same
saturation hole (a result of 2^64 − 1 read as 2^64); it is fixed for every
64-bit c-call operand and result.

The phase plan called for BigInt at general boundaries. That needs typed BigInt
values, which the typed pipeline does not have (`typed BigInt values are not
implemented`, stage link), and bindings are typed-only (below), so no general
boundary exists yet; see the known defects.

## External storage

`tint:ffi` (`packages/native-runtime/src/ffi/index.ts`) provides memory C may
retain across calls:

```ts
import { allocate, release, address, external } from "tint:ffi";
const block = allocate(z_stream.size + 4096); // zero-filled, never moves
const stream = z_stream.view(block);           // C view of the z_stream
deflateInit2_(stream, ...);                    // Ptr<z_stream> borrows it
stream.next_in = address(block) + 112;         // C keeps this address
release(block);                                // unmapped now
```

The view is a borrowed-kind Uint8Array (header flag 1) over pages mapped with
`mmap` outside the managed heap, in whole pages of the kernel's size
(`getpagesize()`: 16 KiB on Apple arm64; 4, 16 or 64 KiB on Linux arm64), with
the protections and flags `tint:c/memory` declares per target (`MAP_ANONYMOUS`
is 0x1000 on Darwin, 0x20 on Linux). It is made
by adopting a fresh empty owned array in place (`c-memory adopt`: same 32-byte
extent, so every collector sees a valid object); collectors move the 24-byte
view object and never its data, which is exactly the property retained pointers
need.

**Contract and the GC invariant.** Leaf calls still rely on the invariant
above for borrowed views. External storage removes the dependence for memory C
keeps between calls: its address is stable across collections of any kind,
including future concurrent or moving ones, because the bytes are not in the
heap. What remains is lifetime:

- `release(view)` unmaps the pages at once and points the view at one shared
  inaccessible 4 GiB reservation (`c-memory retarget`). Typed-array lengths
  never change (the optimizer hoists them), so a dangling view must fault
  rather than read freed or reused memory; it does. A second release, or
  `address()` of released storage, throws TypeError.
- `external(byteLength)` also registers the view with the collector through a
  weak cell; sweeps (every doubling of the registry) unmap storage whose view
  died, and external memory pressure (mapped bytes
  above twice the level after the last forced collection, at least 64 MiB)
  forces a collection first. The storage fixture drops 512 × 1 MiB views and
  checks the mapped total stays bounded, under the generational and copying
  runtimes.
- `address(view)` returns the address only for live external storage
  (`c-memory address` returns −1 for owned arrays and views, which move).
  Reading memory at an address (`cStringAt` and the views below) is
  `tint:ffi/unsafe`'s ([foreign memory](#foreign-memory)).

Registration uses weak cells ([weak cells](memory-and-lifetimes.md#weak-cells)).
The generational and copying collectors clear dead weak cells, so unreachable
`external()` storage is unmapped; the region collector does no weak processing
(it traces weak cells as strong), so under it `external()` storage is only
released by an explicit `release()` or at exit. A program pays for weak
processing only once it creates a weak cell. The primitives (`adoptExternal`,
`externalAddress`, `retargetExternal` in `ffi/primitives.ts`) are bound by
explicit `NativeForeignMemoryBinding`s that `foreignRuntimeBindings` supplies
when the program loads the module, together with the weak and collection
capabilities `external` uses. A forced collection (`collect-garbage`) is the
allocator's own slow path, so it counts as a closed-world operation and
generational programs may bind it.

## C views

A binding's record interfaces describe struct memory; a C view reads and
writes it with ordinary property syntax. `R.view(bytes)` (with `R` a declared
`Layout<R>` constant) makes a view of record `R` over a Uint8Array, which must
hold `R.size` bytes (else RangeError); the view _is_ those bytes, typed
nominally. `View<R>` from `tint:ffi` names the type:

```ts
import { allocate, address, type View } from "tint:ffi";
import { cStringAt } from "tint:ffi/unsafe";
import { z_stream, deflate } from "tint:c/zlib";
function failure(stream: View<z_stream>, fallback: string): TypeError {
  const message = stream.msg;                  // Address<char>: a number
  return new TypeError(message === 0 ? fallback : cStringAt(message));
}
const block = allocate(z_stream.size + 4096),
  stream = z_stream.view(block);
stream.next_in = address(block) + 112;          // one str
stream.avail_in = length;                       // fits check, one str
deflate(stream, 0);                             // a view is a Ptr<z_stream>
if (stream.avail_out !== 0) ...                 // one ldr
```

Semantics:

- **Members.** A scalar or `Address` member reads as a `number` (`boolean`
  for `bool`); a write must be a value of that type. Integer and address
  members take exact integers in their C range, else **TypeError** (explicit
  types are contracts; nothing is truncated); `f32` rounds like `Math.fround`;
  `f64` and `bool` take any value of their type. Every assignment form works:
  `=`, compound arithmetic, `++`/`--`, `&&=`, `||=` and `??=` (a no-op:
  members are never nullish); a rejected write leaves the member unchanged.
- **Nested records and fixed arrays** are views of the same bytes.
  `a.b.c` folds to one access at the summed offset; `const b = a.b` makes a
  view of `b`'s bytes (a subarray). They are assigned member by member
  (`a.b = x` is rejected; `tsc` sees them `readonly`).
- **Fixed arrays.** `v.words[i]` reads or writes an element; the index must be
  an integer below `v.words.length` (a constant), else **RangeError**, for
  reads and writes alike. An element of an indexed element (`m[i][j]`) goes
  through a view of `m[i]`. Arrays have only elements and `length`.
- **Unions** are records whose members share offset 0.
- **Nominal.** Only `R.view` makes a view: an ordinary Uint8Array, an object or
  another record's view is not a `View<R>`, and a view has only its record's
  members (no indexing, `length` or typed-array methods). A view is a
  Uint8Array for everything that takes bytes, so it passes to `Ptr<R>`
  parameters (and `Ptr<T>` accepts `View<T>` for `tsc`).
- **Storage.** Views work over any byte array. A view of movable storage is
  valid only for leaf calls (as `Ptr<R>` always was); memory C retains belongs
  in external storage.

Implementation: `foreignViews` computes every record's (and fixed array's)
shape from `cLayout` when the binding is expanded; `foreignViewRegistry` maps
the linked names of `tint:ffi`'s `View`, each record interface and each Layout
constant to those shapes, and the closure checker
(`typescript/src/checker/c-views.ts`) gives views the type
`{ kind: "Uint8Array", view: key }`: a nominal subtype of Uint8Array (it relates
to Uint8Array and to views of its key only). The checker records each creation,
member and element use; the scalar lowering (`ts-native/src/scalar.ts`) emits
one `c-memory` load or store per access, after a `fits` check for integer
stores and the index checks for elements. There is no length check: typed-array
lengths never change (released external storage keeps its length and faults),
so the size proved at creation holds for the view's lifetime. The same layout
yields the runtime descriptor (`cLibraryDescriptor`) for `node:ffi`, and a test
checks the two agree member by member.

In `node:zlib`'s loop (`zlib.ts`, debug build) `stream.avail_in =
availableIn` is the contract check and the store:

```
ldr  d0, [sp, #0x100]                               ; availableIn
fcvtzu w12, d0 ; ucvtf d1, w12 ; fcmp d0, d1 ; cset w9, eq ; cbnz -> store
...                                                 ; TypeError path
fmov d0, d8 ; fcvtzu w12, d0                        ; convert (proven)
mov  x9, x28                                        ; the view
ldr  x11, [x9, #0x10]                               ; data pointer
str  w12, [x11, #0x8]                               ; strm->avail_in = ...
```

and the read `stream.avail_out` is `ldr x11, [x9, #0x10] ; ldr w12, [x11,
#0x20] ; ucvtf d0, w12`. Compared with Phase 2's `Field` accessors, each access
lost the length check (`ldr w10, [x9, #8] ; cmp ; b.lo`), and the contract
check now throws TypeError instead of trapping. Unaligned (packed) or distant
members and elements form the address in x13 first.

**Hoisting.** The validity check is hoisted all the way to creation: there is
none per access. The data-pointer load is reused across consecutive accesses
to the same view: after an access, x11 keeps the view's data pointer, and the
emitter tracks which object it belongs to with identity tokens that flow
through slot loads and stores (the lowering copies a view through
temporaries). View accesses, slot moves and constants neither touch x11 nor
reach a safepoint, so a following access with the same token skips `mov x9,
<view>; ldr x11, [x9, #0x10]`; anything else (a call, an allocation, any
other operation) forgets it, which is what keeps movable views correct: a
heap-backed view cannot move between safepoints, and none intervenes. A
block inherits x11 and the slot tokens from a sole predecessor ending in a
jump or branch, so the contract check's branch does not break the chain; the
member stores of zlib's loop become

```
fcvtzu w12, d0 ; ucvtf d1, w12 ; fcmp d0, d1 ; cset w9, eq ; cbnz -> store
fmov d0, d8 ; fcvtzu w12, d0 ; str w12, [x11, #0x8]  ; stream.avail_in (x11 reused)
```

In `node:zlib`'s `process` the data-pointer loads drop from 19 to 15 (the
`avail_in` and `avail_out` stores after `next_in` and `next_out`; the reads
after each zlib call reload, since a call intervenes). The pointer is not
hoisted out of loops: every view loop in practice contains a safepoint
(zlib's calls and chunk allocations), and external storage, whose data
pointer could cross them, is not distinguished from movable views in the
type. Functions without view accesses emit exactly as before.

## Foreign memory

C libraries hand back memory they own: `getifaddrs` returns a linked list of
records and sockaddrs it allocated, `getpwuid_r` fills a record whose string
members point into a buffer, `zlib` reports `strm->msg`. `tint:ffi/unsafe`
reads such memory with the same views, so that on the TypeScript side it is
still just a C view (or byte view) of a record:

```ts
import { viewAt, arrayAt, bytesAt, cStringAt } from "tint:ffi/unsafe";
import {
  ifaddrs,
  sockaddr,
  getifaddrs,
  freeifaddrs,
  InterfaceList,
} from "tint:c/darwin-os";
const head = InterfaceList.view(new Uint8Array(InterfaceList.size));
getifaddrs(head); // C stores the list head
for (let at = head.head; at !== 0;) {
  const entry = viewAt(ifaddrs, at); // View<ifaddrs> at C's address
  const name = cStringAt(entry.ifa_name); // char * member
  const family = viewAt(sockaddr, entry.ifa_addr).sa_family;
  at = entry.ifa_next; // Address<ifaddrs> member
}
freeifaddrs(head.head);
```

| Function                 | Result                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `viewAt(R, address)`     | `View<R>` over the `R.size` bytes at `address` (`R` a binding Layout constant).                   |
| `arrayAt(R, address, n)` | `View<R>[]`: the `n` records of a C array `R[n]` (one extent, each element a view of its record). |
| `bytesAt(address, n)`    | A `Uint8Array` over the `n` bytes at `address`.                                                   |
| `cStringAt(address)`     | A copy of the NUL-terminated UTF-8 text at `address` (malformed sequences become U+FFFD).         |

**The unsafe boundary.** Everything else in the FFI is memory-safe from the
TypeScript side: views are made from arrays that hold the record, `Ptr<T>`
arguments are borrowed for one leaf call, and only external storage has a
retained address. Reading memory at an arbitrary address cannot be checked,
so it lives behind its own import: `tint:ffi/unsafe` is granted, like
`tint:ffi`, to packages declaring bindings, and the workspace boundary check
accepts it only in the modules listed in `unsafeForeignMemoryModules`
(`tools/boundaries.ts`; `node/zlib.ts`, `node/os-darwin.ts` and
`node/os-linux.ts` today; a relative import of `ffi/unsafe.ts` or
`ffi/dynamic.ts` from outside `ffi/` counts too) and reports
listed modules that stop importing it. `node tools/check-boundaries.ts` prints
the list. `tsc` checks pointee types through the declarations: `viewAt(R, a)`
needs an `Address<R>` (members such as `ifa_next: Address<ifaddrs>` carry it)
or a plain number; Tint's checker itself sees addresses as numbers.

**Semantics.**

- A foreign view is a byte view (header kind 2) of a borrowed-kind array
  (kind 1, as external storage) whose data is C's memory. Collectors move the
  two small objects and never the data; they neither free it nor treat it as
  a root. Member accesses are those of any view: `viewAt(R, a)` makes a view
  of exactly `R.size` bytes, so the size is proven at creation and each access
  is one load or store with no check (below). Member contracts (exact
  integers in range, else TypeError) are unchanged.
- **Creation contracts.** A null address throws **TypeError** ("null C
  address"; `cStringAt(0)`: "null C string"), at creation, never as a fault
  later; so does an address that is not an exact integer in [1, 2^64). A
  length that is not an integer in [0, 2^32 − 1], an extent past 2^64 or an
  `arrayAt` count whose extent exceeds 2^32 − 1 bytes throws **RangeError**.
  `arrayAt(R, a, 0)` is `[]` (the address must still be nonzero).
- **Lifetime and extent are C's contract.** A view outliving its memory
  (after `freeifaddrs`, or over a released external block) reads whatever the
  address then holds, or faults if the pages are gone; nothing tracks it.
  Code copies what it needs (strings, sockaddr bytes) before freeing.
- **Not external storage.** Being views, foreign views are rejected by
  `address()` and `release()` (TypeError) even when their address lies in
  live external storage, so unsafe code cannot release memory it does not
  own; released external storage keeps pointing its own views at the guard
  reservation.
- **Calls and the GC invariant.** A foreign view passes to `Ptr<R>`
  parameters like any view. Its data never moves, so it is valid across
  collections (the native fixture checks reads before and after allocation
  churn under the generational and copying collectors) and does not depend
  on the leaf-call invariant; memory the managed heap owns must not be
  reached through `viewAt` (a heap array's address is not obtainable, and
  `getpwuid_r`'s record and buffer therefore live in external storage).

**Codegen.** Creation is an ordinary call (`viewAt` is a two-instruction
wrapper over `bytesAt`: address checks, `c-memory adopt` of a fresh empty
array, one `subarray`); the checker types its result as the record's view.
Accesses are the existing view lowering. In the fixture's list walk
(`total += node.value; at = node.next`, debug build):

```
bl   viewAt$direct ; cmp w0, #1 ; b.ne ...           ; creation (checks)
mov  x19, x1                                          ; the view
mov  x9, x19 ; ldr x11, [x9, #0x10] ; ldr w12, [x11]  ; node.value: one ldr
scvtf d0, w12
mov  x9, x19 ; ldr x11, [x9, #0x10] ; ldr x12, [x11, #0x10]  ; node.next
cmn  x12, #1 ; b.eq trap ; ucvtf d0, x12 ; fcvtzu x13, d0 ; cmp x13, x12 ; b.ne trap
```

which is instruction for instruction the heap view's access (the `Address`
member read keeps its exactness check).

**`node:os`.** `userInfo()`, `networkInterfaces()` and `loadavg()` have one
reader per target, each the `node:os` module for its target:
`node/os-darwin.ts` over `tint:c/darwin-os` (Darwin's `struct passwd` with
`pw_change`/`pw_class`/`pw_expire`, BSD sockaddrs with their length byte,
`AF_LINK` `sockaddr_dl` for MACs) and `node/os-linux.ts` over
`tint:c/linux-os` (glibc's `struct passwd`, sockaddrs with a 16-bit family,
`AF_INET6` 10, `AF_PACKET` `sockaddr_ll` for MACs, libuv's `linux.c`
exclusion rule); `node/os.ts` holds the shared result shapes, formatting
and shaping. A clang oracle checks every record of both bindings against
the system headers (each on its own target). Both follow libuv and Node
exactly: `uv_os_get_passwd` (getpwuid_r of `geteuid()`, a
2000-byte buffer doubled on ERANGE, EINTR retried), `uv_interface_addresses`
(interfaces up and running with an address, link-level entries excluded, then
each link-level address's six bytes (`LLADDR`, or `sll_addr`) copied to the
interface and its `name:alias` aliases; sockaddrs copied as `sockaddr_in6` or `sockaddr_in` by
family, a null netmask as zeros), Node's formatting (`uv_ip4_name`, libuv's
`inet_ntop6` with `::` compression and embedded IPv4, `%02x` MACs, `scopeid`
for IPv6 only) and lib/os.js's `getCIDR` (including its text-based contiguity
test). The native fixture (`tools/native-os-fixtures.ts`) compares every
field of every address with Node on the same machine, three times with
collections in between, under both collectors, on macOS and on Linux (the
`dev` machine: `lo` and `eth0` with its MAC); `loadavg` is checked for shape
and against Node's 15-minute average. Deviations, all
[known defects](#known-defects) the typed/untyped convergence removes:
`networkInterfaces()` returns a `Map` from interface name to Node's arrays
instead of Node's plain object, an API-shape deviation forced by typed code
having no objects with dynamic keys (the fixture pins today's shape and says
so; it does not assert it as correct); libuv failures are TypeErrors with
Node's messages rather than SystemErrors; `userInfo` takes no `encoding`
option.

**Targets.** Each binding has an image on its own target only, so a
target's reader fails explicitly on the other: the build stops at
resolution with `UNDECLARED_IMPORT: tint:c/darwin-os` (or `linux-os`),
located at the reader's import (a test builds each for the other target).
Whoever maps `node:os` picks the target's reader (the fixtures by
`nativeFixtureTarget()`). `tint:ffi/unsafe` itself is target-independent.

## C stack headroom

C ignores Tint's stack limit, so a function containing a c-call reserves
`nativeCStackReserveBytes` (64 KiB) for its C callees in its entry check:
`sub x17, sp, #16, lsl #12` replaces `add x17, sp, #0` before the existing
`cmp x17, limit; b.hs` (functions with c-calls always get the check). Frames are
fixed-size, so the entry stack pointer is the one every call site sees, and an
overflow throws the ordinary stack-overflow RangeError before any C runs. On
top of the reserve, C has the headroom below the limit (the guard page is
reached only after both). Cost: zero instructions per call site; a function
that had no entry check before (a small leaf whose only call is a c-call) gains
the four-instruction check (`ldr; sub; cmp; b.hs`) once per invocation. Inlined
c-calls in already-checked functions (the common case) cost nothing.

## `node:zlib`

`packages/native-runtime/src/node/zlib.ts` implements `deflateSync`,
`inflateSync`, `deflateRawSync`, `inflateRawSync`, `gzipSync`, `gunzipSync` and
`unzipSync` over the system zlib with leaf calls only, following Node's
`processChunkSync`: one init, then calls with `chunkSize` output windows until a
window is not exhausted, Node's mode adjustments of `windowBits` (gzip +16,
unzip +32, raw negated, raw 8 widened to 9), gunzip's member continuation (and
zero padding), Node's error rules (`unexpected end of file` for an unfinished
`Z_FINISH`, `Missing dictionary`, zlib's own message otherwise) and options
`level`, `windowBits`, `memLevel`, `strategy`, `chunkSize`, `finishFlush` and
`maxOutputLength` with Node's RangeError messages, NaN defaults and int32
truncation.

**Why external storage.** zlib stores `strm->state->strm == strm` and checks it
on every call, and it keeps `next_in`/`next_out` across calls; between calls the
loop allocates each output chunk, so a collection may run between any two zlib
calls. One external block per operation holds the z_stream, a copy of the input
and the output window; it never moves, so the retained pointers stay valid
under any collector. Pinning by construction (no allocation between calls)
would forbid the chunk allocations Node's semantics need. The block is released
and the stream ended on every exit.

**Output bytes.** Inflate output is always Node's. Compressed bytes are those of
the system zlib (1.2.12 on macOS, 1.3.1 on Debian 13), which differ from Node's: Node bundles
Chromium's zlib (1.3.1 with SIMD hashing), whose match finding differs at every
level. So the native test compares deflate output with a clang-compiled oracle
driving the system zlib with Node's call pattern (byte-identical at every
level, each mode, window/memory/strategy options and chunk sizes), checks Node
inflates the oracle's stream, and inflates Node's streams. Results are
Uint8Arrays (Node returns Buffers).

## Binding generator

Bindings to large C APIs are generated, not hand-written: hand-written
struct offsets were fino's largest source of bugs. `tools/c-bindgen.ts`
reads C headers with clang and emits declaration modules in exactly this
document's syntax. clang runs only at development time, as the generator
and as a test oracle; a Tint build never invokes it.

**Specs.** One checked-in spec per library,
`tools/c-bindgen/specs/<library>.ts` (type `BindingSpec`,
`tools/c-bindgen/spec.ts`), selects declarations and states the choices C
cannot express:

```ts
export default {
  library: "zlib", // tint:c/zlib
  summary: ["zlib (<zlib.h>), ..."],
  targets: ["darwin-arm64", "linux-arm64"],
  headers: ["zlib.h"], // or per target
  aliases: ["uInt", "uLong"], // scalar typedefs kept as `type` aliases
  records: [{ name: "z_stream", opaque: ["zalloc", "zfree"] }],
  functions: [
    "deflate",
    { name: "deflateInit2_", parameters: { version: "Address" } },
  ],
} satisfies BindingSpec;
```

- Records name a struct/union tag or a typedef; records they hold by value
  follow automatically (`in6_addr`, anonymous member records as
  `<record>_<member>`). Pointers to records the module does not declare
  are `Address<void>`/`Ptr<void>` (opaque memory). `layout: false` omits
  the `Layout<R>` constant.
- Pointer parameters default to `Ptr<T>` (a borrowed view) and
  `const char *` to `CString`; `as` picks `Address`, `Ptr`, `CString` or
  `CStringBytes`. `pointee` points at an emitted record of the C pointee's
  layout or an array of the C pointee (`struct ifaddrs **` as a one-member
  out-parameter record). `record` passes a pointer-sized value as an
  8-byte record without floats (dlopen's handle as two 32-bit halves).
- Results: `"OrErrno"` (a pointer result is read as `isize`), `"void"`
  (ignored), `{ record }`. `variant` emits `name$variant`; a variadic
  function needs `variadic: [C types]` per call shape (promoted).
  `callClass` wraps the result in `MayCallback`/`Async` (Phases 4–5).
- `constants` lists `#define`s and enumerators; each must be an integer
  constant expression (checked by clang). `availability` or `optional:
true` emit availability queries (`has<Name>`).
- `prelude` is C compiled after the headers: records Tint defines itself
  (out-parameter holders, the trampoline's frame) and target constants, so
  clang verifies them too.

**Extraction and emission.** Extraction runs clang (`-Xclang
-ast-dump=json -fno-builtin`; without `-fno-builtin` library builtins lose
the header's `size_t`) on the host's target and writes facts,
`tools/c-bindgen/facts/<library>.<target>.json`: each selected type in the
binding model (typedef chains, `size_t`/`ssize_t` as `usize`/`isize`,
enums at clang's width and signedness), and a probe program clang compiles
and the host runs gives every record's `sizeof`, `_Alignof` and `offsetof`
and every constant's value. A record is kept only when `cLayout` of the
declaration reproduces clang's layout exactly. Emission merges every
target's facts into one module: equal texts stay, differing ones become
`ByTarget<{ ... }>` (a listed alias that one target reaches through another
typedef, glibc's `__mode_t`, stays the alias). The output is formatted with
prettier and read back by `parseForeignDeclarations` for every target,
whose layouts must equal the facts; a header names the spec and each
target's clang version. Same facts, byte-identical output.

**Not bound, reported.** Bitfields, flexible and zero-length arrays,
anonymous (C11) members, `long double`, `__int128`, complex and vector
types, `va_list`, function pointers (members, parameters and results,
until `Callback<…>` lands with Phase 4; `opaque`/`as: "Address"` binds one
as `Address<void>`), variadic functions without call shapes, static or
inline header functions, functions an asm label renames, negative or
non-integer constants and those beyond 2^53, records that differ between
targets beyond member types (bind them in per-target specs), and anything
holding such a record by value. Each is left out with its reason, in the
generator's output and in the module's header. A spec choice the C
declaration contradicts (a `pointee` that is not the C pointee's layout, a
word record that is not 8 bytes, `OrErrno` on an unsigned result) fails
generation.

**Workflow.** `pnpm bindgen` extracts this host's facts and emits every
module; `pnpm bindgen extract|emit|check [libraries]` runs one step
(`check` fails on drift without writing). To add a library: write its
spec, add it to the library manifest (`cLibraryManifest`), then extract on
each target (linux-arm64 on the shared `dev` container machine: `container
machine run -n dev -- "cd <worktree> && node tools/c-bindgen.ts extract
<library>"`) and emit on either host. Changing only binding choices
(`as`, `result`, names) needs no re-extraction. Generated modules are
written to `tools/c-bindgen/generated/` for review; the hand-written
bindings under `packages/native-runtime/src/c/` stay authoritative until
they are replaced (after Phase 4).

**Verification** (`tools/c-bindgen.test.ts`, both targets):

- emission rules on synthetic facts (ByTarget merging, alias unification,
  reports, spec errors, call classes, availability queries), determinism
  (checked-in modules equal emission from the checked-in facts), and
  `tsc` over each module with `tint:ffi`;
- with clang on the host: re-extraction equals the checked-in facts (the
  clang version aside); the oracle (`tools/c-bindgen/oracle.ts`) checks
  every generated and hand-written record against clang's `sizeof`,
  `_Alignof` and `offsetof`, and every function against clang's own
  prototype via C++ type traits (each parameter's and result's width,
  signedness, float-ness, pointer and pointee); a mutated module shows the
  oracle catches wrong offsets, widths and pointees; a synthetic header
  exercises every unsupported shape;
- natively under LLDB: a binding generated fresh from the host's headers
  (`struct stat` with nested `timespec`s, `struct utsname`, a variadic
  `open`, errno results, aliases, constants) is compiled into a program
  that writes, `fstat`s and unlinks a file and reads `uname` through views
  (`tools/c-bindgen-fixtures.ts`).

**Parity** with the hand-written bindings (commoncrypto, zlib, darwin-os,
linux-os, dl, libsystem, memory): the test compares every record layout,
member, function signature (types, forms, errno, variadics, call class),
constant, `Layout` constant and availability query for each target, and
lists the differences with their explanation. Layouts and signatures agree
everywhere; no hand-written binding was wrong. The remaining differences
are the generator keeping nested records the hand-written files flattened
to a member of equal size and offset (`struct in_addr`, `struct in6_addr`
and glibc's `ifa_ifu` union) and Darwin's `sin_zero`, which the header
declares `char[8]` (hand-written `u8`).

## Runtime descriptors (one layout engine, two consumers)

`cLibraryDescriptor` turns the same parsed declaration into `node:ffi` `dlopen`
definitions (functions `node:ffi` cannot express — records by value, variadics,
errno capture — are listed with the reason) and a layout descriptor per record
(name, size, alignment, field offsets and sizes), computed by the same
`cLayout` the compiler uses. A test drives CommonCrypto through Node 26's
`node:ffi` with the generated definitions (skipped, with its reason, on Node 24).
Inside Tint the same `CSignature` drives dynamic calls (below).

## Dynamic calls

`tint:ffi/unsafe` also calls C functions whose prototype is data, not a
declaration: a library opened at run time, a function pointer C returned.
There is no libffi and no JIT; one machine routine, compiled ahead of time,
makes every such call, and the classification happens in TypeScript with
the compiler's own `classifyCCall` (`@tint/abi/c`, so both targets' ABI
rules, including Apple's variadics-on-the-stack and natural stack packing).

```ts
import {
  openLibrary,
  findSymbol,
  closeLibrary,
  foreignFunction,
  setNumber,
  setBytes,
  setRecord,
  invoke,
  resultNumber,
  resultRecord,
} from "tint:ffi/unsafe";
// u64, u32, pointer: C types as data, e.g. { kind: "scalar", scalar: "u64" }
const library = openLibrary("/usr/lib/libz.1.dylib"); // dlopen, RTLD_LAZY
const crc32 = foreignFunction(findSymbol(library, "crc32"), {
  parameters: [u64, pointer, u32],
  result: u64,
  fixedParameters: 3,
  callClass: "leaf",
  errno: "none",
});
setNumber(crc32, 0, 0);
setBytes(crc32, 1, data); // borrowed for the call
setNumber(crc32, 2, data.length);
invoke(crc32); // one leaf call through the trampoline
const checksum = resultNumber(crc32);
closeLibrary(library);
```

**Interface (the `node:ffi` adapter's contract).** `foreignFunction(address,
signature)` classifies once and owns a call frame. Arguments are set in
typed forms, never as registers: `setNumber` (integers exact and in range,
else TypeError; floats, f32 rounding; pointers as addresses),
`setBoolean`, `setWords(low, high)` (every 64-bit value, including those
no number holds: the BigInt path), `setBytes` (a borrowed byte array for a
pointer parameter), `setRecord` (a record's C image, by value). `invoke`
calls; `resultNumber` (a 64-bit result a number cannot hold exactly throws
RangeError), `resultLow`/`resultHigh` (the exact word), `resultBoolean` and
`resultRecord` read the result. Each argument keeps its value until set
again; an unset argument makes `invoke` throw TypeError. Libraries:
`openLibrary(path)` (dlopen with `RTLD_LAZY`, as libuv's `uv_dlopen`),
`openProgram()` (`dlopen(NULL)`), `findSymbol(handle, name)` (dlsym, with
dlerror distinguishing a missing symbol from a NULL one) and
`closeLibrary(handle)`; failures throw TypeError with dlerror's text (a
known defect: Node throws Errors). A library handle is its exact 64-bit
word (`{ low, high }`), returned and passed as an 8-byte record, which
AAPCS64 places exactly like a pointer: Darwin's `dlopen(NULL)` handle has
high bits set, so no number could carry it.

**The frame and the trampoline.** `callForeign(target, frame, b0..b7)`
(`ffi/primitives.ts`) is bound by the compiler (a `call` foreign-memory
binding) to one `c-call` with `dynamic: true` (`dynamicForeignCall` in
`@tint/ir/scalar`). The frame (`dynamicCallFrame`, declared for views as
`tint:c/dl`'s `DynamicFrame`; a test checks the two agree) holds x0–x7,
d0–d7 (a float in the low 32 bits), x8, up to 512 bytes of stack words,
up to 16 patches and 512 bytes of scratch (indirect record copies, an
indirect record result). The trampoline:

1. converts the target exactly (a null target traps);
2. writes the bases: the frame's data address, then each byte operand's;
3. applies the patches, `frame[target] = bases[base] + addend` (each target
   8-aligned below the scratch area, each base index in range, else trap):
   a borrowed array's data pointer for a pointer argument, or a scratch
   address for an indirect copy and for x8;
4. copies the stack words to the outgoing argument area (512 bytes reserved
   in the calling frame, like any c-call's), loads x8, d0–d7, x0–x7 and
   `blr`s the target;
5. stores x0, x1 and d0–d3 back into the frame.

**Why patches.** A borrowed array may move at any safepoint. Its address is
never computed in TypeScript (where an allocation could intervene before
the call); the trampoline forms it inside the leaf call, where nothing can
move, exactly as a static c-call's `bytes` operand does. So dynamic calls
borrow movable arrays with the same guarantee, under every collector, and
rely on the same single-mutator invariant.

**Codegen.** The dynamic c-call is an ordinary leaf `c-call` to every
analysis (effects, no safepoint, clobbers, the C stack reserve); only its
emission differs: about 30 instructions of setup (two short loops) around
`ldr x8; 4×ldp d; 4×ldp x; blr x15`, then `stp x0, x1; 2×stp d`.

**Tests.** `tools/native-dynamic-fixtures.ts` compiles a C library with
clang at test time, opens it with `openLibrary` and calls, natively on both
targets and under the generational and copying collectors: a 24-byte
record by value (indirect) and as a result (x8), f32 and f64 HFAs in and
out, an 8-byte composite, narrow integers both ways, 23 arguments with
stack spill (ints, doubles, an i8, an f32 and an indirect record),
variadic int and double calls, C bools, `UINT64_MAX`/`INT64_MIN` through
the exact words and the RangeError rule, i64 and pointer round trips,
borrowed buffers written by C and compared across two buffers with
collections in between, libc's `strlen` through `openProgram`, and every
contract error. `packages/codegen/test/scalar-foreign-memory.test.ts`
checks the emitted register loads, call, result stores, copy loop and
patch store; `foreign-declarations.test.ts` the frame layout.

## What `node:ffi` needs from the convergence

The exact `node:ffi` API (Phase 3 b3–b6) is a thin adapter over dynamic
calls, but its values are untyped JavaScript's. These are its acceptance
criteria for the typed/untyped convergence work, in the order the adapter
needs them; each names today's failure.

1. **General code imports trusted runtime modules.** `node:ffi` users are
   ordinary (often untyped) JavaScript, and the adapter (typed, trusted)
   calls `tint:ffi/unsafe`. Today a general-partition program that imports
   a trusted module fails: "general code cannot import the trusted module"
   (`packages/compiler/src/native/index.ts`, general partition). Needed: a
   general module can import the adapter, and values cross the boundary
   with their JavaScript identity (the value bridge).
2. **BigInt values in typed code** (or at the bridge). `node:ffi` returns
   `int64`/`uint64` and every pointer as a BigInt and takes a BigInt or
   safe integer for them. Today: "typed BigInt values are not implemented"
   (`packages/typescript/src/binding/index.ts`). Needed: typed code can
   construct a BigInt from two exact 32-bit halves and read a BigInt's
   two's-complement halves (`setWords`/`resultLow`/`resultHigh` are the
   other side), compare BigInts and test `typeof x === "bigint"`.
3. **Objects with dynamic keys.** `dlopen(path, definitions)` returns
   `{ lib, functions }` where `functions` has one property per
   user-defined name (`lib.functions.strlen(...)`), and `definitions` is a
   user object whose keys are read by enumeration. Today typed code has no
   index signatures or `Map` iteration (the `networkInterfaces` known
   defect). Needed: create an object with computed own properties whose
   values are functions, enumerate a received object's own string keys in
   order, and read a property by computed key.
4. **Union arguments and their narrowing.** Each `node:ffi` argument may be
   `number | bigint | boolean | string | null | undefined | Buffer |
TypedArray | DataView | ArrayBuffer` depending on the declared type, and
   validation throws `ERR_INVALID_ARG_VALUE` for anything else. Needed:
   `typeof`/`instanceof` narrowing over these (including `instanceof
Uint8Array`, missing today) and reading a typed array's or DataView's
   underlying byte range without copying (no typed-array views over a
   buffer today).
5. **Errors with codes.** Node's validation errors are `TypeError`/
   `RangeError` with `code` (`ERR_INVALID_ARG_VALUE`, `ERR_INVALID_ARG_TYPE`)
   and its loader errors plain `Error`s; typed code cannot construct a plain
   `Error` or attach `code` today.
6. **Rest arguments and variadic function values.** Each bound function is
   a JavaScript function taking its arguments positionally and checking
   their count (`lib.functions.f(a, b)`): the adapter returns closures that
   read `arguments.length`/rest parameters, unsupported in typed runtime
   modules.

With these, b3 (exact semantics, memory accessors, `toString`/`toBuffer`,
per-call buffer lending), b4 (constant definitions recognised and lowered
to direct c-calls through address slots), b5 (Node's own FFI tests as a
conformance population) and b6 (static vs dynamic vs Node microbench)
proceed on the interface above.

## Re-expressed host operations

The compiler's own file operations `close`, `chmod` (`fchmod`), `unlink` and
`rename` are now bound to `tint:c/libsystem` declarations as c-calls (with
`OrErrno`) whenever the binding is in the source graph; frozen graphs that predate
it keep the host operations, so old snapshots still build. Fixtures bind
`processId` to `getpid` the same way. Equivalence (hosted fixture calling all
five, built on main and on the c-call build): with `mode` declared `i32` and the
c-call given host-call-equivalent effects, the image is **byte-identical** to
main. The two remaining differences are intended:

1. Darwin's `mode_t` is `u16` (glibc's is `u32`: `ByTarget`); declaring it so adds the 3-instruction range check
   (`uxth w9, w1; cmp w9, w1; b.ne trap`) where the host operation passed the
   truncated int.
2. The leaf c-call's precise effects (no allocation) prove its callers free of
   safepoints, so one caller's stack map shrinks. Code bytes are unchanged.

The self-build fixpoint (stage2 == stage3) holds with these bindings in the
compiler itself: the native compiler parses its own binding declarations.

## `crypto.createHash('sha256')`

`packages/native-runtime/src/node/crypto.ts` implements Node's
`createHash(algorithm).update(string | Uint8Array).digest([encoding])` with
Tint's own incremental SHA-256 (`@tint/foundation/binary/sha256-stream`, the
same compression as the compiler's one-shot `sha256`). Native builds bind its
rounds to the `sha256-rounds` intrinsic (the ARMv8 SHA-256 instructions, part
of both targets' baseline), so the digest needs no C library on any target:
CommonCrypto exists only on Darwin, and Linux would otherwise need OpenSSL's
`libcrypto` (not part of a minimal system, and an ABI that varies across major
versions) for one digest. A C library becomes worth binding once the API
surface needs algorithms Tint does not implement (HMAC, ciphers, key
derivation); the CommonCrypto binding stays as the FFI's record and
microbenchmark example. `digest()` returns the bytes (Node returns a Buffer),
`digest("hex" | "base64" | "base64url")` text; digesting twice or updating
after a digest throws "Digest already called". The native test compares 14
vectors with Node's digests (empty input, block boundaries 55/56/63/64/65,
multi-update across strings and bytes, non-ASCII and lone surrogates, 1 MiB +
13 bytes) with allocation churn forcing collections between updates.

Deviations (see [Known defects](#known-defects)): the errors are `TypeError`s
with Node's messages, and `Hash` is a closure-backed object rather than a class.
Narrowing `string | Uint8Array` needed a typed-pipeline fix: `general-value` now
extracts a `Uint8Array` (object tag plus header marker check).

## Zero-copy records (assessment, not built)

Could a Tint record whose layout already matches the C struct be passed by
pointer to a leaf call without copying? Mechanically yes for a narrow class:
record payloads follow a one-word header in 8-byte fields, numbers are binary64,
so a record of `f64` fields matches a naturally aligned `struct { double ... }`,
and during a leaf call it cannot move. But:

- only all-`f64` records (and only while no optimization repacks fields) match;
  integers, booleans and narrower members do not share C's representation, and
  field placement is an internal, changing decision (recent byte-boolean and
  union-aware placement experiments);
- C writes through the pointer would bypass `readonly` and record-flow facts;
- a scalar-replaced record must be materialized first.

So it needs an explicit opt-in layout contract (as AGENTS.md requires for
environment-dependent optimizations): for example a record declared to pin C
layout, accepted only where all members are 8-byte and the analysis treats the
call as a write. The copy the wrappers do today is a few stores for small structs;
revisit when profiles show it.

## Validation

- `packages/abi/test/c-layout.test.ts`, `c-abi-oracle.test.ts`: layout,
  classifier rules and the clang oracle.
- `packages/compiler/test/foreign-declarations.test.ts`: parsing, explicit
  errors, expansion, descriptors, `node:ffi` (Node 26), header layout oracles
  (`CC_SHA256_CTX`, `z_stream`), `Address` forms, view shapes against the
  runtime descriptors, availability queries, the manifest.
- `packages/typescript/test/checker-c-views.test.ts`: view typing, nominal
  rejections and member/element/assignment rules.
- `packages/image/test/macho.test.ts`: library load commands, ordinals, weak
  imports and validation; `tools/ffi-dylib-probe.ts` runs such an image.
- `packages/ir/test/scalar-foreign.test.ts`,
  `packages/codegen/test/scalar-foreign-call.test.ts`,
  `packages/codegen/test/scalar-foreign-memory.test.ts`: IR typing, binding,
  effects, inlining and emission of every argument and result class, c-memory
  loads, stores and primitives (exact instruction sequences), the saturation
  checks and the C stack reserve.
- `tools/native-ffi.test.ts` (native, under LLDB, on both targets): C library
  ABI probes (`div`, `ldiv`, complex HFAs in and out from libm — `libm.so.6` on
  Linux, libSystem on Darwin — `memcpy` of an indirect record copy, `snprintf`
  reading back variadic arguments, then named stack arguments packed naturally
  (Apple) or in 8-byte slots (AAPCS64) and stack-passed records and HFAs), the
  crypto vectors, the Mach-O library and availability probes (Darwin only),
  external storage through views (every scalar kind, packed records, addresses above 2^53,
  release errors, collector reclamation under the copying runtime) and
  `node:zlib` under the generational and copying runtimes (`tools/native-zlib-fixtures.ts`:
  empty, multi-chunk 64-byte windows in a small heap so collections move
  objects between zlib calls, 1 MiB binary, every level, modes and options
  against the oracle, Node's streams, gunzip members, corrupt/truncated/empty
  input, option errors), C views under the generational and copying runtimes
  (nested records, fixed arrays and arrays of arrays, unions, every contract
  and index error, every assignment form, annotated parameters and results,
  views passed to C, creation errors, heap views moved by collections) and
  availability queries.
- `packages/typescript/test/checker-c-views.test.ts` also types
  `viewAt`/`arrayAt` and rejects non-Layout arguments; `tools/boundaries.test.ts`
  the `tint:ffi/unsafe` allowlist; `foreign-declarations.test.ts` the
  registry's unsafe entries and the darwin-os header oracle.
- `tools/native-ffi.test.ts` (native, under LLDB): foreign views
  (`verifyForeignFixture`: a linked list walked through `Address` members,
  arrays of records, raw bytes, libSystem's own program name, views passed
  to C, every creation contract, release/address rejection, collections in
  between) and `node:os` against Node, under the generational and copying
  runtimes.
- `tools/c-bindgen.test.ts`: the binding generator (rules, determinism,
  parity, facts, the layout and prototype oracle, and a native fixture
  under LLDB; [binding generator](#binding-generator)).
- `tools/ffi-microbench.ts`, `tools/zlib-microbench.ts`: call overhead and
  codec throughput (below), not part of `pnpm check`.

## Measurements

`tools/ffi-microbench.ts` (2026-11-17, Apple M-series, 18 cores, load average
about 2–5, run under `lockf /Users/stephenbelanger/.t3/tint-timing.lock`,
`TINT_GENERAL_FALLBACK=0`, Node 26.10 for `node:ffi`). Native loops time
themselves with the monotonic clock over 10^8 calls (5×10^6 hash updates);
images run under LLDB with entry and exit-status assertions.

| Call                                                                   | ns/call |
| ---------------------------------------------------------------------- | ------- |
| Tint direct leaf c-call `getpid()` (inlined at the call site)          | 1.17    |
| Tint host operation `processId()` (managed wrapper + completion check) | 1.17    |
| `node:ffi` `getpid()`                                                  | 4.52    |
| Tint c-call `CC_SHA256_Update` (64 bytes)                              | 22.2    |
| `node:ffi` `CC_SHA256_Update` (64 bytes, buffer arguments)             | 98.4    |
| Node `crypto` `hash.update` (64 bytes, OpenSSL)                        | 24.6    |

Leaf c-calls inline into callers: the measured loop is `adr; mov; movk; add; ldr
x16; blr x16; scvtf` with the induction variable in x28 and the sum in d8
(callee-saved homes, no spills), no wrapper `bl` and no completion check. The
host-operation loop calls a wrapper with its own frame and checks the completion
tag; on this core `getpid` dominates both, so they time alike. With buffer
arguments the direct call costs about a quarter of `node:ffi`. Remaining
code-quality item: a c-call result passes through its frame slot (`str d0`;
`ldr d1`) before use.

`tools/zlib-microbench.ts` (2026-11-17, same machine, load average about 6,
under the timing lock, `TINT_GENERAL_FALLBACK=0`, Node 24.12; median of three
runs, µs per operation on line-oriented text, default level, 16 KiB chunks):

| Operation            | Tint (system zlib) | C -O2 (system zlib) | Node (bundled zlib) |
| -------------------- | ------------------ | ------------------- | ------------------- |
| `deflateSync` 1 KiB  | 7.87               | 5.52                | 7.97                |
| `inflateSync` 1 KiB  | 3.48               | 1.36                | 3.15                |
| `deflateSync` 64 KiB | 198                | 189                 | 203                 |
| `inflateSync` 64 KiB | 27.0               | 19.8                | 40.5                |
| `deflateSync` 1 MiB  | 4055               | 3968                | 2867                |
| `inflateSync` 1 MiB  | 469                | 318                 | 552                 |

Against the same library driven from C, Tint's fixed cost is about 2 µs per
operation (mapping and unmapping the external block, the input copy and the
per-chunk managed copies), and large inflates pay one extra copy of the output
(chunks, then the concatenated result). Node's deflate of large inputs is
faster because its zlib is faster (Chromium's SIMD match finding), not because
of call overhead. The Phase 1 call microbenchmark is unchanged by the C stack
reserve: inlined `getpid` 1.29 ns and the host operation 1.30 ns at this load
(1.17 and 1.17 at load 2–5).

## Known defects

Typed and untyped code are meant to share one pipeline with identical features;
types only enable optimization. Phases 1 and 2 met several gaps of today's
separate typed path and worked around them. Each workaround is a defect, marked
`KNOWN DEFECT` at its site, to be removed by the typed/general pipeline
convergence ([progressive lowering](progressive-lowering.md)), not design:

| Gap in the typed pipeline                                                                                                                                                                                                                    | Workaround (site)                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Untyped (general) code cannot import trusted runtime modules, so untyped code cannot call bindings                                                                                                                                           | none; bindings are typed-only today (`compileArm64Program` general partition)                                                                                                                                                                                            |
| No plain `Error` construction                                                                                                                                                                                                                | `TypeError` with Node's messages (`native-runtime/src/node/crypto.ts`, `node/zlib.ts`; zlib errors also lack Node's `code`/`errno`)                                                                                                                                      |
| Classes rejected in this module context                                                                                                                                                                                                      | closure-backed `Hash` object (`crypto.ts`)                                                                                                                                                                                                                               |
| No `String.prototype.toLowerCase`                                                                                                                                                                                                            | `sameAsciiLetters` (`crypto.ts`)                                                                                                                                                                                                                                         |
| No reading `.message` of a caught error; no `instanceof Uint8Array`                                                                                                                                                                          | the native test checks only `instanceof TypeError` (`tools/native-ffi-fixtures.ts`)                                                                                                                                                                                      |
| No `Math.pow`, `Math.log2`, `Math.fround`; no typed-array views over a buffer                                                                                                                                                                | arithmetic binary32/binary64 codecs in generated record wrappers; precomputed `fround` literals in the fixture (`compiler/src/native/foreign/expansion.ts`)                                                                                                              |
| Narrowing `string \| Uint8Array` did not lower                                                                                                                                                                                               | fixed: `general-value` extracts a checked `Uint8Array`                                                                                                                                                                                                                   |
| No typed BigInt values (`typed BigInt values are not implemented`, stage link)                                                                                                                                                               | `Address<T>` and 64-bit integers are exact numbers (or trap); BigInt at general boundaries waits for typed BigInt and for general code calling bindings                                                                                                                  |
| `for (const x of list)` followed by a property read of `x` fails in runtime modules (`invalid property read`, `typescript/src/checker/closures.ts:3061`)                                                                                     | indexed loops (`ffi/index.ts`, `node/zlib.ts`)                                                                                                                                                                                                                           |
| No objects with dynamic keys (index signatures); no iteration of a `Map` (`for-of`, `keys()`: `invalid method call`, `typescript/src/checker/closures.ts:3697` handles only get/has/set/delete/clear)                                        | KNOWN DEFECT (API shape): `node:os` `networkInterfaces()` returns a `Map` where Node returns a plain object keyed by interface name; the convergence removes it. Its fixture pins the current shape and walks Node's names (`node/os.ts`, `tools/native-os-fixtures.ts`) |
| No plain `Error`/`SystemError` construction                                                                                                                                                                                                  | `node:os` failures are TypeErrors with Node's messages (`node/os.ts`)                                                                                                                                                                                                    |
| Compiler sources: no tuple types, `JSON`, `Math.pow`, nested type declarations; forward references to unannotated module consts fail the native bootstrap; a ternary choosing opcodes of different ISA union members fails contextual typing | interface instead of tuple, string concatenation, constants, module-level `Operand`, annotated helper texts (`foreign/*.ts`); `integerToFloat`/`floatToInteger`/`narrowLoad`/`narrowStore` helpers (codegen `c-call` lowering)                                           |

## Open items (FFI scope)

- Narrow-integer and 64-bit arguments trap rather than throw on bad values;
  the `node:ffi` layer will throw Node's errors.
- C callees get a fixed 64 KiB reserve; a per-declaration reserve for deeper C
  code is not expressible yet.
- External storage maps whole pages per allocation; small retained structures
  could share pages. `node:zlib` maps one block per call (about 1–2 µs of
  `mmap`/`munmap`, visible on 1 KiB inputs).
- C views reload the data pointer after any operation other than view
  accesses, slot moves and constants (see Hoisting); a loop over an external
  view still reloads it per iteration.
- A 64-bit member whose value a number cannot hold exactly traps on read
  (like a 64-bit c-call result) rather than throwing.

## Follow-ups

Recorded at the Phase 2b merge; not scheduled here.

1. **Parallel weak processing in the generational collector.** A program's
   first weak cell switches it to serial collection for good: minors evacuate
   with Cheney instead of the parallel evacuator, and mark-compact majors mark
   serially ([weak cells](memory-and-lifetimes.md#weak-cells),
   [parallel GC](parallel-gc.md#weak-slots)). Programs with weak cells
   (WeakRef, FinalizationRegistry, WeakMap/WeakSet backing, `tint:ffi`'s
   `external`) therefore lose parallel minor and major collection. Restoring
   it needs weak slots in the parallel evacuator and mark: deferring their
   pairs, a parallel or post-pass ephemeron fixpoint, and clearing.
2. **C views are typed-only** (for the typed/untyped pipeline convergence,
   [unified pipeline](unified-pipeline.md)). Untyped code cannot call bindings
   at all yet (known defects); once it can, a view needs a general
   representation, an object with accessor properties over the same bytes
   applying the same member contracts, so that `v.m` keeps its meaning there,
   with the typed lowering remaining its specialization.
3. **Region collector root-scan trap (pre-existing; fixed).** Under the
   region collector (`initializeRuntime`), the first collection trapped
   (`brk #3`) in the root scan (`tracing/scan.ts` `scanRoots`): since the
   stack-map walker replaced root frames, each scan allocated its visitor
   closures, and the region allocator refuses requests while it collects.
   Root scanners are now created once with their collector and scan without
   allocating, and the region allocator also serves request size 0 (forced
   collection); `tools/native-region-collection.test.ts` covers churn and
   forced collections. The weak-cell native tests still cover only the
   generational and copying collectors: the region collector traces weak
   slots strongly (no weak processing), so weak cells never clear there.

## Phase plan

**Phase 2 (implemented) — libraries beyond libSystem, retained memory, raw
pointers.** `LC_LOAD_DYLIB` list with ordinals and chained-fixup `weak_import`
for optional libraries; the library manifest. Raw addresses (`Address<T>`) as
exact numbers in typed code (BigInt boundaries wait for typed BigInt); external
(non-moving) storage with explicit release and collector registration; C views
(`R.view(bytes)`, `View<R>`): record members as properties, one
constant-offset load or store each; availability queries for optional
libraries; the C stack reserve. First user: `node:zlib` sync codecs with
`z_stream` described as an interface.

**Phase 3a (implemented) — foreign memory.** `tint:ffi/unsafe` (`viewAt`,
`arrayAt`, `bytesAt`, `cStringAt`) with an audited importer list; first users
`node:os` `userInfo`/`networkInterfaces`/`loadavg`.

**Phase 3 — dynamic `node:ffi` and static recognition.** Implemented:
`dlopen`/`dlsym`/`dlclose`/`dlerror` as leaf c-calls; one AOT-compiled
universal call trampoline driven by `classifyCCall`
([dynamic calls](#dynamic-calls)). Waiting for the convergence
([requirements](#what-nodeffi-needs-from-the-convergence)): exact `node:ffi` semantics
(types, validation errors, memory accessors); recognition of constant `dlopen`
definitions lowered to address-slot direct calls. Generated wrappers' TypeScript
also runs on Node over the descriptors. Node's own FFI tests as a separate
conformance population.

**Phase 4 — callbacks (may-callback).** Caller-side root spills at
may-callback calls, transition records, the walker extension, AOT callback thunk
pools and rooted callback handles; record-typed callback signatures from the same
interfaces. Leaf-contract violations detected by the trampoline.

**Phase 5 — async calls and the event loop.** Worker execution with completion
queued to the context, borrow tokens that block detach and resize; `Async<T>`
declarations return promises.

**Phase 6 — binding generator and Windows.** 6a (implemented):
`tools/c-bindgen.ts` (clang AST and record layouts as a dev-time generator)
emitting the declaration modules in this document's syntax, per target
(`ByTarget` where they differ), checked in and re-verified by the layout and
prototype oracle ([binding generator](#binding-generator)). Remaining:
`Callback<…>` members and parameters once Phase 4 lands, replacing the
hand-written bindings with the generated ones, and Windows. Linux aarch64 landed with
Phase 2: ELF dynamic imports, the target facts verified by the oracle and
per-target declarations.
