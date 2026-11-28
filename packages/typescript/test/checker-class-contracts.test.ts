import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { linkModules } from "@tint/ts-native/modules";
import { resolveInterfaceTypes } from "../src/checker/index.ts";

function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const result = parseModule(source.value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

test("class contracts separate constructor/static members from instance receivers", () => {
  const resolved = resolveInterfaceTypes(
    parse(`
    class Box {
      value:number;
      static version:string="v1";
      constructor(value:number){this.value=value;}
      getValue():number{return this.value;}
      static create(value:number):Box{return new Box(value);}
    }
  `),
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const { names, types, system, classes } = resolved.value;
  const instance = names.get("Box");
  assert.notEqual(instance, undefined);
  const contract = classes[0];
  assert.ok(contract);
  assert.equal(contract.instance, instance);
  const number = types.findIndex((t) => t.kind === "number");
  assert.deepEqual(system.construct(contract.constructor, [number]), {
    ok: true,
    value: instance,
  });
  assert.equal(system.call(contract.constructor, [number]).ok, false);
  assert.equal(system.property(contract.constructor, "value").ok, false);
  assert.equal(system.property(contract.instance, "version").ok, false);
  assert.deepEqual(system.property(contract.constructor, "prototype"), {
    ok: true,
    value: contract.prototype,
  });
  assert.notEqual(contract.prototype, instance);
  assert.equal(system.property(contract.prototype, "value").ok, false);
  assert.deepEqual(system.property(contract.prototype, "constructor"), {
    ok: true,
    value: contract.constructor,
  });
  const method = system.property(contract.instance, "getValue");
  assert.ok(method.ok);
  assert.deepEqual(system.property(contract.prototype, "getValue"), method);
  assert.equal(system.call(method.value, [], contract.prototype).ok, false);
  assert.deepEqual(system.call(method.value, [], contract.instance), {
    ok: true,
    value: number,
  });
  assert.equal(system.call(method.value, []).ok, false);
  const create = system.property(contract.constructor, "create");
  assert.ok(create.ok);
  assert.deepEqual(system.call(create.value, [number], contract.constructor), {
    ok: true,
    value: instance,
  });
  assert.equal(
    system.call(create.value, [number], contract.instance).ok,
    false,
  );
});

test("generic recursive class contracts retain inner names after linking", () => {
  const module = parse(
    `export class Box<T>{value:T;constructor(value:T){this.value=value;}self():Box<T>{return this;}}type NumberBox=Box<number>;type StringBox=Box<string>;`,
  );
  const linked = linkModules(
    [{ id: "main", module, dependencies: new Map() }],
    "main",
    [],
    { evaluation: "instance" },
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const resolved = resolveInterfaceTypes(linked.value.module);
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const { system, types, classes } = resolved.value;
  assert.equal(classes.length, 2);
  for (const contract of classes) {
    const argument = contract.arguments[0];
    assert.ok(argument !== undefined);
    assert.deepEqual(system.property(contract.instance, "value"), {
      ok: true,
      value: argument,
    });
    assert.deepEqual(system.construct(contract.constructor, [argument]), {
      ok: true,
      value: contract.instance,
    });
    const self = system.property(contract.instance, "self");
    assert.ok(self.ok);
    assert.deepEqual(system.call(self.value, [], contract.instance), {
      ok: true,
      value: contract.instance,
    });
  }
  assert.deepEqual(classes.map((c) => types[c.arguments[0]!]!.kind).sort(), [
    "number",
    "string",
  ]);
});

test("base classes without constructors expose zero-argument construction", () => {
  const resolved = resolveInterfaceTypes(parse("class Empty{}"));
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const contract = resolved.value.classes[0];
  assert.ok(contract);
  assert.deepEqual(resolved.value.system.construct(contract.constructor, []), {
    ok: true,
    value: contract.instance,
  });
});

test("instance compatibility does not depend on unrelated static class members", () => {
  const resolved = resolveInterfaceTypes(
    parse(
      "class A{x:number=1;static tag:number=1;m():number{return this.x;}}class B{x:number=1;static tag:string='b';m():number{return this.x;}}",
    ),
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const a = resolved.value.names.get("A"),
    b = resolved.value.names.get("B");
  assert.ok(a !== undefined && b !== undefined);
  assert.ok(resolved.value.system.assignable(a, b));
  assert.ok(resolved.value.system.assignable(b, a));
});

test("static class members cannot capture instance type parameters or their outer namesakes", () => {
  for (const source of [
    "class C<T>{static value:T;}type N=C<number>;",
    "interface T{x:number;}class C<T>{static value:T;}type N=C<number>;",
    "class C<T>{static f(value:T):number{return 1;}}type N=C<number>;",
  ]) {
    const resolved = resolveInterfaceTypes(parse(source));
    assert.ok(!resolved.ok, source);
    assert.match(resolved.error.message, /static.*type parameter/);
  }
  const resolved = resolveInterfaceTypes(
    parse(
      "interface Shared<T>{value:T;}class C<T>{static value:Shared<number>;}type N=C<string>;",
    ),
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
});

test("derived class contracts list base properties first and inherit construction", () => {
  const resolved = resolveInterfaceTypes(
    parse(
      'class B{x:number;constructor(x:number){this.x=x;}m():number{return this.x;}} class D extends B{y:string="";override m():number{return 2;}} type I=D;',
    ),
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const derived = resolved.value.classes.find(
    (contract) => contract.base !== undefined,
  );
  assert.ok(derived !== undefined);
  const instance = resolved.value.types[derived.instance];
  assert.equal(instance?.kind, "object");
  assert.deepEqual(
    instance?.kind === "object"
      ? instance.properties.map((property) => property.name)
      : [],
    ["x", "m", "y"],
  );
  const constructor = resolved.value.types[derived.constructor];
  const construct =
    constructor?.kind === "object" && constructor.construct !== undefined
      ? resolved.value.types[constructor.construct]
      : undefined;
  assert.equal(construct?.kind, "function");
  assert.equal(
    construct?.kind === "function" ? construct.parameters.length : -1,
    1,
  );
});

test("class contract extraction resolves inherited accessors, statics, and parameter properties", () => {
  const resolved = resolveInterfaceTypes(
    parse(`
      class Base {
        static count: number = 1;
        static get doubled(): number { return this.count * 2; }
        static set doubled(v: number) { this.count = v / 2; }
        static get banner(): string { return "base"; }
        static label(prefix: string): string { return prefix + ":" + String(this.count); }
        constructor(public name: string, readonly id: number) {}
        get summary(): string { return this.name + "#" + String(this.id); }
        set summary(value: string) { this.name = value; }
        get tag(): string { return this.name; }
      }
      class Inherited extends Base {
        constructor(name: string, id: number, public extra: number) {
          super(name, id);
        }
      }
      class Overridden extends Base {
        override get summary(): string { return super.summary + "!"; }
        override set summary(value: string) { this.name = value; }
        override get tag(): string { return super.tag + "!"; }
        static override get banner(): string { return super.banner + "!"; }
      }
    `),
  );
  assert.ok(resolved.ok, JSON.stringify(resolved));
  assert.equal(resolved.value.classes.length, 3);
  const inherited = resolved.value.classes[1];
  assert.ok(inherited);
  const inhInstance = resolved.value.types[inherited.instance];
  const inhProps = inhInstance?.kind === "object" ? inhInstance.properties : [];
  const inhNames = inhProps.map((property) => property.name);
  assert.ok(inhNames.includes("name"));
  assert.ok(inhNames.includes("id"));
  assert.ok(inhNames.includes("extra"));
  const inhSummary = inhProps.find((p) => p.name === "summary");
  assert.ok(inhSummary && !inhSummary.readonly);
  const inhCtor = resolved.value.types[inherited.constructor];
  const inhStaticProps = inhCtor?.kind === "object" ? inhCtor.properties : [];
  const inhStaticNames = inhStaticProps.map((property) => property.name);
  assert.ok(inhStaticNames.includes("count"));
  assert.ok(inhStaticNames.includes("label"));
  const inhDoubled = inhStaticProps.find((p) => p.name === "doubled");
  assert.ok(inhDoubled && !inhDoubled.readonly);
  const overridden = resolved.value.classes[2];
  assert.ok(overridden);
  const overProto = resolved.value.types[overridden.prototype];
  const overProtoNames =
    overProto?.kind === "object"
      ? overProto.properties.map((property) => property.name)
      : [];
  assert.ok(overProtoNames.includes("@@get:summary"));
  assert.ok(overProtoNames.includes("@@set:summary"));
  assert.ok(overProtoNames.includes("@@get:tag"));
  const overCtor = resolved.value.types[overridden.constructor];
  const overCtorNames =
    overCtor?.kind === "object"
      ? overCtor.properties.map((property) => property.name)
      : [];
  assert.ok(overCtorNames.includes("@@get:banner"));
});

test("class contract extraction rejects unavailable inference and inheritance explicitly", () => {
  for (const [source, pattern] of [
    ["class C{x=1;}", /field.*annotation/],
    ["class C{m(){return 1;}}", /return.*annotation/],
    ["class C extends Base{}", /extend a non-generic typed class/],
    [
      "class B<T>{} class C extends B<number>{}",
      /extend a non-generic typed class/,
    ],
    [
      "class B{m():number{return 1;}} class C extends B{m:number=2;}",
      /same kind/,
    ],
    [
      "class B{get x():number{return 1;}} class C extends B{x:number=2;}",
      /same kind/,
    ],
    [
      "class B{static get s():number{return 1;}} class C extends B{static s:number=2;}",
      /same kind/,
    ],
    ["class C{set x(v:number){}}", /setters without a getter/],
    [
      "class B{get x():number{return 1;}set x(v:number){}} class C extends B{override set x(v:number){}}",
      /setters without a getter/,
    ],
    [
      "class B{get x():number{return 1;}set x(v:number){}} class C extends B{override get x():number{return 2;}}",
      /partial override of a writable base accessor/,
    ],
    [
      "class B{static get s():number{return 1;}static set s(v:number){}} class C extends B{static override get s():number{return 2;}}",
      /partial override of a writable base accessor/,
    ],
    ["class C{[name]:number;}", /computed/],
  ] as const) {
    const resolved = resolveInterfaceTypes(parse(source));
    assert.ok(!resolved.ok, source);
    assert.match(resolved.error.message, pattern);
  }
});
