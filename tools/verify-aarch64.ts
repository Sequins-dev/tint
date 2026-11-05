// Optional independent oracle, never a compiler/runtime dependency.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  encode,
  type Instruction,
  type Condition,
} from "@tint/codegen/aarch64/isa";
import { fixtures } from "../packages/codegen/test/isa-fixtures.ts";

interface Case {
  assembly: string;
  instruction: Instruction;
}
const cases: Case[] = fixtures.map((f) => ({
  assembly: f.assembly,
  instruction: f.instruction,
}));
const add = (assembly: string, instruction: Instruction) => {
  cases.push({ assembly, instruction });
};
for (const immediate of [0, 65535])
  add(`brk #${immediate}`, { op: "brk", immediate });
for (const op of ["ldrb", "strb", "ldrh", "strh"] as const)
  for (const offset of op.endsWith("h") ? [0, 2, 8190] : [0, 1, 4095])
    for (const rt of [0, 30, "zr"] as const)
      for (const rn of [1, "sp"] as const)
        add(
          `${op} ${rt === "zr" ? "wzr" : "w" + rt}, [${rn === "sp" ? "sp" : "x" + rn}, #${offset}]`,
          { op, rt, rn, offset },
        );
for (const op of ["frintp", "frintz", "fsqrt"] as const)
  for (const rd of [0, 1, 7, 31])
    for (const rn of [0, 1, 7, 31]) add(`${op} d${rd}, d${rn}`, { op, rd, rn });
for (const width of [32, 64] as const) {
  const prefix = width === 64 ? "x" : "w";
  for (const rd of [0, 7, 18, 30] as const) {
    for (const shift of [0, 16, 32, 48] as const)
      if (shift < width) {
        for (const op of ["movz", "movk"] as const)
          add(`${op} ${prefix}${rd}, #65535, lsl #${shift}`, {
            op,
            width,
            rd,
            immediate: 65535,
            shift,
          });
      }
  }
  for (const op of ["add-imm", "sub-imm"] as const)
    for (const setFlags of [false, true])
      for (const shift of [0, 12] as const)
        for (const immediate of [0, 4095]) {
          add(
            `${op === "add-imm" ? "add" : "sub"}${setFlags ? "s" : ""} ${prefix}0, ${prefix}1, #${immediate}, lsl #${shift}`,
            { op, width, rd: 0, rn: 1, immediate, shift, setFlags },
          );
        }
  for (const op of ["add-reg", "sub-reg"] as const)
    for (const setFlags of [false, true])
      for (const shift of ["lsl", "lsr", "asr"] as const)
        for (const amount of [0, width - 1]) {
          add(
            `${op === "add-reg" ? "add" : "sub"}${setFlags ? "s" : ""} ${prefix}30, ${prefix}7, ${prefix}18, ${shift} #${amount}`,
            { op, width, rd: 30, rn: 7, rm: 18, shift, amount, setFlags },
          );
        }
  for (const op of ["ldr", "str"] as const)
    for (const offset of [0, (4095 * width) / 8])
      add(`${op} ${prefix}18, [sp, #${offset}]`, {
        op,
        width,
        rt: 18,
        rn: "sp",
        offset,
      });
  for (const op of ["ldp", "stp"] as const)
    for (const mode of ["offset", "pre", "post"] as const)
      for (const offset of [(-64 * width) / 8, (63 * width) / 8]) {
        const address =
          mode === "post"
            ? `[sp], #${offset}`
            : `[sp, #${offset}]${mode === "pre" ? "!" : ""}`;
        add(`${op} ${prefix}0, ${prefix}1, ${address}`, {
          op,
          width,
          rt: 0,
          rt2: 1,
          rn: "sp",
          mode,
          offset,
        });
      }
  for (const op of ["cbz", "cbnz"] as const)
    for (const displacement of [-1048576, -4, 0, 1048572])
      add(`${op} ${prefix}18, #${displacement}`, {
        op,
        width,
        rt: 18,
        displacement,
      });
}
for (const displacement of [-1048576, -1, 0, 1, 1048575])
  add(`adr x7, #${displacement}`, { op: "adr", rd: 7, displacement });
const conditions: Condition[] = [
  "eq",
  "ne",
  "cs",
  "cc",
  "mi",
  "pl",
  "vs",
  "vc",
  "hi",
  "ls",
  "ge",
  "lt",
  "gt",
  "le",
  "al",
  "nv",
];
for (const condition of conditions)
  for (const displacement of [-1048576, -4, 0, 1048572])
    add(`b.${condition} #${displacement}`, {
      op: "b.cond",
      condition,
      displacement,
    });
for (const op of ["b", "bl"] as const)
  for (const displacement of [-134217728, -4, 0, 134217724])
    add(`${op} #${displacement}`, { op, displacement });

for (const rd of [0, 7, 31]) {
  for (const rn of [0, 15, 31]) {
    for (const rm of [0, 16, 31]) {
      for (const op of ["fadd", "fsub", "fmul", "fdiv"] as const)
        add(`${op} d${rd}, d${rn}, d${rm}`, { op, rd, rn, rm });
      add(`fcmp d${rn}, d${rm}`, { op: "fcmp", rn, rm });
    }
    add(`fneg d${rd}, d${rn}`, { op: "fneg", rd, rn });
  }
  for (const offset of [0, 32760])
    for (const op of ["ldr-d", "str-d"] as const)
      add(`${op === "ldr-d" ? "ldr" : "str"} d${rd}, [sp, #${offset}]`, {
        op,
        rt: rd,
        rn: "sp",
        offset,
      });
}
for (const condition of conditions)
  if (condition !== "al" && condition !== "nv")
    add(`cset w30, ${condition}`, { op: "cset", rd: 30, condition });
for (const width of [32, 64] as const) {
  const prefix = width === 32 ? "w" : "x";
  for (const rd of [0, 13, 30] as const)
    for (const rn of [0, 9, "zr"] as const)
      for (const rm of [1, 12, "zr"] as const) {
        for (const op of [
          "and-reg",
          "orr-reg",
          "eor-reg",
          "orn-reg",
          "lslv",
          "lsrv",
          "asrv",
        ] as const) {
          const mnemonic = op.endsWith("-reg") ? op.slice(0, -4) : op;
          add(`${mnemonic} ${prefix}${rd}, ${prefix}${rn}, ${prefix}${rm}`, {
            op,
            width,
            rd,
            rn,
            rm,
          });
        }
      }
  for (const immr of [0, 1, width - 1])
    for (const imms of [0, 1, width - 1])
      add(`ubfm ${prefix}9, ${prefix}10, #${immr}, #${imms}`, {
        op: "ubfm",
        width,
        rd: 9,
        rn: 10,
        immr,
        imms,
      });
}
for (const rd of [0, 31])
  for (const rn of [0, 31])
    for (const op of ["fabs", "fmov-d-d"] as const)
      add(`${op === "fabs" ? "fabs" : "fmov"} d${rd}, d${rn}`, { op, rd, rn });
for (const rd of [0, 31])
  for (const rn of [0, 30, "zr"] as const)
    add(`ucvtf d${rd}, w${rn}`, { op: "ucvtf-d-w", rd, rn });
const command = process.env.LLVM_MC ?? "llvm-mc";
function run(args: string[], input?: string): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error)
    throw new Error(
      `Cannot run ${command}; install LLVM or set LLVM_MC for this optional oracle.`,
      { cause: result.error },
    );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "", "Oracle emitted diagnostics");
  return result.stdout;
}
function encodings(output: string): number[][] {
  return [...output.matchAll(/encoding:\s*\[([^\]]+)\]/g)].map((match) => {
    assert.ok(match[1]);
    const parts = match[1].split(",").map((s) => s.trim());
    assert.ok(
      parts.every((p) => /^0x[0-9a-f]{2}$/i.test(p)),
      "Oracle returned unresolved fixups or non-byte output",
    );
    return parts.map((p) => Number.parseInt(p.slice(2), 16));
  });
}
const version = run(["--version"]).split("\n")[0];
const oracle = encodings(
  run(
    ["--triple=aarch64", "--show-encoding"],
    cases.map((c) => c.assembly).join("\n") + "\n",
  ),
);
assert.equal(oracle.length, cases.length);
const actual: number[][] = [];
for (let index = 0; index < cases.length; index++) {
  const sample = cases[index];
  assert.ok(sample);
  const result = encode(sample.instruction);
  assert.equal(result.ok, true, sample.assembly);
  const bytes = [0, 1, 2, 3].map(
    (i) => Math.floor(result.value / 256 ** i) % 256,
  );
  assert.deepEqual(bytes, oracle[index], sample.assembly);
  actual.push(bytes);
}
for (let index = 0; index < fixtures.length; index++)
  assert.deepEqual(
    oracle[index],
    fixtures[index]?.bytes,
    "Committed golden drift",
  );
const decoded = encodings(
  run(
    ["--triple=aarch64", "--disassemble", "--show-encoding"],
    actual
      .map((bytes) =>
        bytes.map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(" "),
      )
      .join("\n") + "\n",
  ),
);
assert.deepEqual(
  decoded,
  actual,
  "Disassembler rejected or changed emitted instruction bytes",
);
console.log(
  `${version}: independently assembled and disassembled ${cases.length} AArch64 encodings; ${fixtures.length} committed goldens verified.`,
);
