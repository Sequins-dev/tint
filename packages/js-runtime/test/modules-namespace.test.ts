import assert from "node:assert/strict";
import test from "node:test";
import * as modules from "../src/modules/index.ts";
import * as objects from "../src/objects/index.ts";
import {
  emptyUpdate,
  valueField,
  writableField,
  getField,
  enumerableField,
  configurableField,
} from "../src/descriptors/index.ts";
import {
  createMutableBinding,
  initializeBinding,
  setMutableBinding,
} from "../src/environments/records/index.ts";
import type {
  ModuleRecord,
  SourceModuleShape,
} from "../src/modules/records.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected call"),
};
const realm = objects.createErrorRealm(
  objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
  hooks,
);
function record(
  names: readonly string[] = [],
  parts: Partial<SourceModuleShape> = {},
): ModuleRecord {
  const shape: SourceModuleShape = {
    requests: [],
    imports: [],
    localExports: names.map((name) => ({ exportName: name, localName: name })),
    indirectExports: [],
    starExports: [],
    hasTopLevelAwait: false,
    ...parts,
  };
  const module = modules.createSourceTextModule(
    realm,
    shape,
    undefined,
    (environment) => {
      for (const name of names) createMutableBinding(environment, name, false);
    },
    () => {},
    (): void => {},
  );
  module.status = "unlinked";
  return module;
}
const request = (specifier: string) => ({ specifier, attributes: [] });
function referenceError(error: unknown, errorRealm = realm) {
  return (
    (error as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>)
      ?.prototype === errorRealm.prototypes.get("reference")
  );
}

test("namespace identity, null prototype, non-extensibility and fixed Module tag", () => {
  assert.equal(typeof modules.getModuleNamespace, "function");
  const module = record(),
    namespace = modules.getModuleNamespace(module),
    tag = objects.wellKnownSymbol(realm.symbolRegistry, "toStringTag");
  assert.equal(modules.getModuleNamespace(module), namespace);
  assert.equal(objects.getPrototype(namespace), undefined);
  assert.equal(objects.isExtensible(namespace), false);
  assert.equal(objects.preventExtensions(namespace), true);
  assert.equal(objects.setPrototype(namespace, undefined), true);
  assert.equal(objects.setPrototype(namespace, realm.objectPrototype), false);
  const descriptor = objects.getOwnProperty(namespace, tag);
  assert.ok(descriptor);
  assert.equal(descriptor.value, "Module");
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
});
test("namespace keys use UTF-16 lexical ordering even for numeric names and astral characters", () => {
  const names = ["2", "10", "z", "\uffff", "\u{10000}", ""],
    module = record(names),
    namespace = modules.getModuleNamespace(module);
  assert.deepEqual(
    objects.ownKeys(namespace, (key) => (typeof key === "string" ? -1 : -2)),
    [
      "",
      "10",
      "2",
      "z",
      "\u{10000}",
      "\uffff",
      objects.wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    ],
  );
});
test("namespace presence and key enumeration do not read TDZ exports", () => {
  const module = record(["x"]),
    namespace = modules.getModuleNamespace(module);
  assert.equal(objects.hasProperty(namespace, "x"), true);
  assert.equal(
    objects.getProperty(namespace, "missing", namespace, hooks),
    undefined,
  );
  assert.throws(
    () => objects.getProperty(namespace, "x", namespace, hooks),
    (error) => referenceError(error),
  );
  assert.throws(
    () => objects.getOwnProperty(namespace, "x"),
    (error) => referenceError(error),
  );
  initializeBinding(module.environment, "x", 19);
  assert.equal(objects.getProperty(namespace, "x", namespace, hooks), 19);
  setMutableBinding(module.environment, "x", 42, true);
  assert.equal(objects.getOwnProperty(namespace, "x")?.value, 42);
  assert.deepEqual(objects.getOwnProperty(namespace, "x"), {
    accessor: false,
    value: 42,
    writable: true,
    get: undefined,
    set: undefined,
    enumerable: true,
    configurable: false,
  });
});
test("namespace definitions preserve SameValue and reject incompatible changes", () => {
  const module = record(["x"]),
    namespace = modules.getModuleNamespace(module);
  initializeBinding(module.environment, "x", -0);
  const define = (fields: number, value: unknown = undefined) =>
    objects.defineOwnProperty(
      namespace,
      "x",
      {
        ...emptyUpdate<unknown>(undefined),
        fields,
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      },
      hooks,
    );
  assert.equal(define(0), "accepted");
  assert.equal(define(valueField, -0), "accepted");
  assert.equal(define(valueField, 0), "rejected");
  assert.equal(define(valueField, 42), "rejected");
  assert.equal(define(configurableField), "rejected");
  assert.equal(define(getField), "rejected");
  assert.equal(
    objects.defineOwnProperty(
      namespace,
      "x",
      {
        ...emptyUpdate<unknown>(undefined),
        fields: writableField,
        writable: false,
      },
      hooks,
    ),
    "rejected",
  );
  assert.equal(
    objects.defineOwnProperty(
      namespace,
      "x",
      {
        ...emptyUpdate<unknown>(undefined),
        fields: enumerableField,
        enumerable: false,
      },
      hooks,
    ),
    "rejected",
  );
  assert.equal(
    objects.defineOwnProperty(
      namespace,
      "missing",
      emptyUpdate(undefined),
      hooks,
    ),
    "rejected",
  );
  setMutableBinding(module.environment, "x", NaN, true);
  assert.equal(define(valueField, NaN), "accepted");
});
test("namespace writes, deletions and new symbol properties preserve the exotic boundary", () => {
  const module = record(["x"]),
    namespace = modules.getModuleNamespace(module),
    receiver = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    );
  initializeBinding(module.environment, "x", 42);
  assert.equal(
    objects.setProperty(
      namespace,
      "x",
      7,
      { object: receiver, value: receiver },
      hooks,
    ),
    false,
  );
  assert.equal(objects.getOwnProperty(receiver, "x"), undefined);
  assert.equal(objects.deleteProperty(namespace, "x"), false);
  assert.equal(objects.deleteProperty(namespace, "missing"), true);
  const tag = objects.wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    other = objects.createSymbolValue("other");
  assert.equal(objects.deleteProperty(namespace, tag), false);
  assert.equal(objects.deleteProperty(namespace, other), true);
  assert.equal(
    objects.defineOwnProperty(
      namespace,
      other,
      { ...emptyUpdate<unknown>(undefined), fields: valueField, value: 1 },
      hooks,
    ),
    "rejected",
  );
});
test("namespace construction filters ambiguous exports and retains namespace re-export identity", () => {
  const a = record(["x"]),
    b = record(["x"]),
    root = record([], {
      requests: [request("a"), request("b")],
      starExports: [0, 1],
      indirectExports: [
        { exportName: "ns", request: 0, importName: undefined },
      ],
    });
  root.loaded[0] = a;
  root.loaded[1] = b;
  const namespace = modules.getModuleNamespace(root);
  assert.equal(objects.hasProperty(namespace, "x"), false);
  assert.equal(
    objects.getProperty(namespace, "ns", namespace, hooks),
    modules.getModuleNamespace(a),
  );
});
test("namespace TDZ errors belong to the active caller realm", () => {
  const other = objects.createErrorRealm(
      objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
      hooks,
      realm.symbolRegistry,
      realm.agent,
    ),
    module = record(["x"]),
    namespace = modules.getModuleNamespace(module);
  assert.throws(
    () =>
      objects.runScriptContext(
        realm.agent,
        { realm: other, scriptOrModule: undefined },
        () => objects.getProperty(namespace, "x", namespace, hooks),
      ),
    (error) => referenceError(error, other),
  );
});
