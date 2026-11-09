import assert from "node:assert/strict";
import test from "node:test";
import { decimalFromNumber } from "@tint/foundation/numeric/number-text";
import { parseNumberAffixPattern } from "../src/objects/number-affixes.ts";
import * as rendering from "../src/objects/number-affix-rendering.ts";
const symbols = {
  decimal: ".",
  group: ",",
  plusSign: "\u200e+",
  minusSign: "\u061c-",
  percentSign: "\u200f%",
  nan: "NaN",
  infinity: "∞",
};
const number = [{ type: "integer" as const, value: "12" }];
test("percent affixes preserve prefix sign positions and split symbol direction marks", () => {
  assert.equal(typeof rendering.renderNumberAffixes, "function");
  const pattern = parseNumberAffixPattern("% #,#0;% -#,#0")!;
  assert.deepEqual(
    rendering.renderNumberAffixes(
      pattern,
      decimalFromNumber(-12),
      "auto",
      number,
      symbols,
    ),
    [
      { type: "literal", value: "\u200f" },
      { type: "percentSign", value: "%" },
      { type: "literal", value: " \u061c" },
      { type: "minusSign", value: "-" },
      { type: "integer", value: "12" },
    ],
  );
  assert.deepEqual(
    rendering.renderNumberAffixes(
      pattern,
      decimalFromNumber(12),
      "always",
      number,
      symbols,
    ),
    [
      { type: "literal", value: "\u200f" },
      { type: "percentSign", value: "%" },
      { type: "literal", value: " \u200e" },
      { type: "plusSign", value: "+" },
      { type: "integer", value: "12" },
    ],
  );
});
test("affix selection bases sign on rounded zero and treats NaN as positive zero", () => {
  const pattern = parseNumberAffixPattern("0%")!;
  assert.deepEqual(
    rendering
      .renderNumberAffixes(
        pattern,
        decimalFromNumber(-0),
        "negative",
        number,
        symbols,
      )
      .map((p) => p.type),
    ["integer", "literal", "percentSign"],
  );
  assert.equal(
    rendering.renderNumberAffixes(
      pattern,
      decimalFromNumber(NaN),
      "exceptZero",
      [{ type: "nan", value: "NaN" }],
      symbols,
    )[0]?.type,
    "nan",
  );
  assert.equal(
    rendering
      .renderNumberAffixes(
        pattern,
        decimalFromNumber(NaN),
        "always",
        [{ type: "nan", value: "NaN" }],
        symbols,
      )
      .find((p) => p.type === "plusSign")?.value,
    "+",
  );
});
test("percent-unit templates preserve label text and emit outer whitespace as literals", () => {
  assert.equal(typeof rendering.renderPercentUnit, "function");
  assert.deepEqual(
    rendering.renderPercentUnit("\u200f per cent {0} %\u200e", number),
    [
      { type: "literal", value: "\u200f " },
      { type: "unit", value: "per cent" },
      { type: "literal", value: " " },
      { type: "integer", value: "12" },
      { type: "literal", value: " " },
      { type: "unit", value: "%" },
      { type: "literal", value: "\u200e" },
    ],
  );
  assert.deepEqual(rendering.renderPercentUnit(" {0} ", number), [
    { type: "literal", value: " " },
    { type: "integer", value: "12" },
    { type: "literal", value: " " },
  ]);
  assert.throws(() => rendering.renderPercentUnit("{0}{0}", number));
});

test("symbol percent-unit prefixes take the existing sign before the label while word prefixes retain signed placeholders", () => {
  const signed = [
    { type: "literal" as const, value: "\u061c" },
    { type: "minusSign" as const, value: "-" },
    { type: "integer" as const, value: "12" },
  ];
  assert.deepEqual(rendering.renderPercentUnit("%{0}", signed, "\u061c%"), [
    { type: "literal", value: "\u061c" },
    { type: "minusSign", value: "-" },
    { type: "unit", value: "%" },
    { type: "integer", value: "12" },
  ]);
  assert.deepEqual(rendering.renderPercentUnit("yüzde {0}", signed, "%"), [
    { type: "unit", value: "yüzde" },
    { type: "literal", value: " \u061c" },
    { type: "minusSign", value: "-" },
    { type: "integer", value: "12" },
  ]);
  assert.deepEqual(rendering.renderPercentUnit("٪ {0}", signed, "%"), [
    { type: "literal", value: "\u061c" },
    { type: "minusSign", value: "-" },
    { type: "unit", value: "٪" },
    { type: "literal", value: " " },
    { type: "integer", value: "12" },
  ]);
});

test("currency accounting retains parentheses while positive plus uses standard layout", () => {
  const accounting = parseNumberAffixPattern("¤0;(¤0)")!;
  const standard = parseNumberAffixPattern("¤0;¤-0")!;
  const config = { currency: "USD", standardForPlus: standard };
  const negative = rendering.renderNumberAffixes(
    accounting,
    decimalFromNumber(-12),
    "auto",
    number,
    symbols,
    config,
  );
  assert.deepEqual(negative, [
    { type: "literal", value: "(" },
    { type: "currency", value: "USD" },
    { type: "integer", value: "12" },
    { type: "literal", value: ")" },
  ]);
  const positive = rendering.renderNumberAffixes(
    accounting,
    decimalFromNumber(12),
    "always",
    number,
    symbols,
    config,
  );
  assert.deepEqual(positive, [
    { type: "currency", value: "USD" },
    { type: "literal", value: "\u200e" },
    { type: "plusSign", value: "+" },
    { type: "integer", value: "12" },
  ]);
});

test("currency labels split direction controls and require an explicit label", () => {
  const pattern = parseNumberAffixPattern("0 ¤")!;
  assert.deepEqual(
    rendering.renderNumberAffixes(
      pattern,
      decimalFromNumber(12),
      "auto",
      number,
      symbols,
      { currency: "\u200fد.إ.\u200f", standardForPlus: undefined },
    ),
    [
      { type: "integer", value: "12" },
      { type: "literal", value: " \u200f" },
      { type: "currency", value: "د.إ." },
      { type: "literal", value: "\u200f" },
    ],
  );
  assert.throws(
    () =>
      rendering.renderNumberAffixes(
        pattern,
        decimalFromNumber(12),
        "auto",
        number,
        symbols,
      ),
    (error) => error === "CURRENCY_AFFIX_RENDERING_UNSUPPORTED",
  );
});
test("general unit patterns allow omitted numeric placeholders and preserve leading signs", () => {
  assert.equal(typeof rendering.renderUnitPattern, "function");
  assert.deepEqual(rendering.renderUnitPattern("{0} hours", number), [
    { type: "integer", value: "12" },
    { type: "literal", value: " " },
    { type: "unit", value: "hours" },
  ]);
  assert.deepEqual(
    rendering.renderUnitPattern("سنتان", [{ type: "integer", value: "٢" }]),
    [{ type: "unit", value: "سنتان" }],
  );
  assert.deepEqual(
    rendering.renderUnitPattern("سنتان", [
      { type: "literal", value: "\u061c" },
      { type: "minusSign", value: "-" },
      { type: "integer", value: "٢" },
    ]),
    [
      { type: "literal", value: "\u061c" },
      { type: "minusSign", value: "-" },
      { type: "unit", value: "سنتان" },
    ],
  );
  assert.deepEqual(rendering.renderUnitPattern("hour {0}", number), [
    { type: "unit", value: "hour" },
    { type: "literal", value: " " },
    { type: "integer", value: "12" },
  ]);
});
