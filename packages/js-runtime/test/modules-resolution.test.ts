import assert from "node:assert/strict";
import test from "node:test";
import * as modules from "../src/modules/index.ts";
import {
  createErrorRealm,
  createObject,
  type ObjectHooks,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import {
  createMutableBinding,
  hasBinding,
  getBindingValue,
} from "@tint/js-runtime/environments/records";
import type {
  SourceModuleShape,
  ModuleRecord,
} from "../src/modules/records.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected call"),
};
const realm = createErrorRealm(
  createObject<ScriptPropertyKey, unknown>(undefined),
  hooks,
);
function record(
  parts: Partial<SourceModuleShape> = {},
  names: readonly string[] = [],
): ModuleRecord {
  const shape: SourceModuleShape = {
    requests: [],
    imports: [],
    localExports: [],
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

test("module records predeclare cells without initialization or execution", () => {
  assert.equal(typeof modules.createSourceTextModule, "function");
  let instantiated = 0;
  const module = modules.createSourceTextModule(
    realm,
    {
      requests: [request("./a")],
      imports: [{ request: 0, importName: undefined, localName: "ns" }],
      localExports: [],
      indirectExports: [],
      starExports: [],
      hasTopLevelAwait: false,
    },
    42,
    (environment) => {
      createMutableBinding(environment, "x", false);
    },
    () => {
      instantiated++;
    },
    (): void => {},
  );
  assert.equal(module.kind, "module");
  assert.equal(module.realm, realm);
  assert.equal(module.hostDefined, 42);
  assert.equal(module.status, "new");
  assert.deepEqual(module.loaded, [undefined]);
  assert.equal(module.environmentInitialized, false);
  assert.equal(instantiated, 0);
  assert.equal(hasBinding(module.environment, "x"), true);
  assert.equal(getBindingValue(module.environment, "x").error, "reference");
  assert.equal(hasBinding(module.environment, "ns"), false);
  assert.equal(getBindingValue(module.environment, "ns").error, "reference");
});
test("local exports resolve by binding identity and preserve arbitrary names", () => {
  const module = record(
    {
      localExports: [
        { exportName: "a b", localName: "value" },
        { exportName: "default", localName: "value" },
      ],
    },
    ["value"],
  );
  assert.deepEqual(modules.getExportedNames(module), ["a b", "default"]);
  assert.deepEqual(modules.resolveExport(module, "a b"), {
    module,
    bindingName: "value",
  });
  assert.equal(modules.resolveExport(module, "missing"), undefined);
});
test("named re-exports and namespace exports resolve to their defining module", () => {
  const target = record(
      { localExports: [{ exportName: "x", localName: "v" }] },
      ["v"],
    ),
    module = record({
      requests: [request("./target")],
      indirectExports: [
        { exportName: "renamed", request: 0, importName: "x" },
        { exportName: "ns", request: 0, importName: undefined },
      ],
    });
  module.loaded[0] = target;
  assert.deepEqual(modules.resolveExport(module, "renamed"), {
    module: target,
    bindingName: "v",
  });
  assert.deepEqual(modules.resolveExport(module, "ns"), {
    module: target,
    bindingName: undefined,
  });
});
test("star exports exclude default while explicit names override ambiguous stars", () => {
  const a = record(
      {
        localExports: [
          { exportName: "x", localName: "x" },
          { exportName: "default", localName: "x" },
        ],
      },
      ["x"],
    ),
    b = record({ localExports: [{ exportName: "x", localName: "x" }] }, ["x"]);
  const root = record({
    requests: [request("a"), request("b")],
    starExports: [0, 1],
  });
  root.loaded[0] = a;
  root.loaded[1] = b;
  assert.deepEqual(modules.getExportedNames(root), ["x"]);
  assert.equal(modules.resolveExport(root, "default"), undefined);
  assert.equal(modules.resolveExport(root, "x"), "ambiguous");
  const explicit = record(
    {
      requests: [request("a"), request("b")],
      starExports: [0, 1],
      localExports: [{ exportName: "x", localName: "own" }],
    },
    ["own"],
  );
  explicit.loaded[0] = a;
  explicit.loaded[1] = b;
  assert.deepEqual(modules.resolveExport(explicit, "x"), {
    module: explicit,
    bindingName: "own",
  });
});
test("diamond stars retain one shared binding without false ambiguity", () => {
  const leaf = record({ localExports: [{ exportName: "x", localName: "x" }] }, [
    "x",
  ]);
  const a = record({ requests: [request("leaf")], starExports: [0] }),
    b = record({ requests: [request("leaf")], starExports: [0] }),
    root = record({
      requests: [request("a"), request("b")],
      starExports: [0, 1],
    });
  a.loaded[0] = leaf;
  b.loaded[0] = leaf;
  root.loaded[0] = a;
  root.loaded[1] = b;
  assert.deepEqual(modules.getExportedNames(root), ["x"]);
  assert.deepEqual(modules.resolveExport(root, "x"), {
    module: leaf,
    bindingName: "x",
  });
});
test("cyclic stars and indirect exports terminate without inventing bindings", () => {
  const a = record(
      {
        requests: [request("b")],
        starExports: [0],
        localExports: [{ exportName: "a", localName: "a" }],
      },
      ["a"],
    ),
    b = record(
      {
        requests: [request("a")],
        starExports: [0],
        localExports: [{ exportName: "b", localName: "b" }],
      },
      ["b"],
    );
  a.loaded[0] = b;
  b.loaded[0] = a;
  assert.deepEqual(modules.getExportedNames(a), ["a", "b"]);
  assert.equal(modules.resolveExport(a, "absent"), undefined);
  const x = record({
      requests: [request("y")],
      indirectExports: [{ exportName: "x", request: 0, importName: "x" }],
    }),
    y = record({
      requests: [request("x")],
      indirectExports: [{ exportName: "x", request: 0, importName: "x" }],
    });
  x.loaded[0] = y;
  y.loaded[0] = x;
  assert.equal(modules.resolveExport(x, "x"), undefined);
});
test("ambiguity propagates and namespace targets differ from named targets", () => {
  const leaf = record({ localExports: [{ exportName: "x", localName: "x" }] }, [
      "x",
    ]),
    a = record({
      requests: [request("leaf")],
      indirectExports: [{ exportName: "x", request: 0, importName: undefined }],
    }),
    b = record({
      requests: [request("leaf")],
      indirectExports: [{ exportName: "x", request: 0, importName: "x" }],
    }),
    root = record({
      requests: [request("a"), request("b")],
      starExports: [0, 1],
    });
  a.loaded[0] = leaf;
  b.loaded[0] = leaf;
  root.loaded[0] = a;
  root.loaded[1] = b;
  assert.equal(modules.resolveExport(root, "x"), "ambiguous");
  const top = record({ requests: [request("root")], starExports: [0] });
  top.loaded[0] = root;
  assert.equal(modules.resolveExport(top, "x"), "ambiguous");
});
test("export queries reject unloaded graph edges as host invariants", () => {
  const module = record({ requests: [request("missing")], starExports: [0] });
  assert.throws(
    () => modules.getExportedNames(module),
    (e) => e === "MODULE_LOADED_INVARIANT",
  );
  assert.throws(
    () => modules.resolveExport(module, "x"),
    (e) => e === "MODULE_LOADED_INVARIANT",
  );
  module.status = "new";
  assert.throws(
    () => modules.resolveExport(module, "x"),
    (e) => e === "MODULE_LOADED_INVARIANT",
  );
});

test("record shapes reject imported names left as local exports before declaring cells", () => {
  let declared = false;
  const shape: SourceModuleShape = {
    requests: [request("./leaf")],
    imports: [{ request: 0, importName: undefined, localName: "ns" }],
    localExports: [{ exportName: "ns", localName: "ns" }],
    indirectExports: [],
    starExports: [],
    hasTopLevelAwait: false,
  };
  assert.throws(
    () =>
      modules.createSourceTextModule(
        realm,
        shape,
        undefined,
        () => {
          declared = true;
        },
        () => {},
        (): void => {},
      ),
    (error) => error === "MODULE_SHAPE_INVARIANT",
  );
  assert.equal(declared, false);
});
test("multiple re-export routes to the same namespace are unambiguous", () => {
  const leaf = record(),
    shape: SourceModuleShape = {
      requests: [request("./leaf")],
      imports: [{ request: 0, importName: undefined, localName: "local" }],
      localExports: [],
      indirectExports: [
        { exportName: "ns", request: 0, importName: undefined },
      ],
      starExports: [],
      hasTopLevelAwait: false,
    };
  const a = record(shape),
    b = record(shape),
    root = record({
      requests: [request("./a"), request("./b")],
      starExports: [0, 1],
    });
  a.loaded[0] = leaf;
  b.loaded[0] = leaf;
  root.loaded[0] = a;
  root.loaded[1] = b;
  assert.deepEqual(modules.resolveExport(root, "ns"), {
    module: leaf,
    bindingName: undefined,
  });
});
