import type { ClassContract } from "@tint/typescript/checker";
import type { Type } from "@tint/typescript/types";
import type { RecordLayout, ScalarType } from "@tint/ir/scalar";
import type { LayoutPlanner } from "@tint/foundation/layout";
import { planRecordLayout, type RecordFieldStorage } from "./record-layout.ts";

export interface ClassRecordStorage {
  readonly contract: ClassContract;
  readonly instance: number;
  readonly prototype: number;
  readonly prototypeField: number;
  readonly constructorState: number;
  readonly constructionField: number;
}
export interface PlannedClassRecords {
  readonly instance: RecordLayout;
  readonly prototype: RecordLayout;
  readonly instanceNames: readonly string[];
  readonly prototypeNames: readonly string[];
  /** Instance field index to prototype field index; -1 means an own data field. */
  readonly inherited: readonly number[];
  readonly prototypeField: number;
  readonly constructorState: RecordLayout;
  readonly constructorNames: readonly string[];
  readonly constructionField: number;
}

export function planClassRecords(
  contract: ClassContract,
  types: readonly Type[],
  planner: LayoutPlanner,
  encoding: (type: number) => ScalarType | undefined,
  fail: (message: string) => never,
): PlannedClassRecords {
  const instance = types[contract.instance],
    prototype = types[contract.prototype],
    constructor = types[contract.constructor];
  if (
    instance?.kind !== "object" ||
    prototype?.kind !== "object" ||
    constructor?.kind !== "object"
  )
    fail("class storage requires instance and prototype contracts");
  const instanceNames: string[] = [],
    prototypeNames: string[] = [],
    instanceFields: RecordFieldStorage[] = [],
    prototypeFields: RecordFieldStorage[] = [],
    inherited: number[] = [];
  for (const property of prototype.properties) {
    if (property === undefined) throw "prototype property invariant";
    // The back-reference is an opaque managed identity here. This does not
    // authorize treating the constructor itself as an ordinary record/function.
    const type: ScalarType | undefined =
      property.name === "constructor" ? "reference" : encoding(property.type);
    if (type === undefined) fail("unsupported class prototype storage");
    prototypeNames.push(property.name);
    prototypeFields.push({
      type,
      mutable: !property.readonly,
      optional: false,
      initialized: property.name === "constructor",
    });
  }
  for (const property of instance.properties) {
    if (property === undefined) throw "instance property invariant";
    const inheritedField =
      property.name === "constructor"
        ? -1
        : prototypeNames.indexOf(property.name);
    const type: ScalarType | undefined =
      inheritedField >= 0 ? "optional-reference" : encoding(property.type);
    if (type === undefined) fail("unsupported class instance storage");
    instanceNames.push(property.name);
    inherited.push(inheritedField);
    instanceFields.push({
      type,
      mutable: !property.readonly,
      optional: inheritedField >= 0,
      initialized: inheritedField < 0,
    });
  }
  const constructorNames: string[] = [],
    constructorFields: RecordFieldStorage[] = [];
  for (const property of constructor.properties) {
    if (property === undefined) throw "constructor property invariant";
    const type: ScalarType | undefined =
      property.name === "prototype" ? "reference" : encoding(property.type);
    if (type === undefined) fail("unsupported class constructor storage");
    const member = contract.members.find((member) => {
      if (member === undefined) throw "class member invariant";
      const element = member.node;
      if (element.kind === "static-block") return false;
      const key = element.key;
      return (
        element.static &&
        (key.kind === "string"
          ? key.value
          : key.kind === "number"
            ? String(key.value)
            : undefined) === property.name
      );
    });
    constructorNames.push(property.name);
    constructorFields.push({
      type,
      mutable: !property.readonly,
      optional: false,
      initialized: member?.node.kind === "field",
    });
  }
  // The construction closure is installed after cyclic class state is allocated.
  // It has no source property name and is distinct from the class [[Call]] entry.
  const constructionField = constructorFields.length;
  constructorFields.push({
    type: "reference",
    mutable: false,
    optional: false,
    initialized: true,
  });
  const prototypeField = instanceFields.length;
  // Hidden pointer has no source property name and cannot collide with a field.
  instanceFields.push({ type: "reference", mutable: false, optional: false });
  return {
    instance: planRecordLayout(instanceFields, planner, fail),
    prototype: planRecordLayout(prototypeFields, planner, fail),
    constructorState: planRecordLayout(constructorFields, planner, fail),
    constructorNames,
    constructionField,
    instanceNames,
    prototypeNames,
    inherited,
    prototypeField,
  };
}
