import {
  classAccessorSlot,
  type ClassContract,
} from "@tint/typescript/checker";
import type { ClassElement } from "@tint/typescript/syntax";
import type { Type } from "@tint/typescript/types";
import type { RecordLayout, ScalarType } from "@tint/ir/scalar";
import type { LayoutPlanner } from "@tint/foundation/layout";
import {
  planExtendedRecordLayout,
  planRecordLayout,
  type RecordFieldStorage,
} from "./record-layout.ts";

export interface ClassRecordStorage {
  readonly contract: ClassContract;
  readonly instance: number;
  readonly prototype: number;
  readonly prototypeField: number;
  /** A derived prototype's hidden link to the base prototype (C2). */
  readonly prototypeLink: number | undefined;
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
export interface ClassAccessorStorage {
  readonly name: string;
  readonly static: boolean;
  /** Prototype field, or constructor state field for static accessors. */
  readonly getter: number;
  readonly setter: number | undefined;
}
export interface PlannedClassRecords {
  readonly members: ClassMemberEnvironment;
  readonly instance: RecordLayout;
  readonly prototype: RecordLayout;
  readonly instanceNames: readonly string[];
  readonly prototypeNames: readonly string[];
  /** Instance field index to prototype field index; -1 means an own data field. */
  readonly inherited: readonly number[];
  /** Instance fields stored `undefined`-capable because code may read them
   * before their first assignment. */
  readonly unproven: readonly number[];
  /** Accessor properties: closures in hidden prototype (or constructor
   * state) fields, no instance (or constructor state) field. */
  readonly accessors: readonly ClassAccessorStorage[];
  readonly prototypeField: number;
  /** Derived classes: the prototype's hidden link to the base prototype,
   * and per prototype field the base prototype field it falls through to
   * (-1: none). */
  readonly prototypeLink: number | undefined;
  readonly prototypeInherited: readonly number[];
  /** The number of properties of the class's instance type. */
  readonly contractProperties: number;
  readonly constructorState: RecordLayout;
  readonly constructorNames: readonly string[];
  readonly constructionField: number;
}

/** The positional name of a root base's hidden prototype pointer in a
 * derived class's instance names; source names cannot spell it. */
const hiddenPrototypeName = "@@prototype";
export function planClassRecords(
  contract: ClassContract,
  types: readonly Type[],
  planner: LayoutPlanner,
  encoding: (type: number) => ScalarType | undefined,
  fail: (message: string) => never,
  /** Instance fields code may read before their first assignment. */
  uninitialized: (element: ClassElement) => boolean,
  /** The base class's planned records (C2), planned first. */
  baseRecords: PlannedClassRecords | undefined,
): PlannedClassRecords {
  const base = baseRecords;
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
  // Required fields code may read before their first assignment
  // (CheckedClosures.uninitializedFields) store `undefined` until then.
  // Accessor names have no own field.
  const unproven = new Set<string>(),
    instanceAccessors = new Set<string>(),
    staticAccessors = new Set<string>();
  for (const member of contract.members) {
    if (member === undefined) throw "class member invariant";
    const element = member.node;
    if (element.kind === "get" || element.kind === "set") {
      const key = element.key;
      if (!element.computed && key.kind === "string") {
        if (element.static) staticAccessors.add(key.value);
        else instanceAccessors.add(key.value);
      }
    }
    if (
      element.kind !== "field" ||
      element.static ||
      element.computed ||
      !uninitialized(element)
    )
      continue;
    const key = element.key;
    if (key.kind === "identifier") unproven.add(key.name);
    else if (key.kind === "string") unproven.add(key.value);
    else if (key.kind === "number") unproven.add(String(key.value));
    else fail("unproven class field key invariant");
  }
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
  // A derived prototype holds only its own methods. Inherited method names
  // get absent shadow slots (so the prototype contract can fall through to
  // the base prototype at the same names), then the hidden base link.
  const prototypeInherited: number[] = [];
  for (const name of prototypeNames) prototypeInherited.push(-1);
  let prototypeLink: number | undefined;
  if (base !== undefined) {
    for (const name of base.prototypeNames) {
      if (name === undefined) throw "base prototype name invariant";
      if (name === "constructor" || prototypeNames.includes(name)) continue;
      prototypeNames.push(name);
      prototypeInherited.push(base.prototypeNames.indexOf(name));
      prototypeFields.push({
        type: "optional-reference",
        mutable: true,
        optional: true,
      });
    }
    for (let field = 0; field < prototypeNames.length; field++) {
      const name = prototypeNames[field];
      if (name === undefined) throw "prototype name invariant";
      if (name !== "constructor" && prototypeInherited[field] === -1) {
        // An own override falls through to the base when deleted.
        prototypeInherited[field] = base.prototypeNames.indexOf(name);
      }
    }
    prototypeLink = prototypeFields.length;
    prototypeFields.push({
      type: "reference",
      mutable: false,
      optional: false,
    });
  }
  // A derived instance starts with its base's layout: the base's names,
  // storage and hidden prototype pointer (named so names stay positional).
  const baseCount = base === undefined ? 0 : base.instanceNames.length;
  if (base !== undefined) {
    for (let field = 0; field < base.instanceNames.length; field++) {
      const name = base.instanceNames[field],
        through = base.inherited[field];
      if (name === undefined || through === undefined)
        throw "base instance name invariant";
      instanceNames.push(name);
      inherited.push(through < 0 ? -1 : prototypeNames.indexOf(name));
    }
    // A root base's hidden prototype pointer follows its named fields.
    while (instanceNames.length < base.instance.fields.length) {
      instanceNames.push(hiddenPrototypeName);
      inherited.push(-1);
    }
  }
  // Own storage follows the base layout's fields.
  const baseFields = base === undefined ? 0 : base.instance.fields.length;
  for (let position = 0; position < instance.properties.length; position++) {
    const property = instance.properties[position];
    if (property === undefined) throw "instance property invariant";
    // The base's properties (overrides included) keep the base's storage.
    if (base !== undefined && position < base.contractProperties) continue;
    if (instanceAccessors.has(property.name)) continue;
    const inheritedField =
      property.name === "constructor"
        ? -1
        : prototypeNames.indexOf(property.name);
    let type: ScalarType | undefined =
      inheritedField >= 0 ? "optional-reference" : encoding(property.type);
    if (type === undefined) fail("unsupported class instance storage");
    if (inheritedField < 0 && unproven.has(property.name)) {
      if (type === "number") type = "optional-number";
      else if (type === "string") type = "optional-string";
      else if (type === "boolean") type = "optional-boolean";
      else fail("unproven class field requires a primitive representation");
    }
    instanceNames.push(property.name);
    inherited.push(inheritedField);
    // A field whose value may be undefined may also be deleted (TypeScript
    // allows `delete` of exactly those), so it carries a presence byte. So
    // does an unproven field: an earlier field initializer can observe that
    // it is not defined yet.
    const deletable =
      inheritedField < 0 &&
      [
        "optional-number",
        "optional-boolean",
        "optional-string",
        "optional-reference",
        "general",
        "primitive",
      ].includes(type);
    instanceFields.push({
      type,
      // `readonly` is checked by TypeScript only: the property is writable
      // (untyped code and the constructor body assign it).
      mutable: true,
      optional: inheritedField >= 0 || deletable,
      // Other own data fields are assigned during construction, and the
      // checker proves no read precedes the assignment
      // (class-initialization.ts), so they carry no state.
      deferred: inheritedField < 0 && !deletable,
    });
  }
  const constructorNames: string[] = [],
    constructorFields: RecordFieldStorage[] = [];
  for (const property of constructor.properties) {
    if (property === undefined) throw "constructor property invariant";
    if (staticAccessors.has(property.name)) continue;
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
  // Hidden pointer has no source property name and cannot collide with a
  // field; a derived class shares its base's.
  const prototypeField =
    base === undefined ? instanceFields.length : base.prototypeField;
  if (base === undefined)
    instanceFields.push({ type: "reference", mutable: false, optional: false });
  // Member closures (docs/design-typed-classes.md, C1): what this phase
  // does not lower fails explicitly.
  const accessors: ClassAccessorStorage[] = [];
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
  function holdsUndefined(
    storage: { readonly type: ScalarType } | undefined,
  ): boolean {
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
    const name = nameOf(element);
    if (element.kind === "get" || element.kind === "set") {
      const getter = element.kind === "get",
        isStatic = element.static;
      const names = isStatic ? constructorNames : prototypeNames;
      const field = names.indexOf(
        classAccessorSlot(getter ? "get" : "set", name),
      );
      if (field < 0) fail("class accessor storage invariant");
      (isStatic ? staticMethods : methods).push({
        element,
        field,
        environmentField: environmentFields++,
      });
      let known = -1;
      for (let index = 0; index < accessors.length; index++) {
        const accessor = accessors[index];
        if (
          accessor !== undefined &&
          accessor.name === name &&
          accessor.static === isStatic
        )
          known = index;
      }
      const previous = known < 0 ? undefined : accessors[known];
      const entry: ClassAccessorStorage = {
        name,
        static: isStatic,
        getter: getter ? field : (previous?.getter ?? -1),
        setter: getter ? previous?.setter : field,
      };
      if (known < 0) accessors.push(entry);
      else accessors[known] = entry;
      continue;
    }
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
      undefinedDefault: holdsUndefined(
        field < baseFields
          ? base?.instance.fields[field]
          : instanceFields[field - baseFields],
      ),
    });
  }
  const unprovenFields: number[] = [];
  if (base !== undefined)
    for (const field of base.unproven) unprovenFields.push(field);
  for (let field = baseCount; field < instanceNames.length; field++) {
    const name = instanceNames[field];
    if (name === undefined) throw "instance name invariant";
    if (inherited[field] === -1 && unproven.has(name))
      unprovenFields.push(field);
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
    instance:
      base === undefined
        ? planRecordLayout(instanceFields, planner, fail)
        : planExtendedRecordLayout(
            base.instance,
            instanceFields,
            planner,
            fail,
          ),
    prototype: planRecordLayout(prototypeFields, planner, fail),
    prototypeLink,
    prototypeInherited,
    contractProperties: instance.properties.length,
    constructorState: planRecordLayout(constructorFields, planner, fail),
    constructorNames,
    constructionField,
    instanceNames,
    prototypeNames,
    inherited,
    unproven: unprovenFields,
    accessors,
    prototypeField,
  };
}
