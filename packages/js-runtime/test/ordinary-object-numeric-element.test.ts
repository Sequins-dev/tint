import { test } from "node:test";
import assert from "node:assert/strict";
import * as elements from "../src/objects/index.ts";
test("numeric element encodings match native typed arrays across conversion boundaries", () => {
  assert.equal(typeof elements.writeNumericElement, "function");
  const constructors = [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
  ];
  for (const Constructor of constructors) {
    const kind = Constructor.name.replace(
      "Array",
      "",
    ) as elements.NumericElementKind;
    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      -0,
      0,
      0.5,
      1.5,
      2.5,
      254.5,
      255.5,
      -1,
      -1.5,
      256,
      65537,
      4294967297,
      1e30,
      1e-40,
    ]) {
      const reference = new Constructor([value]);
      const bytes = new Uint8Array(Constructor.BYTES_PER_ELEMENT + 2);
      bytes.fill(0xa5);
      elements.writeNumericElement(bytes, 1, kind, value, "little");
      assert.equal(bytes[0], 0xa5);
      assert.equal(bytes.at(-1), 0xa5);
      assert.ok(
        Object.is(
          elements.readNumericElement(bytes, 1, kind, "little"),
          reference[0],
        ),
        `${kind} ${value}`,
      );
      const raw = new Uint8Array(reference.buffer);
      if (!Number.isNaN(value))
        assert.deepEqual(bytes.slice(1, -1), raw, `${kind} ${value}`);
      const big = new Uint8Array(Constructor.BYTES_PER_ELEMENT);
      elements.writeNumericElement(big, 0, kind, value, "big");
      assert.ok(
        Object.is(
          elements.readNumericElement(big, 0, kind, "big"),
          reference[0],
        ),
      );
      assert.deepEqual(big, bytes.slice(1, -1).reverse());
    }
  }
});
test("clamping uses ties to even after saturation", () => {
  assert.equal(typeof elements.writeNumericElement, "function");
  for (let i = -2; i < 258; i++) {
    const bytes = new Uint8Array(1);
    for (const offset of [0.49, 0.5, 0.51]) {
      elements.writeNumericElement(
        bytes,
        0,
        "Uint8Clamped",
        i + offset,
        "little",
      );
      assert.equal(bytes[0], new Uint8ClampedArray([i + offset])[0]);
    }
  }
});
test("Float16 encoding preserves signed zero, subnormals and ties to even", () => {
  const bytes = new Uint8Array(2);
  for (const [value, expected] of [
    [-0, -0],
    [2 ** -24, 2 ** -24],
    [2 ** -25, 0],
    [1 + 2 ** -11, 1],
    [1 + 3 * 2 ** -11, 1 + 2 ** -9],
    [65520, Infinity],
  ]) {
    elements.writeNumericElement(bytes, 0, "Float16", value!, "little");
    assert.ok(
      Object.is(
        elements.readNumericElement(bytes, 0, "Float16", "little"),
        expected,
      ),
    );
  }
});
