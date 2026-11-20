# Phase 3 b3 — Node FFI over Tint dynamic calls

Design for darwin-arm64 and linux-arm64. Use the existing loader, C classifier,
dynamic trampoline and foreign-memory operations. The adapter owns JavaScript
conversion, object identity, resource lifetime and errors. See
[Native FFI](native-ffi.md) and [Unified pipeline](unified-pipeline.md).

## Compatibility target

Node **24.12.0 has no built-in FFI module**. A local probe reported
`isBuiltin("node:ffi") === false` and `ERR_UNKNOWN_BUILTIN_MODULE` on require.
That pin remains Tint's build host. FFI first shipped in Node **26.1.0**.
The exact semantic baseline is **26.13.1** (source commit
`e9c277643b0249c50f6e6de5413be8a88ea11b6a`). **26.10.0**
(`151845ab90d3926ceb36eedf1eade09619c3adc9`) is the secondary oracle for
shared assertions only. Node supports the built-in under the `node:`
scheme in FFI-enabled builds, enables it by default, emits an experimental
warning at load, and can disable it with `--no-experimental-ffi`. Under its
Permission Model FFI is gated by `--allow-ffi` and denied operations use
`ERR_ACCESS_DENIED`. The published API below is the tagged release surface.
[24.12.0 source](https://github.com/nodejs/node/tree/v24.12.0)
· [26.13.1 API](https://nodejs.org/download/release/v26.13.1/docs/api/ffi.html)
· [26.13.1 module tests](https://github.com/nodejs/node/blob/v26.13.1/test/ffi/test-ffi-module.js)
· [Permission tests](https://github.com/nodejs/node/tree/v26.13.1/test/ffi)

The exports in both 26.10.0 and 26.13.1 are:

- `DynamicLibrary`, `dlopen`, `dlclose`, `dlsym`, `suffix`, `types`.
- `getInt8`, `getUint8`, `getInt16`, `getUint16`, `getInt32`, `getUint32`,
  `getInt64`, `getUint64`, `getFloat32`, `getFloat64` and the corresponding
  ten `set*` helpers.
- `toString`, `toBuffer`, `toArrayBuffer`, `exportString`, `exportBuffer`,
  `exportArrayBuffer`, `exportArrayBufferView`, `getRawPointer`,
  `getCurrentEventLoop`.

Node exposes a CommonJS export object and ESM default and named imports.
`suffix` is `dylib` on macOS, `so` on other Unix targets and `dll` on
Windows. `types` is frozen with a null prototype. Its keys and values are
`VOID=void`, `POINTER=pointer`, `BUFFER=buffer`,
`ARRAY_BUFFER=arraybuffer`, `FUNCTION=function`, `BOOL=bool`,
`CHAR=char`, `STRING=string`, `FLOAT=float`, `DOUBLE=double`,
`INT_{8,16,32,64}=int{8,16,32,64}`, `UINT_{8,16,32,64}=uint{8,16,32,64}`
and `FLOAT_{32,64}=float{32,64}`. `getCurrentEventLoop()`, added in 26.6.0,
returns the current environment's `uv_loop_t*` as BigInt, with that
environment's lifetime.
[26.1.0 initial exports](https://github.com/nodejs/node/blob/v26.1.0/lib/ffi.js)
·
[26.10.0 exports](https://github.com/nodejs/node/blob/v26.10.0/lib/ffi.js)
· [26.13.1 exports](https://github.com/nodejs/node/blob/v26.13.1/lib/ffi.js)

### Library, symbol and wrapper identity

- `new DynamicLibrary(path)` opens a string path or, on Unix, the current
  process with `null` (reported `lib.path === ""`). The class requires
  construction (`TypeError` / `ERR_CONSTRUCT_CALL_REQUIRED` when called).
  Embedded NUL in paths or symbol names is
  `ERR_INVALID_ARG_VALUE`. Missing or mistyped paths and names are
  `ERR_INVALID_ARG_TYPE`. Loader/symbol failures are `Error` with
  `ERR_FFI_CALL_FAILED`, prefixed with `dlopen failed:` or `dlsym failed:`
  and the loader's diagnostic. Since 26.10.0 a mounted Node VFS path uses
  a private image and keeps the original public path.
- `dlopen(path[, definitions])` opens first, binds definitions, and returns
  `{ lib, functions, [Symbol.dispose]() { … } }`. It closes on binding
  failure and rethrows that completion. Omitted or undefined definitions
  produce a frozen empty null-prototype table. With definitions, the
  returned table is a writable snapshot, independent of future bindings.
  `dlclose(handle)` calls `handle.close()` and returns undefined.
  `dlsym(handle, name)` calls `handle.getSymbol(name)` and returns its
  result. This dispatch is observable on a user object supplying the method.
- `getSymbol(name)` caches the resolved address and returns a BigInt.
  `getSymbols()` and `symbols` return fresh null-prototype snapshots of
  previously resolved addresses, including those loaded by getFunction(s).
  `getFunction(name, signature)` resolves and caches a wrapper by library
  and symbol. `getFunctions(definitions)` resolves a batch and returns a
  null-prototype table for the requested keys. `getFunctions()`,
  `getFunctions(undefined)` and `functions` give fresh snapshots of all
  prepared wrappers. Cache aliases compare their **canonical ABI types**.
  Requesting the same symbol with a different ABI signature gives
  `ERR_INVALID_ARG_VALUE`. When a wrapper remains live, each access returns
  the same function, including after a user writes its properties.
- Wrappers are named after the symbol, callable with any receiver and
  nonconstructible, with no own `prototype`. `.pointer` is an own writable,
  enumerable and configurable BigInt property. Writes affect reflection
  and leave the call target intact. Node's optimized wrappers expose the
  signature arity as `.length`, while the raw generic invoker has length 0.
  Tint follows the generic invoker and exposes length 0.
- `lib.close()` and `lib[Symbol.dispose]()` are idempotent. Closing
  invalidates wrappers and callbacks, clears the caches and prevents
  further lookup. Calls through retained wrappers and operations requiring
  an open handle fail with `Error` / `ERR_FFI_LIBRARY_CLOSED`.
  Existing snapshots and wrapper properties remain ordinary values.
  `path` remains readable. `path` and `symbols` are branded own accessors
  and `functions` is a branded prototype accessor. Invalid receivers fail
  with TypeError. Node keeps the library alive through a live wrapper and
  holds the wrapper cache weakly.
  [Library implementation](https://github.com/nodejs/node/blob/v26.13.1/src/node_ffi.cc)
  · [JS wrappers](https://github.com/nodejs/node/blob/v26.13.1/lib/ffi.js)
  · [Wrapper metadata](https://github.com/nodejs/node/blob/v26.13.1/lib/internal/ffi/fast-api.js)
  · [Library tests](https://github.com/nodejs/node/blob/v26.13.1/test/ffi/test-ffi-dynamic-library.js)

### Definitions and calls

Definitions and each signature must be objects other than arrays. This
includes callable objects. Enumerate the definitions' **own enumerable
string keys** in the realm's own-key order. Ignore nonenumerable,
inherited and symbol keys. For a proxy, key enumeration and descriptor
checks precede reading signature values. Read each signature once. Within
a signature, perform the property presence checks for `return` and
`arguments` before reading either, then read and validate the return type
before the argument list and its elements in index order. Inherited signature
fields count. Absence means `void` and `[]`. A present `undefined` is invalid.
`arguments` must be an Array of recognized type strings. Preserve
getter/proxy effects and thrown values. Recheck
openness after user operations before resolving/caching. Prepare the batch
before publishing cache entries so a late malformed definition cannot leave
an earlier new symbol cached. Mutations caused independently by user
getters remain observable. Use the upstream tests to pin reentry and
first-error ordering. A correctly typed call to an open wrapper must supply
exactly its signature length, including an explicit undefined to supply a
null pointer. Validate arguments in order before executing C.
[Signature parser and conversion](https://github.com/nodejs/node/blob/v26.13.1/src/ffi/types.cc)
· [Batch preparation](https://github.com/nodejs/node/blob/v26.13.1/src/node_ffi.cc)
· [Definitions and close tests](https://github.com/nodejs/node/blob/v26.13.1/test/ffi/test-ffi-dynamic-library.js)

| Signature type and aliases | Values in a call | C and JS result |
| --- | --- | --- |
| `void` | Rejected in `arguments` | C void → undefined |
| `char` | Integral number in target C `char` range | Signed 8-bit on Darwin arm64, unsigned 8-bit on Linux arm64. Returns a number |
| `int8/i8`, `uint8/u8/bool`, `int16/i16`, `uint16/u16`, `int32/i32`, `uint32/u32` | Number, finite, integral and in range. `bool` accepts 0–255 and rejects JS booleans | Matching integer width → number |
| `int64/i64`, `uint64/u64` | In-range BigInt, or in 26.13.1 also an integral safe Number within the signed/unsigned range | Exact signed/unsigned 64-bit value → BigInt |
| `float32/f32/float`, `float64/f64/double` | Number, including NaN, infinities and signed zero | IEEE float with f32 rounding or f64 → number |
| `pointer/ptr`, `string/str`, `buffer`, `arraybuffer`, `function` | Null/undefined → NULL. BigInt in uintptr range → raw bits. String → per-call NUL-terminated UTF-8 with embedded NUL rejected. Buffer, any typed array or DataView → backing base plus byte offset. ArrayBuffer → backing base. Detached sources fail. SharedArrayBuffer-backed views can be lent. A bare SharedArrayBuffer is invalid | C pointer → unsigned BigInt, including `0n` for NULL, regardless of spelling |

There is no general argument coercion. In particular a Number is invalid
for pointer arguments and a JavaScript function value is invalid even for
the `function` spelling. Use a registered callback pointer. `bool` is
`u8`, so the C descriptor generator should be audited for **side-specific
JS adaptation** when it emits Node-compatible definitions for a C
`_Bool`. Structs by value, variadic prototypes and errno capture are outside
Node's signature vocabulary. Malformed signature field types take
`ERR_INVALID_ARG_TYPE` in 26.13.1. Unknown type strings, NULs, `void` as
a parameter, signature conflict, arity and invalid converted argument values
take `ERR_INVALID_ARG_VALUE` (TypeError for both codes). Preserve source
message labels and indices. Node's fast, shared-buffer and generic paths
can prioritize closed-state and argument errors differently on the same
invalid call. Tint follows the generic order, which checks closed state
before arity and argument conversion.
[Calls and invalid values](https://github.com/nodejs/node/blob/v26.13.1/test/ffi/test-ffi-calls.js)
· [Void parameters](https://github.com/nodejs/node/blob/v26.13.1/test/ffi/test-ffi-void-parameter.js)
· [String storage](https://github.com/nodejs/node/blob/v26.13.1/test/ffi/test-ffi-invoke-string-storage.js)
· [Shared-buffer call path](https://github.com/nodejs/node/blob/v26.13.1/lib/internal/ffi-shared-buffer.js)

### Raw memory and lending

- `get*(pointer[, offset])` uses offset 0 for omitted/undefined. A
  `set*(pointer, offset, value)` requires both subsequent arguments and
  returns undefined. Access is native-endian and permits unaligned
  addresses. The numeric conversions parallel the call table, except
  64-bit setters already accepted safe Numbers in 26.10.0. Floating setters
  accept Number, including nonfinite values. The pointer is a BigInt, with
  zero rejected for dereference. Validate pointer type and range first, then
  offset (and base + offset), required value, last accessed byte, then
  setter value conversion before storing. Getter range includes the last
  accessed byte. Use exact pointer arithmetic.
- `toString(pointer)` reads NUL-terminated UTF-8 with replacement for
  malformed sequences. `0n` returns null. An overlong string gives
  `ERR_STRING_TOO_LONG`.
- `toBuffer(pointer, length[, copy])` and
  `toArrayBuffer(pointer, length[, copy])` create the named branded value.
  By default and for explicit undefined or true, copy into independently
  owned storage. False creates a writable view of foreign storage with a
  no-op deleter. Node builds with the V8 sandbox throw
  `ERR_OPERATION_FAILED` for false. Validate pointer, length, null/span
  constraints, maximum length, then the copy option. A zero-length read
  does not dereference the pointer and permits `0n`. Foreign storage has
  caller-managed extent and lifetime even when returned as an ordinary
  object.
- `exportString(string, pointer, length[, encoding])` defaults to UTF-8,
  applies Node Buffer encodings and copies with a terminator (two zero bytes
  for the case-insensitive UCS-2/UTF-16LE aliases, one otherwise). The three
  `exportBuffer`, `exportArrayBuffer` and `exportArrayBufferView` variants
  check the specific source brand and copy its bytes, with view offsets
  honored. They return undefined and leave trailing destination bytes
  unchanged. Check public source/encoding and length first, including
  source fit, then detached/backing checks and native pointer/span validation
  in source order. The destination span uses the supplied length. Zero source
  bytes permit a null destination when span checks pass. The public export
  length validators use `ERR_OUT_OF_RANGE` for negative, fractional,
  nonfinite or excessive numeric lengths. Match Buffer's encoding errors.
- `getRawPointer(source)` accepts Buffer, ArrayBuffer, SharedArrayBuffer
  and ArrayBufferView. It returns the backing address plus the view's byte
  offset as BigInt. It rejects detached/invalid storage. The address
  carries no JS root and becomes stale on detach, resize, transfer or
  storage reclamation.
- Raw helper errors include `ERR_INVALID_ARG_TYPE` for a wrong type,
  `ERR_INVALID_ARG_VALUE` for malformed values (including negative or
  oversized BigInts, invalid offsets, missing setter operands and
  address overflow), `ERR_OUT_OF_RANGE` for raw offsets/lengths beyond the
  safe Number or platform limit, and `ERR_FFI_INVALID_POINTER` for
  forbidden null access. Buffer limits can give `ERR_BUFFER_TOO_LARGE`,
  allocation failure `ERR_MEMORY_ALLOCATION_FAILED`. Native null, buffer
  limit and string limit errors are Errors. Numeric range and allocation
  errors are RangeErrors. Invalid argument type/value and sandbox
  zero-copy errors are TypeErrors. Check arithmetic
  and lengths, leaving mapping validity, permissions and lifetimes to the
  unsafe caller contract.
- **Per-call lending** passes the actual byte range. Writes through C are
  immediately visible in JavaScript and overlapping arguments refer to
  overlapping native memory. Pass the address for a live zero-length view
  at its offset, even if a standalone empty store happens to have a null
  base. C may use the borrowed address until the call returns. The caller
  must not detach, resize, transfer or invalidate storage during the call,
  including reentrancy through callbacks. Strings are temporary distinct
  spans per live argument and invocation.
  [Raw memory implementation](https://github.com/nodejs/node/blob/v26.13.1/src/ffi/data.cc)
  · [Export validation](https://github.com/nodejs/node/blob/v26.13.1/lib/ffi.js)
  · [Error classes](https://github.com/nodejs/node/blob/v26.13.1/src/node_errors.h)
  · [Memory tests](https://github.com/nodejs/node/blob/v26.13.1/test/ffi/test-ffi-memory.js)
  · [Fast Buffer tests](https://github.com/nodejs/node/blob/v26.13.1/test/ffi/test-ffi-fast-buffer.js)

### Callbacks

`lib.registerCallback([signature,] callback)` allocates a pointer and
returns it as a BigInt. The one-function form means `void ()`.
The same signature parser applies. The JS function is invoked with undefined
as the supplied receiver, and receives narrow integers/floats as Numbers,
64-bit integers as signed/unsigned BigInts and pointers as unsigned BigInts
(including NULL). A returned value must match the declared type. 64-bit
callback results require BigInt. Pointer callbacks return an in-range
BigInt or null/undefined. There is no string or array lending on callback
return. The result of a void callback is discarded, with promises still an
error. Callback throws, promises, wrong-thread entry and invalid results
abort the process. In 26.13.1, worker/environment termination during a
callback returns a zero-initialized result and lets that thread
unwind. Active self-unregister or owner close is unsupported by Node.

The library owns registrations by pointer. `unregisterCallback` destroys
the registration, and close destroys all registrations on the library.
Native code must have stopped using the released pointers. `refCallback`
and `unrefCallback` switch the original callback between strong and weak
reachability. A collected callback returns zeros if native code calls the
remaining stub. Ref/unref after collection, and callback operations on an
unknown or foreign library's address, give `ERR_INVALID_ARG_VALUE`. A
valid pointer for a collected callback can still be unregistered. Callback
methods have the usual closed-state and argument type checks. Node can
report `ERR_FFI_CALL_FAILED` for closure allocation failure or, in the
newer release, `ERR_RX_MEMORY_NOT_SUPPORTED` for unavailable executable
memory. Its latter error also applies to eligible fast-call wrappers when
executable allocation fails. Tint's outbound AOT call path has no
executable allocation step to fail.
[Callback implementation](https://github.com/nodejs/node/blob/v26.13.1/src/node_ffi.cc)
· [Callback return marshaling](https://github.com/nodejs/node/blob/v26.13.1/src/ffi/types.cc)
· [Callback tests](https://github.com/nodejs/node/blob/v26.13.1/test/ffi/test-ffi-callbacks.js)
· [Abort and termination fixtures](https://github.com/nodejs/node/tree/v26.13.1/test/ffi)

### Differences from the installed 26.10.0 reference

Source comparison and small local probes establish that 26.10.0 requires
BigInt in i64/u64 **calls**, reports `ERR_INVALID_ARG_VALUE` for present
signature fields of the wrong type, and uses truthiness for a supplied
non-undefined copy option. 26.13.1 accepts safe Numbers in calls, reports
`ERR_INVALID_ARG_TYPE` for wrong-typed signature fields/elements and
requires boolean for a defined copy option. The newer source also caps
raw sizes at MAX_SAFE_INTEGER, checks the ArrayBuffer brand in
`exportArrayBuffer`, fixes reentrant signature cache lookup after getters
close the owner, tightens fast-path pointer-range validation and adds
callback termination and executable-memory failure handling. The
26.10.0 probes covered module exports, null process path, wrapper metadata,
UTF-8 and embedded NUL, number-as-pointer, call arity, loader errors and
closed-state errors. A 26.13.1 probe confirmed the listed conversions and
error changes, own-enumerable definition filtering, proxy trap order and
inherited signature fields. On both local references, a resized
out-of-bounds DataView retained a backing store, but its FFI raw pointer
used the base address with no view offset. This differs from detached
storage, which is rejected.
[Tagged comparison](https://github.com/nodejs/node/compare/v26.10.0...v26.13.1)
· [26.10.0 call tests](https://github.com/nodejs/node/blob/v26.10.0/test/ffi/test-ffi-calls.js)
· [26.10.0 data conversion](https://github.com/nodejs/node/blob/v26.10.0/src/ffi/data.cc)

## Tint architecture and prerequisites

### Trusted module and boundary

Put the adapter in `packages/native-runtime/src/node/ffi.ts`. Register a
target-gated built-in mapping and trusted runtime capability through the
compiler's existing module graph/linker paths. Use the hosted
`node:zlib`/general-import fixtures as precedents for loading the source,
and test the application resolver entry separately from a fixture-specific
alias. Add only this adapter to `tools/boundaries.ts`'s
`unsafeForeignMemoryModules`, using a narrow facade in
`ffi/unsafe.ts` and its declaration. Register the new source in the compiler
catalog. The trusted partition stays typed in a mixed program. Typed callers
and ordinary JS take the same adapter path. Demand-install realm intrinsics
in a typed-only program importing FFI. Supply default and named exports from
the same underlying module values and reuse a CommonJS module loader if the
embedding supports one.

At the entry use `unknown` for untrusted values that need Node validation.
Preserve property access and evaluation through the program realm. Use
existing `OrdinaryObject` allocation, property operations and
`createCallableObject`/`createConstructorObject` plus built-in descriptor
helpers in `js-runtime/src/objects`, through narrow trusted contracts.
A library instance is one canonical branded realm object, with private
typed loader state and a single prototype per realm. The constructor,
methods, disposal symbols, null-prototype snapshots, function wrappers and
errors observed by either pipeline are realm values. Associate the private
state through an internal slot or the existing identity/weak association
mechanism. The native handle, C signature, addresses in ABI storage and
call frame stay private. A bound function carries the owning object and an
immutable internal binding. A snapshot contains those same callables. Storing a callable in a property or reading it back preserves `===`,
`[[Call]]`, receiver behavior and reflection. Keep the cache weak so a
library can stay alive independently of wrappers. A live wrapper retains
the library. A library reclaimed without explicit close must release its
loader reference and callbacks through context/weak cleanup, with close
and finalization sharing the same once-only transition.

Public type declarations can provide symbol-name inference and callable
interfaces over the runtime surface. Validate at the JS entry regardless
of caller typing. Avoid an enrolled `Record<string, Fn>` contract on the
public snapshot when that would reject ordinary JS writes. A typed consumer
applies its own written contract. Likewise, a public callable's writable
`.pointer` is separate from the address captured for native calls.

### Calls and memory mechanics

1. Translate a validated signature into the existing `CSignature`.
   Select char signedness from `CTarget`, map pointer-like aliases to
   `pointer` and use a fixed-arity signature with `errno: "none"`. Reuse
   `classifyCCall` and `foreignFunction`. Prefer factoring the latter
   into a reusable classified plan and invocation state. `dlopen(null)`
   uses `openProgram`. String paths use `openLibrary`. Retain exact loader
   handle words. Use `findSymbol`/close helpers, extending their internal
   result/diagnostic contract where needed. Translate only known loader
   failures. Preserve the original thrown value from user getters. `close`
   invalidates bindings even if the platform unload has no reportable Node
   result. If a loader permits a successful zero-valued symbol, keep the
   address exact and treat a call with a null target as closed per Node's
   native invoker.
2. Set narrow integers and floats with `setNumber`. Validate the BigInt
   before splitting it into low/high u32 words. With typed BigInt,
   unsigned decode is `(BigInt(high) << 32n) | BigInt(low)`. Subtract
   `1n << 64n` for signed decode when bit 63 is set. Signed encoding uses
   modulo 2^64 **after** range validation. Use
   `setWords`/`resultLow`/`resultHigh` to carry arbitrary 64-bit values
   exactly. Reuse shared numeric validation for memory setters and
   callback results with their distinct accepted forms.
3. The range projection retains the storage owner or backing lease and
   provides a managed backing byte reference, byte offset and byte length.
   Tie its capture to the invocation and use brand checks and internal
   slots. Realm `typedArrayWindow`, DataView's window calculation and
   `byteStorageWindow`/`bufferStorageWindow` already have the relevant
   storage facts. Project their current window, preserving detached versus
   live empty and out-of-bounds resize behavior. General realm windows and
   typed native array views must agree on the bytes. For a leaf call use
   `setBytes` or extend it to take a range, using the existing trampoline's
   base/offset patches. Form the raw address only where the leaf guarantee
   prevents relocation. Hold roots through the call. A nested invocation
   cannot reuse the parent's arguments, string storage, frame or result
   slots. Clear byte references and release leases in finally, including on
   failed conversion, so cached bindings never keep caller buffers alive.
   Preserve the existing persistent-setter contract for other consumers of
   `tint:ffi/unsafe`.
4. For raw memory, reuse native-endian byte/word codec operations and
   `ffi/unsafe` foreign access, with an exact-word base plus checked
   offsets. Today `bytesAt` and `cStringAt` take Number addresses and
   `bytesAt` has a u32 length cap. Extend trusted primitives where
   necessary for address bits without Number rounding or a distinct
   binding path. Reuse UTF-8 C-string handling with a checked string
   length and the realm's Buffer/ArrayBuffer constructors over owned or
   adopted storage. For zero-copy results the storage carries a no-op
   foreign deleter, including through slices or views. For raw exports use
   the byte window and the Buffer encoding subsystem. Inputs may alias
   foreign memory, so use a copy primitive with defined overlap behavior.
5. Implement runtime-signature callback registration with allocation that
   can grow with demand. Reuse the registered dispatcher, transition
   record and universal callback frame mechanics. Allocation failure is
   explicit. A runtime prototype describes how to decode
   saved registers and stack slots through the shared ABI classifier, invoke
   the original realm callable via B4, and write raw result words. Current
   `setCallback` is scoped to one call, accepts a Number-only adapter and
   rethrows afterward. It cannot implement this API by retaining its
   patched addresses. Share the frame codec where practical and keep the
   existing `tint:ffi` throw/rethrow policy for those callers. The Node
   entry must abort before resuming C on callback contract violations.
   Context and thread checks must precede any managed memory access.
6. Choose a may-callback transition whenever a call can reach a live
   registration, including a pointer previously stored in C, used in an
   unrelated library or returned as raw BigInt. The initial conservative
   rule is realm-wide while a live Node registration exists, with
   `invoke` explicitly supporting may-callback when there are no
   `setCallback` operands. Under the existing single-mutator rule, calls
   with no reachable Tint callback can use the leaf path. Account for
   registrations from other trusted Tint FFI entry points too. Entry on
   the owner thread from C outside a Tint transition still requires a
   host transition contract, even though Node permits same-thread native
   callers. The may-callback path needs stable backing throughout C
   execution. When an address escapes through `getRawPointer` or through
   lending in a may-callback call, retarget storage through its owner to
   stable external backing. The owner and all views retain their identity
   and share the retargeted bytes. Default allocations use the current
   policy. Stop and coordinate with the collector-owning thread if the
   transition requires collector or stack-map changes. Recheck the
   effective range before native entry and retain the storage across
   callbacks. Retention is distinct from the
   caller's obligation to avoid resize or detach while C runs.

### Gap disposition

| Dependency | Disposition and owner |
| --- | --- |
| Trusted general imports | On main. Exercise mixed-link capabilities through `compiler/src/native/index.ts` and the existing trusted export thunk. Resolver registration and typed-only realm installation are b3 integration work. |
| Typed BigInt and rest | On main. Verify packing/unpacking on the typed path and use rest for actual arity where it crosses the checked bridge. A realm call hook already receives the full argument list. Expose ordinary positional calls, including omitted vs explicit undefined. No FFI-specific rest ABI. |
| C1/C2 and callable views | **Prerequisite 1a, convergence.** Complete slice 2b in the checker, `ts-native`/compiler bridge and `js-runtime/src/objects`. Project callable values canonically across property reads/writes and trusted exports, preserving descriptors, rest arguments, return values and abrupt completions. B4 supplies realm calls with the receiver. Create FFI callables directly in the realm through the shared callable entry. Gate on a typed function-valued property fixture that proves identity and calls across both pipelines. |
| General object semantics under typed code | **Verify in 1a.** Exercise own enumerable string keys with proxy descriptor checks, separate presence/get operations, indexed array reads and subclass/brand/receiver handling through shared realm operations. Use the same descriptors for getters, disposal, freezing and nonconstructible wrappers. |
| B5 and byte ranges | **Prerequisite 1b, convergence.** Complete slice 2b in `js-runtime/src/objects`, `bytes` and the typed bridge. Project generic ArrayBufferView through internal slots, including DataView, non-byte typed arrays, shared backing, byte offsets and byte lengths. Distinguish detached and live empty stores, preserve the attached zero-offset/zero-length case for an out-of-bounds view, and verify writes through existing aliases. |
| Non-moving bytes and escaping addresses | **Required for b3.** When an address escapes through `getRawPointer` or a may-callback loan, retarget through the storage owner to external stable backing. Preserve owner and view identities, aliasing and the current default allocation policy. Support initially movable storage in may-callback calls. If the transition needs collector or stack-map changes, stop and coordinate with the collector-owning thread. |
| Buffer and ArrayBuffer results | **Prerequisite 1c, convergence.** Supply Node Buffer identity, prototype and encodings, and an ArrayBuffer adoption hook for foreign backing. Keep general byte ownership in the shared runtime and Buffer semantics in the Node layer. |
| B6 and error taxonomy | **Prerequisite 1d, convergence.** Reuse B6 coded Error and RangeError factories in `native-runtime/src/node/errors.ts`. Add the coded TypeError factory and its realm view. Gate on name, code, message, descriptors and crossing identity. Normalize loader failures while preserving user getter and proxy exceptions. |
| Exact loader and raw memory operations | **First where used.** Provide word-preserving dlsym output and address/span ops in the FFI primitives and native foreign binding plumbing. Today's numerical code-address path is exact for current arm64 user VAs but rejects high words. Use the existing ABI/cell representation and byte patching machinery before introducing other address representations. Capture loader error text at the failing operation. |
| Dynamic capacity | **Required for b3.** Grow the shared trampoline and frame layout to support Node generic-path arities. Separate raw pointer arguments from byte borrow slots. Remove the current eight-pointer, 512-byte stack and 16-patch capacities as b3 limits. |
| Registered callbacks and teardown | **Required for b3.** Implement runtime-signature registration without a fixed finite pool. Reuse the ABI classifier for exact callback frames. Implement the Node abort policy, owner teardown and invocation roots in `native-runtime/src/ffi` and `compiler/src/native/foreign`. Report actual allocation failure explicitly. |
| Host integration | **Accepted diagnosed limit.** Provide an explicit diagnostic for each unavailable capability: `getCurrentEventLoop`/libuv, VFS loading, worker termination, permissions, flags, warnings and CommonJS. Report at the build or embedding boundary where possible and at runtime when discovered dynamically. Give every capability a fixture that asserts its exact diagnostic. |
| Region collector weak processing | **Accepted diagnosed limit until the collector processes weak slots.** Weak callback, wrapper and finalization behavior is unavailable on this collector. Use region fixtures to assert the exact diagnostic for each affected behavior. |
| Same-thread callback entry outside a Tint transition | **Accepted diagnosed limit until async FFI and an event loop exist.** Keep the transition guard and report the no-transition failure explicitly. A native fixture must establish same-thread entry without a transition and assert the exact diagnostic before any managed callback executes. |

## Tests and implementation order

Design evidence on macOS arm64 used the checksum-verified Node 26.13.1
binary, a clang-built upstream `ffi_test_library.dylib` and the unchanged
upstream module, dynamic-library, calls, memory, callbacks, void-parameter
and invoke-string-storage files under `node --test`. Exit 0, 58 passed,
one upstream skip for the V8-sandbox zero-copy error. This is reference
evidence for seven files. Tint fixtures and the full b5 population are
implementation gates.

Use `tools/hosted-fixture.ts`, `tools/native-dynamic-fixtures.ts` and the
slice 4a fixture patterns. Compile a small platform C shared-library oracle
with clang at test time. Reuse the same C library and portable JS fixture
sources for Node and Tint. Use `TINT_GENERAL_FALLBACK=0` for fully typed
fixtures. For mixed/general fixtures deliberately enable the general
partition and assert its exact module set, so the adapter and dependencies
are proven typed. Link through the normal application entry as well as the
hosted fixture. Use `TZ=UTC`, `TINT_BUILD_ONLY=1`, the fixture build
manifest and LLDB on both arm64 targets. Assert stopped at entry and final
inferior exit status 42 for success cases. Use isolated child images for
intentional abort tests and verify entry, native failure reason and no
continuation. Preserve first failures. Exercise generational and copying
collectors with forced collection in and around calls, plus region where
its capabilities suffice.

1. **Land the convergence prerequisites.** Start after B4–B6 integrate.
   Land these on four independently gated branches owned by the
   convergence thread.

   - **1a. Callable projection.** Prove the shared callable entry and
     typed function-valued properties with typed/general fixture twins.
     Cover identity, receiver, classes, rest and abrupt completion.
     Verify the realm's own-key and descriptor operations, inherited
     signature reads and trap/getter ordering.
   - **1b. Byte-range projection.** Gate internal-slot projection for
     generic ArrayBufferView, offsets, detached versus live empty
     stores, and in-place writes.
   - **1c. Buffer and ArrayBuffer.** Gate Buffer branding and encodings
     and ArrayBuffer adoption over foreign storage.
   - **1d. Coded TypeError.** Gate the factory and realm view across
     typed and general code.

   Add checker cases and typed/untyped corpus constructs where appropriate.
2. **Land scalar dynamic binding.** Add exact-word loader and binding-plan
   support, prototype parsing, branded library/callables and snapshot
   identity. Grow the trampoline and frame layout for Node's generic
   arities. Test calls beyond the existing stack limit and beyond eight
   raw pointer parameters. Assert generic-path error precedence and
   wrapper `.length === 0`. Gate on target `char`, `bool` as uint8, signed limits, f32,
   floating edge values, stack-spilled calls, raw pointer and 64-bit
   round trips, UTF-8 argument temporaries, argument errors, recursive
   definition getters, failed batch cleanup and unload/close/using.
   Compare descriptor-generated functions against the shared C oracle.
3. **Land byte ranges and lending.** Gate the storage projection independently
   for typed and general arrays, Buffer, nonzero-offset DataView, non-byte
   arrays, full ArrayBuffer, shared backing, overlapping windows, empty
   views, detachment and resize/OOB. Then run C read/write and self-aliasing
   probes, multi-string calls and failure followed by retry at the same
   wrapper. Force GC before entry and after return. Verify pointer identity
   against a stable oracle and that cached bindings release borrowed roots.
   Exercise borrow counts beyond the old slot and patch limits.
4. **Land raw memory.** Gate unaligned scalar reads/writes of all widths,
   exact BigInt/address bounds, pre-dereference errors, null/empty cases,
   encoding and invalid UTF-8, byte-for-byte range exports and untouched
   trailing bytes. Test Buffer/ArrayBuffer branding, copy independence,
   writable foreign aliasing and no free on collection. Gate exported
   pointers that survive moving collections as long as their backing is
   live. Verify that the storage-owner transition preserves existing
   aliases and their identities. Inspect allocation failures before any
   native reads.
5. **Land callback registration and transitions.** Gate default and explicit
   signatures, exact wide values and spilled C parameters, registration
   ownership/ref/unref, callback reachable through a raw pointer stored
   earlier, reentrancy through the same wrapper and through other
   libraries, and GC while lending initially movable, overlapping bytes.
   Verify registration growth beyond the existing pool, allocation
   failure, teardown and roots. Test bad returns, throws, promises and cross-thread entry
   in separate LLDB runs. Verify the original Tint dynamic callback
   throw/rethrow fixtures keep their behavior.
6. **Gate the installed surface and record gaps.** Check module/default and
   named export identity, disposal, class descriptors and weak lifetime
   behavior. Add fixtures asserting the exact diagnostic for each accepted
   limit in the gap table. Assert the compile/embedding diagnostic or
   runtime error as appropriate, and inspect the inferior for the
   no-transition failure. Classify new tests in `tools/check-test-files.json`.
   Subsequent implementation uses the repository's macOS/Linux gates,
   native self-build and smoke evidence as required by the slice brief.
   Static-definition recognition (FFI b4) can lower the ABI call behind the
   same validated binding/lifetime contract. Benchmarking is FFI b6.

Node references run with `NODE26` when configured, otherwise with the
current FFI-capable Node 26 executable if available. Probe version, build
flag and actual import in a child. On 24.12.0 (or another host without a
configured FFI-capable reference) record a skip for the **Node FFI
comparison only**. Expected absence is `ERR_UNKNOWN_BUILTIN_MODULE`.
Record an explicitly disabled or FFI-less build separately. Fail a
configured reference that cannot run and propagate unexpected probe or
fixture failures. Log exact version, platform, flags and build features,
including the sandbox behavior for zero-copy. Run shared assertions on
26.10.0 and release-specific assertions only against their matching
oracle. Keep Tint expectations pinned to the 26.13.1 generic path.
Fixtures with path-dependent assertions must exercise Node's generic
path when comparing with the reference. Native
coverage runs independently of Node reference availability. Keep Tint-only
contract tests separate from the shared JS fixture.

For **b5**, use the entire pinned [Node FFI suite](https://github.com/nodejs/node/tree/v26.13.1/test/ffi)
with its fixture sources, status rules and flags, plus the separately
reported platform/build-availability case in
[`test/parallel/test-ffi-missing-build.js`](https://github.com/nodejs/node/blob/v26.13.1/test/parallel/test-ffi-missing-build.js).
Reuse the b3 loader, C test build and native runner. Provide the required
test harness capabilities through the runner (common/assert/test,
fixtures, subprocesses, worker/flags) and keep the test sources unchanged.
Record the upstream SHA, population and target matrix, and account for
every test file, upstream skip, unsupported host capability, compile or
runtime failure, signal and timeout. Preserve expected abort as a distinct
outcome. Keep Node oracle results and Tint native results separate.
Keep Fast API, shared-buffer and executable-memory assertions visible in
the population. Report fast-path-only assertions as Node implementation
details outside Tint's generic-path baseline, including path-specific
error precedence and wrapper length.

## Decisions (2026-11-20)

1. Node 26.13.1 is the exact semantic baseline. Use 26.10.0 only for
   shared assertions. Match Node's generic path wherever behavior varies
   by call path, including error ordering and wrapper length. Fixtures
   assert generic-path behavior. b5 records fast-path-only assertions as
   Node implementation details.
2. The convergence thread owns four prerequisite branches after B4–B6
   land. In order, they cover slice 2b callable projection and its typed
   property proof, slice 2b byte-range projection, Buffer identity and
   ArrayBuffer adoption, and coded TypeError with its realm view. FFI
   creates its callables in the realm through the shared callable entry.
3. Retarget storage through its owner to stable external backing when
   exporting a raw address or lending bytes in a may-callback call.
   Preserve identity and the current default allocation policy. If
   collector or stack-map changes are needed, stop and coordinate with
   the collector-owning thread.
4. b3 completion requires lending initially movable bytes in may-callback
   calls, dynamic calls at Node's generic-path arities, and
   runtime-signature callback registration with teardown and roots.
   Separate raw pointer arguments from borrow slots and grow the
   trampoline and frame layout. Registration grows with demand. Actual
   allocation failure is reported explicitly.
5. Accepted limits are Node host integration (`getCurrentEventLoop`/libuv,
   VFS loading, worker termination, permissions, flags, warnings and
   CommonJS), weak callback, wrapper and finalization behavior on the
   region collector until it processes weak slots, and same-thread
   callback entry outside a Tint transition until async FFI and an event
   loop exist. Each has a gap row and requires a fixture asserting the
   exact diagnostic. Report unsupported behavior explicitly without
   returning a sentinel, substituting a fake facility or silently
   succeeding.
6. Follow implementation steps 1–6, with step 1 split into the four
   prerequisite branches above.
