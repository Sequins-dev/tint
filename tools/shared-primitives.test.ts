import assert from "node:assert/strict";
import test from "node:test";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { workspaceModules } from "./workspace-sources.ts";
import * as leaves from "@tint/native-runtime/intrinsics/shared-atomics";

test("shared primitives have no Node fallback and require explicit fixture bindings", () => {
  const scratch = new Uint32Array(2);
  for (const action of [
    () => leaves.compareExchangeSharedUnsigned(1, 8, 0, 1, 0, 1),
    () => leaves.readSharedUnsigned(1, 8, 0, 1, 0),
    () => leaves.writeSharedUnsigned(1, 8, 0, 1, 0, 0),
    () => leaves.readSharedWord64(1, 8, 0, 0, scratch),
    () => leaves.writeSharedWord64(1, 8, 0, 0, 0, 0),
    () => leaves.compareExchangeSharedWord64(1, 8, 0, 0, 0, 0, 0, scratch),
  ])
    assert.throws(action, (error) => error === "HOST_UNAVAILABLE");
  const modules = workspaceModules(projectRoots());
  const request = projectBuildRequest(modules, () => {});
  assert.ok(
    !request.hostBindings.some((binding) =>
      binding.operation.startsWith("shared-"),
    ),
  );
  assert.ok(
    !modules.some(
      (module) =>
        module.id ===
        "packages/native-runtime/src/intrinsics/shared-atomics.ts",
    ),
  );
});

import { readFileSync } from "node:fs";
import ts from "typescript";

for (const builder of [
  "tools/build-shared-primitives-fixture.ts",
  "tools/build-shared-cas-unsigned-fixture.ts",
])
  test(`${builder} explicitly authorizes every imported trusted leaf`, () => {
    const file = ts.createSourceFile(
      "fixture-builder.ts",
      readFileSync(builder, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const constants = new Map<string, ts.Expression>();
    for (const statement of file.statements)
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.initializer !== undefined
          )
            constants.set(declaration.name.text, declaration.initializer);
        }
    function string(expression: ts.Expression | undefined): string {
      assert.ok(expression);
      if (ts.isIdentifier(expression))
        return string(constants.get(expression.text));
      assert.ok(ts.isStringLiteralLike(expression));
      return expression.text;
    }
    function property(
      object: ts.ObjectLiteralExpression,
      name: string,
    ): ts.Expression | undefined {
      for (const item of object.properties) {
        if (ts.isShorthandPropertyAssignment(item) && item.name.text === name)
          return item.name;
        if (ts.isPropertyAssignment(item) && item.name.getText(file) === name)
          return item.initializer;
      }
      return undefined;
    }
    const call = file.statements
      .filter(ts.isExpressionStatement)
      .map((statement) => statement.expression)
      .find(
        (expression) =>
          ts.isCallExpression(expression) &&
          expression.expression.getText(file) === "verifyHostedFixture",
      );
    assert.ok(call && ts.isCallExpression(call));
    const source = call.arguments[0],
      dependencies = call.arguments[2],
      runtimes = call.arguments[5];
    assert.ok(source && ts.isNoSubstitutionTemplateLiteral(source));
    assert.ok(dependencies && ts.isArrayLiteralExpression(dependencies));
    assert.ok(runtimes && ts.isArrayLiteralExpression(runtimes));
    const locations = new Map(
      dependencies.elements.map((element) => {
        assert.ok(ts.isArrayLiteralExpression(element));
        return [string(element.elements[0]), string(element.elements[1])];
      }),
    );
    const bindings = constants.get("hostBindings");
    assert.ok(bindings && ts.isArrayLiteralExpression(bindings));
    const grants = bindings.elements.map((element) => {
      assert.ok(ts.isObjectLiteralExpression(element));
      return {
        module: string(property(element, "module")),
        name: string(property(element, "name")),
      };
    });
    const owners = runtimes.elements.map((element) => {
      assert.ok(ts.isObjectLiteralExpression(element));
      return string(property(element, "module"));
    });
    const fixture = ts.createSourceFile(
      "fixture.ts",
      source.text,
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of fixture.statements)
      if (ts.isImportDeclaration(statement)) {
        const module = locations.get(string(statement.moduleSpecifier));
        assert.ok(module);
        const imports = statement.importClause?.namedBindings;
        assert.ok(imports && ts.isNamedImports(imports));
        for (const imported of imports.elements) {
          const name = imported.propertyName?.text ?? imported.name.text;
          assert.ok(
            grants.some(
              (grant) => grant.module === module && grant.name === name,
            ),
            `${name} needs an explicit fixture host binding`,
          );
          assert.ok(
            owners.includes(module),
            `${name} needs a declared fixture runtime`,
          );
        }
      }
  });
