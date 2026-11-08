import { after, test } from "node:test";
import assert from "node:assert/strict";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const objects = await import("../src/objects/index.ts");
import type {
  ObjectHooks,
  OrdinaryObject,
  ScriptPropertyKey,
} from "../src/objects/index.ts";
type ObjectValue = OrdinaryObject<ScriptPropertyKey, unknown>;

test("Function.prototype.toString keeps NativeFunction syntax for non-identifier initial names", () => {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installRegExpIntrinsics(root, realm, hooks);
  objects.installSetIntrinsics(root, realm, hooks);
  const toString = objects.getOwnProperty(
    realm.functionPrototype,
    "toString",
  )!.value;
  const source = (fn: unknown): unknown => {
    const result = objects.callObjectValue(toString, fn, [], root);
    assert.equal(result.error, "none");
    return result.value;
  };
  const regexp = objects.getOwnProperty(root, "RegExp")!.value as ObjectValue;
  const getter = (name: string): unknown =>
    objects.getOwnProperty(regexp, name)!.get;
  // Annex B legacy accessors: `$&` etc. are not IdentifierNames, so the
  // PropertyName is a computed string literal.
  assert.equal(source(getter("$&")), 'function get ["$&"]() { [native code] }');
  assert.equal(source(getter("$+")), 'function get ["$+"]() { [native code] }');
  assert.equal(source(getter("$`")), 'function get ["$`"]() { [native code] }');
  assert.equal(
    source(getter("$'")),
    'function get ["$\'"]() { [native code] }',
  );
  // Identifier, accessor and symbol-keyed names are unchanged.
  assert.equal(source(getter("$1")), "function get $1() { [native code] }");
  assert.equal(
    source(objects.getOwnProperty(regexp, "input")!.set),
    "function set input() { [native code] }",
  );
  assert.equal(source(regexp), "function RegExp() { [native code] }");
  const species = objects.getOwnProperty(
    objects.getOwnProperty(root, "Set")!.value as ObjectValue,
    objects.wellKnownSymbol(realm.symbolRegistry, "species"),
  );
  assert.equal(
    source(species!.get),
    "function get [Symbol.species]() { [native code] }",
  );
  assert.equal(source(realm.throwTypeError), "function () { [native code] }");
});
