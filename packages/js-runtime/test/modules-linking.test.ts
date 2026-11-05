import assert from "node:assert/strict";
import test from "node:test";
import * as modules from "../src/modules/index.ts";
import * as objects from "../src/objects/index.ts";
import {
  createMutableBinding,
  initializeBinding,
  getBindingValue,
  setMutableBinding,
  hasBinding,
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
  initialize: (module: ModuleRecord) => void = () => {},
): ModuleRecord {
  let current: ModuleRecord | undefined;
  const module = modules.createSourceTextModule(
    realm,
    {
      requests: [],
      imports: [],
      localExports: names.map((name) => ({
        exportName: name,
        localName: name,
      })),
      indirectExports: [],
      starExports: [],
      hasTopLevelAwait: false,
      ...parts,
    },
    undefined,
    (environment) => {
      for (const name of names) createMutableBinding(environment, name, false);
    },
    () => {
      assert.ok(current);
      initialize(current);
    },
    (): void => {},
  );
  current = module;
  module.status = "unlinked";
  return module;
}
const request = (specifier: string) => ({ specifier, attributes: [] });

test("linking initializes dependencies in source-order post-order exactly once", () => {
  assert.equal(typeof modules.linkModule, "function");
  const log: string[] = [];
  const a = record(["x"], {}, (module) => {
      log.push("a");
      initializeBinding(module.environment, "x", 42);
    }),
    b = record([], {}, () => {
      log.push("b");
    }),
    root = record([], { requests: [request("a"), request("b")] }, () => {
      log.push("root");
    });
  root.loaded[0] = a;
  root.loaded[1] = b;
  assert.deepEqual(modules.linkModule(root), { ok: true });
  assert.deepEqual(log, ["a", "b", "root"]);
  assert.deepEqual(
    [root.status, a.status, b.status],
    ["linked", "linked", "linked"],
  );
  assert.deepEqual(modules.linkModule(root), { ok: true });
  assert.deepEqual(log, ["a", "b", "root"]);
});
test("cyclic import cells are connected before the exporting module initializes", () => {
  const log: string[] = [];
  const a = record(["x"], { requests: [request("b")] }, (module) => {
      log.push("a");
      initializeBinding(module.environment, "x", 42);
    }),
    b = record(
      [],
      {
        requests: [request("a")],
        imports: [{ request: 0, importName: "x", localName: "alias" }],
      },
      (module) => {
        log.push("b");
        assert.equal(
          getBindingValue(module.environment, "alias").error,
          "reference",
        );
        assert.equal(
          setMutableBinding(module.environment, "alias", 7, false),
          "type",
        );
      },
    );
  a.loaded[0] = b;
  b.loaded[0] = a;
  assert.deepEqual(modules.linkModule(a), { ok: true });
  assert.deepEqual(log, ["b", "a"]);
  assert.equal(getBindingValue(b.environment, "alias").value, 42);
  setMutableBinding(a.environment, "x", 19, true);
  assert.equal(getBindingValue(b.environment, "alias").value, 19);
});
test("namespace imports and named imports resolving to namespaces get immutable local cells", () => {
  const leaf = record(),
    bridge = record([], {
      requests: [request("leaf")],
      indirectExports: [
        { exportName: "ns", request: 0, importName: undefined },
      ],
    }),
    root = record([], {
      requests: [request("leaf"), request("bridge")],
      imports: [
        { request: 0, importName: undefined, localName: "star" },
        { request: 1, importName: "ns", localName: "named" },
      ],
    });
  bridge.loaded[0] = leaf;
  root.loaded[0] = leaf;
  root.loaded[1] = bridge;
  assert.equal(hasBinding(root.environment, "star"), false);
  assert.deepEqual(modules.linkModule(root), { ok: true });
  const namespace = modules.getModuleNamespace(leaf);
  assert.equal(getBindingValue(root.environment, "star").value, namespace);
  assert.equal(getBindingValue(root.environment, "named").value, namespace);
  assert.equal(setMutableBinding(root.environment, "named", 7, false), "type");
});
test("missing and ambiguous imports return SyntaxErrors before committing any bindings", () => {
  const a = record(["x"], {}, (module) =>
      initializeBinding(module.environment, "x", 42),
    ),
    b = record(["x"], {}, (module) =>
      initializeBinding(module.environment, "x", 19),
    ),
    star = record([], {
      requests: [request("a"), request("b")],
      starExports: [0, 1],
    });
  star.loaded[0] = a;
  star.loaded[1] = b;
  for (const name of ["missing", "x"]) {
    const root = record([], {
      requests: [request("a"), request("star")],
      imports: [
        { request: 0, importName: "x", localName: "first" },
        { request: 1, importName: name, localName: "second" },
      ],
    });
    root.loaded[0] = a;
    root.loaded[1] = star;
    const result = modules.linkModule(root);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("link should reject");
    assert.equal(
      (
        result.error as objects.OrdinaryObject<
          objects.ScriptPropertyKey,
          unknown
        >
      ).prototype,
      realm.prototypes.get("syntax"),
    );
    assert.equal(root.status, "unlinked");
    assert.equal(hasBinding(root.environment, "first"), false);
    assert.equal(root.environmentInitialized, false);
  }
});
test("unresolved explicit re-exports fail while ambiguous stars alone can link", () => {
  const a = record(["x"]),
    b = record(["x"]),
    star = record([], {
      requests: [request("a"), request("b")],
      starExports: [0, 1],
    });
  star.loaded[0] = a;
  star.loaded[1] = b;
  assert.deepEqual(modules.linkModule(star), { ok: true });
  const root = record([], {
    requests: [request("star")],
    indirectExports: [{ exportName: "x", request: 0, importName: "x" }],
  });
  root.loaded[0] = star;
  assert.equal(modules.linkModule(root).ok, false);
  assert.equal(root.status, "unlinked");
});
test("failed retries preserve completed child groups and do not repeat committed initialization", () => {
  const log: string[] = [];
  const root = record([], {
      requests: [request("cycle"), request("child")],
      imports: [{ request: 1, importName: "absent", localName: "missing" }],
    }),
    cycle = record(["x"], { requests: [request("root")] }, (module) => {
      log.push("cycle");
      initializeBinding(module.environment, "x", 42);
    }),
    child = record([], {}, () => {
      log.push("child");
    });
  root.loaded[0] = cycle;
  root.loaded[1] = child;
  cycle.loaded[0] = root;
  const first = modules.linkModule(root),
    second = modules.linkModule(root);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (first.ok || second.ok) assert.fail("link should reject");
  assert.notEqual(first.error, second.error);
  assert.deepEqual(log, ["cycle", "child"]);
  assert.deepEqual(
    [root.status, cycle.status, child.status],
    ["unlinked", "unlinked", "linked"],
  );
  assert.equal(cycle.environmentInitialized, true);
});
test("hoisted function contexts use the module identity and restore the linking caller", () => {
  const outside = {},
    root = record([], {}, (module) => {
      assert.equal(realm.agent.activeContext?.realm, realm);
      assert.equal(realm.agent.activeContext?.scriptOrModule, module);
    });
  objects.runScriptContext(
    realm.agent,
    { realm, scriptOrModule: outside },
    () => {
      assert.deepEqual(modules.linkModule(root), { ok: true });
      assert.equal(realm.agent.activeContext?.scriptOrModule, outside);
    },
  );
  assert.equal(realm.agent.activeContext, undefined);
});
test("link SyntaxErrors use the active caller realm rather than the imported module's realm", () => {
  const other = objects.createErrorRealm(
      objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
      hooks,
      realm.symbolRegistry,
      realm.agent,
    ),
    leaf = record(),
    root = record([], {
      requests: [request("leaf")],
      imports: [{ request: 0, importName: "missing", localName: "x" }],
    });
  root.loaded[0] = leaf;
  const result = objects.runScriptContext(
    realm.agent,
    { realm: other, scriptOrModule: undefined },
    () => modules.linkModule(root),
  );
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("link should reject");
  assert.equal(
    (result.error as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>)
      .prototype,
    other.prototypes.get("syntax"),
  );
});
test("link invariants propagate and reset only modules still on the active stack", () => {
  const child = record(),
    root = record([], { requests: [request("child"), request("missing")] });
  root.loaded[0] = child;
  assert.throws(
    () => modules.linkModule(root),
    (error) => error === "MODULE_LOADED_INVARIANT",
  );
  assert.equal(root.status, "unlinked");
  assert.equal(child.status, "linked");
  const incomplete = record();
  incomplete.status = "new";
  assert.throws(
    () => modules.linkModule(incomplete),
    (error) => error === "MODULE_STATUS_INVARIANT",
  );
  const foreign = { ...record(), kind: "synthetic" } as unknown as ModuleRecord;
  assert.throws(
    () => modules.linkModule(foreign),
    (error) => error === "MODULE_KIND_INVARIANT",
  );
});
