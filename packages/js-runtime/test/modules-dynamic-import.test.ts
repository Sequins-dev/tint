import assert from "node:assert/strict";
import test from "node:test";
import type * as objectTypes from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts"),
  modules = await import("../src/modules/index.ts");
const hooks: objectTypes.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected call"),
};
function fixture() {
  const realm = objects.createErrorRealm(
    objects.createObject<objectTypes.ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  let executions = 0;
  const target = modules.createSourceTextModule(
    realm,
    {
      requests: [],
      imports: [],
      localExports: [],
      indirectExports: [],
      starExports: [],
      hasTopLevelAwait: false,
    },
    undefined,
    () => {},
    () => {},
    () => {
      executions++;
    },
  );
  const script = objects.createScriptRecord(realm, undefined);
  return { realm, target, script, executions: () => executions };
}
test("dynamic import creates fresh promises, passes the Script referrer and evaluates through jobs", () => {
  assert.equal(typeof modules.evaluateImportCall, "function");
  const { realm, target, script, executions } = fixture();
  let loads = 0;
  realm.moduleLoader = (referrer, request, host, payload) => {
    loads++;
    assert.equal(referrer, script);
    assert.deepEqual(request, { specifier: "./target", attributes: [] });
    assert.equal(host, undefined);
    modules.finishLoadingImportedModule(referrer, request, payload, {
      ok: true,
      module: target,
    });
  };
  const promises = objects.runScriptContext(
    realm.agent,
    { realm, scriptOrModule: script },
    () => [
      modules.evaluateImportCall("./target", undefined, hooks, realm),
      modules.evaluateImportCall("./target", undefined, hooks, realm),
    ],
  );
  assert.notEqual(promises[0], promises[1]);
  assert.equal(loads, 2);
  assert.equal(executions(), 0);
  for (const promise of promises)
    assert.equal(
      promise.internalExoticSlots?.internalPromiseData?.state,
      "pending",
    );
  objects.drainScriptJobs(realm.agent, () => assert.fail("job failed"));
  assert.equal(executions(), 1);
  for (const promise of promises) {
    assert.equal(
      promise.internalExoticSlots?.internalPromiseData?.state,
      "fulfilled",
    );
    assert.equal(
      promise.internalExoticSlots?.internalPromiseData?.result,
      modules.getModuleNamespace(target),
    );
  }
});
test("invalid options and with values reject with TypeError without calling the host", () => {
  const { realm } = fixture();
  realm.moduleLoader = () => assert.fail("invalid options reached loader");
  for (const options of [null, 42, "x", true]) {
    const promise = modules.evaluateImportCall(
      "./target",
      options,
      hooks,
      realm,
    );
    assert.equal(
      promise.internalExoticSlots?.internalPromiseData?.state,
      "rejected",
    );
    const error = objects.viewObjectValue(
      promise.internalExoticSlots?.internalPromiseData?.result,
      realm.objectPrototype,
    );
    assert.equal(error?.prototype, realm.prototypes.get("type"));
  }
  for (const value of [null, 42, "x", true]) {
    const options = objects.createObject<
      objectTypes.ScriptPropertyKey,
      unknown
    >(undefined);
    objects.createDataProperty(options, "with", value, hooks);
    const promise = modules.evaluateImportCall(
      "./target",
      options,
      hooks,
      realm,
    );
    assert.equal(
      promise.internalExoticSlots?.internalPromiseData?.state,
      "rejected",
    );
  }
});
test("specifier coercion failures reject before reading options", () => {
  const { realm } = fixture(),
    // Thrown values are JavaScript values: ordinary objects of the realm.
    marker = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    ),
    specifier = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
      undefined,
    );
  const conversion = objects.createCallableObject<
    objectTypes.ScriptPropertyKey,
    unknown
  >(realm.functionPrototype, () => {
    throw marker;
  });
  objects.createDataProperty(
    specifier,
    objects.wellKnownSymbol(realm.symbolRegistry, "toPrimitive"),
    conversion,
    hooks,
  );
  const promise = modules.evaluateImportCall(specifier, 42, hooks, realm);
  assert.equal(
    promise.internalExoticSlots?.internalPromiseData?.state,
    "rejected",
  );
  assert.equal(
    promise.internalExoticSlots?.internalPromiseData?.result,
    marker,
  );
});
test("non-string or unsupported import attributes reject before host loading", () => {
  const { realm } = fixture();
  realm.moduleLoader = () => assert.fail("bad attributes reached loader");
  for (const value of [42, "json"]) {
    const options = objects.createObject<
        objectTypes.ScriptPropertyKey,
        unknown
      >(undefined),
      attributes = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
        undefined,
      );
    objects.createDataProperty(attributes, "type", value, hooks);
    objects.createDataProperty(options, "with", attributes, hooks);
    const promise = modules.evaluateImportCall(
      "./target",
      options,
      hooks,
      realm,
    );
    assert.equal(
      promise.internalExoticSlots?.internalPromiseData?.state,
      "rejected",
    );
    assert.equal(
      objects.viewObjectValue(
        promise.internalExoticSlots?.internalPromiseData?.result,
        realm.objectPrototype,
      )?.prototype,
      realm.prototypes.get("type"),
    );
  }
});
test("a missing dynamic loader is sticky unsupported", () => {
  const { realm } = fixture();
  assert.throws(
    () => modules.evaluateImportCall("./target", undefined, hooks, realm),
    (error) => error === undefined,
  );
  assert.equal(realm.unsupported, true);
});

test("attribute descriptors and values are read in per-key order", () => {
  const { realm } = fixture(),
    log: string[] = [];
  const symbol = objects.wellKnownSymbol(realm.symbolRegistry, "iterator");
  const attributes = objects.createExoticObject<
    objectTypes.ScriptPropertyKey,
    unknown
  >(undefined, {
    ownKeys: () => {
      log.push("keys");
      return ["b", "a", "absent", "hidden", symbol];
    },
    getOwnProperty: (_object, key) => {
      log.push("descriptor:" + String(key));
      if (key === "absent") return undefined;
      return {
        accessor: false,
        value: key,
        writable: true,
        get: undefined,
        set: undefined,
        enumerable: key !== "hidden",
        configurable: true,
      };
    },
    get: (_object, key) => {
      log.push("value:" + String(key));
      return "value";
    },
  });
  const options = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
    undefined,
  );
  objects.createDataProperty(options, "with", attributes, hooks);
  realm.moduleLoader = () => assert.fail("unsupported attributes reached host");
  const promise = modules.evaluateImportCall("target", options, hooks, realm);
  assert.deepEqual(log, [
    "keys",
    "descriptor:b",
    "value:b",
    "descriptor:a",
    "value:a",
    "descriptor:absent",
    "descriptor:hidden",
  ]);
  assert.equal(
    promise.internalExoticSlots?.internalPromiseData?.state,
    "rejected",
  );
});
test("options getters reject with the original value while host faults escape", () => {
  const { realm } = fixture(),
    marker = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
  const options = objects.createExoticObject<
    objectTypes.ScriptPropertyKey,
    unknown
  >(undefined, {
    get: () => {
      throw marker;
    },
  });
  const rejected = modules.evaluateImportCall("target", options, hooks, realm);
  assert.equal(
    rejected.internalExoticSlots?.internalPromiseData?.state,
    "rejected",
  );
  assert.equal(
    rejected.internalExoticSlots?.internalPromiseData?.result,
    marker,
  );
  realm.moduleLoader = () => {
    throw marker;
  };
  assert.throws(
    () => modules.evaluateImportCall("target", undefined, hooks, realm),
    (error) => error === marker,
  );
});
test("dynamic promises and options TypeErrors use the active caller realm", () => {
  const { realm, script } = fixture();
  const caller = objects.createErrorRealm(
    objects.createObject<objectTypes.ScriptPropertyKey, unknown>(undefined),
    hooks,
    realm.symbolRegistry,
    realm.agent,
  );
  objects.runScriptContext(
    realm.agent,
    { realm: caller, scriptOrModule: script },
    () => {
      const rejected = modules.evaluateImportCall("target", 42, hooks, realm);
      assert.equal(rejected.prototype, caller.promisePrototype);
      assert.equal(
        objects.viewObjectValue(
          rejected.internalExoticSlots?.internalPromiseData?.result,
          realm.objectPrototype,
        )?.prototype,
        caller.prototypes.get("type"),
      );
    },
  );
});
