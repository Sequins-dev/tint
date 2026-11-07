import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseScript, rewriteModule } from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";
for (const [source, policy] of [
  ["function f(){}", "legacy"],
  ['function f(){"use strict";}', "opaque"],
  ["const f=()=>1;", "visible"],
  ["const o={m(){}};", "visible"],
  ['"use strict"; const f=()=>1;', "opaque"],
] as const)
  test("caller policy for " + source, () => {
    const parsed = parseScript(createSourceTextView(source));
    assert.ok(parsed.ok);
    const lowered = lowerScript(parsed.value, source);
    assert.ok(lowered.ok);
    const policies: unknown[] = [];
    rewriteModule(lowered.value, {
      expression(node) {
        if (
          node.kind === "call" &&
          node.callee.kind === "identifier" &&
          node.callee.name === "createSourceFunction"
        ) {
          const argument = node.arguments[7];
          policies.push(
            argument?.kind === "string" ? argument.value : undefined,
          );
        }
        return node;
      },
    });
    assert.deepEqual(policies, [policy]);
  });
