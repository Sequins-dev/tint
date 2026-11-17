# Native FFI: direct C calls from TypeScript

Status: Phase 1 implemented (leaf calls into the libSystem family, darwin-arm64).
Later phases are planned below. The exploration that chose this design (prior
art, `node:ffi`, the GC argument) is summarized here; this document is the
design of record.

Calling C should feel like calling TypeScript. A C library is described once,
by a TypeScript declaration module; Tint reads that declaration as an interface
definition language (IDL), synthesizes the implementation, and compiles each call
to an inline C call. The same declaration also yields a runtime descriptor
(`node:ffi` definitions and struct layouts) for dynamic consumers.

## Layering

| Layer | Where | Role |
|---|---|---|
| C model and ABI | `@tint/abi/c` | C types and signatures, target facts, struct layout, the AAPCS64/Apple classifier, runtime descriptors. Portable; shared by AOT, live code and dynamic runtimes. |
| Binding front end | `@tint/compiler/native` (`native/foreign/`) | Parses `declare module "tint:c/<library>"` files into the model and expands them into generated TypeScript modules plus c-call bindings. |
| IR | `@tint/ir/scalar` (`c-call`, `bindForeignCalls`) | One instruction per C call, with its concrete prototype. |
| Codegen | `@tint/codegen/aarch64/scalar` | Lowers `c-call` inline from the classified layout, through the image's import slots. |
| Image | `@tint/image` (unchanged) | libSystem is already a load command; its re-exports (libsystem_c, libcommonCrypto, ...) resolve every Phase 1 symbol. |

No C compiler or platform linker participates. clang is used only as a
test-time oracle (below) and, later, as a dev-time binding generator whose
output is checked in.

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
  export function CC_SHA256_Update(c: Ptr<CC_SHA256_CTX>, data: Ptr<u8>, len: CC_LONG): i32;
  export function CC_SHA256_Final(md: Ptr<u8>, c: Ptr<CC_SHA256_CTX>): i32;
}
```

and its use, which is ordinary TypeScript:

```ts
import { CC_SHA256_CTX, CC_SHA256_Init, CC_SHA256_Update } from "tint:c/commoncrypto";
const context = new Uint8Array(CC_SHA256_CTX.size);   // 104
CC_SHA256_Init(context);
CC_SHA256_Update(context, bytes, bytes.length);       // one inline blr
```

The declaration is not a change to TypeScript semantics: the marker types
(`packages/native-runtime/src/c/ffi.d.ts`, module `tint:ffi`) erase to the values
callers pass (`number`, `boolean`, `string`, `Uint8Array`, objects), so stock
`tsc` checks call sites and the declaration file itself. Tint reads the widths
and shapes syntactically from the declaration; types still only select
specializations.

### Vocabulary

| Declaration | C | TypeScript value | Notes |
|---|---|---|---|
| `bool` | `_Bool` | `boolean` | |
| `char i8 u8 i16 u16 i32 u32` | fixed-width integers | `number` | Exact conversion; inexact or out-of-range values trap. `char` signedness is the target's. |
| `i64 u64 isize usize` | 64-bit integers | `number` | Arguments and results must be exact numbers; a result outside the exact range traps (no silent rounding, cf. fino's `usize` bug). BigInt forms come with the dynamic layer. |
| `f32 f64` | `float`, `double` | `number` | `f32` rounds like `Math.fround`. |
| `Ptr<T>` | `T *` (argument) | `Uint8Array` | The data pointer, borrowed for the call. A record pointee requires at least the record's size (checked); scalar pointees are buffers whose extent the C function defines. |
| `CString` | `const char *` | `string` | NUL-terminated UTF-8 copy; lone surrogates become U+FFFD. |
| `CStringBytes` | `const char *` | `Uint8Array` | Must be nonempty and end in NUL (checked). |
| `interface R { ... }` | `struct R` | object with R's fields | Members in declaration order. By value: copied to/from the C image. |
| `extends Packed` / `Union` / `Aligned<N>` | `__attribute__((packed))`, `union`, `aligned(N)` | | |
| `FixedArray<T, N>` | `T m[N]` (member) | `number[]` etc. | Members only; C never passes arrays by value. |
| `const R: Layout<R>` | | `{ size, alignment, offsets }` | Generated from the shared layout computation. |
| `OrErrno<i32 \| i64 \| isize>` | result | `number` | Negative results become `-errno`, captured immediately after the call. |
| `Variadic<T>` | `...` | as T | Marks this and all later parameters as variadic arguments of this prototype (C default promotion applies). |
| `name$variant` | symbol `name` | | Several prototypes of one symbol (e.g. variadic shapes). |
| `type A = T` | `typedef` | | |
| `MayCallback<T>`, `Async<T>` | call classes | | Parsed into the model; rejected until Phases 4–5. |

Everything else fails explicitly with a located diagnostic: unions of types,
optional or rest parameters, bodies, pointer results and pointer members of
by-value records (they need raw pointer values, Phase 2), self-containing
records, unknown names, names not imported from `tint:ffi`, libraries outside
the libSystem family. Nothing is silently degraded.

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
- record interfaces and `Layout` constants.

A generated module the program loads becomes a trusted runtime module; its stubs
are the only functions bound to its declarations. Explicit `NativeForeignBinding`s
bind other declared runtime exports to a declaration (as the file operations
below do). Names in source alone grant nothing: the compiler's list of linked
libraries (`linkedForeignLibrary`) and the build request are the authority. The
workspace boundary check accepts ambient declarations only in these binding files,
which import only `tint:ffi`; other packages cannot import another package's
bindings.

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

| Fact | darwin-arm64 | linux-arm64 (AAPCS64) |
|---|---|---|
| Variadic arguments | always on the stack, 8-byte slots | like named arguments |
| Named stack arguments | packed at natural alignment | 8-byte slots |
| Narrow integer extension | caller extends to 32 bits | callee extends |
| 16-byte-aligned record start | any X register | even X register (C.8) |
| `char` | signed | unsigned |

The fourth row was found by the oracle: Apple clang starts an `aligned(16)`
record in an odd register. **Oracle:** `packages/abi/test/c-abi-oracle.test.ts`
compiles C callers of naked capture/produce stubs with clang and checks that every
argument byte arrives where `classifyCCall` predicts (registers, stack,
indirect copies, extension bits) and every result byte returns where predicted,
over 23 shapes (scalars, narrow types, natural packing, float spills, composites,
HFAs including nested and spilled ones, unions, packed and aligned records,
indirect records in registers and on the stack, variadics with records, results of
every class). It skips with a visible reason without clang. A second clang check
compares the `CC_SHA256_CTX` declaration with the system header.

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

## Call classes and the GC invariant

| Class | Phase | Safepoint | Callbacks | Managed memory as arguments |
|---|---|---|---|---|
| **leaf** | 1 | no | forbidden | any byte view, including owned (movable) storage |
| may-callback | 4 | yes | same thread | non-moving storage, or copy-in/copy-out |
| async | 5 | n/a (worker) | queued | external storage kept alive and non-detachable |

> **GC invariant: leaf calls require a single mutator and no concurrent
> collection.** A leaf call relies on nothing moving, being replaced or detached
> while C runs. That holds today because each heap has exactly one mutator and a
> collection starts only when that mutator asks (allocation slow path or an
> explicit request); parallel GC workers run only inside a stop-the-world
> collection the mutator started; other agents have other heaps. Any future
> concurrent or incremental marking, concurrent evacuation, or multiple mutators
> per heap must revisit leaf calls (pin borrowed views, or transition around the
> call) before it lands.

Consequences: C may use a borrowed view only until it returns (no retained
pointers; Phase 2 adds external storage for retained memory such as `z_stream`
buffers); a long blocking leaf call blocks only its own context (an
event-loop concern, solved by the async class, not a GC hazard); a C library that
unexpectedly calls back during a leaf call is undefined behaviour until Phase 4's
trampolines detect it.

## Runtime descriptors (one layout engine, two consumers)

`cLibraryDescriptor` turns the same parsed declaration into `node:ffi` `dlopen`
definitions (functions `node:ffi` cannot express — records by value, variadics,
errno capture — are listed with the reason) and a layout descriptor per record
(name, size, alignment, field offsets and sizes), computed by the same
`cLayout` the compiler uses. A test drives CommonCrypto through Node 26's
`node:ffi` with the generated definitions (skipped, with its reason, on Node 24).
The dynamic trampoline that consumes these descriptors inside Tint is Phase 3.

## Re-expressed host operations

The compiler's own file operations `close`, `chmod` (`fchmod`), `unlink` and
`rename` are now bound to `tint:c/libsystem` declarations as c-calls (with
`OrErrno`) whenever the binding is in the source graph; frozen graphs that predate
it keep the host operations, so old snapshots still build. Fixtures bind
`processId` to `getpid` the same way. Equivalence (hosted fixture calling all
five, built on main and on the c-call build): with `mode` declared `i32` and the
c-call given host-call-equivalent effects, the image is **byte-identical** to
main. The two remaining differences are intended:

1. Darwin's `mode_t` is `u16`; declaring it so adds the 3-instruction range check
   (`uxth w9, w1; cmp w9, w1; b.ne trap`) where the host operation passed the
   truncated int.
2. The leaf c-call's precise effects (no allocation) prove its callers free of
   safepoints, so one caller's stack map shrinks. Code bytes are unchanged.

The self-build fixpoint (stage2 == stage3) holds with these bindings in the
compiler itself: the native compiler parses its own binding declarations.

## `crypto.createHash('sha256')`

`packages/native-runtime/src/node/crypto.ts` implements Node's
`createHash(algorithm).update(string | Uint8Array).digest([encoding])` over
CommonCrypto with leaf calls only. The context lives in an ordinary movable
`Uint8Array` between calls: `CC_SHA256_CTX` holds plain words and no
self-pointers (checked against the header), and no collection can run during a
leaf call. `digest()` returns the bytes (Node returns a Buffer), `digest("hex" |
"base64" | "base64url")` text; digesting twice or updating after a digest throws
"Digest already called". The native test compares 14 vectors with Node's digests
(empty input, block boundaries 55/56/63/64/65, multi-update across strings and
bytes, non-ASCII and lone surrogates, 1 MiB + 13 bytes) with allocation churn
forcing collections between updates.

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
  errors, expansion, descriptors, `node:ffi` (Node 26), header layout oracle.
- `packages/ir/test/scalar-foreign.test.ts`,
  `packages/codegen/test/scalar-foreign-call.test.ts`: IR typing, binding,
  effects and emission of every argument and result class.
- `tools/native-ffi.test.ts` (native, under LLDB): libSystem ABI probes (`div`,
  `ldiv`, complex HFAs in and out, `memcpy` of an indirect record copy,
  `snprintf` reading back variadic slots, natural stack packing and stack-passed
  records and HFAs) and the crypto vectors.
- `tools/ffi-microbench.ts`: call overhead (below), not part of `pnpm check`.

## Measurements

`tools/ffi-microbench.ts` (2026-11-17, Apple M-series, 18 cores, load average
about 2–5, run under `lockf /Users/stephenbelanger/.t3/tint-timing.lock`,
`TINT_GENERAL_FALLBACK=0`, Node 26.10 for `node:ffi`). Native loops time
themselves with the monotonic clock over 10^8 calls (5×10^6 hash updates);
images run under LLDB with entry and exit-status assertions.

| Call | ns/call |
|---|---|
| Tint direct leaf c-call `getpid()` (inlined at the call site) | 1.17 |
| Tint host operation `processId()` (managed wrapper + completion check) | 1.17 |
| `node:ffi` `getpid()` | 4.52 |
| Tint c-call `CC_SHA256_Update` (64 bytes) | 22.2 |
| `node:ffi` `CC_SHA256_Update` (64 bytes, buffer arguments) | 98.4 |
| Node `crypto` `hash.update` (64 bytes, OpenSSL) | 24.6 |

Leaf c-calls inline into callers: the measured loop is `adr; mov; movk; add; ldr
x16; blr x16; scvtf` with the induction variable in x28 and the sum in d8
(callee-saved homes, no spills), no wrapper `bl` and no completion check. The
host-operation loop calls a wrapper with its own frame and checks the completion
tag; on this core `getpid` dominates both, so they time alike. With buffer
arguments the direct call costs about a quarter of `node:ffi`. Remaining
code-quality item: a c-call result passes through its frame slot (`str d0`;
`ldr d1`) before use.

## Known defects

Typed and untyped code are meant to share one pipeline with identical features;
types only enable optimization. Phase 1 met several gaps of today's separate
typed path and worked around them. Each workaround is a defect, marked
`KNOWN DEFECT` at its site, to be removed by the typed/general pipeline
convergence ([progressive lowering](progressive-lowering.md)), not design:

| Gap in the typed pipeline | Workaround (site) |
|---|---|
| Untyped (general) code cannot import trusted runtime modules, so untyped code cannot call bindings | none; bindings are typed-only today (`compileArm64Program` general partition) |
| No plain `Error` construction | `TypeError` with Node's messages (`native-runtime/src/node/crypto.ts`) |
| Classes rejected in this module context | closure-backed `Hash` object (`crypto.ts`) |
| No `String.prototype.toLowerCase` | `sameAsciiLetters` (`crypto.ts`) |
| No reading `.message` of a caught error; no `instanceof Uint8Array` | the native test checks only `instanceof TypeError` (`tools/native-ffi-fixtures.ts`) |
| No `Math.pow`, `Math.log2`, `Math.fround`; no typed-array views over a buffer | arithmetic binary32/binary64 codecs in generated record wrappers; precomputed `fround` literals in the fixture (`compiler/src/native/foreign/expansion.ts`) |
| Narrowing `string \| Uint8Array` did not lower | fixed: `general-value` extracts a checked `Uint8Array` |
| Compiler sources: no tuple types, `JSON`, `Math.pow`, nested type declarations; forward references to unannotated module consts fail the native bootstrap; a ternary choosing opcodes of different ISA union members fails contextual typing | interface instead of tuple, string concatenation, constants, module-level `Operand`, annotated helper texts (`foreign/*.ts`); `integerToFloat`/`floatToInteger`/`narrowLoad`/`narrowStore` helpers (codegen `c-call` lowering) |

## Open items (FFI scope)

- C stack depth is not checked before a call (C ignores Tint's stack limit;
  overflow hits the guard page). Phase 2: a per-call headroom check.
- Narrow-integer and 64-bit arguments trap rather than throw on bad values;
  the `node:ffi` layer will throw Node's errors.

## Phase plan

**Phase 2 — libraries beyond libSystem, retained memory, raw pointers.**
`LC_LOAD_DYLIB` list with ordinals and chained-fixup `weak_import` for optional
libraries; a manifest mapping `tint:c/<library>` to install names per target.
Raw pointer values (`Ptr<T>` results and members) as integers in typed code,
BigInt at general boundaries; external (non-moving) `alloc` storage registered
with the collector for memory C retains across calls; typed field access through
a pointer as constant-offset loads and stores, generated from the record
interface (`ptr.avail_in` → one `ldr`). C stack headroom check. First user:
`zlib.deflateSync`/`inflateSync` with `z_stream` described as an interface.

**Phase 3 — dynamic `node:ffi` and static recognition.** `dlopen`/`dlsym`/
`dlclose`/`dlerror` as leaf c-calls; one AOT-compiled universal call trampoline
driven by `classifyCCall` and the descriptors above; exact `node:ffi` semantics
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

**Phase 6 — binding generator and Linux.** `tools/c-bindgen.ts` (clang AST and
record layouts as a dev-time generator) emitting the declaration modules in this
document's syntax, per target, checked in and re-verified by the layout oracle;
Linux aarch64 target facts (already in `CTarget`) with ELF dynamic imports; later
Windows.
