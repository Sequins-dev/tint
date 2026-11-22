import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { verify } from "@tint/ir/scalar";
import {
  lowerModuleEntries,
  type ModuleEntryOptions,
} from "../src/closure/lowering/index.ts";
const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;
function lower(text: string, entries = [0], options?: ModuleEntryOptions) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const output = lowerModuleEntries(
    checked.value,
    entries,
    target,
    4096,
    options,
  );
  assert.ok(output.ok, JSON.stringify(output));
  assert.deepEqual(verify(output.value.module), { ok: true });
  return output.value.module.functions[0]!;
}

test("a module with a checked general record view emits literal tag tests", () => {
  const fn = lower(
    `interface Witness { marker: number }
     function run(value: unknown): boolean {
       return value === null || typeof value === "string";
     }
     function view(value: unknown, witness: Witness): Witness | undefined {
       throw "unbound view";
     }`,
    [0, 1],
    { recordBindings: [{ function: 1, operation: "view" }] },
  );
  const tags = fn.blocks.flatMap((block) =>
    block.instructions.flatMap((operation) =>
      operation.kind === "general-is" ? [operation.type] : [],
    ),
  );
  assert.deepEqual(tags, ["null", "string"]);
});
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

for (const [comparison, operand] of [
  ["value === null", "general-null"],
  ["null !== value", "general-null"],
  ['typeof value === "string"', "general-kind"],
  ['"number" !== typeof value', "general-kind"],
  ['typeof value === "boolean"', "general-kind"],
  ['typeof value === "undefined"', "general-kind"],
]) {
  test(
    "typed literal comparison emits its general operand: " + comparison,
    () => {
      const fn = lower(
        "function run(value: unknown): boolean {return " + comparison + ";}",
      );
      const operations = fn.blocks.flatMap((block) => block.instructions);
      assert.equal(
        operations.filter((operation) => operation.kind === operand).length,
        1,
      );
    },
  );
}

test("realm typeof comparisons test primitive tags without the classifier", () => {
  const fn = lower(
    `interface Witness { marker: number }
     function run(value: unknown): number {
       let count = 0;
       if (typeof value === "number") count++;
       if ("boolean" !== typeof value) count++;
       if (typeof value === "string") count++;
       if (typeof value === "undefined") count++;
       if (typeof value === "function") count++;
       return count;
     }
     function classify(value: unknown): string {
       throw "unbound classifier";
     }
     function view(value: unknown, witness: Witness): Witness | undefined {
       throw "unbound view";
     }`,
    [0, 1, 2],
    {
      recordBindings: [{ function: 2, operation: "view" }],
      realmTypeof: { function: 1, applies: () => true },
    },
  );
  const operations = fn.blocks.flatMap((block) => block.instructions);
  assert.deepEqual(
    operations.flatMap((operation) =>
      operation.kind === "general-is" ? [operation.type] : [],
    ),
    ["number", "boolean", "string"],
  );
  // [[IsHTMLDDA]] objects report "undefined", and only the classifier
  // distinguishes callable objects.
  assert.equal(
    operations.filter((operation) => operation.kind === "call").length,
    2,
  );
});
