import { syntaxHash } from "@tint/typescript/syntax";
import { shortCircuit, propertyReference, callValue } from "@tint/ir/semantic";
import {
  createKeyIndex,
  type ReadonlyKeyIndex,
} from "@tint/foundation/collections/key-index";
import type {
  CheckedModule,
  CheckedFunction,
  Local,
  ExpressionInfo,
  Expression,
  Statement,
  Span,
} from "@tint/typescript/checker";
import {
  verify,
  maximumStringLength,
  instructionResult,
  instructionMayThrow,
  type ModuleIR,
  type FunctionIR,
  type Block,
  type Instruction,
  type Terminator,
  type ScalarType,
  type Diagnostic,
  type ReturnType,
  type Span as IRSpan,
} from "@tint/ir/scalar";
/** A closed builtin may eliminate this unobservable, effect-free receiver.
 * Bound expansion; spreads, computed elements and other receivers use the runtime. */
function literalStrings(node: Expression): readonly Expression[] | undefined {
  while (node.kind === "group" || node.kind === "satisfies")
    node = node.expression;
  if (
    node.kind !== "array" ||
    node.elements.length === 0 ||
    node.elements.length > 32
  )
    return undefined;
  for (const element of node.elements) {
    if (element === undefined || element.kind !== "string") return undefined;
  }
  return node.elements;
}
export type LoweringResult =
  | { readonly ok: true; readonly value: ModuleIR }
  | { readonly ok: false; readonly error: Diagnostic };
interface Builder {
  readonly id: number;
  readonly instructions: Instruction[];
  terminator: Terminator | undefined;
  exception?: { readonly target: number; readonly slot: number };
}
interface LoopTarget {
  readonly head: number | undefined;
  readonly exit: number;
}
interface LabelTarget {
  readonly name: string;
  readonly exit: number;
  head: number | undefined;
}
interface FinallyScope {
  readonly body: Statement;
  readonly loop: LoopTarget | undefined;
  readonly exception:
    { readonly target: number; readonly slot: number } | undefined;
  readonly parent: FinallyScope | undefined;
}
// Input is an unchanged successful checker result; IDs/maps are its public contract.
export function lowerModule(module: CheckedModule): LoweringResult {
  const functions = module.functions.map((fn) =>
    lowerFunction(fn, module.functions),
  );
  const value: ModuleIR = { functions },
    checked = verify(value);
  return checked.ok ? { ok: true, value } : checked;
}
export type CollectionElement = "number" | "string" | number;
export interface PrimitiveRuntime {
  readonly fromNull: number;
  readonly isNullish: number;
  readonly fromUndefined: number;
  readonly fromNumber: number;
  readonly fromBoolean: number;
  readonly fromString: number;
  readonly fromOptionalNumber: number;
  readonly fromOptionalString: number;
  readonly fromOptionalBoolean: number;
  readonly fromOptionalBox: number;
  readonly readNumber: number;
  readonly readBoolean: number;
  readonly readString: number;
  readonly readOptionalNumber: number;
  readonly readOptionalString: number;
  readonly readOptionalBoolean: number;
  readonly kindOf: number;
  readonly truthy: number;
  readonly strictEqual: number;
  readonly canonicalKey: number;
  readonly canonicalOptionalNumber: number;
}
export interface MapRuntimeBinding {
  readonly key: CollectionElement;
  readonly value: CollectionElement;
  readonly runtime: MapRuntime;
  /** The producer vouches that these helpers only move values and compare
   * keys by one machine rule per class, so they may serve keys and values of
   * the same encoding classes (mapEncodingClass). */
  readonly erasedRecords?: boolean;
}
export interface MapRuntime {
  readonly iterator?: {
    readonly create: number;
    readonly advance: number;
    readonly key: number;
    readonly value: number;
  };
  readonly create: number;
  readonly get: number;
  readonly has: number;
  readonly set: number;
  readonly delete: number;
  readonly clear: number;
  readonly size: number;
}
export interface SetRuntimeBinding {
  readonly element: CollectionElement;
  readonly runtime: SetRuntime;
}
export interface SetRuntime {
  /** Linear copy of this exact representation, preserving member identity. */
  readonly clone?: number;
  readonly iterator?: {
    readonly create: number;
    readonly advance: number;
    readonly read: number;
  };
  readonly create: number;
  readonly has: number;
  readonly add: number;
  readonly delete: number;
  readonly clear: number;
  readonly size: number;
}
export interface ListRuntimeBinding {
  /** Primitive encoding or caller-owned identity for a required object element contract. */
  readonly element: CollectionElement;
  readonly runtime: ListRuntime;
  /** The producer vouches that these helpers never inspect an element (they
   * only move it), so an element may use helpers specialized for another
   * element of the same encoding class (listElementClass). */
  readonly erasedRecords?: boolean;
}
export type ListOperation =
  "has" | "delete" | "resize" | "create" | "read" | "write" | "push" | "length";
export interface ListRuntime {
  readonly sort?: number;
  readonly has?: number;
  readonly delete?: number;
  readonly resize?: number;
  readonly create: number;
  readonly read: number;
  readonly write: number;
  readonly push: number;
  readonly length: number;
}
export interface FunctionSignature {
  readonly parameters: readonly ScalarType[];
  readonly returnType: ReturnType;
}
export interface RecordAccess {
  /** Resolve properties in a managed function environment, preserving function identity. */
  readonly functionEnvironment?: boolean;
  readonly type: ScalarType;
  readonly choices: readonly RecordAccessChoice[];
}
export interface RecordAccessChoice {
  readonly record: number;
  readonly field: number;
  readonly type: ScalarType;
  readonly primitive?: boolean;
  /** Field uses the record-cell initialization state contract. */
  readonly initialized?: boolean;
  /** Read fallback through this record's prototype pointer. Writes remain own. */
  readonly prototype?: {
    readonly field: number;
    readonly access: RecordAccess;
  };
}
export interface ConstructionField {
  readonly name: string;
  readonly type: ScalarType;
  readonly optional?: boolean;
  readonly primitive?: boolean;
}
export interface RecordConstructionShape {
  readonly record: number;
  readonly fields: readonly ConstructionField[];
}
export interface RecordConstruction extends RecordConstructionShape {
  readonly discriminant?: string;
  readonly variants?: readonly (RecordConstructionShape & {
    readonly tag: string | number | boolean | undefined;
  })[];
}
export interface ConstructorCall {
  /** Signature witness for the separate construction closure. */
  readonly target: number;
  readonly entry: RecordAccess;
}
export interface RecordOperations {
  readonly constructors?: ReadonlyKeyIndex<Expression, ConstructorCall>;
  readonly spreads?: ReadonlyMap<
    Expression,
    readonly {
      readonly name: string;
      readonly access: RecordAccess;
      readonly alwaysPresent: boolean;
    }[]
  >;
  readonly constructions: ReadonlyKeyIndex<Expression, RecordConstruction>;
  readonly accesses: ReadonlyKeyIndex<Expression, RecordAccess>;
}
export interface OwnedHoistedFunction {
  readonly local: number;
  readonly target: number;
  readonly scope?: Span | undefined;
  readonly declaration: Span;
  /** Created after this statement of its scope instead of at scope entry
   * (planned only when nothing earlier can refer to it). */
  readonly after?: Span | undefined;
}
export interface OwnedCell {
  readonly local: number;
  readonly record: number;
  readonly incoming?: number | undefined;
  /** Proven initialized, never reassigned word parameter; retain its traced payload. */
  readonly byValue?: boolean;
  readonly perIteration?: boolean | undefined;
  readonly scope?: Span | undefined;
  readonly declaration: Span;
}
export interface OwnedConstructor {
  readonly record: number;
  readonly locals: readonly number[];
}
/** Explicit lexical cells and owned environment records planned by the source adapter. */
export interface OwnedEnvironmentPlan {
  readonly hoisted?: readonly OwnedHoistedFunction[];
  readonly record?: number | undefined;
  readonly cells: readonly OwnedCell[];
  readonly constructors: ReadonlyMap<number, OwnedConstructor>;
}
/** Emit one function against explicit call signatures. Verify the composed module before use. */
export function lowerFunction(
  fn: CheckedFunction,
  signatures: readonly FunctionSignature[],
  records?: RecordOperations,
  lists?: readonly ListRuntimeBinding[],
  sets?: readonly SetRuntimeBinding[],
  maps?: readonly MapRuntimeBinding[],
  owned?: OwnedEnvironmentPlan,
  primitiveBindings?: PrimitiveRuntime,
): FunctionIR {
  const primitives = primitiveBindings;
  const slots: ScalarType[] = fn.locals.map((l) => l.type),
    blocks: Builder[] = [];
  const receiverSlot = fn.receiver ? slots.length : undefined;
  if (receiverSlot !== undefined) slots.push("general");
  const callReceivers = createKeyIndex<Expression, number>(syntaxHash);
  let exception: { readonly target: number; readonly slot: number } | undefined;
  let finalizer: FinallyScope | undefined;
  const labels: LabelTarget[] = [];
  const blockFinalizers: (FinallyScope | undefined)[] = [];
  let nextValue = 0;
  const valueTypes: (ScalarType | undefined)[] = [];
  // Proofs apply to SSA values and expression-result temporaries, never mutable
  // source locals. Union-valued merge slots are not inferred from a branch store.
  const undefinedValues: number[] = [],
    undefinedSlots: number[] = [];
  function block(): Builder {
    const b: Builder = {
      id: blocks.length,
      instructions: [],
      terminator: undefined,
    };
    blocks.push(b);
    blockFinalizers.push(finalizer);
    return b;
  }
  let current: Builder | undefined = block();
  function active(): Builder {
    if (current === undefined) throw "lowering active block invariant";
    return current;
  }
  function emit(op: Instruction): void {
    const handler = exception;
    if (handler !== undefined && instructionMayThrow(op))
      active().exception = handler;
    let type: ScalarType | undefined;
    switch (op.kind) {
      case "general-null":
      case "general-none":
      case "general-wrap":
        type = "general";
        break;
      case "general-value":
        type = op.type;
        break;
      case "boolean-none":
      case "boolean-wrap":
        type = "optional-boolean";
        break;
      case "error-is":
      case "general-equal":
      case "record-has":
      case "general-record-is":
      case "boolean-value":
      case "boolean-present":
        type = "boolean";
        break;
      case "general-kind":
      case "string-literal":
      case "string-from-code-units":
      case "string-concat":
      case "string-slice":
      case "string-allocate":
        type = "string";
        break;
      case "string-length":
      case "string-code-unit":
        type = "number";
        break;
      case "array-subarray":
        type = valueTypes[op.array];
        break;
      case "array-new":
        type = op.type;
        break;
      case "string-none":
      case "string-wrap":
        type = "optional-string";
        break;
      case "string-value":
        type = "string";
        break;
      case "string-present":
        type = "boolean";
        break;
      case "primitive-wrap":
        type = "primitive";
        break;
      case "error-new":
      case "array-buffer":
      case "primitive-reference":
        type = "reference";
        break;
      case "reference-none":
      case "reference-wrap":
      case "function-environment":
        type = "optional-reference";
        break;
      case "reference-value":
        type = op.type ?? "reference";
        break;
      case "closure-environment":
      case "function-new":
      case "record-new":
        type = "reference";
        break;
      case "constant":
        type = typeof op.value === "number" ? "number" : "boolean";
        break;
      case "undefined":
      case "optional-wrap":
      case "array-read":
        type = "optional-number";
        break;
      case "string-starts-with":
      case "optional-present":
      case "array-copy":
      case "array-valid":
        type = "boolean";
        break;
      case "optional-value":
      case "optional-value-or":
      case "array-byte-offset":
      case "array-byte-length":
      case "array-length":
        type = "number";
        break;
      case "load":
        type = slots[op.slot];
        break;
      case "unary":
        type = ["!", "truthy", "is-integer"].includes(op.operator)
          ? "boolean"
          : "number";
        break;
      case "binary":
        type = ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(
          op.operator,
        )
          ? "boolean"
          : "number";
        break;
      case "call-indirect":
      case "call": {
        const result = signatures[op.target]?.returnType;
        if (result !== "void") type = result;
        break;
      }
    }
    if (op.kind === "undefined") undefinedValues[op.id] = 1;
    const result = instructionResult(op);
    if (result !== undefined && type !== undefined) valueTypes[result] = type;
    active().instructions.push(op);
  }
  function emitUnwrap(
    id: number,
    value: number,
    type: ScalarType,
    node: IRSpan,
  ): void {
    if (type === "boolean" || type === "optional-boolean")
      emit({
        kind: "boolean-value",
        id,
        value,
        start: node.start,
        end: node.end,
      });
    else if (type === "string" || type === "optional-string")
      emit({
        kind: "string-value",
        id,
        value,
        start: node.start,
        end: node.end,
      });
    else if (
      type === "Uint8Array" ||
      type === "Uint16Array" ||
      type === "Uint32Array" ||
      type === "Float64Array"
    )
      emit({
        kind: "reference-value",
        id,
        value,
        type,
        start: node.start,
        end: node.end,
      });
    else if (type === "reference" || type === "optional-reference")
      emit({
        kind: "reference-value",
        id,
        value,
        start: node.start,
        end: node.end,
      });
    else
      emit({
        kind: "optional-value",
        id,
        value,
        start: node.start,
        end: node.end,
      });
  }
  function emitPresence(
    id: number,
    value: number,
    string: boolean,
    node: IRSpan,
  ): void {
    if (valueTypes[value] === "optional-boolean")
      emit({
        kind: "boolean-present",
        id,
        value,
        start: node.start,
        end: node.end,
      });
    else if (string)
      emit({
        kind: "string-present",
        id,
        value,
        start: node.start,
        end: node.end,
      });
    else
      emit({
        kind: "optional-present",
        id,
        value,
        start: node.start,
        end: node.end,
      });
  }
  function coerce(
    id: number,
    type: ScalarType | undefined,
    node: IRSpan,
  ): number {
    const sourceType = valueTypes[id];
    if (sourceType === "general" && type === "primitive") {
      if (primitives === undefined) throw "primitive runtime invariant";
      const source = save(id, "general", node);
      const result = temporary("primitive");
      const categoryValue = nextValue++;
      emit({
        kind: "general-kind",
        id: categoryValue,
        value: load(source, node),
        start: node.start,
        end: node.end,
      });
      const category = save(categoryValue, "string", node);
      const done = block();
      for (const kind of [
        "undefined",
        "number",
        "boolean",
        "string",
        "object",
      ]) {
        if (kind === undefined) throw "primitive category invariant";
        const literal = nextValue++;
        emit({
          kind: "string-literal",
          id: literal,
          value: kind,
          start: node.start,
          end: node.end,
        });
        const matches = binarySlot(
          "===",
          category,
          save(literal, "string", node),
          node,
        );
        const yes = block(),
          no = block();
        choose(load(matches, node), yes, no, node);
        current = yes;
        if (kind === "object") {
          // A narrowed primitive union can contain null, but never a record.
          // Do not reinterpret an unexpected object as null.
          const nil = nextValue++,
            equal = nextValue++;
          emit({
            kind: "general-null",
            id: nil,
            start: node.start,
            end: node.end,
          });
          emit({
            kind: "general-equal",
            id: equal,
            left: load(source, node),
            right: nil,
            start: node.start,
            end: node.end,
          });
          const isNull = block();
          choose(equal, isNull, no, node);
          current = isNull;
        }
        if (kind === "undefined" || kind === "object") {
          const reference = primitiveCall(
            kind === "undefined"
              ? primitives.fromUndefined
              : primitives.fromNull,
            [],
            node,
          );
          const wrapped = nextValue++;
          emit({
            kind: "primitive-wrap",
            id: wrapped,
            value: reference,
            start: node.start,
            end: node.end,
          });
          store(result, wrapped, node);
        } else {
          const payloadType: ScalarType =
            kind === "number"
              ? "number"
              : kind === "boolean"
                ? "boolean"
                : "string";
          const payload = coerce(load(source, node), payloadType, node);
          store(result, coerce(payload, "primitive", node), node);
        }
        jump(done.id, node);
        current = no;
      }
      finish({ kind: "trap", start: node.start, end: node.end });
      current = done;
      return load(result, node);
    }
    if (type === "general" && sourceType === "primitive") {
      if (primitives === undefined) throw "primitive runtime invariant";
      const source = save(id, "primitive", node);
      const result = temporary("general");
      const category = save(
        primitiveCall(
          primitives.kindOf,
          [primitiveReference(load(source, node), node)],
          node,
        ),
        "string",
        node,
      );
      const done = block();
      for (const kind of [
        "undefined",
        "number",
        "boolean",
        "string",
        "object",
      ]) {
        if (kind === undefined) throw "primitive category invariant";
        const literal = nextValue++;
        emit({
          kind: "string-literal",
          id: literal,
          value: kind,
          start: node.start,
          end: node.end,
        });
        const matches = binarySlot(
          "===",
          category,
          save(literal, "string", node),
          node,
        );
        const yes = block(),
          no = block();
        choose(load(matches, node), yes, no, node);
        current = yes;
        if (kind === "undefined" || kind === "object") {
          const packed = nextValue++;
          if (kind === "undefined")
            emit({
              kind: "general-none",
              id: packed,
              start: node.start,
              end: node.end,
            });
          else
            emit({
              kind: "general-null",
              id: packed,
              start: node.start,
              end: node.end,
            });
          store(result, packed, node);
        } else {
          const reader =
            kind === "number"
              ? primitives.readNumber
              : kind === "boolean"
                ? primitives.readBoolean
                : primitives.readString;
          const payload = primitiveCall(
            reader,
            [primitiveReference(load(source, node), node)],
            node,
          );
          store(result, coerce(payload, "general", node), node);
        }
        jump(done.id, node);
        current = no;
      }
      finish({ kind: "trap", start: node.start, end: node.end });
      current = done;
      return load(result, node);
    }
    if (
      sourceType === "optional-reference" &&
      (type === "Uint8Array" ||
        type === "Uint16Array" ||
        type === "Uint32Array" ||
        type === "Float64Array")
    ) {
      const unwrapped = nextValue++;
      emitUnwrap(unwrapped, id, type, node);
      return unwrapped;
    }
    const packOptional =
      type === "general" &&
      undefinedValues[id] !== 1 &&
      (sourceType === "optional-number" ||
        sourceType === "optional-boolean" ||
        sourceType === "optional-string" ||
        sourceType === "optional-reference");
    const unpackOptional =
      sourceType === "general" &&
      (type === "optional-number" ||
        type === "optional-boolean" ||
        type === "optional-string" ||
        type === "optional-reference");
    if (packOptional || unpackOptional) {
      const optional = packOptional ? sourceType : type;
      const required: ScalarType =
        optional === "optional-number"
          ? "number"
          : optional === "optional-boolean"
            ? "boolean"
            : optional === "optional-string"
              ? "string"
              : "reference";
      if (sourceType === undefined) throw "optional general source invariant";
      if (type === undefined) throw "optional general target invariant";
      const source = save(id, sourceType, node),
        result = temporary(type);
      const present = nextValue++;
      if (packOptional) {
        if (sourceType === "optional-reference")
          emit({
            kind: "unary",
            id: present,
            operator: "truthy",
            operand: load(source, node),
            start: node.start,
            end: node.end,
          });
        else
          emitPresence(
            present,
            load(source, node),
            sourceType === "optional-string",
            node,
          );
      } else {
        const none = nextValue++,
          equal = nextValue++;
        emit({
          kind: "general-none",
          id: none,
          start: node.start,
          end: node.end,
        });
        emit({
          kind: "general-equal",
          id: equal,
          left: load(source, node),
          right: none,
          start: node.start,
          end: node.end,
        });
        emit({
          kind: "unary",
          id: present,
          operator: "!",
          operand: equal,
          start: node.start,
          end: node.end,
        });
      }
      const yes = block(),
        no = block(),
        done = block();
      choose(present, yes, no, node);
      current = yes;
      let payload: number;
      if (packOptional) {
        payload = nextValue++;
        emitUnwrap(payload, load(source, node), required, node);
      } else payload = coerce(load(source, node), required, node);
      store(result, coerce(payload, type, node), node);
      jump(done.id, node);
      current = no;
      const absent = nextValue++;
      emit({ kind: "undefined", id: absent, start: node.start, end: node.end });
      store(result, coerce(absent, type, node), node);
      jump(done.id, node);
      current = done;
      return load(result, node);
    }
    if (type === "general" && sourceType !== "general") {
      const wrapped = nextValue++;
      if (undefinedValues[id] === 1)
        emit({
          kind: "general-none",
          id: wrapped,
          start: node.start,
          end: node.end,
        });
      else
        emit({
          kind: "general-wrap",
          id: wrapped,
          value: id,
          start: node.start,
          end: node.end,
        });
      return wrapped;
    }
    if (
      sourceType === "general" &&
      (type === "number" ||
        type === "boolean" ||
        type === "string" ||
        type === "reference")
    ) {
      const unwrapped = nextValue++;
      emit({
        kind: "general-value",
        id: unwrapped,
        value: id,
        type,
        start: node.start,
        end: node.end,
      });
      return unwrapped;
    }
    if (
      type === "optional-boolean" &&
      sourceType !== type &&
      sourceType !== "primitive"
    ) {
      const wrapped = nextValue++;
      if (undefinedValues[id] === 1)
        emit({
          kind: "boolean-none",
          id: wrapped,
          start: node.start,
          end: node.end,
        });
      else if (sourceType === "boolean")
        emit({
          kind: "boolean-wrap",
          id: wrapped,
          value: id,
          start: node.start,
          end: node.end,
        });
      else throw "optional boolean conversion invariant";
      return wrapped;
    }
    if (type === "boolean" && sourceType === "optional-boolean") {
      const unwrapped = nextValue++;
      emitUnwrap(unwrapped, id, "boolean", node);
      return unwrapped;
    }
    if (
      sourceType !== type &&
      (sourceType === "primitive" || type === "primitive")
    ) {
      if (primitives === undefined) throw "primitive runtime invariant";
      if (type === "primitive") {
        const absent = undefinedValues[id] === 1;
        const target = absent
          ? primitives.fromUndefined
          : sourceType === "number"
            ? primitives.fromNumber
            : sourceType === "boolean"
              ? primitives.fromBoolean
              : sourceType === "string"
                ? primitives.fromString
                : sourceType === "optional-number"
                  ? primitives.fromOptionalNumber
                  : sourceType === "optional-string"
                    ? primitives.fromOptionalString
                    : sourceType === "optional-boolean"
                      ? primitives.fromOptionalBoolean
                      : sourceType === "optional-reference"
                        ? primitives.fromOptionalBox
                        : undefined;
        if (target === undefined) throw "primitive boxing contract invariant";
        const reference = primitiveCall(target, absent ? [] : [id], node);
        const wrapped = nextValue++;
        emit({
          kind: "primitive-wrap",
          id: wrapped,
          value: reference,
          start: node.start,
          end: node.end,
        });
        return wrapped;
      }
      if (type === "optional-reference") {
        const reference = primitiveReference(id, node),
          wrapped = nextValue++;
        emit({
          kind: "reference-wrap",
          id: wrapped,
          value: reference,
          start: node.start,
          end: node.end,
        });
        return wrapped;
      }
      const target =
        type === "number"
          ? primitives.readNumber
          : type === "boolean"
            ? primitives.readBoolean
            : type === "string"
              ? primitives.readString
              : type === "optional-number"
                ? primitives.readOptionalNumber
                : type === "optional-string"
                  ? primitives.readOptionalString
                  : type === "optional-boolean"
                    ? primitives.readOptionalBoolean
                    : undefined;
      if (target === undefined) throw "primitive extraction contract invariant";
      return primitiveCall(target, [primitiveReference(id, node)], node);
    }
    if (type === "optional-reference" || type === "optional-string") {
      const source = valueTypes[id];
      const required = type === "optional-string" ? "string" : "reference";
      const present =
        source === required ||
        (type === "optional-reference" &&
          ["Uint8Array", "Uint16Array", "Uint32Array", "Float64Array"].includes(
            source ?? "",
          ));
      if (present || undefinedValues[id] === 1) {
        const wrapped = nextValue++;
        if (present)
          emit(
            type === "optional-string"
              ? {
                  kind: "string-wrap",
                  id: wrapped,
                  value: id,
                  start: node.start,
                  end: node.end,
                }
              : {
                  kind: "reference-wrap",
                  id: wrapped,
                  value: id,
                  start: node.start,
                  end: node.end,
                },
          );
        else
          emit(
            type === "optional-string"
              ? {
                  kind: "string-none",
                  id: wrapped,
                  start: node.start,
                  end: node.end,
                }
              : {
                  kind: "reference-none",
                  id: wrapped,
                  start: node.start,
                  end: node.end,
                },
          );
        return wrapped;
      }
    }
    if (type === "optional-number" && valueTypes[id] === "boolean") {
      const numeric = nextValue++;
      emit({
        kind: "unary",
        operator: "boolean-number",
        id: numeric,
        operand: id,
        start: node.start,
        end: node.end,
      });
      id = numeric;
    }
    if (type === "optional-number" && valueTypes[id] === "number") {
      const wrapped = nextValue++;
      emit({
        kind: "optional-wrap",
        id: wrapped,
        value: id,
        start: node.start,
        end: node.end,
      });
      return wrapped;
    }
    return id;
  }
  function primitiveReference(id: number, node: IRSpan): number {
    const result = nextValue++;
    emit({
      kind: "primitive-reference",
      id: result,
      value: id,
      start: node.start,
      end: node.end,
    });
    return result;
  }
  function primitiveCall(
    target: number,
    args: readonly number[],
    node: IRSpan,
  ): number {
    const id = nextValue++;
    emit({
      kind: "call",
      id,
      target,
      arguments: args,
      start: node.start,
      end: node.end,
    });
    return id;
  }
  function finish(terminator: Terminator): void {
    if (
      terminator.kind === "return" &&
      terminator.value !== undefined &&
      fn.returnType !== "void"
    )
      terminator = {
        ...terminator,
        value: coerce(terminator.value, fn.returnType, terminator),
      };
    const handler = exception;
    if (
      handler !== undefined &&
      (terminator.kind === "throw" || terminator.kind === "throw-literal")
    )
      active().exception = handler;
    active().terminator = terminator;
    current = undefined;
  }
  function jump(target: number, node: IRSpan): void {
    finish({ kind: "jump", target, start: node.start, end: node.end });
  }
  function load(slot: number, node: IRSpan): number {
    const id = nextValue++;
    emit({ kind: "load", id, slot, start: node.start, end: node.end });
    if (undefinedSlots[slot] === 1) undefinedValues[id] = 1;
    return id;
  }
  function store(slot: number, value: number, node: IRSpan): void {
    // A saved undefined literal is constant only until its slot is overwritten.
    undefinedSlots[slot] = 0;
    emit({
      kind: "store",
      slot,
      value: coerce(value, slots[slot], node),
      start: node.start,
      end: node.end,
    });
  }
  const cellPointers: (number | undefined)[] = [],
    ownedCells = owned?.cells ?? [];
  for (const cell of ownedCells) {
    if (cell === undefined) throw "owned cell invariant";
    if (cell.byValue === true) {
      // Payload captures have no cell pointer. Reuse the local-indexed map so
      // closure construction does not scan the capture list for every field.
      cellPointers[cell.local] = -1;
      continue;
    }
    cellPointers[cell.local] = temporary("reference");
  }
  function cellAccess(
    local: number,
    operation: "read" | "write" | "initialize",
    node: Span,
  ): void {
    const cell = ownedCells.find((c) => c !== undefined && c.local === local);
    if (cell === undefined) return;
    if (cell.byValue === true) {
      if (operation === "write") throw "write to captured value invariant";
      return;
    }
    const pointer = cellPointers[local];
    if (pointer === undefined) throw "owned cell pointer invariant";
    const success = block(),
      failure = block();
    finish({
      kind: "record-cell",
      object: load(pointer, node),
      record: cell.record,
      field: 0,
      operation,
      slot: local,
      consequent: success.id,
      alternate: failure.id,
      start: node.start,
      end: node.end,
    });
    current = failure;
    // Strict definite-assignment proofs allow a var cell to acquire its concrete
    // payload on the first write; subsequent writes share the same mutable cell.
    if (operation === "write" && fn.locals[local]?.hoisted === true) {
      const failed = block();
      finish({
        kind: "record-cell",
        object: load(pointer, node),
        record: cell.record,
        field: 0,
        operation: "initialize",
        slot: local,
        consequent: success.id,
        alternate: failed.id,
        start: node.start,
        end: node.end,
      });
      current = failed;
    }
    finish({ kind: "trap", start: node.start, end: node.end });
    current = success;
  }
  function readLocal(local: number, node: Span): number {
    cellAccess(local, "read", node);
    return load(local, node);
  }
  function writeLocal(local: number, value: number, node: Span): void {
    store(local, value, node);
    const declaration = ownedCells.find(
      (c) => c !== undefined && c.local === local && c.incoming === undefined,
    )?.declaration;
    cellAccess(
      local,
      declaration === node && fn.locals[local]?.hoisted !== true
        ? "initialize"
        : "write",
      node,
    );
  }
  function allocateCells(scope: Span | undefined): void {
    for (const cell of ownedCells) {
      if (cell === undefined) throw "owned cell invariant";
      if (
        cell.byValue === true ||
        cell.incoming !== undefined ||
        cell.scope !== scope
      )
        continue;
      const pointer = cellPointers[cell.local];
      if (pointer === undefined) throw "owned cell allocation invariant";
      const id = nextValue++;
      emit({
        kind: "record-new",
        id,
        record: cell.record,
        arguments: [undefined],
        start: cell.declaration.start,
        end: cell.declaration.end,
      });
      store(pointer, id, cell.declaration);
    }
  }
  function copyIterationCells(scope: Span): void {
    for (const cell of ownedCells) {
      if (cell === undefined) throw "owned cell invariant";
      if (
        cell.incoming !== undefined ||
        cell.byValue === true ||
        cell.scope !== scope ||
        !cell.perIteration
      )
        continue;
      const pointer = cellPointers[cell.local];
      if (pointer === undefined) throw "iteration cell pointer invariant";
      const payload = readLocal(cell.local, scope);
      const id = nextValue++;
      emit({
        kind: "record-new",
        id,
        record: cell.record,
        arguments: [payload],
        start: scope.start,
        end: scope.end,
      });
      store(pointer, id, scope);
    }
  }
  function functionValue(target: number, node: Span): number {
    const id = nextValue++;
    const construction =
      owned === undefined ? undefined : owned.constructors.get(target);
    let environment: number | undefined;
    if (construction !== undefined) {
      environment = nextValue++;
      emit({
        kind: "record-new",
        id: environment,
        record: construction.record,
        arguments: construction.locals.map((local): number => {
          if (local === undefined) throw "closure captured local invariant";
          const pointer = cellPointers[local];
          if (pointer === -1) return load(local, node);
          if (pointer === undefined) throw "closure captured cell invariant";
          return load(pointer, node);
        }),
        start: node.start,
        end: node.end,
      });
    }
    emit({
      kind: "function-new",
      id,
      target,
      ...(environment === undefined ? {} : { environment }),
      start: node.start,
      end: node.end,
    });
    return save(id, "reference", node);
  }
  function hoistFunctions(scope: Span | undefined): void {
    for (const declaration of owned?.hoisted ?? []) {
      if (declaration === undefined) throw "hoisted declaration invariant";
      if (declaration.scope !== scope || declaration.after !== undefined)
        continue;
      const value = functionValue(declaration.target, declaration.declaration);
      writeLocal(
        declaration.local,
        load(value, declaration.declaration),
        declaration.declaration,
      );
    }
  }
  /** Hoisted declarations planned after `point`: created once control
   * leaves it normally (unreachable continuations create nothing). */
  function createSunkFunctions(point: Statement): void {
    if (current === undefined) return;
    for (const declaration of owned?.hoisted ?? []) {
      if (declaration === undefined) throw "hoisted declaration invariant";
      if (declaration.after !== point) continue;
      const value = functionValue(declaration.target, declaration.declaration);
      writeLocal(
        declaration.local,
        load(value, declaration.declaration),
        declaration.declaration,
      );
    }
  }
  function temporary(type: ScalarType): number {
    const slot = slots.length;
    slots.push(type);
    return slot;
  }
  function save(id: number, type: ScalarType, node: IRSpan): number {
    const slot = temporary(type);
    store(slot, id, node);
    if (undefinedValues[id] === 1) undefinedSlots[slot] = 1;
    return slot;
  }
  const expressionOverrides = createKeyIndex<Expression, number>(syntaxHash);
  const informationOverrides = createKeyIndex<Expression, ExpressionInfo>(
    syntaxHash,
  );
  function info(node: Expression): ExpressionInfo {
    const i = informationOverrides.get(node) ?? fn.expressions.get(node);
    if (i === undefined) throw "checked expression invariant";
    return i;
  }
  function scalarType(node: Expression): ScalarType {
    const type = info(node).type;
    if (type === "void") throw "scalar expression invariant";
    return type;
  }
  // Array-backed iteration shared by spread and collection construction.
  // Load length each turn and evaluate the source exactly once.
  function arrayValues(
    input: Expression,
    node: Span,
    visit: (item: number, typed: boolean) => void,
    evaluated?: number,
  ): void {
    const source = evaluated ?? value(input);
    if (info(input).setElement !== undefined) {
      const runtime = setRuntime(input).iterator;
      if (runtime === undefined) throw "set iterator runtime invariant";
      const cursor = runtimeCall(runtime.create, [source], node);
      if (cursor === undefined) throw "set cursor result invariant";
      const head = block(),
        body = block(),
        exit = block();
      jump(head.id, node);
      current = head;
      const next = runtimeCall(runtime.advance, [cursor], node);
      if (next === undefined) throw "set advance result invariant";
      choose(load(next, node), body, exit, node);
      current = body;
      const item = runtimeCall(runtime.read, [cursor], node);
      if (item === undefined) throw "set read result invariant";
      visit(item, false);
      jump(head.id, node);
      current = exit;
      return;
    }
    const index = numberSlot(0, node),
      sourceList =
        slots[source] === "reference" ? listRuntime(input) : undefined;
    const head = block(),
      body = block(),
      exit = block();
    jump(head.id, node);
    current = head;
    choose(
      load(
        binarySlot(
          "<",
          index,
          sourceList
            ? listValue(sourceList, "length", [source], node)
            : arrayLength(source, node),
          node,
        ),
        node,
      ),
      body,
      exit,
      node,
    );
    current = body;
    let item: number;
    if (sourceList) item = listValue(sourceList, "read", [source, index], node);
    else {
      const read = nextValue++;
      emit({
        kind: "array-read",
        id: read,
        array: load(source, node),
        index: load(index, node),
        start: node.start,
        end: node.end,
      });
      item = save(read, "optional-number", node);
    }
    visit(item, sourceList === undefined);
    store(
      index,
      load(binarySlot("+", index, numberSlot(1, node), node), node),
      node,
    );
    jump(head.id, node);
    current = exit;
  }
  function stringOperand(slot: number, node: Expression): number {
    if (slots[slot] === "string") return slot;
    if (slots[slot] === "number") {
      const target = info(node).callee;
      if (target === undefined) throw "number formatter binding invariant";
      const id = nextValue++;
      emit({
        kind: "call",
        id,
        target,
        arguments: [load(slot, node)],
        start: node.start,
        end: node.end,
      });
      return save(id, "string", node);
    }
    if (slots[slot] !== "boolean") throw "string operand invariant";
    const result = temporary("string"),
      yes = block(),
      no = block(),
      merge = block();
    choose(load(slot, node), yes, no, node);
    current = yes;
    const trueValue = nextValue++;
    emit({
      kind: "string-literal",
      id: trueValue,
      value: "true",
      start: node.start,
      end: node.end,
    });
    store(result, trueValue, node);
    jump(merge.id, node);
    current = no;
    const falseValue = nextValue++;
    emit({
      kind: "string-literal",
      id: falseValue,
      value: "false",
      start: node.start,
      end: node.end,
    });
    store(result, falseValue, node);
    jump(merge.id, node);
    current = merge;
    return result;
  }

  function value(node: Expression): number {
    const slot = expression(node);
    if (slot === undefined && info(node).never) return numberSlot(0, node);
    if (slot === undefined) throw "value expression invariant";
    return slot;
  }
  function truth(slot: number, node: Span): number {
    // A branch already tests the boolean carrier's zero/nonzero bits. Avoid
    // normalizing them into another boolean first, even for noncanonical bits.
    if (slots[slot] === "boolean") return load(slot, node);
    if (slots[slot] === "primitive") {
      if (primitives === undefined) throw "primitive runtime invariant";
      return primitiveCall(
        primitives.truthy,
        [primitiveReference(load(slot, node), node)],
        node,
      );
    }
    const operand = load(slot, node),
      id = nextValue++;
    emit({
      kind: "unary",
      id,
      operator: "truthy",
      operand,
      start: node.start,
      end: node.end,
    });
    return id;
  }
  function choose(test: number, yes: Builder, no: Builder, node: IRSpan): void {
    finish({
      kind: "branch",
      condition: test,
      consequent: yes.id,
      alternate: no.id,
      start: node.start,
      end: node.end,
    });
  }
  function chooseExpression(test: Expression, yes: Builder, no: Builder): void {
    // A condition needs only truthiness, not the selected operand value. Keep
    // short-circuit evaluation in the CFG without a result slot and merge.
    if (test.kind === "group" || test.kind === "satisfies") {
      chooseExpression(test.expression, yes, no);
      return;
    }
    if (test.kind === "unary" && test.operator === "!") {
      chooseExpression(test.operand, no, yes);
      return;
    }
    if (
      test.kind === "binary" &&
      (test.operator === "&&" || test.operator === "||")
    ) {
      const right = block();
      if (test.operator === "&&") chooseExpression(test.left, right, no);
      else chooseExpression(test.left, yes, right);
      current = right;
      chooseExpression(test.right, yes, no);
      return;
    }
    // Keep literal loop conditions aligned with definite-completion checking.
    // A synthetic false edge on `while (true)` invents a reachable return path.
    if (test.kind === "boolean") jump(test.value ? yes.id : no.id, test);
    else choose(truth(value(test), test), yes, no, test);
  }
  function numberSlot(n: number, node: Span): number {
    const id = nextValue++;
    emit({
      kind: "constant",
      id,
      value: n,
      start: node.start,
      end: node.end,
    });
    return save(id, "number", node);
  }
  function unarySlot(
    operator: string,
    operand: number,
    type: ScalarType,
    node: IRSpan,
  ): number {
    const id = nextValue++;
    emit({
      kind: "unary",
      id,
      operator,
      operand: load(operand, node),
      start: node.start,
      end: node.end,
    });
    return save(id, type, node);
  }
  function binarySlot(
    operator: string,
    left: number,
    right: number,
    node: IRSpan,
  ): number {
    if (slots[left] === "general" || slots[right] === "general") {
      if (operator !== "===" && operator !== "!==")
        throw "unsupported general operation";
      const a = save(
          coerce(load(left, node), "general", node),
          "general",
          node,
        ),
        b = save(coerce(load(right, node), "general", node), "general", node),
        id = nextValue++;
      emit({
        kind: "general-equal",
        id,
        left: load(a, node),
        right: load(b, node),
        start: node.start,
        end: node.end,
      });
      const equal = save(id, "boolean", node);
      return operator === "==="
        ? equal
        : unarySlot("!", equal, "boolean", node);
    }
    if (slots[left] === "primitive" || slots[right] === "primitive") {
      if (
        primitives === undefined ||
        (operator !== "===" && operator !== "!==")
      )
        throw "primitive comparison contract invariant";
      const a = coerce(load(left, node), "primitive", node),
        b = coerce(load(right, node), "primitive", node);
      const equal = save(
        primitiveCall(
          primitives.strictEqual,
          [primitiveReference(a, node), primitiveReference(b, node)],
          node,
        ),
        "boolean",
        node,
      );
      return operator === "==="
        ? equal
        : unarySlot("!", equal, "boolean", node);
    }
    const id = nextValue++;
    emit({
      kind: "binary",
      id,
      operator,
      left: load(left, node),
      right: load(right, node),
      start: node.start,
      end: node.end,
    });
    return save(
      id,
      ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(operator)
        ? "boolean"
        : "number",
      node,
    );
  }
  function conditionalStore(
    condition: number,
    slot: number,
    makeValue: () => number,
    node: Span,
  ): void {
    const yes = block(),
      merge = block();
    choose(load(condition, node), yes, merge, node);
    current = yes;
    store(slot, load(makeValue(), node), node);
    jump(merge.id, node);
    current = merge;
  }
  function logicalAssignment(
    old: number,
    node: Expression,
    write: (next: number) => void,
  ): number {
    if (
      node.kind !== "compound" ||
      (node.operator !== "&&" && node.operator !== "||")
    )
      throw "logical assignment invariant";
    const test = truth(old, node.target),
      right = block(),
      merge = block();
    const operation = shortCircuit(
      node.operator === "&&" ? "&&" : "||",
      old,
      right.id,
    );
    if (operation.evaluateRightWhen) choose(test, right, merge, node);
    else choose(test, merge, right, node);
    current = right;
    const next = value(node.value);
    store(old, load(next, node.value), node);
    write(load(old, node));
    jump(merge.id, node);
    current = merge;
    return old;
  }
  // Absent optional Number becomes NaN; string index kernels convert NaN to zero.
  function numericInput(slot: number, node: Span): number {
    const input = load(slot, node);
    if (slots[slot] !== "optional-number") return input;
    const id = nextValue++;
    emit({
      kind: "optional-value",
      id,
      value: input,
      start: node.start,
      end: node.end,
    });
    return id;
  }
  function integerIndex(input: number, node: Span): number {
    const index = unarySlot("trunc", input, "number", node),
      zero = numberSlot(0, node);
    conditionalStore(
      binarySlot("!==", index, index, node),
      index,
      () => zero,
      node,
    );
    return index;
  }
  function absoluteIndex(input: number, length: number, node: Span): number {
    const index = integerIndex(input, node),
      zero = numberSlot(0, node);
    // Math.max(position, 0) also replaces a truncated negative zero with +0.
    conditionalStore(
      binarySlot("<=", index, zero, node),
      index,
      () => zero,
      node,
    );
    conditionalStore(
      binarySlot(">", index, length, node),
      index,
      () => length,
      node,
    );
    return index;
  }
  function boundedStringEnd(
    argument: number | undefined,
    length: number,
    node: Span,
  ): number {
    let end = length;
    if (argument !== undefined) {
      end = absoluteIndex(
        save(numericInput(argument, node), "number", node),
        length,
        node,
      );
      if (slots[argument] === "optional-number") {
        const present = nextValue++;
        emit({
          kind: "optional-present",
          id: present,
          value: load(argument, node),
          start: node.start,
          end: node.end,
        });
        const absent = unarySlot(
          "!",
          save(present, "boolean", node),
          "boolean",
          node,
        );
        conditionalStore(absent, end, () => length, node);
      }
    }
    return end;
  }
  function relativeIndex(input: number, length: number, node: Span): number {
    const index = integerIndex(input, node),
      zero = numberSlot(0, node);
    conditionalStore(
      binarySlot("<", index, zero, node),
      index,
      () => binarySlot("+", index, length, node),
      node,
    );
    conditionalStore(
      binarySlot("<", index, zero, node),
      index,
      () => zero,
      node,
    );
    conditionalStore(
      binarySlot(">", index, length, node),
      index,
      () => length,
      node,
    );
    return index;
  }
  function relativeBound(
    argument: number | undefined,
    length: number,
    fallback: number,
    node: Span,
  ): number {
    if (argument === undefined || undefinedSlots[argument] === 1)
      return fallback;
    const result = relativeIndex(
      save(numericInput(argument, node), "number", node),
      length,
      node,
    );
    if (slots[argument] === "optional-number") {
      const present = nextValue++;
      emitPresence(present, load(argument, node), false, node);
      const absent = unarySlot(
        "!",
        save(present, "boolean", node),
        "boolean",
        node,
      );
      conditionalStore(absent, result, () => fallback, node);
    }
    return result;
  }
  // The caller has established an in-bounds UTF-16 index.
  function stringCodePoint(
    string: number,
    index: number,
    length: number,
    node: Span,
  ): number {
    const first = stringCodeUnit(string, index, node),
      result = save(load(first, node), "number", node),
      done = block();
    const checkLead = block(),
      checkNext = block(),
      readNext = block(),
      checkTrail = block(),
      combine = block();
    choose(
      load(binarySlot("<", first, numberSlot(55296, node), node), node),
      done,
      checkLead,
      node,
    );
    current = checkLead;
    choose(
      load(binarySlot(">", first, numberSlot(56319, node), node), node),
      done,
      checkNext,
      node,
    );
    current = checkNext;
    const next = binarySlot("+", index, numberSlot(1, node), node);
    choose(
      load(binarySlot(">=", next, length, node), node),
      done,
      readNext,
      node,
    );
    current = readNext;
    const second = stringCodeUnit(string, next, node);
    choose(
      load(binarySlot("<", second, numberSlot(56320, node), node), node),
      done,
      checkTrail,
      node,
    );
    current = checkTrail;
    choose(
      load(binarySlot(">", second, numberSlot(57343, node), node), node),
      done,
      combine,
      node,
    );
    current = combine;
    const high = binarySlot(
        "*",
        binarySlot("-", first, numberSlot(55296, node), node),
        numberSlot(1024, node),
        node,
      ),
      low = binarySlot("-", second, numberSlot(56320, node), node),
      point = binarySlot(
        "+",
        binarySlot("+", high, low, node),
        numberSlot(65536, node),
        node,
      );
    store(result, load(point, node), node);
    jump(done.id, node);
    current = done;
    return result;
  }
  /** Emit concatenation from rooted string slots and return the SSA value. */
  function emitStringConcat(left: number, right: number, node: Span): number {
    const id = nextValue++;
    emit({
      kind: "string-concat",
      id,
      left: load(left, node),
      right: load(right, node),
      start: node.start,
      end: node.end,
    });
    return id;
  }
  /** Make negative integer offsets relative to the end, without clamping. */
  function adjustNegativeIndex(
    index: number,
    length: number,
    node: Span,
  ): void {
    conditionalStore(
      binarySlot("<", index, numberSlot(0, node), node),
      index,
      () => binarySlot("+", index, length, node),
      node,
    );
  }
  // The caller proves a nonnegative integral count and bounded output size.
  function repeatString(
    receiver: number,
    count: number,
    length: number,
    node: Span,
  ): number {
    const zero = numberSlot(0, node);
    const result = codeUnits([], node),
      piece = save(load(receiver, node), "string", node);
    const head = block(),
      body = block(),
      append = block(),
      halve = block(),
      double = block(),
      done = block();
    choose(load(binarySlot("===", length, zero, node), node), done, head, node);
    current = head;
    choose(load(binarySlot(">", count, zero, node), node), body, done, node);
    current = body;
    choose(
      load(
        binarySlot(
          "===",
          binarySlot("%", count, numberSlot(2, node), node),
          numberSlot(1, node),
          node,
        ),
        node,
      ),
      append,
      halve,
      node,
    );
    current = append;
    store(result, emitStringConcat(result, piece, node), node);
    jump(halve.id, node);
    current = halve;
    store(
      count,
      load(
        unarySlot(
          "trunc",
          binarySlot("/", count, numberSlot(2, node), node),
          "number",
          node,
        ),
        node,
      ),
      node,
    );
    choose(load(binarySlot(">", count, zero, node), node), double, done, node);
    current = double;
    store(piece, emitStringConcat(piece, piece, node), node);
    jump(head.id, node);
    current = done;
    return result;
  }
  function readLength(
    receiver: number,
    source: Expression,
    kind: "list-length" | "string-length" | "array-length",
    node: Span,
  ): number {
    if (kind === "list-length")
      return listValue(listRuntime(source), "length", [receiver], node);
    if (kind === "array-length") return arrayLength(receiver, node);
    const id = nextValue++;
    emit({
      kind: "string-length",
      id,
      string: load(receiver, node),
      start: node.start,
      end: node.end,
    });
    return save(id, "number", node);
  }
  function stringCharacter(string: number, index: number, node: Span): number {
    const limit = binarySlot("+", index, numberSlot(1, node), node),
      id = nextValue++;
    emit({
      kind: "string-slice",
      id,
      string: load(string, node),
      begin: load(index, node),
      limit: coerce(load(limit, node), "optional-number", node),
      start: node.start,
      end: node.end,
    });
    return save(id, "string", node);
  }
  function stringCodeUnit(string: number, index: number, node: Span): number {
    const id = nextValue++;
    emit({
      kind: "string-code-unit",
      id,
      string: load(string, node),
      index: load(index, node),
      start: node.start,
      end: node.end,
    });
    return save(id, "number", node);
  }
  function codeUnits(values: readonly number[], node: Span): number {
    const id = nextValue++;
    emit({
      kind: "string-from-code-units",
      id,
      values: values.map((slot) => load(slot, node)),
      start: node.start,
      end: node.end,
    });
    return save(id, "string", node);
  }
  function arrayLength(array: number, node: Span): number {
    const id = nextValue++;
    emit({
      kind: "array-length",
      id,
      array: load(array, node),
      start: node.start,
      end: node.end,
    });
    return save(id, "number", node);
  }
  function requireRange(condition: number, node: Span): void {
    const yes = block(),
      no = block();
    choose(load(condition, node), yes, no, node);
    current = no;
    const message = nextValue++;
    emit({
      kind: "string-literal",
      id: message,
      value: "Invalid range",
      start: node.start,
      end: node.end,
    });
    const error = nextValue++;
    emit({
      kind: "error-new",
      error: "RangeError",
      id: error,
      message,
      start: node.start,
      end: node.end,
    });
    finish({
      kind: "throw",
      value: coerce(error, "general", node),
      start: node.start,
      end: node.end,
    });
    current = yes;
  }
  function setListLength(
    runtime: ListRuntime,
    receiver: number,
    length: number,
    node: Span,
  ): void {
    requireRange(unarySlot("is-integer", length, "boolean", node), node);
    requireRange(binarySlot(">=", length, numberSlot(0, node), node), node);
    requireRange(
      binarySlot("<=", length, numberSlot(0xffffffff, node), node),
      node,
    );
    listCall(runtime, "resize", [receiver, length], node);
  }
  // Both extents are validated by the caller; values convert at the destination store.
  function copyElements(
    source: number,
    destination: number,
    count: number,
    offset: number,
    sourceOffset: number,
    node: Span,
  ): void {
    const index = numberSlot(0, node),
      head = block(),
      body = block(),
      done = block();
    jump(head.id, node);
    current = head;
    choose(load(binarySlot("<", index, count, node), node), body, done, node);
    current = body;
    const read = nextValue++,
      element = nextValue++;
    emit({
      kind: "array-read",
      id: read,
      array: load(source, node),
      index: load(binarySlot("+", sourceOffset, index, node), node),
      start: node.start,
      end: node.end,
    });
    emit({
      kind: "optional-value",
      id: element,
      value: read,
      start: node.start,
      end: node.end,
    });
    emit({
      kind: "array-write",
      array: load(destination, node),
      index: load(binarySlot("+", offset, index, node), node),
      value: element,
      start: node.start,
      end: node.end,
    });
    store(
      index,
      load(binarySlot("+", index, numberSlot(1, node), node), node),
      node,
    );
    jump(head.id, node);
    current = done;
  }
  function invoke(
    target: number,
    argumentsSlots: number[],
    calleeSlot: number | undefined,
    receiver: number | undefined,
    node: Expression,
  ): number | undefined {
    const parameters = signatures[target]?.parameters;
    if (parameters === undefined) throw "call signature invariant";
    while (argumentsSlots.length < parameters.length) {
      if (
        ![
          "optional-number",
          "optional-boolean",
          "primitive",
          "optional-string",
          "optional-reference",
        ].includes(parameters[argumentsSlots.length] ?? "")
      )
        throw "omitted argument representation invariant";
      const missing = nextValue++;
      emit({
        kind: "undefined",
        id: missing,
        start: node.start,
        end: node.end,
      });
      argumentsSlots.push(save(missing, "optional-number", node));
    }
    const type = info(node).type,
      id = type === "void" ? undefined : nextValue++;
    const prepared = argumentsSlots.map((slot, i) => {
      const parameter = parameters[i];
      if (parameter === undefined) throw "call parameter invariant";
      if (slots[slot] === parameter) return slot;
      return save(coerce(load(slot, node), parameter, node), parameter, node);
    });
    const preparedReceiver =
      receiver === undefined
        ? undefined
        : save(coerce(load(receiver, node), "general", node), "general", node);
    const call = {
      ...(preparedReceiver === undefined
        ? {}
        : { receiver: load(preparedReceiver, node) }),
      id,
      target,
      arguments: prepared.map((slot) => load(slot, node)),
      start: node.start,
      end: node.end,
    };
    if (calleeSlot === undefined) emit({ kind: "call", ...call });
    else {
      const operation = callValue(load(calleeSlot, node), call.arguments);
      emit({
        kind: "call-indirect",
        ...call,
        callee: operation.callee,
        arguments: operation.arguments,
      });
    }
    return id === undefined || type === "void"
      ? undefined
      : save(id, type, node);
  }
  function recordAccess(
    object: number,
    transfer: number,
    operation: "read" | "write",
    access: RecordAccess,
    node: Span,
  ): void {
    if (access.choices.length === 0) throw "record dispatch invariant";
    if (access.functionEnvironment === true) {
      const environment = nextValue++;
      emit({
        kind: "function-environment",
        id: environment,
        callee: load(object, node),
        start: node.start,
        end: node.end,
      });
      object = save(environment, "optional-reference", node);
    }
    const merge = block();
    for (const choice of access.choices) {
      if (choice === undefined) throw "record choice invariant";
      const next = block(),
        converted = operation === "read" && choice.type !== access.type,
        success = converted ? block() : merge,
        slot = converted ? temporary(choice.type) : transfer;
      let physicalSlot = slot;
      if (operation === "write" && choice.type !== access.type) {
        physicalSlot = temporary(choice.type);
        store(physicalSlot, load(transfer, node), node);
      }
      let receiver = load(object, node);
      if (valueTypes[receiver] === "optional-reference") {
        const unwrapped = nextValue++;
        emitUnwrap(unwrapped, receiver, "reference", node);
        receiver = unwrapped;
      }
      const prototype = choice.prototype;
      if (operation === "read" && prototype !== undefined) {
        if (prototype.access.type !== access.type)
          throw "prototype result representation invariant";
        const receiverSlot = save(receiver, "reference", node),
          prototypeSlot = temporary("reference"),
          dispatch = block(),
          own = block(),
          inherited = block();
        // Guard the concrete shape before interpreting its presence byte or
        // prototype pointer. A different shape advances the outer dispatch.
        finish({
          kind: "record",
          object: load(receiverSlot, node),
          record: choice.record,
          field: prototype.field,
          operation: "read",
          slot: prototypeSlot,
          consequent: dispatch.id,
          alternate: next.id,
          start: node.start,
          end: node.end,
        });
        current = dispatch;
        const present = nextValue++;
        emit({
          kind: "record-has",
          id: present,
          object: load(receiverSlot, node),
          record: choice.record,
          field: choice.field,
          start: node.start,
          end: node.end,
        });
        choose(present, own, inherited, node);
        current = inherited;
        recordAccess(prototypeSlot, transfer, "read", prototype.access, node);
        jump(merge.id, node);
        current = own;
        receiver = load(receiverSlot, node);
      }
      const transferAccess = {
        object: receiver,
        record: choice.record,
        field: choice.field,
        operation,
        slot: physicalSlot,
        consequent: success.id,
        alternate: next.id,
        start: node.start,
        end: node.end,
      };
      finish(
        choice.initialized === true
          ? { kind: "record-cell", ...transferAccess }
          : { kind: "record", ...transferAccess },
      );
      if (converted) {
        current = success;
        let value = load(slot, node);
        if (choice.primitive) value = coerce(value, "primitive", node);
        if (
          (choice.type === "optional-number" && access.type === "number") ||
          (choice.type === "optional-string" && access.type === "string") ||
          (choice.type === "optional-reference" && access.type === "reference")
        ) {
          const extracted = nextValue++;
          emit(
            access.type === "number"
              ? {
                  kind: "optional-value",
                  id: extracted,
                  value,
                  start: node.start,
                  end: node.end,
                }
              : access.type === "string"
                ? {
                    kind: "string-value",
                    id: extracted,
                    value,
                    start: node.start,
                    end: node.end,
                  }
                : {
                    kind: "reference-value",
                    id: extracted,
                    value,
                    start: node.start,
                    end: node.end,
                  },
          );
          value = extracted;
        }
        store(transfer, value, node);
        jump(merge.id, node);
      }
      current = next;
    }
    finish({ kind: "trap", start: node.start, end: node.end });
    current = merge;
  }
  function mapRuntime(node: Expression): MapRuntime {
    const metadata = info(node);
    const runtime = (
      maps === undefined
        ? undefined
        : maps.find(
            (m) =>
              m !== undefined &&
              m.key === metadata.mapKey &&
              m.value === metadata.mapValue,
          )
    )?.runtime;
    if (runtime === undefined) throw "map runtime invariant";
    return runtime;
  }
  function setRuntime(node: Expression): SetRuntime {
    const element = info(node).setElement;
    const runtime = (
      sets === undefined
        ? undefined
        : sets.find((s) => s !== undefined && s.element === element)
    )?.runtime;
    if (runtime === undefined) throw "set runtime invariant";
    return runtime;
  }
  function listRuntime(node: Expression): ListRuntime {
    const element = info(node).listElement;
    const runtime = (
      lists === undefined
        ? undefined
        : lists.find((l) => l !== undefined && l.element === element)
    )?.runtime;
    if (runtime === undefined) throw "list runtime invariant";
    return runtime;
  }
  function listCall(
    runtime: ListRuntime,
    operation: ListOperation,
    args: readonly number[],
    node: Span,
  ): number | undefined {
    let target: number | undefined;
    switch (operation) {
      case "has":
        target = runtime.has;
        break;
      case "delete":
        target = runtime.delete;
        break;
      case "resize":
        target = runtime.resize;
        break;
      case "create":
        target = runtime.create;
        break;
      case "read":
        target = runtime.read;
        break;
      case "write":
        target = runtime.write;
        break;
      case "push":
        target = runtime.push;
        break;
      case "length":
        target = runtime.length;
        break;
    }
    if (target === undefined) throw "numeric list runtime invariant";
    return runtimeCall(target, args, node);
  }
  function runtimeCall(
    target: number,
    args: readonly number[],
    node: Span,
  ): number | undefined {
    const type = signatures[target]?.returnType;
    if (type === undefined) throw "numeric list signature invariant";
    const id = type === "void" ? undefined : nextValue++;
    const prepared = args.map((a, i): number => {
      const loaded = load(a, node);
      let value = coerce(loaded, signatures[target]?.parameters[i], node);
      if (
        i === 1 &&
        (valueTypes[value] === "primitive" ||
          valueTypes[value] === "optional-number") &&
        ((sets ?? []).some((binding) => binding.runtime.add === target) ||
          (maps ?? []).some((binding) => binding.runtime.set === target))
      ) {
        if (primitives === undefined) throw "primitive runtime invariant";
        if (valueTypes[value] === "optional-number")
          value = primitiveCall(
            primitives.canonicalOptionalNumber,
            [value],
            node,
          );
        else {
          const reference = primitiveCall(
            primitives.canonicalKey,
            [primitiveReference(value, node)],
            node,
          );
          value = nextValue++;
          emit({
            kind: "primitive-wrap",
            id: value,
            value: reference,
            start: node.start,
            end: node.end,
          });
        }
      }
      const valueType = valueTypes[value];
      if (valueType === undefined) throw "runtime argument type invariant";
      return value === loaded ? a : save(value, valueType, node);
    });
    emit({
      kind: "call",
      id,
      target,
      arguments: prepared.map((slot) => load(slot, node)),
      start: node.start,
      end: node.end,
    });
    return id === undefined || type === "void"
      ? undefined
      : save(id, type, node);
  }
  function callWithReceiver(
    target: number,
    receiver: number,
    args: readonly number[],
    node: Span,
  ): number | undefined {
    const argumentsWithReceiver = [receiver];
    for (const argument of args) {
      if (argument === undefined) throw "runtime argument invariant";
      argumentsWithReceiver.push(argument);
    }
    return runtimeCall(target, argumentsWithReceiver, node);
  }
  // Copying an absent indexed property deletes the destination property.
  function copyListElement(
    runtime: ListRuntime,
    source: number,
    destination: number,
    from: number,
    to: number,
    node: Span,
  ): void {
    const yes = block(),
      no = block(),
      merge = block();
    choose(
      load(listValue(runtime, "has", [source, from], node), node),
      yes,
      no,
      node,
    );
    current = yes;
    const item = listValue(runtime, "read", [source, from], node);
    listCall(runtime, "write", [destination, to, item], node);
    jump(merge.id, node);
    current = no;
    listCall(runtime, "delete", [destination, to], node);
    jump(merge.id, node);
    current = merge;
  }
  function listValue(
    runtime: ListRuntime,
    operation: ListOperation,
    args: readonly number[],
    node: Span,
  ): number {
    const result = listCall(runtime, operation, args, node);
    if (result === undefined) throw "numeric list value invariant";
    return result;
  }
  function nonNullish(left: number, node: Span): number {
    if (slots[left] === "general") {
      const result = temporary("boolean"),
        checkNull = block(),
        absent = block(),
        done = block();
      const none = nextValue++,
        isUndefined = nextValue++;
      emit({
        kind: "general-none",
        id: none,
        start: node.start,
        end: node.end,
      });
      emit({
        kind: "general-equal",
        id: isUndefined,
        left: load(left, node),
        right: none,
        start: node.start,
        end: node.end,
      });
      choose(isUndefined, absent, checkNull, node);
      current = absent;
      const no = nextValue++;
      emit({
        kind: "constant",
        id: no,
        value: false,
        start: node.start,
        end: node.end,
      });
      store(result, no, node);
      jump(done.id, node);
      current = checkNull;
      const nil = nextValue++,
        isNull = nextValue++,
        present = nextValue++;
      emit({ kind: "general-null", id: nil, start: node.start, end: node.end });
      emit({
        kind: "general-equal",
        id: isNull,
        left: load(left, node),
        right: nil,
        start: node.start,
        end: node.end,
      });
      emit({
        kind: "unary",
        id: present,
        operator: "!",
        operand: isNull,
        start: node.start,
        end: node.end,
      });
      store(result, present, node);
      jump(done.id, node);
      current = done;
      return load(result, node);
    }
    const reference = slots[left] === "optional-reference";
    const present = nextValue++;
    if (slots[left] === "primitive") {
      if (primitives === undefined) throw "primitive runtime invariant";
      const absent = primitiveCall(
        primitives.isNullish,
        [primitiveReference(load(left, node), node)],
        node,
      );
      emit({
        kind: "unary",
        id: present,
        operator: "!",
        operand: absent,
        start: node.start,
        end: node.end,
      });
    } else if (reference)
      emit({
        kind: "unary",
        operator: "truthy",
        id: present,
        operand: load(left, node),
        start: node.start,
        end: node.end,
      });
    else
      emitPresence(
        present,
        load(left, node),
        slots[left] === "optional-string",
        node,
      );
    return present;
  }
  function nullishValue(
    left: number,
    leftNode: Span,
    node: Expression,
    right: () => number,
  ): number {
    if (
      slots[left] === "number" ||
      slots[left] === "boolean" ||
      slots[left] === "reference" ||
      slots[left] === "string"
    )
      return left;
    if (undefinedSlots[left] === 1) return right();
    const reference = slots[left] === "optional-reference";
    const present = nonNullish(left, node);
    const yes = block(),
      no = block(),
      merge = block(),
      result = temporary(scalarType(node));
    choose(present, yes, no, node);
    current = yes;
    if (
      slots[left] === "primitive" ||
      slots[left] === "general" ||
      scalarType(node) === "optional-boolean" ||
      scalarType(node) === "optional-number" ||
      scalarType(node) === "optional-reference" ||
      scalarType(node) === "optional-string"
    )
      store(result, load(left, leftNode), node);
    else {
      const extracted = nextValue++;
      // Extract using the source carrier, then convert to the wider result.
      // For example, (string | undefined) ?? number produces an inline union.
      const carrier = slots[left];
      if (carrier === undefined) throw "nullish carrier invariant";
      const resultType = scalarType(node);
      const extractionType =
        reference &&
        ["Uint8Array", "Uint16Array", "Uint32Array", "Float64Array"].includes(
          resultType,
        )
          ? resultType
          : carrier;
      emitUnwrap(extracted, load(left, leftNode), extractionType, node);
      store(result, extracted, node);
    }
    jump(merge.id, node);
    current = no;
    store(result, load(right(), node), node);
    jump(merge.id, node);
    current = merge;
    return result;
  }
  function expression(node: Expression): number | undefined {
    const known = expressionOverrides.get(node);
    if (known !== undefined) return known;
    const result =
      info(node).chainType === undefined
        ? expressionValue(node)
        : chainExpression(node);
    if (info(node).never) {
      finish({ kind: "trap", start: node.start, end: node.end });
      // Continue syntactic lowering in a disconnected block; reachability
      // removes all following value plumbing before IR verification/emission.
      current = block();
      return undefined;
    }
    if (result !== undefined && info(node).undefinedValue)
      undefinedSlots[result] = 1;
    return result;
  }
  function chainExpression(node: Expression): number | undefined {
    const skipped = block(),
      merge = block(),
      outputType = info(node).type;
    const output = outputType === "void" ? undefined : temporary(outputType);
    function live(input: Expression): number | undefined {
      const metadata = info(input);
      const receiverCall =
        input.kind === "call" && metadata.builtin !== undefined;
      const operation =
        receiverCall && input.kind === "call" ? input.callee : input;
      if (
        operation.kind !== "member" &&
        operation.kind !== "index" &&
        operation.kind !== "call"
      )
        throw "optional chain operation invariant";
      const receiverNode =
        operation.kind === "call" ? operation.callee : operation.object;
      let receiver =
        info(receiverNode).chainType === undefined
          ? value(receiverNode)
          : live(receiverNode);
      if (receiver === undefined) throw "optional receiver invariant";
      const receiverType = slots[receiver];
      if (
        operation.optional &&
        (receiverType === "primitive" ||
          receiverType === "optional-reference" ||
          receiverType === "optional-string" ||
          receiverType === "optional-number" ||
          receiverType === "optional-boolean")
      ) {
        const present = nonNullish(receiver, input);
        const proceed = block();
        choose(present, proceed, skipped, input);
        current = proceed;
      }
      const liveReceiver = metadata.chainReceiverType;
      if (
        (receiverType === "optional-reference" &&
          (liveReceiver === "reference" ||
            liveReceiver === "Uint8Array" ||
            liveReceiver === "Uint16Array" ||
            liveReceiver === "Uint32Array" ||
            liveReceiver === "Float64Array")) ||
        (receiverType === "optional-string" && liveReceiver === "string")
      ) {
        const id = nextValue++;
        emitUnwrap(id, load(receiver, input), liveReceiver, input);
        receiver = save(id, liveReceiver, input);
      }
      if (receiverType === "primitive" && liveReceiver !== undefined) {
        receiver = save(
          coerce(load(receiver, input), liveReceiver, input),
          liveReceiver,
          input,
        );
      }
      const liveType = metadata.chainType;
      if (liveType === undefined) throw "optional live type invariant";
      expressionOverrides.set(receiverNode, receiver);
      informationOverrides.set(input, {
        ...metadata,
        type: liveType,
        chainType: undefined,
      });
      const result = expressionValue(input);
      informationOverrides.delete(input);
      expressionOverrides.delete(receiverNode);
      return result;
    }
    const result = live(node);
    if (output !== undefined) {
      if (result === undefined) throw "optional result invariant";
      store(output, load(result, node), node);
    }
    jump(merge.id, node);
    current = skipped;
    if (output !== undefined) {
      const absent = nextValue++;
      emit({ kind: "undefined", id: absent, start: node.start, end: node.end });
      undefinedValues[absent] = 1;
      store(output, absent, node);
    }
    jump(merge.id, node);
    current = merge;
    return output;
  }
  function ungroup(node: Expression): Expression {
    while (node.kind === "group" || node.kind === "satisfies")
      node = node.expression;
    return node;
  }
  function expressionValue(input: Expression): number | undefined {
    const node = input;
    const constant = info(node).constant;
    if (constant !== undefined) {
      const id = nextValue++;
      if (typeof constant === "string")
        emit({
          kind: "string-literal",
          id,
          value: constant,
          start: node.start,
          end: node.end,
        });
      else
        emit({
          kind: "constant",
          id,
          value: constant,
          start: node.start,
          end: node.end,
        });
      return save(id, scalarType(node), node);
    }
    switch (node.kind) {
      case "array": {
        const runtime = listRuntime(node);
        const list = listValue(
          runtime,
          "create",
          [numberSlot(node.elements.length, node)],
          node,
        );
        for (let i = 0; i < node.elements.length; i++) {
          const element = node.elements[i];
          if (element === undefined) throw "array literal invariant";
          if (element.kind === "elision") {
            const length = listValue(runtime, "length", [list], element);
            const next = binarySlot(
              "+",
              length,
              numberSlot(1, element),
              element,
            );
            listCall(runtime, "resize", [list, next], element);
          } else if (element.kind === "spread") {
            arrayValues(element.value, element, (item, _typed) => {
              listCall(runtime, "push", [list, item], element);
            });
          } else {
            const item = value(element);
            listCall(runtime, "push", [list, item], element);
          }
        }
        return list;
      }
      case "new": {
        const construction = records?.constructors?.get(node);
        if (construction !== undefined) {
          if (
            construction.entry.type !== "reference" ||
            signatures[construction.target]?.returnType !== "reference" ||
            info(node).type !== "reference"
          )
            throw "construction result representation invariant";
          const constructor = value(node.callee);
          // Preserve the callee while argument evaluation can rebind its source.
          // Internal entry validation happens only after argument side effects.
          const argumentsSlots = node.arguments.map(value);
          const entry = temporary("reference");
          recordAccess(constructor, entry, "read", construction.entry, node);
          return invoke(
            construction.target,
            argumentsSlots,
            entry,
            undefined,
            node,
          );
        }
        if (
          info(node).builtin === "type-error-new" ||
          info(node).builtin === "range-error-new"
        ) {
          const argument = node.arguments[0];
          let message: number;
          if (argument === undefined) {
            const id = nextValue++;
            emit({
              kind: "string-literal",
              id,
              value: "",
              start: node.start,
              end: node.end,
            });
            message = save(id, "string", node);
          } else message = value(argument);
          const id = nextValue++;
          emit({
            kind: "error-new",
            error:
              info(node).builtin === "range-error-new"
                ? "RangeError"
                : "TypeError",
            id,
            message: load(message, node),
            start: node.start,
            end: node.end,
          });
          return save(id, "reference", node);
        }

        if (info(node).builtin === "map-new")
          return runtimeCall(mapRuntime(node).create, [], node);
        if (info(node).builtin === "set-new") {
          const runtime = setRuntime(node),
            input = node.arguments[0],
            clone = runtime.clone;
          // Evaluate constructor arguments before allocation, as with ordinary calls.
          // arrayValues receives the already evaluated source through a saved slot.
          const source = input === undefined ? undefined : value(input);
          if (
            input !== undefined &&
            source !== undefined &&
            clone !== undefined &&
            info(input).setElement === info(node).setElement
          )
            return runtimeCall(clone, [source], node);
          const set = runtimeCall(runtime.create, [], node);
          if (set === undefined) throw "set constructor result invariant";
          if (input !== undefined && source !== undefined) {
            arrayValues(
              input,
              node,
              (item, typed) => {
                let element = item;
                if (typed) {
                  const extracted = nextValue++;
                  emit({
                    kind: "optional-value",
                    id: extracted,
                    value: load(item, node),
                    start: node.start,
                    end: node.end,
                  });
                  element = save(extracted, "number", node);
                }
                if (info(node).setElement === "number")
                  element = binarySlot("+", element, numberSlot(0, node), node);
                runtimeCall(runtime.add, [set, element], node);
              },
              source,
            );
          }
          return set;
        }
        const type = scalarType(node);
        if (
          info(node).builtin !== "array-new" ||
          (type !== "Uint8Array" &&
            type !== "Uint16Array" &&
            type !== "Uint32Array" &&
            type !== "Float64Array")
        )
          throw "array constructor contract invariant";
        const arg = node.arguments[0],
          input = arg === undefined ? numberSlot(0, node) : value(arg);
        const numericList =
          arg !== undefined && info(arg).listElement === "number"
            ? arg
            : undefined;
        const inputType = slots[input],
          copy =
            inputType === "Uint8Array" ||
            inputType === "Uint16Array" ||
            inputType === "Uint32Array" ||
            inputType === "Float64Array",
          length =
            numericList !== undefined
              ? listValue(listRuntime(numericList), "length", [input], node)
              : copy
                ? arrayLength(input, node)
                : integerIndex(
                    save(numericInput(input, node), "number", node),
                    node,
                  ),
          id = nextValue++;
        emit({
          kind: "array-new",
          id,
          type,
          length: load(length, node),
          start: node.start,
          end: node.end,
        });
        const result = save(id, type, node);
        if (numericList !== undefined) {
          const index = numberSlot(0, node);
          arrayValues(
            numericList,
            node,
            (item, _typed): void => {
              emit({
                kind: "array-write",
                array: load(result, node),
                index: load(index, node),
                value: numericInput(item, node),
                start: node.start,
                end: node.end,
              });
              store(
                index,
                load(binarySlot("+", index, numberSlot(1, node), node), node),
                node,
              );
            },
            input,
          );
        } else if (copy)
          copyElements(
            input,
            result,
            length,
            numberSlot(0, node),
            numberSlot(0, node),
            node,
          );
        return result;
      }
      case "object": {
        const recordOperations = records;
        const construction =
          recordOperations === undefined
            ? undefined
            : recordOperations.constructions.get(node);
        if (construction === undefined)
          throw "record construction contract invariant";
        const journal = new Map<
          string,
          {
            slot: number;
            present: number | undefined;
            logical: ScalarType;
            carrier: boolean;
          }[]
        >();
        function remember(
          name: string,
          slot: number,
          present: number | undefined,
          logical: ScalarType,
          carrier: boolean,
        ): void {
          let entries = journal.get(name);
          if (entries === undefined) {
            entries = [];
            journal.set(name, entries);
          }
          entries.push({ slot, present, logical, carrier });
        }
        function booleanSlot(flag: boolean): number {
          const id = nextValue++;
          emit({
            kind: "constant",
            id,
            value: flag,
            start: node.start,
            end: node.end,
          });
          return save(id, "boolean", node);
        }
        function optionalType(type: ScalarType): ScalarType {
          if (type === "general") return "general";
          if (type === "number" || type === "optional-number")
            return "optional-number";
          if (type === "boolean" || type === "optional-boolean")
            return "optional-boolean";
          if (type === "string" || type === "optional-string")
            return "optional-string";
          if (
            type === "reference" ||
            type === "optional-reference" ||
            type === "primitive"
          )
            return "optional-reference";
          throw "conditional spread carrier invariant";
        }
        function absent(type: ScalarType): number {
          const id = nextValue++;
          emit({ kind: "undefined", id, start: node.start, end: node.end });
          return save(id, type, node);
        }
        for (const property of node.properties) {
          if (property === undefined) throw "object property invariant";
          if (property.kind !== "spread") {
            const slot = value(property.value),
              type = slots[slot];
            if (type === undefined) throw "property value invariant";
            remember(property.name, slot, undefined, type, false);
            continue;
          }
          const source = value(property.value),
            registry =
              recordOperations === undefined
                ? undefined
                : recordOperations.spreads,
            properties =
              registry === undefined ? undefined : registry.get(property.value);
          if (properties === undefined) throw "spread contract invariant";
          for (const copied of properties) {
            if (copied === undefined) throw "spread property invariant";
            const logical = copied.access.type;
            if (copied.alwaysPresent) {
              const snapshot = temporary(logical);
              recordAccess(source, snapshot, "read", copied.access, property);
              remember(copied.name, snapshot, undefined, logical, false);
              continue;
            }
            const zero = numberSlot(0, property);
            let count = zero;
            for (const choice of copied.access.choices) {
              if (choice === undefined) throw "spread choice invariant";
              const id = nextValue++;
              emit({
                kind: "record-has",
                id,
                object: load(source, property),
                record: choice.record,
                field: choice.field,
                start: property.start,
                end: property.end,
              });
              const present = save(id, "boolean", property);
              count = binarySlot(
                "+",
                count,
                unarySlot("boolean-number", present, "number", property),
                property,
              );
            }
            const present = binarySlot(">", count, zero, property),
              snapshot = absent(optionalType(logical));
            const copy = block(),
              done = block();
            choose(load(present, property), copy, done, property);
            current = copy;
            const read = temporary(logical);
            recordAccess(source, read, "read", copied.access, property);
            store(snapshot, load(read, property), property);
            jump(done.id, property);
            current = done;
            remember(copied.name, snapshot, present, logical, true);
          }
        }
        function materializeField(field: ConstructionField): {
          value: number | undefined;
          present: number | undefined;
        } {
          const candidates = journal.get(field.name);
          if (candidates === undefined) {
            if (!field.optional) throw "required field evaluation invariant";
            return { value: undefined, present: undefined };
          }
          const result = temporary(field.type),
            present = field.optional ? temporary("boolean") : undefined;
          const done = block();
          let definite = false;
          for (let index = candidates.length - 1; index >= 0; index--) {
            const candidate = candidates[index];
            if (candidate === undefined) throw "field candidate invariant";
            const condition = candidate.present;
            const next = condition === undefined ? undefined : block();
            if (next !== undefined && condition !== undefined) {
              const yes = block();
              choose(load(condition, node), yes, next, node);
              current = yes;
            }
            let item = load(candidate.slot, node);
            if (candidate.carrier) {
              if (candidate.logical === "primitive")
                item = coerce(item, "primitive", node);
              else if (candidate.logical !== slots[candidate.slot]) {
                const unwrapped = nextValue++;
                emitUnwrap(unwrapped, item, candidate.logical, node);
                item = unwrapped;
              }
            }
            if (field.primitive) item = coerce(item, "primitive", node);
            const itemType = valueTypes[item];
            if (
              (itemType === "optional-string" && field.type === "string") ||
              (itemType === "optional-number" && field.type === "number") ||
              (itemType === "optional-boolean" && field.type === "boolean") ||
              (itemType === "optional-reference" && field.type === "reference")
            ) {
              const unwrapped = nextValue++;
              emitUnwrap(unwrapped, item, field.type, node);
              item = unwrapped;
            }
            store(result, item, node);
            if (present !== undefined)
              store(present, load(booleanSlot(true), node), node);
            jump(done.id, node);
            if (next === undefined) {
              definite = true;
              break;
            }
            current = next;
          }
          if (!definite) {
            if (field.optional) {
              store(result, load(absent(field.type), node), node);
              if (present !== undefined)
                store(present, load(booleanSlot(false), node), node);
              jump(done.id, node);
            } else finish({ kind: "trap", start: node.start, end: node.end });
          }
          current = done;
          return { value: result, present };
        }
        function construct(shape: RecordConstructionShape): number {
          const values: (number | undefined)[] = [],
            presence: (number | undefined)[] = [];
          for (const field of shape.fields) {
            if (field === undefined) throw "construction field invariant";
            const item = materializeField(field);
            values.push(item.value);
            presence.push(item.present);
          }
          const args = values.map((slot) =>
            slot === undefined ? undefined : load(slot, node),
          );
          const flags = presence.map((slot) =>
            slot === undefined ? undefined : load(slot, node),
          );
          const id = nextValue++;
          emit({
            kind: "record-new",
            id,
            record: shape.record,
            arguments: args,
            presence: flags,
            start: node.start,
            end: node.end,
          });
          return save(id, "reference", node);
        }
        const variants = construction.variants;
        if (variants === undefined) return construct(construction);
        const first = variants.find(
            (variant) => variant !== undefined && variant.tag !== undefined,
          ),
          name = construction.discriminant;
        if (first === undefined || name === undefined)
          throw "construction variant invariant";
        const nullable = variants.some(
          (variant) => variant !== undefined && variant.tag === undefined,
        );
        const inputType: ScalarType =
          typeof first.tag === "string"
            ? nullable
              ? "optional-string"
              : "string"
            : typeof first.tag === "number"
              ? nullable
                ? "optional-number"
                : "number"
              : nullable
                ? "optional-boolean"
                : "boolean";
        const selected = materializeField({
          name,
          type: inputType,
          optional: nullable,
        }).value;
        const input = selected === undefined ? absent(inputType) : selected;
        if (input === undefined) throw "discriminant value invariant";
        const output = temporary("reference"),
          done = block();
        for (const variant of variants) {
          if (variant === undefined) throw "construction variant invariant";
          const literal = nextValue++;
          const tagValue = variant.tag;
          if (tagValue === undefined)
            emit({
              kind: "undefined",
              id: literal,
              start: node.start,
              end: node.end,
            });
          else if (typeof tagValue === "string")
            emit({
              kind: "string-literal",
              id: literal,
              value: tagValue,
              start: node.start,
              end: node.end,
            });
          else
            emit({
              kind: "constant",
              id: literal,
              value: tagValue,
              start: node.start,
              end: node.end,
            });
          const tag = save(literal, slots[input] ?? "string", node);
          const matched = binarySlot("===", input, tag, node),
            yes = block(),
            next = block();
          choose(load(matched, node), yes, next, node);
          current = yes;
          store(output, load(construct(variant), node), node);
          jump(done.id, node);
          current = next;
        }
        finish({ kind: "trap", start: node.start, end: node.end });
        current = done;
        return output;
      }
      case "null": {
        if (scalarType(node) === "general") {
          const id = nextValue++;
          emit({ kind: "general-null", id, start: node.start, end: node.end });
          return save(id, "general", node);
        }
        if (primitives === undefined) throw "primitive runtime invariant";
        const reference = primitiveCall(primitives.fromNull, [], node);
        const id = nextValue++;
        emit({
          kind: "primitive-wrap",
          id,
          value: reference,
          start: node.start,
          end: node.end,
        });
        return save(id, "primitive", node);
      }
      case "number":
      case "boolean": {
        const id = nextValue++;
        emit({
          kind: "constant",
          id,
          value: node.value,
          start: node.start,
          end: node.end,
        });
        return save(id, scalarType(node), node);
      }
      case "this": {
        const local = info(node).local;
        if (local !== undefined)
          return save(
            coerce(readLocal(local, node), scalarType(node), node),
            scalarType(node),
            node,
          );
        if (receiverSlot === undefined)
          throw "receiver entry storage invariant";
        return save(
          coerce(load(receiverSlot, node), scalarType(node), node),
          scalarType(node),
          node,
        );
      }
      case "identifier": {
        const local = info(node).local;
        if (local === undefined) {
          const id = nextValue++;
          emit({ kind: "undefined", id, start: node.start, end: node.end });
          return save(id, "optional-number", node);
        }
        let read = readLocal(local, node);
        if (info(node).undefinedValue) {
          const absent = nextValue++;
          emit({
            kind: "undefined",
            id: absent,
            start: node.start,
            end: node.end,
          });
          return save(absent, "optional-number", node);
        }
        if (
          slots[local] === "optional-number" &&
          scalarType(node) === "number"
        ) {
          const extracted = nextValue++;
          emit({
            kind: "optional-value",
            id: extracted,
            value: read,
            start: node.start,
            end: node.end,
          });
          read = extracted;
        }
        if (
          (slots[local] === "optional-reference" &&
            scalarType(node) === "reference") ||
          (slots[local] === "optional-string" && scalarType(node) === "string")
        ) {
          const extracted = nextValue++;
          emitUnwrap(extracted, read, scalarType(node), node);
          read = extracted;
        }
        return save(
          coerce(read, scalarType(node), node),
          scalarType(node),
          node,
        );
      }
      case "function-expression":
      case "arrow": {
        const target = info(node).functionTarget;
        if (target === undefined) throw "function target invariant";
        return functionValue(target, node);
      }
      case "satisfies":
      case "group":
        return expression(node.expression);
      case "unary": {
        if (node.operator === "void") {
          expression(node.operand);
          const id = nextValue++;
          emit({ kind: "undefined", id, start: node.start, end: node.end });
          return save(id, "optional-number", node);
        }
        if (node.operator === "typeof") {
          const operand = expression(node.operand),
            type = info(node.operand).type;
          if (type === "general") {
            if (operand === undefined) throw "general typeof operand invariant";
            const id = nextValue++;
            emit({
              kind: "general-kind",
              id,
              value: load(operand, node),
              start: node.start,
              end: node.end,
            });
            return save(id, "string", node);
          }
          if (type === "primitive") {
            if (primitives === undefined || operand === undefined)
              throw "primitive typeof invariant";
            return save(
              primitiveCall(
                primitives.kindOf,
                [primitiveReference(load(operand, node), node)],
                node,
              ),
              "string",
              node,
            );
          }
          const result = temporary("string");
          function label(text: string): void {
            const id = nextValue++;
            emit({
              kind: "string-literal",
              id,
              value: text,
              start: node.start,
              end: node.end,
            });
            store(result, id, node);
          }
          if (
            type === "optional-boolean" ||
            type === "optional-number" ||
            type === "optional-reference" ||
            type === "optional-string"
          ) {
            if (operand === undefined)
              throw "typeof optional operand invariant";
            const id = nextValue++;
            if (type === "optional-reference")
              emit({
                kind: "unary",
                operator: "truthy",
                id,
                operand: load(operand, node.operand),
                start: node.start,
                end: node.end,
              });
            else
              emitPresence(
                id,
                load(operand, node.operand),
                type === "optional-string",
                node,
              );
            const yes = block(),
              no = block(),
              merge = block();
            choose(id, yes, no, node);
            current = yes;
            label(
              type === "optional-reference"
                ? "object"
                : type === "optional-boolean"
                  ? "boolean"
                  : type === "optional-string"
                    ? "string"
                    : "number",
            );
            jump(merge.id, node);
            current = no;
            label("undefined");
            jump(merge.id, node);
            current = merge;
          } else
            label(
              info(node).typeofFunction
                ? "function"
                : type === "void"
                  ? "undefined"
                  : type === "number" || type === "boolean" || type === "string"
                    ? type
                    : "object",
            );
          return result;
        }
        if (node.operator === "!" && info(node.operand).type === "primitive") {
          return unarySlot(
            "!",
            save(truth(value(node.operand), node), "boolean", node),
            "boolean",
            node,
          );
        }
        const operand = load(value(node.operand), node.operand),
          id = nextValue++;
        emit({
          kind: "unary",
          id,
          operator: node.operator,
          operand,
          start: node.start,
          end: node.end,
        });
        return save(id, scalarType(node), node);
      }
      case "index": {
        const reference = propertyReference(
          value(node.object),
          value(node.index),
        );
        const access =
          records === undefined ? undefined : records.accesses.get(node);
        if (access !== undefined) {
          const result = temporary(access.type);
          callReceivers.set(node, reference.base);
          recordAccess(reference.base, result, "read", access, node);
          return result;
        }
        const array = reference.base,
          index = reference.key,
          builtin = info(node).builtin;
        if (
          builtin === "list-length" ||
          builtin === "string-length" ||
          builtin === "array-length"
        )
          return readLength(array, node.object, builtin, node);
        if (builtin === "string-read") {
          const none = nextValue++;
          emit({
            kind: "string-none",
            id: none,
            start: node.start,
            end: node.end,
          });
          const result = save(none, "optional-string", node),
            checkLower = block(),
            checkUpper = block(),
            read = block(),
            done = block();
          choose(
            load(unarySlot("is-integer", index, "boolean", node), node),
            checkLower,
            done,
            node,
          );
          current = checkLower;
          choose(
            load(binarySlot("<", index, numberSlot(0, node), node), node),
            done,
            checkUpper,
            node,
          );
          current = checkUpper;
          const lengthId = nextValue++;
          emit({
            kind: "string-length",
            id: lengthId,
            string: load(array, node),
            start: node.start,
            end: node.end,
          });
          choose(
            load(
              binarySlot(">=", index, save(lengthId, "number", node), node),
              node,
            ),
            done,
            read,
            node,
          );
          current = read;
          store(
            result,
            coerce(
              load(stringCharacter(array, index, node), node),
              "optional-string",
              node,
            ),
            node,
          );
          jump(done.id, node);
          current = done;
          return result;
        }
        if (info(node).builtin === "list-read")
          return listValue(
            listRuntime(node.object),
            "read",
            [array, index],
            node,
          );
        const id = nextValue++;
        emit({
          kind: "array-read",
          id,
          array: load(array, node.object),
          index: load(index, node.index),
          start: node.start,
          end: node.end,
        });
        return save(id, "optional-number", node);
      }
      case "member": {
        if (info(node).undefinedValue) {
          value(node.object);
          const id = nextValue++;
          emit({ kind: "undefined", id, start: node.start, end: node.end });
          return save(id, "optional-number", node);
        }

        if (info(node).builtin === "map-size")
          return runtimeCall(mapRuntime(node).size, [value(node.object)], node);
        if (info(node).builtin === "set-size") {
          return runtimeCall(setRuntime(node).size, [value(node.object)], node);
        }
        const lengthKind = info(node).builtin;
        if (lengthKind === "list-length" || lengthKind === "string-length")
          return readLength(value(node.object), node.object, lengthKind, node);
        const access =
          records === undefined ? undefined : records.accesses.get(node);
        if (access !== undefined) {
          const object = value(node.object),
            result = temporary(access.type);
          callReceivers.set(node, object);
          recordAccess(object, result, "read", access, node);
          return result;
        }
        const array = value(node.object),
          id = nextValue++;
        const metadata = info(node).builtin;
        emit({
          kind:
            metadata === "array-buffer" ||
            metadata === "array-byte-offset" ||
            metadata === "array-byte-length"
              ? metadata
              : "array-length",
          id,
          array: load(array, node.object),
          start: node.start,
          end: node.end,
        });
        return save(
          id,
          metadata === "array-buffer" ? "reference" : "number",
          node,
        );
      }
      case "binary": {
        if (
          info(node).builtin === "type-error-is" ||
          info(node).builtin === "range-error-is"
        ) {
          const operand = coerce(load(value(node.left), node), "general", node),
            id = nextValue++;
          emit({
            kind: "error-is",
            error:
              info(node).builtin === "range-error-is"
                ? "RangeError"
                : "TypeError",
            id,
            value: operand,
            start: node.start,
            end: node.end,
          });
          return save(id, "boolean", node);
        }

        if (node.operator === ",") {
          expression(node.left);
          return expression(node.right);
        }
        if (node.operator === "??")
          return nullishValue(value(node.left), node.left, node, () =>
            value(node.right),
          );
        const left = value(node.left);
        if (node.operator === "&&" || node.operator === "||") {
          const result = temporary(scalarType(node));
          store(result, load(left, node.left), node);
          const test = truth(left, node.left),
            right = block(),
            merge = block();
          const operation = shortCircuit(
            node.operator === "&&" ? "&&" : "||",
            left,
            right.id,
          );
          if (operation.evaluateRightWhen) choose(test, right, merge, node);
          else choose(test, merge, right, node);
          current = right;
          const r = value(node.right);
          store(result, load(r, node.right), node);
          jump(merge.id, node);
          current = merge;
          return result;
        }
        const right = value(node.right);
        if (
          slots[left] === "general" ||
          slots[right] === "general" ||
          slots[left] === "primitive" ||
          slots[right] === "primitive"
        )
          return binarySlot(node.operator, left, right, node);
        if (node.operator === "+" && scalarType(node) === "string") {
          const a = stringOperand(left, node),
            b = stringOperand(right, node),
            id = emitStringConcat(a, b, node);
          return save(id, "string", node);
        }
        if (
          slots[left] === "string" &&
          slots[right] === "string" &&
          ["<", ">", "<=", ">="].includes(node.operator)
        ) {
          function lengthOf(string: number): number {
            const id = nextValue++;
            emit({
              kind: "string-length",
              id,
              string: load(string, node),
              start: node.start,
              end: node.end,
            });
            return save(id, "number", node);
          }
          function unitAt(string: number, index: number): number {
            const id = nextValue++;
            emit({
              kind: "string-code-unit",
              id,
              string: load(string, node),
              index: load(index, node),
              start: node.start,
              end: node.end,
            });
            return save(id, "number", node);
          }
          const leftLength = lengthOf(left),
            rightLength = lengthOf(right),
            comparison = binarySlot("-", leftLength, rightLength, node),
            index = numberSlot(0, node),
            zero = numberSlot(0, node),
            one = numberSlot(1, node),
            head = block(),
            checkRight = block(),
            compare = block(),
            different = block(),
            advance = block(),
            done = block();
          jump(head.id, node);
          current = head;
          choose(
            load(binarySlot("<", index, leftLength, node), node),
            checkRight,
            done,
            node,
          );
          current = checkRight;
          choose(
            load(binarySlot("<", index, rightLength, node), node),
            compare,
            done,
            node,
          );
          current = compare;
          const difference = binarySlot(
            "-",
            unitAt(left, index),
            unitAt(right, index),
            node,
          );
          choose(
            load(binarySlot("!==", difference, zero, node), node),
            different,
            advance,
            node,
          );
          current = different;
          store(comparison, load(difference, node), node);
          jump(done.id, node);
          current = advance;
          store(index, load(binarySlot("+", index, one, node), node), node);
          jump(head.id, node);
          current = done;
          return binarySlot(node.operator, comparison, zero, node);
        }
        const booleanComparison =
            slots[left] === "optional-boolean" ||
            slots[right] === "optional-boolean" ||
            (slots[left] === "boolean" && undefinedSlots[right] === 1) ||
            (slots[right] === "boolean" && undefinedSlots[left] === 1),
          stringComparison =
            slots[left] === "optional-string" ||
            slots[right] === "optional-string" ||
            (slots[left] === "string" && undefinedSlots[right] === 1) ||
            (slots[right] === "string" && undefinedSlots[left] === 1),
          referenceComparison =
            slots[left] === "optional-reference" ||
            slots[right] === "optional-reference" ||
            (slots[left] === "reference" && undefinedSlots[right] === 1) ||
            (slots[right] === "reference" && undefinedSlots[left] === 1),
          a = coerce(
            load(left, node.left),
            booleanComparison
              ? "optional-boolean"
              : stringComparison
                ? "optional-string"
                : referenceComparison
                  ? "optional-reference"
                  : slots[right] === "optional-number"
                    ? "optional-number"
                    : slots[left],
            node,
          ),
          b = coerce(
            load(right, node.right),
            booleanComparison
              ? "optional-boolean"
              : stringComparison
                ? "optional-string"
                : referenceComparison
                  ? "optional-reference"
                  : slots[left] === "optional-number"
                    ? "optional-number"
                    : slots[right],
            node,
          ),
          id = nextValue++;
        emit({
          kind: "binary",
          id,
          operator: node.operator,
          left: a,
          right: b,
          start: node.start,
          end: node.end,
        });
        return save(id, scalarType(node), node);
      }
      case "update":
      case "compound": {
        const target = ungroup(node.target);
        if (
          info(node).builtin === "list-resize" &&
          (target.kind === "member" || target.kind === "index")
        ) {
          const receiver = value(target.object),
            runtime = listRuntime(target.object);
          if (target.kind === "index") value(target.index);
          const old = listValue(runtime, "length", [receiver], node);
          if (node.kind === "compound" && node.operator === "??") return old;
          if (
            node.kind === "compound" &&
            (node.operator === "&&" || node.operator === "||")
          )
            return logicalAssignment(old, node, (next) =>
              setListLength(
                runtime,
                receiver,
                save(next, "number", node),
                node,
              ),
            );
          const right =
            node.kind === "compound" ? value(node.value) : numberSlot(1, node);
          const updated = binarySlot(
            node.kind === "compound"
              ? node.operator
              : node.operator === "++"
                ? "+"
                : "-",
            old,
            right,
            node,
          );
          setListLength(runtime, receiver, updated, node);
          return node.kind === "update" && !node.prefix ? old : updated;
        }
        const access =
          records === undefined ? undefined : records.accesses.get(target);
        if (
          (target.kind === "member" || target.kind === "index") &&
          access !== undefined
        ) {
          const object = value(target.object);
          if (target.kind === "index") value(target.index);
          const old = temporary(access.type);
          recordAccess(object, old, "read", access, target);
          if (node.kind === "compound" && node.operator === "??")
            return nullishValue(old, target, node, () => {
              const next = value(node.value),
                transfer = save(load(next, node.value), access.type, node);
              recordAccess(object, transfer, "write", access, target);
              return next;
            });
          if (
            node.kind === "compound" &&
            (node.operator === "&&" || node.operator === "||")
          )
            return logicalAssignment(old, node, (next) => {
              const transfer = save(next, access.type, node);
              recordAccess(object, transfer, "write", access, target);
            });
          if (access.type !== "number")
            throw "numeric property update contract invariant";
          const right =
            node.kind === "compound" ? value(node.value) : numberSlot(1, node);
          const updated = binarySlot(
            node.kind === "compound"
              ? node.operator
              : node.operator === "++"
                ? "+"
                : "-",
            old,
            right,
            node,
          );
          recordAccess(object, updated, "write", access, target);
          return node.kind === "update" && !node.prefix ? old : updated;
        }
        const local = info(node).local;
        if (local === undefined) throw "update local invariant";
        if (node.kind === "compound" && node.operator === "??") {
          const carrier = slots[local];
          if (carrier === undefined)
            throw "nullish assignment carrier invariant";
          const left = save(
            readLocal(local, node.target),
            carrier,
            node.target,
          );
          return nullishValue(left, node.target, node, () => {
            const next = value(node.value);
            writeLocal(local, load(next, node.value), node);
            return next;
          });
        }
        const string = scalarType(node) === "string";
        let read = readLocal(local, node.target);
        if (
          slots[local] === "optional-number" ||
          slots[local] === "optional-string" ||
          slots[local] === "optional-boolean"
        ) {
          const extracted = nextValue++;
          emitUnwrap(extracted, read, scalarType(node), node);
          read = extracted;
        }
        const old = save(read, scalarType(node), node.target);
        if (
          node.kind === "compound" &&
          (node.operator === "&&" || node.operator === "||")
        )
          return logicalAssignment(old, node, (next) =>
            writeLocal(local, next, node),
          );
        let right: number;
        if (node.kind === "compound") right = value(node.value);
        else {
          const one = nextValue++;
          emit({
            kind: "constant",
            id: one,
            value: 1,
            start: node.start,
            end: node.end,
          });
          right = save(one, "number", node);
        }
        const id = nextValue++;
        if (string)
          emit({
            kind: "string-concat",
            id,
            left: load(old, node),
            right: load(right, node),
            start: node.start,
            end: node.end,
          });
        else
          emit({
            kind: "binary",
            id,
            operator:
              node.kind === "compound"
                ? node.operator
                : node.operator === "++"
                  ? "+"
                  : "-",
            left: load(old, node),
            right: load(right, node),
            start: node.start,
            end: node.end,
          });
        const updated = save(id, string ? "string" : "number", node);
        writeLocal(local, load(updated, node), node);
        return node.kind === "update" && !node.prefix ? old : updated;
      }
      case "assignment": {
        const target = ungroup(node.target);
        if (
          info(node).builtin === "list-resize" &&
          (target.kind === "member" || target.kind === "index")
        ) {
          const receiver = value(target.object);
          if (target.kind === "index") value(target.index);
          const result = value(node.value);
          setListLength(listRuntime(target.object), receiver, result, node);
          return result;
        }
        const access =
          records === undefined ? undefined : records.accesses.get(target);
        if (
          (target.kind === "member" || target.kind === "index") &&
          access !== undefined
        ) {
          const object = value(target.object);
          if (target.kind === "index") value(target.index);
          const result = value(node.value);
          const transfer = save(load(result, node), access.type, node);
          recordAccess(object, transfer, "write", access, target);
          return result;
        }
        if (target.kind === "index") {
          const reference = propertyReference(
            value(target.object),
            value(target.index),
          );
          const array = reference.base,
            index = reference.key,
            result = value(node.value);
          if (info(node).builtin === "list-write") {
            listCall(
              listRuntime(target.object),
              "write",
              [array, index, result],
              node,
            );
            return result;
          }
          emit({
            kind: "array-write",
            array: load(array, target),
            index: load(index, target),
            value: load(result, node.value),
            start: node.start,
            end: node.end,
          });
          return result;
        }
        const result = value(node.value),
          local = info(node).local;
        if (local === undefined) throw "assignment invariant";
        writeLocal(local, load(result, node.value), node);
        return result;
      }
      case "conditional": {
        const yes = block(),
          no = block(),
          merge = block(),
          result = temporary(scalarType(node));
        chooseExpression(node.test, yes, no);
        current = yes;
        store(result, load(value(node.consequent), node.consequent), node);
        jump(merge.id, node);
        current = no;
        store(result, load(value(node.alternate), node.alternate), node);
        jump(merge.id, node);
        current = merge;
        return result;
      }
      case "template-expression": {
        const first = node.parts[0];
        if (
          first === undefined ||
          node.parts.length !== node.substitutions.length + 1
        )
          throw "template parts invariant";
        function part(text: string): number {
          const id = nextValue++;
          emit({
            kind: "string-literal",
            id,
            value: text,
            start: node.start,
            end: node.end,
          });
          return save(id, "string", node);
        }
        let result = part(first);
        for (let i = 0; i < node.substitutions.length; i++) {
          const substitution = node.substitutions[i],
            tail = node.parts[i + 1];
          if (substitution === undefined || tail === undefined)
            throw "template substitution invariant";
          const input = value(substitution);
          const converted = info(substitution).undefinedValue
            ? part("undefined")
            : info(substitution).nullValue
              ? part("null")
              : stringOperand(input, node);
          result = save(
            emitStringConcat(result, converted, node),
            "string",
            node,
          );
          result = save(
            emitStringConcat(result, part(tail), node),
            "string",
            node,
          );
        }
        return result;
      }
      case "call": {
        const builtin = info(node).builtin;
        if (builtin === "string-convert") {
          const argument = node.arguments[0];
          const input = argument === undefined ? undefined : value(argument);
          if (argument === undefined || info(argument).undefinedValue) {
            const id = nextValue++;
            emit({
              kind: "string-literal",
              id,
              value: argument === undefined ? "" : "undefined",
              start: node.start,
              end: node.end,
            });
            return save(id, "string", node);
          }
          if (input === undefined) throw "String argument invariant";
          return stringOperand(input, node);
        }
        if (builtin !== undefined && builtin !== "function-call") {
          const target = ungroup(node.callee);
          if (target.kind !== "member") throw "builtin target invariant";
          if (builtin === "math-min" || builtin === "math-max") {
            // Evaluate every argument before folding, even when an earlier one is NaN.
            const args = node.arguments.map(value),
              min = builtin === "math-min",
              result = numberSlot(min ? 1 / 0 : -1 / 0, node),
              zero = numberSlot(0, node),
              one = numberSlot(1, node),
              compare = min ? "<" : ">";
            for (const arg of args) {
              if (arg === undefined) throw "argument slot invariant";
              conditionalStore(
                binarySlot(compare, arg, result, node),
                result,
                () => arg,
                node,
              );
              conditionalStore(
                binarySlot("!==", arg, arg, node),
                result,
                () => arg,
                node,
              );
              // Ordinary comparisons consider both zeros equal. Compare reciprocals
              // only when both operands are zero to select the specified sign.
              const checkResult = block(),
                compareZeros = block(),
                done = block();
              choose(
                load(binarySlot("===", arg, zero, node), node),
                checkResult,
                done,
                node,
              );
              current = checkResult;
              choose(
                load(binarySlot("===", result, zero, node), node),
                compareZeros,
                done,
                node,
              );
              current = compareZeros;
              conditionalStore(
                binarySlot(
                  compare,
                  binarySlot("/", one, arg, node),
                  binarySlot("/", one, result, node),
                  node,
                ),
                result,
                () => arg,
                node,
              );
              jump(done.id, node);
              current = done;
            }
            return result;
          }
          if (builtin === "string-from-code-units")
            return codeUnits(node.arguments.map(value), node);
          if (builtin === "string-from-code-points") {
            const args = node.arguments.map(value);
            // Validate every numeric input before constructing any result chunks.
            for (const arg of args) {
              if (arg === undefined) throw "argument slot invariant";
              requireRange(unarySlot("is-integer", arg, "boolean", node), node);
              requireRange(
                binarySlot(">=", arg, numberSlot(0, node), node),
                node,
              );
              requireRange(
                binarySlot("<=", arg, numberSlot(0x10ffff, node), node),
                node,
              );
            }
            let result: number | undefined;
            for (const arg of args) {
              if (arg === undefined) throw "argument slot invariant";
              const unit = block(),
                pair = block(),
                merge = block(),
                piece = temporary("string");
              choose(
                load(
                  binarySlot("<", arg, numberSlot(0x10000, node), node),
                  node,
                ),
                unit,
                pair,
                node,
              );
              current = unit;
              store(piece, load(codeUnits([arg], node), node), node);
              jump(merge.id, node);
              current = pair;
              const adjusted = binarySlot(
                  "-",
                  arg,
                  numberSlot(0x10000, node),
                  node,
                ),
                high = unarySlot(
                  "trunc",
                  binarySlot("/", adjusted, numberSlot(1024, node), node),
                  "number",
                  node,
                ),
                low = binarySlot(
                  "-",
                  adjusted,
                  binarySlot("*", high, numberSlot(1024, node), node),
                  node,
                );
              store(
                piece,
                load(
                  codeUnits(
                    [
                      binarySlot("+", high, numberSlot(0xd800, node), node),
                      binarySlot("+", low, numberSlot(0xdc00, node), node),
                    ],
                    node,
                  ),
                  node,
                ),
                node,
              );
              jump(merge.id, node);
              current = merge;
              if (result === undefined) result = piece;
              else {
                const id = emitStringConcat(result, piece, node);
                result = save(id, "string", node);
              }
            }
            return result ?? codeUnits([], node);
          }
          if (
            builtin === "map-get" ||
            builtin === "map-has" ||
            builtin === "map-set" ||
            builtin === "map-delete" ||
            builtin === "map-clear"
          ) {
            const receiver = value(target.object),
              args = node.arguments.map(value),
              runtime = mapRuntime(node);
            const operation =
              builtin === "map-get"
                ? runtime.get
                : builtin === "map-has"
                  ? runtime.has
                  : builtin === "map-set"
                    ? runtime.set
                    : builtin === "map-delete"
                      ? runtime.delete
                      : runtime.clear;
            if (builtin === "map-set" && info(node).mapKey === "number") {
              const key = args[0];
              if (key === undefined) throw "map key invariant";
              args[0] = binarySlot("+", key, numberSlot(0, node), node);
            }
            const result = callWithReceiver(operation, receiver, args, node);
            return builtin === "map-set" ? receiver : result;
          }
          if (
            builtin === "set-has" ||
            builtin === "set-add" ||
            builtin === "set-delete" ||
            builtin === "set-clear"
          ) {
            const runtime = setRuntime(node);
            const receiver = value(target.object),
              args = node.arguments.map(value);
            const operation =
              builtin === "set-has"
                ? runtime.has
                : builtin === "set-add"
                  ? runtime.add
                  : builtin === "set-delete"
                    ? runtime.delete
                    : runtime.clear;
            if (builtin === "set-add" && info(node).setElement === "number") {
              const argument = args[0];
              if (argument === undefined) throw "set add argument invariant";
              args[0] = binarySlot("+", argument, numberSlot(0, node), node);
            }
            const result = callWithReceiver(operation, receiver, args, node);
            return builtin === "set-add" ? receiver : result;
          }
          if (
            builtin === "indexed-for-each" ||
            builtin === "list-filter" ||
            builtin === "list-map" ||
            builtin === "indexed-some" ||
            builtin === "indexed-every" ||
            builtin === "indexed-find" ||
            builtin === "indexed-find-index" ||
            builtin === "indexed-find-last" ||
            builtin === "indexed-find-last-index"
          ) {
            const each = builtin === "indexed-for-each";
            const reverse =
                builtin === "indexed-find-last" ||
                builtin === "indexed-find-last-index",
              findingIndex =
                builtin === "indexed-find-index" ||
                builtin === "indexed-find-last-index",
              findingValue =
                builtin === "indexed-find" || builtin === "indexed-find-last";
            const receiver = value(target.object);
            const argument = node.arguments[0];
            if (argument === undefined) throw "map callback invariant";
            const receiverType = slots[receiver];
            const typed =
              receiverType === "Uint8Array" ||
              receiverType === "Uint16Array" ||
              receiverType === "Uint32Array" ||
              receiverType === "Float64Array";
            const callback = value(argument),
              input = typed ? undefined : listRuntime(target.object),
              output =
                builtin === "list-map" || builtin === "list-filter"
                  ? listRuntime(node)
                  : undefined;
            const witness = info(node).callee;
            const signature =
              witness === undefined ? undefined : signatures[witness];
            if (witness === undefined || signature === undefined)
              throw "map signature invariant";
            const callbackResult = signature.returnType;

            const length =
              input === undefined
                ? arrayLength(receiver, node)
                : listValue(input, "length", [receiver], node);
            let mapped: number | undefined;
            if (each) mapped = undefined;
            else if (output !== undefined) {
              mapped = listValue(
                output,
                "create",
                [builtin === "list-filter" ? numberSlot(0, node) : length],
                node,
              );
            } else if (findingIndex) {
              mapped = numberSlot(-1, node);
            } else if (findingValue) {
              mapped = temporary(scalarType(node));
              const id = nextValue++;
              emit({ kind: "undefined", id, start: node.start, end: node.end });
              store(mapped, id, node);
            } else {
              const id = nextValue++;
              emit({
                kind: "constant",
                id,
                value: builtin === "indexed-every",
                start: node.start,
                end: node.end,
              });
              mapped = save(id, "boolean", node);
            }
            const filteredIndex =
              builtin === "list-filter" ? numberSlot(0, node) : undefined;
            const zero = numberSlot(0, node),
              index = reverse
                ? binarySlot("-", length, numberSlot(1, node), node)
                : numberSlot(0, node),
              head = block(),
              visit = block(),
              invoke = block(),
              advance = block(),
              done = block();
            jump(head.id, node);
            current = head;
            choose(
              load(
                binarySlot(
                  reverse ? ">=" : "<",
                  index,
                  reverse ? zero : length,
                  node,
                ),
                node,
              ),
              visit,
              done,
              node,
            );
            current = visit;
            if (typed || findingValue || findingIndex) jump(invoke.id, node);
            else {
              if (input === undefined) throw "list callback runtime invariant";
              choose(
                load(listValue(input, "has", [receiver, index], node), node),
                invoke,
                advance,
                node,
              );
            }
            current = invoke;
            let item: number;
            if (input === undefined) {
              const id = nextValue++;
              emit({
                kind: "array-read",
                id,
                array: load(receiver, node),
                index: load(index, node),
                start: node.start,
                end: node.end,
              });
              item = save(id, "optional-number", node);
            } else item = listValue(input, "read", [receiver, index], node);
            const args = [item, index, receiver];
            const values = signature.parameters.map((parameter, i): number => {
              const slot = args[i];
              if (slot === undefined) throw "map argument slot invariant";
              let id = load(slot, node);
              if (
                (slots[slot] === "optional-number" && parameter === "number") ||
                (slots[slot] === "optional-string" && parameter === "string") ||
                (slots[slot] === "optional-reference" &&
                  parameter === "reference")
              ) {
                const extracted = nextValue++;
                emitUnwrap(extracted, id, parameter, node);
                id = extracted;
              }
              return coerce(id, parameter, node);
            });
            const returned =
              callbackResult === "void" ? undefined : nextValue++;
            emit({
              kind: "call-indirect",
              id: returned,
              target: witness,
              callee: load(callback, node),
              arguments: values,
              start: node.start,
              end: node.end,
            });
            if (each) jump(advance.id, node);
            else {
              if (mapped === undefined) throw "callback result slot invariant";
              let result: number;
              if (returned === undefined || callbackResult === "void") {
                const id = nextValue++;
                emit({
                  kind: "undefined",
                  id,
                  start: node.start,
                  end: node.end,
                });
                result = save(id, "optional-number", node);
              } else result = save(returned, callbackResult, node);
              if (output !== undefined) {
                if (filteredIndex !== undefined) {
                  const keep = block();
                  choose(truth(result, node), keep, advance, node);
                  current = keep;
                  listCall(
                    output,
                    "write",
                    [mapped, filteredIndex, item],
                    node,
                  );
                  store(
                    filteredIndex,
                    load(
                      binarySlot("+", filteredIndex, numberSlot(1, node), node),
                      node,
                    ),
                    node,
                  );
                } else listCall(output, "write", [mapped, index, result], node);
                jump(advance.id, node);
              } else {
                const found = block();
                choose(
                  truth(result, node),
                  builtin === "indexed-every" ? advance : found,
                  builtin === "indexed-every" ? found : advance,
                  node,
                );
                current = found;
                if (findingIndex) store(mapped, load(index, node), node);
                else if (findingValue) store(mapped, load(item, node), node);
                else {
                  const id = nextValue++;
                  emit({
                    kind: "constant",
                    id,
                    value: builtin !== "indexed-every",
                    start: node.start,
                    end: node.end,
                  });
                  store(mapped, id, node);
                }
                jump(done.id, node);
              }
            }
            current = advance;
            store(
              index,
              load(
                binarySlot(
                  reverse ? "-" : "+",
                  index,
                  numberSlot(1, node),
                  node,
                ),
                node,
              ),
              node,
            );
            jump(head.id, node);
            current = done;
            // map writes indexes in order, so a dense source keeps the output
            // dense; the length captured at the start then covers trailing
            // holes (and sources a callback shortened).
            if (builtin === "list-map") {
              if (output === undefined || mapped === undefined)
                throw "map output invariant";
              listCall(output, "resize", [mapped, length], node);
            }
            return mapped;
          }
          if (builtin === "list-includes" && node.arguments.length === 1) {
            const elements = literalStrings(target.object),
              search = node.arguments[0];
            if (
              elements !== undefined &&
              search !== undefined &&
              scalarType(search) === "string"
            ) {
              const needle = value(search),
                initial = nextValue++;
              emit({
                kind: "constant",
                id: initial,
                value: false,
                start: node.start,
                end: node.end,
              });
              const result = save(initial, "boolean", node),
                found = block(),
                done = block();
              for (const element of elements) {
                if (element === undefined) throw "literal element invariant";
                const next = block();
                choose(
                  load(binarySlot("===", needle, value(element), node), node),
                  found,
                  next,
                  node,
                );
                current = next;
              }
              jump(done.id, node);
              current = found;
              const matched = nextValue++;
              emit({
                kind: "constant",
                id: matched,
                value: true,
                start: node.start,
                end: node.end,
              });
              store(result, matched, node);
              jump(done.id, node);
              current = done;
              return result;
            }
          }
          if (builtin === "list-includes" || builtin === "list-index-of") {
            const receiver = value(target.object),
              args = node.arguments.map(value),
              runtime = listRuntime(target.object);
            const search = args[0];
            if (search === undefined) throw "includes search invariant";
            const readType = signatures[runtime.read]?.returnType;
            if (readType === undefined || readType === "void")
              throw "includes read type invariant";
            const needle = save(
              coerce(load(search, node), readType, node),
              readType,
              node,
            );
            const length = listValue(runtime, "length", [receiver], node);
            const from = args[1];
            const index = relativeIndex(
              from === undefined
                ? numberSlot(0, node)
                : save(numericInput(from, node), "number", node),
              length,
              node,
            );
            const initial = nextValue++;
            emit({
              kind: "constant",
              id: initial,
              value: builtin === "list-index-of" ? -1 : false,
              start: node.start,
              end: node.end,
            });
            const result = save(
                initial,
                builtin === "list-index-of" ? "number" : "boolean",
                node,
              ),
              head = block(),
              body = block(),
              found = block(),
              advance = block(),
              done = block();
            jump(head.id, node);
            current = head;
            choose(
              load(binarySlot("<", index, length, node), node),
              body,
              done,
              node,
            );
            current = body;
            if (builtin === "list-index-of") {
              const read = block();
              choose(
                load(listValue(runtime, "has", [receiver, index], node), node),
                read,
                advance,
                node,
              );
              current = read;
            }
            const item = listValue(runtime, "read", [receiver, index], node);
            if (
              (readType === "optional-number" ||
                readType === "general" ||
                readType === "primitive") &&
              builtin !== "list-index-of"
            ) {
              const nan = block(),
                both = block();
              choose(
                load(binarySlot("===", item, needle, node), node),
                found,
                nan,
                node,
              );
              current = nan;
              choose(
                load(binarySlot("!==", item, item, node), node),
                both,
                advance,
                node,
              );
              current = both;
              choose(
                load(binarySlot("!==", needle, needle, node), node),
                found,
                advance,
                node,
              );
            } else
              choose(
                load(binarySlot("===", item, needle, node), node),
                found,
                advance,
                node,
              );
            current = found;
            if (builtin === "list-index-of")
              store(result, load(index, node), node);
            else {
              const yes = nextValue++;
              emit({
                kind: "constant",
                id: yes,
                value: true,
                start: node.start,
                end: node.end,
              });
              store(result, yes, node);
            }
            jump(done.id, node);
            current = advance;
            store(
              index,
              load(binarySlot("+", index, numberSlot(1, node), node), node),
              node,
            );
            jump(head.id, node);
            current = done;
            return result;
          }
          if (builtin === "list-pop") {
            const receiver = value(target.object),
              runtime = listRuntime(target.object);
            const length = listValue(runtime, "length", [receiver], node);
            const index = binarySlot("-", length, numberSlot(1, node), node);
            // The read contract returns undefined for invalid indices, including -1.
            const result = listValue(runtime, "read", [receiver, index], node);
            const shrink = block(),
              done = block();
            choose(
              load(binarySlot(">", length, numberSlot(0, node), node), node),
              shrink,
              done,
              node,
            );
            current = shrink;
            listCall(runtime, "resize", [receiver, index], node);
            jump(done.id, node);
            current = done;
            return result;
          }
          if (builtin === "list-join" || builtin === "array-join") {
            const receiver = value(target.object),
              args = node.arguments.map(value),
              runtime =
                builtin === "list-join"
                  ? listRuntime(target.object)
                  : undefined;
            function literal(text: string): number {
              const id = nextValue++;
              emit({
                kind: "string-literal",
                id,
                value: text,
                start: node.start,
                end: node.end,
              });
              return save(id, "string", node);
            }
            const separator = literal(",");
            const supplied = args[0];
            if (supplied !== undefined && undefinedSlots[supplied] !== 1) {
              if (slots[supplied] === "string")
                store(separator, load(supplied, node), node);
              else {
                const present = nextValue++;
                emit({
                  kind: "string-present",
                  id: present,
                  value: load(supplied, node),
                  start: node.start,
                  end: node.end,
                });
                const yes = block(),
                  merge = block();
                choose(present, yes, merge, node);
                current = yes;
                const extracted = nextValue++;
                emit({
                  kind: "string-value",
                  id: extracted,
                  value: load(supplied, node),
                  start: node.start,
                  end: node.end,
                });
                store(separator, extracted, node);
                jump(merge.id, node);
                current = merge;
              }
            }
            // Two passes over the elements: sum the separator and element
            // lengths, allocate the result once, then write every unit. A
            // concatenating loop copies its growing prefix per element, which
            // is quadratic in the joined length.
            const length =
              runtime === undefined
                ? arrayLength(receiver, node)
                : listValue(runtime, "length", [receiver], node);
            function lengthOf(string: number): number {
              const id = nextValue++;
              emit({
                kind: "string-length",
                id,
                string: load(string, node),
                start: node.start,
                end: node.end,
              });
              return save(id, "number", node);
            }
            function add(total: number, amount: number): void {
              store(
                total,
                load(binarySlot("+", total, amount, node), node),
                node,
              );
            }
            /** Visit the separator before each element after the first, and
             * each present element converted to a string. */
            function visitParts(visit: (part: number) => void): void {
              const index = numberSlot(0, node),
                zero = numberSlot(0, node);
              const head = block(),
                body = block(),
                exit = block();
              jump(head.id, node);
              current = head;
              choose(
                load(binarySlot("<", index, length, node), node),
                body,
                exit,
                node,
              );
              current = body;
              const delimiter = block(),
                element = block();
              choose(
                load(binarySlot(">", index, zero, node), node),
                delimiter,
                element,
                node,
              );
              current = delimiter;
              visit(separator);
              jump(element.id, node);
              current = element;
              let item: number;
              if (runtime === undefined) {
                const id = nextValue++;
                emit({
                  kind: "array-read",
                  id,
                  array: load(receiver, node),
                  index: load(index, node),
                  start: node.start,
                  end: node.end,
                });
                item = save(id, "optional-number", node);
              } else item = listValue(runtime, "read", [receiver, index], node);
              const present = nextValue++,
                string = slots[item] === "optional-string";
              emitPresence(present, load(item, node), string, node);
              const include = block(),
                advance = block();
              choose(present, include, advance, node);
              current = include;
              const extracted = nextValue++;
              const elementType = string
                ? "string"
                : slots[item] === "optional-boolean"
                  ? "boolean"
                  : "number";
              emitUnwrap(extracted, load(item, node), elementType, node);
              visit(stringOperand(save(extracted, elementType, node), node));
              jump(advance.id, node);
              current = advance;
              store(
                index,
                load(binarySlot("+", index, numberSlot(1, node), node), node),
                node,
              );
              jump(head.id, node);
              current = exit;
            }
            const total = numberSlot(0, node);
            visitParts((part) => add(total, lengthOf(part)));
            const allocated = nextValue++;
            emit({
              kind: "string-allocate",
              id: allocated,
              length: load(total, node),
              start: node.start,
              end: node.end,
            });
            const result = save(allocated, "string", node),
              offset = numberSlot(0, node);
            visitParts((part) => {
              emit({
                kind: "string-write",
                target: load(result, node),
                offset: load(offset, node),
                source: load(part, node),
                start: node.start,
                end: node.end,
              });
              add(offset, lengthOf(part));
            });
            return result;
          }
          if (builtin === "list-slice") {
            const receiver = value(target.object),
              args = node.arguments.map(value),
              runtime = listRuntime(target.object),
              output = listRuntime(node);
            const length = listValue(runtime, "length", [receiver], node),
              zero = numberSlot(0, node),
              one = numberSlot(1, node);
            const begin = relativeBound(args[0], length, zero, node),
              limit = relativeBound(args[1], length, length, node);
            const count = binarySlot("-", limit, begin, node);
            conditionalStore(
              binarySlot("<", count, zero, node),
              count,
              () => zero,
              node,
            );
            const result = listValue(output, "create", [count], node);
            listCall(output, "resize", [result, count], node);
            const index = numberSlot(0, node),
              head = block(),
              visit = block(),
              copy = block(),
              advance = block(),
              done = block();
            jump(head.id, node);
            current = head;
            choose(
              load(binarySlot("<", index, count, node), node),
              visit,
              done,
              node,
            );
            current = visit;
            const sourceIndex = binarySlot("+", begin, index, node);
            choose(
              load(
                listValue(runtime, "has", [receiver, sourceIndex], node),
                node,
              ),
              copy,
              advance,
              node,
            );
            current = copy;
            const item = listValue(
              runtime,
              "read",
              [receiver, sourceIndex],
              node,
            );
            listCall(output, "write", [result, index, item], node);
            jump(advance.id, node);
            current = advance;
            store(index, load(binarySlot("+", index, one, node), node), node);
            jump(head.id, node);
            current = done;
            return result;
          }
          if (builtin === "list-shift" || builtin === "list-unshift") {
            const receiver = value(target.object),
              args = node.arguments.map(value),
              runtime = listRuntime(target.object),
              zero = numberSlot(0, node),
              one = numberSlot(1, node),
              length = listValue(runtime, "length", [receiver], node),
              shifting = builtin === "list-shift";
            if (!shifting && args.length === 0) return length;
            const result = shifting
              ? listValue(runtime, "read", [receiver, zero], node)
              : binarySlot("+", length, numberSlot(args.length, node), node);
            if (!shifting)
              requireRange(
                binarySlot("<=", result, numberSlot(0xffffffff, node), node),
                node,
              );
            const index = shifting
                ? numberSlot(1, node)
                : save(load(length, node), "number", node),
              head = block(),
              body = block(),
              finishMove = block(),
              done = block();
            if (shifting)
              choose(
                load(binarySlot("===", length, zero, node), node),
                done,
                head,
                node,
              );
            else jump(head.id, node);
            current = head;
            choose(
              load(
                binarySlot(
                  shifting ? "<" : ">",
                  index,
                  shifting ? length : zero,
                  node,
                ),
                node,
              ),
              body,
              finishMove,
              node,
            );
            current = body;
            const from = shifting ? index : binarySlot("-", index, one, node),
              to = binarySlot(
                shifting ? "-" : "+",
                from,
                shifting ? one : numberSlot(args.length, node),
                node,
              );
            copyListElement(runtime, receiver, receiver, from, to, node);
            store(
              index,
              load(binarySlot(shifting ? "+" : "-", index, one, node), node),
              node,
            );
            jump(head.id, node);
            current = finishMove;
            if (shifting)
              listCall(
                runtime,
                "resize",
                [receiver, binarySlot("-", length, one, node)],
                node,
              );
            else {
              for (let i = 0; i < args.length; i++) {
                const item = args[i];
                if (item === undefined) throw "unshift argument invariant";
                listCall(
                  runtime,
                  "write",
                  [receiver, numberSlot(i, node), item],
                  node,
                );
              }
              listCall(runtime, "resize", [receiver, result], node);
            }
            jump(done.id, node);
            current = done;
            return result;
          }
          if (builtin === "list-splice") {
            const receiver = value(target.object),
              args = node.arguments.map(value);
            const runtime = listRuntime(target.object),
              zero = numberSlot(0, node),
              one = numberSlot(1, node);
            const length = listValue(runtime, "length", [receiver], node);
            const startArgument = args[0];
            const start = relativeIndex(
              startArgument === undefined
                ? zero
                : save(numericInput(startArgument, node), "number", node),
              length,
              node,
            );
            const available = binarySlot("-", length, start, node);
            const count =
              args.length === 0
                ? numberSlot(0, node)
                : args.length === 1
                  ? available
                  : integerIndex(
                      save(numericInput(args[1] ?? zero, node), "number", node),
                      node,
                    );
            conditionalStore(
              binarySlot("<", count, zero, node),
              count,
              () => zero,
              node,
            );
            conditionalStore(
              binarySlot(">", count, available, node),
              count,
              () => available,
              node,
            );
            const inserted = numberSlot(Math.max(0, args.length - 2), node);
            const newLength = binarySlot(
              "+",
              binarySlot("-", length, count, node),
              inserted,
              node,
            );
            requireRange(
              binarySlot("<=", newLength, numberSlot(4294967295, node), node),
              node,
            );
            const removed = listValue(runtime, "create", [zero], node);
            function copy(from: number, to: number, destination: number): void {
              copyListElement(runtime, receiver, destination, from, to, node);
            }
            function loop(
              index: number,
              condition: () => number,
              step: number,
              body: () => void,
            ): void {
              const head = block(),
                activeBody = block(),
                exit = block();
              jump(head.id, node);
              current = head;
              choose(load(condition(), node), activeBody, exit, node);
              current = activeBody;
              body();
              store(
                index,
                load(
                  binarySlot("+", index, numberSlot(step, node), node),
                  node,
                ),
                node,
              );
              jump(head.id, node);
              current = exit;
            }
            const k = numberSlot(0, node);
            loop(
              k,
              () => binarySlot("<", k, count, node),
              1,
              () => copy(binarySlot("+", start, k, node), k, removed),
            );
            listCall(runtime, "resize", [removed, count], node);
            const left = block(),
              rightTest = block(),
              right = block(),
              moved = block();
            choose(
              load(binarySlot("<", inserted, count, node), node),
              left,
              rightTest,
              node,
            );
            current = left;
            const i = save(load(start, node), "number", node);
            loop(
              i,
              () =>
                binarySlot("<", i, binarySlot("-", length, count, node), node),
              1,
              () =>
                copy(
                  binarySlot("+", i, count, node),
                  binarySlot("+", i, inserted, node),
                  receiver,
                ),
            );
            jump(moved.id, node);
            current = rightTest;
            choose(
              load(binarySlot(">", inserted, count, node), node),
              right,
              moved,
              node,
            );
            current = right;
            const j = binarySlot("-", length, count, node);
            loop(
              j,
              () => binarySlot(">", j, start, node),
              -1,
              () =>
                copy(
                  binarySlot("-", binarySlot("+", j, count, node), one, node),
                  binarySlot(
                    "-",
                    binarySlot("+", j, inserted, node),
                    one,
                    node,
                  ),
                  receiver,
                ),
            );
            jump(moved.id, node);
            current = moved;
            for (let index = 2; index < args.length; index++) {
              const item = args[index];
              if (item === undefined) throw "splice item invariant";
              listCall(
                runtime,
                "write",
                [
                  receiver,
                  binarySlot("+", start, numberSlot(index - 2, node), node),
                  item,
                ],
                node,
              );
            }
            listCall(runtime, "resize", [receiver, newLength], node);
            return removed;
          }
          if (builtin === "list-sort") {
            const receiver = value(target.object),
              argument = node.arguments[0];
            if (argument === undefined) throw "sort comparator invariant";
            const comparator = value(argument),
              helper = listRuntime(target.object).sort;
            if (helper === undefined) throw "sort runtime invariant";
            return runtimeCall(helper, [receiver, comparator], node);
          }
          if (builtin === "list-push") {
            const receiver = value(target.object),
              args = node.arguments.map(value);
            const runtime = listRuntime(target.object);
            // push() returns the new length: the last push's result, or the
            // current length when there is nothing to append.
            let result =
              args.length === 0
                ? listValue(runtime, "length", [receiver], node)
                : undefined;
            for (const arg of args) {
              if (arg === undefined) throw "push argument invariant";
              result = listValue(runtime, "push", [receiver, arg], node);
            }
            return result;
          }
          if (builtin === "array-set") {
            const destination = value(target.object),
              args = node.arguments.map(value),
              source = args[0];
            if (source === undefined) throw "set source invariant";
            const type = slots[source];
            if (
              type !== "Uint8Array" &&
              type !== "Uint16Array" &&
              type !== "Uint32Array" &&
              type !== "Float64Array"
            )
              throw "set element kind invariant";
            const zero = numberSlot(0, node),
              offset = integerIndex(
                save(numericInput(args[1] ?? zero, node), "number", node),
                node,
              );
            if (slots[destination] === type) {
              const copied = nextValue++;
              emit({
                kind: "array-copy",
                id: copied,
                array: load(destination, node),
                source: load(source, node),
                offset: load(offset, node),
                start: node.start,
                end: node.end,
              });
              requireRange(save(copied, "boolean", node), node);
              return undefined;
            }
            const length = arrayLength(source, node),
              capacity = arrayLength(destination, node);
            requireRange(binarySlot(">=", offset, zero, node), node);
            requireRange(binarySlot("<=", offset, capacity, node), node);
            requireRange(
              binarySlot(
                "<=",
                length,
                binarySlot("-", capacity, offset, node),
                node,
              ),
              node,
            );
            const work = block(),
              done = block();
            choose(
              load(binarySlot(">", length, zero, node), node),
              work,
              done,
              node,
            );
            current = work;
            const id = nextValue++;
            emit({
              kind: "array-new",
              id,
              type,
              length: load(length, node),
              start: node.start,
              end: node.end,
            });
            const snapshot = save(id, type, node);
            copyElements(source, snapshot, length, zero, zero, node);
            copyElements(snapshot, destination, length, offset, zero, node);
            jump(done.id, node);
            current = done;
            return undefined;
          }
          if (builtin === "array-subarray" || builtin === "array-slice") {
            const array = value(target.object),
              args = node.arguments.map(value),
              lengthId = nextValue++;
            emit({
              kind: "array-length",
              id: lengthId,
              array: load(array, node),
              start: node.start,
              end: node.end,
            });
            const length = save(lengthId, "number", node),
              zero = numberSlot(0, node);
            const begin = relativeBound(args[0], length, zero, node),
              limit = relativeBound(args[1], length, length, node);
            const count = binarySlot("-", limit, begin, node);
            conditionalStore(
              binarySlot("<", count, zero, node),
              count,
              () => zero,
              node,
            );
            if (builtin === "array-slice") {
              const type = slots[array];
              if (
                type !== "Uint8Array" &&
                type !== "Uint16Array" &&
                type !== "Uint32Array" &&
                type !== "Float64Array"
              )
                throw "slice receiver invariant";
              const id = nextValue++;
              emit({
                kind: "array-new",
                id,
                type,
                length: load(count, node),
                start: node.start,
                end: node.end,
              });
              const result = save(id, type, node);
              copyElements(array, result, count, zero, begin, node);
              return result;
            }
            const id = nextValue++;
            emit({
              kind: "array-subarray",
              id,
              array: load(array, node),
              begin: load(begin, node),
              length: load(count, node),
              start: node.start,
              end: node.end,
            });
            return save(id, scalarType(node), node);
          }
          if (builtin === "array-reverse" || builtin === "list-reverse") {
            const receiver = value(target.object),
              runtime =
                builtin === "list-reverse"
                  ? listRuntime(target.object)
                  : undefined,
              length =
                runtime === undefined
                  ? arrayLength(receiver, node)
                  : listValue(runtime, "length", [receiver], node),
              lower = numberSlot(0, node),
              upper = binarySlot("-", length, numberSlot(1, node), node),
              head = block(),
              body = block(),
              done = block();
            jump(head.id, node);
            current = head;
            choose(
              load(binarySlot("<", lower, upper, node), node),
              body,
              done,
              node,
            );
            current = body;
            if (runtime === undefined) {
              function read(index: number): number {
                const id = nextValue++,
                  element = nextValue++;
                emit({
                  kind: "array-read",
                  id,
                  array: load(receiver, node),
                  index: load(index, node),
                  start: node.start,
                  end: node.end,
                });
                emit({
                  kind: "optional-value",
                  id: element,
                  value: id,
                  start: node.start,
                  end: node.end,
                });
                return save(element, "number", node);
              }
              const left = read(lower),
                right = read(upper);
              emit({
                kind: "array-write",
                array: load(receiver, node),
                index: load(lower, node),
                value: load(right, node),
                start: node.start,
                end: node.end,
              });
              emit({
                kind: "array-write",
                array: load(receiver, node),
                index: load(upper, node),
                value: load(left, node),
                start: node.start,
                end: node.end,
              });
            } else {
              const leftPresent = listValue(
                  runtime,
                  "has",
                  [receiver, lower],
                  node,
                ),
                rightPresent = listValue(
                  runtime,
                  "has",
                  [receiver, upper],
                  node,
                ),
                left = listValue(runtime, "read", [receiver, lower], node),
                right = listValue(runtime, "read", [receiver, upper], node);
              function write(
                index: number,
                item: number,
                present: number,
              ): void {
                if (runtime === undefined) throw "reverse runtime invariant";
                const yes = block(),
                  no = block(),
                  merge = block();
                choose(load(present, node), yes, no, node);
                current = yes;
                listCall(runtime, "write", [receiver, index, item], node);
                jump(merge.id, node);
                current = no;
                listCall(runtime, "delete", [receiver, index], node);
                jump(merge.id, node);
                current = merge;
              }
              write(lower, right, rightPresent);
              write(upper, left, leftPresent);
            }
            store(
              lower,
              load(binarySlot("+", lower, numberSlot(1, node), node), node),
              node,
            );
            store(
              upper,
              load(binarySlot("-", upper, numberSlot(1, node), node), node),
              node,
            );
            jump(head.id, node);
            current = done;
            return receiver;
          }
          if (builtin === "array-at" || builtin === "list-at") {
            const receiver = value(target.object),
              args = node.arguments.map(value);
            const index = integerIndex(
              save(
                numericInput(args[0] ?? numberSlot(0, node), node),
                "number",
                node,
              ),
              node,
            );
            const runtime =
              builtin === "list-at" ? listRuntime(target.object) : undefined;
            const length =
              runtime === undefined
                ? arrayLength(receiver, node)
                : listValue(runtime, "length", [receiver], node);
            adjustNegativeIndex(index, length, node);
            const result = temporary(scalarType(node)),
              absent = nextValue++;
            emit({
              kind: "undefined",
              id: absent,
              start: node.start,
              end: node.end,
            });
            store(result, absent, node);
            const upper = block(),
              read = block(),
              done = block();
            choose(
              load(binarySlot("<", index, numberSlot(0, node), node), node),
              done,
              upper,
              node,
            );
            current = upper;
            choose(
              load(binarySlot(">=", index, length, node), node),
              done,
              read,
              node,
            );
            current = read;
            if (runtime === undefined) {
              const id = nextValue++;
              emit({
                kind: "array-read",
                id,
                array: load(receiver, node),
                index: load(index, node),
                start: node.start,
                end: node.end,
              });
              store(result, id, node);
            } else
              store(
                result,
                load(listValue(runtime, "read", [receiver, index], node), node),
                node,
              );
            jump(done.id, node);
            current = done;
            return result;
          }
          if (builtin === "string-split") {
            const string = value(target.object),
              args = node.arguments.map(value),
              runtime = listRuntime(node),
              zero = numberSlot(0, node),
              limit = numberSlot(0xffffffff, node),
              inputLimit = args[1];
            if (inputLimit !== undefined) {
              const convert: () => number = () =>
                binarySlot(
                  ">>>",
                  save(numericInput(inputLimit, node), "number", node),
                  zero,
                  node,
                );
              if (slots[inputLimit] === "optional-number") {
                const present = nextValue++;
                emit({
                  kind: "optional-present",
                  id: present,
                  value: load(inputLimit, node),
                  start: node.start,
                  end: node.end,
                });
                conditionalStore(
                  save(present, "boolean", node),
                  limit,
                  convert,
                  node,
                );
              } else store(limit, load(convert(), node), node);
            }
            const list = listValue(runtime, "create", [zero], node),
              work = block(),
              done = block();
            choose(
              load(binarySlot("===", limit, zero, node), node),
              done,
              work,
              node,
            );
            current = work;
            const separatorArgument = args[0];
            if (
              separatorArgument === undefined ||
              undefinedSlots[separatorArgument] === 1
            ) {
              listCall(runtime, "push", [list, string], node);
              jump(done.id, node);
              current = done;
              return list;
            }
            let separator: number = separatorArgument;
            if (slots[separator] === "optional-string") {
              const present = nextValue++;
              emit({
                kind: "string-present",
                id: present,
                value: load(separator, node),
                start: node.start,
                end: node.end,
              });
              const supplied = block(),
                absent = block();
              choose(present, supplied, absent, node);
              current = absent;
              listCall(runtime, "push", [list, string], node);
              jump(done.id, node);
              current = supplied;
              const extracted = nextValue++;
              emit({
                kind: "string-value",
                id: extracted,
                value: load(separator, node),
                start: node.start,
                end: node.end,
              });
              separator = save(extracted, "string", node);
            }
            function lengthOf(input: number): number {
              const id = nextValue++;
              emit({
                kind: "string-length",
                id,
                string: load(input, node),
                start: node.start,
                end: node.end,
              });
              return save(id, "number", node);
            }
            function append(begin: number, end: number): void {
              const id = nextValue++;
              emit({
                kind: "string-slice",
                id,
                string: load(string, node),
                begin: load(begin, node),
                limit: coerce(load(end, node), "optional-number", node),
                start: node.start,
                end: node.end,
              });
              listCall(runtime, "push", [list, save(id, "string", node)], node);
            }
            const length = lengthOf(string),
              width = lengthOf(separator),
              index = numberSlot(0, node),
              start = numberSlot(0, node),
              units = block(),
              delimited = block();
            choose(
              load(binarySlot("===", width, zero, node), node),
              units,
              delimited,
              node,
            );
            current = units;
            const unitHead = block(),
              unitLimit = block(),
              unitBody = block();
            jump(unitHead.id, node);
            current = unitHead;
            choose(
              load(binarySlot("<", index, length, node), node),
              unitLimit,
              done,
              node,
            );
            current = unitLimit;
            choose(
              load(
                binarySlot(
                  "<",
                  listValue(runtime, "length", [list], node),
                  limit,
                  node,
                ),
                node,
              ),
              unitBody,
              done,
              node,
            );
            current = unitBody;
            const next = binarySlot("+", index, numberSlot(1, node), node);
            append(index, next);
            store(index, load(next, node), node);
            jump(unitHead.id, node);
            current = delimited;
            const head = block(),
              search = block(),
              matched = block(),
              advance = block(),
              resume = block(),
              tail = block();
            jump(head.id, node);
            current = head;
            choose(
              load(binarySlot("<=", index, length, node), node),
              search,
              tail,
              node,
            );
            current = search;
            const match = nextValue++;
            emit({
              kind: "string-starts-with",
              id: match,
              string: load(string, node),
              search: load(separator, node),
              position: load(index, node),
              start: node.start,
              end: node.end,
            });
            choose(match, matched, advance, node);
            current = matched;
            append(start, index);
            choose(
              load(
                binarySlot(
                  ">=",
                  listValue(runtime, "length", [list], node),
                  limit,
                  node,
                ),
                node,
              ),
              done,
              resume,
              node,
            );
            current = resume;
            store(index, load(binarySlot("+", index, width, node), node), node);
            store(start, load(index, node), node);
            jump(head.id, node);
            current = advance;
            store(
              index,
              load(binarySlot("+", index, numberSlot(1, node), node), node),
              node,
            );
            jump(head.id, node);
            current = tail;
            append(start, length);
            jump(done.id, node);
            current = done;
            return list;
          }
          if (
            builtin === "string-includes" ||
            builtin === "string-index-of" ||
            builtin === "string-last-index-of"
          ) {
            const reverse = builtin === "string-last-index-of",
              indexResult = builtin !== "string-includes";
            const string = value(target.object),
              args = node.arguments.map(value),
              search = args[0];
            if (search === undefined) throw "search argument invariant";
            const lengthId = nextValue++;
            emit({
              kind: "string-length",
              id: lengthId,
              string: load(string, node),
              start: node.start,
              end: node.end,
            });
            const length = save(lengthId, "number", node),
              zero = numberSlot(0, node);
            const input = save(
              numericInput(args[1] ?? (reverse ? length : zero), node),
              "number",
              node,
            );
            if (reverse)
              conditionalStore(
                binarySlot("!==", input, input, node),
                input,
                () => length,
                node,
              );
            const index = absoluteIndex(input, length, node);
            const initial = nextValue++;
            emit({
              kind: "constant",
              id: initial,
              value: indexResult ? -1 : false,
              start: node.start,
              end: node.end,
            });
            const result = save(
                initial,
                indexResult ? "number" : "boolean",
                node,
              ),
              head = block(),
              body = block(),
              advance = block(),
              found = block(),
              done = block();
            jump(head.id, node);
            current = head;
            choose(
              load(
                binarySlot(
                  reverse ? ">=" : "<=",
                  index,
                  reverse ? zero : length,
                  node,
                ),
                node,
              ),
              body,
              done,
              node,
            );
            current = body;
            const match = nextValue++;
            emit({
              kind: "string-starts-with",
              id: match,
              string: load(string, node),
              search: load(search, node),
              position: load(index, node),
              start: node.start,
              end: node.end,
            });
            choose(match, found, advance, node);
            current = found;
            if (indexResult) store(result, load(index, node), node);
            else {
              const yes = nextValue++;
              emit({
                kind: "constant",
                id: yes,
                value: true,
                start: node.start,
                end: node.end,
              });
              store(result, yes, node);
            }
            jump(done.id, node);
            current = advance;
            store(
              index,
              load(
                binarySlot(
                  reverse ? "-" : "+",
                  index,
                  numberSlot(1, node),
                  node,
                ),
                node,
              ),
              node,
            );
            jump(head.id, node);
            current = done;
            return result;
          }
          if (builtin === "string-ends-with") {
            const string = value(target.object),
              args = node.arguments.map(value),
              search = args[0];
            if (search === undefined) throw "suffix argument invariant";
            const lengthId = nextValue++,
              widthId = nextValue++;
            emit({
              kind: "string-length",
              id: lengthId,
              string: load(string, node),
              start: node.start,
              end: node.end,
            });
            emit({
              kind: "string-length",
              id: widthId,
              string: load(search, node),
              start: node.start,
              end: node.end,
            });
            const length = save(lengthId, "number", node),
              width = save(widthId, "number", node);
            const end = boundedStringEnd(args[1], length, node);
            const initial = nextValue++;
            emit({
              kind: "constant",
              id: initial,
              value: false,
              start: node.start,
              end: node.end,
            });
            const start = binarySlot("-", end, width, node),
              result = save(initial, "boolean", node),
              compare = block(),
              done = block();
            choose(
              load(binarySlot("<", start, numberSlot(0, node), node), node),
              done,
              compare,
              node,
            );
            current = compare;
            const id = nextValue++;
            emit({
              kind: "string-starts-with",
              id,
              string: load(string, node),
              search: load(search, node),
              position: load(start, node),
              start: node.start,
              end: node.end,
            });
            store(result, id, node);
            jump(done.id, node);
            current = done;
            return result;
          }
          if (builtin === "string-starts-with") {
            const string = value(target.object),
              args = node.arguments.map(value),
              search = args[0];
            if (search === undefined) throw "prefix argument invariant";
            const position = numericInput(args[1] ?? numberSlot(0, node), node),
              id = nextValue++;
            emit({
              kind: "string-starts-with",
              id,
              string: load(string, node),
              search: load(search, node),
              position,
              start: node.start,
              end: node.end,
            });
            return save(id, "boolean", node);
          }
          if (builtin === "string-pad-start" || builtin === "string-pad-end") {
            const receiver = value(target.object),
              args = node.arguments.map(value),
              zero = numberSlot(0, node),
              desired = integerIndex(
                save(numericInput(args[0] ?? zero, node), "number", node),
                node,
              ),
              result = save(load(receiver, node), "string", node),
              lengthId = nextValue++;
            emit({
              kind: "string-length",
              id: lengthId,
              string: load(receiver, node),
              start: node.start,
              end: node.end,
            });
            const length = save(lengthId, "number", node),
              work = block(),
              done = block();
            choose(
              load(binarySlot("<=", desired, length, node), node),
              done,
              work,
              node,
            );
            current = work;
            const filler = codeUnits([numberSlot(32, node)], node),
              supplied = args[1];
            if (supplied !== undefined && undefinedSlots[supplied] !== 1) {
              if (slots[supplied] === "string")
                store(filler, load(supplied, node), node);
              else {
                const present = nextValue++,
                  yes = block(),
                  merge = block();
                emitPresence(present, load(supplied, node), true, node);
                choose(present, yes, merge, node);
                current = yes;
                const extracted = nextValue++;
                emitUnwrap(extracted, load(supplied, node), "string", node);
                store(filler, extracted, node);
                jump(merge.id, node);
                current = merge;
              }
            }
            const fillerLengthId = nextValue++;
            emit({
              kind: "string-length",
              id: fillerLengthId,
              string: load(filler, node),
              start: node.start,
              end: node.end,
            });
            const fillerLength = save(fillerLengthId, "number", node),
              pad = block();
            choose(
              load(binarySlot("===", fillerLength, zero, node), node),
              done,
              pad,
              node,
            );
            current = pad;
            requireRange(
              binarySlot(
                "<=",
                desired,
                numberSlot(maximumStringLength, node),
                node,
              ),
              node,
            );
            const needed = binarySlot("-", desired, length, node),
              count = unarySlot(
                "trunc",
                binarySlot("/", needed, fillerLength, node),
                "number",
                node,
              ),
              remainder = binarySlot("%", needed, fillerLength, node),
              padding = repeatString(filler, count, fillerLength, node),
              tail = nextValue++;
            emit({
              kind: "string-slice",
              id: tail,
              string: load(filler, node),
              begin: load(zero, node),
              limit: coerce(load(remainder, node), "optional-number", node),
              start: node.start,
              end: node.end,
            });
            store(
              padding,
              emitStringConcat(padding, save(tail, "string", node), node),
              node,
            );
            store(
              result,
              builtin === "string-pad-start"
                ? emitStringConcat(padding, receiver, node)
                : emitStringConcat(receiver, padding, node),
              node,
            );
            jump(done.id, node);
            current = done;
            return result;
          }
          if (builtin === "string-repeat") {
            const receiver = value(target.object),
              args = node.arguments.map(value);
            const count = integerIndex(
              save(
                numericInput(args[0] ?? numberSlot(0, node), node),
                "number",
                node,
              ),
              node,
            );
            const zero = numberSlot(0, node);
            requireRange(binarySlot(">=", count, zero, node), node);
            requireRange(
              binarySlot("<", count, numberSlot(Infinity, node), node),
              node,
            );
            const lengthId = nextValue++;
            emit({
              kind: "string-length",
              id: lengthId,
              string: load(receiver, node),
              start: node.start,
              end: node.end,
            });
            const length = save(lengthId, "number", node);
            requireRange(
              binarySlot(
                "<=",
                binarySlot("*", length, count, node),
                numberSlot(maximumStringLength, node),
                node,
              ),
              node,
            );
            return repeatString(receiver, count, length, node);
          }
          if (builtin === "string-concat") {
            let result = value(target.object);
            const args = node.arguments.map(value);
            for (const argument of args) {
              if (argument === undefined) throw "concat argument invariant";
              result = save(
                emitStringConcat(result, argument, node),
                "string",
                node,
              );
            }
            return result;
          }
          if (
            builtin === "string-trim" ||
            builtin === "string-trim-start" ||
            builtin === "string-trim-end"
          ) {
            const string = value(target.object),
              lengthId = nextValue++;
            emit({
              kind: "string-length",
              id: lengthId,
              string: load(string, node),
              start: node.start,
              end: node.end,
            });
            const begin = numberSlot(0, node),
              end = save(lengthId, "number", node);
            // ECMAScript WhiteSpace and LineTerminator are all BMP code points.
            // A range branch chain avoids allocating strings while scanning.
            function scan(reverse: boolean): void {
              const head = block(),
                body = block(),
                advance = block(),
                done = block();
              jump(head.id, node);
              current = head;
              choose(
                load(binarySlot("<", begin, end, node), node),
                body,
                done,
                node,
              );
              current = body;
              const index = reverse
                ? binarySlot("-", end, numberSlot(1, node), node)
                : begin;
              const code = stringCodeUnit(string, index, node);
              const ranges = [
                9, 13, 32, 32, 160, 160, 5760, 5760, 8192, 8202, 8232, 8233,
                8239, 8239, 8287, 8287, 12288, 12288, 65279, 65279,
              ];
              for (let i = 0; i < ranges.length; i += 2) {
                const low = ranges[i],
                  high = ranges[i + 1];
                if (low === undefined || high === undefined)
                  throw "whitespace range invariant";
                const next = block();
                if (low === high)
                  choose(
                    load(
                      binarySlot("===", code, numberSlot(low, node), node),
                      node,
                    ),
                    advance,
                    next,
                    node,
                  );
                else {
                  const upper = block();
                  choose(
                    load(
                      binarySlot(">=", code, numberSlot(low, node), node),
                      node,
                    ),
                    upper,
                    next,
                    node,
                  );
                  current = upper;
                  choose(
                    load(
                      binarySlot("<=", code, numberSlot(high, node), node),
                      node,
                    ),
                    advance,
                    next,
                    node,
                  );
                }
                current = next;
              }
              jump(done.id, node);
              current = advance;
              const bound = reverse ? end : begin;
              store(
                bound,
                load(
                  binarySlot(
                    reverse ? "-" : "+",
                    bound,
                    numberSlot(1, node),
                    node,
                  ),
                  node,
                ),
                node,
              );
              jump(head.id, node);
              current = done;
            }
            if (builtin !== "string-trim-end") scan(false);
            if (builtin !== "string-trim-start") scan(true);
            const id = nextValue++;
            emit({
              kind: "string-slice",
              id,
              string: load(string, node),
              begin: load(begin, node),
              limit: coerce(load(end, node), "optional-number", node),
              start: node.start,
              end: node.end,
            });
            return save(id, "string", node);
          }
          if (builtin === "string-substring") {
            const string = value(target.object),
              args = node.arguments.map(value),
              lengthId = nextValue++;
            emit({
              kind: "string-length",
              id: lengthId,
              string: load(string, node),
              start: node.start,
              end: node.end,
            });
            const length = save(lengthId, "number", node),
              begin = absoluteIndex(
                save(
                  numericInput(args[0] ?? numberSlot(0, node), node),
                  "number",
                  node,
                ),
                length,
                node,
              ),
              end = boundedStringEnd(args[1], length, node),
              swap = block(),
              done = block();
            choose(
              load(binarySlot(">", begin, end, node), node),
              swap,
              done,
              node,
            );
            current = swap;
            const original = load(begin, node);
            store(begin, load(end, node), node);
            store(end, original, node);
            jump(done.id, node);
            current = done;
            const id = nextValue++;
            emit({
              kind: "string-slice",
              id,
              string: load(string, node),
              begin: load(begin, node),
              limit: coerce(load(end, node), "optional-number", node),
              start: node.start,
              end: node.end,
            });
            return save(id, "string", node);
          }
          if (builtin === "string-slice") {
            const string = value(target.object),
              args = node.arguments.map(value);
            const begin = numericInput(args[0] ?? numberSlot(0, node), node);
            const limitArgument = args[1];
            let limit: number;
            if (limitArgument === undefined) {
              limit = nextValue++;
              emit({
                kind: "undefined",
                id: limit,
                start: node.start,
                end: node.end,
              });
            } else
              limit = coerce(
                load(limitArgument, node),
                "optional-number",
                node,
              );
            const id = nextValue++;
            emit({
              kind: "string-slice",
              id,
              string: load(string, node),
              begin,
              limit,
              start: node.start,
              end: node.end,
            });
            return save(id, "string", node);
          }
          if (
            builtin === "string-char-at" ||
            builtin === "string-at" ||
            builtin === "string-code-point"
          ) {
            const string = value(target.object),
              args = node.arguments.map(value),
              index = integerIndex(
                save(
                  numericInput(args[0] ?? numberSlot(0, node), node),
                  "number",
                  node,
                ),
                node,
              ),
              lengthId = nextValue++;
            emit({
              kind: "string-length",
              id: lengthId,
              string: load(string, node),
              start: node.start,
              end: node.end,
            });
            const length = save(lengthId, "number", node),
              zero = numberSlot(0, node);
            if (builtin === "string-at")
              adjustNegativeIndex(index, length, node);
            const type =
                builtin === "string-code-point"
                  ? "optional-number"
                  : builtin === "string-at"
                    ? "optional-string"
                    : "string",
              initial = nextValue++;
            if (builtin === "string-code-point")
              emit({
                kind: "undefined",
                id: initial,
                start: node.start,
                end: node.end,
              });
            else if (builtin === "string-at")
              emit({
                kind: "string-none",
                id: initial,
                start: node.start,
                end: node.end,
              });
            else
              emit({
                kind: "string-literal",
                id: initial,
                value: "",
                start: node.start,
                end: node.end,
              });
            const result = save(initial, type, node),
              checkUpper = block(),
              read = block(),
              done = block();
            choose(
              load(binarySlot("<", index, zero, node), node),
              done,
              checkUpper,
              node,
            );
            current = checkUpper;
            choose(
              load(binarySlot(">=", index, length, node), node),
              done,
              read,
              node,
            );
            current = read;
            if (builtin === "string-code-point") {
              const point = stringCodePoint(string, index, length, node);
              store(
                result,
                coerce(load(point, node), "optional-number", node),
                node,
              );
              jump(done.id, node);
              current = done;
              return result;
            }
            store(
              result,
              coerce(
                load(stringCharacter(string, index, node), node),
                type,
                node,
              ),
              node,
            );
            jump(done.id, node);
            current = done;
            return result;
          }
          if (builtin === "string-code-unit") {
            const string = value(target.object),
              first = node.arguments[0],
              index = first === undefined ? numberSlot(0, node) : value(first);
            return stringCodeUnit(
              string,
              save(numericInput(index, node), "number", node),
              node,
            );
          }
          const filling = builtin === "array-fill" || builtin === "list-fill";
          const array = filling ? value(target.object) : undefined;
          const args = node.arguments.map(value),
            first = args[0];
          if (first === undefined) throw "builtin argument invariant";
          if (
            builtin === "is-finite" ||
            builtin === "is-nan" ||
            builtin === "is-safe-integer" ||
            builtin === "is-integer"
          ) {
            function testNumber(input: number): number {
              if (builtin === "is-nan")
                return binarySlot("!==", input, input, node);
              if (builtin === "is-finite")
                return binarySlot(
                  "===",
                  binarySlot("-", input, input, node),
                  numberSlot(0, node),
                  node,
                );
              const result = unarySlot("is-integer", input, "boolean", node);
              if (builtin === "is-safe-integer") {
                conditionalStore(
                  result,
                  result,
                  () =>
                    binarySlot(
                      ">=",
                      input,
                      numberSlot(-9007199254740991, node),
                      node,
                    ),
                  node,
                );
                conditionalStore(
                  result,
                  result,
                  () =>
                    binarySlot(
                      "<=",
                      input,
                      numberSlot(9007199254740991, node),
                      node,
                    ),
                  node,
                );
              }
              return result;
            }
            if (
              slots[first] === "number" ||
              slots[first] === "optional-number"
            ) {
              const result = testNumber(
                save(numericInput(first, node), "number", node),
              );
              if (builtin === "is-nan" && slots[first] === "optional-number") {
                const present = nextValue++;
                emit({
                  kind: "optional-present",
                  id: present,
                  value: load(first, node),
                  start: node.start,
                  end: node.end,
                });
                const defined = save(present, "boolean", node);
                conditionalStore(result, result, () => defined, node);
              }
              return result;
            }
            const id = nextValue++;
            emit({
              kind: "constant",
              id,
              value: false,
              start: node.start,
              end: node.end,
            });
            const result = save(id, "boolean", node);
            if (slots[first] === "primitive" || slots[first] === "general") {
              let kind: number;
              if (slots[first] === "general") {
                kind = nextValue++;
                emit({
                  kind: "general-kind",
                  id: kind,
                  value: load(first, node),
                  start: node.start,
                  end: node.end,
                });
              } else {
                if (primitives === undefined)
                  throw "primitive predicate runtime invariant";
                kind = primitiveCall(
                  primitives.kindOf,
                  [primitiveReference(load(first, node), node)],
                  node,
                );
              }
              const label = nextValue++;
              emit({
                kind: "string-literal",
                id: label,
                value: "number",
                start: node.start,
                end: node.end,
              });
              const isNumber = binarySlot(
                "===",
                save(kind, "string", node),
                save(label, "string", node),
                node,
              );
              conditionalStore(
                isNumber,
                result,
                () =>
                  testNumber(
                    save(
                      coerce(load(first, node), "number", node),
                      "number",
                      node,
                    ),
                  ),
                node,
              );
            }
            return result;
          }
          if (builtin === "clz32") {
            const zero = numberSlot(0, node),
              word = binarySlot(">>>", first, zero, node),
              result = numberSlot(32, node),
              count = block(),
              done = block();
            choose(
              load(binarySlot("===", word, zero, node), node),
              done,
              count,
              node,
            );
            current = count;
            store(result, load(zero, node), node);
            for (let width = 16; width >= 1; width /= 2) {
              const shift = numberSlot(width, node),
                adjust = block(),
                next = block();
              choose(
                load(
                  binarySlot(
                    "===",
                    binarySlot(">>>", word, numberSlot(32 - width, node), node),
                    zero,
                    node,
                  ),
                  node,
                ),
                adjust,
                next,
                node,
              );
              current = adjust;
              store(
                result,
                load(binarySlot("+", result, shift, node), node),
                node,
              );
              store(
                word,
                load(binarySlot("<<", word, shift, node), node),
                node,
              );
              jump(next.id, node);
              current = next;
            }
            jump(done.id, node);
            current = done;
            return result;
          }
          if (builtin === "math-imul") {
            const second = args[1];
            if (second === undefined) throw "imul argument invariant";
            // One 32-bit multiply of the ToInt32 operands (see codegen).
            return binarySlot("imul", first, second, node);
          }
          if (builtin === "abs" || builtin === "sign") {
            const result = save(load(first, node), "number", node),
              zero = numberSlot(0, node);
            conditionalStore(
              binarySlot("<", first, zero, node),
              result,
              () =>
                builtin === "abs"
                  ? unarySlot("-", first, "number", node)
                  : numberSlot(-1, node),
              node,
            );
            if (builtin === "abs")
              conditionalStore(
                binarySlot("===", first, zero, node),
                result,
                () => zero,
                node,
              );
            else
              conditionalStore(
                binarySlot(">", first, zero, node),
                result,
                () => numberSlot(1, node),
                node,
              );
            return result;
          }
          if (builtin === "floor" || builtin === "round") {
            const result = unarySlot(
              "-",
              unarySlot(
                "ceil",
                unarySlot("-", first, "number", node),
                "number",
                node,
              ),
              "number",
              node,
            );
            if (builtin === "round") {
              // Avoid x + 0.5: that addition can round across a half-integer boundary.
              conditionalStore(
                binarySlot(
                  ">=",
                  binarySlot("-", first, result, node),
                  numberSlot(0.5, node),
                  node,
                ),
                result,
                () => binarySlot("+", result, numberSlot(1, node), node),
                node,
              );
              const negative = block(),
                done = block();
              choose(
                load(binarySlot("<", first, numberSlot(0, node), node), node),
                negative,
                done,
                node,
              );
              current = negative;
              conditionalStore(
                binarySlot("===", result, numberSlot(0, node), node),
                result,
                () => numberSlot(-0, node),
                node,
              );
              jump(done.id, node);
              current = done;
            }
            return result;
          }
          if (!filling)
            return unarySlot(
              builtin,
              first,
              builtin === "ceil" || builtin === "trunc" || builtin === "sqrt"
                ? "number"
                : "boolean",
              node,
            );
          if (array === undefined) throw "fill receiver invariant";
          const runtime =
            builtin === "list-fill" ? listRuntime(target.object) : undefined;
          const length =
              runtime === undefined
                ? arrayLength(array, node)
                : listValue(runtime, "length", [array], node),
            index = relativeBound(args[1], length, numberSlot(0, node), node),
            limit = relativeBound(args[2], length, length, node);
          const head = block(),
            body = block(),
            exit = block();
          jump(head.id, node);
          current = head;
          choose(
            load(binarySlot("<", index, limit, node), node),
            body,
            exit,
            node,
          );
          current = body;
          if (runtime === undefined) {
            emit({
              kind: "array-write",
              array: load(array, node),
              index: load(index, node),
              value: load(first, node),
              start: node.start,
              end: node.end,
            });
          } else listCall(runtime, "write", [array, index, first], node);
          store(
            index,
            load(binarySlot("+", index, numberSlot(1, node), node), node),
            node,
          );
          jump(head.id, node);
          current = exit;
          return array;
        }
        const receiverTarget = ungroup(node.callee);
        const explicitReceiver = builtin === "function-call";
        let calleeNode = node.callee;
        if (explicitReceiver) {
          if (receiverTarget.kind !== "member")
            throw "explicit call target invariant";
          calleeNode = receiverTarget.object;
        }
        const calleeSlot = info(node).indirect ? value(calleeNode) : undefined;
        const receiverArgument = explicitReceiver
          ? node.arguments[0]
          : undefined;
        const receiver = explicitReceiver
          ? receiverArgument === undefined
            ? undefined
            : value(receiverArgument)
          : callReceivers.get(receiverTarget);
        const args = explicitReceiver
          ? node.arguments.slice(1)
          : node.arguments;
        const argumentsSlots = args.map(value);
        const target = info(node).callee;
        if (target === undefined) throw "call invariant";
        return invoke(target, argumentsSlots, calleeSlot, receiver, node);
      }
      default:
        throw "unsupported checked expression invariant";
    }
  }
  function runFinalizers(target: number | undefined): void {
    const originalFinalizer = finalizer,
      originalException = exception;
    const destination =
      target === undefined ? undefined : blockFinalizers[target];
    let scope = finalizer;
    // A jump runs exactly the cleanup scopes it leaves. Comparing loop targets
    // cannot describe jumps past an enclosing loop to a more distant label.
    while (
      scope !== undefined &&
      scope !== destination &&
      current !== undefined
    ) {
      const cleanup = scope;
      finalizer = cleanup.parent;
      exception = cleanup.exception;
      statement(cleanup.body, cleanup.loop);
      scope = cleanup.parent;
    }
    finalizer = originalFinalizer;
    exception = originalException;
  }
  function iterationTarget(
    head: number,
    exit: number,
    named: readonly LabelTarget[],
  ): LoopTarget {
    for (const label of named) {
      if (label === undefined) throw "label target invariant";
      label.head = head;
    }
    return { head, exit };
  }
  function statement(
    input: Statement,
    loop: LoopTarget | undefined,
    named: readonly LabelTarget[] = [],
  ): void {
    const node = input;
    if (current === undefined) return;
    switch (node.kind) {
      case "label": {
        const exit = block();
        const target: LabelTarget = {
          name: node.name,
          exit: exit.id,
          head: undefined,
        };
        labels.push(target);
        const nested = named.slice();
        nested.push(target);
        statement(node.body, loop, nested);
        labels.pop();
        if (current !== undefined) jump(exit.id, node);
        current = exit;
        break;
      }
      case "block":
        allocateCells(node);
        hoistFunctions(node);
        for (const child of node.statements) {
          if (child === undefined) throw "block statement invariant";
          statement(child, loop);
          createSunkFunctions(child);
        }
        break;
      case "function":
        if (
          !(owned?.hoisted ?? []).some(
            (d) => d !== undefined && d.declaration === node,
          )
        )
          throw "function hoisting contract invariant";
        break;
      case "debugger":
      case "empty":
        break;
      case "variable":
        for (const d of node.declarations) {
          if (d === undefined) throw "declaration invariant";
          if (d.kind === "object-binding" || d.kind === "array-binding")
            throw "unchecked binding pattern";
          const local = fn.declarations.get(d);
          if (local === undefined) throw "binding invariant";
          const initializer = d.initializer;
          if (initializer !== undefined)
            writeLocal(local.id, load(value(initializer), initializer), d);
          else if (
            node.mode !== "var" &&
            [
              "optional-number",
              "optional-boolean",
              "primitive",
              "general",
              "optional-string",
              "optional-reference",
            ].includes(local.type)
          ) {
            const id = nextValue++;
            emit({ kind: "undefined", id, start: d.start, end: d.end });
            writeLocal(local.id, id, d);
          }
        }
        break;
      case "expression":
        expression(node.expression);
        break;
      case "try": {
        const handler = node.handler,
          cleanup = node.finalizer;
        const outer = exception,
          parent = finalizer;
        const caught = block(),
          merge = block(),
          body = block();
        const cleanupThrow = cleanup === undefined ? undefined : block();
        const pending =
          cleanup === undefined ? undefined : temporary("general");
        const binding = handler?.binding;
        let local: Local | undefined;
        if (binding !== undefined) {
          if (
            binding.kind === "object-binding" ||
            binding.kind === "array-binding"
          )
            throw "unchecked catch pattern";
          local = fn.declarations.get(binding);
        }
        const caughtSlot =
          local === undefined ? temporary("general") : local.id;
        const cleanupException =
          cleanupThrow === undefined || pending === undefined
            ? outer
            : { target: cleanupThrow.id, slot: pending };
        const scope: FinallyScope | undefined =
          cleanup === undefined
            ? parent
            : { body: cleanup, loop, exception: outer, parent };
        blockFinalizers[body.id] = scope;
        blockFinalizers[caught.id] = scope;
        jump(body.id, node);
        exception =
          handler === undefined
            ? cleanupException
            : { target: caught.id, slot: caughtSlot };
        finalizer = scope;
        current = body;
        statement(node.body, loop);
        if (current !== undefined) jump(merge.id, node);
        if (handler !== undefined) {
          exception = cleanupException;
          current = caught;
          if (local !== undefined) cellAccess(local.id, "initialize", handler);
          statement(handler.body, loop);
          if (current !== undefined) jump(merge.id, node);
        } else
          caught.terminator = {
            kind: "trap",
            start: node.start,
            end: node.end,
          };
        exception = outer;
        finalizer = parent;
        if (
          cleanupThrow !== undefined &&
          pending !== undefined &&
          cleanup !== undefined
        ) {
          current = cleanupThrow;
          statement(cleanup, loop);
          if (current !== undefined)
            finish({
              kind: "throw",
              value: load(pending, node),
              start: node.start,
              end: node.end,
            });
        }
        current = merge;
        if (cleanup !== undefined) statement(cleanup, loop);
        break;
      }
      case "throw": {
        const thrownExpression = node.expression;
        if (thrownExpression.kind === "string") {
          finish({
            kind: "throw-literal",
            value: thrownExpression.value,
            start: node.start,
            end: node.end,
          });
          break;
        }
        const thrown = coerce(
          load(value(node.expression), node.expression),
          "general",
          node,
        );
        finish({
          kind: "throw",
          value: thrown,
          start: node.start,
          end: node.end,
        });
        break;
      }
      case "return": {
        let result =
          node.expression === undefined
            ? undefined
            : expression(node.expression);
        const resultType = fn.returnType;
        if (result === undefined && resultType !== "void") {
          const id = nextValue++;
          emit({ kind: "undefined", id, start: node.start, end: node.end });
          result = save(coerce(id, resultType, node), resultType, node);
        }
        const saved =
          result === undefined || resultType === "void"
            ? undefined
            : finalizer === undefined
              ? result
              : save(
                  coerce(load(result, node), resultType, node),
                  resultType,
                  node,
                );
        runFinalizers(undefined);
        if (current !== undefined)
          finish({
            kind: "return",
            value: saved === undefined ? undefined : load(saved, node),
            start: node.start,
            end: node.end,
          });
        break;
      }
      case "if": {
        const yes = block(),
          no = block();
        chooseExpression(node.test, yes, no);
        current = yes;
        statement(node.consequent, loop);
        const yesEnd = current;
        current = no;
        if (node.alternate !== undefined) statement(node.alternate, loop);
        const noEnd = current;
        if (yesEnd === undefined && noEnd === undefined) {
          current = undefined;
          break;
        }
        const merge = block();
        if (yesEnd !== undefined) {
          current = yesEnd;
          jump(merge.id, node);
        }
        if (noEnd !== undefined) {
          current = noEnd;
          jump(merge.id, node);
        }
        current = merge;
        break;
      }
      case "switch": {
        const input = value(node.expression),
          exit = block(),
          bodies = node.clauses.map(() => block());
        allocateCells(node);
        hoistFunctions(node);
        let fallback = exit;
        for (let i = 0; i < node.clauses.length; i++) {
          const clause = node.clauses[i],
            body = bodies[i];
          if (clause === undefined || body === undefined)
            throw "switch lowering invariant";
          if (clause.test === undefined) {
            fallback = body;
            continue;
          }
          const test = value(clause.test),
            id = nextValue++,
            a = coerce(
              load(input, node),
              slots[test] === "optional-number"
                ? "optional-number"
                : slots[input],
              node,
            ),
            b = coerce(
              load(test, node),
              slots[input] === "optional-number"
                ? "optional-number"
                : slots[test],
              node,
            );
          emit({
            kind: "binary",
            operator: "===",
            id,
            left: a,
            right: b,
            start: clause.start,
            end: clause.end,
          });
          const next = block();
          choose(id, body, next, clause);
          current = next;
        }
        const exhaustiveSwitches = fn.exhaustiveSwitches;
        if (
          fallback === exit &&
          exhaustiveSwitches !== undefined &&
          exhaustiveSwitches.has(node)
        )
          finish({ kind: "trap", start: node.start, end: node.end });
        else jump(fallback.id, node);
        for (let i = 0; i < node.clauses.length; i++) {
          const clause = node.clauses[i],
            body = bodies[i];
          if (clause === undefined || body === undefined)
            throw "switch body invariant";
          current = body;
          for (const child of clause.statements) {
            if (child === undefined) throw "switch statement invariant";
            statement(child, { head: loop?.head, exit: exit.id });
          }
          if (current !== undefined) jump(bodies[i + 1]?.id ?? exit.id, clause);
        }
        const incoming = blocks.some((b): boolean => {
          if (b === undefined) throw "block builder invariant";
          const t = b.terminator;
          return t?.kind === "jump"
            ? t.target === exit.id
            : t?.kind === "branch" || t?.kind === "record"
              ? t.consequent === exit.id || t.alternate === exit.id
              : false;
        });
        current = exit;
        if (!incoming)
          finish({ kind: "trap", start: node.start, end: node.end });
        break;
      }
      case "for-of": {
        const binding = node.binding;
        if (binding.kind === "object-binding")
          throw "unchecked iteration pattern";
        if (binding.kind === "array-binding") {
          const runtime = mapRuntime(node.iterable).iterator;
          if (runtime === undefined) throw "map iterator runtime invariant";
          allocateCells(node);
          const receiver = value(node.iterable),
            cursor = runtimeCall(runtime.create, [receiver], node);
          if (cursor === undefined) throw "map cursor result invariant";
          const head = block(),
            body = block(),
            exit = block();
          jump(head.id, node);
          current = head;
          const next = runtimeCall(runtime.advance, [cursor], node);
          if (next === undefined) throw "map advance result invariant";
          choose(load(next, node), body, exit, node);
          current = body;
          allocateCells(node);
          for (let index = 0; index < binding.elements.length; index++) {
            const element = binding.elements[index];
            if (element === undefined) continue;
            if (
              element.kind === "object-binding" ||
              element.kind === "array-binding"
            )
              throw "unchecked nested iteration binding";
            const local = fn.declarations.get(element);
            if (local === undefined) throw "map binding invariant";
            if (index < 2) {
              const item = runtimeCall(
                index === 0 ? runtime.key : runtime.value,
                [cursor],
                node,
              );
              if (item === undefined) throw "map item result invariant";
              store(local.id, load(item, node), element);
            } else {
              const absent = nextValue++;
              emit({
                kind: "undefined",
                id: absent,
                start: element.start,
                end: element.end,
              });
              store(local.id, absent, element);
            }
            cellAccess(
              local.id,
              node.mode === "var" ? "write" : "initialize",
              element,
            );
          }
          statement(node.body, iterationTarget(head.id, exit.id, named));
          if (current !== undefined) jump(head.id, node);
          current = exit;
          break;
        }
        allocateCells(node);
        if (info(node.iterable).setElement !== undefined) {
          const runtime = setRuntime(node.iterable).iterator;
          if (runtime === undefined) throw "set iterator runtime invariant";
          const receiver = value(node.iterable),
            cursor = runtimeCall(runtime.create, [receiver], node);
          if (cursor === undefined) throw "set cursor result invariant";
          const local = fn.declarations.get(binding);
          if (local === undefined) throw "set iteration binding invariant";
          const head = block(),
            body = block(),
            exit = block();
          jump(head.id, node);
          current = head;
          const next = runtimeCall(runtime.advance, [cursor], node);
          if (next === undefined) throw "set advance result invariant";
          choose(load(next, node), body, exit, node);
          current = body;
          allocateCells(node);
          const item = runtimeCall(runtime.read, [cursor], node);
          if (item === undefined) throw "set read result invariant";
          store(local.id, load(item, node), node);
          cellAccess(
            local.id,
            node.mode === "var" ? "write" : "initialize",
            binding,
          );
          statement(node.body, iterationTarget(head.id, exit.id, named));
          if (current !== undefined) jump(head.id, node);
          current = exit;
          break;
        }
        if (scalarType(node.iterable) === "string") {
          const string = value(node.iterable),
            index = numberSlot(0, node),
            local = fn.declarations.get(binding),
            lengthId = nextValue++;
          if (local === undefined) throw "string iteration binding invariant";
          emit({
            kind: "string-length",
            id: lengthId,
            string: load(string, node),
            start: node.start,
            end: node.end,
          });
          const length = save(lengthId, "number", node),
            head = block(),
            body = block(),
            update = block(),
            exit = block();
          jump(head.id, node);
          current = head;
          choose(
            load(binarySlot("<", index, length, node), node),
            body,
            exit,
            node,
          );
          current = body;
          allocateCells(node);
          const point = stringCodePoint(string, index, length, node),
            width = numberSlot(1, node);
          conditionalStore(
            binarySlot(">", point, numberSlot(65535, node), node),
            width,
            () => numberSlot(2, node),
            node,
          );
          const limit = binarySlot("+", index, width, node),
            id = nextValue++;
          emit({
            kind: "string-slice",
            id,
            string: load(string, node),
            begin: load(index, node),
            limit: coerce(load(limit, node), "optional-number", node),
            start: node.start,
            end: node.end,
          });
          store(local.id, id, node);
          cellAccess(
            local.id,
            node.mode === "var" ? "write" : "initialize",
            binding,
          );
          statement(node.body, iterationTarget(update.id, exit.id, named));
          if (current !== undefined) jump(update.id, node);
          current = update;
          store(index, load(limit, node), node);
          jump(head.id, node);
          current = exit;
          break;
        }
        const array = value(node.iterable),
          index = numberSlot(0, node),
          local = fn.declarations.get(binding);
        if (local === undefined) throw "iteration binding invariant";
        const head = block(),
          body = block(),
          update = block(),
          exit = block();
        jump(head.id, node);
        current = head;
        const list =
          slots[array] === "reference" ? listRuntime(node.iterable) : undefined;
        const lengthSlot = list
          ? listValue(list, "length", [array], node)
          : arrayLength(array, node);
        choose(
          load(binarySlot("<", index, lengthSlot, node), node),
          body,
          exit,
          node,
        );
        current = body;
        allocateCells(node);
        let read: number;
        if (list)
          read = load(listValue(list, "read", [array, index], node), node);
        else {
          read = nextValue++;
          emit({
            kind: "array-read",
            id: read,
            array: load(array, node),
            index: load(index, node),
            start: node.start,
            end: node.end,
          });
        }
        if (
          local.type === "primitive" ||
          local.type === "general" ||
          local.type === "optional-boolean" ||
          local.type === "optional-number" ||
          local.type === "optional-string" ||
          local.type === "optional-reference"
        )
          store(local.id, read, node);
        else {
          const extracted = nextValue++;
          emitUnwrap(extracted, read, local.type, node);
          store(local.id, extracted, node);
        }
        cellAccess(
          local.id,
          node.mode === "var" ? "write" : "initialize",
          binding,
        );
        statement(node.body, iterationTarget(update.id, exit.id, named));
        if (current !== undefined) jump(update.id, node);
        current = update;
        store(
          index,
          load(binarySlot("+", index, numberSlot(1, node), node), node),
          node,
        );
        jump(head.id, node);
        current = exit;
        break;
      }
      case "for": {
        allocateCells(node);
        if (node.initializer !== undefined) statement(node.initializer, loop);
        copyIterationCells(node);
        const head = block(),
          body = block(),
          update = block(),
          exit = block();
        jump(head.id, node);
        current = head;
        const test = node.test;
        if (test === undefined) jump(body.id, node);
        else chooseExpression(test, body, exit);
        current = body;
        statement(node.body, iterationTarget(update.id, exit.id, named));
        if (current !== undefined) jump(update.id, node);
        current = update;
        copyIterationCells(node);
        if (node.update !== undefined) expression(node.update);
        jump(head.id, node);
        current = exit;
        break;
      }
      case "do-while": {
        const body = block(),
          test = block(),
          exit = block();
        jump(body.id, node);
        current = body;
        statement(node.body, iterationTarget(test.id, exit.id, named));
        if (current !== undefined) jump(test.id, node);
        current = test;
        chooseExpression(node.test, body, exit);
        current = exit;
        break;
      }
      case "while": {
        const head = block(),
          body = block(),
          exit = block();
        jump(head.id, node);
        current = head;
        chooseExpression(node.test, body, exit);
        current = body;
        statement(node.body, iterationTarget(head.id, exit.id, named));
        if (current !== undefined) jump(head.id, node);
        current = exit;
        break;
      }
      case "break":
      case "continue":
        {
          let destination: LoopTarget | undefined = loop;
          if (node.label !== undefined) {
            destination = undefined;
            for (let i = labels.length - 1; i >= 0; i--) {
              const candidate = labels[i];
              if (candidate !== undefined && candidate.name === node.label) {
                destination = candidate;
                break;
              }
            }
          }
          if (destination === undefined) throw "control target invariant";
          const target =
            node.kind === "break" ? destination.exit : destination.head;
          if (target === undefined) throw "continue target invariant";
          runFinalizers(target);
          if (current !== undefined) jump(target, node);
        }
        break;
      default:
        throw "unsupported checked statement invariant";
    }
  }
  const parameters = fn.node.parameters.map((p, index): number => {
    const local = fn.declarations.get(p);
    if (local === undefined) throw "parameter invariant";
    const incoming = fn.parameters[index];
    if (incoming === undefined) throw "parameter encoding invariant";
    return p.initializer === undefined ? local.id : temporary(incoming);
  });
  allocateCells(undefined);
  const ownedRecord = owned?.record;
  if (ownedRecord !== undefined) {
    const environment = nextValue++;
    emit({ kind: "closure-environment", id: environment, start: 0, end: 0 });
    const pointer = save(environment, "reference", { start: 0, end: 0 });
    for (const cell of ownedCells) {
      if (cell === undefined) throw "incoming cell invariant";
      const incoming = cell.incoming;
      if (incoming === undefined) continue;
      const slot =
        cell.byValue === true ? cell.local : cellPointers[cell.local];
      if (slot === undefined) throw "incoming cell invariant";
      const type: ScalarType | undefined =
        cell.byValue === true ? slots[cell.local] : "reference";
      if (type === undefined) throw "incoming capture type invariant";
      recordAccess(
        pointer,
        slot,
        "read",
        {
          type,
          choices: [
            {
              record: ownedRecord,
              field: incoming,
              type,
            },
          ],
        },
        cell.declaration,
      );
    }
  }
  const receiverLocal = fn.receiverLocal;
  if (receiverLocal !== undefined) {
    if (receiverSlot === undefined) throw "receiver local entry invariant";
    store(
      receiverLocal,
      coerce(load(receiverSlot, fn.node), slots[receiverLocal], fn.node),
      fn.node,
    );
    cellAccess(receiverLocal, "initialize", fn.node);
  }
  for (let i = 0; i < fn.node.parameters.length; i++) {
    const p = fn.node.parameters[i],
      input = parameters[i];
    if (p === undefined || input === undefined) throw "parameter invariant";
    const initializer = p.initializer;
    if (initializer === undefined) {
      cellAccess(input, "initialize", p);
      continue;
    }
    const local = fn.declarations.get(p);
    if (local === undefined) throw "default local invariant";
    const present = nextValue++;
    if (slots[input] === "optional-reference")
      emit({
        kind: "unary",
        operator: "truthy",
        id: present,
        operand: load(input, p),
        start: p.start,
        end: p.end,
      });
    else
      emitPresence(
        present,
        load(input, p),
        slots[input] === "optional-string",
        p,
      );
    const supplied = block(),
      fallback = block(),
      merge = block();
    choose(present, supplied, fallback, p);
    current = supplied;
    let payload = load(input, p);
    if (
      local.type === "number" ||
      local.type === "boolean" ||
      local.type === "string" ||
      local.type === "reference" ||
      local.type === "Uint8Array" ||
      local.type === "Uint16Array" ||
      local.type === "Uint32Array" ||
      local.type === "Float64Array"
    ) {
      const extracted = nextValue++;
      emitUnwrap(extracted, payload, local.type, p);
      payload = extracted;
    }
    if (local.type === "boolean") {
      const converted = nextValue++;
      emit({
        kind: "unary",
        operator: "truthy",
        id: converted,
        operand: payload,
        start: p.start,
        end: p.end,
      });
      payload = converted;
    }
    store(local.id, payload, p);
    jump(merge.id, p);
    current = fallback;
    store(local.id, load(value(initializer), initializer), p);
    jump(merge.id, p);
    current = merge;
    cellAccess(local.id, "initialize", p);
  }
  for (const local of fn.locals) {
    if (local === undefined) throw "local invariant";
    if (
      local.hoisted &&
      !local.parameter &&
      [
        "optional-number",
        "optional-boolean",
        "optional-string",
        "optional-reference",
        "primitive",
        "general",
      ].includes(local.type)
    ) {
      const id = nextValue++;
      emit({
        kind: "undefined",
        id,
        start: local.span.start,
        end: local.span.end,
      });
      store(local.id, id, local.span);
      cellAccess(local.id, "initialize", local.span);
    }
  }
  hoistFunctions(undefined);
  statement(fn.node.body, undefined);
  const reachable = new Uint8Array(blocks.length),
    pending = [0];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || reachable[id] === 1) continue;
    reachable[id] = 1;
    const handler = blocks[id]?.exception;
    if (handler !== undefined) pending.push(handler.target);
    const term = blocks[id]?.terminator;
    if (term === undefined) {
      if (current?.id === id) continue;
      throw "block terminator invariant";
    }
    if (term.kind === "jump") pending.push(term.target);
    else if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    )
      pending.push(term.consequent, term.alternate);
  }
  if (current !== undefined && reachable[current.id] === 1) {
    if (fn.returnType !== "void") throw "return completion invariant";
    finish({
      kind: "return",
      value: undefined,
      start: fn.node.start,
      end: fn.node.end,
    });
  }
  const liveBlocks = blocks.filter((b) => reachable[b.id] === 1);
  const ids: (number | undefined)[] = [];
  for (let i = 0; i < liveBlocks.length; i++) {
    const b = liveBlocks[i];
    if (b !== undefined) ids[b.id] = i;
  }
  function target(id: number): number {
    const result = ids[id];
    if (result === undefined) throw "reachable target invariant";
    return result;
  }
  const completed: Block[] = liveBlocks.map((b) => {
    const terminator = b.terminator;
    if (terminator === undefined) throw "block terminator invariant";
    let mapped: Terminator = terminator;
    switch (terminator.kind) {
      case "jump":
        mapped = { ...terminator, target: target(terminator.target) };
        break;
      case "branch":
        mapped = {
          ...terminator,
          consequent: target(terminator.consequent),
          alternate: target(terminator.alternate),
        };
        break;
      case "record":
        mapped = {
          ...terminator,
          consequent: target(terminator.consequent),
          alternate: target(terminator.alternate),
        };
        break;
      case "record-cell":
        mapped = {
          ...terminator,
          consequent: target(terminator.consequent),
          alternate: target(terminator.alternate),
        };
        break;
    }
    const handler = b.exception;
    return {
      id: target(b.id),
      instructions: b.instructions,
      terminator: mapped,
      ...(handler === undefined
        ? {}
        : {
            exception: { target: target(handler.target), slot: handler.slot },
          }),
    };
  });
  return {
    id: fn.id,
    ...(ownedRecord === undefined ? {} : { closureEnvironment: ownedRecord }),
    ...(receiverSlot === undefined ? {} : { receiverSlot }),
    name: fn.node.name,
    exported: fn.node.exported,
    parameters,
    slots,
    returnType: fn.returnType,
    entry: 0,
    blocks: completed,
  };
}
