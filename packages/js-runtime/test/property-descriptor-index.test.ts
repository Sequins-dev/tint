import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDescriptor,
  emptyUpdate,
  type Descriptor,
  type DescriptorUpdate,
} from "../src/descriptors/index.ts";
const getterA = () => 1,
  getterB = () => 2,
  setterA = (_value: unknown) => {},
  setterB = (_value: unknown) => {};
function native(update: DescriptorUpdate<unknown>): PropertyDescriptor {
  const result: PropertyDescriptor = {};
  if (update.fields & 1) result.value = update.value;
  if (update.fields & 2) result.writable = update.writable;
  if (update.fields & 4) Reflect.set(result, "get", update.get);
  if (update.fields & 8) Reflect.set(result, "set", update.set);
  if (update.fields & 16) result.enumerable = update.enumerable;
  if (update.fields & 32) result.configurable = update.configurable;
  return result;
}
function complete(descriptor: Descriptor<unknown>): PropertyDescriptor {
  return native({ ...descriptor, fields: descriptor.accessor ? 60 : 51 });
}
test("descriptor updates agree with Reflect.defineProperty across attributes and kind changes", () => {
  const currents: (Descriptor<unknown> | undefined)[] = [undefined];
  for (let bits = 0; bits < 16; bits++)
    currents.push({
      accessor: !!(bits & 8),
      value: NaN,
      writable: !!(bits & 1),
      get: getterA,
      set: setterA,
      enumerable: !!(bits & 2),
      configurable: !!(bits & 4),
    });
  for (const current of currents)
    for (const extensible of [false, true])
      for (let fields = 0; fields < 64; fields++)
        for (let bits = 0; bits < 8; bits++) {
          const update = {
            ...emptyUpdate<unknown>(undefined),
            fields,
            value: bits & 1 ? NaN : 0,
            writable: !!(bits & 1),
            get: bits & 1 ? getterA : getterB,
            set: bits & 1 ? setterA : setterB,
            enumerable: !!(bits & 2),
            configurable: !!(bits & 4),
          };
          const object = {};
          if (current !== undefined)
            Object.defineProperty(object, "x", complete(current));
          if (!extensible) Object.preventExtensions(object);
          let expected = "accepted";
          try {
            if (!Reflect.defineProperty(object, "x", native(update)))
              expected = "rejected";
          } catch (error) {
            assert.ok(error instanceof TypeError);
            expected = "invalid";
          }
          const result = applyDescriptor(
            current,
            extensible,
            update,
            undefined,
            Object.is,
          );
          assert.equal(
            result.status,
            expected,
            JSON.stringify({ current, extensible, fields, bits }),
          );
          if (result.status === "accepted") {
            assert.ok(result.descriptor);
            assert.deepEqual(
              complete(result.descriptor),
              Object.getOwnPropertyDescriptor(object, "x"),
            );
          } else assert.equal(result.descriptor, current);
        }
});
test("frozen data uses SameValue including NaN and signed zero", () => {
  for (const initial of [NaN, -0, 0, 1, undefined])
    for (const value of [NaN, -0, 0, 1, undefined]) {
      const current: Descriptor<unknown> = {
        accessor: false,
        value: initial,
        writable: false,
        get: undefined,
        set: undefined,
        enumerable: false,
        configurable: false,
      };
      const result = applyDescriptor(
        current,
        true,
        { ...emptyUpdate<unknown>(undefined), fields: 1, value },
        undefined,
        Object.is,
      );
      assert.equal(
        result.status,
        Object.is(initial, value) ? "accepted" : "rejected",
      );
    }
});
test("empty updates preserve existing descriptors and invalid masks never mutate", () => {
  const created = applyDescriptor<number>(
    undefined,
    true,
    emptyUpdate(0),
    0,
    (a, b) => a === b,
  );
  assert.equal(created.status, "accepted");
  assert.ok(created.descriptor);
  assert.deepEqual(created.descriptor, {
    accessor: false,
    value: 0,
    writable: false,
    get: 0,
    set: 0,
    enumerable: false,
    configurable: false,
  });
  assert.equal(
    applyDescriptor(
      created.descriptor,
      false,
      emptyUpdate(0),
      0,
      (a, b) => a === b,
    ).descriptor,
    created.descriptor,
  );
  for (const fields of [-1, 64, 1.5, NaN])
    assert.equal(
      applyDescriptor(
        created.descriptor,
        true,
        { ...emptyUpdate(0), fields },
        0,
        (a, b) => a === b,
      ).status,
      "invalid",
    );
});
