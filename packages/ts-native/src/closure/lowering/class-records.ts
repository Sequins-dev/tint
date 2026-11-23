import type { ClassContract } from "@tint/typescript/checker";
import type { ClassElement } from "@tint/typescript/syntax";
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
  /** The prototype's `constructor` field and the constructor state's `prototype` field. */
  readonly prototypeConstructorField: number;
  readonly statePrototypeField: number;
  /** Record ids of the member closure environments (see ClassMemberEnvironment). */
  readonly definitionEnvironment: number;
  readonly constructionEnvironment: number;
  readonly staticsEnvironment: number | undefined;
  readonly members: ClassMemberEnvironment;
}
/** Where a class definition finds its member closures (C1 source classes).
 * Each closure is created where the class statement is evaluated. Methods and
 * construction closures are stored in the definition environment; the
 * construction closures are copied into the construction environment, whose
 * first field is the prototype. Static field initializers are stored in the
 * statics environment, whose first field is the constructor. */
export interface ClassMemberEnvironment {
  /** Prototype methods: prototype field, definition environment field. */
  readonly methods: readonly ClassMethodStorage[];
  /** Static methods: constructor state field, definition environment field. */
  readonly staticMethods: readonly ClassMethodStorage[];
  /** Instance data fields in source order. An initializer closure has a
   * definition environment field and a construction environment field. */
  readonly fields: readonly ClassFieldStorage[];
  /** Static data fields in source order; initializers use the statics
   * environment field. */
  readonly staticFields: readonly ClassFieldStorage[];
  /** The constructor body, when the class declares one. */
  readonly body:
    | {
        readonly element: ClassElement;
        readonly environmentField: number;
        readonly constructionField: number;
      }
    | undefined;
  readonly definitionEnvironment: RecordLayout;
  readonly constructionEnvironment: RecordLayout;
  /** Present when the class has static fields. */
  readonly staticsEnvironment: RecordLayout | undefined;
}
export interface ClassMethodStorage {
  readonly element: ClassElement;
  /** Prototype field, or constructor state field for static methods. */
  readonly field: number;
  readonly environmentField: number;
}
export interface ClassFieldStorage {
  readonly element: ClassElement;
  /** Instance field, or constructor state field for static fields. */
  readonly field: number;
  readonly initializer:
    | {
        readonly environmentField: number;
        readonly constructionField: number;
      }
    | undefined;
  /** Fields without an initializer start undefined when the storage can
   * hold it; otherwise construction leaves them for the constructor body. */
  readonly undefinedDefault: boolean;
}
export interface PlannedClassRecords {
  readonly members: ClassMemberEnvironment;
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
      // Methods and the back-reference are writable data properties.
      mutable: true,
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
      // `readonly` is checked by TypeScript only: the property is writable
      // (untyped code and the constructor body assign it).
      mutable: true,
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
      // A class's `prototype` is non-writable; statics are writable.
      mutable: property.name !== "prototype",
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
  // Member closures (docs/design-typed-classes.md, C1): what this phase
  // does not lower fails explicitly.
  const methods: ClassMethodStorage[] = [],
    staticMethods: ClassMethodStorage[] = [],
    fields: ClassFieldStorage[] = [],
    staticFields: ClassFieldStorage[] = [];
  let body:
    | {
        element: ClassElement;
        environmentField: number;
        constructionField: number;
      }
    | undefined;
  let environmentFields = 0,
    constructionFields = 1,
    staticsFields = 1;
  function nameOf(element: ClassElement): string {
    if (element.kind === "static-block" || element.computed)
      fail("computed class member keys are not lowered yet");
    if (element.private === true)
      fail("private class members are not lowered yet");
    const key = element.key;
    if (key.kind === "string") return key.value;
    if (key.kind === "number") return String(key.value);
    if (key.kind === "identifier") return key.name;
    return fail("unsupported class member key");
  }
  function holdsUndefined(storage: RecordFieldStorage | undefined): boolean {
    return (
      storage !== undefined &&
      [
        "optional-number",
        "optional-boolean",
        "optional-string",
        "optional-reference",
        "general",
        "primitive",
      ].includes(storage.type)
    );
  }
  for (const member of contract.members) {
    if (member === undefined) throw "class member invariant";
    const element = member.node;
    if (element.kind === "static-block")
      fail("class static blocks are not lowered yet");
    if (element.kind === "get" || element.kind === "set")
      fail("class accessors are not lowered yet");
    const name = nameOf(element);
    if (
      element.kind === "method" &&
      !element.static &&
      name === "constructor"
    ) {
      body = {
        element,
        environmentField: environmentFields++,
        constructionField: constructionFields++,
      };
      continue;
    }
    const names = element.static ? constructorNames : prototypeNames;
    if (element.kind === "method") {
      const field = names.indexOf(name);
      if (field < 0) fail("class method storage invariant");
      (element.static ? staticMethods : methods).push({
        element,
        field,
        environmentField: environmentFields++,
      });
      continue;
    }
    const initializer =
      element.kind === "field" ? element.initializer : undefined;
    if (element.static) {
      const field = constructorNames.indexOf(name);
      if (field < 0) fail("class static field storage invariant");
      const undefinedDefault = holdsUndefined(constructorFields[field]);
      if (initializer === undefined && !undefinedDefault)
        fail(
          "static fields without an initializer need a type admitting undefined",
        );
      let staticInitializer: ClassFieldStorage["initializer"];
      if (initializer !== undefined) {
        staticInitializer = {
          environmentField: staticsFields,
          constructionField: staticsFields,
        };
        staticsFields++;
      }
      staticFields.push({
        element,
        field,
        initializer: staticInitializer,
        undefinedDefault,
      });
      continue;
    }
    const field = instanceNames.indexOf(name);
    if (field < 0) fail("class field storage invariant");
    let fieldInitializer: ClassFieldStorage["initializer"];
    if (initializer !== undefined) {
      fieldInitializer = {
        environmentField: environmentFields++,
        constructionField: constructionFields++,
      };
    }
    fields.push({
      element,
      field,
      initializer: fieldInitializer,
      undefinedDefault: holdsUndefined(instanceFields[field]),
    });
  }
  function closureEnvironment(count: number): RecordLayout {
    const fields: RecordFieldStorage[] = [];
    for (let i = 0; i < count; i++)
      fields.push({ type: "reference", mutable: false, optional: false });
    return planRecordLayout(fields, planner, fail);
  }
  return {
    members: {
      methods,
      staticMethods,
      fields,
      staticFields,
      body,
      definitionEnvironment: closureEnvironment(environmentFields),
      constructionEnvironment: closureEnvironment(constructionFields),
      staticsEnvironment:
        staticFields.length === 0
          ? undefined
          : closureEnvironment(staticsFields),
    },
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
