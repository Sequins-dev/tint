/** Format-neutral call-frame description of generated code.
 *
 * Registers are the target's DWARF register numbers. Image writers encode
 * these rules (Mach-O compact unwind with `__eh_frame` fallbacks; ELF
 * `.eh_frame`) so debuggers, profilers and crash reporters can unwind through
 * generated code. A rule describes a function body after its prologue, as the
 * platform's own compilers do; explicit rows describe code whose frame changes
 * shape. */
export interface UnwindSave {
  readonly register: number;
  /** Byte offset of the saved value from the canonical frame address (CFA). */
  readonly offset: number;
}
export interface UnwindRow {
  /** Code offset, relative to the range start, where this row takes effect. */
  readonly offset: number;
  readonly cfaRegister: number;
  readonly cfaOffset: number;
  readonly saves: readonly UnwindSave[];
}
export type UnwindRule =
  /** The return address stays in the link register; the stack pointer and
   * frame registers are never changed. */
  | { readonly kind: "leaf" }
  /** A frame record at the frame pointer: CFA = fp + 16, the caller's frame
   * pointer at CFA - 16 and the return address at CFA - 8. `saves` lists any
   * other callee-saved registers. */
  | { readonly kind: "frame"; readonly saves: readonly UnwindSave[] }
  /** General rows in increasing offset order; the first starts at offset 0. */
  | { readonly kind: "rows"; readonly rows: readonly UnwindRow[] }
  /** The outermost frame (a process entry such as ELF `_start`): the return
   * address is undefined, which tells unwinders the chain ends here (CFA =
   * the stack pointer). */
  | { readonly kind: "outermost" };
export interface UnwindRange {
  /** Byte offset of the code range, relative to the code it describes. */
  readonly offset: number;
  readonly byteLength: number;
  readonly rule: UnwindRule;
}
