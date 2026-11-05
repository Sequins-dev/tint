import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
import {
  createObject,
  defineOwnProperty,
  deleteProperty,
  toPropertyDescriptor,
  fromPropertyDescriptor,
  fromPropertyDescriptorUpdate,
  ownKeys,
  getProperty,
  type ObjectHooks,
} from "../src/objects/index.ts";
const keys = {
  value: "value",
  writable: "writable",
  get: "get",
  set: "set",
  enumerable: "enumerable",
  configurable: "configurable",
};
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (fn, receiver, args) =>
    Reflect.apply(fn as (...args: unknown[]) => unknown, receiver, args),
};
const callable = (value: unknown) => typeof value === "function";
test("descriptor conversion reads inherited fields in specification order", () => {
  const parent = createObject<string, unknown>(undefined),
    source = createObject<string, unknown>(parent);
  const seen: string[] = [];
  const values: Record<string, unknown> = {
    enumerable: 1,
    configurable: 0,
    value: 7,
    writable: "yes",
    get: undefined,
    set: undefined,
  };
  for (const name of [
    "set",
    "get",
    "writable",
    "value",
    "configurable",
    "enumerable",
  ]) {
    const getter = function (this: unknown) {
      assert.equal(this, source);
      seen.push(name);
      return values[name];
    };
    defineOwnProperty(
      parent,
      name,
      {
        ...emptyUpdate<unknown>(undefined),
        fields: 36,
        get: getter,
        configurable: true,
      },
      hooks,
    );
  }
  const result = toPropertyDescriptor(
    source,
    source,
    keys,
    hooks,
    Boolean,
    callable,
  );
  assert.equal(result.error, "mixed");
  assert.deepEqual(seen, [
    "enumerable",
    "configurable",
    "value",
    "writable",
    "get",
    "set",
  ]);
  assert.equal(result.update.fields, 63);
  assert.equal(result.update.enumerable, true);
  assert.equal(result.update.configurable, false);
});
test("descriptor conversion observes effects and rejects invalid accessors before later reads", () => {
  const source = createObject<string, unknown>(undefined);
  let later = 0;
  defineOwnProperty(
    source,
    "get",
    { ...emptyUpdate<unknown>(undefined), fields: 1, value: 3 },
    hooks,
  );
  defineOwnProperty(
    source,
    "set",
    {
      ...emptyUpdate<unknown>(undefined),
      fields: 4,
      get: () => {
        later++;
        return undefined;
      },
    },
    hooks,
  );
  assert.equal(
    toPropertyDescriptor(source, source, keys, hooks, Boolean, callable).error,
    "getter",
  );
  assert.equal(later, 0);
  const changing = createObject<string, unknown>(undefined);
  defineOwnProperty(
    changing,
    "value",
    {
      ...emptyUpdate<unknown>(undefined),
      fields: 33,
      value: 7,
      configurable: true,
    },
    hooks,
  );
  defineOwnProperty(
    changing,
    "enumerable",
    {
      ...emptyUpdate<unknown>(undefined),
      fields: 4,
      get: () => {
        deleteProperty(changing, "value");
        return true;
      },
    },
    hooks,
  );
  const result = toPropertyDescriptor(
    changing,
    changing,
    keys,
    hooks,
    Boolean,
    callable,
  );
  assert.equal(result.error, "none");
  assert.equal(result.update.fields, 16);
});
test("descriptor export produces fresh ordinary data properties in standard order", () => {
  const prototype = createObject<string, unknown>(undefined);
  const exported = fromPropertyDescriptor(
    {
      accessor: false,
      value: NaN,
      writable: false,
      get: undefined,
      set: undefined,
      enumerable: true,
      configurable: false,
    },
    prototype,
    keys,
    hooks,
    (value) => value,
  );
  assert.ok(exported);
  assert.equal(exported.prototype, prototype);
  assert.deepEqual(
    ownKeys(exported, () => -1),
    ["value", "writable", "enumerable", "configurable"],
  );
  assert.equal(getProperty(exported, "enumerable", exported, hooks), true);
  const roundtrip = toPropertyDescriptor(
    exported,
    exported,
    keys,
    hooks,
    Boolean,
    callable,
  );
  assert.equal(roundtrip.error, "none");
  assert.equal(roundtrip.update.fields, 51);
  assert.ok(Number.isNaN(roundtrip.update.value));
  assert.equal(
    fromPropertyDescriptor(undefined, prototype, keys, hooks, (value) => value),
    undefined,
  );
});

test("partial descriptor export preserves absent fields and explicit undefined", () => {
  const update = {
    ...emptyUpdate<unknown>(undefined),
    fields: 1,
    value: undefined,
  };
  const descriptor = fromPropertyDescriptorUpdate(
    update,
    undefined,
    keys,
    hooks,
    (value) => value,
  );
  assert.deepEqual(
    ownKeys(descriptor, (key) => -1),
    ["value"],
  );
  const getter = fromPropertyDescriptorUpdate(
    { ...update, fields: 4 },
    undefined,
    keys,
    hooks,
    (value) => value,
  );
  assert.deepEqual(
    ownKeys(getter, (key) => -1),
    ["get"],
  );
  const empty = fromPropertyDescriptorUpdate(
    { ...update, fields: 0 },
    undefined,
    keys,
    hooks,
    (value) => value,
  );
  assert.deepEqual(
    ownKeys(empty, (key) => -1),
    [],
  );
});
