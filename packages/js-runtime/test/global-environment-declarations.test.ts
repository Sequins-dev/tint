import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createObject,
  defineOwnProperty,
  getOwnProperty,
  ownKeys,
  preventExtensions,
  type ObjectHooks,
} from "@tint/js-runtime/objects";
import {
  getBindingValue,
  initializeBinding,
} from "@tint/js-runtime/environments/records";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
import * as globals from "../src/environments/global/index.ts";
const hooks: ObjectHooks<number> = {
  undefinedValue: 0,
  sameValue: Object.is,
  call: () => 0,
};
const setup = () =>
  globals.createGlobalEnvironment(
    createObject<string, number>(undefined),
    1,
    1,
    (name: string) => name,
    hooks,
  );
test("declaration validation distinguishes within-script early conflicts", () => {
  assert.equal(typeof globals.validateGlobalDeclarations, "function");
  const lexical = [{ name: "x", constant: false }];
  assert.equal(
    globals.validateGlobalDeclarations({
      lexical,
      variables: ["x"],
      functions: [],
    }),
    "x",
  );
  assert.equal(
    globals.validateGlobalDeclarations({
      lexical: [...lexical, ...lexical],
      variables: [],
      functions: [],
    }),
    "x",
  );
  assert.equal(
    globals.validateGlobalDeclarations({
      lexical,
      variables: [],
      functions: [{ name: "x", instantiate: () => 1 }],
    }),
    "x",
  );
  assert.equal(
    globals.validateGlobalDeclarations({
      lexical: [],
      variables: ["x", "x"],
      functions: [{ name: "x", instantiate: () => 1 }],
    }),
    undefined,
  );
});
test("instantiation checks every declaration before creating bindings", () => {
  const record = setup();
  const initial = {
    lexical: [{ name: "existing", constant: false }],
    variables: [],
    functions: [],
  };
  assert.equal(globals.instantiateGlobalDeclarations(record, initial), "none");
  let created = 0;
  const conflict = {
    lexical: [{ name: "new", constant: false }],
    variables: ["existing"],
    functions: [{ name: "f", instantiate: () => ++created }],
  };
  assert.equal(
    globals.instantiateGlobalDeclarations(record, conflict),
    "syntax",
  );
  assert.equal(created, 0);
  assert.equal(globals.hasGlobalBinding(record, "new"), false);
  assert.equal(globals.hasGlobalBinding(record, "f"), false);
  const closed = setup();
  preventExtensions(closed.object);
  assert.equal(
    globals.instantiateGlobalDeclarations(closed, {
      lexical: [{ name: "new", constant: false }],
      variables: ["v"],
      functions: [],
    }),
    "type",
  );
  assert.equal(globals.hasGlobalBinding(closed, "new"), false);
});
test("instantiation creates lexical TDZ bindings then last functions then variables", () => {
  const record = setup(),
    calls: string[] = [];
  const plan = {
    lexical: [{ name: "x", constant: true }],
    variables: ["v", "f", "v"],
    functions: [
      {
        name: "f",
        instantiate: () => {
          throw new Error("superseded declaration");
        },
      },
      {
        name: "g",
        instantiate: () => {
          calls.push("g");
          assert.equal(getBindingValue(record.lexical, "x").error, "reference");
          assert.equal(getOwnProperty(record.object, "v"), undefined);
          return 7;
        },
      },
      {
        name: "f",
        instantiate: () => {
          calls.push("f");
          return 42;
        },
      },
    ],
  };
  assert.equal(globals.validateGlobalDeclarations(plan), undefined);
  assert.equal(globals.instantiateGlobalDeclarations(record, plan), "none");
  assert.deepEqual(calls, ["g", "f"]);
  assert.equal(globals.getGlobalBinding(record, "f", true).value, 42);
  assert.equal(globals.getGlobalBinding(record, "v", true).value, 0);
  initializeBinding(record.lexical, "x", 9);
  assert.equal(globals.setGlobalBinding(record, "x", 10, false), "type");
  assert.equal(
    globals.instantiateGlobalDeclarations(record, {
      lexical: [{ name: "v", constant: false }],
      variables: [],
      functions: [],
    }),
    "syntax",
  );
});

test("Annex B global admission creates optional vars before ordinary declarations", () => {
  const record = setup(),
    annexFunctions = [{ name: "legacy", admitted: false }];
  assert.equal(
    globals.instantiateGlobalDeclarations(record, {
      lexical: [],
      variables: ["ordinary"],
      functions: [
        {
          name: "fn",
          instantiate: () => {
            assert.equal(getOwnProperty(record.object, "legacy")?.value, 0);
            return 19;
          },
        },
      ],
      annexFunctions,
    }),
    "none",
  );
  assert.equal(annexFunctions[0]!.admitted, true);
  assert.equal(getOwnProperty(record.object, "legacy")?.value, 0);
  assert.equal(getOwnProperty(record.object, "legacy")?.configurable, false);
  assert.deepEqual(
    ownKeys(record.object, () => -1),
    ["legacy", "fn", "ordinary"],
  );
});

test("Annex B global admission skips lexical conflicts and closed globals", () => {
  const lexical = setup();
  globals.instantiateGlobalDeclarations(lexical, {
    lexical: [{ name: "legacy", constant: false }],
    variables: [],
    functions: [],
  });
  for (const record of [lexical, setup()]) {
    if (record !== lexical) preventExtensions(record.object);
    const annexFunctions = [{ name: "legacy", admitted: false }];
    assert.equal(
      globals.instantiateGlobalDeclarations(record, {
        lexical: [],
        variables: [],
        functions: [],
        annexFunctions,
      }),
      "none",
    );
    assert.equal(annexFunctions[0]!.admitted, false);
    assert.equal(getOwnProperty(record.object, "legacy"), undefined);
  }
});
test("admission checks names in instantiation order without creating bindings", () => {
  const record = setup();
  assert.equal(
    globals.instantiateGlobalDeclarations(record, {
      lexical: [{ name: "existing", constant: false }],
      variables: [],
      functions: [],
    }),
    "none",
  );
  const before = ownKeys(record.object, () => -1);
  assert.equal(
    globals.admitGlobalDeclarations(record, {
      lexical: [{ name: "fresh" }],
      variables: ["v", "v"],
      functions: [{ name: "f" }, { name: "f" }],
    }),
    "none",
  );
  assert.deepEqual(
    ownKeys(record.object, () => -1),
    before,
  );
  assert.equal(globals.hasGlobalBinding(record, "fresh"), false);
  assert.equal(globals.hasGlobalBinding(record, "v"), false);
  assert.equal(globals.hasGlobalBinding(record, "f"), false);
  for (const plan of [
    { lexical: [{ name: "existing" }], variables: [], functions: [] },
    { lexical: [], variables: ["existing"], functions: [] },
    { lexical: [], variables: [], functions: [{ name: "existing" }] },
  ])
    assert.equal(globals.admitGlobalDeclarations(record, plan), "syntax");
  // Lexical conflicts precede function and variable admission failures.
  assert.equal(
    globals.admitGlobalDeclarations(record, {
      lexical: [{ name: "existing" }],
      variables: [],
      functions: [{ name: "f" }],
    }),
    "syntax",
  );
  const closed = setup();
  defineOwnProperty(
    closed.object,
    "own",
    {
      ...emptyUpdate(0),
      fields: 51,
      value: 1,
      writable: true,
      enumerable: true,
      configurable: true,
    },
    hooks,
  );
  preventExtensions(closed.object);
  // A closed global admits neither new functions nor new vars, while names
  // already owned by the object remain declarable.
  assert.equal(
    globals.admitGlobalDeclarations(closed, {
      lexical: [],
      variables: [],
      functions: [{ name: "f" }],
    }),
    "type",
  );
  assert.equal(
    globals.admitGlobalDeclarations(closed, {
      lexical: [],
      variables: ["v"],
      functions: [],
    }),
    "type",
  );
  assert.equal(
    globals.admitGlobalDeclarations(closed, {
      lexical: [{ name: "x" }],
      variables: ["own"],
      functions: [{ name: "own" }],
    }),
    "none",
  );
  assert.deepEqual(
    ownKeys(closed.object, () => -1),
    ["own"],
  );
  assert.equal(globals.hasGlobalBinding(closed, "x"), false);
});
