import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import {
  eraseTypeSyntax,
  parseModule,
  typeOnlyDeclarations,
  type Module,
} from "@tint/typescript/syntax";

function parse(text: string): Module {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
function kinds(module: Module): string[] {
  return module.statements.map((statement) => statement.kind);
}

test("type declarations and satisfies erase to their runtime meaning", () => {
  const erased = eraseTypeSyntax(
    parse(
      "interface P { x: number }\ntype Q = P;\nexport const a = { x: 1 } satisfies P;",
    ),
  );
  assert.deepEqual(kinds(erased), ["empty", "empty", "variable"]);
  const statement = erased.statements[2];
  assert.ok(statement?.kind === "variable");
  const declaration = statement.declarations[0];
  assert.ok(
    declaration?.kind !== "object-binding" &&
      declaration?.kind !== "array-binding",
  );
  assert.equal(declaration?.initializer?.kind, "object");
});

test("imports used only as types are elided, as TypeScript emits them", () => {
  const erased = eraseTypeSyntax(
    parse(
      'import type { T } from "./t";\nimport { U, v } from "./u";\nimport { W } from "./w";\nimport "./effects";\nlet x: U = v; let y: W;',
    ),
  );
  const imports = erased.imports.map((declaration) => [
    declaration.specifier,
    declaration.bindings.map((binding) => binding.local),
  ]);
  assert.deepEqual(imports, [
    ["./u", ["v"]],
    ["./effects", []],
  ]);
});

test("cross-module type exports are dropped from imports and re-exports", () => {
  const erased = eraseTypeSyntax(
    parse(
      'import { Shape, area } from "./shapes";\nexport { Shape, area };\nexport { Kind } from "./shapes";\nconst s: Shape = area;',
    ),
    {
      typeExport: (specifier, name) =>
        specifier === "./shapes" && (name === "Shape" || name === "Kind"),
    },
  );
  const exported = erased.statements
    .filter((statement) => statement.kind === "export")
    .map((statement) =>
      statement.kind === "export"
        ? (statement.declaration.bindings ?? []).map(
            (binding) => binding.exported,
          )
        : [],
    );
  assert.deepEqual(exported, [["area"]]);
  assert.deepEqual(
    erased.imports.map((declaration) =>
      declaration.bindings.map((binding) => binding.local),
    ),
    [["area"]],
  );
});

test("type-only declarations exclude names that also declare values", () => {
  const names = typeOnlyDeclarations(
    parse("interface A {}\ntype B = number;\ninterface C {}\nconst C = 1;"),
  );
  assert.deepEqual([...names].sort(), ["A", "B"]);
});
