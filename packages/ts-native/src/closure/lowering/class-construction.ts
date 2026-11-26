import {
  createFunctionBuilder,
  type FunctionBuilder,
  type FunctionIR,
  type RecordLayout,
  type ScalarType,
  type Span,
} from "@tint/ir/scalar";
import type { FunctionSignature } from "../../scalar.ts";

export interface ClassConstructionEntry {
  readonly field: number;
  readonly target: number;
}
export type ClassFieldInitialization = Span &
  (
    | {
        readonly kind: "call";
        readonly field: number;
        readonly entry: ClassConstructionEntry;
      }
    | { readonly kind: "undefined"; readonly field: number }
    | { readonly kind: "brand"; readonly field: number }
    | { readonly kind: "static-block"; readonly entry: ClassConstructionEntry }
  );
export interface ClassConstructionPlan extends Span {
  readonly id: number;
  readonly name: string;
  readonly parameters: readonly ScalarType[];
  readonly environment: number;
  readonly prototypeField: number;
  /** Optional construction environment field holding the class constructor (new.target). */
  readonly constructorField?: number | undefined;
  readonly instance: number;
  readonly instancePrototypeField: number;
  /** When set, delegates initialization to this $init entry closing over the same environment. */
  readonly init?: { readonly target: number } | undefined;
  /** Source order; required fields assigned by the body may remain uninitialized. */
  readonly fields: readonly ClassFieldInitialization[];
  readonly body?: ClassConstructionEntry | undefined;
}

export interface ClassInitPlan extends Span {
  readonly id: number;
  readonly name: string;
  readonly parameters: readonly ScalarType[];
  readonly environment: number;
  readonly instance: number;
  /** Concrete instance record IDs in this class's family (starting with `instance`). */
  readonly familyRecords: readonly number[];
  readonly fields: readonly ClassFieldInitialization[];
  readonly body?: ClassConstructionEntry | undefined;
  /** Derived classes: base $init entry in `environment`. */
  readonly baseInit?: ClassConstructionEntry | undefined;
  /** Derived classes with an explicit constructor and own fields: $fields entry target. */
  readonly ownFieldsTarget?: number | undefined;
}

export interface ClassOwnFieldsPlan extends Span {
  readonly id: number;
  readonly name: string;
  readonly environment: number;
  readonly instance: number;
  readonly familyRecords: readonly number[];
  readonly fields: readonly ClassFieldInitialization[];
}

export interface ClassStaticInitializationPlan extends Span {
  readonly id: number;
  readonly name: string;
  readonly environment: number;
  readonly constructorField: number;
  readonly state: number;
  /** Static fields in source order; methods and prototype are already installed. */
  readonly fields: readonly ClassFieldInitialization[];
}

/** Generate base or derived construction with managed closures. When `plan.init`
 * is provided, allocates the instance with its prototype and delegates to the
 * class's $init entry with `new.target` set to the class constructor. */
export function buildClassConstruction(
  plan: ClassConstructionPlan,
  records: readonly RecordLayout[],
  signatures: readonly FunctionSignature[],
): FunctionIR {
  if (plan.init !== undefined && plan.constructorField !== undefined)
    return buildDelegatingConstruction(
      plan,
      plan.init.target,
      plan.constructorField,
      records,
      signatures,
    );
  return buildInitialization(
    plan,
    records,
    signatures,
    plan.instance,
    plan,
    undefined,
  );
}

function buildDelegatingConstruction(
  plan: ClassConstructionPlan,
  initTarget: number,
  constructorField: number,
  records: readonly RecordLayout[],
  signatures: readonly FunctionSignature[],
): FunctionIR {
  const instance = records[plan.instance],
    environment = records[plan.environment],
    initSig = signatures[initTarget];
  if (instance === undefined || environment === undefined)
    throw "class construction layout invariant";
  if (
    initSig === undefined ||
    initSig.returnType !== "void" ||
    initSig.parameters.length !== plan.parameters.length + 2
  )
    throw "class init signature invariant";
  const prototype = instance.fields[plan.instancePrototypeField];
  if (
    prototype?.type !== "reference" ||
    prototype.mutable ||
    prototype.stateOffset !== undefined ||
    prototype.presenceOffset !== undefined
  )
    throw "class prototype layout invariant";
  const span = { start: plan.start, end: plan.end };
  const b = createFunctionBuilder(
    plan.id,
    plan.name,
    plan.parameters,
    "reference",
    span,
  );
  const trap = b.block(),
    env = b.slot("reference"),
    proto = b.slot("reference"),
    newTarget = b.slot("reference"),
    object = b.slot("reference");
  const envValue = b.next();
  b.emit({
    kind: "closure-environment",
    id: envValue,
    start: span.start,
    end: span.end,
  });
  b.save(env, envValue);
  function readEnv(field: number, slot: number): void {
    readEnvironmentField(
      b,
      environment,
      plan.environment,
      env,
      field,
      slot,
      trap,
      span,
    );
  }
  readEnv(plan.prototypeField, proto);
  readEnv(constructorField, newTarget);
  const allocated = b.next();
  b.emit({
    kind: "record-new",
    id: allocated,
    record: plan.instance,
    arguments: instance.fields.map((field, index) => {
      if (field === undefined) throw "class instance field invariant";
      if (index === plan.instancePrototypeField) return b.load(proto);
      if (
        field.stateOffset === undefined &&
        field.presenceOffset === undefined &&
        field.deferred !== true
      )
        throw "class field requires initialization state";
      return undefined;
    }),
    start: span.start,
    end: span.end,
  });
  b.save(object, allocated);
  const initClosure = b.next();
  b.emit({
    kind: "function-new",
    id: initClosure,
    target: initTarget,
    environment: b.load(env),
    start: span.start,
    end: span.end,
  });
  const initArgs: number[] = [b.load(object), b.load(newTarget)];
  for (let i = 0; i < plan.parameters.length; i++) initArgs.push(b.load(i));
  b.emit({
    kind: "call-indirect",
    id: undefined,
    target: initTarget,
    callee: initClosure,
    arguments: initArgs,
    start: span.start,
    end: span.end,
  });
  b.end({
    kind: "return",
    value: b.load(object),
    start: span.start,
    end: span.end,
  });
  b.at(trap);
  b.end({ kind: "trap", start: span.start, end: span.end });
  return { ...b.finish(), closureEnvironment: plan.environment };
}

/** Generate a class's $init(instance, newTarget, ...params) => void entry
 * operating on an already-allocated instance of any class in `familyRecords`. */
export function buildClassInit(
  plan: ClassInitPlan,
  records: readonly RecordLayout[],
  signatures: readonly FunctionSignature[],
): FunctionIR {
  const instance = records[plan.instance],
    environment = records[plan.environment];
  if (instance === undefined || environment === undefined)
    throw "class init layout invariant";
  const span = { start: plan.start, end: plan.end };
  const params: ScalarType[] = ["reference", "reference"];
  for (const param of plan.parameters) {
    if (param === undefined) throw "class init parameter invariant";
    params.push(param);
  }
  const b = createFunctionBuilder(plan.id, plan.name, params, "void", span);
  const needsTrap =
    plan.baseInit !== undefined ||
    plan.body !== undefined ||
    plan.fields.length > 0;
  if (!needsTrap) {
    b.end({
      kind: "return",
      value: undefined,
      start: span.start,
      end: span.end,
    });
    return { ...b.finish(), closureEnvironment: plan.environment };
  }
  const trap = b.block(),
    env = b.slot("reference");
  const envValue = b.next();
  b.emit({
    kind: "closure-environment",
    id: envValue,
    start: span.start,
    end: span.end,
  });
  b.save(env, envValue);
  const instanceSlot = 0,
    newTargetSlot = 1;
  function readEnv(field: number, slot: number, source: Span): void {
    readEnvironmentField(
      b,
      environment,
      plan.environment,
      env,
      field,
      slot,
      trap,
      source,
    );
  }
  function invokeReceiver(
    entry: ClassConstructionEntry,
    argSlots: readonly number[],
    result: ScalarType | undefined,
    source: Span,
  ): number | undefined {
    const signature = signatures[entry.target];
    if (
      signature === undefined ||
      signature.returnType !== (result ?? "void") ||
      signature.parameters.length !== argSlots.length
    )
      throw "class init entry signature invariant";
    const callee = b.slot("reference");
    readEnv(entry.field, callee, source);
    const receiver = b.next();
    b.emit({
      kind: "general-wrap",
      id: receiver,
      value: b.load(instanceSlot),
      start: source.start,
      end: source.end,
    });
    const id = result === undefined ? undefined : b.next();
    b.emit({
      kind: "call-indirect",
      id,
      target: entry.target,
      callee: b.load(callee),
      receiver,
      arguments: argSlots.map((s) => b.load(s)),
      start: source.start,
      end: source.end,
    });
    if (result === undefined || id === undefined) return undefined;
    const slot = b.slot(result);
    b.save(slot, id);
    return slot;
  }
  function emitFields(): void {
    if (instance === undefined) throw "class init instance layout invariant";
    emitFamilyFieldInitializations(
      b,
      trap,
      instanceSlot,
      instance,
      plan.familyRecords,
      plan.fields,
      (entry, result, source) => invokeReceiver(entry, [], result, source),
    );
  }
  const baseInit = plan.baseInit,
    body = plan.body;
  if (baseInit === undefined) {
    // Base class: own field initializers in source order, then constructor body.
    emitFields();
    if (body !== undefined) {
      const argSlots: number[] = [];
      for (let i = 0; i < plan.parameters.length; i++) argSlots.push(i + 2);
      argSlots.push(newTargetSlot);
      invokeReceiver(body, argSlots, undefined, span);
    }
  } else if (body === undefined) {
    // Derived class without explicit constructor: forward to baseInit, then own fields.
    const baseCallee = b.slot("reference");
    readEnv(baseInit.field, baseCallee, span);
    const baseArgs: number[] = [b.load(instanceSlot), b.load(newTargetSlot)];
    for (let i = 0; i < plan.parameters.length; i++)
      baseArgs.push(b.load(i + 2));
    b.emit({
      kind: "call-indirect",
      id: undefined,
      target: baseInit.target,
      callee: b.load(baseCallee),
      arguments: baseArgs,
      start: span.start,
      end: span.end,
    });
    emitFields();
  } else {
    // Derived class with explicit constructor: pass newTarget, baseInit (and
    // ownFields if present) as trailing hidden parameters.
    const baseCallee = b.slot("reference");
    readEnv(baseInit.field, baseCallee, span);
    const argSlots: number[] = [];
    for (let i = 0; i < plan.parameters.length; i++) argSlots.push(i + 2);
    argSlots.push(newTargetSlot, baseCallee);
    const ownFieldsTarget = plan.ownFieldsTarget;
    if (ownFieldsTarget !== undefined) {
      const fieldsClosure = b.next(),
        fieldsSlot = b.slot("reference");
      b.emit({
        kind: "function-new",
        id: fieldsClosure,
        target: ownFieldsTarget,
        environment: b.load(env),
        start: span.start,
        end: span.end,
      });
      b.save(fieldsSlot, fieldsClosure);
      argSlots.push(fieldsSlot);
    }
    invokeReceiver(body, argSlots, undefined, span);
  }
  b.end({
    kind: "return",
    value: undefined,
    start: span.start,
    end: span.end,
  });
  b.at(trap);
  b.end({ kind: "trap", start: span.start, end: span.end });
  return { ...b.finish(), closureEnvironment: plan.environment };
}

/** Generate a derived class's $fields(instance) => void entry invoked right
 * after `super(...)` returns inside a derived constructor body. */
export function buildClassOwnFields(
  plan: ClassOwnFieldsPlan,
  records: readonly RecordLayout[],
  signatures: readonly FunctionSignature[],
): FunctionIR {
  const instance = records[plan.instance],
    environment = records[plan.environment];
  if (instance === undefined || environment === undefined)
    throw "class own fields layout invariant";
  const span = { start: plan.start, end: plan.end };
  const b = createFunctionBuilder(
    plan.id,
    plan.name,
    ["reference"],
    "void",
    span,
  );
  const trap = b.block(),
    env = b.slot("reference");
  const envValue = b.next();
  b.emit({
    kind: "closure-environment",
    id: envValue,
    start: span.start,
    end: span.end,
  });
  b.save(env, envValue);
  const instanceSlot = 0;
  function readEnv(field: number, slot: number, source: Span): void {
    readEnvironmentField(
      b,
      environment,
      plan.environment,
      env,
      field,
      slot,
      trap,
      source,
    );
  }
  emitFamilyFieldInitializations(
    b,
    trap,
    instanceSlot,
    instance,
    plan.familyRecords,
    plan.fields,
    (entry, result, source) => {
      const signature = signatures[entry.target];
      if (
        signature === undefined ||
        signature.returnType !== result ||
        signature.parameters.length !== 0
      )
        throw "class field initializer signature invariant";
      const callee = b.slot("reference");
      readEnv(entry.field, callee, source);
      const receiver = b.next();
      b.emit({
        kind: "general-wrap",
        id: receiver,
        value: b.load(instanceSlot),
        start: source.start,
        end: source.end,
      });
      const id = b.next();
      b.emit({
        kind: "call-indirect",
        id,
        target: entry.target,
        callee: b.load(callee),
        receiver,
        arguments: [],
        start: source.start,
        end: source.end,
      });
      const slot = b.slot(result);
      b.save(slot, id);
      return slot;
    },
  );
  b.end({
    kind: "return",
    value: undefined,
    start: span.start,
    end: span.end,
  });
  b.at(trap);
  b.end({ kind: "trap", start: span.start, end: span.end });
  return { ...b.finish(), closureEnvironment: plan.environment };
}

function readEnvironmentField(
  b: FunctionBuilder,
  environment: RecordLayout | undefined,
  record: number,
  envSlot: number,
  field: number,
  slot: number,
  trap: number,
  source: Span,
): void {
  const info = environment?.fields[field];
  if (info?.type !== "reference" || info.presenceOffset !== undefined)
    throw "class environment field invariant";
  const next = b.block();
  if (info.stateOffset === undefined)
    b.end({
      kind: "record",
      object: b.load(envSlot),
      record,
      field,
      operation: "read",
      slot,
      consequent: next,
      alternate: trap,
      start: source.start,
      end: source.end,
    });
  else
    b.end({
      kind: "record-cell",
      object: b.load(envSlot),
      record,
      field,
      operation: "read",
      slot,
      consequent: next,
      alternate: trap,
      start: source.start,
      end: source.end,
    });
  b.at(next);
}

function emitFamilyFieldInitializations(
  b: FunctionBuilder,
  trap: number,
  instanceSlot: number,
  instance: RecordLayout,
  familyRecords: readonly number[],
  fields: readonly ClassFieldInitialization[],
  callInitializer: (
    entry: ClassConstructionEntry,
    result: ScalarType,
    source: Span,
  ) => number | undefined,
): void {
  const initialized = new Uint8Array(instance.fields.length);
  for (const field of fields) {
    if (field === undefined) throw "class field initializer invariant";
    if (field.kind === "static-block")
      throw "instance static-block initialization invariant";
    const storage = instance.fields[field.field];
    if (
      storage === undefined ||
      (storage.stateOffset === undefined &&
        storage.presenceOffset === undefined &&
        storage.deferred !== true) ||
      initialized[field.field] === 1
    )
      throw "class field initialization invariant";
    initialized[field.field] = 1;
    let value: number | undefined;
    if (field.kind === "call")
      value = callInitializer(field.entry, storage.type, field);
    else if (field.kind === "brand") {
      const id = b.next();
      b.emit({
        kind: "constant",
        id,
        value: true,
        start: field.start,
        end: field.end,
      });
      value = b.slot("boolean");
      b.save(value, id);
    } else {
      const id = b.next(),
        source = { start: field.start, end: field.end };
      switch (storage.type) {
        case "optional-number":
          b.emit({
            kind: "undefined",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        case "optional-boolean":
          b.emit({
            kind: "boolean-none",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        case "optional-string":
          b.emit({
            kind: "string-none",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        case "optional-reference":
          b.emit({
            kind: "reference-none",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        case "general":
          b.emit({
            kind: "general-none",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        default:
          throw "class field undefined representation invariant";
      }
      value = b.slot(storage.type);
      b.save(value, id);
    }
    if (value === undefined) throw "class field initializer result invariant";
    const done = b.block();
    for (let i = 0; i < familyRecords.length; i++) {
      const record = familyRecords[i];
      if (record === undefined) throw "class family record invariant";
      const alternate = i + 1 < familyRecords.length ? b.block() : trap;
      if (storage.stateOffset === undefined)
        b.end({
          kind: "record",
          object: b.load(instanceSlot),
          record,
          field: field.field,
          operation: "write",
          slot: value,
          consequent: done,
          alternate,
          start: field.start,
          end: field.end,
        });
      else
        b.end({
          kind: "record-cell",
          object: b.load(instanceSlot),
          record,
          field: field.field,
          operation: "initialize",
          slot: value,
          consequent: done,
          alternate,
          start: field.start,
          end: field.end,
        });
      if (alternate !== trap) b.at(alternate);
    }
    b.at(done);
  }
}

/** Initialize existing constructor state, with the constructor itself as `this`.
 * The caller publishes the outer class binding only after this entry returns. */
export function buildClassStaticInitialization(
  plan: ClassStaticInitializationPlan,
  records: readonly RecordLayout[],
  signatures: readonly FunctionSignature[],
): FunctionIR {
  return buildInitialization(
    plan,
    records,
    signatures,
    plan.state,
    undefined,
    plan.constructorField,
  );
}

function buildInitialization(
  plan: {
    readonly id: number;
    readonly name: string;
    readonly environment: number;
    readonly fields: readonly ClassFieldInitialization[];
    readonly start: number;
    readonly end: number;
  },
  records: readonly RecordLayout[],
  signatures: readonly FunctionSignature[],
  record: number,
  construction: ClassConstructionPlan | undefined,
  constructorField: number | undefined,
): FunctionIR {
  const parameters = construction === undefined ? [] : construction.parameters,
    instance = records[record],
    environment = records[plan.environment];
  if (instance === undefined || environment === undefined)
    throw "class initialization layout invariant";
  if (construction !== undefined) {
    const prototype = instance.fields[construction.instancePrototypeField];
    if (
      prototype?.type !== "reference" ||
      prototype.mutable ||
      prototype.stateOffset !== undefined ||
      prototype.presenceOffset !== undefined
    )
      throw "class prototype layout invariant";
    if (construction.body === undefined && parameters.length !== 0)
      throw "default constructor signature invariant";
  }
  const span = { start: plan.start, end: plan.end };
  const b = createFunctionBuilder(
    plan.id,
    plan.name,
    parameters,
    construction !== undefined ? "reference" : "void",
    span,
  );
  const trap = b.block(),
    env = b.slot("reference"),
    object = b.slot("reference"),
    proto = b.slot("reference"),
    receiverObject = b.slot("reference");
  const envValue = b.next();
  b.emit({
    kind: "closure-environment",
    id: envValue,
    start: span.start,
    end: span.end,
  });
  b.save(env, envValue);
  function read(field: number, slot: number, source: Span): void {
    const info = environment?.fields[field];
    if (info?.type !== "reference" || info.presenceOffset !== undefined)
      throw "class construction environment field invariant";
    const next = b.block();
    const operation: "read" = "read";
    const object = b.load(env);
    if (info.stateOffset === undefined)
      b.end({
        kind: "record",
        object,
        record: plan.environment,
        field,
        operation,
        slot,
        consequent: next,
        alternate: trap,
        start: source.start,
        end: source.end,
      });
    else
      b.end({
        kind: "record-cell",
        object,
        record: plan.environment,
        field,
        operation,
        slot,
        consequent: next,
        alternate: trap,
        start: source.start,
        end: source.end,
      });
    b.at(next);
  }
  function invoke(
    entry: ClassConstructionEntry,
    arguments_: readonly number[],
    result: ScalarType | undefined,
    source: Span,
  ): number | undefined {
    const signature = signatures[entry.target];
    if (
      signature === undefined ||
      signature.returnType !== (result ?? "void") ||
      signature.parameters.length !== arguments_.length
    )
      throw "class construction entry signature invariant";
    const callee = b.slot("reference");
    read(entry.field, callee, source);
    // The receiver is wrapped at each call rather than held in a general
    // slot, which would keep this entry from being inlined.
    const receiver = b.next();
    b.emit({
      kind: "general-wrap",
      id: receiver,
      value: b.load(receiverObject),
      start: source.start,
      end: source.end,
    });
    const id = result === undefined ? undefined : b.next();
    b.emit({
      kind: "call-indirect",
      id,
      target: entry.target,
      callee: b.load(callee),
      receiver,
      arguments: arguments_.map(b.load),
      start: source.start,
      end: source.end,
    });
    if (result === undefined || id === undefined) return undefined;
    const slot = b.slot(result);
    b.save(slot, id);
    return slot;
  }
  if (construction !== undefined) {
    const prototypeField = construction.instancePrototypeField;
    read(construction.prototypeField, proto, span);
    const allocated = b.next();
    b.emit({
      kind: "record-new",
      id: allocated,
      record,
      arguments: instance.fields.map((field, index) => {
        if (field === undefined) throw "class instance field invariant";
        if (index === prototypeField) return b.load(proto);
        if (
          field.stateOffset === undefined &&
          field.presenceOffset === undefined &&
          field.deferred !== true
        )
          throw "class field requires initialization state";
        return undefined;
      }),
      start: span.start,
      end: span.end,
    });
    b.save(object, allocated);
    b.save(receiverObject, b.load(object));
  } else {
    if (constructorField === undefined)
      throw "static constructor field invariant";
    read(constructorField, receiverObject, span);
    const state = b.next(),
      present = b.next(),
      ready = b.block();
    b.emit({
      kind: "function-environment",
      id: state,
      callee: b.load(receiverObject),
      start: span.start,
      end: span.end,
    });
    b.emit({
      kind: "unary",
      id: present,
      operator: "truthy",
      operand: state,
      start: span.start,
      end: span.end,
    });
    const optionalState = b.slot("optional-reference");
    b.save(optionalState, state);
    b.end({
      kind: "branch",
      condition: present,
      consequent: ready,
      alternate: trap,
      start: span.start,
      end: span.end,
    });
    b.at(ready);
    const unwrapped = b.next();
    b.emit({
      kind: "reference-value",
      id: unwrapped,
      value: b.load(optionalState),
      start: span.start,
      end: span.end,
    });
    b.save(object, unwrapped);
  }
  const initialized = new Uint8Array(instance.fields.length);
  for (const field of plan.fields) {
    if (field === undefined) throw "class field initializer invariant";
    if (field.kind === "static-block") {
      invoke(field.entry, [], undefined, field);
      continue;
    }
    const storage = instance.fields[field.field];
    if (
      storage === undefined ||
      (storage.stateOffset === undefined &&
        storage.presenceOffset === undefined &&
        storage.deferred !== true) ||
      initialized[field.field] === 1
    )
      throw "class field initialization invariant";
    initialized[field.field] = 1;
    let value: number | undefined;
    if (field.kind === "call")
      value = invoke(field.entry, [], storage.type, field);
    else if (field.kind === "brand") {
      const id = b.next();
      b.emit({
        kind: "constant",
        id,
        value: true,
        start: field.start,
        end: field.end,
      });
      value = b.slot("boolean");
      b.save(value, id);
    } else {
      const id = b.next(),
        source = { start: field.start, end: field.end };
      switch (storage.type) {
        case "optional-number":
          b.emit({
            kind: "undefined",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        case "optional-boolean":
          b.emit({
            kind: "boolean-none",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        case "optional-string":
          b.emit({
            kind: "string-none",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        case "optional-reference":
          b.emit({
            kind: "reference-none",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        case "general":
          b.emit({
            kind: "general-none",
            id,
            start: source.start,
            end: source.end,
          });
          break;
        default:
          throw "class field undefined representation invariant";
      }
      value = b.slot(storage.type);
      b.save(value, id);
    }
    if (value === undefined) throw "class field initializer result invariant";
    const next = b.block();
    // A deferred or deletable instance field is written (the write also
    // marks a deletable field present); a static field's state is
    // initialized.
    if (storage.stateOffset === undefined)
      b.end({
        kind: "record",
        object: b.load(object),
        record,
        field: field.field,
        operation: "write",
        slot: value,
        consequent: next,
        alternate: trap,
        start: field.start,
        end: field.end,
      });
    else
      b.end({
        kind: "record-cell",
        object: b.load(object),
        record,
        field: field.field,
        operation: "initialize",
        slot: value,
        consequent: next,
        alternate: trap,
        start: field.start,
        end: field.end,
      });
    b.at(next);
  }
  const body = construction === undefined ? undefined : construction.body;
  if (body !== undefined) {
    const signature = signatures[body.target];
    if (
      signature === undefined ||
      signature.parameters.some((type, index) => type !== parameters[index])
    )
      throw "constructor body signature invariant";
    invoke(
      body,
      parameters.map((_, index) => index),
      undefined,
      span,
    );
  }
  b.end({
    kind: "return",
    value: construction !== undefined ? b.load(object) : undefined,
    start: span.start,
    end: span.end,
  });
  b.at(trap);
  b.end({ kind: "trap", start: span.start, end: span.end });
  return { ...b.finish(), closureEnvironment: plan.environment };
}
