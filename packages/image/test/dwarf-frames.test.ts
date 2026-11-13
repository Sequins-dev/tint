import test from "node:test";
import assert from "node:assert/strict";
import { buildDebugInfo, type DebugRequest } from "@tint/image/dwarf";
import { decodeInfo, decodeLocations } from "./support/dwarf-decode.ts";

function request(): DebugRequest {
  return {
    codeAddress: 0x100001000,
    codeLength: 32,
    directory: "/project",
    lines: [],
    functions: [
      {
        name: "run",
        offset: 0,
        byteLength: 28,
        frame: {
          register: 29,
          ranges: [
            { offset: 4, byteLength: 8 },
            { offset: 16, byteLength: 8 },
          ],
          variables: [
            { name: "__tint_context", offset: -24 },
            { name: "__tint_result", offset: -16 },
          ],
        },
      },
    ],
    maxByteLength: 10000,
  };
}

function size(value: {
  abbrev: Uint8Array;
  info: Uint8Array;
  line: Uint8Array;
  loc: Uint8Array;
  ranges: Uint8Array;
}): number {
  return (
    value.abbrev.length +
    value.info.length +
    value.line.length +
    value.loc.length +
    value.ranges.length
  );
}

test("artificial frame pointers have signed locations valid only in frame ranges", () => {
  const result = buildDebugInfo(request());
  assert.ok(result.ok);
  const unit = decodeInfo(result.value.abbrev, result.value.info);
  const fn = unit.children.find((die) => die.tag === 0x2e)!;
  assert.deepEqual(fn.attrs.get(0x40), new Uint8Array([0x6d]));
  assert.deepEqual(
    fn.children.map((v) => v.attrs.get(3)),
    ["__tint_context", "__tint_result"],
  );
  for (const [i, variable] of fn.children.entries()) {
    assert.equal(variable.tag, 0x34);
    assert.equal(variable.attrs.get(0x34), true);
    const entries = decodeLocations(
      result.value.loc,
      variable.attrs.get(2) as number,
    );
    assert.deepEqual(
      entries.map((entry) => [entry.begin, entry.end]),
      [
        [4, 12],
        [16, 24],
      ],
    );
    for (const entry of entries)
      assert.deepEqual(
        entry.expression,
        new Uint8Array([0x91, [0x68, 0x70][i]!]),
      );
    const type = unit.children.find(
      (die) => die.offset === variable.attrs.get(0x49),
    )!;
    assert.equal(type.tag, 0x0f);
    assert.equal(type.attrs.get(0x0b), 8);
  }
  const total = size(result.value);
  assert.deepEqual(
    buildDebugInfo({ ...request(), maxByteLength: total }),
    result,
  );
  assert.deepEqual(buildDebugInfo({ ...request(), maxByteLength: total - 1 }), {
    ok: false,
    error: "SIZE_LIMIT",
  });
});

test("frame locations reject invalid scopes and malformed slot metadata", () => {
  const base = request(),
    fn = base.functions[0]!,
    frame = fn.frame!;
  for (const changed of [
    { ...frame, register: -1 },
    { ...frame, ranges: [{ offset: 0, byteLength: 32 }] },
    {
      ...frame,
      ranges: [
        { offset: 4, byteLength: 12 },
        { offset: 8, byteLength: 4 },
      ],
    },
    { ...frame, ranges: [{ offset: 4, byteLength: 0 }] },
    { ...frame, variables: [{ name: "bad\0name", offset: -8 }] },
    { ...frame, variables: [{ name: "bad", offset: -0.5 }] },
  ])
    assert.deepEqual(
      buildDebugInfo({ ...base, functions: [{ ...fn, frame: changed }] }),
      { ok: false, error: "INVALID_INPUT" },
    );
});

test("frame expressions preserve signed offsets across LEB boundaries and extended registers", () => {
  for (const offset of [
    -0xffffffff, -8193, -8192, -129, -128, -65, -64, -1, 0, 63, 64, 127, 128,
    8192, 0xffffffff,
  ]) {
    const base = request(),
      fn = base.functions[0]!;
    const result = buildDebugInfo({
      ...base,
      functions: [
        {
          ...fn,
          frame: {
            register: 73,
            ranges: [{ offset: 4, byteLength: 8 }],
            variables: [{ name: "pointer", offset }],
          },
        },
      ],
    });
    assert.ok(result.ok);
    const unit = decodeInfo(result.value.abbrev, result.value.info),
      subprogram = unit.children.find((die) => die.tag === 0x2e)!;
    assert.deepEqual(subprogram.attrs.get(0x40), new Uint8Array([0x90, 73]));
    const [entry] = decodeLocations(
      result.value.loc,
      subprogram.children[0]!.attrs.get(2) as number,
    );
    const expression = entry!.expression;
    assert.equal(expression[0], 0x91);
    let value = 0,
      shift = 0,
      byte = 0;
    for (let i = 1; i < expression.length; i++) {
      byte = expression[i]!;
      value += (byte & 127) * 2 ** shift;
      shift += 7;
    }
    assert.equal(byte & 128, 0);
    assert.equal(byte & 64 ? value - 2 ** shift : value, offset);
  }
});
