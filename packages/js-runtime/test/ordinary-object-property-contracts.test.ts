import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyUpdate,
  valueField,
  getField,
} from "@tint/js-runtime/descriptors";
import * as operations from "../src/objects/operations.ts";

import { createArrayObject } from "../src/objects/arrays.ts";
import { createErrorRealm } from "../src/objects/errors.ts";
import {
  enrollObjectPropertyContract,
  type ObjectShapeContract,
} from "../src/objects/property-contracts.ts";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";

const hooks: operations.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};

test("storage contract guards direct sets, effective descriptors and deletions", () => {
  const object = operations.createObject<string, unknown>(undefined);
  operations.createDataProperty(object, "required", 1, hooks);
  // Cell caches hold descriptors of dictionary-mode objects (the global
  // object's).
  operations.useDictionaryProperties(object);
  const cache = operations.createPropertyCellCache<string, unknown>();
  assert.ok(operations.refreshPropertyCell(object, "required", cache));
  const receiver = { object, value: object };
  assert.equal(typeof operations.attachPropertyContract, "function");
  operations.attachPropertyContract(object, {
    schemas: [],
    beforeDefine(_key, descriptor) {
      if (descriptor.accessor || typeof descriptor.value !== "number")
        throw new TypeError("number data property required");
    },
    canDelete(key) {
      return key !== "required";
    },
  });
  assert.equal(operations.cachedPropertyCell(object, cache), undefined);
  assert.equal(
    operations.refreshPropertyCell(object, "required", cache),
    undefined,
  );
  assert.throws(
    () => operations.setProperty(object, "required", "bad", receiver, hooks),
    TypeError,
  );
  assert.throws(
    () =>
      operations.defineOwnProperty(
        object,
        "new",
        emptyUpdate(undefined),
        hooks,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      operations.defineOwnProperty(
        object,
        "required",
        {
          ...emptyUpdate(undefined),
          fields: getField,
        },
        hooks,
      ),
    TypeError,
  );
  assert.equal(operations.getOwnProperty(object, "required")?.value, 1);
  assert.equal(operations.getOwnProperty(object, "new"), undefined);
  assert.equal(operations.deleteProperty(object, "required"), false);
  assert.equal(
    operations.setProperty(object, "required", 2, receiver, hooks),
    true,
  );
  assert.equal(operations.getOwnProperty(object, "required")?.value, 2);
});

test("a rejected ECMAScript change does not invoke the storage contract", () => {
  const object = operations.createObject<string, unknown>(undefined);
  operations.defineOwnProperty(
    object,
    "nonwritable",
    {
      ...emptyUpdate<unknown>(undefined),
      fields: valueField,
      value: 1,
    },
    hooks,
  );
  assert.equal(typeof operations.attachPropertyContract, "function");
  operations.attachPropertyContract(object, {
    schemas: [],
    beforeDefine() {
      assert.fail("must skip guard for rejected writes");
    },
    canDelete() {
      assert.fail("must skip guard for rejected deletions");
    },
  });
  assert.equal(
    operations.defineOwnProperty(
      object,
      "nonwritable",
      {
        ...emptyUpdate<unknown>(undefined),
        fields: valueField,
        value: "bad",
      },
      hooks,
    ),
    "rejected",
  );
  assert.equal(operations.deleteProperty(object, "nonwritable"), false);
});

test("typed shapes conjoin fixed and index rules and reject an accessor at admission", () => {
  const prototype = operations.createObject<ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = createErrorRealm(prototype, hooks);
  const schema: ObjectShapeContract = {
    root: 2,
    types: [
      { kind: "string" },
      { kind: "literal", value: "ready" },
      {
        kind: "object",
        readonlyIndex: false,
        stringIndex: 0,
        fields: [{ name: "mode", value: 1, readonly: false, required: true }],
      },
    ],
  };
  const object = operations.createObject<ScriptPropertyKey, unknown>(prototype);
  const existingAccessor = operations.createObject<ScriptPropertyKey, unknown>(
    prototype,
  );
  operations.createAccessorProperty(
    existingAccessor,
    "mode",
    undefined,
    false,
    hooks,
  );
  const isRealmTypeError = (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "prototype" in error &&
    error.prototype === realm.prototypes.get("type");
  assert.throws(
    () => enrollObjectPropertyContract(existingAccessor, schema, realm),
    isRealmTypeError,
  );
  assert.equal(
    existingAccessor.internalRareSlots?.internalPropertyContract,
    undefined,
  );
  operations.createDataProperty(object, "mode", "ready", hooks);
  enrollObjectPropertyContract(object, schema, realm);
  const contract = object.internalRareSlots?.internalPropertyContract;
  enrollObjectPropertyContract(object, schema, realm);
  assert.equal(contract, object.internalRareSlots?.internalPropertyContract);
  assert.throws(
    () =>
      operations.setProperty(
        object,
        "mode",
        "busy",
        { object, value: object },
        hooks,
      ),
    isRealmTypeError,
  );
  assert.equal(operations.getOwnProperty(object, "mode")?.value, "ready");
  assert.equal(operations.deleteProperty(object, "mode"), false);
  assert.ok(operations.createDataProperty(object, "another", "open", hooks));
  assert.equal(operations.deleteProperty(object, "another"), true);
});

test("array contracts validate existing packed elements and guard later writes", () => {
  const prototype = operations.createObject<ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = createErrorRealm(prototype, hooks);
  const isRealmTypeError = (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "prototype" in error &&
    error.prototype === realm.prototypes.get("type");

  const schema: ObjectShapeContract = {
    root: 1,
    types: [
      { kind: "number" },
      { kind: "array-elements", element: 0, readonly: false },
    ],
  };
  const array = createArrayObject(
    0,
    realm.arrayPrototype,
    realm.arrayHooks,
    hooks,
  );
  operations.createDataProperty(array, "0", 7, hooks);
  operations.createDataProperty(array, "1", "bad", hooks);
  assert.throws(
    () => enrollObjectPropertyContract(array, schema, realm),
    isRealmTypeError,
  );
  assert.equal(array.internalRareSlots?.internalPropertyContract, undefined);
  assert.ok(array.internalArrayElements);
  operations.createDataProperty(array, "1", 8, hooks);
  enrollObjectPropertyContract(array, schema, realm);
  assert.throws(
    () =>
      operations.setProperty(
        array,
        "0",
        false,
        { object: array, value: array },
        hooks,
      ),
    isRealmTypeError,
  );
  assert.throws(
    () => operations.createDataProperty(array, "2", "bad", hooks),
    isRealmTypeError,
  );
  assert.equal(operations.getOwnProperty(array, "length")?.value, 2);
  assert.equal(operations.getOwnProperty(array, "0")?.value, 7);
  assert.equal(operations.getOwnProperty(array, "2"), undefined);
  assert.ok(operations.createDataProperty(array, "2", 42, hooks));
  assert.ok(operations.deleteProperty(array, "2"));
  assert.equal(operations.getOwnProperty(array, "length")?.value, 3);
  assert.ok(operations.createDataProperty(array, "metadata", "open", hooks));
});

test("contracted shapes and packed arrays defer dictionary unpacking until mutation and reject cached stores", () => {
  const prototype = operations.createObject<ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = createErrorRealm(prototype, hooks);
  const isRealmTypeError = (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "prototype" in error &&
    error.prototype === realm.prototypes.get("type");

  const obj = operations.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  operations.createDataProperty(obj, "a", 1, hooks);
  operations.createDataProperty(obj, "b", "ok", hooks);
  const originalShape = obj.internalShape;
  assert.ok(originalShape);

  const schemaA: ObjectShapeContract = {
    root: 0,
    types: [
      {
        kind: "object",
        stringIndex: -1,
        readonlyIndex: false,
        fields: [
          { name: "a", value: 1, required: true, readonly: false },
          { name: "b", value: 2, required: true, readonly: false },
        ],
      },
      { kind: "number" },
      { kind: "string" },
    ],
  };
  // Structurally identical schema with reordered fields & distinct types array.
  const schemaB: ObjectShapeContract = {
    root: 0,
    types: [
      {
        kind: "object",
        stringIndex: -1,
        readonlyIndex: false,
        fields: [
          { name: "b", value: 1, required: true, readonly: false },
          { name: "a", value: 2, required: true, readonly: false },
        ],
      },
      { kind: "string" },
      { kind: "number" },
    ],
  };

  enrollObjectPropertyContract(obj, schemaA, realm);
  // Stays in fast shape mode on a distinct contracted shape until mutated.
  assert.equal(
    (obj.internalFlags & operations.objectFlagDictionary) === 0,
    true,
  );
  assert.notEqual(obj.internalShape, originalShape);
  assert.equal(obj.internalRareSlots?.properties, undefined);
  // Cached store must refuse contracted objects.
  const storeCache = operations.createScriptPropertyCache();
  assert.equal(
    operations.storeCachedScriptProperty(obj, "a", "bad", storeCache, 0),
    false,
  );
  // Structurally equivalent schema hits attached() O(1) without re-enrolling.
  const beforeContract = obj.internalRareSlots?.internalPropertyContract;
  enrollObjectPropertyContract(obj, schemaB, realm);
  assert.equal(obj.internalRareSlots?.internalPropertyContract, beforeContract);
  // Invalid write transitions lazily to dictionary mode and throws TypeError.
  assert.throws(
    () =>
      operations.setProperty(
        obj,
        "a",
        "bad",
        { object: obj, value: obj },
        hooks,
      ),
    isRealmTypeError,
  );
  assert.equal(operations.getOwnProperty(obj, "a")?.value, 1);
  assert.equal(operations.deleteProperty(obj, "a"), false);
  assert.equal(
    operations.setProperty(obj, "a", 42, { object: obj, value: obj }, hooks),
    true,
  );
  assert.equal(operations.getOwnProperty(obj, "a")?.value, 42);

  // Packed arrays defer unpacking to internalContractedElements until mutated.
  const arr = createArrayObject(
    0,
    realm.arrayPrototype,
    realm.arrayHooks,
    hooks,
  );
  operations.createDataProperty(arr, "0", 10, hooks);
  operations.createDataProperty(arr, "1", 20, hooks);
  const arrSchema: ObjectShapeContract = {
    root: 0,
    types: [
      { kind: "array-elements", element: 1, readonly: false },
      { kind: "number" },
    ],
  };
  enrollObjectPropertyContract(arr, arrSchema, realm);
  assert.equal(arr.internalArrayElements, undefined);
  assert.ok(arr.internalRareSlots?.internalContractedElements);
  assert.equal(arr.internalRareSlots?.properties, undefined);
  assert.equal(operations.getOwnProperty(arr, "1")?.value, 20);
  assert.equal(operations.getOwnProperty(arr, "length")?.value, 2);
  assert.throws(
    () =>
      operations.setProperty(
        arr,
        "0",
        "bad",
        { object: arr, value: arr },
        hooks,
      ),
    isRealmTypeError,
  );
  assert.equal(arr.internalRareSlots?.internalContractedElements, undefined);
  assert.equal(operations.getOwnProperty(arr, "0")?.value, 10);
});
