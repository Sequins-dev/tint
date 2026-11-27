import assert from "node:assert/strict";
import test from "node:test";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type {
  ObjectHooks,
  ScriptPropertyKey,
  ScriptCompletionRecord,
} from "../src/objects/index.ts";
import type {
  SourceModuleShape,
  ModuleRecord,
} from "../src/modules/records.ts";
import type { SourceModuleDeclarations } from "../src/modules/source.ts";
import type { EnvironmentScope } from "../src/environments/global/index.ts";
import type { DeclarativeEnvironment } from "../src/environments/records/index.ts";
import {
  findBinding,
  bindingCount,
} from "../src/environments/records/index.ts";
bindHostRecordViews();
const modules = await import("../src/modules/index.ts"),
  objects = await import("../src/objects/index.ts"),
  bindings = await import("../src/environments/records/index.ts"),
  globals = await import("../src/environments/global/index.ts");
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected call"),
};
const empty: SourceModuleShape = {
  requests: [],
  imports: [],
  localExports: [],
  indirectExports: [],
  starExports: [],
  hasTopLevelAwait: false,
};
const noDeclarations: SourceModuleDeclarations = {
  variables: [],
  lexical: [],
  functions: [],
};
function fixture() {
  const object = objects.createObject<ScriptPropertyKey, unknown>(undefined),
    realm = objects.createErrorRealm(object, hooks),
    global = globals.createGlobalEnvironment(
      object,
      object,
      undefined,
      (name) => name,
      hooks,
    );
  return { object, realm, global };
}
function source(
  declarations: SourceModuleDeclarations = noDeclarations,
  body: (
    scope: EnvironmentScope<ScriptPropertyKey, unknown>,
    environment: DeclarativeEnvironment<unknown>,
  ) => ScriptCompletionRecord = () => ({ error: "none", value: undefined }),
  instantiate: (
    scope: EnvironmentScope<ScriptPropertyKey, unknown>,
    environment: DeclarativeEnvironment<unknown>,
  ) => readonly unknown[] = () => [],
  shape: SourceModuleShape = empty,
) {
  const f = fixture();
  return {
    ...f,
    module: modules.createLoweredSourceModule(
      f.global,
      f.realm,
      undefined,
      shape,
      declarations,
      instantiate,
      body,
    ),
  };
}
test("lowered modules declare every cell before loading and reject absent local-export cells", () => {
  assert.equal(typeof modules.createLoweredSourceModule, "function");
  const { module } = source({
    variables: ["v", "v"],
    lexical: [
      { name: "l", constant: false },
      { name: "c", constant: true },
      { name: "*default*", constant: false },
    ],
    functions: ["f"],
  });
  // Inline slots fill in declaration order before the overflow map.
  const environment = module.environment,
    names = [
      environment.name0,
      environment.name1,
      environment.name2,
      environment.name3,
      ...(environment.overflow?.keys() ?? []),
    ].filter((name): name is string => name !== undefined);
  assert.deepEqual(names, ["v", "f", "l", "c", "*default*"]);
  for (const name of names)
    assert.equal(findBinding(environment, name)?.initialized, false);
  assert.throws(
    () =>
      source(noDeclarations, undefined, undefined, {
        ...empty,
        localExports: [{ exportName: "bad", localName: "absent" }],
      }),
    (error) => error === "MODULE_SHAPE_INVARIANT",
  );
});
test("hoisted module functions capture the module and work through shared cycle imports before evaluation", () => {
  const { global, realm } = fixture();
  let owner: ModuleRecord | undefined;
  const a = modules.createLoweredSourceModule(
    global,
    realm,
    undefined,
    {
      ...empty,
      requests: [{ specifier: "b", attributes: [] }],
      localExports: [{ exportName: "f", localName: "f" }],
    },
    { variables: [], lexical: [], functions: ["f"] },
    () => {
      assert.equal(realm.agent.activeContext?.scriptOrModule, owner);
      return [
        objects.createSourceFunction(() => 42, true, realm, hooks, "f", 0),
      ];
    },
    () => ({ error: "none", value: undefined }),
  );
  owner = a;
  const b = modules.createLoweredSourceModule(
    global,
    realm,
    undefined,
    {
      ...empty,
      requests: [{ specifier: "a", attributes: [] }],
      imports: [{ request: 0, importName: "f", localName: "alias" }],
    },
    noDeclarations,
    () => [],
    () => ({ error: "none", value: undefined }),
  );
  a.status = "unlinked";
  b.status = "unlinked";
  a.loaded[0] = b;
  b.loaded[0] = a;
  assert.equal(modules.linkModule(a).ok, true);
  assert.equal(
    findBinding(a.environment, "f"),
    findBinding(b.environment, "alias"),
  );
  assert.equal(
    objects.callObjectValue(
      bindings.getBindingValue(b.environment, "alias").value,
      undefined,
      [],
      realm.objectPrototype,
    ).value,
    42,
  );
  assert.equal(a.status, "linked");
});
test("linking initializes var and hoisted functions while preserving lexical TDZ", () => {
  const { module } = source(
    {
      variables: ["v", "v"],
      lexical: [
        { name: "l", constant: false },
        { name: "c", constant: true },
        { name: "*default*", constant: false },
      ],
      functions: ["f"],
    },
    undefined,
    () => [42],
  );
  module.status = "unlinked";
  assert.equal(modules.linkModule(module).ok, true);
  assert.equal(bindings.getBindingValue(module.environment, "v").error, "none");
  assert.equal(
    bindings.getBindingValue(module.environment, "v").value,
    undefined,
  );
  assert.equal(bindings.getBindingValue(module.environment, "f").value, 42);
  for (const name of ["l", "c", "*default*"])
    assert.equal(
      bindings.getBindingValue(module.environment, name).error,
      "reference",
    );
});
test("module completion maps thrown values and sticky unsupported without inventing errors", () => {
  const normal = source(),
    thrown = source(noDeclarations, () => ({ error: "throw", value: error })),
    unsupported = source(noDeclarations, () => ({
      error: "unsupported",
      value: 42,
    })),
    // Thrown values are JavaScript values: ordinary objects of the realm.
    error = objects.createObject<ScriptPropertyKey, unknown>(
      thrown.realm.objectPrototype,
    );
  for (const f of [normal, thrown, unsupported]) {
    f.module.status = "unlinked";
    assert.equal(modules.linkModule(f.module).ok, true);
  }
  assert.equal(
    modules.evaluateModule(normal.module, hooks).internalRareSlots
      ?.internalExoticSlots?.internalPromiseData?.state,
    "fulfilled",
  );
  assert.equal(
    modules.evaluateModule(thrown.module, hooks).internalRareSlots
      ?.internalExoticSlots?.internalPromiseData?.result,
    error,
  );
  modules.evaluateModule(unsupported.module, hooks);
  assert.equal(unsupported.realm.unsupported, true);
});
test("a hoisted factory arity mismatch is an uncached linker invariant", () => {
  const { module } = source({ variables: [], lexical: [], functions: ["f"] });
  module.status = "unlinked";
  assert.throws(
    () => modules.linkModule(module),
    (error) => error === "MODULE_DECLARATION_INVARIANT",
  );
  assert.equal(module.evaluationError, undefined);
  assert.equal(module.status, "unlinked");
});
test("module lexicals enforce const and resolution uses the global only as the outer environment", () => {
  const f = fixture();
  globals.createGlobalVarBinding(f.global, "outside", false);
  globals.setGlobalBinding(f.global, "outside", 42, true);
  const module = modules.createLoweredSourceModule(
    f.global,
    f.realm,
    undefined,
    empty,
    {
      variables: ["local"],
      lexical: [{ name: "c", constant: true }],
      functions: [],
    },
    () => [],
    (scope, environment) => {
      assert.equal(
        globals.getBindingReference(
          globals.resolveBinding(scope, "outside", true),
        ).value,
        42,
      );
      bindings.initializeBinding(environment, "c", 1);
      assert.equal(
        bindings.setMutableBinding(environment, "c", 2, true),
        "type",
      );
      return { error: "none", value: undefined };
    },
  );
  module.status = "unlinked";
  modules.linkModule(module);
  modules.evaluateModule(module, hooks);
  assert.equal(objects.hasProperty(f.object, "local"), false);
});
test("completion contract faults propagate out while the same user-thrown string stays a JS rejection", () => {
  const bad = source(noDeclarations, () => ({
      error: "invalid",
      value: undefined,
    })),
    thrown = source(noDeclarations, () => ({
      error: "throw",
      value: "MODULE_COMPLETION_INVARIANT",
    }));
  for (const f of [bad, thrown]) {
    f.module.status = "unlinked";
    modules.linkModule(f.module);
  }
  assert.throws(
    () => modules.evaluateModule(bad.module, hooks),
    (error) => error === "MODULE_COMPLETION_INVARIANT",
  );
  assert.equal(bad.module.evaluationError, undefined);
  assert.equal(
    modules.evaluateModule(thrown.module, hooks).internalRareSlots
      ?.internalExoticSlots?.internalPromiseData?.result,
    "MODULE_COMPLETION_INVARIANT",
  );
});

test("lowered async source modules reuse the continuation driver and module cells", () => {
  assert.equal(typeof modules.createLoweredAsyncSourceModule, "function");
  const f = fixture(),
    log: string[] = [];
  objects.installPromiseIntrinsics(f.object, f.realm, hooks, () => {});
  let current: ModuleRecord | undefined;
  const module = modules.createLoweredAsyncSourceModule(
    f.global,
    f.realm,
    undefined,
    { ...empty, hasTopLevelAwait: true },
    { variables: [], lexical: [{ name: "x", constant: false }], functions: [] },
    () => [],
    (_scope, environment) => {
      let first = true;
      return (kind, input) => {
        assert.equal(f.realm.agent.activeContext?.scriptOrModule, current);
        if (first) {
          first = false;
          log.push("start");
          return { kind: "yield", result: 1 };
        }
        assert.equal(kind, "next");
        assert.equal(input, 1);
        log.push("resume");
        bindings.initializeBinding(environment, "x", 42);
        return { kind: "return", value: undefined };
      };
    },
  );
  current = module;
  module.status = "unlinked";
  assert.equal(modules.linkModule(module).ok, true);
  const promise = modules.evaluateModule(module, hooks);
  assert.equal(
    promise.internalRareSlots?.internalExoticSlots?.internalPromiseData?.state,
    "pending",
  );
  assert.deepEqual(log, ["start"]);
  assert.equal(
    bindings.getBindingValue(module.environment, "x").error,
    "reference",
  );
  objects.drainScriptJobs(f.realm.agent, (error) => {
    throw error;
  });
  assert.deepEqual(log, ["start", "resume"]);
  assert.equal(
    promise.internalRareSlots?.internalExoticSlots?.internalPromiseData?.state,
    "fulfilled",
  );
  assert.equal(bindings.getBindingValue(module.environment, "x").value, 42);
  assert.equal(f.realm.agent.activeContext, undefined);
});

test("a lowered async source error after suspension rejects with the original identity", () => {
  assert.equal(typeof modules.createLoweredAsyncSourceModule, "function");
  const f = fixture(),
    error = objects.createObject<ScriptPropertyKey, unknown>(
      f.realm.objectPrototype,
    );
  objects.installPromiseIntrinsics(f.object, f.realm, hooks, () => {});
  const module = modules.createLoweredAsyncSourceModule(
    f.global,
    f.realm,
    undefined,
    { ...empty, hasTopLevelAwait: true },
    noDeclarations,
    () => [],
    () => {
      let first = true;
      return (_kind, _input) => {
        if (first) {
          first = false;
          return { kind: "yield", result: undefined };
        }
        throw error;
      };
    },
  );
  module.status = "unlinked";
  assert.equal(modules.linkModule(module).ok, true);
  const promise = modules.evaluateModule(module, hooks);
  objects.drainScriptJobs(f.realm.agent, (fault) => {
    throw fault;
  });
  assert.equal(
    promise.internalRareSlots?.internalExoticSlots?.internalPromiseData?.state,
    "rejected",
  );
  assert.equal(
    promise.internalRareSlots?.internalExoticSlots?.internalPromiseData?.result,
    error,
  );
  assert.equal(module.evaluationError?.error, error);
});
