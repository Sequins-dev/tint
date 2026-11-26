import type { HostOperation } from "./host.ts";
import type { ForeignCall, ForeignMemoryAccess } from "./foreign.ts";
export type NativeErrorKind =
  "Error" | "TypeError" | "RangeError" | "ReferenceError";

export type ScalarType =
  | "general"
  | "optional-boolean"
  | "primitive"
  | "string"
  | "reference"
  | "optional-reference"
  | "optional-string"
  | "number"
  | "boolean"
  | NativeTypedArray
  | "optional-number";
export type ReturnType = ScalarType | "void";
/** Fields of IR activation-read. */
export type ActivationField =
  "top" | "previous" | "kind" | "callee" | "count" | "argument";
/** The operands and result type of each activation field. */
export function activationFieldType(field: ActivationField): ScalarType {
  return field === "callee" || field === "argument" ? "general" : "number";
}
export interface Span {
  readonly start: number;
  readonly end: number;
}
/** Optional debug provenance (see FunctionDebug): code copied by the inliner
 * names its innermost inline site. It never affects semantics. */
export interface DebugOrigin {
  readonly inline?: number | undefined;
}
/** Typed-array kinds with a native representation (./typed-arrays.ts). */
export type NativeTypedArray =
  | "Uint8Array"
  | "Int8Array"
  | "Uint8ClampedArray"
  | "Uint16Array"
  | "Int16Array"
  | "Float16Array"
  | "Uint32Array"
  | "Int32Array"
  | "Float32Array"
  | "Float64Array"
  | "BigInt64Array"
  | "BigUint64Array";
/** The Atomics operations on a native integer array (see `array-atomic`). */
export type ArrayAtomicOperation =
  | "load"
  | "store"
  | "add"
  | "sub"
  | "and"
  | "or"
  | "xor"
  | "exchange"
  | "compare-exchange";
/** Categories general-is tests. */
export type GeneralTest =
  | "undefined"
  | "number"
  | "boolean"
  | "string"
  | "null"
  | "nullish"
  | NativeTypedArray
  | "object"
  /** The miss result of property-load: no JavaScript value. */
  | "absent";
export type Instruction = Span &
  DebugOrigin &
  (
    | {
        /** Descriptor reflection returns a permanent exact address, or -1.
         * Only explicitly authorized native record bindings expose it. */
        readonly kind: "general-record-is" | "general-record-descriptor";
        readonly id: number;
        readonly value: number;
        readonly record: number;
      }
    | {
        /** Permanent code/signature address. Only explicit compiler bindings
         * expose environment-free targets; physical ABI equality is not identity. */
        readonly kind: "function-address";
        readonly id: number;
        readonly target: number;
        readonly part: "entry" | "signature";
      }
    | {
        /** Permanent descriptor address; no object or managed operand is read. */
        readonly kind: "record-descriptor-address";
        readonly id: number;
        readonly record: number;
      }
    | {
        readonly kind: "general-kind";
        readonly id: number;
        readonly value: number;
      }
    | {
        /** Whether a general value has a category, or (Uint8Array) is an
         * object whose header marks 1-byte typed array elements, as
         * general-value checks. A boolean test; never traps. */
        readonly kind: "general-is";
        readonly id: number;
        readonly value: number;
        readonly type: GeneralTest;
        /** Prefer a direct flags branch for a branch-only Script tag guard. */
        readonly branch?: true;
      }
    | {
        readonly kind: "general-equal";
        readonly id: number;
        readonly left: number;
        readonly right: number;
      }
    | { readonly kind: "general-none"; readonly id: number }
    | { readonly kind: "general-null"; readonly id: number }
    | {
        readonly kind: "general-wrap";
        readonly id: number;
        readonly value: number;
      }
    | {
        readonly kind: "general-value";
        readonly id: number;
        readonly value: number;
        /** Uint8Array: an object payload whose header marks 1-byte typed
         * array elements (checked; a narrowed `string | Uint8Array`). */
        readonly type:
          "number" | "boolean" | "string" | "reference" | NativeTypedArray;
        /** Read the number payload without testing the tag. The result is
         * meaningful only where a separate test proved the category; other
         * payloads yield arbitrary bits. Only for type number. */
        readonly unchecked?: true;
      }
    | {
        readonly kind: "record-has" | "record-read";
        readonly id: number;
        readonly object: number;
        readonly record: number;
        readonly field: number;
      }
    | {
        /** Field `field + index` of a non-null record whose fields
         * field..field+count-1 share one type (consecutive payload words):
         * one load at a computed offset. Traps unless `index` is an integer
         * in [0, count). */
        readonly kind: "record-slot-read";
        readonly id: number;
        readonly object: number;
        readonly record: number;
        readonly field: number;
        readonly count: number;
        readonly index: number;
      }
    | {
        /** A cached property value of a JavaScript object (js-runtime
         * property caches), or the absent value (which general-is "absent"
         * recognizes and no property holds) unless the general value
         * `object` is object-tagged and one of the site's `entries`
         * consecutive entries applies. Its payload is any record such a
         * value can hold; its first word is compared with each entry's
         * shape; no record but a `record` object has a shape in that word.
         * Entries start at field `siteField` of the `siteRecord` record
         * `site`. An own entry is two fields, the shape and the word index,
         * and its holder is the object. An inherited entry is three, the
         * shape, the word index and the holder (none for the object
         * itself, as a method site caches an object's own method); inherited entries apply
         * only while the site field after the last one equals field
         * `epochField` of the `epochRecord` object in the field after it.
         * That epoch advances with every structural change of an object
         * used as a prototype, and a receiver shape implies its prototype,
         * so the whole chain down to each holder (at any depth) is as it
         * was when the runtime stored the entries. The result is the
         * holder's general field whose word index is the raw binary64 bits
         * of the entry's word index. The runtime writes only indices of
         * fields `field..field+count-1` (consecutive general fields) with a
         * shape under which they hold the property's value. */
        readonly kind: "property-load";
        readonly id: number;
        readonly object: number;
        readonly site: number;
        readonly record: number;
        readonly field: number;
        readonly count: number;
        readonly siteRecord: number;
        readonly siteField: number;
        readonly inherited: boolean;
        /** Entries at the site: 1 to 4. */
        readonly entries: number;
        readonly epochRecord: number;
        readonly epochField: number;
        /** Optional linked 16-slot PropertySpill layout for reading spilled own
         * properties past the in-place slots (negative raw-bit slot index). */
        readonly spillRecord?: number;
        readonly spillField?: number;
      }
    | {
        /** Store general `value` through a cached property store (js-runtime
         * property caches); the boolean result is false, with nothing
         * written, unless `object` is object-tagged with the shape in site
         * field `siteField`. The value then goes to the general field whose
         * word index is the raw bits of site field `siteField + 1` (one of
         * `field..field+count-1` of a `record` object). When site field
         * `siteField + 2` holds a transition shape, the store also requires
         * site field `siteField + 3` to equal field `epochField` of the
         * `epochRecord` object in site field `siteField + 4`, and sets the
         * object's first word (its shape) to the transition. */
        readonly kind: "property-store";
        readonly id: number;
        readonly object: number;
        readonly value: number;
        readonly site: number;
        readonly record: number;
        readonly field: number;
        readonly count: number;
        readonly siteRecord: number;
        readonly siteField: number;
        readonly entries?: number;
        readonly epochRecord: number;
        readonly epochField: number;
      }
    | {
        /** Resolve the native script entry closure of general `callee` for a
         * direct call (`construct: false`) or ordinary construction
         * (`construct: true`) in `realm`'s active execution context; returns
         * reference-none (0) when the callee must take the general path. */
        readonly kind: "script-entry";
        readonly id: number;
        readonly callee: number;
        readonly realm: number;
        readonly construct: boolean;
        readonly realmRecord: number;
        readonly agentField: number;
        readonly agentRecord: number;
        readonly activeField: number;
        readonly objectRecord: number;
        readonly registerCallField: number;
        readonly entryRecord: number;
        readonly invokeField: number;
        readonly contextField: number;
        readonly constructibleField: number;
        readonly contextRecord: number;
        readonly realmField: number;
        readonly scriptOrModuleField: number;
      }
    | {
        /** Read the cached global data property cell at `cache` when `start`
         * is the global scope itself (declarative and object are absent),
         * `cache.global === start.global`, `cache.lexicalEpoch ===
         * start.global.lexicalEpoch`, and `cache.objectEpoch ===
         * start.global.object.internalPropertyEpoch`; returns reference-none
         * (0) on miss. */
        readonly kind: "global-cell";
        readonly id: number;
        readonly scope: number;
        readonly cache: number;
        readonly scopeRecord: number;
        readonly declarativeField: number;
        readonly objectField: number;
        readonly globalField: number;
        readonly globalRecord: number;
        readonly lexicalEpochField: number;
        readonly globalObjectField: number;
        readonly globalObjectRecord: number;
        readonly propertyEpochField: number;
        readonly cacheRecord: number;
        readonly cacheGlobalField: number;
        readonly cacheLexicalEpochField: number;
        readonly cacheObjectEpochField: number;
        readonly cacheCellField: number;
      }
    | {
        /** A packed binary64 element of a JavaScript array (js-runtime
         * array elements), or the absent value (see property-load). It is
         * the element unless the general value `object` is object-tagged
         * with a `record` payload (its first word is the record's
         * descriptor) whose optional reference field `field` holds an
         * `elementsRecord` object, and `index` is an integer at least 0 and
         * below that object's number field `countField`. The element is
         * then entry `index` of its Float64Array field `storageField`, which
         * the runtime keeps at least `countField` long. */
        readonly kind: "element-load";
        readonly id: number;
        readonly object: number;
        readonly index: number;
        readonly record: number;
        readonly field: number;
        readonly elementsRecord: number;
        readonly countField: number;
        readonly storageField: number;
        readonly cachedStorage?: number;
        readonly cachedCount?: number;
      }
    | {
        /** Overwrite the packed binary64 element `index` (located as for
         * element-load) with the Number general value `value`; the boolean
         * result is false, with nothing written, when element-load would
         * miss or `value` is not a Number. */
        readonly kind: "element-store";
        readonly id: number;
        readonly object: number;
        readonly index: number;
        readonly value: number;
        readonly record: number;
        readonly field: number;
        readonly elementsRecord: number;
        readonly countField: number;
        readonly storageField: number;
        readonly cachedStorage?: number;
        readonly cachedCount?: number;
      }
    | {
        /** The Float64Array storage of a packed array exotic object (or none
         * when `object` is not a `record` object with a present `field`). */
        readonly kind: "element-storage";
        readonly id: number;
        readonly object: number;
        readonly record: number;
        readonly field: number;
        readonly elementsRecord: number;
        readonly countField: number;
        readonly storageField: number;
      }
    | {
        /** The packed binary64 element count of a packed array exotic object
         * (or 0 when `object` is not a `record` object with a present `field`). */
        readonly kind: "element-count";
        readonly id: number;
        readonly object: number;
        readonly record: number;
        readonly field: number;
        readonly elementsRecord: number;
        readonly countField: number;
        readonly storageField: number;
      }
    | {
        /** The mirrored `length` of a packed array exotic object (the Number
         * general value of `elementsRecord.lengthField`), or the absent value
         * when `object` is not a `record` object with a present `field`. */
        readonly kind: "element-length";
        readonly id: number;
        readonly object: number;
        readonly record: number;
        readonly field: number;
        readonly elementsRecord: number;
        readonly lengthField: number;
      }
    | {
        /** The packed general element `index` of an array exotic object
         * (`object` is a `record` whose `field` holds an `elementsRecord`
         * with `index` an exact integer below `countField`), decoded from
         * `tagsField` (Uint8Array), `refsField` (ReferenceVector), and
         * `numbersField` (Float64Array), or the absent value on any miss. */
        readonly kind: "general-element-load";
        readonly id: number;
        readonly object: number;
        readonly index: number;
        readonly record: number;
        readonly field: number;
        readonly elementsRecord: number;
        readonly countField: number;
        readonly tagsField: number;
        readonly refsField: number;
        readonly numbersField: number;
      }
    | {
        /** Overwrite the packed general element `index` (located as for
         * general-element-load) with general value `value`; the boolean
         * result is false, with nothing written, when general-element-load
         * would miss or when `value` is a Number and `index >= numbers.length`. */
        readonly kind: "general-element-store";
        readonly id: number;
        readonly object: number;
        readonly index: number;
        readonly value: number;
        readonly record: number;
        readonly field: number;
        readonly elementsRecord: number;
        readonly countField: number;
        readonly tagsField: number;
        readonly refsField: number;
        readonly numbersField: number;
      }
    | {
        /** Proven-in-bounds read from flat general element storage
         * (`tags`: Uint8Array, `refs`: ReferenceVector, `numbers`: Float64Array)
         * at integer `index`. */
        readonly kind: "general-slot-load";
        readonly id: number;
        readonly tags: number;
        readonly refs: number;
        readonly numbers: number;
        readonly index: number;
      }
    | {
        /** Proven-in-bounds write into flat general element storage. Returns
         * false, with nothing written, only when `value` is a Number and
         * `index >= numbers.length` so the caller can allocate `numbers` lazily. */
        readonly kind: "general-slot-store";
        readonly id: number;
        readonly tags: number;
        readonly refs: number;
        readonly numbers: number;
        readonly index: number;
        readonly value: number;
      }
    | { readonly kind: "boolean-none"; readonly id: number }
    | {
        readonly kind: "boolean-wrap" | "boolean-value" | "boolean-present";
        readonly id: number;
        readonly value: number;
      }
    | {
        /** Explicit bridge to the managed primitive-value runtime contract. */
        readonly kind: "primitive-wrap" | "primitive-reference";
        readonly id: number;
        readonly value: number;
      }
    | {
        /** Guard the function brand and read its optional managed environment. */
        readonly kind: "function-environment";
        readonly id: number;
        readonly callee: number;
      }
    | {
        readonly kind: "function-new";
        readonly id: number;
        readonly target: number;
        readonly environment?: number;
      }
    | {
        readonly kind: "call-indirect";
        /** A void call may consume just completion status from a matching
         * parameter ABI, even when the callee physically returns a value. */
        readonly discardResult?: boolean;
        readonly receiver?: number;
        readonly id: number | undefined;
        readonly target: number;
        readonly callee: number;
        readonly arguments: readonly number[];
        /** Actual JavaScript operands. The fixed header contains callee,
         * receiver, new.target and an optional already-materialized list. */
        readonly scriptArguments?: readonly number[];
        /** A proper tail call of a script entry: the block returns its
         * result at once, so the callee may replace the entry's frame. */
        readonly tail?: true;
      }
    | { readonly kind: "script-argument-count"; readonly id: number }
    | {
        /** Read an actual operand of the current script entry. Missing
         * operands return undefined. The caller owns the overflow roots. */
        readonly kind: "script-argument";
        readonly id: number;
        readonly index: number;
      }
    | {
        /** A field of the native activation chain: the records script
         * entries link into their frames while they run (see @tint/abi/host
         * nativeActivationTopOffset). `top` is the innermost record (0 when
         * none); for a record, `previous` is the next older one, `kind` is 1
         * for an entry called with actual operands (0 for one called with a
         * materialized list, which other bookkeeping covers), `callee` its
         * callee, `count` its actual operand count and `argument` actual
         * `index` (undefined from the count on). Records and their frames are
         * read only while their activations run. */
        readonly kind: "activation-read";
        readonly id: number;
        readonly field: ActivationField;
        readonly record?: number;
        readonly index?: number;
      }
    | { readonly kind: "closure-environment"; readonly id: number }
    | { readonly kind: "string-none"; readonly id: number }
    | {
        readonly kind: "string-wrap" | "string-value" | "string-present";
        readonly id: number;
        readonly value: number;
      }
    | { readonly kind: "reference-none"; readonly id: number }
    | {
        /** The same word viewed as the other managed single-word type:
         * string-reference turns an optional string into an optional
         * reference, reference-string the reverse. Only private list storage
         * (direct string vectors) uses them; the word is never dereferenced
         * as the other type. */
        readonly kind: "string-reference" | "reference-string";
        readonly id: number;
        readonly value: number;
      }
    | {
        readonly kind: "reference-wrap";
        readonly id: number;
        readonly value: number;
      }
    | {
        readonly kind: "reference-value";
        readonly id: number;
        readonly value: number;
        readonly type?: "reference" | NativeTypedArray;
      }
    | {
        readonly kind: "string-literal";
        readonly id: number;
        readonly value: string;
      }
    | {
        readonly kind: "string-length";
        readonly id: number;
        readonly string: number;
      }
    /** Whether the string stores two bytes per code unit: strings are
     * canonical, so this is whether some unit is above 0xFF. Builders
     * choose their result's kind from their parts'. */
    | {
        readonly kind: "string-two-byte";
        readonly id: number;
        readonly string: number;
      }
    | {
        readonly kind: "string-code-unit";
        readonly id: number;
        readonly string: number;
        readonly index: number;
        /** Proven by the optimizer (selectArrayAccesses) to index a unit of
         * the string: the index is a non-negative integer below its length,
         * so the result is an integer in [0, 65535], never NaN. */
        readonly inBounds?: boolean;
        /** Known by the optimizer (versionStringLoops) to read a flat
         * string of this kind, so no kind dispatch is needed. */
        readonly unitKind?: "one-byte" | "two-byte";
      }
    | {
        readonly kind: "string-starts-with";
        readonly id: number;
        readonly string: number;
        readonly search: number;
        readonly position: number;
      }
    | {
        readonly kind: "string-slice";
        readonly id: number;
        readonly string: number;
        readonly begin: number;
        readonly limit: number;
      }
    /** Latin-1 and ASCII bulk primitives (docs/design-one-byte-strings.md),
     * bound to foundation functions whose portable bodies define the same
     * results. Indices are integers in range (0 <= begin <= limit <= length,
     * offset + limit - begin <= bytes.length); anything else is a binding
     * invariant failure and traps.
     *
     * string-from-latin1: the one-byte string of bytes [begin, limit). */
    | {
        readonly kind: "string-from-latin1";
        readonly id: number;
        readonly bytes: number;
        readonly begin: number;
        readonly limit: number;
      }
    /** Copies code units [begin, limit) of `string` into `bytes` at `offset`,
     * one byte each: limit - begin when every unit is at most 0xFF, else -1
     * (bytes may be partly written). */
    | {
        readonly kind: "string-copy-latin1";
        readonly id: number;
        readonly string: number;
        readonly begin: number;
        readonly limit: number;
        readonly bytes: number;
        readonly offset: number;
      }
    /** The first index in [begin, limit) whose code unit (string-ascii-prefix)
     * or byte (bytes-ascii-prefix) is 0x80 or more, else limit. */
    | {
        readonly kind: "string-ascii-prefix";
        readonly id: number;
        readonly string: number;
        readonly begin: number;
        readonly limit: number;
      }
    /** UTF-8 bulk primitives (foundation's text/utf8.ts, bound like the
     * Latin-1 ones, with the same index contract). A surrogate pair inside
     * [begin, limit) is one scalar; a lone surrogate encodes as U+FFFD.
     *
     * string-utf8-length: the UTF-8 byte length of units [begin, limit). */
    | {
        readonly kind: "string-utf8-length";
        readonly id: number;
        readonly string: number;
        readonly begin: number;
        readonly limit: number;
      }
    /** Encodes units [begin, limit) of `string` as UTF-8 into `bytes` from
     * `offset` (offset <= bytes.length), scalar by scalar while the next
     * one fits, and yields the index after the last unit encoded (limit
     * when everything fit), or with `written` the number of bytes written. */
    | {
        readonly kind: "string-write-utf8";
        readonly id: number;
        readonly string: number;
        readonly begin: number;
        readonly limit: number;
        readonly bytes: number;
        readonly offset: number;
        readonly written?: true;
      }
    /** The string decoded from the longest prefix of bytes [begin, limit)
     * that is a sequence of complete, valid UTF-8 encodings of scalars;
     * with `whole`, that string only when the prefix is the whole range,
     * otherwise the empty string (which a nonempty valid range never
     * decodes to). */
    | {
        readonly kind: "string-from-utf8";
        readonly id: number;
        readonly bytes: number;
        readonly begin: number;
        readonly limit: number;
        readonly whole?: true;
      }
    /** The number-string cache (numberStringCached, cacheNumberString;
     * nativeNumberStringCacheWord): the string cached for `value` by its
     * exact bits, or the empty string, which no number converts to. */
    | {
        readonly kind: "number-string-cached";
        readonly id: number;
        readonly value: number;
      }
    /** Caches `string` as `value`'s string, allocating the table when the
     * runtime has none (since the last collection). */
    | {
        readonly kind: "number-string-cache";
        readonly value: number;
        readonly string: number;
      }
    /** The array index `string` is the canonical decimal of, as cached in
     * its index field (nativeStringIndexFieldOffset), or -1 when none is
     * cached. */
    | {
        readonly kind: "string-index-cached";
        readonly id: number;
        readonly string: number;
      }
    /** Caches `value`, an array index below nativeStringIndexLimit whose
     * canonical decimal `string` is, in its index field: a relaxed 32-bit
     * store, only when the field is still unset. */
    | {
        readonly kind: "string-index-cache";
        readonly string: number;
        readonly value: number;
      }
    /** The string-split cache (nativeStringSplitCacheWord): the cached
     * immutable snapshot list matching `(string, separator)` with the same
     * record header as `template`, or none (0). */
    | {
        readonly kind: "string-split-cached";
        readonly id: number;
        readonly string: number;
        readonly separator: number;
        readonly template: number;
      }
    /** Caches `value` (an immutable snapshot list) for `(string, separator)`,
     * allocating the table when the runtime has none since the last GC. */
    | {
        readonly kind: "string-split-cache";
        readonly string: number;
        readonly separator: number;
        readonly value: number;
      }
    /** `string` with each ASCII letter mapped to upper case (`upper`) or
     * lower case, every other unit unchanged: a new string of the same
     * length and kind (asciiUppercase and asciiLowercase). */
    | {
        readonly kind: "string-ascii-case";
        readonly id: number;
        readonly string: number;
        readonly upper: boolean;
      }
    /** 1 when `string` is flat (owns its units: nativeStringIsFlat), else
     * 0 (a slice). */
    | {
        readonly kind: "string-flat";
        readonly id: number;
        readonly string: number;
      }
    /** Writes a flat image of `string` (its flat header, length and units,
     * zero-padded: a position-independent, pointer-free string object, as
     * nativeFlatStringExtent sizes it) at the start of the caller-owned raw
     * writable window [address, address + byteLength), and yields its byte
     * extent; a slice's units are copied from its parent. Yields -1 without
     * writing when the window is too small or its bounds are not exact
     * integers with a nonzero 8-byte-aligned address and an end below
     * 2^53. */
    | {
        readonly kind: "string-flatten-into";
        readonly id: number;
        readonly address: number;
        readonly byteLength: number;
        readonly string: number;
      }
    | {
        readonly kind: "bytes-ascii-prefix";
        readonly id: number;
        readonly bytes: number;
        readonly begin: number;
        readonly limit: number;
      }
    /** The first index k >= `position` (with `reverse`, the last k <=
     * `position`) at which `search` occurs in `string`, or -1: indexOf,
     * lastIndexOf and includes. `position` is an integer in [0, length],
     * which the caller has clamped. */
    | {
        readonly kind: "string-index-of";
        readonly id: number;
        readonly string: number;
        readonly search: number;
        readonly position: number;
        readonly reverse: boolean;
      }
    | {
        readonly kind: "string-from-code-units";
        readonly id: number;
        readonly values: readonly number[];
      }
    | {
        readonly kind: "string-concat";
        readonly id: number;
        readonly left: number;
        readonly right: number;
      }
    /** A fresh string of `length` code units whose contents are undefined until
     * `string-write` fills every unit. Only builders that write all units before
     * any other use (Array.prototype.join) may produce it. `twoByte` (a
     * boolean) is whether any part written is two-byte (string-two-byte):
     * the result's canonical kind. A loop string builder (build-loop-strings)
     * also uses one as a buffer with spare capacity: it is never observable,
     * its unwritten tail is only copied into a larger buffer, and values
     * leave it only through string-slice of its written prefix, which
     * holds a unit above 0xFF whenever the buffer is two-byte. */
    | {
        readonly kind: "string-allocate";
        readonly id: number;
        readonly length: number;
        readonly twoByte: number;
      }
    /** Copy every code unit of `source` into the fresh `target` at `offset`. */
    | {
        readonly kind: "string-write";
        readonly target: number;
        readonly offset: number;
        readonly source: number;
      }
    | {
        readonly kind: "record-new";
        readonly id: number;
        readonly record: number;
        readonly arguments: readonly (number | undefined)[];
        readonly presence?: readonly (number | undefined)[];
      }
    | {
        readonly kind: "constant";
        readonly id: number;
        readonly value: number | boolean;
      }
    | {
        readonly kind: "error-new";
        readonly error: NativeErrorKind;
        readonly id: number;
        readonly message: number;
      }
    | {
        readonly kind: "error-is";
        readonly error: NativeErrorKind;
        readonly id: number;
        readonly value: number;
      }
    | {
        readonly kind: "error-message";
        readonly id: number;
        readonly value: number;
      }
    | {
        readonly kind: "host-call";
        readonly operation: HostOperation;
        /** Void host operations have no SSA result. */
        readonly id: number | undefined;
        readonly arguments: readonly number[];
      }
    | {
        /** Leaf call of an imported C function (docs/native-ffi.md): not a
         * safepoint, never allocates, throws or re-enters managed code; it
         * may read and write memory reachable from its byte operands.
         * Void and record-result calls have no SSA result. */
        readonly kind: "c-call";
        readonly call: ForeignCall;
        readonly id: number | undefined;
        readonly arguments: readonly number[];
      }
    | {
        /** A C memory access through a Uint8Array's data pointer
         * (docs/native-ffi.md): a constant-offset field load or store, an
         * external view's address, or the adoption of external memory into
         * an empty array. Like a leaf c-call it is not a safepoint and
         * never allocates, throws or re-enters managed code. Stores have no
         * SSA result. */
        readonly kind: "c-memory";
        readonly access: ForeignMemoryAccess;
        readonly id: number | undefined;
        readonly arguments: readonly number[];
      }
    | {
        readonly kind: "array-subarray";
        readonly id: number;
        readonly array: number;
        readonly begin: number;
        readonly length: number;
      }
    | {
        /** A view of `type` over typed ArrayBuffer `buffer` (an owning or
         * borrowed array): `length` elements from `byteOffset`. Traps
         * unless both are integers, `byteOffset` is a multiple of the
         * element width and the view lies within the buffer's bytes. */
        readonly kind: "array-view";
        readonly id: number;
        readonly type: NativeTypedArray;
        readonly buffer: number;
        readonly byteOffset: number;
        readonly length: number;
      }
    | {
        /** The byte length of typed ArrayBuffer `buffer`, whose element
         * width its header records. */
        readonly kind: "array-buffer-byte-length";
        readonly id: number;
        readonly buffer: number;
      }
    | {
        /** An Atomics operation on element `index` of a native integer
         * array (Uint8Array, Uint16Array or Uint32Array), sequentially
         * consistent. `operands` are numbers, converted as an element write
         * converts its value: none for "load"; the value for "store",
         * "exchange" and the read-modify-write operations; the expected
         * and replacement values for "compare-exchange", which writes the
         * replacement only when the element equals the converted expected
         * value. Every operation but "store" (which has no result) yields
         * the element's previous value. Traps unless `index` is an integer
         * below the array's length. */
        readonly kind: "array-atomic";
        readonly operation: ArrayAtomicOperation;
        readonly id: number | undefined;
        readonly array: number;
        readonly index: number;
        readonly operands: readonly number[];
      }
    | {
        /** Tear-free 64-bit element read from a BigInt64Array or BigUint64Array.
         * When `index` is a valid uint32 below `array.length`, loads the 64-bit
         * element with one 64-bit access, writes its little-endian halves to
         * `scratch[0..1]` (a Uint32Array of length >= 2), and yields true;
         * otherwise yields false without touching `scratch`. */
        readonly kind: "array-word64-read";
        readonly id: number;
        readonly array: number;
        readonly index: number;
        readonly scratch: number;
      }
    | {
        /** Tear-free 64-bit element write to a BigInt64Array or BigUint64Array.
         * When `index` is a valid uint32 below `array.length`, loads the 64-bit
         * word from `scratch[0..1]` and stores it with one 64-bit access. */
        readonly kind: "array-word64-write";
        readonly array: number;
        readonly index: number;
        readonly scratch: number;
      }
    | {
        /** Fill elements `[from, to)` of a BigInt64Array or BigUint64Array with
         * the 64-bit word stored in `scratch[0..1]`. */
        readonly kind: "array-word64-fill";
        readonly array: number;
        readonly scratch: number;
        readonly from: number;
        readonly to: number;
      }
    | {
        /** Sequentially consistent 64-bit Atomics operation on element `index`
         * of a BigInt64Array or BigUint64Array. Operand 0 sits in `scratch[0..1]`
         * (expected for compare-exchange); operand 1 (replacement for
         * compare-exchange) sits in `scratch[2..3]`. Every operation except
         * "store" writes the observed 64-bit value back into `scratch[0..1]`.
         * Traps unless `index` is an integer below `array.length`. */
        readonly kind: "array-atomic-word64";
        readonly operation: ArrayAtomicOperation;
        readonly array: number;
        readonly index: number;
        readonly scratch: number;
      }
    | {
        /** Trusted opaque cell: general handles must never be viewed as records. */
        readonly kind: "weak-slot-new";
        readonly id: number;
        readonly key: number;
        readonly value: number;
        readonly ephemeron: number;
      }
    | {
        readonly kind: "weak-slot-key" | "weak-slot-value";
        readonly id: number;
        readonly cell: number;
      }
    | {
        readonly kind: "weak-slot-set-value";
        readonly cell: number;
        readonly value: number;
      }
    | {
        readonly kind: "weak-slot-clear";
        readonly cell: number;
      }
    | {
        readonly kind: "reference-vector-new";
        readonly id: number;
        readonly length: number;
      }
    | {
        readonly kind: "reference-vector-length" | "reference-vector-is";
        readonly id: number;
        readonly vector: number;
      }
    | {
        readonly kind: "reference-vector-read";
        readonly id: number;
        readonly vector: number;
        readonly index: number;
      }
    | {
        readonly kind: "reference-vector-write";
        readonly vector: number;
        readonly index: number;
        readonly value: number;
      }
    | {
        /** Copies elements 0..count-1 of `source` into `target`, trapping
         * unless `count` is an integer within both lengths. With `rebase`,
         * an element that is `source` itself is stored as `target`. */
        readonly kind: "reference-vector-copy";
        readonly source: number;
        readonly target: number;
        readonly count: number;
        readonly rebase: boolean;
      }
    | {
        readonly kind: "array-new";
        readonly id: number;
        readonly type: NativeTypedArray;
        readonly length: number;
      }
    | {
        readonly kind:
          | "array-length"
          | "array-buffer"
          | "array-byte-offset"
          | "array-byte-length";
        readonly id: number;
        readonly array: number;
      }
    | {
        readonly kind: "array-valid" | "array-read";
        readonly id: number;
        readonly array: number;
        readonly index: number;
      }
    | {
        /** The read selected when the index is proven an integer within the
         * array's fixed length: no check, and the element as a number
         * rather than an optional. */
        readonly kind: "array-element";
        readonly id: number;
        readonly array: number;
        readonly index: number;
      }
    | {
        /** Same element encoding only. Returns false without mutation for an invalid
         * integer offset or range; otherwise copies the complete source, overlapping safely. */
        readonly kind: "array-copy";
        readonly id: number;
        readonly array: number;
        readonly source: number;
        readonly offset: number;
      }
    | {
        readonly kind: "array-write";
        readonly array: number;
        readonly index: number;
        readonly value: number;
      }
    | {
        /** Stores `value`, converted once to the element encoding, into
         * elements [from, to) of `array`. from and to are integers in
         * [0, length]; to <= from fills nothing. */
        readonly kind: "array-fill";
        readonly array: number;
        readonly value: number;
        readonly from: number;
        readonly to: number;
      }
    | {
        /** The write selected for a proven in-bounds integer index (no check). */
        readonly kind: "array-store";
        readonly array: number;
        readonly index: number;
        readonly value: number;
      }
    | { readonly kind: "undefined"; readonly id: number }
    | {
        readonly kind: "optional-wrap" | "optional-present" | "optional-value";
        readonly id: number;
        readonly value: number;
      }
    | {
        /** The optional's number when present, otherwise the fallback number
         * (`value ?? fallback` without a branch). */
        readonly kind: "optional-value-or";
        readonly id: number;
        readonly value: number;
        readonly fallback: number;
      }
    | { readonly kind: "load"; readonly id: number; readonly slot: number }
    | { readonly kind: "store"; readonly slot: number; readonly value: number }
    | {
        readonly kind: "unary";
        readonly id: number;
        readonly operator: string;
        readonly operand: number;
      }
    | {
        readonly kind: "binary";
        readonly id: number;
        readonly operator: string;
        readonly left: number;
        readonly right: number;
      }
    | {
        readonly kind: "call";
        readonly receiver?: number;
        readonly id: number | undefined;
        readonly target: number;
        readonly environment?: "inherit";
        readonly arguments: readonly number[];
      }
  );
export type Terminator = Span &
  DebugOrigin &
  (
    | {
        readonly kind: "record";
        readonly object: number;
        readonly record: number;
        readonly field: number;
        /** `delete` stores the transfer slot (the field's absent value) and
         * clears the presence byte of an optional field. */
        readonly operation: "read" | "write" | "delete";
        readonly slot: number;
        readonly consequent: number;
        readonly alternate: number;
      }
    | {
        readonly kind: "record-cell";
        readonly object: number;
        readonly record: number;
        readonly field: number;
        readonly operation: "initialize" | "read" | "write";
        readonly slot: number;
        readonly consequent: number;
        readonly alternate: number;
        /** Reads and writes proven to follow a successful access to the
         * same cell (see proveCellStates): no state test is needed. */
        readonly initialized?: true;
      }
    | { readonly kind: "trap" }
    | { readonly kind: "throw-literal"; readonly value: string }
    | { readonly kind: "throw"; readonly value: number }
    | { readonly kind: "jump"; readonly target: number }
    | {
        readonly kind: "cell";
        readonly cell: number;
        readonly operation: "initialize" | "read" | "write";
        readonly slot: number;
        readonly consequent: number;
        readonly alternate: number;
      }
    | {
        readonly kind: "branch";
        readonly condition: number;
        readonly consequent: number;
        readonly alternate: number;
      }
    | { readonly kind: "return"; readonly value: number | undefined }
  );
export interface Block {
  readonly id: number;
  readonly instructions: readonly Instruction[];
  readonly terminator: Terminator;
  /** Thrown general values are copied to slot before entering target. */
  readonly exception?: { readonly target: number; readonly slot: number };
}
export interface EnvironmentCell {
  readonly type: ScalarType;
  readonly borrowed?: true;
  readonly stateOffset: number;
  readonly valueOffset: number;
  readonly mutable: boolean;
}
export interface Environment {
  readonly byteLength: number;
  readonly cells: readonly EnvironmentCell[];
}
export interface FunctionIR {
  /** Native JavaScript entry with a fixed call header and variadic actual
   * operands. The count is supplied by the call site. */
  readonly scriptEntry?: true | undefined;
  /** Opaque managed-code import: ABI only, no executable body or environment.
   * It obeys managed layout/lifetime contracts; raw native FFI remains a host
   * operation. Linker authority is required before emitting calls to it. */
  readonly import?: true;
  /** Entry-initialized general receiver storage; distinct from positional parameters. */
  readonly receiverSlot?: number;
  /** Managed environment record descriptor; mutually exclusive with borrowed environment cells. */
  readonly closureEnvironment?: number;
  readonly environment?: Environment;
  readonly id: number;
  readonly name: string;
  readonly exported: boolean;
  readonly parameters: readonly number[];
  readonly slots: readonly ScalarType[];
  /** Optimization facts: number slots (ascending) whose every write stores
   * a 32-bit integer (signed or unsigned), so they may be held as integers.
   * A pass that adds a write to a slot must drop or re-prove its entry; slot
   * renumbering must remap the list. */
  readonly integerSlots?: readonly number[];
  /** Optimization facts: number slots (ascending, none of them integer
   * slots) whose every write stores a safe integer other than -0, of
   * magnitude at most the slot's safeIntegerBounds entry, so they may be
   * held as int64s. The same pass rules as for integerSlots apply. */
  readonly safeIntegerSlots?: readonly number[];
  /** The magnitude bound (at most 2^53 - 1) of each safeIntegerSlots entry,
   * entry for entry. */
  readonly safeIntegerBounds?: readonly number[];
  /** Optimization facts: number slots (ascending) whose every write stores
   * an integer other than 0 and -0, so remainders by their values never
   * divide by zero. The same pass rules as for integerSlots apply. */
  readonly nonzeroSlots?: readonly number[];
  readonly returnType: ReturnType;
  readonly entry: number;
  readonly blocks: readonly Block[];
  /** Source-debugging metadata, present only when requested. */
  readonly debug?: FunctionDebug;
}
/** A source parameter or local. Spans use the same source coordinates as
 * instructions. */
export interface SourceVariable {
  readonly name: string;
  /** The declaration. */
  readonly start: number;
  readonly end: number;
  readonly parameter: boolean;
  /** The record layout of a reference that statically holds one. */
  readonly record?: number;
  /** The inline site (FunctionDebug.inlineSites) of an inlined callee's variable. */
  readonly inline?: number;
}
/** The slot holds the variable wherever the slot is live. */
export interface SlotBinding {
  readonly slot: number;
  readonly variable: number;
}
/** After a store to the variable was removed, the variable holds SSA `value`
 * from just after the instruction defining `after` (-1: the value's own
 * definition) until the value's last use or the variable's next binding. */
export interface ValueBinding {
  readonly variable: number;
  readonly value: number;
  readonly after: number;
}
/** A call whose callee body was copied into this function. */
export interface InlineSite {
  /** The callee's FunctionIR name. */
  readonly callee: string;
  /** The call expression. */
  readonly start: number;
  readonly end: number;
  /** The enclosing inline site, when the call itself was inlined code. */
  readonly parent?: number;
}
/** Debug-only metadata: it never affects semantics or emitted code. Passes
 * may drop bindings. Variables and inline sites are append-only; a pass
 * renumbering slots or values remaps or drops their bindings, and one
 * copying code between functions remaps everything it copies. */
export interface FunctionDebug {
  readonly variables: readonly SourceVariable[];
  readonly slots: readonly SlotBinding[];
  readonly values: readonly ValueBinding[];
  readonly inlineSites: readonly InlineSite[];
}
export interface RecordField {
  /** Cell initialization byte; guarded record-cell access is required. */
  readonly stateOffset?: number;
  readonly presenceOffset?: number;
  /** Zero-filled when construction omits it, with no state byte: the
   * producer proves a write precedes every read (class instance fields
   * assigned during construction). */
  readonly deferred?: boolean;
  readonly offset: number;
  readonly type: ScalarType;
  readonly mutable: boolean;
}
export interface RecordLayout {
  readonly byteLength: number;
  readonly fields: readonly RecordField[];
  /** Source-debugging names, present only when requested. */
  readonly debug?: RecordDebugInfo;
}
export interface RecordDebugInfo {
  readonly name: string;
  /** Field names by field index. */
  readonly fields: readonly string[];
}
/** A source of function bodies keyed by the module's dense function IDs.
 * When supplied alongside a module, its functions need only contain headers. */
export interface FunctionBodySource {
  readonly get: (id: number) => FunctionIR;
  readonly release: (id: number) => void;
}
/** Keep the ABI and slot layout while the instructions and debug data are
 * owned by a body source. */
export function functionHeader(fn: FunctionIR): FunctionIR {
  let header: FunctionIR = {
    id: fn.id,
    name: fn.name,
    exported: fn.exported,
    parameters: fn.parameters,
    slots: fn.slots,
    returnType: fn.returnType,
    entry: fn.entry,
    blocks: [],
  };
  if (fn.import !== undefined) header = { ...header, import: fn.import };
  if (fn.scriptEntry !== undefined)
    header = { ...header, scriptEntry: fn.scriptEntry };
  const receiverSlot = fn.receiverSlot,
    closureEnvironment = fn.closureEnvironment,
    environment = fn.environment;
  if (receiverSlot !== undefined) header = { ...header, receiverSlot };
  if (closureEnvironment !== undefined)
    header = { ...header, closureEnvironment };
  if (environment !== undefined) header = { ...header, environment };
  return header;
}

export interface ModuleIR {
  readonly records?: readonly RecordLayout[];
  readonly functions: readonly FunctionIR[];
}
export interface Diagnostic {
  readonly code: "GRAPH" | "TYPE" | "VALUE" | "INITIALIZATION";
  readonly function: number;
  readonly block: number | undefined;
  readonly instruction: number | undefined;
  readonly message: string;
}
export type Verification =
  { readonly ok: true } | { readonly ok: false; readonly error: Diagnostic };
