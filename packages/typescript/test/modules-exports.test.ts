import assert from "node:assert/strict";
import test from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Span } from "@tint/typescript/syntax";
import {
  resolveModuleExports,
  type ModuleExportState,
  type ResolvedModuleExport,
} from "@tint/typescript/modules/exports";

function state(
  id: string,
  text: string,
  dependencies: readonly (readonly [string, string])[] = [],
  values: readonly (readonly [string, string])[] = [],
  types: readonly (readonly [string, string])[] = [],
  exports: readonly ResolvedModuleExport[] = [],
): ModuleExportState {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return {
    source: { id, module: parsed.value, dependencies: new Map(dependencies) },
    values: new Map(values),
    types: new Map(types),
    exports,
  };
}
function fail(module: string, node: Span, message: string): never {
  throw { module, start: node.start, end: node.end, message };
}
function resolve(...states: readonly ModuleExportState[]) {
  return resolveModuleExports(
    new Map(states.map((value) => [value.source.id, value])),
    fail,
  );
}
const dep = state(
  "dep",
  "",
  [],
  [["value", "opaque/value"]],
  [["Shape", "opaque/type"]],
  [
    {
      module: "dep",
      name: "value",
      namespace: "value",
      identity: "opaque/value",
    },
    {
      module: "dep",
      name: "Shape",
      namespace: "type",
      identity: "opaque/type",
    },
  ],
);

test("semantic exports preserve caller identities and value/type order", () => {
  assert.deepEqual(resolve(dep).get("dep"), dep.exports);
});

test("named exports and imported local forwarding preserve identity", () => {
  const barrel = state(
    "barrel",
    'import {value as local} from "dep";export {local as get};export type {Shape as Record} from "dep";',
    [["dep", "dep"]],
  );
  assert.deepEqual(resolve(barrel, dep).get("barrel"), [
    {
      module: "barrel",
      name: "get",
      namespace: "value",
      identity: "opaque/value",
    },
    {
      module: "barrel",
      name: "Record",
      namespace: "type",
      identity: "opaque/type",
    },
  ]);
});

test("star diamonds and productive cycles coalesce the same declaration", () => {
  const left = state("left", 'export * from "dep";', [["dep", "dep"]]);
  const right = state("right", 'export * from "dep";export * from "barrel";', [
    ["dep", "dep"],
    ["barrel", "barrel"],
  ]);
  const barrel = state(
    "barrel",
    'export * from "left";export * from "right";',
    [
      ["left", "left"],
      ["right", "right"],
    ],
  );
  assert.deepEqual(
    resolve(barrel, left, right, dep).get("barrel"),
    dep.exports.map((value) => ({ ...value, module: "barrel" })),
  );
});

test("type-only star does not expose values and star excludes default", () => {
  const defaults = state(
    "defaults",
    "export {value as default};",
    [],
    [["value", "default-id"]],
  );
  const barrel = state(
    "barrel",
    'export type * from "dep";export * from "defaults";',
    [
      ["dep", "dep"],
      ["defaults", "defaults"],
    ],
  );
  assert.deepEqual(resolve(barrel, dep, defaults).get("barrel"), [
    {
      module: "barrel",
      name: "Shape",
      namespace: "type",
      identity: "opaque/type",
    },
  ]);
});

test("distinct star identities are ambiguous but explicit forwarding wins", () => {
  const other = state(
    "other",
    "export {value};",
    [],
    [["value", "other/value"]],
  );
  const dependencies: readonly (readonly [string, string])[] = [
    ["dep", "dep"],
    ["other", "other"],
  ];
  const ambiguous = state(
    "barrel",
    'export * from "dep";export * from "other";',
    dependencies,
  );
  assert.deepEqual(resolve(ambiguous, dep, other).get("barrel"), [
    {
      module: "barrel",
      name: "Shape",
      namespace: "type",
      identity: "opaque/type",
    },
  ]);
  const explicit = state(
    "barrel",
    'export * from "dep";export * from "other";export {value} from "dep";',
    dependencies,
  );
  assert.equal(
    resolve(explicit, dep, other)
      .get("barrel")
      ?.find((value) => value.name === "value")?.identity,
    "opaque/value",
  );
});

test("explicit missing, ambiguous and duplicate exports keep exact diagnostics", () => {
  const other = state(
    "other",
    "export {value};",
    [],
    [["value", "other/value"]],
  );
  const barrel = state("barrel", 'export * from "dep";export * from "other";', [
    ["dep", "dep"],
    ["other", "other"],
  ]);
  for (const [text, dependencies, message] of [
    ["export {missing};", [], "missing export: missing"],
    [
      'export {value} from "barrel";',
      [["barrel", "barrel"]],
      "ambiguous export: value",
    ],
    [
      'export {value as same} from "dep";export {value as same} from "other";',
      [
        ["dep", "dep"],
        ["other", "other"],
      ],
      "duplicate export: same",
    ],
  ] as const) {
    assert.throws(
      () => resolve(state("main", text, dependencies), barrel, dep, other),
      (error: unknown) => {
        assert.ok(
          typeof error === "object" && error !== null && "message" in error,
        );
        assert.equal(error.message, message);
        return true;
      },
    );
  }
});

test("unproductive cycles and unresolved providers fail without execution", () => {
  const a = state("a", 'export {value} from "b";', [["b", "b"]]);
  const b = state("b", 'export {value} from "a";', [["a", "a"]]);
  assert.throws(() => resolve(a, b), { message: "missing export: value" });
  assert.throws(() => resolve(state("main", 'export * from "absent";')), {
    message: "unresolved export module: absent",
  });
});

test("namespace export capability remains explicitly unsupported", () => {
  assert.throws(
    () =>
      resolve(
        state("main", 'export * as ns from "dep";', [["dep", "dep"]]),
        dep,
      ),
    { message: "namespace exports require module namespace objects" },
  );
});

test("resolver preserves the depth256 resource bound", () => {
  const states: ModuleExportState[] = [];
  for (let i = 0; i < 257; i++)
    states.push(
      state(String(i), 'export * from "next";', [["next", String(i + 1)]]),
    );
  states.push(state("257", ""));
  assert.throws(() => resolve(...states), {
    message: "export resolution depth exceeded",
  });
});

test("resolver preserves the one-million work bound", () => {
  const states: ModuleExportState[] = [];
  for (let i = 0; i < 21; i++)
    states.push(
      state(String(i), 'export * from "next";export * from "next";', [
        ["next", String(i + 1)],
      ]),
    );
  states.push(state("21", "export {value};", [], [["value", "leaf"]]));
  assert.throws(() => resolve(...states), {
    message: "export resolution work limit exceeded",
  });
});

test("export inspection never evaluates top-level declarations or statements", () => {
  const module = state(
    "live",
    "throw 42;export {installer};",
    [],
    [["installer", "opaque/installer"]],
  );
  assert.deepEqual(resolve(module).get("live"), [
    {
      module: "live",
      name: "installer",
      namespace: "value",
      identity: "opaque/installer",
    },
  ]);
});
