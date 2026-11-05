import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
import { decimalFromNumber } from "@tint/foundation/numeric/number-text";

const symbols = {
  decimal: ".",
  group: ",",
  plusSign: "+",
  minusSign: "-",
  nan: "NaN",
  infinity: "∞",
};
const grouping = {
  primaryGrouping: 3,
  secondaryGrouping: 3,
  minimumGroupingDigits: 1,
};

test("numeric digit tables decode complete Unicode codepoints", () => {
  assert.equal(typeof objects.decodeNumberingDigits, "function");
  assert.deepEqual(objects.decodeNumberingDigits("0123456789"), [
    ..."0123456789",
  ]);
  assert.deepEqual(objects.decodeNumberingDigits("𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡"), [
    ..."𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡",
  ]);
  assert.equal(objects.decodeNumberingDigits("012345678"), undefined);
  assert.equal(objects.decodeNumberingDigits("0000000000"), undefined);
  assert.equal(objects.decodeNumberingDigits("012345678\ud800"), undefined);
});

test("decimal parts preserve grouping policy and secondary group widths", () => {
  assert.equal(typeof objects.partitionDecimalNumber, "function");
  const digits = objects.decodeNumberingDigits("0123456789")!;
  const parts = objects.partitionDecimalNumber(
    decimalFromNumber(12345.67),
    "12345.67",
    symbols,
    digits,
    grouping,
    "auto",
    "auto",
  );
  assert.deepEqual(parts, [
    { type: "integer", value: "12" },
    { type: "group", value: "," },
    { type: "integer", value: "345" },
    { type: "decimal", value: "." },
    { type: "fraction", value: "67" },
  ]);
  const text = (
    length: number,
    mode: false | "auto" | "always" | "min2",
    minimum = 1,
    secondary = 3,
  ) =>
    objects
      .partitionDecimalNumber(
        decimalFromNumber(1),
        "1".repeat(length),
        symbols,
        digits,
        {
          ...grouping,
          minimumGroupingDigits: minimum,
          secondaryGrouping: secondary,
        },
        mode,
        "auto",
      )
      .map((x) => x.value)
      .join("");
  assert.equal(text(4, "auto", 2), "1111");
  assert.equal(text(5, "auto", 2), "11,111");
  assert.equal(text(4, "always", 3), "1,111");
  assert.equal(text(4, "min2"), "1111");
  assert.equal(text(7, "auto", 1, 2), "11,11,111");
  assert.equal(text(7, false), "1111111");
});

test("sign policy uses rounded negative zero and NaN classification", () => {
  const digits = objects.decodeNumberingDigits("0123456789")!;
  const text = (
    value: number,
    mode: "auto" | "always" | "never" | "exceptZero" | "negative",
  ) =>
    objects
      .partitionDecimalNumber(
        decimalFromNumber(value),
        "0",
        symbols,
        digits,
        grouping,
        false,
        mode,
      )
      .map((x) => x.value)
      .join("");
  assert.equal(text(-0, "auto"), "-0");
  assert.equal(text(-0, "negative"), "0");
  assert.equal(text(-0, "exceptZero"), "0");
  assert.equal(text(-0, "always"), "-0");
  assert.equal(text(NaN, "always"), "+NaN");
  assert.equal(text(NaN, "exceptZero"), "NaN");
  assert.equal(text(-Infinity, "never"), "∞");
  assert.equal(text(Infinity, "exceptZero"), "+∞");
});

test("digit substitution preserves sign direction controls and special words", () => {
  const digits = objects.decodeNumberingDigits("𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡")!;
  const parts = objects.partitionDecimalNumber(
    decimalFromNumber(-1234.5),
    "1234.50",
    { ...symbols, minusSign: "\u061c-", decimal: "٫", group: "٬" },
    digits,
    grouping,
    "auto",
    "auto",
  );
  assert.deepEqual(parts, [
    { type: "literal", value: "\u061c" },
    { type: "minusSign", value: "-" },
    { type: "integer", value: "𝟙" },
    { type: "group", value: "٬" },
    { type: "integer", value: "𝟚𝟛𝟜" },
    { type: "decimal", value: "٫" },
    { type: "fraction", value: "𝟝𝟘" },
  ]);
  const nan = objects.partitionDecimalNumber(
    decimalFromNumber(NaN),
    "",
    { ...symbols, nan: "not\u200ba\u200bnumber" },
    digits,
    grouping,
    false,
    "auto",
  );
  assert.deepEqual(nan, [{ type: "nan", value: "not\u200ba\u200bnumber" }]);
});
