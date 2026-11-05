import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { collectRuntimeRequirements } from "../src/closure/lowering/runtime-requirements.ts";
function checked(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = checkClosureModule(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("requests sorting only for collection encodings actually sorted", () => {
  const source = checked(
    "function run(a:number[],b:string[],unused:boolean[]):void {a.sort((x,y)=>x-y);a.sort((x,y)=>y-x);b.sort((x,y)=>x.length-y.length);}",
  );
  assert.deepEqual(
    collectRuntimeRequirements(source)
      .sorts.map((sort) => sort.element)
      .sort(),
    ["number", "string"],
  );
});
test("discovers collection dependencies through recursive fields and function signatures", () => {
  const source = checked(`interface Item {value:number;children:Item[]}
 export function run(items:Item[],numbers:readonly number[],map:Map<string,Item[]>,set:Set<number>):Item[]{return items;}`);
  const result = collectRuntimeRequirements(source);
  assert.equal(result.unsupported.length, 0);
  assert.equal(result.lists.length, 2);
  assert.equal(result.sets.length, 1);
  assert.ok(result.maps.length >= 1);
  assert.equal(
    new Set(result.maps.map((m) => String(m.key) + ":" + String(m.value))).size,
    result.maps.length,
  );
  assert.equal(result.sets[0]?.element, "number");
  assert.equal(result.maps[0]?.key, "string");
  assert.ok(result.lists.some((l) => l.element === "number"));
  assert.deepEqual(collectRuntimeRequirements(source), result);
});
test("deduplicates primitive encodings and reports unsupported contracts explicitly", () => {
  const source = checked(
    `export function run(a:readonly number[],b:(number|undefined)[],c:boolean[],objects:Set<boolean>,unsupported:Set<never>):void{}`,
  );
  const result = collectRuntimeRequirements(source);
  assert.equal(result.lists.filter((l) => l.element === "number").length, 1);
  assert.ok(
    result.lists.some(
      (list) =>
        typeof list.element === "number" &&
        source.types[list.element]?.kind === "boolean",
    ),
  );
  assert.ok(
    result.sets.some(
      (set) =>
        typeof set.element === "number" &&
        source.types[set.element]?.kind === "boolean",
    ),
  );
  assert.deepEqual([...new Set(result.unsupported.map((u) => u.kind))].sort(), [
    "set",
  ]);
  assert.equal(
    new Set(result.unsupported.map((u) => u.type)).size,
    result.unsupported.length,
  );
});

test("dense type visitation avoids linear numeric set membership", () => {
  const declarations = Array.from(
    { length: 50 },
    (_, i) => `interface T${i} { next: T${(i + 1) % 50}; }`,
  ).join("\n");
  const source = checked(
    `${declarations}\nfunction run(value:T0):T0{return value;}`,
  );
  const original = Set.prototype.has;
  let numericLookups = 0;
  Set.prototype.has = function <T>(this: Set<T>, value: T): boolean {
    if (typeof value === "number") numericLookups++;
    return original.call(this, value);
  };
  try {
    assert.deepEqual(collectRuntimeRequirements(source), {
      lists: [],
      sets: [],
      maps: [],
      sorts: [],
      unsupported: [],
    });
  } finally {
    Set.prototype.has = original;
  }
  assert.equal(numericLookups, 0);
});
test("discovers general-value arrays without requiring a closed variant set", () => {
  const source = checked("function run(values:unknown[]):number{return 0;}");
  const result = collectRuntimeRequirements(source);
  assert.equal(result.unsupported.length, 0);
  assert.ok(
    result.lists.some(
      (list) =>
        typeof list.element === "number" &&
        source.types[list.element]?.kind === "unknown",
    ),
  );
});

test("function lists request traced reference storage and retain their checked signature", () => {
  const source = checked(
    "type Action=(value:number)=>number;export function run(actions:readonly Action[]):number{const action=actions[0];return action===undefined?0:action(actions.length);}",
  );
  const result = collectRuntimeRequirements(source);
  assert.deepEqual(result.unsupported, []);
  assert.ok(
    result.lists.some(
      (list) =>
        typeof list.element === "number" &&
        source.types[list.element]?.kind === "function",
    ),
  );
});
