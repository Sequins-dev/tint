import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { resolveInterfaceTypes } from "../src/checker/index.ts";
function resolve(source: string) {
  const bytes = new TextEncoder().encode(source);
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return resolveInterfaceTypes(parsed.value, []);
}
test("object and interface call/construct signatures preserve independent capabilities", () => {
  const built = resolve(`
    interface Value { x:number; }
    interface Factory { new(x:number):Value; version:number; }
    interface Both extends Factory { (x:number):string; }
    type NewValue = new (x:number) => Value;
    type Callable = { (x:number):string; new(x:number):Value; version:number; };
  `);
  assert.ok(built.ok, JSON.stringify(built));
  const { names, types, system } = built.value;
  const factory = names.get("Factory")!,
    both = names.get("Both")!,
    plain = names.get("NewValue")!,
    callable = names.get("Callable")!;
  const number = types.findIndex((t) => t.kind === "number");
  const value = names.get("Value")!;
  assert.deepEqual(system.construct(factory, [number]), { ok: true, value });
  assert.deepEqual(system.construct(plain, [number]), { ok: true, value });
  assert.equal(system.call(factory, [number]).ok, false);
  assert.equal(system.call(both, [number]).ok, true);
  assert.equal(system.assignable(both, callable), true);
  assert.equal(system.assignable(callable, both), true);
});
test("generic and recursive constructor contracts retain type references", () => {
  const built = resolve(`
    interface Box<T> { value:T; }
    interface Factory<T> { new(value:T):Box<T>; }
    type NumberFactory = Factory<number>;
    interface Recursive { new():Recursive; }
  `);
  assert.ok(built.ok, JSON.stringify(built));
  const { names, types, system } = built.value;
  const factory = names.get("NumberFactory")!,
    number = types.findIndex((t) => t.kind === "number");
  const made = system.construct(factory, [number]);
  assert.ok(made.ok);
  assert.deepEqual(system.property(made.value, "value"), {
    ok: true,
    value: number,
  });
  const recursive = names.get("Recursive")!;
  assert.deepEqual(system.construct(recursive, []), {
    ok: true,
    value: recursive,
  });
});
test("intersections preserve disjoint call and construct signatures", () => {
  const built = resolve(
    `type A={(x:number):string};type B={new(x:number):{x:number}};type C=A&B;`,
  );
  assert.ok(built.ok, JSON.stringify(built));
  const { names, types, system } = built.value;
  const c = names.get("C")!,
    number = types.findIndex((t) => t.kind === "number");
  assert.equal(system.call(c, [number]).ok, true);
  assert.equal(system.construct(c, [number]).ok, true);
});
