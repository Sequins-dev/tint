import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import {
  verify,
  provenDirectOnlyFunctions,
  type ModuleIR,
} from "@tint/ir/scalar";
import { lowerReferenceLists } from "@tint/ir/optimization";
test("dense-list rewriting exports the exact final entry and signature targets", () => {
  const sparse = readFileSync(
    "packages/foundation/src/collections/sparse-list.ts",
    "utf8",
  )
    .replaceAll("<T>", "")
    .replace(/\bT\b/g, "Value|undefined");
  const parsed = parseModule(
    createSourceTextView(
      "interface Value{value:number;}" +
        sparse +
        "function run():number{const list=createList(0);writeList(list,0,{value:42});const value=readList(list,0);return value===undefined?0:value.value;}",
    ),
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const entries = checked.value.bindings.functions
    .filter((fn) => fn.parent === undefined)
    .map((fn) => fn.id);
  const lowered = lowerModuleEntries(
    checked.value,
    entries,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const parsedModule = parsed.value,
    checkedModule = checked.value;
  function id(name: string): number {
    const declaration = parsedModule.statements.find(
      (s) => s.kind === "function" && s.name === name,
    );
    const fn = checkedModule.bindings.functions.find(
      (fn) => fn.node === declaration,
    );
    assert.ok(fn, name);
    return entries.indexOf(fn.id);
  }
  const binding = {
    create: id("createList"),
    read: id("readList"),
    write: id("writeList"),
    push: id("pushList"),
    length: id("lengthList"),
    has: id("hasList"),
    delete: id("deleteList"),
    resize: id("resizeList"),
  };
  const address = lowered.value.module.functions.length;
  const module: ModuleIR = {
    ...lowered.value.module,
    functions: [
      ...lowered.value.module.functions,
      {
        id: address,
        name: "exportAddresses",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "function-address",
                id: 0,
                target: binding.read,
                part: "entry",
                start: 0,
                end: 0,
              },
              {
                kind: "function-address",
                id: 1,
                target: binding.read,
                part: "signature",
                start: 0,
                end: 0,
              },
            ],
            terminator: { kind: "return", value: 0, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const roots = [id("run"), address];
  const rewritten = lowerReferenceLists(module, [binding], roots);
  assert.ok(rewritten, "dense-list rewrite declined");
  assert.ok(
    verify(rewritten.module).ok,
    JSON.stringify(verify(rewritten.module)),
  );
  const operations =
    rewritten.module.functions[address]!.blocks[0]!.instructions;
  for (const op of operations) {
    assert.equal(op.kind, "function-address");
    if (op.kind !== "function-address") continue;
    assert.notEqual(op.target, binding.read);
    assert.match(
      rewritten.module.functions[op.target]!.name,
      /__tint_reference_list/,
    );
    assert.equal(
      provenDirectOnlyFunctions(rewritten.module, roots)?.[op.target],
      0,
    );
  }
  assert.equal(operations[0]!.kind, "function-address");
});
