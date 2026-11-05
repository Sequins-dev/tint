import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";
import { workspaceSources, workspaceModules } from "./workspace-sources.ts";
test("SourceModule is an unchanged data-only frontend contract and loader has no linking backedge", () => {
  const path = "packages/typescript/src/modules/model.ts";
  assert.ok(existsSync(path), "frontend SourceModule contract must exist");
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  assert.deepEqual(
    source.statements.map((node) => node.kind),
    [ts.SyntaxKind.ImportDeclaration, ts.SyntaxKind.InterfaceDeclaration],
  );
  const contract = source.statements.find(ts.isInterfaceDeclaration);
  assert.ok(contract);
  assert.equal(contract.name.text, "SourceModule");
  assert.deepEqual(
    contract.members.map((member) => member.name?.getText(source)),
    ["sourcePosition", "id", "module", "dependencies"],
  );
  const snapshot = workspaceSources(),
    graph = workspaceModules([path], snapshot).map((module) => module.id);
  assert.ok(!graph.includes("packages/typescript/src/syntax/index.ts"));
  assert.ok(
    graph.every(
      (id) =>
        !id.startsWith("packages/ts-native/") &&
        !id.includes("/checker/") &&
        !id.includes("/modules/index.ts"),
    ),
  );
  const linking = ts.createSourceFile(
    "linking.ts",
    readFileSync("packages/ts-native/src/modules/index.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  assert.ok(
    !linking.statements.some(
      (node) =>
        ts.isInterfaceDeclaration(node) && node.name.text === "SourceModule",
    ),
  );
  assert.ok(
    !linking.statements.some(
      (node) =>
        ts.isExportDeclaration(node) &&
        node.exportClause?.getText(linking).includes("SourceModule"),
    ),
  );
  if (existsSync("packages/module-loader/package.json")) {
    const loader = JSON.parse(
      readFileSync("packages/module-loader/package.json", "utf8"),
    );
    assert.equal(loader.dependencies["@tint/ts-linking"], undefined);
  }
});
