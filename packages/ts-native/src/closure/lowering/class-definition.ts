import {
  createFunctionBuilder,
  type FunctionIR,
  type RecordLayout,
  type ScalarType,
  type Span,
} from "@tint/ir/scalar";
import type { FunctionSignature } from "../../scalar.ts";
import { throwNativeError } from "./error-entries.ts";

/** Copy an already-created method/initializer closure from the definition environment. */
export interface ClassDefinitionEntry {
  readonly field: number;
  readonly source: number;
}
export interface ClassDefinitionClosure {
  readonly target: number;
  readonly record: number;
  /** Prototype for construction, constructor for static initialization. */
  readonly receiverField: number;
  /** Optional field in the construction environment holding the class constructor (new.target). */
  readonly constructorField?: number | undefined;
  /** Optional field in the construction environment holding the base $init closure (parameter 1). */
  readonly baseInitField?: number | undefined;
  readonly entries: readonly ClassDefinitionEntry[];
}
export interface ClassDefinitionBinding {
  readonly source: number;
  readonly record: number;
  readonly field: number;
}
export interface ClassDefinitionPlan extends Span {
  readonly id: number;
  readonly name: string;
  readonly environment: number;
  readonly prototype: {
    readonly record: number;
    readonly constructorField: number;
    readonly methods: readonly ClassDefinitionEntry[];
    /** A derived class's hidden link to the base prototype, which the
     * definition receives as its first parameter (C2). */
    readonly link?: number | undefined;
  };
  readonly state: {
    readonly record: number;
    readonly prototypeField: number;
    readonly constructionField: number;
    /** Optional constructor-state field holding the $init closure (C2). */
    readonly initializationField?: number | undefined;
    /** A derived constructor state's hidden link to the base constructor state (C2). */
    readonly link?: number | undefined;
    readonly methods: readonly ClassDefinitionEntry[];
  };
  /** Class [[Call]] entry; the source adapter supplies its TypeError behavior. */
  readonly callTarget: number;
  readonly construction: ClassDefinitionClosure;
  /** Optional $init target sharing the construction environment (C2). */
  readonly initialization?: { readonly target: number } | undefined;
  readonly statics?: ClassDefinitionClosure;
  readonly innerBinding?: ClassDefinitionBinding;
  readonly outerBinding?: ClassDefinitionBinding;
}

/** Define a base or derived class from checked layouts and lexical closures.
 * Computed-key and heritage evaluation precede this phase; no source evaluation
 * is reordered here. */
export function buildClassDefinition(
  plan: ClassDefinitionPlan,
  records: readonly RecordLayout[],
  signatures: readonly FunctionSignature[],
): FunctionIR {
  const link = plan.prototype.link;
  const stateLink = plan.state.link;
  const hasBaseInit = plan.construction.baseInitField !== undefined;
  // A derived definition receives (basePrototype, [baseInit], [baseState]).
  const parameters: ScalarType[] = [];
  if (link !== undefined) {
    parameters.push("reference");
    if (hasBaseInit) parameters.push("reference");
    if (stateLink !== undefined) parameters.push("reference");
  }
  const baseStateSlot = hasBaseInit ? 2 : 1;
  const b = createFunctionBuilder(
    plan.id,
    plan.name,
    parameters,
    "reference",
    plan,
  );
  const trap = b.block(),
    env = b.slot("reference");
  const environment = records[plan.environment];
  if (environment === undefined) throw "class definition environment invariant";
  if (
    signatures[plan.callTarget] === undefined ||
    signatures[plan.construction.target]?.returnType !== "reference"
  )
    throw "class definition entry signature invariant";
  const source = { start: plan.start, end: plan.end };
  const environmentValue = b.next();
  b.emit({
    kind: "closure-environment",
    id: environmentValue,
    start: source.start,
    end: source.end,
  });
  b.save(env, environmentValue);
  function read(field: number): number {
    const storage = environment?.fields[field];
    if (storage?.type !== "reference" || storage.presenceOffset !== undefined)
      throw "class definition source field invariant";
    const slot = b.slot("reference"),
      next = b.block();
    const operation: "read" = "read";
    const object = b.load(env);
    if (storage.stateOffset === undefined)
      b.end({
        kind: "record",
        object,
        record: plan.environment,
        field,
        slot,
        operation,
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
        slot,
        operation,
        consequent: next,
        alternate: trap,
        start: source.start,
        end: source.end,
      });
    b.at(next);
    return slot;
  }
  function allocate(
    record: number,
    specialField: number,
    specialValue: number | undefined,
    entries: readonly ClassDefinitionEntry[],
    linkField: number | undefined = undefined,
    extra: readonly { readonly field: number; readonly slot: number }[] = [],
  ): number {
    const layout = records[record];
    if (layout === undefined) throw "class definition record invariant";
    const values: (number | undefined)[] = layout.fields.map(() => undefined);
    const provided = new Uint8Array(layout.fields.length);
    function put(field: number, value: number): void {
      if (layout?.fields[field]?.type !== "reference" || provided[field] === 1)
        throw "class definition field mapping invariant";
      provided[field] = 1;
      values[field] = value;
    }
    if (specialValue !== undefined) put(specialField, specialValue);
    // Parameter slot 0 holds the base prototype.
    if (linkField !== undefined) put(linkField, 0);
    for (const item of extra) {
      if (item === undefined) throw "class definition extra field invariant";
      put(item.field, item.slot);
    }
    for (const entry of entries) {
      if (entry === undefined) throw "class definition entry invariant";
      if (entry.field === specialField)
        throw "class definition reserved field invariant";
      put(entry.field, read(entry.source));
    }
    const arguments_ = layout.fields.map((field, index) => {
      if (field === undefined) throw "class definition field invariant";
      const slot = values[index];
      if (slot !== undefined) return b.load(slot);
      if (
        field.stateOffset === undefined &&
        field.presenceOffset === undefined &&
        field.deferred !== true
      )
        throw "class definition missing initial field";
      return undefined;
    });
    const id = b.next(),
      slot = b.slot("reference");
    b.emit({
      kind: "record-new",
      id,
      record,
      arguments: arguments_,
      start: source.start,
      end: source.end,
    });
    b.save(slot, id);
    return slot;
  }
  function initialize(
    object: number,
    record: number,
    field: number,
    value: number,
  ): void {
    const storage = records[record]?.fields[field];
    if (storage?.type !== "reference" || storage.stateOffset === undefined)
      throw "class definition initialization field invariant";
    const next = b.block();
    b.end({
      kind: "record-cell",
      object: b.load(object),
      record,
      field,
      operation: "initialize",
      slot: value,
      consequent: next,
      alternate: trap,
      start: source.start,
      end: source.end,
    });
    b.at(next);
  }
  function closure(target: number, environment: number): number {
    if (signatures[target] === undefined)
      throw "class definition signature invariant";
    const id = b.next(),
      slot = b.slot("reference");
    b.emit({
      kind: "function-new",
      id,
      target,
      environment: b.load(environment),
      start: source.start,
      end: source.end,
    });
    b.save(slot, id);
    return slot;
  }
  function entry(plan: ClassDefinitionClosure, receiver: number): number {
    return closure(
      plan.target,
      allocate(plan.record, plan.receiverField, receiver, plan.entries),
    );
  }
  function publish(binding: ClassDefinitionBinding, constructor: number): void {
    initialize(
      read(binding.source),
      binding.record,
      binding.field,
      constructor,
    );
  }
  const prototype = allocate(
    plan.prototype.record,
    plan.prototype.constructorField,
    undefined,
    plan.prototype.methods,
    link,
  );
  const state = allocate(
    plan.state.record,
    plan.state.prototypeField,
    prototype,
    plan.state.methods,
    undefined,
    stateLink === undefined ? [] : [{ field: stateLink, slot: baseStateSlot }],
  );
  const constructor = closure(plan.callTarget, state);
  initialize(
    prototype,
    plan.prototype.record,
    plan.prototype.constructorField,
    constructor,
  );
  const constructionExtras: {
    readonly field: number;
    readonly slot: number;
  }[] = [];
  const ctorField = plan.construction.constructorField;
  if (ctorField !== undefined)
    constructionExtras.push({
      field: ctorField,
      slot: constructor,
    });
  const baseInitField = plan.construction.baseInitField;
  if (baseInitField !== undefined)
    constructionExtras.push({
      field: baseInitField,
      slot: 1,
    });
  const constructionEnv = allocate(
    plan.construction.record,
    plan.construction.receiverField,
    prototype,
    plan.construction.entries,
    undefined,
    constructionExtras,
  );
  const construction = closure(plan.construction.target, constructionEnv);
  initialize(
    state,
    plan.state.record,
    plan.state.constructionField,
    construction,
  );
  const initialization = plan.initialization,
    initializationField = plan.state.initializationField;
  if (initialization !== undefined && initializationField !== undefined) {
    const initEntry = closure(initialization.target, constructionEnv);
    initialize(state, plan.state.record, initializationField, initEntry);
  }
  const inner = plan.innerBinding;
  if (inner !== undefined) publish(inner, constructor);
  const statics = plan.statics;
  if (statics !== undefined) {
    const signature = signatures[statics.target];
    if (signature?.returnType !== "void" || signature.parameters.length !== 0)
      throw "class static entry signature invariant";
    const callee = entry(statics, constructor);
    const arguments_: number[] = [];
    b.emit({
      kind: "call-indirect",
      id: undefined,
      target: statics.target,
      callee: b.load(callee),
      arguments: arguments_,
      start: source.start,
      end: source.end,
    });
  }
  const outer = plan.outerBinding;
  if (outer !== undefined) publish(outer, constructor);
  b.end({
    kind: "return",
    value: b.load(constructor),
    start: source.start,
    end: source.end,
  });
  b.at(trap);
  b.end({ kind: "trap", start: source.start, end: source.end });
  return { ...b.finish(), closureEnvironment: plan.environment };
}

export interface ClassCallTargetPlan extends Span {
  readonly id: number;
  readonly name: string;
  readonly className: string;
  /** Constructor state record: the [[Call]] entry's closure environment. */
  readonly state: number;
  /** The realm's TypeError record, when the program's errors are realm objects. */
  readonly typeError?: number | undefined;
}

/** A class constructor's [[Call]]: calling it without `new` throws a
 * TypeError (ECMA-262 10.2.1 step 2). */
export function buildClassCallTarget(plan: ClassCallTargetPlan): FunctionIR {
  const b = createFunctionBuilder(plan.id, plan.name, [], "void", plan);
  const source = { start: plan.start, end: plan.end };
  const message = b.next();
  b.emit({
    kind: "string-literal",
    id: message,
    value:
      "Class constructor " +
      plan.className +
      " cannot be invoked without 'new'",
    start: source.start,
    end: source.end,
  });
  throwNativeError(b, "TypeError", message, plan.typeError, source);
  return { ...b.finish(), closureEnvironment: plan.state };
}
