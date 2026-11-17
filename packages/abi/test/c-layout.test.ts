import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCCall,
  cLayout,
  cLayoutDescriptor,
  cHomogeneousFloatWidth,
  cPointer,
  cScalar,
  cVoid,
  darwinArm64CTarget,
  linuxArm64CTarget,
  type CField,
  type CScalar,
  type CSignature,
  type CType,
} from "../src/c/index.ts";

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
const s = (scalar: CScalar): CType => cScalar(scalar);
const array = (element: CType, length: number): CType => ({
  kind: "array",
  element,
  length,
});
function signature(
  parameters: CType[],
  result: CType = cVoid(),
  fixedParameters: number = parameters.length,
): CSignature {
  return {
    parameters,
    result,
    fixedParameters,
    callClass: "leaf",
    errno: "none",
  };
}
const target = darwinArm64CTarget;

test("C layouts follow natural alignment, packing, unions and explicit alignment", () => {
  const ctx = record("CC_SHA256_CTX", [
    ["count", array(s("u32"), 2)],
    ["hash", array(s("u32"), 8)],
    ["wbuf", array(s("u32"), 16)],
  ]);
  assert.deepEqual(cLayout(ctx, target), {
    ok: true,
    value: { size: 104, alignment: 4, offsets: [0, 8, 40] },
  });
  const mixed = record("mixed", [
    ["a", s("u8")],
    ["b", s("i64")],
    ["c", s("u16")],
  ]);
  assert.deepEqual(cLayout(mixed, target), {
    ok: true,
    value: { size: 24, alignment: 8, offsets: [0, 8, 16] },
  });
  const packed = record(
    "packed",
    [
      ["a", s("u8")],
      ["b", s("u32")],
    ],
    { packed: true },
  );
  assert.deepEqual(cLayout(packed, target), {
    ok: true,
    value: { size: 5, alignment: 1, offsets: [0, 1] },
  });
  const union = record(
    "u",
    [
      ["f", s("f32")],
      ["d", s("u64")],
      ["b", array(s("u8"), 12)],
    ],
    { union: true },
  );
  assert.deepEqual(cLayout(union, target), {
    ok: true,
    value: { size: 16, alignment: 8, offsets: [0, 0, 0] },
  });
  const aligned = record("aligned", [["a", s("i32")]], { alignment: 16 });
  assert.deepEqual(cLayout(aligned, target), {
    ok: true,
    value: { size: 16, alignment: 16, offsets: [0] },
  });
  assert.equal(cLayout(record("empty", []), target).ok, false);
  assert.equal(cLayout(array(s("u8"), 0), target).ok, false);
  assert.equal(
    cLayout(record("odd", [["a", s("u8")]], { alignment: 3 }), target).ok,
    false,
  );
  assert.equal(cLayout(cVoid(), target).ok, false);
});

test("homogeneous float aggregates require 1-4 equal float members covering the record", () => {
  const point = record("point", [
    ["x", s("f64")],
    ["y", s("f64")],
  ]);
  assert.equal(cHomogeneousFloatWidth(point, target), 8);
  assert.equal(
    cHomogeneousFloatWidth(
      record("nested", [
        ["p", record("v", [["a", array(s("f32"), 2)]])],
        ["q", s("f32")],
      ]),
      target,
    ),
    4,
  );
  assert.equal(
    cHomogeneousFloatWidth(record("five", [["a", array(s("f64"), 5)]]), target),
    0,
  );
  assert.equal(
    cHomogeneousFloatWidth(
      record("mixed", [
        ["a", s("f32")],
        ["b", s("f64")],
      ]),
      target,
    ),
    0,
  );
  assert.equal(
    cHomogeneousFloatWidth(
      record(
        "u",
        [
          ["a", s("f32")],
          ["b", s("f32")],
        ],
        { union: true },
      ),
      target,
    ),
    4,
  );
  assert.equal(
    cHomogeneousFloatWidth(
      record(
        "u",
        [
          ["a", s("f32")],
          ["b", s("i32")],
        ],
        { union: true },
      ),
      target,
    ),
    0,
  );
});

test("Apple arm64 packs named stack arguments naturally and extends narrow integers", () => {
  const ints: CType[] = [];
  for (let i = 0; i < 8; i++) ints.push(s("i64"));
  ints.push(s("i8"), s("i16"), s("i32"), s("u8"), s("i64"));
  const layout = classifyCCall(signature(ints), target);
  assert.ok(layout.ok);
  const stack = layout.value.arguments
    .slice(8)
    .map((argument) => [
      argument.stackOffset,
      argument.stackBytes,
      argument.extend,
    ]);
  assert.deepEqual(stack, [
    [0, 1, "sign"],
    [2, 2, "sign"],
    [4, 4, "none"],
    [8, 1, "zero"],
    [16, 8, "none"],
  ]);
  assert.equal(layout.value.stackBytes, 32);
  const linux = classifyCCall(signature(ints), linuxArm64CTarget);
  assert.ok(linux.ok);
  assert.deepEqual(
    linux.value.arguments.slice(8).map((argument) => argument.stackOffset),
    [0, 8, 16, 24, 32],
  );
});

test("Apple arm64 passes variadic arguments on the stack in 8-byte slots", () => {
  const layout = classifyCCall(
    signature(
      [cPointer(s("u8")), s("i32"), s("f32"), s("u8"), s("f64")],
      s("i32"),
      1,
    ),
    target,
  );
  assert.ok(layout.ok);
  const [format, integer, single, byte, double] = layout.value.arguments;
  assert.equal(format?.gp, 0);
  assert.deepEqual(
    [integer, single, byte, double].map((argument) => [
      argument?.class,
      argument?.stackOffset,
      argument?.stackBytes,
    ]),
    [
      ["integer", 0, 8],
      ["float", 8, 8],
      ["integer", 16, 8],
      ["float", 24, 8],
    ],
  );
  const linux = classifyCCall(
    signature([cPointer(s("u8")), s("i32"), s("f64")], s("i32"), 1),
    linuxArm64CTarget,
  );
  assert.ok(linux.ok);
  assert.deepEqual(
    linux.value.arguments.map((argument) => [argument.gp, argument.fp]),
    [
      [0, -1],
      [1, -1],
      [-1, 0],
    ],
  );
});

test("composites, HFAs and indirect records follow AAPCS64 register rules", () => {
  const pair = record("pair", [
    ["a", s("i64")],
    ["b", s("i32")],
  ]);
  const quad = record("quad", [["v", array(s("f64"), 4)]]);
  const big = record("big", [["v", array(s("i64"), 3)]]);
  const layout = classifyCCall(
    signature([s("i32"), pair, quad, big, s("f64")], big),
    target,
  );
  assert.ok(layout.ok);
  const [first, second, third, fourth, fifth] = layout.value.arguments;
  assert.deepEqual([first?.gp, first?.registers], [0, 1]);
  assert.deepEqual(
    [second?.class, second?.gp, second?.registers],
    ["composite", 1, 2],
  );
  assert.deepEqual([third?.class, third?.fp, third?.registers], ["hfa", 0, 4]);
  assert.deepEqual([fourth?.class, fourth?.gp], ["indirect", 3]);
  assert.deepEqual([fifth?.class, fifth?.fp], ["float", 4]);
  assert.deepEqual(
    [layout.value.result.class, layout.value.result.gp],
    ["indirect", 8],
  );
  // C.3: an HFA that does not fit in the remaining V registers goes to the
  // stack and closes them, so a later double is on the stack too.
  const doubles: CType[] = [];
  for (let i = 0; i < 6; i++) doubles.push(s("f64"));
  doubles.push(quad, s("f64"));
  const spilled = classifyCCall(signature(doubles), target);
  assert.ok(spilled.ok);
  assert.deepEqual(
    spilled.value.arguments
      .slice(6)
      .map((argument) => [argument.class, argument.stackOffset]),
    [
      ["hfa", 0],
      ["float", 32],
    ],
  );
  // C.11: a composite that does not fit closes the X registers.
  const words: CType[] = [];
  for (let i = 0; i < 7; i++) words.push(s("i64"));
  words.push(pair, s("i32"));
  const closed = classifyCCall(signature(words), target);
  assert.ok(closed.ok);
  assert.deepEqual(
    closed.value.arguments.slice(7).map((argument) => argument.stackOffset),
    [0, 16],
  );
  assert.equal(classifyCCall(signature([array(s("u8"), 4)]), target).ok, false);
  assert.equal(classifyCCall(signature([cVoid()]), target).ok, false);
});

test("AAPCS64 places composites by natural alignment; Apple by the declared one", () => {
  // 16-byte alignment from the record's own attribute, and from a member.
  const declared = record("declared", [["a", s("i64")]], { alignment: 16 });
  const inherited = record("inherited", [["inner", declared]]);
  const eight: CType[] = [];
  for (let i = 0; i < 8; i++) eight.push(s("i64"));
  function placed(type: CType, platform: typeof target) {
    const registers = classifyCCall(
      signature([s("i32"), type, s("i32")]),
      platform,
    );
    const stack = classifyCCall(
      signature([...eight, s("i32"), type]),
      platform,
    );
    assert.ok(registers.ok && stack.ok);
    return [
      registers.value.arguments[1]?.gp,
      registers.value.arguments[2]?.gp,
      stack.value.arguments[9]?.stackOffset,
    ];
  }
  // Linux (clang): the attribute alone moves nothing; a 16-byte
  // aligned member starts an even register pair and a 16-byte stack slot.
  assert.deepEqual(placed(declared, linuxArm64CTarget), [1, 3, 8]);
  assert.deepEqual(placed(inherited, linuxArm64CTarget), [2, 4, 16]);
  // Apple: never an even pair; the stack honours the declared alignment.
  assert.deepEqual(placed(declared, darwinArm64CTarget), [1, 3, 16]);
  assert.deepEqual(placed(inherited, darwinArm64CTarget), [1, 3, 16]);
});

test("layout descriptors report the shared layout as data", () => {
  const ctx = record("CC_SHA256_CTX", [
    ["count", array(s("u32"), 2)],
    ["hash", array(s("u32"), 8)],
    ["wbuf", array(s("u32"), 16)],
  ]);
  assert.deepEqual(cLayoutDescriptor(ctx, target), {
    ok: true,
    value: {
      name: "CC_SHA256_CTX",
      size: 104,
      alignment: 4,
      fields: [
        { name: "count", offset: 0, size: 8, type: "u32[2]" },
        { name: "hash", offset: 8, size: 32, type: "u32[8]" },
        { name: "wbuf", offset: 40, size: 64, type: "u32[16]" },
      ],
    },
  });
});
