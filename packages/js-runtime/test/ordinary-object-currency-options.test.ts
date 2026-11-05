import { after, test } from "node:test";
import type {
  OrdinaryObject,
  ScriptPropertyKey,
  ObjectHooks,
} from "../src/objects/index.ts";
import assert from "node:assert/strict";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";

const hostViews = bindHostRecordViews();

after(() => hostViews.deregister());

const objects = await import("../src/objects/index.ts");
const formats = await import("../src/objects/intl-number-format.ts");
const decimal = await import("../src/objects/decimal-number-format.ts");
const quantities = await import("@tint/foundation/numeric/number-text");
function setup(values: Record<string, unknown>) {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call(callee, receiver, args) {
      const result = objects.callObjectValue(callee, receiver, args, root);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = objects.createErrorRealm(root, hooks);
  const options = objects.createObject<ScriptPropertyKey, unknown>(root);
  for (const [key, value] of Object.entries(values))
    objects.createDataProperty(options, key, value, hooks);
  return { realm, hooks, options };
}
test("currency configuration retains options and applies ordinary currency digits", () => {
  for (const [code, digits, expected] of [
    ["usd", 2, "$12.00"],
    ["JPY", 0, "¥12"],
    ["BHD", 3, "BHD 12.000"],
    ["CLF", 4, "CLF 12.0000"],
    ["ZZZ", 2, "ZZZ 12.00"],
  ] as const) {
    const { realm, hooks, options } = setup({
      style: "currency",
      currency: code,
    });
    const f = formats.configureDecimalNumberFormatter(
      "en",
      options,
      realm,
      hooks,
    );
    assert.equal(f.currency?.code, code.toUpperCase());
    assert.equal(f.digitOptions.minimumFractionDigits, digits);
    assert.equal(f.digitOptions.maximumFractionDigits, digits);
    assert.equal(
      decimal.formatDecimalNumber(f, quantities.decimalFromNumber(12)),
      expected,
    );
  }
});
test("currency overrides and narrow labels remain independent of cash metadata", () => {
  const { realm, hooks, options } = setup({
    style: "currency",
    currency: "CAD",
    currencyDisplay: "narrowSymbol",
    currencySign: "accounting",
    maximumFractionDigits: 3,
  });
  const f = formats.configureDecimalNumberFormatter(
    "en",
    options,
    realm,
    hooks,
  );
  assert.equal(f.currency?.display, "narrowSymbol");
  assert.equal(f.currency?.sign, "accounting");
  assert.equal(
    decimal.formatDecimalNumber(f, quantities.decimalFromNumber(-1.025)),
    "($1.025)",
  );
});
