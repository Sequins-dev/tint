/** The format-neutral description of a hosted executable that each target's
 * image writer (Mach-O today) lays out, links and, where its platform
 * requires, signs. Format-specific facts (deployment versions, signing
 * identity, library version words) travel in the writer's own options. */
import type {
  DebugGlobal,
  DebugType,
  FunctionRange,
  LineRange,
} from "./dwarf.ts";
import type {
  CodePlan,
  ImageAddressReference,
  ImageAddressPatcher,
} from "@tint/abi/relocation";
import type { UnwindRange } from "@tint/abi/unwind";

export interface ImageSymbol {
  readonly name: string;
  /** Byte offset in the supplied code (or data), before image placement. */
  readonly offset: number;
}
/** C strings, or other read-only data. */
export type ReadOnlySectionKind = "cstring" | "rodata";
/** A read-only section carved from the tail of the supplied code, after the
 * instructions. Sections are contiguous, in order, and end with the code. */
export interface ReadOnlySection {
  readonly kind: ReadOnlySectionKind;
  /** Byte offset in the supplied code. */
  readonly offset: number;
  readonly byteLength: number;
}
/** A shared library beyond the target's system C library, with the imports
 * it binds. `weak`: absent imports bind as 0 instead of failing the launch. */
export interface ImageLibrary {
  /** Darwin install name or Linux soname. */
  readonly name: string;
  /** Load the library optionally (every binding using it is optional). */
  readonly weak: boolean;
  readonly symbols: readonly string[];
  /** Symbols imported weakly although the library itself is required:
   * those an optional binding declares when a required binding loads the
   * same image (Mach-O binds a missing weak import as 0). */
  readonly weakSymbols?: readonly string[] | undefined;
}
export interface ImageDebugInfo {
  readonly directory: string;
  readonly functions: readonly FunctionRange[];
  readonly lines: readonly LineRange[];
  readonly types?: readonly DebugType[] | undefined;
  readonly origins?: readonly string[] | undefined;
  readonly globals?: readonly DebugGlobal[] | undefined;
}
/** A statically defined tracing (USDT) probe: a `nop` at `offset` in the
 * supplied code that tracers (perf, bpftrace, GDB) find through the image's
 * probe notes. ELF images only. */
export interface ImageProbe {
  readonly provider: string;
  readonly name: string;
  readonly offset: number;
  /** SystemTap argument specification, e.g. `8@x0 8@x1`. */
  readonly arguments: string;
}
export interface ExecutableImageRequest {
  /** Development-only permission for a debugger to attach; independent of
   * debug information. */
  readonly allowDebugger?: boolean;
  /** Explicit permission for a runtime that publishes native code. */
  readonly allowJit?: boolean;
  readonly debug?: ImageDebugInfo | undefined;
  readonly symbols?: readonly ImageSymbol[];
  /** Symbols naming offsets in `data`. */
  readonly dataSymbols?: readonly ImageSymbol[] | undefined;
  /** Read-only tail sections of `code` (see ReadOnlySection). */
  readonly readOnlySections?: readonly ReadOnlySection[] | undefined;
  /** Call-frame rules of code ranges (code-relative, address order). */
  readonly unwind?: readonly UnwindRange[];
  /** Writable data, placed after the import slots. */
  readonly data?: Uint8Array | undefined;
  /** Imported symbols; those no `libraries` entry lists bind to the system
   * C library. */
  readonly imports?: readonly string[];
  /** Libraries beyond the system C library, in load order. */
  readonly libraries?: readonly ImageLibrary[];
  /** USDT probe sites (`.note.stapsdt`); only ELF images carry them. */
  readonly probes?: readonly ImageProbe[] | undefined;
  readonly addressFixups?: readonly ImageAddressReference[];
  readonly patchAddress?: ImageAddressPatcher;
  readonly code: Uint8Array;
  /** Deferred placement. When present, code must be empty. */
  readonly codePlan?: CodePlan | undefined;
  readonly entryOffset: number;
  /** A C ABI symbol exported from a loadable image. */
  readonly sharedEntry?: ImageSymbol | undefined;
  readonly maxByteLength: number;
}
