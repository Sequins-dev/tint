import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAssembler,
  encode,
  encodeLayout,
  patchRelative,
  writeRel32,
  type Instruction,
} from "@tint/codegen/x86_64/isa";
import { conditions, mem, oracleCases, reg, xmm } from "./x64-isa-cases.ts";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

test("the assembler reserves the final image tail without changing byte labels", () => {
  const assembler = createAssembler();
  assembler.instruction({ op: "nop" });
  assembler.instruction({ op: "label", name: "end" });
  assert.equal(assembler.labels.get("end"), 1);
  const laidOut = assembler.finish(undefined, 16);
  assert.equal(hex(laidOut.bytes), "90" + "00".repeat(15));
});

test("streamed rel32 fields patch across byte chunks", () => {
  const assembler = createAssembler();
  for (let index = 0; index < 65534; index++)
    assembler.instruction({ op: "nop" });
  assembler.instruction({
    op: "call",
    target: { kind: "label", label: "callee" },
  });
  assembler.instruction({ op: "nop" });
  assembler.instruction({ op: "label", name: "callee" });
  assembler.instruction({ op: "ret" });
  const layout = assembler.finish();
  assert.equal(layout.labels.get("callee"), 65540);
  assert.equal(hex(layout.bytes.subarray(65534)), "e80100000090c3");
});

test("streamed rel64 fields patch across byte chunks", () => {
  const assembler = createAssembler(true);
  for (let index = 0; index < 65524; index++)
    assembler.instruction({ op: "nop" });
  assembler.instruction({
    op: "call",
    target: { kind: "label", label: "callee" },
  });
  assembler.instruction({ op: "nop" });
  assembler.instruction({ op: "label", name: "callee" });
  assembler.instruction({ op: "ret" });
  const layout = assembler.finish();
  assert.equal(layout.labels.get("callee"), 65549);
  assert.equal(
    hex(layout.bytes.subarray(65524)),
    "4c8d350000000049bf12000000000000004f8d343e41ffd690c3",
  );
});

test("scoped assembly resolves local branches and drops local labels", () => {
  const baseline = createAssembler();
  const scoped = createAssembler();
  for (const target of [baseline, scoped]) {
    if (target === scoped) target.beginScope();
    target.instruction({ op: "label", name: "fn0" });
    target.instruction({
      op: "jmp",
      target: { kind: "label", label: "fn0:b1" },
    });
    target.instruction({ op: "nop" });
    target.instruction({ op: "label", name: "fn0:b1" });
    target.instruction({ op: "call", target: { kind: "label", label: "fn1" } });
    target.instruction({ op: "ret" });
    if (target === scoped) target.endScope((name) => name === "fn0");
    if (target === scoped) target.beginScope();
    target.instruction({ op: "label", name: "fn1" });
    target.instruction({ op: "call", target: { kind: "label", label: "fn0" } });
    target.instruction({ op: "ret" });
    if (target === scoped) target.endScope((name) => name === "fn1");
  }
  const expected = baseline.finish();
  const actual = scoped.finish();
  assert.deepEqual(actual.bytes, expected.bytes);
  assert.equal(actual.labels.get("fn0"), expected.labels.get("fn0"));
  assert.equal(actual.labels.get("fn1"), expected.labels.get("fn1"));
  assert.equal(actual.labels.has("fn0:b1"), false);
});

test("encoding failures identify the instruction and its operands", () => {
  assert.throws(
    () =>
      encode([
        {
          op: "add",
          dst: mem(64, 5, -24),
          src: { kind: "imm32", value: 2147483648 },
        },
      ]),
    /immediate out of range.*add.*mem64\(base=5, disp=-24\).*imm32\(2147483648\)/,
  );
});

test("PIE far addresses encode signed rel64 with separate file and VM offsets", () => {
  const reference = { kind: "label", label: "data", addend: 7 } as const;
  const instructions = [
    {
      op: "lea",
      dst: reg(64, 0),
      src: {
        kind: "mem",
        width: 64,
        address: { kind: "rip", disp: reference },
      },
    },
  ] satisfies Instruction[];
  const near = encodeLayout(instructions, () => true);
  const far = encodeLayout(instructions, () => true, true);
  const [short] = near.externalFixups,
    [long] = far.externalFixups;
  assert.ok(short && long);
  const word = Buffer.alloc(8);
  assert.equal(patchRelative(word, short, 0, 0x80010000, 0x100), "range");
  assert.equal(patchRelative(word, long, 0, 0x80010000, 0x100), "complete");
  assert.equal(word.readBigInt64LE(), 0x8000ff09n);
  assert.equal(patchRelative(word, long, 0, 0x100, 0x80010000), "complete");
  assert.equal(word.readBigInt64LE(), -0x8000fef7n);
});

function llvm(...args: string[]): boolean {
  const result = spawnSync(args[0]!, args.slice(1), { encoding: "utf8" });
  if (result.error && "code" in result.error && result.error.code === "ENOENT")
    return false;
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return true;
}

function assemble(source: string, ...args: string[]): string {
  const run = spawnSync(
    "llvm-mc",
    ["--triple=x86_64-unknown-linux-gnu", ...args],
    {
      input: source,
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

function disassemble(path: string): string[] {
  const run = spawnSync(
    "llvm-objdump",
    ["-d", "--x86-asm-syntax=intel", path],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.split("\n").filter((line) => /^\s*[0-9a-f]+:/.test(line));
}

test("integer and SSE2 matrices match checked-in LLVM MC bytes and instruction lengths", () => {
  const goldens = readFileSync(
    new URL("./x64-isa-llvm-mc.txt", import.meta.url),
    "utf8",
  )
    .trimEnd()
    .split("\n")
    .filter((line) => !line.startsWith("#"));
  assert.deepEqual(
    oracleCases().map(([asm, insn]) => hex(encode([insn])) + " " + asm),
    goldens,
  );
});

test("live LLVM oracle agrees on bytes, decoded lengths and operands", (t) => {
  if (!llvm("llvm-mc", "--version") || !llvm("llvm-objdump", "--version")) {
    t.diagnostic(
      "LLVM MC and llvm-objdump are optional. Checked-in oracle bytes are tested independently.",
    );
    return;
  }
  const cases = oracleCases();
  const source =
    ".intel_syntax noprefix\n.text\n" + cases.map(([asm]) => asm).join("\n");
  const dir = mkdtempSync(join(tmpdir(), "tint-x64-"));
  try {
    const assembled = join(dir, "assembled.o");
    const encoded = join(dir, "encoded.o");
    assemble(source, "--filetype=obj", "-o", assembled);
    const bytes = Array.from(encode(cases.map(([, insn]) => insn)));
    assemble(
      ".text\n.byte " + bytes.join(",") + "\n",
      "--filetype=obj",
      "-o",
      encoded,
    );
    const expected = disassemble(assembled);
    assert.equal(expected.length, cases.length);
    assert.deepEqual(disassemble(encoded), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("near fixups are byte-based and RIP displacements include trailing immediate bytes", () => {
  const bytes = encode([
    { op: "label", name: "entry" },
    { op: "jcc", cc: "ne", target: { kind: "label", label: "exit" } },
    {
      op: "mov",
      dst: {
        kind: "mem",
        width: 32,
        address: {
          kind: "rip",
          disp: { kind: "label", label: "entry", addend: 1 },
        },
      },
      src: { kind: "imm32", value: 123 },
    },
    { op: "call", target: { kind: "label", label: "entry" } },
    { op: "label", name: "exit" },
    { op: "jmp", target: { kind: "label", label: "exit" } },
  ]);
  assert.equal(
    hex(bytes),
    "0f850f000000c705f1ffffff7b000000e8ebffffffe9fbffffff",
  );
  for (let i = 0; i < conditions.length; i++) {
    assert.equal(
      hex(encode([{ op: "jcc", cc: conditions[i]!, target: 0 }])),
      "0f" + (0x80 + i).toString(16) + "00000000",
    );
  }
  for (const disp of [-2147483648, -129, -128, 0, 127, 128, 2147483647]) {
    assert.equal(encode([{ op: "jmp", target: disp }]).length, 5);
    assert.equal(encode([{ op: "call", target: disp }]).length, 5);
    assert.equal(encode([{ op: "jcc", cc: "e", target: disp }]).length, 6);
  }
});

test("exact rel32 boundaries accept full-size offsets and leave the image untouched on failure", () => {
  const bytes = new Uint8Array(8).fill(0x90);
  const origin = Number.MAX_SAFE_INTEGER - 2147483647;
  writeRel32(bytes, 2, origin, Number.MAX_SAFE_INTEGER);
  assert.equal(hex(bytes), "9090ffffff7f9090");
  writeRel32(bytes, 2, Number.MAX_SAFE_INTEGER, origin - 1);
  assert.equal(hex(bytes), "9090000000809090");
  for (const [next, target, addend] of [
    [0, 2147483648, 0],
    [2147483649, 0, 0],
    [0, 2147483647, 1],
    [2147483648, 0, -1],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 0],
    [-1, 0, 0],
    [0, 0, 0.5],
  ] as const) {
    assert.throws(() => writeRel32(bytes, 2, next, target, addend), /x86-64/);
    assert.equal(hex(bytes), "9090000000809090");
  }
  assert.throws(() => writeRel32(bytes, 5, 0, 0), /x86-64/);
});

test("invalid registers, operand forms, addresses, immediate fields and labels are rejected", () => {
  const bad: [unknown, RegExp][] = [
    [{ op: "mov", dst: reg(64, 16), src: reg(64, 0) }, /register/],
    [{ op: "mov", dst: reg(8, 4.5), src: reg(8, 0) }, /register/],
    [{ op: "addsd", dst: xmm(-1), src: xmm(0) }, /register/],
    [{ op: "mov", dst: reg(64, 0), src: reg(32, 0) }, /width/],
    [{ op: "mov", dst: mem(32, 0), src: mem(32, 1) }, /operand/],
    [{ op: "mov", dst: reg(64, 0), src: mem(64, 12, 0, 4) }, /index/],
    [{ op: "mov", dst: reg(64, 0), src: mem(64, 16) }, /base/],
    [{ op: "mov", dst: reg(64, 0), src: mem(64, 0, 0, undefined, 2) }, /scale/],
    [{ op: "mov", dst: reg(64, 0), src: mem(64, 0, 0, 1, 3 as 2) }, /scale/],
    [
      { op: "mov", dst: reg(64, 0), src: mem(64, 0, 2147483648) },
      /displacement/,
    ],
    [
      { op: "mov", dst: reg(8, 0), src: { kind: "imm8", value: 256 } },
      /immediate/,
    ],
    [
      { op: "mov", dst: reg(16, 0), src: { kind: "imm16", value: -32769 } },
      /immediate/,
    ],
    [
      { op: "mov", dst: reg(32, 0), src: { kind: "imm32", value: 4294967296 } },
      /immediate/,
    ],
    [
      { op: "mov", dst: reg(64, 0), src: { kind: "imm32", value: 2147483648 } },
      /immediate/,
    ],
    [
      { op: "add", dst: reg(64, 0), src: { kind: "imm8", value: 128 } },
      /immediate/,
    ],
    [
      { op: "test", dst: reg(64, 0), src: { kind: "imm8", value: 127 } },
      /immediate/,
    ],
    [
      {
        op: "mov",
        dst: mem(64, 0),
        src: { kind: "imm64", value: { lo: 0, hi: 0 } },
      },
      /operand/,
    ],
    [
      {
        op: "mov",
        dst: reg(64, 0),
        src: { kind: "imm64", value: { lo: 0, hi: 4294967296 } },
      },
      /immediate/,
    ],
    [{ op: "lea", dst: reg(8, 0), src: mem(8, 0) }, /width/],
    [{ op: "movzx", dst: reg(64, 0), src: reg(32, 1) }, /width/],
    [{ op: "cmovcc", cc: "e", dst: reg(8, 4), src: reg(8, 4) }, /width/],
    [{ op: "setcc", cc: "e", dst: reg(32, 0) }, /width/],
    [{ op: "jcc", cc: "bad", target: 0 }, /condition/],
    [{ op: "shl", dst: reg(32, 0), count: 256 }, /count/],
    [{ op: "pop", dst: reg(32, 0) }, /width/],
    [{ op: "divsd", dst: xmm(0), src: mem(32, 1) }, /width/],
    [{ op: "movq", dst: xmm(0), src: reg(32, 1) }, /width/],
    [{ op: "call", target: 2147483648 }, /displacement/],
    [
      { op: "jmp", target: { kind: "label", label: "missing" } },
      /undefined label/,
    ],
    [
      {
        op: "adc",
        dst: {
          kind: "mem",
          width: 64,
          address: { kind: "rip", disp: -2147483649 },
        },
        src: reg(64, 0),
      },
      /displacement/,
    ],
    [{ op: "unsupported" }, /instruction/],
  ];
  for (const [instruction, message] of bad) {
    assert.throws(
      () => encode([instruction as Instruction]),
      message,
      JSON.stringify(instruction),
    );
  }
  assert.throws(
    () =>
      encode([
        { op: "label", name: "twice" },
        { op: "label", name: "twice" },
      ]),
    /duplicate label/,
  );
  assert.throws(
    () =>
      encode([
        { op: "label", name: "here" },
        {
          op: "jmp",
          target: { kind: "label", label: "here", addend: 2147483653 },
        },
      ]),
    /rel32/,
  );
});

test("LLVM resolves the same forward and backward near branches and RIP references", (t) => {
  if (!llvm("llvm-mc", "--version") || !llvm("llvm-objdump", "--version")) {
    t.diagnostic(
      "LLVM tools unavailable. Local rel32 goldens are tested independently.",
    );
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "tint-x64-labels-"));
  try {
    const assembled = join(dir, "assembled.o");
    const encoded = join(dir, "encoded.o");
    assemble(
      `.intel_syntax noprefix
.text
.Lentry:
jne .Lend
mov dword ptr [rip + .Lentry + 1], 123
.fill 130, 1, 0x90
.Lend:
call .Lentry
jmp .Lentry
`,
      "--filetype=obj",
      "-o",
      assembled,
    );
    const instructions: Instruction[] = [
      { op: "label", name: "entry" },
      { op: "jcc", cc: "ne", target: { kind: "label", label: "end" } },
      {
        op: "mov",
        dst: {
          kind: "mem",
          width: 32,
          address: {
            kind: "rip",
            disp: { kind: "label", label: "entry", addend: 1 },
          },
        },
        src: { kind: "imm32", value: 123 },
      },
    ];
    for (let i = 0; i < 130; i++) instructions.push({ op: "nop" });
    instructions.push(
      { op: "label", name: "end" },
      { op: "call", target: { kind: "label", label: "entry" } },
      { op: "jmp", target: { kind: "label", label: "entry" } },
    );
    assemble(
      ".text\n.byte " + Array.from(encode(instructions)).join(",") + "\n",
      "--filetype=obj",
      "-o",
      encoded,
    );
    assert.deepEqual(disassemble(encoded), disassemble(assembled));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
