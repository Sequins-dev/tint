import type {
  Condition,
  Gpr,
  IntegerWidth,
  Memory,
  Instruction,
  Xmm,
} from "@tint/codegen/x86_64/isa";

export function reg<W extends IntegerWidth>(width: W, index: number): Gpr<W> {
  return { kind: "gpr", width, index };
}
export function xmm(index: number): Xmm {
  return { kind: "xmm", index };
}
export function mem<W extends IntegerWidth | 128>(
  width: W,
  base?: number,
  disp = 0,
  index?: number,
  scale?: 1 | 2 | 4 | 8,
): Memory<W> {
  return {
    kind: "mem",
    width,
    address: { kind: "base", base, disp, index, scale },
  };
}

export const conditions: readonly Condition[] = [
  "o",
  "no",
  "b",
  "ae",
  "e",
  "ne",
  "be",
  "a",
  "s",
  "ns",
  "p",
  "np",
  "l",
  "ge",
  "le",
  "g",
];

const names: Record<IntegerWidth, string[]> = {
  8: ["al", "cl", "dl", "bl", "spl", "bpl", "sil", "dil"],
  16: ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"],
  32: ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi"],
  64: ["rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi"],
};
function name(width: IntegerWidth, index: number): string {
  const suffix =
    width === 8 ? "b" : width === 16 ? "w" : width === 32 ? "d" : "";
  return index < 8 ? names[width][index]! : "r" + index + suffix;
}

export function oracleCases(): [string, Instruction][] {
  const cases: [string, Instruction][] = [];
  const add = (assembly: string, insn: Instruction) =>
    cases.push([assembly, insn]);
  for (const width of [8, 16, 32, 64] as const) {
    for (let index = 0; index < 16; index++) {
      const other = (index * 5 + 3) % 16;
      add(`mov ${name(width, index)}, ${name(width, other)}`, {
        op: "mov",
        dst: reg(width, index),
        src: reg(width, other),
      });
    }
  }
  for (let base = 0; base < 16; base++) {
    for (const disp of [-2147483648, -129, -128, 0, 127, 128, 2147483647]) {
      const address = `[${name(64, base)} + ${disp}]`;
      add(`mov r9, qword ptr ${address}`, {
        op: "mov",
        dst: reg(64, 9),
        src: mem(64, base, disp),
      });
    }
  }
  for (let index = 0; index < 16; index++) {
    if (index === 4) continue;
    for (const scale of [1, 2, 4, 8] as const) {
      const expression = `${name(64, index)}*${scale}`;
      add(`mov word ptr [r13 + ${expression} + 127], r10w`, {
        op: "mov",
        dst: mem(16, 13, 127, index, scale),
        src: reg(16, 10),
      });
      // An explicit index-only scale of 1 is encoded as a base by LLVM.
      if (scale !== 1)
        add(`lea r8, [${expression} + 128]`, {
          op: "lea",
          dst: reg(64, 8),
          src: mem(64, undefined, 128, index, scale),
        });
    }
  }
  add("lea r8, [305419896]", {
    op: "lea",
    dst: reg(64, 8),
    src: mem(64, undefined, 305419896),
  });
  add("mov spl, byte ptr [rip - 32]", {
    op: "mov",
    dst: reg(8, 4),
    src: { kind: "mem", width: 8, address: { kind: "rip", disp: -32 } },
  });
  add("mov spl, 255", {
    op: "mov",
    dst: reg(8, 4),
    src: { kind: "imm8", value: 255 },
  });
  add("mov r12w, 65535", {
    op: "mov",
    dst: reg(16, 12),
    src: { kind: "imm16", value: 65535 },
  });
  add("mov r8d, 4294967295", {
    op: "mov",
    dst: reg(32, 8),
    src: { kind: "imm32", value: 4294967295 },
  });
  add("mov r9, -2147483648", {
    op: "mov",
    dst: reg(64, 9),
    src: { kind: "imm32", value: -2147483648 },
  });
  add("movabs rax, 0xfedcba9876543210", {
    op: "mov",
    dst: reg(64, 0),
    src: { kind: "imm64", value: { lo: 0x76543210, hi: 0xfedcba98 } },
  });
  add("mov qword ptr [r12], 2147483647", {
    op: "mov",
    dst: mem(64, 12),
    src: { kind: "imm32", value: 2147483647 },
  });
  add("mov byte ptr [r13], -128", {
    op: "mov",
    dst: mem(8, 13),
    src: { kind: "imm8", value: -128 },
  });
  for (const op of [
    "add",
    "or",
    "adc",
    "sbb",
    "and",
    "sub",
    "xor",
    "cmp",
    "test",
  ] as const) {
    add(`${op} r9, r10`, { op, dst: reg(64, 9), src: reg(64, 10) });
    add(`${op} byte ptr [r12], sil`, { op, dst: mem(8, 12), src: reg(8, 6) });
    add(`${op} eax, 128`, {
      op,
      dst: reg(32, 0),
      src: { kind: "imm32", value: 128 },
    });
    add(`${op} r8, -2147483648`, {
      op,
      dst: reg(64, 8),
      src: { kind: "imm32", value: -2147483648 },
    });
    add(`${op} ax, 128`, {
      op,
      dst: reg(16, 0),
      src: { kind: "imm16", value: 128 },
    });
    add(`${op} spl, -128`, {
      op,
      dst: reg(8, 4),
      src: { kind: "imm8", value: -128 },
    });
    if (op !== "test") {
      add(`${op} r9, qword ptr [r13]`, {
        op,
        dst: reg(64, 9),
        src: mem(64, 13),
      });
      add(`${op} r11, -128`, {
        op,
        dst: reg(64, 11),
        src: { kind: "imm8", value: -128 },
      });
      add(`${op} word ptr [r12 + 128], 127`, {
        op,
        dst: mem(16, 12, 128),
        src: { kind: "imm8", value: 127 },
      });
    }
  }
  for (const op of [
    "inc",
    "dec",
    "not",
    "neg",
    "mul",
    "imul-one",
    "div",
    "idiv",
  ] as const) {
    const mnemonic = op === "imul-one" ? "imul" : op;
    add(`${mnemonic} r12b`, { op, dst: reg(8, 12) });
    add(`${mnemonic} qword ptr [r13]`, { op, dst: mem(64, 13) });
  }
  for (const op of ["rol", "ror", "shl", "shr", "sar"] as const) {
    add(`${op} spl, 1`, { op, dst: reg(8, 4), count: 1 });
    add(`${op} r11, cl`, { op, dst: reg(64, 11), count: "cl" });
    add(`${op} word ptr [r12 + 128], 31`, {
      op,
      dst: mem(16, 12, 128),
      count: 31,
    });
    add(`${op} r12b, 255`, { op, dst: reg(8, 12), count: 255 });
  }
  add("imul r9, qword ptr [r13]", {
    op: "imul",
    dst: reg(64, 9),
    src: mem(64, 13),
  });
  add("imul r9, r12, -128", {
    op: "imul-imm",
    dst: reg(64, 9),
    src: reg(64, 12),
    immediate: { kind: "imm8", value: -128 },
  });
  add("imul r9d, r12d, 128", {
    op: "imul-imm",
    dst: reg(32, 9),
    src: reg(32, 12),
    immediate: { kind: "imm32", value: 128 },
  });
  add("imul r9w, r12w, 128", {
    op: "imul-imm",
    dst: reg(16, 9),
    src: reg(16, 12),
    immediate: { kind: "imm16", value: 128 },
  });
  for (const op of ["movsx", "movzx"] as const) {
    add(`${op} r9, dil`, { op, dst: reg(64, 9), src: reg(8, 7) });
    add(`${op} ecx, word ptr [r12]`, { op, dst: reg(32, 1), src: mem(16, 12) });
    add(`${op} ax, spl`, { op, dst: reg(16, 0), src: reg(8, 4) });
  }
  add("movsxd r9, r12d", { op: "movsx", dst: reg(64, 9), src: reg(32, 12) });
  for (const cc of conditions) {
    add(`set${cc} spl`, { op: "setcc", cc, dst: reg(8, 4) });
    add(`cmov${cc} r9, qword ptr [r12 + r13*8]`, {
      op: "cmovcc",
      cc,
      dst: reg(64, 9),
      src: mem(64, 12, 0, 13, 8),
    });
  }
  add("setne byte ptr [r12]", { op: "setcc", cc: "ne", dst: mem(8, 12) });
  add("push r12", { op: "push", src: reg(64, 12) });
  add("push qword ptr [r13]", { op: "push", src: mem(64, 13) });
  add("push -128", { op: "push", src: { kind: "imm8", value: -128 } });
  add("push 128", { op: "push", src: { kind: "imm32", value: 128 } });
  add("pop r12", { op: "pop", dst: reg(64, 12) });
  add("pop qword ptr [r13]", { op: "pop", dst: mem(64, 13) });
  add("call qword ptr [r12]", { op: "call", target: mem(64, 12) });
  add("jmp r11", { op: "jmp", target: reg(64, 11) });
  for (const op of ["cdq", "cqo", "ret", "nop"] as const) add(op, { op });
  add("movsd xmm8, xmm12", { op: "movsd", dst: xmm(8), src: xmm(12) });
  add("movsd xmm8, qword ptr [r12]", {
    op: "movsd",
    dst: xmm(8),
    src: mem(64, 12),
  });
  add("movsd qword ptr [r13], xmm12", {
    op: "movsd",
    dst: mem(64, 13),
    src: xmm(12),
  });
  for (const op of [
    "addsd",
    "subsd",
    "mulsd",
    "divsd",
    "sqrtsd",
    "minsd",
    "maxsd",
    "comisd",
    "ucomisd",
  ] as const) {
    add(`${op} xmm15, xmm9`, { op, dst: xmm(15), src: xmm(9) });
    add(`${op} xmm0, qword ptr [r12 + r13*2 + 128]`, {
      op,
      dst: xmm(0),
      src: mem(64, 12, 128, 13, 2),
    });
  }
  for (const op of ["andpd", "orpd", "xorpd"] as const) {
    add(`${op} xmm9, xmm12`, { op, dst: xmm(9), src: xmm(12) });
    add(`${op} xmm9, xmmword ptr [r12]`, {
      op,
      dst: xmm(9),
      src: mem(128, 12),
    });
  }
  for (const width of [32, 64] as const) {
    add(`cvtsi2sd xmm9, ${name(width, 12)}`, {
      op: "cvtsi2sd",
      dst: xmm(9),
      src: reg(width, 12),
    });
    add(`cvtsi2sd xmm9, ${width === 32 ? "dword" : "qword"} ptr [r13]`, {
      op: "cvtsi2sd",
      dst: xmm(9),
      src: mem(width, 13),
    });
    for (const op of ["cvtsd2si", "cvttsd2si"] as const) {
      add(`${op} ${name(width, 12)}, xmm9`, {
        op,
        dst: reg(width, 12),
        src: xmm(9),
      });
      add(`${op} ${name(width, 12)}, qword ptr [r13]`, {
        op,
        dst: reg(width, 12),
        src: mem(64, 13),
      });
    }
  }
  add("movd xmm9, r12d", { op: "movd", dst: xmm(9), src: reg(32, 12) });
  add("movd r12d, xmm9", { op: "movd", dst: reg(32, 12), src: xmm(9) });
  add("movq xmm9, r12", { op: "movq", dst: xmm(9), src: reg(64, 12) });
  add("movq r12, xmm9", { op: "movq", dst: reg(64, 12), src: xmm(9) });
  add("cvtsd2ss xmm8, qword ptr [r12]", {
    op: "cvtsd2ss",
    dst: xmm(8),
    src: mem(64, 12),
  });
  add("cvtss2sd xmm8, dword ptr [r12]", {
    op: "cvtss2sd",
    dst: xmm(8),
    src: mem(32, 12),
  });
  return cases;
}
