import { buildJitObject } from "@tint/image/darwin/macho/jit-object";
import { buildElfJitObject } from "@tint/image/linux/elf/jit-object";
import type { FunctionRange, LineRange } from "@tint/image/dwarf";
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";

/** Makes code published at runtime visible to debuggers and profilers (see
 * docs/runtime-diagnostics.md):
 *
 * - the GDB/LLDB JIT interface: each registration links an in-memory object
 *   (symbols and, when supplied, DWARF line rows at the code's live
 *   addresses; Mach-O on Darwin, ELF on Linux, the formats the platform's
 *   debuggers read) into `__jit_debug_descriptor` and calls
 *   `__jit_debug_register_code`, where an attached debugger stops briefly to
 *   load it. Without a debugger the call returns at once.
 * - a perf-style map, `/tmp/perf-<pid>.map`, with one
 *   `<start> <size> <name>` line (hexadecimal, no prefix) per function, read
 *   by sampling profilers such as samply and Linux perf.
 *
 * Registration is serialized by the owning engine, like publication. */
export interface JitDebuggerHost {
  /** The in-memory object format of the platform's debuggers: the image
   * target's object format (NativeTarget.objectFormat). */
  readonly objectFormat: "macho" | "elf";
  readonly architecture?: "aarch64" | "x86_64";
  /** Anonymous read/write mapping of byteLength bytes, or <= 0. */
  readonly map: (byteLength: number) => number;
  /** Copy bytes into [address, address + byteLength) at offset: 0 or -1. */
  readonly write: (
    address: number,
    byteLength: number,
    offset: number,
    bytes: Uint8Array,
  ) => number;
  readonly readWord: (
    address: number,
    byteLength: number,
    offset: number,
  ) => number;
  readonly writeWord: (
    address: number,
    byteLength: number,
    offset: number,
    value: number,
  ) => number;
  /** Address of the image's __jit_debug_descriptor. */
  readonly descriptor: () => number;
  /** Calls __jit_debug_register_code. */
  readonly notify: () => void;
}
export interface JitPerfMapHost {
  readonly processId: () => number;
  /** Create (exclusively) and open for writing; a descriptor, or < 0. */
  readonly create: (path: string) => number;
  /** Remove a stale file left by an earlier process with this ID. */
  readonly remove: (path: string) => number;
  readonly write: (descriptor: number, bytes: Uint8Array) => number;
}
export interface JitCodeFunction {
  readonly name: string;
  /** Byte offset in the published code. */
  readonly offset: number;
  readonly byteLength: number;
}
export interface JitCodeLine {
  readonly offset: number;
  readonly byteLength: number;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
export interface JitCodeDescription {
  readonly address: number;
  readonly code: Uint8Array;
  readonly functions: readonly JitCodeFunction[];
  readonly lines: readonly JitCodeLine[];
  /** DWARF compilation directory for relative file names. */
  readonly directory: string;
}
export interface JitDebugRegistrar {
  /** Returns the debugger entry's address (0 without a debugger host), or
   * -1 when the description or a host operation was rejected. */
  readonly register: (code: JitCodeDescription) => number;
  /** Unlinks a debugger entry before its code is replaced. */
  readonly unregister: (entry: number) => boolean;
  /** The perf map's path once created. */
  readonly perfMapPath: () => string | undefined;
}

const entryBytes = 32,
  descriptorBytes = 24,
  arenaBytes = 1048576,
  actionNone = 0,
  actionRegister = 1,
  actionUnregister = 2;
const hexDigits = "0123456789abcdef";
function hex(value: number): string {
  let text = "",
    rest = value;
  do {
    text = hexDigits.charAt(rest % 16) + text;
    rest = Math.floor(rest / 16);
  } while (rest > 0);
  return text;
}

export function createJitDebugRegistrar(hosts: {
  readonly debugger?: JitDebuggerHost | undefined;
  readonly perfMap?: JitPerfMapHost | undefined;
}): JitDebugRegistrar {
  const arena = { base: 0, used: 0, size: 0 };
  const perf: { descriptor: number; path: string | undefined } = {
    descriptor: -1,
    path: undefined,
  };
  function allocate(host: JitDebuggerHost, byteLength: number): number {
    const size = Math.ceil(byteLength / 16) * 16;
    if (arena.base <= 0 || size > arena.size - arena.used) {
      const mapped = Math.max(arenaBytes, Math.ceil(size / 16384) * 16384),
        base = host.map(mapped);
      if (base <= 0) return 0;
      arena.base = base;
      arena.size = mapped;
      arena.used = 0;
    }
    const address = arena.base + arena.used;
    arena.used += size;
    return address;
  }
  function setAction(host: JitDebuggerHost, action: number): boolean {
    // version 1 (low half) and the action flag (high half) share a word.
    return (
      host.writeWord(
        host.descriptor(),
        descriptorBytes,
        0,
        1 + action * 4294967296,
      ) === 0
    );
  }
  function link(host: JitDebuggerHost, code: JitCodeDescription): number {
    const functions: FunctionRange[] = [],
      lines: LineRange[] = [];
    for (const fn of code.functions) {
      if (fn === undefined) throw "JIT function invariant";
      functions.push({
        name: fn.name,
        offset: fn.offset,
        byteLength: fn.byteLength,
      });
    }
    for (const row of code.lines) {
      if (row === undefined) throw "JIT line invariant";
      lines.push({
        offset: row.offset,
        byteLength: row.byteLength,
        file: row.file,
        line: row.line,
        column: row.column,
      });
    }
    const request = {
      address: code.address,
      code: code.code,
      functions,
      lines,
      directory: code.directory,
      maxByteLength: 0x7fffffff,
    };
    const object =
      host.objectFormat === "elf"
        ? buildElfJitObject(request, host.architecture ?? "aarch64")
        : buildJitObject(request);
    if (!object.ok) return -1;
    const bytes = object.value,
      entry = allocate(host, entryBytes + bytes.length);
    if (entry <= 0) return -1;
    const descriptor = host.descriptor();
    const first = host.readWord(descriptor, descriptorBytes, 16);
    if (
      first < 0 ||
      host.write(entry, entryBytes + bytes.length, entryBytes, bytes) !== 0 ||
      host.writeWord(entry, entryBytes, 0, first) !== 0 ||
      host.writeWord(entry, entryBytes, 8, 0) !== 0 ||
      host.writeWord(entry, entryBytes, 16, entry + entryBytes) !== 0 ||
      host.writeWord(entry, entryBytes, 24, bytes.length) !== 0 ||
      (first !== 0 && host.writeWord(first, entryBytes, 8, entry) !== 0) ||
      host.writeWord(descriptor, descriptorBytes, 16, entry) !== 0 ||
      host.writeWord(descriptor, descriptorBytes, 8, entry) !== 0 ||
      !setAction(host, actionRegister)
    )
      return -1;
    host.notify();
    if (!setAction(host, actionNone)) return -1;
    return entry;
  }
  function appendPerfMap(
    host: JitPerfMapHost,
    code: JitCodeDescription,
  ): boolean {
    if (perf.descriptor < 0) {
      const path = "/tmp/perf-" + String(host.processId()) + ".map";
      let descriptor = host.create(path);
      if (descriptor < 0) {
        host.remove(path);
        descriptor = host.create(path);
      }
      if (descriptor < 0) return false;
      perf.descriptor = descriptor;
      perf.path = path;
    }
    let text = "";
    for (const fn of code.functions) {
      if (fn === undefined) throw "perf map function invariant";
      text +=
        hex(code.address + fn.offset) +
        " " +
        hex(fn.byteLength) +
        " " +
        fn.name +
        "\n";
    }
    const bytes = encodeUTF8(text);
    let offset = 0;
    while (offset < bytes.length) {
      const written = host.write(perf.descriptor, bytes.subarray(offset));
      if (written <= 0) return false;
      offset += written;
    }
    return true;
  }
  return {
    register: (code: JitCodeDescription): number => {
      const perfMap = hosts.perfMap;
      if (perfMap !== undefined && !appendPerfMap(perfMap, code)) return -1;
      const host = hosts.debugger;
      return host === undefined ? 0 : link(host, code);
    },
    unregister: (entry: number): boolean => {
      const host = hosts.debugger;
      if (host === undefined || entry <= 0) return false;
      const descriptor = host.descriptor(),
        next = host.readWord(entry, entryBytes, 0),
        previous = host.readWord(entry, entryBytes, 8);
      if (next < 0 || previous < 0) return false;
      if (
        (previous === 0
          ? host.writeWord(descriptor, descriptorBytes, 16, next)
          : host.writeWord(previous, entryBytes, 0, next)) !== 0 ||
        (next !== 0 && host.writeWord(next, entryBytes, 8, previous) !== 0) ||
        host.writeWord(descriptor, descriptorBytes, 8, entry) !== 0 ||
        !setAction(host, actionUnregister)
      )
        return false;
      host.notify();
      return setAction(host, actionNone);
    },
    perfMapPath: (): string | undefined => perf.path,
  };
}
