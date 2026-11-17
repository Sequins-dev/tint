/** A hand-assembled glibc program for the ELF writer's end-to-end tests:
 * `_start` hands `main` to `__libc_start_main`; `main` writes "hello\n" via
 * libc `write` (half from a read-only cstring tail section, half from the
 * writable data segment), calls an absent weak symbol only if it resolved to
 * non-zero, checks that glibc `backtrace` unwinds at least four frames from
 * main, and returns 42 (1 if the unwind fell short). */
import {
  encode,
  relativeAddress,
  type Instruction,
} from "@tint/codegen/aarch64/isa";
import { aarch64ImageRelocations } from "@tint/codegen/aarch64/image-relocations";
import type { AArch64AddressReference } from "@tint/codegen/aarch64/image-relocations";
import type { ElfExecutableRequest } from "@tint/image/linux/elf";

export const ABSENT_SYMBOL = "tint_elf_test_absent_symbol";
export const MAIN_OFFSET = 64;
const BACKTRACE_BUFFER = 8,
  BACKTRACE_DEPTH = 16;

export function helloRequest(): ElfExecutableRequest {
  const words: Instruction[] = [];
  const references: AArch64AddressReference[] = [];
  /** x16 = *slot of `name`, through a pc-relative placeholder patched by the writer. */
  const loadImport = (name: string): void => {
    const placeholder = relativeAddress(16, 17, 0);
    if (!placeholder.ok) throw new Error("placeholder");
    references.push({
      offset: words.length * 4,
      rd: 16,
      scratch: 17,
      target: { kind: "import", name },
    });
    words.push(...placeholder.value);
    words.push({ op: "ldr", width: 64, rt: 16, rn: 16, offset: 0 });
  };
  /** rd = address of `data` + offset. */
  const loadData = (rd: number, offset: number): void => {
    const placeholder = relativeAddress(rd, 17, 0);
    if (!placeholder.ok) throw new Error("placeholder");
    references.push({
      offset: words.length * 4,
      rd,
      scratch: 17,
      target: { kind: "data", offset },
    });
    words.push(...placeholder.value);
  };
  const movz = (rd: number, immediate: number): void => {
    words.push({ op: "movz", width: 64, rd, immediate, shift: 0 });
  };
  const move = (rd: number, rn: number | "sp"): void => {
    words.push({
      op: "add-imm",
      width: 64,
      rd,
      rn,
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
  };
  // _start: the kernel's initial stack is argc, argv..., with the loader's
  // finalizer in x0 (glibc sysdeps/aarch64/start.S).
  movz(29, 0);
  movz(30, 0);
  move(5, 0); // rtld_fini
  words.push({ op: "ldr", width: 64, rt: 1, rn: "sp", offset: 0 }); // argc
  words.push({
    op: "add-imm",
    width: 64,
    rd: 2,
    rn: "sp",
    immediate: 8,
    shift: 0,
    setFlags: false,
  }); // argv
  move(6, "sp"); // stack_end
  words.push({
    op: "adr",
    rd: 0,
    displacement: MAIN_OFFSET - words.length * 4,
  });
  movz(3, 0); // init
  movz(4, 0); // fini
  loadImport("__libc_start_main");
  words.push({ op: "blr", rn: 16 });
  words.push({ op: "brk", immediate: 1 });
  if (words.length * 4 !== MAIN_OFFSET) throw new Error("_start size");
  // main
  words.push({
    op: "stp",
    width: 64,
    rt: 29,
    rt2: 30,
    rn: "sp",
    offset: -16,
    mode: "pre",
  });
  move(29, "sp");
  movz(0, 1);
  const cstringAdr = words.length;
  words.push({ op: "adr", rd: 1, displacement: 0 }); // patched below
  movz(2, 3);
  loadImport("write");
  words.push({ op: "blr", rn: 16 });
  movz(0, 1);
  loadData(1, 0);
  movz(2, 3);
  loadImport("write");
  words.push({ op: "blr", rn: 16 });
  loadImport(ABSENT_SYMBOL);
  words.push({
    op: "cbz",
    width: 64,
    rt: 16,
    displacement: 8,
  });
  words.push({ op: "blr", rn: 16 });
  // glibc backtrace() unwinds through libgcc, which finds main's FDE through
  // PT_GNU_EH_FRAME's search table: backtrace, main, libc's caller frames.
  loadData(0, BACKTRACE_BUFFER);
  movz(1, BACKTRACE_DEPTH);
  loadImport("backtrace");
  words.push({ op: "blr", rn: 16 });
  words.push({
    op: "sub-imm",
    width: 64,
    rd: 9,
    rn: 0,
    immediate: 4,
    shift: 0,
    setFlags: true,
  });
  words.push({ op: "movz", width: 32, rd: 0, immediate: 42, shift: 0 });
  words.push({ op: "b.cond", condition: "ge", displacement: 8 });
  words.push({ op: "movz", width: 32, rd: 0, immediate: 1, shift: 0 });
  words.push({
    op: "ldp",
    width: 64,
    rt: 29,
    rt2: 30,
    rn: "sp",
    offset: 16,
    mode: "post",
  });
  words.push({ op: "ret", rn: 30 });
  const instructionEnd = words.length * 4;
  words[cstringAdr] = {
    op: "adr",
    rd: 1,
    displacement: instructionEnd - cstringAdr * 4,
  };
  const cstring = new TextEncoder().encode("hel\0");
  const code = new Uint8Array(instructionEnd + cstring.length);
  words.forEach((instruction, index) => {
    const encoded = encode(instruction);
    if (!encoded.ok) throw new Error(`encode ${instruction.op}`);
    new DataView(code.buffer).setUint32(index * 4, encoded.value, true);
  });
  code.set(cstring, instructionEnd);
  const data = new Uint8Array(BACKTRACE_BUFFER + BACKTRACE_DEPTH * 8);
  data.set(new TextEncoder().encode("lo\n"));
  return {
    code,
    entryOffset: 0,
    maxByteLength: 1 << 24,
    symbols: [
      { name: "_start", offset: 0 },
      { name: "main", offset: MAIN_OFFSET },
    ],
    data,
    dataSymbols: [
      { name: "greeting_tail", offset: 0 },
      { name: "backtrace_buffer", offset: BACKTRACE_BUFFER },
    ],
    textSections: [
      { kind: "cstring", offset: instructionEnd, byteLength: cstring.length },
    ],
    imports: ["__libc_start_main", "write", ABSENT_SYMBOL, "backtrace"],
    unwind: [
      {
        offset: MAIN_OFFSET,
        byteLength: instructionEnd - MAIN_OFFSET,
        rule: { kind: "frame", saves: [] },
      },
    ],
    debug: {
      directory: "/tint/test",
      functions: [
        { offset: 0, byteLength: MAIN_OFFSET, name: "_start" },
        {
          offset: MAIN_OFFSET,
          byteLength: instructionEnd - MAIN_OFFSET,
          name: "main",
        },
      ],
      lines: [
        {
          offset: 0,
          byteLength: MAIN_OFFSET,
          file: "hello.ts",
          line: 1,
          column: 1,
        },
        {
          offset: MAIN_OFFSET,
          byteLength: 8,
          file: "hello.ts",
          line: 3,
          column: 1,
        },
        {
          offset: MAIN_OFFSET + 8,
          byteLength: instructionEnd - MAIN_OFFSET - 8,
          file: "hello.ts",
          line: 4,
          column: 3,
        },
      ],
    },
    linux: { weakImports: [ABSENT_SYMBOL], identifier: "tint.elf.hello" },
    ...aarch64ImageRelocations(references),
  };
}
