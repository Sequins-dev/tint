import { buildDebugInfo, type FunctionRange, type LineRange } from "./dwarf.ts";

/** An in-memory object describing code published at runtime, for the
 * GDB/LLDB JIT interface (see docs/runtime-diagnostics.md). Each object
 * format's builder (Mach-O for Darwin's LLDB, ELF for GDB and LLDB on
 * Linux) places the code section at its live address, so a debugger loads
 * it in place; DWARF line rows use the same absolute addresses. The object
 * carries a copy of the code for debuggers that read section contents from
 * the object rather than the process. */
export interface JitObjectRequest {
  readonly address: number;
  readonly code: Uint8Array;
  readonly functions: readonly FunctionRange[];
  /** Source rows; DWARF sections are emitted only when present. */
  readonly lines: readonly LineRange[];
  /** DWARF compilation directory for relative file names. */
  readonly directory: string;
  readonly maxByteLength: number;
}
export type JitObjectResult =
  | { readonly ok: true; readonly value: Uint8Array }
  | {
      readonly ok: false;
      readonly error: "INVALID_INPUT" | "SIZE_LIMIT";
    };
/** The parts every format shares: UTF-8 function names and, when the
 * request has source rows, the DWARF abbreviation, info and line sections
 * (empty otherwise). */
export interface JitObjectParts {
  readonly names: readonly Uint8Array[];
  readonly abbrev: Uint8Array;
  readonly info: Uint8Array;
  readonly line: Uint8Array;
}
export type JitObjectPartsResult =
  | { readonly ok: true; readonly value: JitObjectParts }
  | {
      readonly ok: false;
      readonly error: "INVALID_INPUT" | "SIZE_LIMIT";
    };

/** Validates the request (an aligned positive address, nonempty code,
 * functions inside it with NUL-free names) and builds the shared parts. */
export function jitObjectParts(
  request: JitObjectRequest,
): JitObjectPartsResult {
  const code = request.code;
  if (
    !Number.isSafeInteger(request.address) ||
    request.address <= 0 ||
    request.address % 4 !== 0 ||
    code.length === 0 ||
    !Number.isSafeInteger(request.address + code.length)
  )
    return { ok: false, error: "INVALID_INPUT" };
  const encoder = new TextEncoder(),
    names: Uint8Array[] = [];
  for (const fn of request.functions) {
    if (
      fn === undefined ||
      !Number.isInteger(fn.offset) ||
      fn.offset < 0 ||
      fn.offset >= code.length ||
      fn.name.length === 0 ||
      fn.name.includes("\0")
    )
      return { ok: false, error: "INVALID_INPUT" };
    names.push(encoder.encode(fn.name));
  }
  if (request.lines.length === 0) {
    const empty = new Uint8Array(0);
    return {
      ok: true,
      value: { names, abbrev: empty, info: empty, line: empty },
    };
  }
  const debug = buildDebugInfo({
    codeAddress: request.address,
    codeLength: code.length,
    directory: request.directory,
    functions: request.functions,
    lines: request.lines,
    maxByteLength: request.maxByteLength,
  });
  if (!debug.ok) return { ok: false, error: debug.error };
  return {
    ok: true,
    value: {
      names,
      abbrev: debug.value.abbrev,
      info: debug.value.info,
      line: debug.value.line,
    },
  };
}
