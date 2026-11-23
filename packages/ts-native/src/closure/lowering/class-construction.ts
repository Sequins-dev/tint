import {
  createFunctionBuilder,
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
export type ClassFieldInitialization = Span & {
  readonly field: number;
} & (
    | { readonly kind: "call"; readonly entry: ClassConstructionEntry }
    | { readonly kind: "undefined" }
  );
export interface ClassConstructionPlan extends Span {
  readonly id: number;
  readonly name: string;
  readonly parameters: readonly ScalarType[];
  readonly environment: number;
  readonly prototypeField: number;
  readonly instance: number;
  readonly instancePrototypeField: number;
  /** Source order; required fields assigned by the body may remain uninitialized. */
  readonly fields: readonly ClassFieldInitialization[];
  readonly body?: ClassConstructionEntry | undefined;
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

/** Generate base construction with managed closures and ordinary receiver calls.
 * The source adapter must prove initialization safety and supply ABI-aligned entries. */
export function buildClassConstruction(
  plan: ClassConstructionPlan,
  records: readonly RecordLayout[],
  signatures: readonly FunctionSignature[],
): FunctionIR {
  return buildInitialization(
    plan,
    records,
    signatures,
    plan.instance,
    plan,
    undefined,
  );
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
    receiver = b.slot("general"),
    proto = b.slot("reference");
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
    const id = result === undefined ? undefined : b.next();
    b.emit({
      kind: "call-indirect",
      id,
      target: entry.target,
      callee: b.load(callee),
      receiver: b.load(receiver),
      arguments: arguments_.map(b.load),
      start: source.start,
      end: source.end,
    });
    if (result === undefined || id === undefined) return undefined;
    const slot = b.slot(result);
    b.save(slot, id);
    return slot;
  }
  const receiverObject = b.slot("reference");
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
  const wrapped = b.next();
  b.emit({
    kind: "general-wrap",
    id: wrapped,
    value: b.load(receiverObject),
    start: span.start,
    end: span.end,
  });
  b.save(receiver, wrapped);
  const initialized = new Uint8Array(instance.fields.length);
  for (const field of plan.fields) {
    if (field === undefined) throw "class field initializer invariant";
    const storage = instance.fields[field.field];
    if (
      storage === undefined ||
      (storage.stateOffset === undefined && storage.deferred !== true) ||
      initialized[field.field] === 1
    )
      throw "class field initialization invariant";
    initialized[field.field] = 1;
    let value: number | undefined;
    if (field.kind === "call")
      value = invoke(field.entry, [], storage.type, field);
    else {
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
    // A deferred instance field is written; a static field's state is
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
