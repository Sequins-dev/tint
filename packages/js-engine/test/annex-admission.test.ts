import test from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import {
  parseScript,
  rewriteModule,
  type Statement,
} from "@tint/typescript/syntax";
import {
  lowerScript,
  lowerEvalScript,
  scriptRuntimeSurface,
} from "../src/lowering/index.ts";
for (const kind of ["script", "eval"] as const)
  test(
    "Annex admission uses the public mutable-admission record contract: " +
      kind,
    () => {
      const source = "{function f(){return 1}}",
        parsed = parseScript(createSourceTextView(source));
      assert.ok(parsed.ok);
      const result =
        kind === "script"
          ? lowerScript(parsed.value, source)
          : lowerEvalScript(parsed.value, source);
      assert.ok(result.ok);
      const imported = result.value.imports
        .flatMap((x) => x.bindings)
        .find((x) => x?.imported === "AnnexGlobalFunction");
      assert.ok(
        imported?.typeOnly,
        "cross-image admission records need their declared identity",
      );
      const declarations: Extract<Statement, { kind: "variable" }>[] = [];
      rewriteModule(result.value, {
        statement(node) {
          if (node.kind === "variable") declarations.push(node);
          return node;
        },
      });
      const admission = declarations
        .flatMap((x) => x.declarations)
        .find(
          (x) =>
            x?.initializer?.kind === "object" &&
            x.initializer.properties.some(
              (p) => p.kind !== "spread" && p.name === "admitted",
            ),
        );
      assert.ok(admission);
      assert.equal(admission.type?.kind, "named");
      if (admission.type?.kind === "named")
        assert.equal(admission.type.name, "AnnexGlobalFunction");
      assert.ok(
        scriptRuntimeSurface().some((x) => x.name === "AnnexGlobalFunction"),
      );
    },
  );
test("Scripts without Annex admission records keep their import vocabulary", () => {
  const parsed = parseScript(createSourceTextView("var x=1;x;"));
  assert.ok(parsed.ok);
  const result = lowerScript(parsed.value);
  assert.ok(result.ok);
  assert.ok(
    !result.value.imports.some((x) =>
      x.bindings.some((y) => y?.imported === "AnnexGlobalFunction"),
    ),
  );
});
