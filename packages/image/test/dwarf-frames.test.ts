import test from "node:test";
import assert from "node:assert/strict";
import { buildDebugInfo, type DebugRequest } from "@tint/image/dwarf";

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

/** Decode the abbreviation forms independently of the writer's DIE layout. */
function decode(abbrev: Uint8Array, info: Uint8Array) {
  const decoder = new TextDecoder();
  function reader(bytes: Uint8Array, start = 0) {
    let at = start;
    return {
      byte: () => bytes[at++]!,
      uleb: () => {
        let value = 0,
          shift = 0,
          byte: number;
        do {
          byte = bytes[at++]!;
          value += (byte & 127) * 2 ** shift;
          shift += 7;
        } while (byte & 128);
        return value;
      },
      number: (length: number) => {
        let value = 0;
        for (let i = 0; i < length; i++) value += bytes[at++]! * 256 ** i;
        return value;
      },
      text: () => {
        const start = at;
        while (bytes[at++] !== 0) assert.ok(at <= bytes.length);
        return decoder.decode(bytes.subarray(start, at - 1));
      },
      block: (length: number) => {
        const value = bytes.slice(at, at + length);
        at += length;
        return value;
      },
    };
  }
  const a = reader(abbrev),
    forms = new Map<
      number,
      { tag: number; children: boolean; attrs: [number, number][] }
    >();
  for (let code = a.uleb(); code !== 0; code = a.uleb()) {
    const tag = a.uleb(),
      children = a.byte() !== 0,
      attrs: [number, number][] = [];
    for (
      let name = a.uleb(), form = a.uleb();
      name || form;
      name = a.uleb(), form = a.uleb()
    )
      attrs.push([name, form]);
    forms.set(code, { tag, children, attrs });
  }
  const data = reader(info, 11);
  interface Die {
    tag: number;
    attrs: Map<number, unknown>;
    children: Die[];
  }
  function die(): Die | undefined {
    const code = data.uleb();
    if (code === 0) return undefined;
    const form = forms.get(code);
    assert.ok(form);
    const attrs = new Map<number, unknown>();
    for (const [name, kind] of form.attrs) {
      let value: unknown;
      if (kind === 8) value = data.text();
      else if (kind === 1) value = data.number(8);
      else if (kind === 6 || kind === 0x13 || kind === 0x17)
        value = data.number(4);
      else if (kind === 0x0b || kind === 0x0c) value = data.byte();
      else if (kind === 0x18) value = data.block(data.uleb());
      else if (kind === 0x19) value = true;
      else assert.fail(`unsupported test decoder form ${kind}`);
      attrs.set(name, value);
    }
    const children: Die[] = [];
    if (form.children)
      for (let child = die(); child; child = die()) children.push(child);
    return { tag: form.tag, attrs, children };
  }
  return die()!;
}

test("artificial frame pointers have signed locations in disjoint lexical scopes", () => {
  const result = buildDebugInfo(request());
  assert.ok(result.ok);
  const unit = decode(result.value.abbrev, result.value.info);
  const fn = unit.children.find((die) => die.tag === 0x2e)!;
  assert.deepEqual(fn.attrs.get(0x40), new Uint8Array([0x6d]));
  assert.equal(fn.children.length, 2);
  for (const [index, block] of fn.children.entries()) {
    assert.equal(block.tag, 0x0b);
    assert.equal(
      block.attrs.get(0x11),
      request().codeAddress + [4, 16][index]!,
    );
    assert.equal(block.attrs.get(0x12), 8);
    assert.deepEqual(
      block.children.map((v) => v.attrs.get(3)),
      ["__tint_context", "__tint_result"],
    );
    for (const [i, variable] of block.children.entries()) {
      assert.equal(variable.tag, 0x34);
      assert.equal(variable.attrs.get(0x34), true);
      assert.deepEqual(
        variable.attrs.get(2),
        new Uint8Array([0x91, [0x68, 0x70][i]!]),
      );
    }
  }
  assert.ok(
    unit.children.some((die) => die.tag === 0x0f && die.attrs.get(0x0b) === 8),
  );
  const size =
    result.value.abbrev.length +
    result.value.info.length +
    result.value.line.length;
  assert.deepEqual(
    buildDebugInfo({ ...request(), maxByteLength: size }),
    result,
  );
  assert.deepEqual(buildDebugInfo({ ...request(), maxByteLength: size - 1 }), {
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
    const unit = decode(result.value.abbrev, result.value.info),
      subprogram = unit.children.find((die) => die.tag === 0x2e)!;
    assert.deepEqual(subprogram.attrs.get(0x40), new Uint8Array([0x90, 73]));
    const expression = subprogram.children[0]!.children[0]!.attrs.get(
      2,
    ) as Uint8Array;
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
