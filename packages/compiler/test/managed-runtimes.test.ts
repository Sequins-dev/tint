import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  reifyManagedSurfaceTypes,
  planManagedSurfaceContracts,
} from "../src/native/index.ts";
import * as runtime from "../src/native/managed-runtimes.ts";

function contracts() {
  const parsed = parseModule(
    createSourceTextView(
      "function use(a:number[],b:readonly number[],c:Map<string,number>,d:Set<number>):number{return 0;}",
    ),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const surface = reifyManagedSurfaceTypes(
    checked.value,
    [{ name: "use", local: "use" }],
    "$Surface",
  );
  assert.ok(surface.ok);
  const planned = planManagedSurfaceContracts(surface.value);
  assert.ok(planned.ok);
  return planned.value;
}
test("runtime providers use canonical alias keys and fixed operation order", () => {
  const graph = contracts();
  const result = runtime.planManagedSurfaceRuntimes(graph);
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.collections.map((row) => row.kind),
    ["list", "map", "set"],
  );
  const list = result.value.collections[0];
  assert.ok(list);
  assert.deepEqual(list.operations, [
    "create",
    "read",
    "write",
    "push",
    "length",
    "has",
    "delete",
    "resize",
  ]);
  for (const row of result.value.collections) {
    assert.match(row.element, /^\$T\d+$/);
    if (row.kind === "map") assert.match(row.value, /^\$T\d+$/);
    else assert.equal(row.value, "");
  }
  assert.equal(result.value.anchors.length, 4);
  assert.equal(
    result.value.anchors[0]?.provider,
    result.value.anchors[1]?.provider,
  );
  const repeated = runtime.planManagedSurfaceRuntimes(graph);
  assert.ok(repeated.ok);
  assert.deepEqual(result.value, repeated.value);
});

test("collection anchors demand canonical types without helper implementations", () => {
  assert.equal(typeof runtime.createManagedRuntimeAnchors, "function");
  const graph = contracts(),
    census = runtime.planManagedSurfaceRuntimes(graph);
  assert.ok(census.ok);
  const generated = runtime.createManagedRuntimeAnchors(
    census.value,
    "$collections",
  );
  assert.ok(generated.ok);
  assert.equal(generated.value.declarations.length, 4);
  assert.equal(generated.value.anchors.length, 4);
  const checked = checkClosureModule({
    start: 0,
    end: 0,
    imports: [],
    statements: [
      ...graph.surface.declarations,
      ...generated.value.declarations,
    ],
  });
  assert.ok(checked.ok, JSON.stringify(checked));
  assert.deepEqual(
    generated.value.anchors.map((row) => row.provider),
    census.value.anchors.map((row) => row.provider),
  );
  for (const declaration of generated.value.declarations) {
    assert.equal(declaration.start, 0);
    assert.equal(declaration.end, 0);
    assert.equal(declaration.kind, "function");
  }
  assert.equal(
    runtime.createManagedRuntimeAnchors(census.value, "bad-prefix").ok,
    false,
  );
});

test("runtime selection rejects key-instance disagreement and incomplete operations", () => {
  const graph = contracts(),
    census = runtime.planManagedSurfaceRuntimes(graph);
  assert.ok(census.ok);
  const anchors = runtime.createManagedRuntimeAnchors(
    census.value,
    "$collections",
  );
  assert.ok(anchors.ok);
  const censusValue = census.value,
    anchorValue = anchors.value;
  function context(skew: boolean, omit: boolean) {
    return {
      observed: graph.checked,
      primitives: () => undefined,
      numberText: () => undefined,
      collection(subject: {
        readonly function: string;
        readonly parameter: number;
      }) {
        const index = anchorValue.anchors.findIndex(
          (row) => row.name === subject.function,
        );
        const anchor = anchorValue.anchors[index];
        assert.ok(anchor);
        const key = censusValue.collections[anchor.provider];
        assert.ok(key);
        const operations = new Map(
          key.operations
            .filter((_, index) => !omit || index !== 0)
            .map((operation) => [
              operation,
              String(anchor.provider) +
                operation +
                (skew && index === 1 ? "skew" : ""),
            ]),
        );
        return {
          ok: true,
          value: {
            kind: key.kind,
            element: undefined,
            key: undefined,
            value: undefined,
            operations,
          },
        } as const;
      },
    };
  }
  const valid = runtime.resolveManagedCollectionNames(
    context(false, false),
    census.value,
    anchors.value,
  );
  assert.ok(valid.ok);
  assert.equal(valid.value.providers.length, 3);
  const skew = runtime.resolveManagedCollectionNames(
    context(true, false),
    census.value,
    anchors.value,
  );
  assert.equal(skew.ok, false);
  if (!skew.ok) assert.match(skew.error, /two instances/);
  const missing = runtime.resolveManagedCollectionNames(
    context(false, true),
    census.value,
    anchors.value,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /vocabulary/);
  const count = runtime.resolveManagedCollectionNames(
    context(false, false),
    census.value,
    { ...anchors.value, anchors: [] },
  );
  assert.equal(count.ok, false);
});

test("runtime ABI facts require every selected operation and preserve provider slot order", () => {
  assert.equal(typeof runtime.materializeManagedRuntimeProviders, "function");
  const key = {
    kind: "list",
    element: "$T1",
    value: "",
    operations: ["create", "read"],
  } as const;
  const plan = {
    providers: [{ key, targets: ["createList", "readList"] }],
    targets: ["createList", "readList"],
  };
  const facts = runtime.materializeManagedRuntimeProviders(plan, (name) =>
    name === "createList"
      ? { parameters: [], returnType: "reference" }
      : { parameters: ["reference", "number"], returnType: "optional-number" },
  );
  assert.ok(facts.ok);
  assert.deepEqual(facts.value, [
    {
      kind: "list",
      element: "$T1",
      value: "",
      operations: [
        { operation: "create", parameters: [], returnType: "reference" },
        {
          operation: "read",
          parameters: ["reference", "number"],
          returnType: "optional-number",
        },
      ],
    },
  ]);
  const missing = runtime.materializeManagedRuntimeProviders(
    plan,
    () => undefined,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok)
    assert.match(missing.error, /missing runtime ABI.*createList/);
  const malformed = runtime.materializeManagedRuntimeProviders(
    { ...plan, providers: [{ key, targets: ["createList"] }] },
    () => ({ parameters: [], returnType: "number" }),
  );
  assert.equal(malformed.ok, false);
});

test("AOT anchors namespace their parameter types while preserving canonical census identities", () => {
  const census = runtime.planManagedSurfaceRuntimes(contracts());
  assert.ok(census.ok);
  const result = runtime.createManagedRuntimeAnchors(
    census.value,
    "$runtime",
    (alias) => "$ns_" + alias,
  );
  assert.ok(result.ok);
  const declaration = result.value.declarations[0],
    anchor = result.value.anchors[0];
  assert.ok(declaration?.kind === "function" && anchor);
  assert.deepEqual(declaration.parameters[0]?.type, {
    start: 0,
    end: 0,
    kind: "named",
    name: "$ns_" + anchor.alias,
  });
  assert.equal(anchor.alias, census.value.anchors[0]?.alias);
});

test("runtime entry preparation preserves slots, deduplicates targets and rejects ABI disagreements", () => {
  assert.equal(typeof runtime.prepareManagedRuntimeEntries, "function");
  const first = {
    kind: "list",
    element: "$T1",
    value: "",
    operations: ["create", "read"],
  } as const;
  const second = { ...first, element: "$T2" };
  const names = {
    providers: [
      { key: first, targets: ["create", "read"] },
      { key: second, targets: ["create", "read"] },
    ],
    targets: ["create", "read"],
  };
  const operations = [
    { operation: "create", parameters: [], returnType: "reference" },
    {
      operation: "read",
      parameters: ["reference", "number"],
      returnType: "optional-reference",
    },
  ] as const;
  const providers = [
    { ...first, operations },
    { ...second, operations },
  ];
  const result = runtime.prepareManagedRuntimeEntries(
    names,
    providers,
    "$runtime",
  );
  assert.ok(result.ok);
  assert.equal(result.value.stubs.declarations.length, 4);
  assert.equal(result.value.slots.length, 4);
  assert.deepEqual(result.value.slots[0], result.value.slots[2]);
  assert.deepEqual(result.value.slots[1], result.value.slots[3]);
  const skew = runtime.prepareManagedRuntimeEntries(
    names,
    [
      providers[0]!,
      {
        ...providers[1]!,
        operations: [operations[0], { ...operations[1], returnType: "number" }],
      },
    ],
    "$runtime",
  );
  assert.equal(skew.ok, false);
  if (!skew.ok) assert.match(skew.error, /ABI differs across slots/);
  const missing = runtime.prepareManagedRuntimeEntries(
    names,
    providers.slice(0, 1),
    "$runtime",
  );
  assert.equal(missing.ok, false);
  const wrongKey = runtime.prepareManagedRuntimeEntries(
    names,
    [{ ...providers[0]!, element: "different" }, providers[1]!],
    "$runtime",
  );
  assert.equal(wrongKey.ok, false);
});
