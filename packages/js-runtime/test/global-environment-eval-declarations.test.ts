import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createObject,
  getOwnProperty,
  preventExtensions,
  type ObjectHooks,
} from "@tint/js-runtime/objects";
import {
  createDeclarativeEnvironment,
  createMutableBinding,
  initializeBinding,
  hasBinding,
  getBindingValue,
  deleteBinding,
} from "@tint/js-runtime/environments/records";
import * as globals from "../src/environments/global/index.ts";
import {
  findBinding,
  bindingCount,
} from "../src/environments/records/index.ts";
const hooks: ObjectHooks<number> = {
  undefinedValue: 0,
  sameValue: Object.is,
  call: () => 0,
};
function setup() {
  return globals.createGlobalEnvironment(
    createObject<string, number>(undefined),
    1,
    1,
    (name: string) => name,
    hooks,
  );
}
const empty = () => ({ lexical: [], variables: [], functions: [] });
test("sloppy eval checks global lexical conflicts before creating any binding", () => {
  for (const functionName of [false, true]) {
    const record = setup(),
      lexical = createDeclarativeEnvironment(0);
    createMutableBinding(record.lexical, "blocked", false);
    let made = 0;
    const plan = {
      lexical: [{ name: "fresh", constant: false }],
      variables: functionName ? [] : ["blocked"],
      functions: functionName
        ? [
            {
              name: "blocked",
              instantiate: () => {
                made++;
                return 1;
              },
            },
          ]
        : [],
    };
    assert.equal(
      globals.instantiateEvalDeclarations(record, lexical, plan, false),
      "syntax",
    );
    assert.ok(
      [lexical.name0, lexical.name1, lexical.name2, lexical.name3].every(
        (name) => name === undefined,
      ) && (lexical.overflow?.size ?? 0) === 0,
    );
    assert.equal(record.object.properties?.size ?? 0, 0);
    assert.equal(made, 0);
  }
});
test("sloppy eval rejects all global admission failures before factories or lexical mutation", () => {
  for (const functions of [false, true]) {
    const record = setup(),
      lexical = createDeclarativeEnvironment(0);
    preventExtensions(record.object);
    let made = 0;
    assert.equal(
      globals.instantiateEvalDeclarations(
        record,
        lexical,
        {
          lexical: [{ name: "fresh", constant: false }],
          variables: functions ? [] : ["absent"],
          functions: functions
            ? [
                {
                  name: "absent",
                  instantiate: () => {
                    made++;
                    return 1;
                  },
                },
              ]
            : [],
        },
        false,
      ),
      "type",
    );
    assert.equal(made, 0);
    assert.ok(
      [lexical.name0, lexical.name1, lexical.name2, lexical.name3].every(
        (name) => name === undefined,
      ) && (lexical.overflow?.size ?? 0) === 0,
    );
  }
});
test("eval lexicals use their fresh environment and exist before function factories", () => {
  const record = setup(),
    lexical = createDeclarativeEnvironment(0);
  globals.createGlobalVarBinding(record, "shadow", false);
  let created = 0;
  assert.equal(
    globals.instantiateEvalDeclarations(
      record,
      lexical,
      {
        lexical: [{ name: "shadow", constant: true }],
        variables: [],
        functions: [
          {
            name: "fn",
            instantiate: () => {
              created++;
              assert.equal(
                getBindingValue(lexical, "shadow").error,
                "reference",
              );
              assert.equal(hasBinding(record.lexical, "shadow"), false);
              return 42;
            },
          },
        ],
      },
      false,
    ),
    "none",
  );
  assert.equal(created, 1);
  assert.equal(getOwnProperty(record.object, "fn")?.value, 42);
  assert.equal(findBinding(lexical, "shadow")?.mutable, false);
  assert.equal(findBinding(lexical, "shadow")?.strict, true);
});
test("sloppy eval last function wins and new globals are deletable", () => {
  const record = setup(),
    lexical = createDeclarativeEnvironment(0),
    order: number[] = [];
  assert.equal(
    globals.instantiateEvalDeclarations(
      record,
      lexical,
      {
        ...empty(),
        variables: ["fn", "v", "v"],
        functions: [
          {
            name: "fn",
            instantiate: () => {
              order.push(1);
              return 1;
            },
          },
          {
            name: "other",
            instantiate: () => {
              order.push(2);
              return 2;
            },
          },
          {
            name: "fn",
            instantiate: () => {
              order.push(3);
              return 3;
            },
          },
        ],
      },
      false,
    ),
    "none",
  );
  assert.deepEqual(order, [2, 3]);
  assert.equal(getOwnProperty(record.object, "fn")?.value, 3);
  assert.equal(getOwnProperty(record.object, "fn")?.configurable, true);
  assert.equal(getOwnProperty(record.object, "v")?.configurable, true);
  assert.equal(globals.deleteGlobalBinding(record, "fn"), true);
  globals.createGlobalVarBinding(record, "existing", false);
  globals.setGlobalBinding(record, "existing", 17, false);
  assert.equal(
    globals.instantiateEvalDeclarations(
      record,
      createDeclarativeEnvironment(0),
      { ...empty(), variables: ["existing"] },
      false,
    ),
    "none",
  );
  assert.equal(getOwnProperty(record.object, "existing")?.value, 17);
  assert.equal(getOwnProperty(record.object, "existing")?.configurable, false);
});
test("strict eval keeps var and function declarations local and shares their binding", () => {
  const record = setup(),
    lexical = createDeclarativeEnvironment(0);
  createMutableBinding(record.lexical, "fn", false);
  preventExtensions(record.object);
  assert.equal(
    globals.instantiateEvalDeclarations(
      record,
      lexical,
      {
        lexical: [{ name: "local", constant: false }],
        variables: ["fn", "v", "v"],
        functions: [{ name: "fn", instantiate: () => 42 }],
      },
      true,
    ),
    "none",
  );
  assert.equal(record.object.properties?.size ?? 0, 0);
  assert.equal(getBindingValue(lexical, "fn").value, 42);
  assert.equal(getBindingValue(lexical, "v").value, 0);
  assert.equal(deleteBinding(lexical, "fn"), true);
  assert.equal(deleteBinding(lexical, "v"), true);
  assert.equal(deleteBinding(lexical, "local"), false);
});
test("strict eval updates existing local function bindings without recreating them", () => {
  const record = setup(),
    lexical = createDeclarativeEnvironment(0);
  createMutableBinding(lexical, "fn", true);
  initializeBinding(lexical, "fn", 9);
  const original = findBinding(lexical, "fn");
  assert.equal(
    globals.instantiateEvalDeclarations(
      record,
      lexical,
      { ...empty(), functions: [{ name: "fn", instantiate: () => 42 }] },
      true,
    ),
    "none",
  );
  assert.equal(findBinding(lexical, "fn"), original);
  assert.equal(getBindingValue(lexical, "fn").value, 42);
});
test("eval Annex B admission skips global lexicals and non-extensible additions", () => {
  const record = setup(),
    lexical = createDeclarativeEnvironment(0);
  createMutableBinding(record.lexical, "blocked", false);
  const annex = [
    { name: "blocked", admitted: true },
    { name: "fresh", admitted: false },
    { name: "fresh", admitted: false },
  ];
  assert.equal(
    globals.instantiateEvalDeclarations(
      record,
      lexical,
      { ...empty(), annexFunctions: annex },
      false,
    ),
    "none",
  );
  assert.deepEqual(
    annex.map((x) => x.admitted),
    [false, true, true],
  );
  assert.equal(getOwnProperty(record.object, "fresh")?.configurable, true);
  preventExtensions(record.object);
  const absent = { name: "absent", admitted: true };
  assert.equal(
    globals.instantiateEvalDeclarations(
      record,
      createDeclarativeEnvironment(0),
      { ...empty(), annexFunctions: [absent] },
      false,
    ),
    "none",
  );
  assert.equal(absent.admitted, false);
  assert.throws(
    () =>
      globals.instantiateEvalDeclarations(
        record,
        createDeclarativeEnvironment(0),
        { ...empty(), annexFunctions: [absent] },
        true,
      ),
    (e) => e === "DECLARATION_INVARIANT",
  );
});

function localEval() {
  const global = setup(),
    record = createDeclarativeEnvironment(0);
  const variables = globals.createDeclarativeScope(
    globals.createGlobalScope(global),
    record,
  );
  const fresh = createDeclarativeEnvironment(0);
  const lexical = globals.createDeclarativeScope(variables, fresh);
  return { global, record, variables, fresh, lexical };
}
function direct(
  ...args: Parameters<
    typeof globals.instantiateDirectEvalDeclarations<string, number>
  >
) {
  assert.equal(typeof globals.instantiateDirectEvalDeclarations, "function");
  return globals.instantiateDirectEvalDeclarations<string, number>(...args);
}
test("direct eval rejects intervening TDZ and parameter bindings before mutation", () => {
  for (const name of ["x", "arguments"]) {
    const f = localEval(),
      block = createDeclarativeEnvironment(0);
    createMutableBinding(block, name, false);
    const lexical = globals.createDeclarativeScope(
      globals.createDeclarativeScope(f.variables, block),
      f.fresh,
    );
    let factories = 0;
    assert.equal(
      direct(
        lexical,
        f.variables,
        undefined,
        {
          lexical: [{ name: "fresh", constant: false }],
          variables: [name],
          functions: [
            {
              name: "fn",
              instantiate: () => {
                factories++;
                return 1;
              },
            },
          ],
        },
        false,
      ),
      "syntax",
    );
    assert.equal(factories, 0);
    assert.equal(bindingCount(f.record), 0);
    assert.equal(bindingCount(f.fresh), 0);
  }
});
test("direct eval creates deletable vars/functions without resetting existing vars", () => {
  const f = localEval();
  createMutableBinding(f.record, "keep", false);
  initializeBinding(f.record, "keep", 19);
  const made: string[] = [];
  assert.equal(
    direct(
      f.lexical,
      f.variables,
      undefined,
      {
        lexical: [{ name: "tdz", constant: true }],
        variables: ["keep", "newVar", "fn", "newVar"],
        functions: [
          {
            name: "fn",
            instantiate: () => {
              assert.fail("earlier duplicate");
            },
          },
          {
            name: "other",
            instantiate: () => {
              made.push("other");
              assert.equal(getBindingValue(f.fresh, "tdz").error, "reference");
              return 1;
            },
          },
          {
            name: "fn",
            instantiate: () => {
              made.push("fn");
              return 42;
            },
          },
        ],
      },
      false,
    ),
    "none",
  );
  assert.deepEqual(made, ["other", "fn"]);
  assert.equal(getBindingValue(f.record, "keep").value, 19);
  assert.equal(getBindingValue(f.record, "fn").value, 42);
  assert.equal(getBindingValue(f.record, "newVar").value, 0);
  assert.equal(deleteBinding(f.record, "keep"), false);
  assert.equal(deleteBinding(f.record, "fn"), true);
  assert.equal(deleteBinding(f.record, "newVar"), true);
});
test("direct eval replaces an existing mutable function binding", () => {
  const f = localEval();
  createMutableBinding(f.record, "fn", false);
  initializeBinding(f.record, "fn", 1);
  assert.equal(
    direct(
      f.lexical,
      f.variables,
      undefined,
      {
        lexical: [],
        variables: ["fn"],
        functions: [{ name: "fn", instantiate: () => 42 }],
      },
      false,
    ),
    "none",
  );
  assert.equal(getBindingValue(f.record, "fn").value, 42);
  assert.equal(deleteBinding(f.record, "fn"), false);
});
test("direct eval exempts catch records but not their body's lexical record", () => {
  const f = localEval(),
    caught = createDeclarativeEnvironment(0);
  createMutableBinding(caught, "x", false);
  initializeBinding(caught, "x", 7);
  const catchScope = globals.createDeclarativeScope(f.variables, caught),
    catches = { record: caught, outer: undefined };
  const lexical = globals.createDeclarativeScope(catchScope, f.fresh);
  assert.equal(
    direct(
      lexical,
      f.variables,
      catches,
      { lexical: [], variables: ["x"], functions: [] },
      false,
    ),
    "none",
  );
  assert.equal(getBindingValue(caught, "x").value, 7);
  assert.equal(getBindingValue(f.record, "x").value, 0);
  const body = createDeclarativeEnvironment(0);
  createMutableBinding(body, "x", false);
  const blocked = globals.createDeclarativeScope(
    globals.createDeclarativeScope(catchScope, body),
    createDeclarativeEnvironment(0),
  );
  assert.equal(
    direct(
      blocked,
      f.variables,
      catches,
      { lexical: [], variables: ["x"], functions: [] },
      false,
    ),
    "syntax",
  );
});
test("direct Annex admission shares catch exemptions and skips conflicting candidates", () => {
  const f = localEval(),
    caught = createDeclarativeEnvironment(0),
    body = createDeclarativeEnvironment(0);
  createMutableBinding(caught, "allowed", false);
  createMutableBinding(body, "blocked", false);
  const chain = globals.createDeclarativeScope(
      globals.createDeclarativeScope(f.variables, caught),
      body,
    ),
    lexical = globals.createDeclarativeScope(chain, f.fresh);
  const allowed = { name: "allowed", admitted: false },
    blocked = { name: "blocked", admitted: true };
  assert.equal(
    direct(
      lexical,
      f.variables,
      { record: caught, outer: undefined },
      {
        lexical: [],
        variables: [],
        functions: [],
        annexFunctions: [allowed, blocked],
      },
      false,
    ),
    "none",
  );
  assert.equal(allowed.admitted, true);
  assert.equal(blocked.admitted, false);
  assert.equal(hasBinding(f.record, "allowed"), true);
  assert.equal(hasBinding(f.record, "blocked"), false);
});
test("direct eval compares variable record identities rather than scope node identities", () => {
  const f = localEval(),
    outside = createDeclarativeEnvironment(0);
  createMutableBinding(outside, "x", false);
  const alias = globals.createDeclarativeScope(
    globals.createDeclarativeScope(
      globals.createGlobalScope(f.global),
      outside,
    ),
    f.record,
  );
  const lexical = globals.createDeclarativeScope(alias, f.fresh);
  assert.equal(
    direct(
      lexical,
      f.variables,
      undefined,
      { lexical: [], variables: ["x"], functions: [] },
      false,
    ),
    "none",
  );
  assert.equal(hasBinding(f.record, "x"), true);
});
test("strict direct eval uses its fresh record and ignores outer lexical conflicts", () => {
  const f = localEval();
  createMutableBinding(f.record, "x", false);
  initializeBinding(f.record, "x", 1);
  assert.equal(
    direct(
      f.lexical,
      f.variables,
      undefined,
      {
        lexical: [],
        variables: ["x"],
        functions: [{ name: "fn", instantiate: () => 42 }],
      },
      true,
    ),
    "none",
  );
  assert.equal(getBindingValue(f.record, "x").value, 1);
  assert.equal(getBindingValue(f.fresh, "x").value, 0);
  assert.equal(deleteBinding(f.fresh, "fn"), true);
});
test("direct global eval preserves global lexical admission before TypeError", () => {
  const global = setup();
  createMutableBinding(global.lexical, "blocked", false);
  preventExtensions(global.object);
  const variables = globals.createGlobalScope(global),
    fresh = createDeclarativeEnvironment(0),
    lexical = globals.createDeclarativeScope(
      globals.createGlobalScope(global),
      fresh,
    );
  assert.equal(
    direct(
      lexical,
      variables,
      undefined,
      {
        lexical: [],
        variables: ["blocked"],
        functions: [{ name: "absent", instantiate: () => 1 }],
      },
      false,
    ),
    "syntax",
  );
  assert.equal(
    direct(
      lexical,
      variables,
      undefined,
      {
        lexical: [],
        variables: [],
        functions: [{ name: "absent", instantiate: () => 1 }],
      },
      false,
    ),
    "type",
  );
  assert.equal(bindingCount(fresh), 0);
});
test("invalid direct variable targets fail before declarations are created", () => {
  const f = localEval(),
    other = globals.createDeclarativeScope(
      globals.createGlobalScope(f.global),
      createDeclarativeEnvironment(0),
    );
  assert.throws(
    () =>
      direct(
        f.lexical,
        other,
        undefined,
        { lexical: [], variables: ["x"], functions: [] },
        false,
      ),
    (error) => error === "DIRECT_EVAL_ENVIRONMENT_INVARIANT",
  );
  assert.equal(bindingCount(f.fresh), 0);
  assert.equal(bindingCount(f.record), 0);
});

test("direct eval skips with-object bindings during lexical conflict checks", () => {
  const f = localEval();
  globals.createGlobalVarBinding(f.global, "x", false);
  const object = globals.createObjectEnvironment(f.global.object, 1, true, {
    ...hooks,
    keyForName: (name: string) => name,
    unscopablesKey: "skip",
    asObject: () => assert.fail("object lookup during admission"),
    truthy: () => assert.fail("object coercion during admission"),
  });
  const lexical = globals.createDeclarativeScope(
    globals.createObjectScope(f.variables, object),
    f.fresh,
  );
  assert.equal(
    direct(
      lexical,
      f.variables,
      undefined,
      { lexical: [], variables: ["x"], functions: [] },
      false,
    ),
    "none",
  );
  assert.equal(hasBinding(f.record, "x"), true);
});
test("nested catch chains exempt every listed record", () => {
  const f = localEval(),
    a = createDeclarativeEnvironment(0),
    b = createDeclarativeEnvironment(0);
  createMutableBinding(a, "a", false);
  createMutableBinding(b, "b", false);
  const lexical = globals.createDeclarativeScope(
    globals.createDeclarativeScope(
      globals.createDeclarativeScope(f.variables, a),
      b,
    ),
    f.fresh,
  );
  assert.equal(
    direct(
      lexical,
      f.variables,
      { record: b, outer: { record: a, outer: undefined } },
      { lexical: [], variables: ["a", "b"], functions: [] },
      false,
    ),
    "none",
  );
  assert.equal(hasBinding(f.record, "a"), true);
  assert.equal(hasBinding(f.record, "b"), true);
});
test("function declarations also reject intervening lexical conflicts before factories", () => {
  const f = localEval(),
    block = createDeclarativeEnvironment(0);
  createMutableBinding(block, "fn", false);
  const lexical = globals.createDeclarativeScope(
    globals.createDeclarativeScope(f.variables, block),
    f.fresh,
  );
  assert.equal(
    direct(
      lexical,
      f.variables,
      undefined,
      {
        lexical: [{ name: "fresh", constant: false }],
        variables: [],
        functions: [
          {
            name: "fn",
            instantiate: () => assert.fail("factory before admission"),
          },
        ],
      },
      false,
    ),
    "syntax",
  );
  assert.equal(bindingCount(f.record), 0);
  assert.equal(bindingCount(f.fresh), 0);
});
