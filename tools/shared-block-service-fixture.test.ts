import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import test from "node:test";
import ts from "typescript";

for (const [builderPath, factories] of [
  ["tools/build-shared-block-service-fixture.ts", ["nativeSharedMemoryHost"]],
  [
    "tools/build-shared-atomic-backing-fixture.ts",
    ["nativeSharedMemoryHost", "nativeSharedAtomicMemoryHost"],
  ],
] as const)
  test(`${builderPath} closes every trusted factory capability explicitly`, () => {
    const servicePath = "packages/native-runtime/src/shared-memory-host.ts";
    const service = ts.createSourceFile(
      servicePath,
      readFileSync(servicePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = new Map<string, string>();
    for (const statement of service.statements)
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.startsWith(".")
      ) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const binding of bindings.elements)
            imports.set(
              binding.name.text,
              posix.normalize(
                dirname(servicePath) + "/" + statement.moduleSpecifier.text,
              ),
            );
      }
    const required = factories.flatMap((factoryName) => {
      const factory = service.statements.find(
        (statement) =>
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === factoryName,
      );
      assert.ok(factory && ts.isFunctionDeclaration(factory) && factory.body);
      const returned = factory.body.statements.find(
        ts.isReturnStatement,
      )?.expression;
      assert.ok(returned && ts.isObjectLiteralExpression(returned));
      return returned.properties.map((property) => {
        assert.ok(
          ts.isPropertyAssignment(property) && ts.isIdentifier(property.name),
        );
        const callback = property.initializer;
        assert.ok(
          ts.isArrowFunction(callback) && ts.isCallExpression(callback.body),
        );
        assert.equal(
          callback.body.expression.getText(service),
          property.name.text,
        );
        const module = imports.get(property.name.text);
        assert.ok(module);
        return { module, name: property.name.text };
      });
    });
    const builder = ts.createSourceFile(
      "builder.ts",
      readFileSync(builderPath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const constants = new Map<string, ts.Expression>();
    for (const statement of builder.statements)
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name) && declaration.initializer)
            constants.set(declaration.name.text, declaration.initializer);
    function string(value: ts.Expression | undefined): string {
      assert.ok(value);
      if (ts.isIdentifier(value)) return string(constants.get(value.text));
      assert.ok(ts.isStringLiteralLike(value));
      return value.text;
    }
    function field(
      object: ts.ObjectLiteralExpression,
      name: string,
    ): ts.Expression | undefined {
      const found = object.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(builder) === name,
      );
      return found && ts.isPropertyAssignment(found)
        ? found.initializer
        : undefined;
    }
    const bindings = constants.get("hostBindings");
    assert.ok(bindings && ts.isArrayLiteralExpression(bindings));
    const grants = bindings.elements.map((element) => {
      assert.ok(ts.isObjectLiteralExpression(element));
      return {
        module: string(field(element, "module")),
        name: string(field(element, "name")),
      };
    });
    const call = builder.statements
      .filter(ts.isExpressionStatement)
      .map((statement) => statement.expression)
      .find(
        (expression) =>
          ts.isCallExpression(expression) &&
          expression.expression.getText(builder) === "verifyHostedFixture",
      );
    assert.ok(call && ts.isCallExpression(call));
    const runtimes = call.arguments[5];
    assert.ok(runtimes && ts.isArrayLiteralExpression(runtimes));
    for (const leaf of required) {
      assert.ok(
        grants.some(
          (grant) => grant.module === leaf.module && grant.name === leaf.name,
        ),
        leaf.name + " requires an explicit host binding",
      );
      const runtime = runtimes.elements.find(
        (element) =>
          ts.isObjectLiteralExpression(element) &&
          string(field(element, "module")) === leaf.module,
      );
      assert.ok(
        runtime && ts.isObjectLiteralExpression(runtime),
        leaf.name + " requires an explicit runtime",
      );
      const retained = field(runtime, "retainedExports");
      assert.ok(retained && ts.isArrayLiteralExpression(retained));
      assert.ok(
        retained.elements.map((element) => string(element)).includes(leaf.name),
        leaf.name + " must be retained in its own runtime",
      );
    }
    assert.equal(
      grants.length,
      required.length,
      "fixture must not grant unrelated leaves",
    );
  });
