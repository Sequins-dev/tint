import type { RecordAccessChoice } from "@tint/ts-native/scalar";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Expression } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { verify } from "@tint/ir/scalar";
import { createRecordContracts } from "../src/closure/lowering/records.ts";

const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;
function fixture(
  text = `
    class Box {value:number=1; read():number{return this.value;}}
    function use(box:Box):number{return box.read();}
    function field(box:Box):number{return box.value;}
  `,
) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const records = createRecordContracts(
    checked.value,
    target,
    4096,
    (message) => {
      throw Error(message);
    },
  );
  return { checked: checked.value, records };
}

test("class storage separates shared methods, own overrides and field initialization", () => {
  const { checked, records } = fixture();
  assert.equal(checked.classes?.length, 1);
  const storage = records.classes[0]!;
  assert.equal(storage.contract, checked.classes[0]);
  const instance = records.records[storage.instance]!,
    prototype = records.records[storage.prototype]!;
  assert.notEqual(records.forType(storage.contract.instance), storage.instance);
  assert.equal(instance.fields[0]!.type, "number");
  // Own data fields are assigned during construction before any read (the
  // checker proves it), so they carry no initialization state.
  assert.equal(instance.fields[0]!.stateOffset, undefined);
  assert.equal(instance.fields[0]!.deferred, true);
  assert.equal(instance.fields[1]!.type, "optional-reference");
  assert.notEqual(instance.fields[1]!.presenceOffset, undefined);
  assert.equal(instance.fields[storage.prototypeField]!.type, "reference");
  assert.equal(instance.fields[storage.prototypeField]!.mutable, false);
  assert.equal(prototype.fields.length, 2);
  assert.notEqual(prototype.fields[0]!.stateOffset, undefined);
  assert.equal(prototype.fields[1]!.type, "reference");
  assert.ok(verify({ functions: [], records: records.records }).ok);
});

test("class member access dispatches on the class layout with prototype fallback", () => {
  const { checked, records } = fixture();
  const members: (Expression & { kind: "member" })[] = [];
  checked.expressions.forEach((_, node) => {
    if (
      node.kind === "member" &&
      node.object.kind === "identifier" &&
      node.object.name === "box"
    )
      members.push(node);
  });
  assert.equal(members.length, 2);
  for (const member of members) {
    records.access(
      member,
      member.object,
      member.property,
      member.property === "read" ? "reference" : "number",
      false,
    );
    const choices = records.accesses.get(member)!.choices;
    const inherited = choices.find(
      (choice) => choice.record === records.classes[0]!.instance,
    );
    assert.ok(inherited);
    if (member.property === "read") {
      assert.equal(
        inherited.prototype?.access.choices[0]?.record,
        records.classes[0]!.prototype,
      );
      assert.equal(inherited.type, "optional-reference");
      records.access(member, member.object, member.property, "reference", true);
      assert.ok(
        records.accesses
          .get(member)!
          .choices.some(
            (choice) => choice.record === records.classes[0]!.instance,
          ),
      );
    } else assert.equal(inherited.initialized, false);
    // Values of a class type are its instances: no plain record layout is
    // dispatched on, so record facts can prove the class layout.
    assert.equal(choices.length, 1);
  }
});

test("constructor properties use function environments, never ordinary record identity", () => {
  const { checked, records } = fixture(`
    class Box {static count:number=1;static read():number{return this.count;}}
    function read(box:{new():Box;count:number}):number{return box.count;}
  `);
  const storage = records.classes[0]!;
  const state = records.records[storage.constructorState]!;
  assert.equal(state.fields[0]!.type, "reference");
  assert.equal(state.fields[0]!.mutable, false);
  assert.notEqual(state.fields[1]!.stateOffset, undefined);
  assert.equal(state.fields[2]!.type, "reference");
  assert.notEqual(
    state.fields[storage.constructionField]!.stateOffset,
    undefined,
  );
  assert.equal(records.forType(storage.contract.constructor), undefined);
  const members: (Expression & { kind: "member" })[] = [];
  checked.expressions.forEach((_, node) => {
    if (
      node.kind === "member" &&
      node.object.kind === "identifier" &&
      node.object.name === "box"
    )
      members.push(node);
  });
  assert.equal(members.length, 1);
  const member = members[0]!;
  for (const write of [false, true]) {
    records.access(member, member.object, "count", "number", write);
    const access = records.accesses.get(member)!;
    assert.equal(access.functionEnvironment, true);
    assert.deepEqual(
      access.choices.map((choice) => choice.record),
      [storage.constructorState],
    );
    assert.equal(access.choices[0]!.initialized, true);
  }
});

test("new contracts select hidden construction entries through compatible constructor shapes", () => {
  const { checked, records } = fixture(`
    class Box {constructor(value:number){}}
    class Other {static extra:number=1;constructor(value:number){}}
    function create(C:{new(value:number):Box}):Box{return new C(42);}
  `);
  const nodes: (Expression & { kind: "new" })[] = [];
  checked.expressions.forEach((_, node) => {
    if (node.kind === "new") nodes.push(node);
  });
  assert.equal(nodes.length, 1);
  const node = nodes[0]!;
  records.constructClass(node, 7);
  const call = records.constructors?.get(node);
  assert.ok(call);
  assert.equal(call.target, 7);
  assert.equal(call.entry.functionEnvironment, true);
  assert.equal(call.entry.type, "reference");
  assert.equal(call.entry.choices.length, 2);
  for (const storage of records.classes) {
    const choice: RecordAccessChoice | undefined = call.entry.choices.find(
      (candidate) => candidate.record === storage.constructorState,
    );
    assert.ok(choice);
    assert.equal(choice.field, storage.constructionField);
    assert.equal(choice.initialized, true);
  }
});

test("object literals typed as a class instance are plain records accesses also dispatch on", () => {
  const { checked, records } = fixture(`
    class Box {value:number=1; read():number{return this.value;}}
    function literal():Box{return {value:2, read():number{return 2;}};}
    function field(box:Box):number{return box.value;}
  `);
  let literal: (Expression & { kind: "object" }) | undefined;
  let member: (Expression & { kind: "member" }) | undefined;
  checked.expressions.forEach((_, node) => {
    if (node.kind === "object") literal = node;
    if (node.kind === "member" && node.property === "value") member = node;
  });
  assert.ok(literal !== undefined && member !== undefined);
  records.construct(literal);
  const plain = records.constructions.get(literal)?.record;
  assert.ok(plain !== undefined);
  records.access(member, member.object, "value", "number", false);
  const choices = records.accesses.get(member)!.choices.map((c) => c.record);
  assert.deepEqual(choices, [records.classes[0]!.instance, plain]);
});
