import type { CheckedClosures, ClosureBody } from "@tint/typescript/checker";
import type { ClassElement, Span, Statement } from "@tint/typescript/syntax";
import type { FunctionIR, RecordLayout, ScalarType } from "@tint/ir/scalar";
import type {
  ConstructorContext,
  FunctionSignature,
  OwnedClassDefinition,
} from "../../scalar.ts";
import type {
  ClassFieldStorage,
  ClassMethodStorage,
  ClassRecordStorage,
} from "./class-records.ts";
import {
  buildClassCallTarget,
  buildClassDefinition,
  type ClassDefinitionEntry,
} from "./class-definition.ts";
import {
  buildClassConstruction,
  buildClassInit,
  buildClassOwnFields,
  buildClassStaticInitialization,
  type ClassFieldInitialization,
} from "./class-construction.ts";

type ClassStatement = Statement & { readonly kind: "class" };

/** A class statement evaluated by a lowered function, with the generated
 * entries that define, construct, initialize and statically initialize it
 * (docs/design-typed-classes.md, C1/C2). */
export interface ClassEntries {
  readonly storage: ClassRecordStorage;
  readonly base: ClassEntries | undefined;
  readonly statement: ClassStatement;
  /** Checked function evaluating the class statement. */
  readonly owner: number;
  readonly definition: number;
  readonly construction: number;
  readonly initialization: number;
  readonly ownFields: number | undefined;
  readonly callTarget: number;
  /** Source function ID of the constructor body (when declared), and its hidden context. */
  readonly bodySourceId: number | undefined;
  readonly constructorContext: ConstructorContext | undefined;
  /** Lowered member closure targets, by definition environment field. */
  readonly members: readonly number[];
  /** Static field initialization, when the class has static fields. */
  readonly statics:
    | {
        readonly target: number;
        readonly environment: number;
        /** Initializer closure targets, by statics environment field (from 1). */
        readonly members: readonly number[];
      }
    | undefined;
}

/** Reserve the generated entries of each class statement directly in a lowered
 * function body. Their signatures follow the source entries, so function IDs
 * stay signature indexes; the entries are built once all records are known. */
export function reserveClassEntries(
  checked: CheckedClosures,
  classes: readonly ClassRecordStorage[],
  entries: readonly number[],
  bodies: readonly (ClosureBody | undefined)[],
  targetIds: readonly (number | undefined)[],
  signatures: FunctionSignature[],
  fail: (message: string) => never,
): readonly ClassEntries[] {
  const reserved: ClassEntries[] = [];
  const byInstance = new Map<number, ClassEntries>();
  function memberFunctionId(element: ClassElement): number {
    const member = checked.bindings.functions.find(
      (fn) => fn !== undefined && fn.node === element,
    );
    if (member === undefined)
      fail("class members are lowered with the function evaluating the class");
    return member.id;
  }
  function memberTarget(element: ClassElement): number {
    const target = targetIds[memberFunctionId(element)];
    if (target === undefined)
      fail("class members are lowered with the function evaluating the class");
    return target;
  }
  for (const storage of classes) {
    if (storage === undefined) throw "class storage invariant";
    let found: ClassStatement | undefined;
    let foundOwner: number | undefined;
    for (const entry of entries) {
      if (entry === undefined) throw "class owner entry invariant";
      const body = bodies[entry]?.body;
      if (body?.kind !== "block") continue;
      for (const candidate of body.statements) {
        if (
          candidate !== undefined &&
          candidate.kind === "class" &&
          candidate.definition === storage.contract.definition
        ) {
          found = candidate;
          foundOwner = entry;
        }
      }
    }
    const statement = found,
      owner = foundOwner;
    if (statement === undefined || owner === undefined) continue;
    const baseInstance = storage.contract.base;
    const baseEntry =
      baseInstance === undefined ? undefined : byInstance.get(baseInstance);
    if (baseInstance !== undefined && baseEntry === undefined)
      fail("base class entry must be reserved before derived class");
    const members = storage.members;
    const targets: number[] = [];
    for (const method of members.methods) {
      if (method === undefined) throw "class method invariant";
      targets[method.environmentField] = memberTarget(method.element);
    }
    for (const method of members.staticMethods) {
      if (method === undefined) throw "class static method invariant";
      targets[method.environmentField] = memberTarget(method.element);
    }
    for (const field of members.fields) {
      if (field === undefined) throw "class field invariant";
      const initializer = field.initializer;
      if (initializer !== undefined)
        targets[initializer.environmentField] = memberTarget(field.element);
    }
    const body = members.body;
    let userParameters: readonly ScalarType[] = [];
    let bodySourceId: number | undefined;
    let bodyTarget: number | undefined;
    if (body !== undefined) {
      bodySourceId = memberFunctionId(body.element);
      bodyTarget = targetIds[bodySourceId];
      if (bodyTarget === undefined)
        fail("class constructor body must be lowered with class");
      targets[body.environmentField] = bodyTarget;
      const signature = signatures[bodyTarget];
      if (signature === undefined || signature.returnType !== "void")
        fail("constructor bodies return no value");
      userParameters = signature.parameters.slice();
    } else if (baseEntry !== undefined) {
      const baseConstruct = signatures[baseEntry.construction];
      if (baseConstruct === undefined)
        throw "base class construction signature invariant";
      userParameters = baseConstruct.parameters.slice();
    }
    if (targets.length !== members.definitionEnvironment.fields.length)
      throw "class member closure invariant";
    // A derived definition receives (basePrototype, baseInit).
    const definition = signatures.length;
    signatures.push({
      parameters:
        storage.prototypeLink === undefined ? [] : ["reference", "reference"],
      returnType: "reference",
    });
    const construction = signatures.length;
    signatures.push({ parameters: userParameters, returnType: "reference" });
    const initialization = signatures.length;
    const initParameters: ScalarType[] = ["reference", "reference"];
    for (const param of userParameters) {
      if (param === undefined) throw "class init parameter invariant";
      initParameters.push(param);
    }
    signatures.push({
      parameters: initParameters,
      returnType: "void",
    });
    const hasOwnFields = members.fields.some(
      (field) =>
        field !== undefined &&
        (field.initializer !== undefined || field.undefinedDefault),
    );
    let ownFields: number | undefined;
    if (baseEntry !== undefined && body !== undefined && hasOwnFields) {
      ownFields = signatures.length;
      signatures.push({ parameters: ["reference"], returnType: "void" });
    }
    let constructorContext: ConstructorContext | undefined;
    if (bodyTarget !== undefined) {
      const hidden: ScalarType[] = ["reference"]; // newTarget
      const newTargetParam = userParameters.length;
      let baseInitInfo:
        { readonly parameter: number; readonly target: number } | undefined;
      let ownFieldsInfo:
        { readonly parameter: number; readonly target: number } | undefined;
      if (baseEntry !== undefined) {
        baseInitInfo = {
          parameter: userParameters.length + hidden.length,
          target: baseEntry.initialization,
        };
        hidden.push("reference");
        if (ownFields !== undefined) {
          ownFieldsInfo = {
            parameter: userParameters.length + hidden.length,
            target: ownFields,
          };
          hidden.push("reference");
        }
      }
      const bodyParameters: ScalarType[] = [];
      for (const param of userParameters) {
        if (param === undefined) throw "class body parameter invariant";
        bodyParameters.push(param);
      }
      for (const param of hidden) {
        if (param === undefined) throw "class hidden parameter invariant";
        bodyParameters.push(param);
      }
      signatures[bodyTarget] = {
        parameters: bodyParameters,
        returnType: "void",
      };
      constructorContext = {
        newTarget: newTargetParam,
        ...(baseInitInfo === undefined ? {} : { baseInit: baseInitInfo }),
        ...(ownFieldsInfo === undefined ? {} : { ownFields: ownFieldsInfo }),
      };
    }
    const callTarget = signatures.length;
    signatures.push({ parameters: [], returnType: "void" });
    let staticsEntry: ClassEntries["statics"];
    const staticsEnvironment = storage.staticsEnvironment;
    if (staticsEnvironment !== undefined) {
      const initializers: number[] = [];
      for (const field of members.staticFields) {
        if (field === undefined) throw "class static field invariant";
        const initializer = field.initializer;
        if (initializer !== undefined)
          initializers[initializer.environmentField - 1] = memberTarget(
            field.element,
          );
      }
      const target = signatures.length;
      signatures.push({ parameters: [], returnType: "void" });
      staticsEntry = {
        target,
        environment: staticsEnvironment,
        members: initializers,
      };
    }
    const statics = staticsEntry;
    const entryItem: ClassEntries = {
      storage,
      base: baseEntry,
      statement,
      owner,
      definition,
      construction,
      initialization,
      ownFields,
      callTarget,
      bodySourceId,
      constructorContext,
      members: targets,
      statics,
    };
    reserved.push(entryItem);
    byInstance.set(storage.contract.instance, entryItem);
  }
  return reserved;
}

/** The hidden constructor context for a checked constructor body function. */
export function classConstructorContext(
  classes: readonly ClassEntries[],
  sourceId: number,
): ConstructorContext | undefined {
  for (const item of classes) {
    if (item === undefined) throw "class entry invariant";
    if (item.bodySourceId === sourceId) return item.constructorContext;
  }
  return undefined;
}

/** The construction entry `new C(...)` calls for a constructor type. */
export function classConstructionTarget(
  classes: readonly ClassEntries[],
  constructor: number,
): number | undefined {
  let target: number | undefined;
  for (const item of classes) {
    if (item === undefined) throw "class entry invariant";
    if (item.storage.contract.constructor !== constructor) continue;
    if (target !== undefined) throw "class constructor type invariant";
    target = item.construction;
  }
  return target;
}

/** The storage of the class whose constructor type is `constructor`. */
export function classStorage(
  classes: readonly ClassEntries[],
  constructor: number,
): ClassRecordStorage | undefined {
  for (const item of classes) {
    if (item === undefined) throw "class entry invariant";
    if (item.storage.contract.constructor === constructor) return item.storage;
  }
  return undefined;
}

/** Owned plans of the class statements one function evaluates. */
export function ownedClassDefinitions(
  classes: readonly ClassEntries[],
  owner: number,
  local: (node: Span) => number | undefined,
  fail: (message: string) => never,
): readonly OwnedClassDefinition[] {
  const owned: OwnedClassDefinition[] = [];
  for (const item of classes) {
    if (item === undefined) throw "class entry invariant";
    if (item.owner !== owner) continue;
    const outer = local(item.statement);
    if (outer === undefined) fail("class statements require a binding local");
    const base = item.base;
    const heritageExpression = item.statement.definition.heritage;
    const heritage: OwnedClassDefinition["heritage"] =
      base === undefined || heritageExpression === undefined
        ? undefined
        : {
            expression: heritageExpression,
            prototype: {
              type: "reference",
              functionEnvironment: true,
              choices: [
                {
                  record: base.storage.constructorState,
                  field: base.storage.statePrototypeField,
                  type: "reference",
                },
              ],
            },
            init: {
              type: "reference",
              functionEnvironment: true,
              choices: [
                {
                  record: base.storage.constructorState,
                  field: base.storage.initializationField,
                  type: "reference",
                  initialized: true,
                },
              ],
            },
          };
    owned.push({
      declaration: item.statement,
      local: outer,
      innerLocal: local(item.statement.definition),
      definition: item.definition,
      environment: item.storage.definitionEnvironment,
      members: item.members,
      ...(heritage === undefined ? {} : { heritage }),
      statics: item.statics,
    });
  }
  return owned;
}

/** Field initializations in source order: initializer calls, undefined
 * defaults, and fields left for the constructor body. */
function fieldInitializations(
  fields: readonly ClassFieldStorage[],
  target: (initializer: number) => number,
): ClassFieldInitialization[] {
  const initializations: ClassFieldInitialization[] = [];
  for (const field of fields) {
    if (field === undefined) throw "class field invariant";
    const span = { start: field.element.start, end: field.element.end };
    const initializer = field.initializer;
    if (initializer !== undefined)
      initializations.push({
        kind: "call",
        field: field.field,
        entry: {
          field: initializer.constructionField,
          target: target(initializer.environmentField),
        },
        ...span,
      });
    else if (field.undefinedDefault)
      initializations.push({ kind: "undefined", field: field.field, ...span });
  }
  return initializations;
}

/** All concrete instance records of `item` and its subclasses. */
function classFamilyRecords(
  item: ClassEntries,
  all: readonly ClassEntries[],
): readonly number[] {
  const records: number[] = [item.storage.instance];
  for (const candidate of all) {
    if (candidate === undefined || candidate === item) continue;
    let cursor = candidate.base;
    while (cursor !== undefined) {
      if (cursor === item) {
        records.push(candidate.storage.instance);
        break;
      }
      cursor = cursor.base;
    }
  }
  return records;
}

/** Build the reserved definition, construction, initialization, own-fields,
 * [[Call]] and static initialization entries. */
export function buildClassEntries(
  item: ClassEntries,
  all: readonly ClassEntries[],
  records: readonly RecordLayout[],
  signatures: readonly FunctionSignature[],
  typeError: number | undefined,
): readonly FunctionIR[] {
  const storage = item.storage,
    members = storage.members,
    statement = item.statement,
    span = { start: statement.start, end: statement.end };
  const name = statement.name;
  function copies(
    methods: readonly ClassMethodStorage[],
  ): ClassDefinitionEntry[] {
    const entries: ClassDefinitionEntry[] = [];
    for (const method of methods) {
      if (method === undefined) throw "class method invariant";
      entries.push({ field: method.field, source: method.environmentField });
    }
    return entries;
  }
  const constructionEntries: ClassDefinitionEntry[] = [];
  for (const field of members.fields) {
    if (field === undefined) throw "class field invariant";
    const initializer = field.initializer;
    if (initializer !== undefined)
      constructionEntries.push({
        field: initializer.constructionField,
        source: initializer.environmentField,
      });
  }
  const body = members.body;
  let bodyEntry: { field: number; target: number } | undefined;
  if (body !== undefined) {
    constructionEntries.push({
      field: body.constructionField,
      source: body.environmentField,
    });
    const target = item.members[body.environmentField];
    if (target === undefined) throw "class constructor body invariant";
    bodyEntry = { field: body.constructionField, target };
  }
  const construction = signatures[item.construction];
  if (construction === undefined)
    throw "class construction signature invariant";
  const fields = fieldInitializations(members.fields, (field) => {
    const target = item.members[field];
    if (target === undefined) throw "class field initializer invariant";
    return target;
  });
  const familyRecords = classFamilyRecords(item, all);
  const base = item.base;
  const baseInitField = members.baseInitField;
  const generated: FunctionIR[] = [
    buildClassDefinition(
      {
        id: item.definition,
        name: name + "$define",
        environment: storage.definitionEnvironment,
        prototype: {
          record: storage.prototype,
          constructorField: storage.prototypeConstructorField,
          methods: copies(members.methods),
          link: storage.prototypeLink,
        },
        state: {
          record: storage.constructorState,
          prototypeField: storage.statePrototypeField,
          constructionField: storage.constructionField,
          initializationField: storage.initializationField,
          methods: copies(members.staticMethods),
        },
        callTarget: item.callTarget,
        construction: {
          target: item.construction,
          record: storage.constructionEnvironment,
          receiverField: 0,
          constructorField: members.constructorField,
          baseInitField: members.baseInitField,
          entries: constructionEntries,
        },
        initialization: { target: item.initialization },
        ...span,
      },
      records,
      signatures,
    ),
    buildClassConstruction(
      {
        id: item.construction,
        name: name + "$construct",
        parameters: construction.parameters,
        environment: storage.constructionEnvironment,
        prototypeField: 0,
        constructorField: members.constructorField,
        instance: storage.instance,
        instancePrototypeField: storage.prototypeField,
        init: { target: item.initialization },
        fields,
        body: bodyEntry,
        ...span,
      },
      records,
      signatures,
    ),
    buildClassInit(
      {
        id: item.initialization,
        name: name + "$init",
        parameters: construction.parameters,
        environment: storage.constructionEnvironment,
        instance: storage.instance,
        familyRecords,
        fields,
        body: bodyEntry,
        baseInit:
          base === undefined || baseInitField === undefined
            ? undefined
            : { field: baseInitField, target: base.initialization },
        ownFieldsTarget: item.ownFields,
        ...span,
      },
      records,
      signatures,
    ),
    buildClassCallTarget({
      id: item.callTarget,
      name: name + "$call",
      className: name,
      state: storage.constructorState,
      typeError,
      ...span,
    }),
  ];
  const ownFields = item.ownFields;
  if (ownFields !== undefined)
    generated.push(
      buildClassOwnFields(
        {
          id: ownFields,
          name: name + "$fields",
          environment: storage.constructionEnvironment,
          instance: storage.instance,
          familyRecords,
          fields,
          ...span,
        },
        records,
        signatures,
      ),
    );
  const statics = item.statics;
  if (statics !== undefined)
    generated.push(
      buildClassStaticInitialization(
        {
          id: statics.target,
          name: name + "$static",
          environment: statics.environment,
          constructorField: 0,
          state: storage.constructorState,
          fields: fieldInitializations(members.staticFields, (field) => {
            const target = statics.members[field - 1];
            if (target === undefined)
              throw "class static initializer invariant";
            return target;
          }),
          ...span,
        },
        records,
        signatures,
      ),
    );
  return generated;
}
