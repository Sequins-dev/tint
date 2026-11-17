import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Statement } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { pruneUnusedModules } from "../src/native/module-pruning.ts";

function source(
  id: string,
  text: string,
  dependencies: Record<string, string> = {},
): SourceModule {
  const bytes = new TextEncoder().encode(text),
    decoded = createSourceText(bytes, bytes.length);
  assert.ok(decoded.ok);
  const parsed = parseModule(decoded.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return {
    id,
    module: parsed.value,
    dependencies: new Map(Object.entries(dependencies)),
  };
}

/** Modules the linker reaches from the entry (through every import). */
function reachable(modules: readonly SourceModule[], entry: string): string[] {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const seen = [entry];
  for (let i = 0; i < seen.length; i++) {
    const module = byId.get(seen[i] ?? "");
    if (module === undefined) continue;
    for (const declaration of module.module.imports) {
      const target = module.dependencies.get(declaration.specifier);
      if (target !== undefined && !seen.includes(target)) seen.push(target);
    }
  }
  return seen.sort();
}

function statementsOf(
  modules: readonly SourceModule[],
  id: string,
): readonly Statement[] {
  const module = modules.find((item) => item.id === id);
  assert.ok(module !== undefined, id);
  return module.module.statements;
}

const barrel = {
  "./used.ts": "used",
  "./pure.ts": "pure",
  "./effect.ts": "effect",
  "./types.ts": "types",
};
function program(entryText: string, extra: SourceModule[] = []) {
  return [
    source("entry", entryText, { barrel: "barrel" }),
    source(
      "barrel",
      'export { used } from "./used.ts";\n' +
        'export { pure } from "./pure.ts";\n' +
        'export { effect } from "./effect.ts";\n' +
        'export { type Shape, helper } from "./types.ts";',
      barrel,
    ),
    source("used", "export function used(): number { return 1; }"),
    source(
      "pure",
      'const table = [1, 2, 3], scale = 1 << 4;\nexport const label = "p" + scale;\nexport function pure(): number { return table.length; }',
    ),
    source(
      "effect",
      'export const log: string[] = [];\nlog.push("effect");\nexport function effect(): number { return log.length; }',
    ),
    source(
      "types",
      "export interface Shape { readonly size: number }\nexport function helper(shape: Shape): number { return shape.size; }",
    ),
    ...extra,
  ];
}

test("unused pure re-exports are not instantiated; used ones are kept", () => {
  const modules = program(
    'import { used } from "barrel";\nexport function run(): number { return used(); }',
  );
  const pruned = pruneUnusedModules(modules, "entry");
  assert.deepEqual(reachable(pruned, "entry"), [
    "barrel",
    "effect",
    "entry",
    "types",
    "used",
  ]);
});

test("a skipped re-export still evaluates observable modules it would reach", () => {
  // `wrapper` has a pure body but imports `effect`, whose body pushes to a
  // log: skipping `wrapper` must still evaluate `effect`, in place.
  const pruned = pruneUnusedModules(
    [
      ...program(
        'import { used } from "barrel";\nexport function run(): number { return used(); }',
      ).filter((module) => module.id !== "barrel"),
      source(
        "barrel",
        'export { used } from "./used.ts";\n' +
          'export { wrapped } from "./wrapper.ts";\n' +
          'export { pure } from "./pure.ts";\n' +
          'export { effect } from "./effect.ts";',
        { ...barrel, "./wrapper.ts": "wrapper" },
      ),
      source(
        "wrapper",
        'import { effect } from "./effect.ts";\nexport function wrapped(): number { return effect(); }',
        { "./effect.ts": "effect" },
      ),
    ],
    "entry",
  );
  const statements = statementsOf(pruned, "barrel");
  assert.deepEqual(
    statements.map((statement) =>
      statement.kind === "import"
        ? "import " + JSON.stringify(statement.declaration.bindings)
        : statement.kind === "export"
          ? (statement.declaration.typeOnly ? "export type " : "export ") +
            (statement.declaration.bindings ?? [])
              .map((binding) => binding.exported)
              .join(",")
          : statement.kind,
    ),
    // `wrapped` becomes a side-effect import of `effect`; `pure` goes;
    // `effect` itself is observable, so its re-export stays.
    ["export used", "import []", "export effect"],
  );
  const barrelModule = pruned.find((module) => module.id === "barrel");
  const effectImport = statements[1];
  assert.ok(effectImport?.kind === "import");
  assert.equal(
    barrelModule?.dependencies.get(effectImport.declaration.specifier),
    "effect",
  );
  assert.ok(!reachable(pruned, "entry").includes("wrapper"));
  // The linker evaluates in `imports` order, which must follow statements.
  assert.deepEqual(
    barrelModule?.module.imports.map((declaration) =>
      barrelModule.dependencies.get(declaration.specifier),
    ),
    ["used", "effect", "effect"],
  );
});

test("type-only uses keep type names resolvable without evaluation", () => {
  const pruned = pruneUnusedModules(
    program(
      'import type { Shape } from "barrel";\nexport function run(shape: Shape): number { return shape.size; }',
    ),
    "entry",
  );
  const exports = statementsOf(pruned, "barrel").filter(
    (statement) => statement.kind === "export",
  );
  const shape = exports.find(
    (statement) =>
      statement.kind === "export" &&
      statement.declaration.bindings?.some(
        (binding) => binding.exported === "Shape",
      ),
  );
  assert.ok(shape?.kind === "export");
  assert.equal(shape.declaration.typeOnly, true);
  assert.equal(shape.declaration.source?.typeOnly, true);
});

test("value uses through a re-export keep the original statement", () => {
  const modules = program(
    'import { helper, pure, used } from "barrel";\nexport function run(): number { return used() + pure() + helper({ size: 1 }); }',
  );
  const pruned = pruneUnusedModules(modules, "entry");
  assert.deepEqual(
    statementsOf(pruned, "barrel"),
    statementsOf(modules, "barrel"),
  );
});

test("star re-exports forward used names and type names", () => {
  const modules = [
    source(
      "entry",
      'import { used, type Shape } from "barrel";\nexport function run(): number { return used(); }',
      { barrel: "barrel" },
    ),
    source(
      "barrel",
      'export * from "./used.ts";\nexport * from "./types.ts";\nexport * from "./pure.ts";',
      { "./used.ts": "used", "./types.ts": "types", "./pure.ts": "pure" },
    ),
    source("used", "export function used(): number { return 1; }"),
    source(
      "types",
      "export interface Shape { readonly size: number }\nexport function helper(shape: Shape): number { return shape.size; }",
    ),
    source("pure", "export function pure(): number { return 2; }"),
  ];
  const pruned = pruneUnusedModules(modules, "entry");
  assert.deepEqual(reachable(pruned, "entry"), [
    "barrel",
    "entry",
    "types",
    "used",
  ]);
  const types = statementsOf(pruned, "barrel").find(
    (statement) =>
      statement.kind === "export" && statement.declaration.typeOnly,
  );
  assert.ok(types?.kind === "export");
  assert.deepEqual(
    types.declaration.bindings?.map((binding) => binding.exported),
    ["Shape"],
  );
});

test("modules declaring classes stay evaluated", () => {
  const modules = [
    source(
      "entry",
      'import { used } from "barrel";\nexport function run(): number { return used(); }',
      { barrel: "barrel" },
    ),
    source(
      "barrel",
      'export { used } from "./used.ts";\nexport { Box } from "./box.ts";',
      { "./used.ts": "used", "./box.ts": "box" },
    ),
    source("used", "export function used(): number { return 1; }"),
    source("box", "export class Box { value = 1; }"),
  ];
  const pruned = pruneUnusedModules(modules, "entry");
  assert.ok(reachable(pruned, "entry").includes("box"));
});

test("observable initializers keep a module evaluated", () => {
  // Calls, member reads of non-constant objects, constructors other than
  // empty collections and typed arrays, and reads of imported bindings in
  // the importer's own cycle are observable.
  const cases = [
    "export const a = compute();\nfunction compute(): number { return 1; }",
    "export const a = Math.PI;",
    "export const a = new Date();",
    'export const a = "x".split("");',
    "export const a = [...[1]];",
    "export const a = { ...{ b: 1 } };",
    "for (;;) break;",
  ];
  for (const text of cases) {
    const modules = [
      source(
        "entry",
        'import { used } from "barrel";\nexport function run(): number { return used(); }',
        { barrel: "barrel" },
      ),
      source(
        "barrel",
        'export { used } from "./used.ts";\nexport { a } from "./candidate.ts";',
        { "./used.ts": "used", "./candidate.ts": "candidate" },
      ),
      source("used", "export function used(): number { return 1; }"),
      source("candidate", text),
    ];
    const pruned = pruneUnusedModules(modules, "entry");
    assert.ok(reachable(pruned, "entry").includes("candidate"), text);
  }
});

test("effect-free initializers allow skipping", () => {
  const cases = [
    "export const a = 1, b = -a * 2, c = `t`, d = null, e = undefined;",
    "export const a = new Map<string, number>(), b = new Uint8Array([1, 2]);",
    "export const a = { f(): number { return 1; }, g: () => 2, h: [1, , 3] };",
    "export class A { static b = 1; }",
    'export const a = 1 > 0 ? "y" : "n";',
  ];
  for (const text of cases) {
    const modules = [
      source(
        "entry",
        'import { used } from "barrel";\nexport function run(): number { return used(); }',
        { barrel: "barrel" },
      ),
      source(
        "barrel",
        'export { used } from "./used.ts";\nexport { a } from "./candidate.ts";',
        { "./used.ts": "used", "./candidate.ts": "candidate" },
      ),
      source("used", "export function used(): number { return 1; }"),
      source("candidate", text),
    ];
    const pruned = pruneUnusedModules(modules, "entry");
    // Classes are linked only when evaluated, so a class module stays.
    assert.equal(
      reachable(pruned, "entry").includes("candidate"),
      text.includes("class"),
      text,
    );
  }
});

test("imported primitive constants are effect-free outside import cycles", () => {
  const constants = source(
    "constants",
    "export const one = 1, two = one << 1;",
  );
  const make = (cyclic: boolean) => [
    source(
      "entry",
      'import { used } from "barrel";\nexport function run(): number { return used(); }',
      { barrel: "barrel" },
    ),
    source(
      "barrel",
      'export { used } from "./used.ts";\nexport { mask } from "./mask.ts";',
      { "./used.ts": "used", "./mask.ts": "mask" },
    ),
    source("used", "export function used(): number { return 1; }"),
    source(
      "mask",
      'import { one, two } from "./constants.ts";\nexport const mask = one | two;',
      { "./constants.ts": "constants" },
    ),
    cyclic
      ? source(
          "constants",
          'import { mask } from "./mask.ts";\nexport const one = 1, two = one << 1;\nexport function m(): number { return mask; }',
          { "./mask.ts": "mask" },
        )
      : constants,
  ];
  assert.ok(
    !reachable(pruneUnusedModules(make(false), "entry"), "entry").includes(
      "mask",
    ),
  );
  // In a cycle the importer may run first and read a binding in its TDZ.
  assert.ok(
    reachable(pruneUnusedModules(make(true), "entry"), "entry").includes(
      "mask",
    ),
  );
});

test("roots with retained exports use only those exports", () => {
  const modules = [
    source("entry", 'import "runtime";\nimport "app";', {
      runtime: "barrel",
      app: "app",
    }),
    source("app", "export function run(): number { return 1; }"),
    source(
      "barrel",
      'export { used } from "./used.ts";\nexport { pure } from "./pure.ts";',
      { "./used.ts": "used", "./pure.ts": "pure" },
    ),
    source("used", "export function used(): number { return 1; }"),
    source("pure", "export function pure(): number { return 2; }"),
  ];
  const whole = pruneUnusedModules(modules, "entry");
  assert.ok(reachable(whole, "entry").includes("pure"));
  const selected = pruneUnusedModules(
    modules,
    "entry",
    new Map([["barrel", ["used"]]]),
  );
  assert.deepEqual(reachable(selected, "entry"), [
    "app",
    "barrel",
    "entry",
    "used",
  ]);
});

test("modules linked through created type-only re-exports keep their imports resolvable", () => {
  // `types` is reached only through the type-only re-export the rewrite
  // creates; the linker still links it, so its value import of `inner`
  // through `barrel2` must keep resolving, while `other` goes.
  const modules = [
    source(
      "entry",
      'import { used } from "barrel";\nexport function run(): number { return used(); }',
      { barrel: "barrel" },
    ),
    source(
      "barrel",
      'export { used } from "./used.ts";\nexport { helper, type Shape } from "./types.ts";',
      { "./used.ts": "used", "./types.ts": "types" },
    ),
    source("used", "export function used(): number { return 1; }"),
    source(
      "types",
      'import { inner } from "./barrel2.ts";\nexport interface Shape { readonly size: number }\nexport function helper(shape: Shape): number { return inner(shape.size); }',
      { "./barrel2.ts": "barrel2" },
    ),
    source(
      "barrel2",
      'export { inner } from "./inner.ts";\nexport { other } from "./other.ts";',
      { "./inner.ts": "inner", "./other.ts": "other" },
    ),
    source("inner", "export function inner(n: number): number { return n; }"),
    source("other", "export function other(): number { return 2; }"),
  ];
  const pruned = pruneUnusedModules(modules, "entry");
  const reached = reachable(pruned, "entry");
  assert.ok(reached.includes("types"));
  assert.ok(reached.includes("inner"));
  assert.ok(!reached.includes("other"));
});
