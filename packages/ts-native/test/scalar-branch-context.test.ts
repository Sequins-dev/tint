import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { verify } from "@tint/ir/scalar";
import { lowerModuleEntries } from "../src/closure/lowering/index.ts";
const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;
function lower(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const output = lowerModuleEntries(checked.value, [0], target, 4096);
  assert.ok(output.ok, JSON.stringify(output));
  assert.deepEqual(verify(output.value.module), { ok: true });
  return output.value.module.functions[0]!;
}
for (const body of [
  "if(a&&(b||!c))return 1;return 0;",
  "while(a&&(b||!c)){return 1;}return 0;",
  "do{if(a)return 1;}while(b||!c);return 0;",
  "for(;a&&(b||!c);){return 1;}return 0;",
  "return(a&&(b||!c))?1:0;",
])
  test(`condition branches avoid short-circuit result storage: ${body}`, () => {
    const fn = lower(
      `function run(a:boolean,b:boolean,c:boolean):number{${body}}`,
    );
    assert.equal(
      fn.slots.filter((type) => type === "boolean").length,
      lower(
        "function run(a:boolean,b:boolean,c:boolean):number{if(a){if(b)return 1;if(c)return 0;return 1;}return 0;}",
      ).slots.filter((type) => type === "boolean").length,
      "logical conditions need no more Boolean storage than nested branches",
    );
  });
test("a logical expression returned as a value retains its result storage", () => {
  const fn = lower(
    "function run(a:boolean,b:boolean,c:boolean):boolean{return a&&(b||!c);}",
  );
  assert.ok(fn.slots.filter((type) => type === "boolean").length > 6);
});

for (const [comparison, category] of [
  ["value === null", "null"],
  ["null !== value", "null"],
  ['typeof value === "string"', "string"],
  ['"number" !== typeof value', "number"],
  ['typeof value === "boolean"', "boolean"],
  ['typeof value === "undefined"', "undefined"],
]) {
  test("general comparison uses the tag directly: " + comparison, () => {
    const fn = lower(
      "function run(value: unknown): boolean {return " + comparison + ";}",
    );
    const operations = fn.blocks.flatMap((block) => block.instructions);
    assert.equal(
      operations.filter(
        (operation) =>
          operation.kind === "general-is" && operation.type === category,
      ).length,
      1,
    );
  });
}
