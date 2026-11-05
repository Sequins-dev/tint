import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import type { PrimitiveRuntime } from "@tint/ts-native/scalar";

export function primitiveUnionFixture(
  reverseEntries = false,
  runtimeSource = readFileSync(
    "packages/native-runtime/src/values/index.ts",
    "utf8",
  ),
) {
  const bytes = new TextEncoder().encode(
    runtimeSource +
      `
    function choose(flag:boolean):number|string { if(flag)return 7;return "a"; }
    function inspect(value:number|string):number {
      if(typeof value === "number")return value+1;
      return value.length;
    }
    function same(a:number|string,b:number|string):boolean{return a===b;}
    function inspectUnknown(value:unknown):number {
      if(typeof value === "number" || typeof value === "string")return inspect(value);
      return 0;
    }
    function fallback(value:number|string|undefined):number|string{return value??1;}
    function run(n:number):number {
      const a=choose(true), b=choose(false);
      if(!same(a,7)||same(a,b))return -1;
      if(a===b||a!==7||b!=="a"||!a||!b)return -2;
      return inspect(a)+inspect(b)+inspect(fallback(undefined));
    }`,
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const c = checked.value;
  function id(name: string): number {
    const node = c.module.statements.find(
      (s) => s.kind === "function" && s.name === name,
    );
    const fn = c.bindings.functions.find((f) => f.node === node);
    assert.ok(fn);
    return fn.id;
  }
  const primitives: PrimitiveRuntime = {
    fromNull: id("fromNull"),
    isNullish: id("isNullish"),
    fromUndefined: id("fromUndefined"),
    fromNumber: id("fromNumber"),
    fromBoolean: id("fromBoolean"),
    fromString: id("fromString"),
    fromOptionalNumber: id("fromOptionalNumber"),
    fromOptionalString: id("fromOptionalString"),
    fromOptionalBoolean: id("fromOptionalBoolean"),
    fromOptionalBox: id("fromOptionalBox"),
    readNumber: id("readNumber"),
    readBoolean: id("readBoolean"),
    readString: id("readString"),
    readOptionalNumber: id("readOptionalNumber"),
    readOptionalString: id("readOptionalString"),
    readOptionalBoolean: id("readOptionalBoolean"),
    kindOf: id("kindOf"),
    truthy: id("truthy"),
    strictEqual: id("strictEqual"),
    canonicalKey: id("canonicalKey"),
    canonicalOptionalNumber: id("canonicalOptionalNumber"),
  };
  const target = {
    pointerSize: 8,
    wordSize: 8,
    allocationAlignment: 16,
    frameAlignment: 16,
    maxAlignment: 16,
  } as const;
  const entries = c.bindings.functions.map((f) => f.id);
  if (reverseEntries) entries.reverse();
  const lowered = lowerModuleEntries(c, entries, target, 4096, { primitives });
  assert.ok(lowered.ok, JSON.stringify(lowered));
  return { module: lowered.value.module, entry: entries.indexOf(id("run")) };
}
