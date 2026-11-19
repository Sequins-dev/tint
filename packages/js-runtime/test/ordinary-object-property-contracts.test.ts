import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyUpdate,
  valueField,
  getField,
} from "@tint/js-runtime/descriptors";
import * as operations from "../src/objects/operations.ts";

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
  assert.equal(existingAccessor.internalPropertyContract, undefined);
  operations.createDataProperty(object, "mode", "ready", hooks);
  enrollObjectPropertyContract(object, schema, realm);
  const contract = object.internalPropertyContract;
  enrollObjectPropertyContract(object, schema, realm);
  assert.equal(contract, object.internalPropertyContract);
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
