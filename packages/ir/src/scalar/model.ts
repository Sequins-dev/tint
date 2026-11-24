import type { HostOperation } from "./host.ts";
import type { ForeignCall, ForeignMemoryAccess } from "./foreign.ts";
export type NativeErrorKind = "Error" | "TypeError" | "RangeError";

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
  | "Uint8Array"
  | "Uint16Array"
  | "Uint32Array"
  | "Float64Array"
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
/** Categories general-is tests. */
export type NativeTypedArray =
  "Uint8Array" | "Uint16Array" | "Uint32Array" | "Float64Array";
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
        readonly type?:
          | "reference"
          | "Uint8Array"
          | "Uint16Array"
          | "Uint32Array"
          | "Float64Array";
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
    | {
        readonly kind: "string-code-unit";
        readonly id: number;
        readonly string: number;
        readonly index: number;
        /** Proven by the optimizer (selectArrayAccesses) to index a unit of
         * the string: the index is a non-negative integer below its length,
         * so the result is an integer in [0, 65535], never NaN. */
        readonly inBounds?: boolean;
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
     * any other use (Array.prototype.join) may produce it. */
    | {
        readonly kind: "string-allocate";
        readonly id: number;
        readonly length: number;
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
        readonly type:
          "Uint8Array" | "Uint16Array" | "Uint32Array" | "Float64Array";
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
        readonly operation: "read" | "write";
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
