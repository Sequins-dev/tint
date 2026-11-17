/** Test-only ABI oracle: clang compiles C callers of naked capture/produce
 * stubs; the captured register file and stack must hold every value where
 * classifyCCall says. clang is never part of Tint's build or link. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyCCall,
  cLayout,
  cPointer,
  cPromoteVariadic,
  cScalar,
  cVoid,
  darwinArm64CTarget,
  type CField,
  type CScalar,
  type CSignature,
  type CType,
  type CValueLocation,
} from "../src/c/index.ts";

const target = darwinArm64CTarget;
const clang = spawnSync("clang", ["--version"], { encoding: "utf8" });
const skip =
  process.platform !== "darwin" || process.arch !== "arm64"
    ? "the oracle runs on darwin-arm64 hosts"
    : clang.status !== 0
      ? "clang is not installed (test-only ABI oracle)"
      : false;

const s = (scalar: CScalar): CType => cScalar(scalar);
const array = (element: CType, length: number): CType => ({
  kind: "array",
  element,
  length,
});
function record(
  name: string,
  fields: [string, CType][],
  options: { union?: boolean; packed?: boolean; alignment?: number } = {},
): CType {
  const members: CField[] = fields.map(([field, type]) => ({
    name: field,
    type,
  }));
  return {
    kind: "record",
    name,
    union: options.union ?? false,
    packed: options.packed ?? false,
    alignment: options.alignment ?? 0,
    fields: members,
  };
}
const records = {
  pair: record("pair", [
    ["a", s("i64")],
    ["b", s("i32")],
  ]),
  small: record("small", [
    ["a", s("u8")],
    ["b", s("i16")],
  ]),
  words: record("words", [
    ["a", s("i64")],
    ["b", s("i64")],
  ]),
  big: record("big", [["v", array(s("i64"), 3)]]),
  hfa3: record("hfa3", [
    ["x", s("f32")],
    ["y", s("f32")],
    ["z", s("f32")],
  ]),
  hfa4: record("hfa4", [["v", array(s("f64"), 4)]]),
  five: record("five", [["v", array(s("f64"), 5)]]),
  mixed: record("mixed", [
    ["a", s("f32")],
    ["b", s("f64")],
  ]),
  nested: record("nested", [
    ["p", record("nested_inner", [["a", array(s("f32"), 2)]])],
    ["q", s("f32")],
  ]),
  overlay: record(
    "overlay",
    [
      ["f", s("f32")],
      ["i", s("i32")],
    ],
    { union: true },
  ),
  packed: record(
    "packed",
    [
      ["a", s("u8")],
      ["b", s("u32")],
    ],
    { packed: true },
  ),
  aligned: record("aligned", [["a", s("i64")]], { alignment: 16 }),
  chars: record("chars", [["c", array(s("char"), 3)]]),
};

function cName(type: CType): string {
  switch (type.kind) {
    case "void":
      return "void";
    case "pointer":
      return "void *";
    case "record":
      return (type.union ? "union " : "struct ") + type.name;
    case "array":
      throw new Error("arrays are members only");
    case "scalar":
      return {
        bool: "bool",
        char: "char",
        i8: "int8_t",
        u8: "uint8_t",
        i16: "int16_t",
        u16: "uint16_t",
        i32: "int32_t",
        u32: "uint32_t",
        i64: "int64_t",
        u64: "uint64_t",
        isize: "intptr_t",
        usize: "size_t",
        f32: "float",
        f64: "double",
      }[type.scalar];
  }
}
function declarations(): string {
  const out: string[] = [];
  const seen = new Set<string>();
  function member(field: CField): string {
    let type = field.type,
      suffix = "";
    while (type.kind === "array") {
      suffix += "[" + type.length + "]";
      type = type.element;
    }
    return "  " + cName(type) + " " + field.name + suffix + ";";
  }
  function declare(type: CType): void {
    if (type.kind === "array") return declare(type.element);
    if (type.kind !== "record" || seen.has(type.name)) return;
    seen.add(type.name);
    for (const field of type.fields) declare(field.type);
    out.push(
      cName(type) +
        " {\n" +
        type.fields.map(member).join("\n") +
        "\n}" +
        (type.packed ? " __attribute__((packed))" : "") +
        (type.alignment !== 0
          ? " __attribute__((aligned(" + type.alignment + ")))"
          : "") +
        ";",
    );
  }
  for (const type of Object.values(records)) declare(type);
  return out.join("\n");
}

interface Case {
  readonly name: string;
  readonly signature: CSignature;
}
function call(
  name: string,
  parameters: CType[],
  result: CType = cVoid(),
  fixed: number = parameters.length,
): Case {
  return {
    name,
    signature: {
      parameters,
      result,
      fixedParameters: fixed,
      callClass: "leaf",
      errno: "none",
    },
  };
}
const eightInts: CType[] = [];
for (let i = 0; i < 8; i++) eightInts.push(s("i64"));
const sixDoubles: CType[] = [];
for (let i = 0; i < 6; i++) sixDoubles.push(s("f64"));
const eightFloats: CType[] = [];
for (let i = 0; i < 8; i++) eightFloats.push(s("f32"));
const cases: Case[] = [
  call("scalars", [s("i32"), s("f64"), s("u8"), s("f32"), cPointer(s("u8"))]),
  call("narrow", [s("i8"), s("u8"), s("i16"), s("u16"), s("bool"), s("char")]),
  call("stack-natural", [
    ...eightInts,
    s("i8"),
    s("i16"),
    s("i32"),
    s("u8"),
    s("i64"),
    s("u16"),
  ]),
  call("stack-floats", [...eightFloats, s("f32"), s("f64"), s("f32")]),
  call("composites", [s("i32"), records.pair, records.small, records.words]),
  call("hfas", [records.hfa3, records.hfa4, s("f64"), records.nested]),
  call("indirect", [records.big, s("i32"), records.five]),
  call("mixed-overlay-packed", [
    records.mixed,
    records.overlay,
    records.packed,
    records.chars,
  ]),
  call("aligned-pair", [s("i32"), records.aligned, s("i32")]),
  call("hfa-spill", [...sixDoubles, records.hfa4, s("f64"), records.hfa3]),
  call("composite-spill", [
    ...eightInts.slice(1),
    records.pair,
    s("i32"),
    records.small,
  ]),
  call("indirect-on-stack", [...eightInts, records.big, records.five]),
  call(
    "variadic",
    [
      cPointer(s("u8")),
      s("i32"),
      s("f64"),
      s("i64"),
      records.pair,
      records.hfa3,
      records.big,
    ],
    cVoid(),
    1,
  ),
  call("result-i8", [], s("i8")),
  call("result-u16", [], s("u16")),
  call("result-f32", [], s("f32")),
  call("result-pair", [], records.pair),
  call("result-small", [], records.small),
  call("result-hfa3", [], records.hfa3),
  call("result-hfa4", [], records.hfa4),
  call("result-mixed", [], records.mixed),
  call("result-big", [s("i32")], records.big),
  call("result-five", [], records.five),
];

/** Deterministic pattern bytes for value `seed` of `size` bytes; floats get
 * exact binary values so promotions are predictable. */
function pattern(type: CType, seed: number): number[] {
  const layout = cLayout(type, target);
  assert.ok(layout.ok);
  const bytes: number[] = [];
  for (let i = 0; i < layout.value.size; i++)
    bytes.push((seed * 37 + i * 11 + 0x81) & 0xff);
  if (type.kind === "scalar" && type.scalar === "bool") return [seed & 1];
  if (
    type.kind === "scalar" &&
    (type.scalar === "f32" || type.scalar === "f64")
  )
    return floatBytes(type.scalar, seed + 0.25);
  return bytes;
}
function floatBytes(scalar: "f32" | "f64", value: number): number[] {
  const buffer = new ArrayBuffer(8),
    view = new DataView(buffer);
  if (scalar === "f32") {
    view.setFloat32(0, value, true);
    return [...new Uint8Array(buffer, 0, 4)];
  }
  view.setFloat64(0, value, true);
  return [...new Uint8Array(buffer)];
}
function cBytes(bytes: number[]): string {
  return "{" + bytes.map((b) => "0x" + b.toString(16)).join(",") + "}";
}
/** The C value expression for argument `index`: floats and promoted
 * variadics use literal values (promotion converts them); others copy
 * their pattern bytes. */
function program(): string {
  const lines: string[] = [];
  lines.push(`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
${declarations()}
uint64_t cap_x[9];
uint64_t cap_d[8];
uint8_t cap_stack[256];
uint64_t ret_x[2];
uint64_t ret_d[4];
uint8_t ret_mem[64];
uint64_t ret_size;
__attribute__((naked)) void capture(void) {
  __asm__ volatile(
    "adrp x16, _cap_x@PAGE\\n add x16, x16, _cap_x@PAGEOFF\\n"
    "stp x0, x1, [x16]\\n stp x2, x3, [x16, #16]\\n stp x4, x5, [x16, #32]\\n"
    "stp x6, x7, [x16, #48]\\n str x8, [x16, #64]\\n"
    "adrp x16, _cap_d@PAGE\\n add x16, x16, _cap_d@PAGEOFF\\n"
    "stp d0, d1, [x16]\\n stp d2, d3, [x16, #16]\\n stp d4, d5, [x16, #32]\\n"
    "stp d6, d7, [x16, #48]\\n"
    "adrp x16, _cap_stack@PAGE\\n add x16, x16, _cap_stack@PAGEOFF\\n"
    "mov x17, sp\\n mov x9, #0\\n"
    "1: ldr x10, [x17, x9]\\n str x10, [x16, x9]\\n add x9, x9, #8\\n"
    "cmp x9, #256\\n b.lt 1b\\n ret\\n");
}
__attribute__((naked)) void produce(void) {
  __asm__ volatile(
    "adrp x16, _ret_size@PAGE\\n add x16, x16, _ret_size@PAGEOFF\\n"
    "ldr x9, [x16]\\n adrp x16, _ret_mem@PAGE\\n add x16, x16, _ret_mem@PAGEOFF\\n"
    "mov x10, #0\\n"
    "1: cmp x10, x9\\n b.ge 2f\\n ldrb w11, [x16, x10]\\n strb w11, [x8, x10]\\n"
    "add x10, x10, #1\\n b 1b\\n"
    "2: adrp x16, _ret_d@PAGE\\n add x16, x16, _ret_d@PAGEOFF\\n"
    "ldp d0, d1, [x16]\\n ldp d2, d3, [x16, #16]\\n"
    "adrp x16, _ret_x@PAGE\\n add x16, x16, _ret_x@PAGEOFF\\n"
    "ldp x0, x1, [x16]\\n ret\\n");
}
static void hex(const char *key, const void *data, size_t size) {
  const uint8_t *b = data;
  printf("\\"%s\\":\\"", key);
  for (size_t i = 0; i < size; i++) printf("%02x", b[i]);
  printf("\\"");
}
static void dump(uint8_t *deref[12]) {
  hex("x", cap_x, sizeof cap_x); printf(",");
  hex("d", cap_d, sizeof cap_d); printf(",");
  hex("stack", cap_stack, sizeof cap_stack); printf(",\\"deref\\":[");
  for (int i = 0; i < 12; i++) { if (i) printf(","); printf("\\""); if (deref[i]) for (int j = 0; j < 48; j++) printf("%02x", deref[i][j]); printf("\\""); }
  printf("]");
}
int main(void) {
  printf("{");`);
  cases.forEach((item, caseIndex) => {
    const sig = item.signature;
    const params = sig.parameters.map((parameter, index) =>
      index >= sig.fixedParameters ? cPromoteVariadic(parameter) : parameter,
    );
    const prototype =
      cName(sig.result) +
      " (*)(" +
      (sig.parameters.length === 0
        ? "void"
        : sig.parameters.slice(0, sig.fixedParameters).map(cName).join(", ") +
          (sig.fixedParameters < sig.parameters.length ? ", ..." : "")) +
      ")";
    lines.push(`  { /* ${item.name} */`);
    params.forEach((parameter, index) => {
      const original = sig.parameters[index]!;
      if (
        parameter.kind === "scalar" &&
        parameter.scalar === "f64" &&
        original.kind === "scalar" &&
        original.scalar === "f32"
      )
        lines.push(`    double a${index} = ${index + 0.25};`);
      else if (
        parameter.kind === "scalar" &&
        (parameter.scalar === "f32" || parameter.scalar === "f64")
      )
        lines.push(`    ${cName(parameter)} a${index} = ${index + 0.25};`);
      else if (parameter !== original)
        lines.push(
          `    ${cName(parameter)} a${index} = (${cName(original)})${index * 37 + 0x81};`,
        );
      else {
        lines.push(
          `    ${cName(parameter)} a${index}; static const uint8_t p${index}[] = ${cBytes(pattern(parameter, index))}; memcpy(&a${index}, p${index}, sizeof a${index});`,
        );
      }
    });
    const args = params.map((_, index) => "a" + index).join(", ");
    if (sig.result.kind === "void") {
      lines.push(`    ((${prototype})capture)(${args});`);
      lines.push(`    uint8_t *deref[12] = {0};`);
      lines.push(
        `    for (int i = 0; i < 8; i++) deref[i] = (uint8_t *)cap_x[i];`,
      );
      // Only predicted indirect pointers are dereferenced (below, in JS
      // order); the C side dereferences all X registers that the test
      // marks, so restrict to those.
      const layout = classifyCCall(sig, target);
      assert.ok(layout.ok, item.name);
      const pointers = new Set(
        layout.value.arguments
          .filter((a) => a.class === "indirect" && a.gp >= 0)
          .map((a) => a.gp),
      );
      lines.push(
        `    { uint8_t *keep[12] = {0}; ${[...pointers].map((r) => `keep[${r}] = deref[${r}];`).join(" ")}`,
      );
      const stackPointers = layout.value.arguments.filter(
        (a) => a.class === "indirect" && a.gp < 0,
      );
      stackPointers.forEach((pointer, order) =>
        lines.push(
          `      memcpy(&keep[${8 + order}], cap_stack + ${pointer.stackOffset}, 8);`,
        ),
      );
      lines.push(
        `      printf("${caseIndex === 0 ? "" : ","}\\"${item.name}\\":{"); dump(keep); printf("}"); }`,
      );
    } else {
      const result = sig.result;
      const layout = classifyCCall(sig, target);
      assert.ok(layout.ok, item.name);
      lines.push(
        `    ret_x[0] = 0x8877665544332211ull; ret_x[1] = 0x1122334455667788ull;`,
        `    ret_d[0] = 0x0102030405060708ull; ret_d[1] = 0x1112131415161718ull; ret_d[2] = 0x2122232425262728ull; ret_d[3] = 0x3132333435363738ull;`,
        `    for (int i = 0; i < 64; i++) ret_mem[i] = (uint8_t)(0xa0 + i);`,
        `    ret_size = ${layout.value.result.class === "indirect" ? layout.value.result.size : 0};`,
        `    ${cName(result)} r = ((${prototype})produce)(${args});`,
        `    printf("${caseIndex === 0 ? "" : ","}\\"${item.name}\\":{"); hex("result", &r, sizeof r); printf("}");`,
      );
    }
    lines.push("  }");
  });
  lines.push(`  printf("}\\n");\n  return 0;\n}`);
  return lines.join("\n");
}
function bytesOf(hexText: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hexText.length; i += 2)
    out.push(parseInt(hexText.slice(i, i + 2), 16));
  return out;
}
function word(bytes: number[], index: number): number[] {
  return bytes.slice(index * 8, index * 8 + 8);
}
function argumentBytes(sig: CSignature, index: number): number[] {
  const original = sig.parameters[index]!;
  const promoted =
    index >= sig.fixedParameters ? cPromoteVariadic(original) : original;
  if (
    promoted.kind === "scalar" &&
    (promoted.scalar === "f32" || promoted.scalar === "f64")
  )
    return floatBytes(promoted.scalar, index + 0.25);
  if (promoted !== original) {
    // Integer promotion of (original)(index * 37 + 0x81) to int.
    const raw = index * 37 + 0x81;
    const bits = original.kind === "scalar" ? original.scalar : "i32";
    const narrow =
      bits === "u8" || bits === "bool"
        ? raw & 0xff
        : bits === "u16"
          ? raw & 0xffff
          : bits === "i8" || bits === "char"
            ? ((raw & 0xff) << 24) >> 24
            : ((raw & 0xffff) << 16) >> 16;
    const buffer = new DataView(new ArrayBuffer(4));
    buffer.setInt32(0, narrow, true);
    return [...new Uint8Array(buffer.buffer)];
  }
  return pattern(promoted, index);
}
function checkArgument(
  name: string,
  index: number,
  sig: CSignature,
  location: CValueLocation,
  capture: { x: number[]; d: number[]; stack: number[]; deref: string[] },
): void {
  const expected = argumentBytes(sig, index);
  const label = name + " argument " + index + " (" + location.class + ")";
  if (location.class === "indirect") {
    const order = sig.parameters.slice(0, index).filter((_, i) => {
      const prior = classifyCCall(sig, target);
      assert.ok(prior.ok);
      const other = prior.value.arguments[i]!;
      return other.class === "indirect" && other.gp < 0;
    }).length;
    const copy = bytesOf(
      capture.deref[location.gp >= 0 ? location.gp : 8 + order]!,
    );
    assert.deepEqual(copy.slice(0, expected.length), expected, label);
    return;
  }
  if (location.stackOffset >= 0) {
    assert.deepEqual(
      capture.stack.slice(
        location.stackOffset,
        location.stackOffset + expected.length,
      ),
      expected,
      label + " at stack " + location.stackOffset,
    );
    return;
  }
  if (location.class === "float" || location.class === "hfa") {
    const width = location.memberBytes;
    for (let member = 0; member < location.registers; member++)
      assert.deepEqual(
        word(capture.d, location.fp + member).slice(0, width),
        expected.slice(member * width, member * width + width),
        label + " member " + member,
      );
    return;
  }
  const registers: number[] = [];
  for (let r = 0; r < location.registers; r++)
    registers.push(...word(capture.x, location.gp + r));
  assert.deepEqual(registers.slice(0, expected.length), expected, label);
  if (location.class === "integer" && location.extend !== "none") {
    const sign =
      location.extend === "sign" && expected[expected.length - 1]! & 0x80
        ? 0xff
        : 0;
    assert.deepEqual(
      registers.slice(expected.length, 4),
      new Array(4 - expected.length).fill(sign),
      label + " extension",
    );
  }
}
function expectedResult(location: CValueLocation): number[] {
  const x = [0x8877665544332211n, 0x1122334455667788n].flatMap((v) => {
    const view = new DataView(new ArrayBuffer(8));
    view.setBigUint64(0, v, true);
    return [...new Uint8Array(view.buffer)];
  });
  const d = [
    0x0102030405060708n,
    0x1112131415161718n,
    0x2122232425262728n,
    0x3132333435363738n,
  ].flatMap((v) => {
    const view = new DataView(new ArrayBuffer(8));
    view.setBigUint64(0, v, true);
    return [...new Uint8Array(view.buffer)];
  });
  switch (location.class) {
    case "integer":
    case "composite":
      return x.slice(0, location.size);
    case "float":
      return d.slice(0, location.size);
    case "hfa": {
      const out: number[] = [];
      for (let m = 0; m < location.registers; m++)
        out.push(...d.slice(m * 8, m * 8 + location.memberBytes));
      return out;
    }
    case "indirect": {
      const out: number[] = [];
      for (let i = 0; i < location.size; i++) out.push(0xa0 + i);
      return out;
    }
    default:
      return [];
  }
}

test(
  "classifyCCall agrees with clang's darwin-arm64 lowering",
  { skip },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-c-abi-oracle-"));
    try {
      const source = join(directory, "oracle.c"),
        binary = join(directory, "oracle");
      writeFileSync(source, program());
      const compiled = spawnSync(
        "clang",
        ["-O0", "-arch", "arm64", "-w", "-o", binary, source],
        { encoding: "utf8" },
      );
      assert.equal(compiled.status, 0, compiled.stderr);
      const run = spawnSync(binary, [], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const observed = JSON.parse(run.stdout) as Record<
        string,
        {
          x?: string;
          d?: string;
          stack?: string;
          deref?: string[];
          result?: string;
        }
      >;
      for (const item of cases) {
        const layout = classifyCCall(item.signature, target);
        assert.ok(layout.ok, item.name);
        const capture = observed[item.name]!;
        if (item.signature.result.kind === "void") {
          const registers = {
            x: bytesOf(capture.x!),
            d: bytesOf(capture.d!),
            stack: bytesOf(capture.stack!),
            deref: capture.deref!,
          };
          layout.value.arguments.forEach((location, index) =>
            checkArgument(
              item.name,
              index,
              item.signature,
              location,
              registers,
            ),
          );
        } else {
          const expected = expectedResult(layout.value.result);
          let actual = bytesOf(capture.result!);
          assert.deepEqual(
            actual.slice(0, expected.length),
            expected,
            item.name + " result (" + layout.value.result.class + ")",
          );
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
