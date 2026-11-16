import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { workspaceSources, workspaceModules } from "./workspace-sources.ts";
test("ABI entries are data-only contracts with no compiler, runtime or host dependencies", () => {
  const manifest = JSON.parse(
    readFileSync("packages/abi/package.json", "utf8"),
  );
  assert.deepEqual(Object.keys(manifest.exports), [
    "./function",
    "./shared-block",
    "./heap-debug",
    "./host",
    "./relocation",
    "./unwind",
    "./weak-slot",
  ]);
  assert.deepEqual(manifest.dependencies, {});
  assert.equal(manifest.exports["."], undefined);
  const path = "packages/abi/src/function.ts",
    source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
  assert.ok(
    source.statements.every(
      (node) =>
        ts.isVariableStatement(node) &&
        (node.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) &&
        node.declarationList.declarations.every(
          (declaration) =>
            declaration.initializer !== undefined &&
            ts.isNumericLiteral(declaration.initializer),
        ),
    ),
  );
  assert.deepEqual(
    workspaceModules([path], workspaceSources()).map((module) => module.id),
    [path],
  );
});

test("shared block ABI is an independent scalar-only entry with aligned bounded fields", () => {
  const path = "packages/abi/src/shared-block.ts";
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const values = new Map<string, number>();
  for (const statement of source.statements) {
    assert.ok(ts.isVariableStatement(statement));
    assert.ok((statement.declarationList.flags & ts.NodeFlags.Const) !== 0);
    assert.ok(
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
    );
    for (const declaration of statement.declarationList.declarations) {
      assert.ok(ts.isIdentifier(declaration.name));
      assert.ok(
        declaration.initializer && ts.isNumericLiteral(declaration.initializer),
      );
      values.set(declaration.name.text, Number(declaration.initializer.text));
    }
  }
  for (const prefix of ["sharedRegistry", "sharedBlock"]) {
    const extent = values.get(
      prefix === "sharedRegistry"
        ? "sharedRegistryHeaderBytes"
        : "sharedBlockDescriptorBytes",
    );
    assert.ok(extent !== undefined && extent > 0 && extent % 8 === 0);
    const offsets = [...values]
      .filter(([name]) => name.startsWith(prefix) && name.endsWith("Offset"))
      .map(([, value]) => value);
    assert.equal(new Set(offsets).size, offsets.length);
    for (const offset of offsets)
      assert.ok(offset >= 0 && offset % 8 === 0 && offset + 8 <= extent);
  }
  assert.deepEqual(
    workspaceModules([path], workspaceSources()).map((module) => module.id),
    [path],
  );
});
