import type { HostOperation } from "./host.ts";
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
export interface Span {
  readonly start: number;
  readonly end: number;
}
export type Instruction = Span &
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
        readonly type: "number" | "boolean" | "string" | "reference";
      }
    | {
        readonly kind: "record-has" | "record-read";
        readonly id: number;
        readonly object: number;
        readonly record: number;
        readonly field: number;
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
        readonly receiver?: number;
        readonly id: number | undefined;
        readonly target: number;
        readonly callee: number;
        readonly arguments: readonly number[];
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
        readonly error: "TypeError" | "RangeError";
        readonly id: number;
        readonly message: number;
      }
    | {
        readonly kind: "error-is";
        readonly error: "TypeError" | "RangeError";
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
