import { test } from "node:test";
import assert from "node:assert/strict";
import * as o from "../src/objects/index.ts";
import {
  createByteStorage,
  copyImmutableByteStorage,
  resizeByteStorage,
  detachByteStorage,
} from "@tint/js-runtime/bytes";
const hooks: o.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => {
    throw new Error("unexpected call");
  },
};
function setup() {
  assert.equal(typeof o.createTypedArrayView, "function");
  const root = o.createObject<o.ScriptPropertyKey, unknown>(undefined),
    realm = o.createErrorRealm(root, hooks);
  const result = createByteStorage(8, 16, true, 16);
  assert.ok(result.ok);
  const storage = result.value,
    buffer = o.createObject<o.ScriptPropertyKey, unknown>(undefined);
  o.ensureExoticSlots(buffer).internalArrayBufferData = storage;
  const data: o.TypedArrayData = {
    buffer,
    storage,
    byteOffset: 2,
    length: 2,
    kind: "Uint16",
    endian: "little",
  };
  const fixed = o.createTypedArrayView(root, data, realm, hooks);
  const tracking = o.createTypedArrayView(
    root,
    { ...data, length: undefined },
    realm,
    hooks,
  );
  return { fixed, tracking, storage };
}
test("typed-array views share byte storage and reacquire it across resize", () => {
  const { fixed, tracking, storage } = setup();
  assert.ok(
    o.setProperty(fixed, "0", 65537, { object: fixed, value: fixed }, hooks),
  );
  assert.equal(o.getProperty(tracking, "0", tracking, hooks), 1);
  assert.deepEqual(
    o.ownKeys(tracking, () => -1),
    ["0", "1", "2"],
  );
  assert.equal(resizeByteStorage(storage, 4), "none");
  assert.equal(o.getProperty(fixed, "0", fixed, hooks), undefined);
  assert.equal(o.getProperty(tracking, "0", tracking, hooks), 1);
  assert.equal(resizeByteStorage(storage, 8), "none");
  assert.equal(o.getProperty(fixed, "0", fixed, hooks), 1);
  assert.equal(o.getProperty(fixed, "1", fixed, hooks), 0);
  detachByteStorage(storage);
  assert.deepEqual(
    o.ownKeys(fixed, () => -1),
    [],
  );
  assert.equal(o.hasProperty(tracking, "0"), false);
  assert.equal(o.exoticSlots(fixed).internalArrayBufferView, true);
});
test("typed-array indexed access preserves negative zero distinction", () => {
  const { fixed } = setup();
  assert.equal(o.getProperty(fixed, "-0", fixed, hooks), undefined);
  assert.equal(o.hasProperty(fixed, "-0"), false);
  assert.equal(o.getProperty(fixed, "0", fixed, hooks), 0);
  assert.equal(o.preventExtensions(fixed), false);
});

test("byte-range projection uses internal slots and shares the real backing", () => {
  const { fixed, tracking, storage } = setup();
  const data = o.exoticSlots(fixed).internalTypedArrayData!;
  const view = o.createObject<o.ScriptPropertyKey, unknown>(undefined);
  o.ensureExoticSlots(view).internalDataViewData = {
    buffer: data.buffer,
    storage,
    byteOffset: 3,
    byteLength: 2,
  };
  const precise = o.projectArrayBufferViewRange(fixed)!;
  const alias = o.projectArrayBufferViewRange(view)!;
  assert.equal(precise.byteOffset, 2);
  assert.equal(precise.byteLength, 4);
  assert.equal(alias.byteOffset, 3);
  assert.equal(alias.byteLength, 2);
  assert.equal(precise.bytes, alias.bytes);
  alias.bytes![3] = 1;
  assert.equal(o.getOwnProperty(fixed, "0")?.value, 256);
  assert.equal(resizeByteStorage(storage, 2), "none");
  const outside = o.projectArrayBufferViewRange(fixed)!;
  assert.equal(outside.kind, "ordinary");
  assert.equal(outside.byteLength, 0);
  assert.equal(outside.byteOffset, 0);
  assert.equal(outside.bytes?.length, 2);
  const empty = o.projectArrayBufferViewRange(tracking)!;
  assert.equal(empty.byteLength, 0);
  assert.equal(empty.byteOffset, 2);
  assert.equal(resizeByteStorage(storage, 8), "none");
  assert.equal(o.projectArrayBufferViewRange(fixed)!.byteLength, 4);
  assert.equal(detachByteStorage(storage), "none");
  const detached = o.projectArrayBufferViewRange(fixed)!;
  assert.equal(detached.kind, "detached");
  assert.equal(detached.bytes, undefined);
  assert.equal(detached.writable, false);
  assert.equal(o.projectArrayBufferViewRange(data.buffer), undefined);
});

test("immutable typed-array indices remain readable and reject writes without coercion", () => {
  const mutable = createByteStorage(2, 2, false, 16);
  assert.ok(mutable.ok);
  mutable.value.data!.set([19, 42]);
  const frozen = copyImmutableByteStorage(mutable.value, 0, 2, 2);
  assert.ok(frozen.ok);
  const root = o.createObject<o.ScriptPropertyKey, unknown>(undefined);
  const realm = o.createErrorRealm(root, hooks);
  const buffer = o.createObject<o.ScriptPropertyKey, unknown>(undefined);
  o.ensureExoticSlots(buffer).internalArrayBufferData = frozen.value;
  const view = o.createTypedArrayView(
    root,
    {
      buffer,
      storage: frozen.value,
      byteOffset: 0,
      length: 2,
      kind: "Uint8",
      endian: "little",
    },
    realm,
    hooks,
  );
  assert.equal(o.getProperty(view, "1", view, hooks), 42);
  for (const key of ["0", "-0", "NaN", "100"]) {
    // An object would require the native-only object view if coercion occurred.
    assert.equal(
      o.setProperty(view, key, root, { object: view, value: view }, hooks),
      false,
    );
  }
  const descriptor = o.getOwnProperty(view, "1")!;
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  assert.equal(o.preventExtensions(view), true);
  assert.equal(o.getProperty(view, "0", view, hooks), 19);
});

test("typedArrayElementAt reads exactly what the canonical string key reads", async () => {
  const { typedArrayElementAt } =
    await import("../src/objects/typed-array-data.ts");
  const { fixed, tracking, storage } = setup();
  // An inherited numeric property never answers a typed array's numeric key.
  assert.ok(o.createDataProperty(fixed.prototype!, "5", "inherited", hooks));
  assert.ok(
    o.setProperty(fixed, "1", 7, { object: fixed, value: fixed }, hooks),
  );
  const keys = [0, -0, 1, 2, 5, -1, 1.5, NaN, Infinity, -Infinity, 1e21];
  const check = (view: o.OrdinaryObject<o.ScriptPropertyKey, unknown>) => {
    for (const key of keys) {
      const expected = o.getProperty(view, String(key), view, hooks);
      assert.equal(
        typedArrayElementAt(
          o.exoticSlots(view).internalTypedArrayData!,
          key === 0 ? 0 : key,
        ),
        expected,
        String(key),
      );
    }
  };
  check(fixed);
  check(tracking);
  assert.equal(resizeByteStorage(storage, 4), "none");
  check(fixed);
  check(tracking);
  detachByteStorage(storage);
  check(fixed);
  check(tracking);
});
