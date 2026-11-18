import type { CSignature, CType } from "./types.ts";
/** How a TypeScript value crosses into or out of C (docs/native-ffi.md):
 * - `number`: a C integer or float scalar (checked conversion), or a raw
 *   address (`Address<T>`: a C pointer as an exact 64-bit unsigned number);
 * - `boolean`: C bool;
 * - `string`: a NUL-terminated UTF-8 copy for the call (CString);
 * - `bytes`: a pointer to a Uint8Array's data, borrowed for a leaf call
 *   (Ptr<T>; a record pointee requires at least its size in bytes);
 * - `terminated-bytes`: as `bytes`, but the array must end in NUL
 *   (CStringBytes);
 * - `record`: a struct by value, as an object with the interface's fields;
 * - `callback`: a C function pointer to a TypeScript function
 *   (`Callback<(a: T) => R>`), entering Tint through a thunk;
 * - `void`: no value (results only). */
export type CValueForm =
  | "number"
  | "boolean"
  | "string"
  | "bytes"
  | "terminated-bytes"
  | "record"
  | "callback"
  | "void";
/** A callback parameter's C prototype (docs/native-ffi.md, "Callbacks"):
 * scalar, address and bool parameters and result, as numbers and
 * booleans in TypeScript; a `Ptr<R>` parameter arrives as a foreign view
 * of record R. */
export interface CCallbackDeclaration {
  readonly signature: CSignature;
  readonly parameterNames: readonly string[];
  readonly parameterForms: readonly CValueForm[];
  /** Per parameter: the record a `Ptr<R>` parameter views, else "". */
  readonly parameterRecords: readonly string[];
  readonly resultForm: CValueForm;
}
export interface CFunctionDeclaration {
  /** The exported TypeScript name; `symbol` is the C symbol it binds (a
   * `name$variant` declaration binds `name`). */
  readonly name: string;
  readonly symbol: string;
  readonly signature: CSignature;
  readonly parameterNames: readonly string[];
  readonly parameterForms: readonly CValueForm[];
  readonly resultForm: CValueForm;
  /** Per parameter: the prototype of a `callback` parameter. */
  readonly callbacks?: readonly (CCallbackDeclaration | undefined)[];
}
/** A named callback type (`type alloc_func = Callback<(...) => R>`):
 * TypeScript functions of this type can be registered for C to keep and
 * call during later may-callback calls (docs/native-ffi.md, "Callbacks"). */
export interface CCallbackTypeDeclaration {
  readonly name: string;
  readonly callback: CCallbackDeclaration;
}
/** An availability query (`(): Available<"name">`): whether the symbol of
 * declared function `name` is bound in the running process. An optional
 * library's imports are weak and read as zero when the library (or the
 * symbol) is absent; the query compiles to a load of the import slot and a
 * comparison with zero. */
export interface CAvailabilityDeclaration {
  readonly name: string;
  readonly symbol: string;
}
export interface CRecordDeclaration {
  readonly name: string;
  /** Always a `record` C type. */
  readonly type: CType;
}
/** An integer constant of a C header (`#define MAP_ANON 0x1000`), declared
 * `export const NAME: <literal>` or, when targets differ,
 * `ByTarget<{ "<target>": <literal>, ... }>`; resolved for one target. */
export interface CConstantDeclaration {
  readonly name: string;
  readonly value: number;
}
/** A `declare module "tint:c/<library>"` binding: the IDL for one C library.
 * `layouts` names the records with a declared `Layout<T>` constant. */
export interface CLibraryDeclaration {
  readonly module: string;
  readonly records: readonly CRecordDeclaration[];
  readonly functions: readonly CFunctionDeclaration[];
  readonly availability: readonly CAvailabilityDeclaration[];
  readonly layouts: readonly string[];
  readonly constants: readonly CConstantDeclaration[];
  readonly callbackTypes?: readonly CCallbackTypeDeclaration[] | undefined;
}
