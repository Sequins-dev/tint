import type { CheckedClosures, ClosureBody } from "@tint/typescript/checker";
import type {
  ClassDefinition,
  ClassElement,
  Expression,
  Span,
  Statement,
  VariableBinding,
} from "@tint/typescript/syntax";
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
  ClassStaticStepStorage,
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

export type ClassNode =
  | (Statement & { readonly kind: "class" })
  | (Expression & { readonly kind: "class-expression" });

/** A class statement or class expression evaluated by a lowered function, with
 * the generated entries that define, construct, initialize and statically
 * initialize it (docs/design-typed-classes.md, C1/C2/C3). */
export interface ClassEntries {
  readonly storage: ClassRecordStorage;
  readonly base: ClassEntries | undefined;
  readonly node: ClassNode;
  /** Checked function evaluating the class statement or expression. */
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
  const owners = new Map<ClassDefinition, { node: ClassNode; owner: number }>();
  function scanBinding(binding: VariableBinding, owner: number): void {
    if (binding.initializer !== undefined)
      scanExpression(binding.initializer, owner);
    if (binding.kind === "object-binding") {
      for (const prop of binding.properties) {
        if (prop === undefined) throw "binding property invariant";
        if (prop.keyExpression !== undefined)
          scanExpression(prop.keyExpression, owner);
        scanBinding(prop.binding, owner);
      }
      if (binding.rest !== undefined) scanBinding(binding.rest, owner);
    } else if (binding.kind === "array-binding") {
      for (const el of binding.elements)
        if (el !== undefined) scanBinding(el, owner);
      if (binding.rest !== undefined) scanBinding(binding.rest, owner);
    }
  }
  function scanExpression(node: Expression | undefined, owner: number): void {
    if (node === undefined) return;
    switch (node.kind) {
      case "class-expression":
        owners.set(node.definition, { node, owner });
        scanExpression(node.definition.heritage, owner);
        return;
      case "group":
      case "satisfies":
        scanExpression(node.expression, owner);
        return;
      case "unary":
        scanExpression(node.operand, owner);
        return;
      case "binary":
        scanExpression(node.left, owner);
        scanExpression(node.right, owner);
        return;
      case "conditional":
        scanExpression(node.test, owner);
        scanExpression(node.consequent, owner);
        scanExpression(node.alternate, owner);
        return;
      case "assignment":
      case "compound":
        scanExpression(node.target, owner);
        scanExpression(node.value, owner);
        return;
      case "update":
        scanExpression(node.target, owner);
        return;
      case "call":
      case "new":
        scanExpression(node.callee, owner);
        for (const arg of node.arguments) scanExpression(arg, owner);
        return;
      case "member":
        scanExpression(node.object, owner);
        return;
      case "index":
        scanExpression(node.object, owner);
        scanExpression(node.index, owner);
        return;
      case "private-in":
        scanExpression(node.object, owner);
        return;
      case "array":
        for (const el of node.elements) scanExpression(el, owner);
        return;
      case "object":
        for (const prop of node.properties) {
          if (prop === undefined) throw "object property invariant";
          if (prop.kind !== "spread") scanExpression(prop.keyExpression, owner);
          scanExpression(prop.value, owner);
        }
        return;
      case "spread":
        scanExpression(node.value, owner);
        return;
      case "template-expression":
        for (const sub of node.substitutions) scanExpression(sub, owner);
        return;
      case "tagged-template":
        scanExpression(node.tag, owner);
        scanExpression(node.template, owner);
        return;
      default:
        return;
    }
  }
  function scanStatement(node: Statement | undefined, owner: number): void {
    if (node === undefined) return;
    switch (node.kind) {
      case "class":
        owners.set(node.definition, { node, owner });
        scanExpression(node.definition.heritage, owner);
        return;
      case "block":
        for (const child of node.statements) scanStatement(child, owner);
        return;
      case "expression":
        scanExpression(node.expression, owner);
        return;
      case "variable":
        for (const d of node.declarations)
          if (d !== undefined) scanBinding(d, owner);
        return;
      case "return":
        scanExpression(node.expression, owner);
        return;
      case "throw":
        scanExpression(node.expression, owner);
        return;
      case "if":
        scanExpression(node.test, owner);
        scanStatement(node.consequent, owner);
        scanStatement(node.alternate, owner);
        return;
      case "while":
      case "do-while":
        scanExpression(node.test, owner);
        scanStatement(node.body, owner);
        return;
      case "for":
        scanStatement(node.initializer, owner);
        scanExpression(node.test, owner);
        scanExpression(node.update, owner);
        scanStatement(node.body, owner);
        return;
      case "for-of":
      case "for-in":
        scanBinding(node.binding, owner);
        scanExpression(node.iterable, owner);
        scanStatement(node.body, owner);
        return;
      case "for-of-assignment":
      case "for-in-assignment":
        scanExpression(node.target, owner);
        scanExpression(node.iterable, owner);
        scanStatement(node.body, owner);
        return;
      case "switch":
        scanExpression(node.expression, owner);
        for (const c of node.clauses) {
          if (c === undefined) throw "switch clause invariant";
          scanExpression(c.test, owner);
          for (const s of c.statements) scanStatement(s, owner);
        }
        return;
      case "try":
        scanStatement(node.body, owner);
        if (node.handler !== undefined) scanStatement(node.handler.body, owner);
        scanStatement(node.finalizer, owner);
        return;
      case "label":
        scanStatement(node.body, owner);
        return;
      default:
        return;
    }
  }
  for (const entry of entries) {
    if (entry === undefined) throw "class owner entry invariant";
    const closureBody = bodies[entry];
    if (closureBody === undefined) continue;
    for (const p of closureBody.parameters)
      if (p !== undefined && p.initializer !== undefined)
        scanExpression(p.initializer, entry);
    const entryBody = closureBody.body;
    if (entryBody.kind === "block") scanStatement(entryBody, entry);
    else scanExpression(entryBody, entry);
  }
  for (const storage of classes) {
    if (storage === undefined) throw "class storage invariant";
    const located = owners.get(storage.contract.definition);
    if (located === undefined) continue;
    const node = located.node,
      owner = located.owner;
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
    // A derived definition receives (basePrototype, baseInit, baseState).
    const definition = signatures.length;
    signatures.push({
      parameters:
        storage.prototypeLink === undefined
          ? []
          : ["reference", "reference", "reference"],
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
    const hasOwnFields =
      storage.privateBrandField !== undefined ||
      members.fields.some(
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
      for (const step of members.staticSteps) {
        if (step === undefined) throw "class static step invariant";
        if (step.kind === "static-block") {
          initializers[step.environmentField - 1] = memberTarget(step.element);
          continue;
        }
        const initializer = step.initializer;
        if (initializer !== undefined)
          initializers[initializer.environmentField - 1] = memberTarget(
            step.element,
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
      node,
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

/** Owned plans of the class statements and expressions one function evaluates. */
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
    const outer = item.node.kind === "class" ? local(item.node) : undefined;
    if (item.node.kind === "class" && outer === undefined)
      fail("class statements require a binding local");
    const base = item.base;
    const heritageExpression = item.node.definition.heritage;
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
      declaration: item.node,
      ...(outer === undefined ? {} : { local: outer }),
      innerLocal: local(item.node.definition),
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

function staticInitializations(
  steps: readonly ClassStaticStepStorage[],
  target: (initializer: number) => number,
): ClassFieldInitialization[] {
  const initializations: ClassFieldInitialization[] = [];
  for (const step of steps) {
    if (step === undefined) throw "class static step invariant";
    const span = { start: step.element.start, end: step.element.end };
    if (step.kind === "static-block") {
      initializations.push({
        kind: "static-block",
        entry: {
          field: step.constructionField,
          target: target(step.environmentField),
        },
        ...span,
      });
      continue;
    }
    const initializer = step.initializer;
    if (initializer !== undefined)
      initializations.push({
        kind: "call",
        field: step.field,
        entry: {
          field: initializer.constructionField,
          target: target(initializer.environmentField),
        },
        ...span,
      });
    else if (step.undefinedDefault)
      initializations.push({ kind: "undefined", field: step.field, ...span });
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
    classNode = item.node,
    span = { start: classNode.start, end: classNode.end };
  const name =
    classNode.kind === "class"
      ? classNode.name
      : (classNode.definition.name ?? "class_" + String(classNode.start));
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
  if (storage.privateBrandField !== undefined)
    fields.unshift({
      kind: "brand",
      field: storage.privateBrandField,
      ...span,
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
          link: storage.constructorLink,
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
          fields: staticInitializations(members.staticSteps, (field) => {
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
