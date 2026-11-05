import assert from "node:assert/strict";
import test from "node:test";
import * as text from "../src/numeric/number-text/index.ts";

test("fixed, exponential and precision formatting round the exact binary value", () => {
  assert.equal(typeof text.numberToFixed, "function");
  assert.equal(typeof text.numberToExponential, "function");
  assert.equal(typeof text.numberToPrecision, "function");
  const values = [
    NaN,
    Infinity,
    -Infinity,
    0,
    -0,
    0.5,
    -0.5,
    1.005,
    2.55,
    2.5,
    9.99,
    99.5,
    -0.0001,
    1e-6,
    1e-7,
    1e20,
    1e21,
    1000000000000000128,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
  ];
  for (const value of values) {
    for (const precision of [0, 1, 2, 3, 6, 17, 50, 100]) {
      assert.equal(
        text.numberToFixed(value, precision),
        value.toFixed(precision),
        `fixed ${value} ${precision}`,
      );
      assert.equal(
        text.numberToExponential(value, precision),
        value.toExponential(precision),
        `exponential ${value} ${precision}`,
      );
      if (precision > 0)
        assert.equal(
          text.numberToPrecision(value, precision),
          value.toPrecision(precision),
          `precision ${value} ${precision}`,
        );
    }
    assert.equal(
      text.numberToExponential(value, undefined),
      value.toExponential(),
    );
    assert.equal(text.numberToPrecision(value, undefined), value.toPrecision());
  }
});

test("presentation formatters match a deterministic binary64 sample", () => {
  const bytes = new ArrayBuffer(8),
    view = new DataView(bytes);
  let state = 0xdeadbeef;
  for (let i = 0; i < 1500; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    view.setUint32(0, state);
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    view.setUint32(4, state);
    const value = view.getFloat64(0),
      precision = state % 101;
    assert.equal(
      text.numberToFixed(value, precision),
      value.toFixed(precision),
    );
    assert.equal(
      text.numberToExponential(value, precision),
      value.toExponential(precision),
    );
    assert.equal(
      text.numberToExponential(value, undefined),
      value.toExponential(),
    );
    assert.equal(
      text.numberToPrecision(value, Math.max(1, precision)),
      value.toPrecision(Math.max(1, precision)),
    );
  }
});
