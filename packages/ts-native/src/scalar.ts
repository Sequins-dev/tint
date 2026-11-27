import type {
  BindingInitialization,
  BindingInitializationStep,
} from "@tint/typescript/checker";
import type { DynamicObjectRuntime } from "./closure/lowering/dynamic-objects.ts";
import { syntaxHash } from "@tint/typescript/syntax";
import {
  forOfPipelineCompatible,
  planPipeline,
  type PipelineFacts,
  type PipelinePlan,
} from "./hir/pipelines.ts";
import { shortCircuit, propertyReference, callValue } from "@tint/ir/semantic";
import {
  createKeyIndex,
  type ReadonlyKeyIndex,
} from "@tint/foundation/collections/key-index";
import {
  add as addBigInteger,
  bitwise as bitwiseBigInteger,
  bitwiseNot as bitwiseNotBigInteger,
  divideQuotient as divideQuotientBigInteger,
  divideRemainder as divideRemainderBigInteger,
  formatInteger as formatBigInteger,
  multiply as multiplyBigInteger,
  negate as negateBigInteger,
  parseInteger as parseBigInteger,
  power as powerBigInteger,
  shiftSigned as shiftSignedBigInteger,
  subtract as subtractBigInteger,
  type Integer as BigInteger,
} from "@tint/foundation/numeric/big-integer";
import type {
  CheckedModule,
  CheckedFunction,
  Local,
  ExpressionInfo,
  NativeTypedArray,
  CheckedDowncast,
  DowncastTest,
  RestArguments,
  Expression,
  Statement,
  Span,
  CViewMember,
  CViewUse,
} from "@tint/typescript/checker";
import {
  verify,
  maximumStringLength,
  instructionResult,
  instructionMayThrow,
  isNativeTypedArray,
  nativeTypedArray,
  nativeTypedArrays,
  typedArrayBigIntElements,
  typedArrayLayout,
  type ModuleIR,
  type FunctionIR,
  type Block,
  type Instruction,
  type Terminator,
  type ScalarType,
  type Diagnostic,
  type ReturnType,
  type Span as IRSpan,
  type ForeignMemoryAccess,
  type ArrayAtomicOperation,
} from "@tint/ir/scalar";
/** The IR operation of an `Atomics` function the checker admitted. */
function atomicOperation(property: string): ArrayAtomicOperation {
  switch (property) {
    case "load":
      return "load";
    case "store":
      return "store";
    case "add":
      return "add";
    case "sub":
      return "sub";
    case "and":
      return "and";
    case "or":
      return "or";
    case "xor":
      return "xor";
    case "exchange":
      return "exchange";
    case "compareExchange":
      return "compare-exchange";
  }
  throw "atomics operation invariant";
}
const nativeArrayArgumentMessage: string =
  "Passing a realm typed array to a native typed-array parameter requires the slice 2b buffer view";
const nativeSharedArrayBufferMessage: string =
  "Passing a realm SharedArrayBuffer to a native SharedArrayBuffer requires a fixed-length SharedArrayBuffer";

/** Where a C view member lives (docs/native-ffi.md, "C views"): the root
 * view (a slot), a constant byte offset into it and, for array elements, a
 * slot holding the index (-1 for none) with the element stride and count.
 * `minimum` is the root view's proven size. */
interface ViewPlace {
  readonly base: number;
  readonly offset: number;
  readonly minimum: number;
  readonly index: number;
  readonly stride: number;
  readonly count: number;
}
/** The C type of a scalar or address view member. */
function viewScalarType(scalar: string): ForeignMemoryAccess["type"] {
  switch (scalar) {
    case "bool":
      return { kind: "scalar", scalar: "bool" };
    case "char":
      return { kind: "scalar", scalar: "char" };
    case "i8":
      return { kind: "scalar", scalar: "i8" };
    case "u8":
      return { kind: "scalar", scalar: "u8" };
    case "i16":
      return { kind: "scalar", scalar: "i16" };
    case "u16":
      return { kind: "scalar", scalar: "u16" };
    case "i32":
      return { kind: "scalar", scalar: "i32" };
    case "u32":
      return { kind: "scalar", scalar: "u32" };
    case "i64":
      return { kind: "scalar", scalar: "i64" };
    case "u64":
      return { kind: "scalar", scalar: "u64" };
    case "isize":
      return { kind: "scalar", scalar: "isize" };
    case "usize":
      return { kind: "scalar", scalar: "usize" };
    case "f32":
      return { kind: "scalar", scalar: "f32" };
    case "f64":
      return { kind: "scalar", scalar: "f64" };
    case "pointer":
      return { kind: "pointer", pointee: { kind: "void" } };
    default:
      throw "C view scalar invariant";
  }
}
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
/** An operand of a fusible typed string `+` chain and the `+` it belongs
 * to (lowering's stringChainLeaves). */
interface StringChainLeaf {
  readonly leaf: Expression;
  readonly parent: Expression;
}
/** A piece passed to emitStringPieces with static literal/encoding facts. */
interface StringPiece {
  readonly slot: number;
  readonly literal?: string;
  readonly oneByte: boolean;
  readonly twoByte: boolean;
}
export const nativeClosureCallMessage: string =
  "Calling a native closure through Function requires the slice 2b closure view";

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

/** A slot type proven to be a native typed array. */
function typedArraySlot(type: ScalarType | undefined): NativeTypedArray {
  const array = nativeTypedArray(type);
  if (array === undefined) throw "typed array slot invariant";
  return array;
}
/** A slot type proven present. */
function definedType(type: ScalarType | undefined): ScalarType {
  if (type === undefined) throw "slot type invariant";
  return type;
}
/** A category general-value extraction accepts. */
function generalValueType(
  type: ScalarType | undefined,
): "number" | "boolean" | "string" | "reference" | NativeTypedArray {
  if (
    type === "number" ||
    type === "boolean" ||
    type === "string" ||
    type === "reference"
  )
    return type;
  return typedArraySlot(type);
}

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
/** Typed BigInt helpers (native-runtime/values/bigint.ts). A BigInt is a
 * reference to js-runtime's BigIntValue record; the closure lowering
 * validates each helper's checked signature against that record. */
export interface BigIntRuntime {
  /** (decimal text) => bigint, for source literals. */
  readonly literal: number;
  /** (negative, len, d0, d1, d2, d3) => bigint, for compile-time-parsed inline literals. */
  readonly literalInline: number;
  /** (bigint, bigint) => bigint, by binary operator. */
  readonly binary: {
    readonly "+": number;
    readonly "-": number;
    readonly "*": number;
    readonly "/": number;
    readonly "%": number;
    readonly "**": number;
    readonly "&": number;
    readonly "|": number;
    readonly "^": number;
    readonly "<<": number;
    readonly ">>": number;
  };
  readonly negate: number;
  readonly not: number;
  /** (bigint, bigint) => -1 | 0 | 1. */
  readonly compare: number;
  /** (bigint, number) => -1 | 0 | 1, or NaN when unordered. */
  readonly compareNumber: number;
  readonly equal: number;
  readonly truthy: number;
  readonly toString: number;
  readonly toNumber: number;
  readonly fromNumber: number;
  readonly fromBoolean: number;
  /** (bits, bigint, signed) => bigint: BigInt.asIntN / BigInt.asUintN. */
  readonly asWidth: number;
  /** (bigint, scratch: Uint32Array, offset: number) => void. */
  readonly toWord64: number;
  /** (scratch: Uint32Array, signed: boolean) => bigint. */
  readonly fromWord64: number;
  /** (bigint) => uint32 value hash. */
  readonly hash: number;
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
  | "has"
  | "delete"
  | "resize"
  | "create"
  | "read"
  | "write"
  | "push"
  | "length"
  | "pop"
  | "wrap";
export interface ListRuntime {
  readonly sort?: number;
  /** Removes and returns the last element (undefined when empty); lists
   * without it pop through length, read and resize. */
  readonly pop?: number;
  /** Wraps a freshly initialized dense Float64Array into a NumberList. */
  readonly wrap?: number | undefined;
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
    /** Skip the own-field check and always follow the prototype pointer (used by `super`). */
    readonly skipOwn?: boolean;
  };
  /** An accessor property (typed classes): the layout has no field for it.
   * Its getter or setter closure is read through the prototype pointer
   * `field`, or from the receiver itself when `field` is -1 (constructor
   * state), and called with the receiver. */
  readonly accessor?: RecordAccessor;
}
/** Where an accessor's closures are read, and their signature witnesses. */
export interface RecordAccessor {
  readonly get: RecordAccess;
  readonly getTarget: number;
  readonly set: RecordAccess | undefined;
  readonly setTarget: number | undefined;
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
/** Per-choice prototype slots and matched choice index (-1 for own override)
 * for method calls read through a prototype contract (see `methodCallee`).
 * When a call has no arguments to evaluate between the read and invocation,
 * `directCall` invokes the proven leaf closure directly inside the block
 * dominated by the receiver's concrete layout check. */
interface InheritedRead {
  readonly slots: readonly number[];
  readonly arm: number;
  readonly armIndex?: number;
  readonly directCall?:
    ((leafSlot: number, receiver: number) => void) | undefined;
  readonly receiver?: number | undefined;
  readonly done?: number | undefined;
}
/** `x instanceof C` for a typed class C (docs/design-typed-classes.md):
 * OrdinaryHasInstance compares C.prototype with the operand's prototype
 * link. Typed class constructors have no realm view, so they carry no own
 * `Symbol.hasInstance` and keep Function.prototype's; realm objects cannot
 * reach a typed class prototype, so only C's instances can match. */
export interface ClassInstanceTest {
  /** Reads C.prototype from the constructor's state record. */
  readonly prototype: RecordAccess;
  /** C's instance layout and its hidden prototype pointer field. */
  readonly instance: number;
  readonly prototypeField: number;
  /** C and all derived classes in its family, with prototype link chains up to C.prototype. */
  readonly family?: readonly {
    readonly instance: number;
    readonly prototypeField: number;
    readonly prototypeChain: readonly {
      readonly record: number;
      readonly linkField: number;
    }[];
  }[];
}
export interface ConstructorCall {
  /** Signature witness for the separate construction closure. */
  readonly target: number;
  readonly entry: RecordAccess;
}
export interface FiniteRecordAccess {
  readonly key: string;
  readonly access: RecordAccess;
}
export interface PrivateAccessPlan {
  readonly kind:
    | "instance-field"
    | "instance-method"
    | "instance-accessor"
    | "static-field"
    | "static-method"
    | "static-accessor";
  readonly name: string;
  readonly type: ScalarType;
  readonly ownerLocal?: number | undefined;
  readonly fieldAccess?: RecordAccess | undefined;
  readonly brandCheck?: RecordAccess | undefined;
  readonly methodAccess?: RecordAccess | undefined;
  readonly staticFieldAccess?: RecordAccess | undefined;
  readonly accessor?:
    | {
        readonly get?: RecordAccess | undefined;
        readonly getTarget?: number | undefined;
        readonly set?: RecordAccess | undefined;
        readonly setTarget?: number | undefined;
      }
    | undefined;
}
export interface PrivateBrandCheckPlan {
  readonly static: boolean;
  readonly name: string;
  readonly ownerLocal?: number | undefined;
  readonly check?: RecordAccess | undefined;
}
export interface RecordOperations {
  readonly constructors?: ReadonlyKeyIndex<Expression, ConstructorCall>;
  readonly classInstanceTests?: ReadonlyKeyIndex<Expression, ClassInstanceTest>;
  readonly privateAccesses?: ReadonlyKeyIndex<Expression, PrivateAccessPlan>;
  readonly privateBrandChecks?: ReadonlyKeyIndex<
    Expression,
    PrivateBrandCheckPlan
  >;
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
  readonly finiteAccesses?: ReadonlyKeyIndex<
    Expression,
    readonly FiniteRecordAccess[]
  >;
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
/** Hidden parameter indices for a typed class constructor body (C2). */
export interface ConstructorContext {
  /** Parameter index receiving `new.target` (the most-derived constructor). */
  readonly newTarget: number;
  /** Derived constructors: parameter index and target signature of base `$init`. */
  readonly baseInit?: {
    readonly parameter: number;
    readonly target: number;
  };
  /** Derived constructors with own fields: parameter index and target signature of `$fields`. */
  readonly ownFields?: {
    readonly parameter: number;
    readonly target: number;
  };
}
/** A class statement evaluated by this function (docs/design-typed-classes.md).
 * Its member closures are created in source order, stored in the definition
 * environment, and the generated definition entry returns the constructor. */
export interface OwnedClassDefinition {
  readonly declaration: Span;
  /** The outer (statement) binding, and the class-scope binding when used. */
  readonly local?: number | undefined;
  readonly innerLocal?: number | undefined;
  readonly definition: number;
  readonly environment: number;
  /** Member closure targets by definition environment field. */
  readonly members: readonly number[];
  /** Derived classes: heritage expression and accesses for base prototype and `$init`. */
  readonly heritage?:
    | {
        readonly expression: Expression;
        readonly prototype: RecordAccess;
        readonly init: RecordAccess;
      }
    | undefined;
  /** Static field initialization: an entry closed over an environment of
   * the constructor (field 0) and initializer closures (fields from 1). */
  readonly statics?:
    | {
        readonly target: number;
        readonly environment: number;
        readonly members: readonly number[];
      }
    | undefined;
}
/** Explicit lexical cells and owned environment records planned by the source adapter. */
export interface OwnedEnvironmentPlan {
  readonly hoisted?: readonly OwnedHoistedFunction[];
  readonly record?: number | undefined;
  readonly cells: readonly OwnedCell[];
  readonly constructors: ReadonlyMap<number, OwnedConstructor>;
  readonly classes?: readonly OwnedClassDefinition[];
  readonly constructorContext?: ConstructorContext | undefined;
}
/** Emit one function against explicit call signatures. Verify the composed module before use. */
export interface RealmErrorRuntime {
  readonly view: number;
  readonly operation: number;
  readonly error: number;
  readonly typeError: number;
  readonly rangeError: number;
  readonly referenceError: number;
  readonly applies: (span: IRSpan) => boolean;
}

export interface NodeErrorRecords {
  readonly coded?: number | undefined;
  readonly type?: number | undefined;
  readonly range?: number | undefined;
  readonly system?: number | undefined;
  readonly info?: number | undefined;
}

export function lowerFunction(
  fn: CheckedFunction,
  signatures: readonly FunctionSignature[],
  records?: RecordOperations,
  lists?: readonly ListRuntimeBinding[],
  sets?: readonly SetRuntimeBinding[],
  maps?: readonly MapRuntimeBinding[],
  owned?: OwnedEnvironmentPlan,
  primitiveBindings?: PrimitiveRuntime,
  bigIntBindings?: BigIntRuntime,
  dynamicObjects?: DynamicObjectRuntime,
  dynamicSignatures: readonly number[] = [],
  realmErrorBindings?: RealmErrorRuntime,
  nodeErrors?: NodeErrorRecords,
  generalObjectViews: boolean = false,
  sharedBlockCheck?: number,
): FunctionIR {
  const primitives = primitiveBindings,
    bigints = bigIntBindings,
    realmErrors = realmErrorBindings;
  const slots: ScalarType[] = fn.locals.map((l) => l.type),
    blocks: Builder[] = [];
  const receiverSlot = fn.receiver ? slots.length : undefined;
  if (receiverSlot !== undefined) slots.push("general");
  // A reference receiver converted once at entry, without trapping (`none`
  // when the caller passed another value), so record checks on `this`
  // prove its layout for later accesses.
  const receiverReference =
    receiverSlot !== undefined && fn.receiverReference === true
      ? slots.length
      : undefined;
  if (receiverReference !== undefined) slots.push("optional-reference");
  const isDerivedConstructor =
    owned?.constructorContext?.baseInit !== undefined;
  const superCalled = isDerivedConstructor ? slots.length : undefined;
  if (superCalled !== undefined) slots.push("boolean");
  let word64ScratchSlot: number | undefined;
  function word64Scratch(): number {
    const existing = word64ScratchSlot;
    if (existing !== undefined) return existing;
    const slot = slots.length;
    slots.push("Uint32Array");
    word64ScratchSlot = slot;
    return slot;
  }
  const bigIntConstantSlots = new Map<string, number>();
  const bigIntConstants: {
    readonly slot: number;
    readonly integer: BigInteger;
  }[] = [];
  function bigIntConstantSlot(integer: BigInteger): number {
    const key =
      integer.len <= 4
        ? (integer.negative ? "-" : "+") +
          String(integer.len) +
          ":" +
          String(integer.d0) +
          ":" +
          String(integer.d1) +
          ":" +
          String(integer.d2) +
          ":" +
          String(integer.d3)
        : (formatBigInteger(integer, 10) ?? "");
    const existing = bigIntConstantSlots.get(key);
    if (existing !== undefined) return existing;
    const slot = slots.length;
    slots.push("reference");
    bigIntSlots[slot] = 1;
    bigIntConstantSlots.set(key, slot);
    bigIntConstants.push({ slot, integer });
    return slot;
  }
  function evalConstantBigInt(expr: Expression): BigInteger | undefined {
    const maxFoldLimbs = 64;
    const node = ungroup(expr);
    if (node.kind === "bigint") {
      if (node.value.length > 200) return undefined;
      const parsed = parseBigInteger(node.value, 10);
      return parsed !== undefined && parsed.len <= maxFoldLimbs
        ? parsed
        : undefined;
    }
    if (node.kind === "unary") {
      if (node.operator !== "-" && node.operator !== "~") return undefined;
      const operand = evalConstantBigInt(node.operand);
      if (operand === undefined) return undefined;
      const result =
        node.operator === "-"
          ? negateBigInteger(operand)
          : bitwiseNotBigInteger(operand);
      return result.len <= maxFoldLimbs ? result : undefined;
    }
    if (node.kind === "binary") {
      const op = node.operator;
      if (
        op !== "+" &&
        op !== "-" &&
        op !== "*" &&
        op !== "/" &&
        op !== "%" &&
        op !== "&" &&
        op !== "|" &&
        op !== "^" &&
        op !== "<<" &&
        op !== ">>" &&
        op !== "**"
      )
        return undefined;
      const left = evalConstantBigInt(node.left);
      if (left === undefined) return undefined;
      const right = evalConstantBigInt(node.right);
      if (right === undefined) return undefined;
      let result: BigInteger | undefined;
      if (op === "+") result = addBigInteger(left, right);
      else if (op === "-") result = subtractBigInteger(left, right);
      else if (op === "*")
        result =
          left.len + right.len <= maxFoldLimbs
            ? multiplyBigInteger(left, right)
            : undefined;
      else if (op === "/") result = divideQuotientBigInteger(left, right);
      else if (op === "%") result = divideRemainderBigInteger(left, right);
      else if (op === "&" || op === "|" || op === "^")
        result = bitwiseBigInteger(left, right, op);
      else if (op === "<<" || op === ">>")
        result = shiftSignedBigInteger(left, right, op === ">>", maxFoldLimbs);
      else if (op === "**")
        result = right.negative
          ? undefined
          : powerBigInteger(left, right, maxFoldLimbs);
      return result !== undefined && result.len <= maxFoldLimbs
        ? result
        : undefined;
    }
    return undefined;
  }
  const callReceivers = createKeyIndex<Expression, number>(syntaxHash);
  let exception: { readonly target: number; readonly slot: number } | undefined;
  let finalizer: FinallyScope | undefined;
  const labels: LabelTarget[] = [];
  const blockFinalizers: (FinallyScope | undefined)[] = [];
  let nextValue = 0;
  const valueTypes: (ScalarType | undefined)[] = [];
  // Proofs apply to SSA values and expression-result temporaries, never mutable
  // source locals. Union-valued merge slots are not inferred from a branch store.
  const speculativeSlots: number[] = [],
    speculativeValues: number[] = [];
  const sharedBufferFlowSlots: number[] = [],
    sharedBufferFlowValues: number[] = [];
  const undefinedValues: number[] = [],
    undefinedSlots: number[] = [],
    // Slots holding BigInts (references to BigIntValue, possibly absent).
    bigIntSlots: number[] = [];
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
      case "script-argument":
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
      case "general-is":
      case "boolean-value":
      case "boolean-present":
      case "string-two-byte":
        type = "boolean";
        break;
      case "error-message":
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
      case "string-index-of":
      case "script-argument-count":
        type = "number";
        break;
      case "array-subarray":
        type = valueTypes[op.array];
        break;
      case "array-new":
      case "array-view":
        type = op.type;
        break;
      case "array-buffer-byte-length":
      case "array-atomic":
        type = "number";
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
      case "string-reference":
      case "function-environment":
        type = "optional-reference";
        break;
      case "reference-string":
        type = "optional-string";
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
      case "array-word64-read":
        type = "boolean";
        break;
      case "optional-value":
      case "optional-value-or":
      case "array-byte-offset":
      case "array-byte-length":
      case "array-length":
      case "gc-epoch":
      case "reference-hash":
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
    else if (isNativeTypedArray(type))
      emit({
        kind: "reference-value",
        id,
        value,
        type: typedArraySlot(type),
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
    if (
      sourceType === "general" &&
      speculativeValues[id] === 1 &&
      type !== undefined &&
      type !== "general"
    ) {
      const input = save(id, "general", node);
      requireSpeculativeContract(input, type, node);
      id = load(input, node);
    }
    if (
      sourceType === "general" &&
      sharedBufferFlowValues[id] === 1 &&
      type === "reference"
    ) {
      const input = save(id, "general", node);
      return load(nativeSharedArrayBufferArgument(input, node), node);
    }
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
    if (sourceType === "optional-reference" && isNativeTypedArray(type)) {
      const unwrapped = nextValue++;
      emitUnwrap(unwrapped, id, typedArraySlot(type), node);
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
        type === "reference" ||
        isNativeTypedArray(type))
    ) {
      const unwrapped = nextValue++;
      emit({
        kind: "general-value",
        id: unwrapped,
        value: id,
        type: generalValueType(type),
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
        (type === "optional-reference" && isNativeTypedArray(source ?? ""));
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
    if (speculativeSlots[slot] === 1) speculativeValues[id] = 1;
    if (sharedBufferFlowSlots[slot] === 1) sharedBufferFlowValues[id] = 1;
    return id;
  }
  function store(slot: number, value: number, node: IRSpan): void {
    // A saved undefined literal is constant only until its slot is overwritten.
    undefinedSlots[slot] = 0;
    sharedBufferFlowSlots[slot] = 0;
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
    node: IRSpan,
  ): void {
    const cell = ownedCells.find((c) => c !== undefined && c.local === local);
    if (cell === undefined) return;
    if (cell.byValue === true) {
      // The owner may write a value capture before any captor exists (see
      // planCaptures); its slot is the storage. Captors never write it.
      if (operation === "write" && cell.incoming !== undefined)
        throw "write to captured value invariant";
      return;
    }
    const pointer = cellPointers[local];
    if (pointer === undefined) throw "owned cell pointer invariant";
    // Strict definite-assignment proofs allow a var cell to acquire its concrete
    // payload on the first write; subsequent writes share the same mutable cell.
    const hoistedWrite =
      operation === "write" && fn.locals[local]?.hoisted === true;
    const success = block(),
      failure =
        operation === "initialize" || hoistedWrite
          ? block()
          : temporalDeadZone(local, node);
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
    if (operation === "initialize" || hoistedWrite) {
      current = failure;
      if (hoistedWrite) {
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
      // A failed initialization cannot happen in checked code.
      finish({ kind: "trap", start: node.start, end: node.end });
    }
    current = success;
  }
  const temporalDeadZones: {
    readonly local: number;
    readonly exception:
      { readonly target: number; readonly slot: number } | undefined;
    readonly finalizer: FinallyScope | undefined;
    readonly block: Builder;
  }[] = [];
  /** The block throwing the ReferenceError of a read or write of `local`
   * before its initialization (its temporal dead zone), with V8's message.
   * Accesses in one handler and cleanup context share it. */
  function temporalDeadZone(local: number, node: IRSpan): Builder {
    const handler = exception,
      cleanup = finalizer;
    for (const known of temporalDeadZones) {
      if (known === undefined) throw "temporal dead zone invariant";
      if (
        known.local === local &&
        known.exception === handler &&
        known.finalizer === cleanup
      )
        return known.block;
    }
    const failure = block(),
      resume = current;
    temporalDeadZones.push({
      local,
      exception: handler,
      finalizer: cleanup,
      block: failure,
    });
    current = failure;
    const declared = fn.locals[local],
      name = declared?.displayName ?? declared?.name ?? "";
    const message = nextValue++;
    emit({
      kind: "string-literal",
      id: message,
      value: "Cannot access '" + name + "' before initialization",
      start: node.start,
      end: node.end,
    });
    // Inline allocation and a throw keep a function eligible for leaf
    // registers, which a call would not.
    const error = newNativeError("ReferenceError", message, undefined, node);
    const thrown = nextValue++;
    emit({
      kind: "general-wrap",
      id: thrown,
      value: error,
      start: node.start,
      end: node.end,
    });
    finish({ kind: "throw", value: thrown, start: node.start, end: node.end });
    current = resume;
    return failure;
  }
  function readLocal(local: number, node: IRSpan): number {
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
    if (type === "general" && sharedBufferFlowValues[id] === 1)
      sharedBufferFlowSlots[slot] = 1;
    return slot;
  }
  const expressionOverrides = createKeyIndex<Expression, number>(syntaxHash);
  const patternReads = createKeyIndex<Expression, () => number>(syntaxHash);
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
    start: number = 0,
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
    const index = numberSlot(start, node),
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
    else item = readArrayElement(source, index, node);
    visit(item, sourceList === undefined);
    store(
      index,
      load(binarySlot("+", index, numberSlot(1, node), node), node),
      node,
    );
    jump(head.id, node);
    current = exit;
  }
  /** `String(value)` on a general slot (`unknown` or general call result):
   * converts primitives, unexposed native errors and BigInt directly, and
   * delegates exposed error views, Symbols and realm objects to the program
   * realm's stringConstructor when linked (otherwise traps explicitly). */
  function unknownToString(rawSlot: number, node: Expression): number {
    // Every branch below checks the general tag dynamically before unboxing,
    // so a speculative general slot does not assert a written contract here.
    const slot =
      speculativeSlots[rawSlot] === 1
        ? save(load(rawSlot, node), "general", node)
        : rawSlot;
    const result = temporary("string"),
      done = block();
    let candidate = slot;
    const helper = dynamicObjects?.stringConstructor;
    if (realmErrors !== undefined && helper !== undefined) {
      const exposed = exposedError(slot, node),
        attached = block(),
        unexposed = block();
      candidate = exposed;
      choose(
        truth(realmErrorOperation(exposed, "attached", node), node),
        attached,
        unexposed,
        node,
      );
      current = attached;
      store(result, load(dynamicResult(helper, [exposed], node), node), node);
      jump(done.id, node);
      current = unexposed;
    }
    const isString = nextValue++;
    emit({
      kind: "general-is",
      id: isString,
      value: load(slot, node),
      type: "string",
      start: node.start,
      end: node.end,
    });
    const asString = block(),
      notString = block();
    choose(isString, asString, notString, node);
    current = asString;
    store(result, coerce(load(slot, node), "string", node), node);
    jump(done.id, node);
    current = notString;

    const isNumber = nextValue++;
    emit({
      kind: "general-is",
      id: isNumber,
      value: load(slot, node),
      type: "number",
      start: node.start,
      end: node.end,
    });
    const asNumber = block(),
      notNumber = block();
    choose(isNumber, asNumber, notNumber, node);
    current = asNumber;
    const numberValue = save(
      coerce(load(slot, node), "number", node),
      "number",
      node,
    );
    store(result, load(stringOperand(numberValue, node), node), node);
    jump(done.id, node);
    current = notNumber;

    const isBoolean = nextValue++;
    emit({
      kind: "general-is",
      id: isBoolean,
      value: load(slot, node),
      type: "boolean",
      start: node.start,
      end: node.end,
    });
    const asBoolean = block(),
      notBoolean = block();
    choose(isBoolean, asBoolean, notBoolean, node);
    current = asBoolean;
    const booleanValue = save(
      coerce(load(slot, node), "boolean", node),
      "boolean",
      node,
    );
    store(result, load(stringOperand(booleanValue, node), node), node);
    jump(done.id, node);
    current = notBoolean;

    const isUndefined = nextValue++;
    emit({
      kind: "general-is",
      id: isUndefined,
      value: load(slot, node),
      type: "undefined",
      start: node.start,
      end: node.end,
    });
    const asUndefined = block(),
      notUndefined = block();
    choose(isUndefined, asUndefined, notUndefined, node);
    current = asUndefined;
    store(result, load(errorString("undefined", node), node), node);
    jump(done.id, node);
    current = notUndefined;

    const isNull = nextValue++;
    emit({
      kind: "general-is",
      id: isNull,
      value: load(slot, node),
      type: "null",
      start: node.start,
      end: node.end,
    });
    const asNull = block(),
      notNull = block();
    choose(isNull, asNull, notNull, node);
    current = asNull;
    store(result, load(errorString("null", node), node), node);
    jump(done.id, node);
    current = notNull;

    const asError = block(),
      notError = block();
    choose(
      nativeErrorTest(load(slot, node), "Error", node),
      asError,
      notError,
      node,
    );
    current = asError;
    const errorRef = save(
      coerce(load(slot, node), "reference", node),
      "reference",
      node,
    );
    const name = nativeErrorProperty(errorRef, "name", node),
      message = nativeErrorProperty(errorRef, "message", node),
      nameLength = nextValue++,
      messageLength = nextValue++;
    emit({
      kind: "string-length",
      id: nameLength,
      string: load(name, node),
      start: node.start,
      end: node.end,
    });
    const emptyName = block(),
      withName = block();
    choose(
      load(
        binarySlot(
          "===",
          save(nameLength, "number", node),
          numberSlot(0, node),
          node,
        ),
        node,
      ),
      emptyName,
      withName,
      node,
    );
    current = emptyName;
    store(result, load(message, node), node);
    jump(done.id, node);
    current = withName;
    emit({
      kind: "string-length",
      id: messageLength,
      string: load(message, node),
      start: node.start,
      end: node.end,
    });
    const emptyMessage = block(),
      withMessage = block();
    choose(
      load(
        binarySlot(
          "===",
          save(messageLength, "number", node),
          numberSlot(0, node),
          node,
        ),
        node,
      ),
      emptyMessage,
      withMessage,
      node,
    );
    current = emptyMessage;
    store(result, load(name, node), node);
    jump(done.id, node);
    current = withMessage;
    const prefix = save(
      emitStringConcat(name, errorString(": ", node), node),
      "string",
      node,
    );
    store(result, emitStringConcat(prefix, message, node), node);
    jump(done.id, node);
    current = notError;

    const bigintRecord = info(node).bigIntRecord;
    if (bigints !== undefined && bigintRecord !== undefined) {
      const asBigInt = block(),
        notBigInt = block();
      choose(
        errorRecordTest(load(slot, node), bigintRecord, node),
        asBigInt,
        notBigInt,
        node,
      );
      current = asBigInt;
      const bigintRef = save(
        coerce(load(slot, node), "reference", node),
        "reference",
        node,
      );
      const text = runtimeCall(bigIntRuntime().toString, [bigintRef], node);
      if (text === undefined) throw "BigInt string conversion invariant";
      store(result, load(text, node), node);
      jump(done.id, node);
      current = notBigInt;
    }

    if (helper !== undefined) {
      store(result, load(dynamicResult(helper, [candidate], node), node), node);
      jump(done.id, node);
    } else {
      finish({ kind: "trap", start: node.start, end: node.end });
    }
    current = done;
    return result;
  }
  function stringOperand(slot: number, node: Expression): number {
    if (slots[slot] === "string") return slot;
    if (
      slots[slot] === "optional-string" ||
      slots[slot] === "optional-number" ||
      slots[slot] === "optional-boolean"
    ) {
      const optKind = slots[slot];
      const valueKind: ScalarType =
        optKind === "optional-string"
          ? "string"
          : optKind === "optional-number"
            ? "number"
            : "boolean";
      const present = nextValue++;
      emitPresence(
        present,
        load(slot, node),
        optKind === "optional-string",
        node,
      );
      const result = stringSlot("undefined", node),
        yes = block(),
        done = block();
      choose(present, yes, done, node);
      current = yes;
      const unwrappedId = nextValue++;
      if (optKind === "optional-string")
        emit({
          kind: "string-value",
          id: unwrappedId,
          value: load(slot, node),
          start: node.start,
          end: node.end,
        });
      else if (optKind === "optional-number")
        emit({
          kind: "optional-value",
          id: unwrappedId,
          value: load(slot, node),
          start: node.start,
          end: node.end,
        });
      else
        emit({
          kind: "boolean-value",
          id: unwrappedId,
          value: load(slot, node),
          start: node.start,
          end: node.end,
        });
      const unwrapped = save(unwrappedId, valueKind, node);
      store(result, load(stringOperand(unwrapped, node), node), node);
      jump(done.id, node);
      current = done;
      return result;
    }
    if (speculativeSlots[slot] === 1) {
      const helper = dynamicObjects?.speculativeString;
      if (helper === undefined)
        throw "speculative string requires the program realm";
      return dynamicResult(helper, [slot], node);
    }
    if (bigIntSlots[slot] === 1 && slots[slot] === "reference") {
      const text = runtimeCall(bigIntRuntime().toString, [slot], node);
      if (text === undefined) throw "BigInt string conversion invariant";
      return text;
    }
    if (slots[slot] === "number") {
      const target = info(node).callee;
      if (target === undefined) throw "number formatter binding invariant";
      // The number-string cache inline first (no number converts to "",
      // its miss), and the formatter, which caches, only on a miss.
      const result = temporary("string"),
        cached = nextValue++;
      emit({
        kind: "number-string-cached",
        id: cached,
        value: load(slot, node),
        start: node.start,
        end: node.end,
      });
      store(result, cached, node);
      const length = nextValue++;
      emit({
        kind: "string-length",
        id: length,
        string: load(result, node),
        start: node.start,
        end: node.end,
      });
      const miss = block(),
        done = block();
      choose(
        load(
          binarySlot(
            "===",
            save(length, "number", node),
            numberSlot(0, node),
            node,
          ),
          node,
        ),
        miss,
        done,
        node,
      );
      current = miss;
      const id = nextValue++;
      emit({
        kind: "call",
        id,
        target,
        arguments: [load(slot, node)],
        start: node.start,
        end: node.end,
      });
      store(result, id, node);
      jump(done.id, node);
      current = done;
      return result;
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

  function bigIntRuntime(): BigIntRuntime {
    if (bigints === undefined) throw "BigInt runtime invariant";
    return bigints;
  }
  /** A runtime call whose reference result is a BigInt. */
  function bigIntCall(
    target: number,
    args: readonly number[],
    node: Span,
  ): number {
    const slot = runtimeCall(target, args, node);
    if (slot === undefined) throw "BigInt call result invariant";
    bigIntSlots[slot] = 1;
    return slot;
  }
  /** Truthiness of a possibly absent BigInt: present and nonzero. */
  function bigIntTruth(slot: number, node: Span): number {
    const runtime = bigIntRuntime();
    if (slots[slot] === "reference") {
      const result = runtimeCall(runtime.truthy, [slot], node);
      if (result === undefined) throw "BigInt truthiness invariant";
      return load(result, node);
    }
    if (slots[slot] !== "optional-reference") throw "BigInt slot invariant";
    const result = temporary("boolean"),
      present = block(),
      absent = block(),
      merge = block(),
      test = nextValue++;
    emit({
      kind: "unary",
      operator: "truthy",
      id: test,
      operand: load(slot, node),
      start: node.start,
      end: node.end,
    });
    choose(test, present, absent, node);
    current = present;
    const presentSlot = save(load(slot, node), "reference", node);
    const truthy = runtimeCall(runtime.truthy, [presentSlot], node);
    if (truthy === undefined) throw "BigInt truthiness invariant";
    store(result, load(truthy, node), node);
    jump(merge.id, node);
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
    jump(merge.id, node);
    current = merge;
    return load(result, node);
  }
  /** BigInt binary operators. Comparisons are exact, also against a Number
   * (compareNumber yields NaN for NaN, which every relation rejects);
   * equality compares values, never references. */
  function bigIntBinaryHelper(
    runtime: BigIntRuntime,
    operator: string,
  ): number {
    const binary = runtime.binary;
    switch (operator) {
      case "+":
        return binary["+"];
      case "-":
        return binary["-"];
      case "*":
        return binary["*"];
      case "/":
        return binary["/"];
      case "%":
        return binary["%"];
      case "**":
        return binary["**"];
      case "&":
        return binary["&"];
      case "|":
        return binary["|"];
      case "^":
        return binary["^"];
      case "<<":
        return binary["<<"];
      case ">>":
        return binary[">>"];
    }
    throw "BigInt binary operator invariant";
  }
  function bigIntBinary(
    node: Expression & { readonly kind: "binary" },
    left: number,
    right: number,
  ): number | undefined {
    const runtime = bigIntRuntime(),
      operator = node.operator,
      leftBigInt = bigIntSlots[left] === 1 && slots[left] === "reference",
      rightBigInt = bigIntSlots[right] === 1 && slots[right] === "reference";
    switch (operator) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "%":
      case "**":
      case "&":
      case "|":
      case "^":
      case "<<":
      case ">>":
        if (!leftBigInt || !rightBigInt) return undefined;
        return bigIntCall(
          bigIntBinaryHelper(runtime, operator),
          [left, right],
          node,
        );
      case "<":
      case ">":
      case "<=":
      case ">=": {
        const zero = numberSlot(0, node);
        if (leftBigInt && rightBigInt) {
          const order = runtimeCall(runtime.compare, [left, right], node);
          if (order === undefined) throw "BigInt comparison invariant";
          return binarySlot(operator, order, zero, node);
        }
        if (leftBigInt && slots[right] === "number") {
          const order = runtimeCall(runtime.compareNumber, [left, right], node);
          if (order === undefined) throw "BigInt comparison invariant";
          return binarySlot(operator, order, zero, node);
        }
        if (rightBigInt && slots[left] === "number") {
          // n < b  ⇔  compare(b, n) > 0, and so on.
          const order = runtimeCall(runtime.compareNumber, [right, left], node);
          if (order === undefined) throw "BigInt comparison invariant";
          const mirrored =
            operator === "<"
              ? ">"
              : operator === ">"
                ? "<"
                : operator === "<="
                  ? ">="
                  : "<=";
          return binarySlot(mirrored, order, zero, node);
        }
        return undefined;
      }
      case "===":
      case "==":
      case "!==":
      case "!=": {
        if (!leftBigInt || !rightBigInt) return undefined;
        const equal = runtimeCall(runtime.equal, [left, right], node);
        if (equal === undefined) throw "BigInt equality invariant";
        return operator === "===" || operator === "=="
          ? equal
          : unarySlot("!", equal, "boolean", node);
      }
    }
    return undefined;
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
    if (bigIntSlots[slot] === 1) return bigIntTruth(slot, node);
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
  function builtinUndefined(node: Expression): boolean {
    if (node.kind !== "identifier" || node.name !== "undefined") return false;
    const checked = info(node);
    return checked.local === undefined && checked.realmGlobal === undefined;
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
    if (generalObjectViews && test.kind === "conditional") {
      const consequent = block(),
        alternate = block();
      chooseExpression(test.test, consequent, alternate);
      current = consequent;
      chooseExpression(test.consequent, yes, no);
      current = alternate;
      chooseExpression(test.alternate, yes, no);
      return;
    }
    if (
      test.kind === "binary" &&
      (test.operator === "&&" || test.operator === "||")
    ) {
      const first = test.left,
        second = test.right;
      if (
        generalObjectViews &&
        test.operator === "||" &&
        first.kind === "binary" &&
        first.operator === "===" &&
        second.kind === "binary" &&
        second.operator === "===" &&
        first.left.kind === "identifier" &&
        second.left.kind === "identifier" &&
        first.right.kind === "null" &&
        builtinUndefined(second.right) &&
        info(first.left).type === "general" &&
        info(second.left).type === "general"
      ) {
        // The checked local read has no effects, so both comparisons can
        // share a single load and observe only the general carrier tag.
        const local = info(first.left).local;
        if (local !== undefined && local === info(second.left).local) {
          const operand = value(first.left);
          const match = nextValue++;
          emit({
            kind: "general-is",
            id: match,
            value: load(operand, first.left),
            type: "nullish",
            branch: true,
            start: test.start,
            end: test.end,
          });
          choose(match, yes, no, test);
          return;
        }
      }
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
  function booleanSlot(flag: boolean, node: IRSpan): number {
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
  function numberSlot(n: number, node: IRSpan): number {
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
      const generalSlot = slots[left] === "general" ? left : right,
        otherSlot = slots[left] === "general" ? right : left,
        otherType = slots[otherSlot];
      if (otherType === "reference" || otherType === "optional-reference") {
        const result = temporary("boolean"),
          checkTag = block(),
          checkPointer = block(),
          mismatch = block(),
          done = block();
        let targetRef: number | undefined = undefined;
        if (otherType === "optional-reference") {
          const isAbsent = block(),
            noneRef = nextValue++,
            present = nextValue++;
          emit({
            kind: "reference-none",
            id: noneRef,
            start: node.start,
            end: node.end,
          });
          emit({
            kind: "binary",
            id: present,
            operator: "!==",
            left: load(otherSlot, node),
            right: noneRef,
            start: node.start,
            end: node.end,
          });
          choose(present, checkTag, isAbsent, node);
          current = isAbsent;
          const isUndef = nextValue++;
          emit({
            kind: "general-is",
            id: isUndef,
            value: load(generalSlot, node),
            type: "undefined",
            start: node.start,
            end: node.end,
          });
          store(result, isUndef, node);
          jump(done.id, node);
          current = checkTag;
        } else {
          jump(checkTag.id, node);
          current = checkTag;
        }
        const isObj = nextValue++;
        emit({
          kind: "general-is",
          id: isObj,
          value: load(generalSlot, node),
          type: "object",
          start: node.start,
          end: node.end,
        });
        choose(isObj, checkPointer, mismatch, node);
        current = checkPointer;
        const payload = nextValue++;
        emit({
          kind: "general-value",
          id: payload,
          value: load(generalSlot, node),
          type: "reference",
          unchecked: true,
          start: node.start,
          end: node.end,
        });
        if (otherType === "optional-reference") {
          targetRef = nextValue++;
          emit({
            kind: "reference-value",
            id: targetRef,
            value: load(otherSlot, node),
            start: node.start,
            end: node.end,
          });
        } else {
          targetRef = load(otherSlot, node);
        }
        const eq = nextValue++;
        emit({
          kind: "binary",
          id: eq,
          operator: "===",
          left: payload,
          right: targetRef,
          start: node.start,
          end: node.end,
        });
        store(result, eq, node);
        jump(done.id, node);
        current = mismatch;
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
        current = done;
        return operator === "==="
          ? result
          : unarySlot("!", result, "boolean", node);
      }
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
  /** Whether `text` contains a UTF-16 code unit above 0xFF. */
  function literalHasTwoByte(text: string): boolean {
    for (let i = 0; i < text.length; i++)
      if (text.charCodeAt(i) > 0xff) return true;
    return false;
  }
  function stringLiteralPiece(text: string): StringPiece {
    const wide = literalHasTwoByte(text);
    return { slot: -1, literal: text, oneByte: !wide, twoByte: wide };
  }
  /** Compile-time string text for a pure literal expression, or undefined. */
  function stringLiteralValue(node: Expression): string | undefined {
    let current = node;
    while (current.kind === "group" || current.kind === "satisfies")
      current = current.expression;
    if (current.kind === "string") return current.value;
    if (current.kind === "boolean") return current.value ? "true" : "false";
    return undefined;
  }
  /** Whether converting `node` to a string always produces 1-byte code units. */
  function isStaticallyOneByteString(node: Expression): boolean {
    let current = node;
    while (current.kind === "group" || current.kind === "satisfies")
      current = current.expression;
    if (current.kind === "string") return !literalHasTwoByte(current.value);
    const facts = info(current);
    if (facts.undefinedValue === true || facts.nullValue === true) return true;
    if (facts.speculative !== true && facts.bigint !== true) {
      const type = scalarType(current);
      if (type === "number" || type === "boolean") return true;
    }
    if (current.kind === "call" && facts.builtin === "string-convert") {
      const argument = current.arguments[0];
      if (argument === undefined) return true;
      if (argument.kind !== "spread")
        return isStaticallyOneByteString(argument);
    }
    return false;
  }
  function lowerStringPiece(leaf: Expression, parent: Expression): StringPiece {
    const literal = stringLiteralValue(leaf);
    if (literal !== undefined) return stringLiteralPiece(literal);
    const oneByte = isStaticallyOneByteString(leaf);
    return {
      slot: stringOperand(value(leaf), parent),
      oneByte,
      twoByte: false,
    };
  }
  /** The concatenation of `pieces` (at least one), in order: the piece
   * itself, one string-concat for two, and for more one allocation of the
   * total length and canonical kind (two-byte when some piece is) with each
   * piece written in turn, as join lowers, instead of an allocation and a
   * copy of the whole prefix per concatenation. Static literal lengths and
   * 1-byte/2-byte encoding facts fold at compile time. */
  function emitStringPieces(
    pieces: readonly StringPiece[],
    node: Expression,
  ): number {
    function emitLiteral(text: string): number {
      const id = nextValue++;
      emit({
        kind: "string-literal",
        id,
        value: text,
        start: node.start,
        end: node.end,
      });
      return id;
    }
    function materialize(piece: StringPiece): number {
      const literal = piece.literal;
      if (literal !== undefined)
        return save(emitLiteral(literal), "string", node);
      return piece.slot;
    }
    const active: StringPiece[] = [];
    for (const piece of pieces) {
      if (piece === undefined) throw "string piece invariant";
      if (piece.literal === "") continue;
      active.push(piece);
    }
    const first = active[0];
    if (first === undefined) return save(emitLiteral(""), "string", node);
    const second = active[1];
    if (second === undefined) return materialize(first);
    if (active.length === 2) {
      const firstLit = first.literal,
        secondLit = second.literal;
      if (firstLit !== undefined && secondLit !== undefined)
        return save(emitLiteral(firstLit + secondLit), "string", node);
      return save(
        emitStringConcat(materialize(first), materialize(second), node),
        "string",
        node,
      );
    }
    let allLiterals = true;
    for (const piece of active) {
      if (piece === undefined) throw "string piece invariant";
      if (piece.literal === undefined) {
        allLiterals = false;
        break;
      }
    }
    if (allLiterals) {
      let combined = "";
      for (const piece of active) {
        if (piece === undefined || piece.literal === undefined)
          throw "string piece invariant";
        combined += piece.literal;
      }
      return save(emitLiteral(combined), "string", node);
    }
    const lengths: number[] = [];
    let constantLength = 0,
      total = -1,
      knownTwoByte = false;
    const unknownWidth: number[] = [];
    for (const piece of active) {
      if (piece === undefined) throw "string piece invariant";
      if (piece.twoByte) knownTwoByte = true;
      const literal = piece.literal;
      if (literal !== undefined) {
        constantLength += literal.length;
        lengths.push(-1);
        continue;
      }
      const lengthId = nextValue++;
      emit({
        kind: "string-length",
        id: lengthId,
        string: load(piece.slot, node),
        start: node.start,
        end: node.end,
      });
      const length = save(lengthId, "number", node);
      lengths.push(length);
      total = total < 0 ? length : binarySlot("+", total, length, node);
      if (!piece.oneByte) unknownWidth.push(piece.slot);
    }
    if (constantLength > 0) {
      const constantSlot = numberSlot(constantLength, node);
      total =
        total < 0 ? constantSlot : binarySlot("+", total, constantSlot, node);
    }
    let twoByteValue: number;
    if (knownTwoByte || unknownWidth.length === 0) {
      twoByteValue = nextValue++;
      emit({
        kind: "constant",
        id: twoByteValue,
        value: knownTwoByte,
        start: node.start,
        end: node.end,
      });
    } else if (unknownWidth.length === 1) {
      const only = unknownWidth[0];
      if (only === undefined) throw "string piece invariant";
      twoByteValue = nextValue++;
      emit({
        kind: "string-two-byte",
        id: twoByteValue,
        string: load(only, node),
        start: node.start,
        end: node.end,
      });
    } else {
      let wide = -1;
      for (const slot of unknownWidth) {
        if (slot === undefined) throw "string piece invariant";
        const twoByteId = nextValue++;
        emit({
          kind: "string-two-byte",
          id: twoByteId,
          string: load(slot, node),
          start: node.start,
          end: node.end,
        });
        const flag = unarySlot(
          "boolean-number",
          save(twoByteId, "boolean", node),
          "number",
          node,
        );
        wide = wide < 0 ? flag : binarySlot("|", wide, flag, node);
      }
      twoByteValue = load(
        binarySlot("!==", wide, numberSlot(0, node), node),
        node,
      );
    }
    const allocated = nextValue++;
    emit({
      kind: "string-allocate",
      id: allocated,
      length: load(total, node),
      twoByte: twoByteValue,
      start: node.start,
      end: node.end,
    });
    const result = save(allocated, "string", node);
    let offsetSlot = -1,
      pendingConstant = 0;
    for (let index = 0; index < active.length; index++) {
      const piece = active[index],
        length = lengths[index];
      if (piece === undefined || length === undefined)
        throw "string piece invariant";
      let offsetValue: number;
      if (offsetSlot < 0) {
        offsetValue = nextValue++;
        emit({
          kind: "constant",
          id: offsetValue,
          value: pendingConstant,
          start: node.start,
          end: node.end,
        });
      } else {
        if (pendingConstant > 0) {
          offsetSlot = binarySlot(
            "+",
            offsetSlot,
            numberSlot(pendingConstant, node),
            node,
          );
          pendingConstant = 0;
        }
        offsetValue = load(offsetSlot, node);
      }
      const literal = piece.literal;
      const sourceValue =
        literal !== undefined ? emitLiteral(literal) : load(piece.slot, node);
      emit({
        kind: "string-write",
        target: load(result, node),
        offset: offsetValue,
        source: sourceValue,
        start: node.start,
        end: node.end,
      });
      if (index + 1 < active.length) {
        if (literal !== undefined) pendingConstant += literal.length;
        else if (offsetSlot < 0 && pendingConstant === 0) offsetSlot = length;
        else if (offsetSlot < 0) {
          offsetSlot = binarySlot(
            "+",
            numberSlot(pendingConstant, node),
            length,
            node,
          );
          pendingConstant = 0;
        } else offsetSlot = binarySlot("+", offsetSlot, length, node);
      }
    }
    return result;
  }
  /** Whether `node` is a typed string `+` whose operands convert to strings
   * without the general or speculative paths, so a chain of them can be
   * concatenated at once (stringChainLeaves). */
  function fusibleStringPlus(node: Expression): boolean {
    return (
      node.kind === "binary" &&
      node.operator === "+" &&
      scalarType(node) === "string" &&
      fusibleStringLeaf(node.left) &&
      fusibleStringLeaf(node.right)
    );
  }
  function fusibleStringLeaf(node: Expression): boolean {
    if (fusibleStringPlus(node)) return true;
    const type = scalarType(node),
      facts = info(node);
    return (
      (type === "string" || type === "number" || type === "boolean") &&
      facts.speculative !== true &&
      facts.bigint !== true
    );
  }
  /** The leaves of a fusible `+` chain, left to right, with the `+` whose
   * operand each is (it carries the number formatter binding). */
  function stringChainLeaves(
    node: Expression,
    leaves: StringChainLeaf[],
  ): void {
    if (node.kind !== "binary") throw "string chain invariant";
    stringChainOperand(node.left, node, leaves);
    stringChainOperand(node.right, node, leaves);
  }
  function stringChainOperand(
    operand: Expression,
    parent: Expression,
    leaves: StringChainLeaf[],
  ): void {
    if (operand.kind === "binary" && fusibleStringPlus(operand))
      stringChainLeaves(operand, leaves);
    else leaves.push({ leaf: operand, parent });
  }
  /** `x = x + a + b ...`: a fusible string chain of three or more operands
   * whose first operand reads the local it is assigned to. It is built as
   * `x + (a + b ...)`, an append of the rest fused into one piece, so a
   * loop of such appends builds its string in a buffer
   * (build-loop-strings). The operands are evaluated and converted in the
   * same order as the whole chain, and the rest's conversions to strings
   * are the ones the chain would make after a string. Undefined for any
   * other expression. */
  /** Whether evaluating `node` can assign no local: it holds no
   * assignment, update, function or class syntax (calls cannot assign an
   * uncaptured local). Conservative: other kinds answer false. */
  function assignmentFree(node: Expression): boolean {
    switch (node.kind) {
      case "identifier":
      case "number":
      case "string":
      case "boolean":
      case "null":
      case "this":
      case "new-target":
        return true;
      case "group":
      case "satisfies":
        return assignmentFree(node.expression);
      case "unary":
        return assignmentFree(node.operand);
      case "binary":
        return assignmentFree(node.left) && assignmentFree(node.right);
      case "conditional":
        return (
          assignmentFree(node.test) &&
          assignmentFree(node.consequent) &&
          assignmentFree(node.alternate)
        );
      case "member":
        return assignmentFree(node.object);
      case "index":
        return assignmentFree(node.object) && assignmentFree(node.index);
      case "call":
        return (
          assignmentFree(node.callee) &&
          node.arguments.every((argument) => assignmentFree(argument))
        );
      case "template-expression":
        return node.substitutions.every((part) => assignmentFree(part));
      default:
        return false;
    }
  }
  /** Whether `local` may be read after evaluating `pieces` instead of
   * before, as an append's left operand is: an uncaptured local (no cell,
   * so nothing else can write it) that the pieces do not assign. Loop
   * string builders then find the read next to its concatenation even
   * when a piece branches. */
  function readableAfter(
    local: number,
    pieces: readonly Expression[],
  ): boolean {
    return (
      ownedCells.every((cell) => cell === undefined || cell.local !== local) &&
      pieces.every((piece) => assignmentFree(piece))
    );
  }
  function appendedChain(node: Expression, local: number): number | undefined {
    if (
      node.kind !== "binary" ||
      node.operator !== "+" ||
      !fusibleStringPlus(node) ||
      node.left.kind !== "binary" ||
      !fusibleStringPlus(node.left)
    )
      return undefined;
    const leaves: StringChainLeaf[] = [];
    stringChainLeaves(node, leaves);
    const head = leaves[0];
    if (head === undefined) throw "string chain leaf invariant";
    const leaf = head.leaf;
    if (
      leaf.kind !== "identifier" ||
      info(leaf).local !== local ||
      info(leaf).realmGlobal !== undefined ||
      info(leaf).undefinedValue === true ||
      scalarType(leaf) !== "string"
    )
      return undefined;
    const tail: StringChainLeaf[] = [];
    for (let index = 1; index < leaves.length; index++) {
      const entry = leaves[index];
      if (entry === undefined) throw "string chain leaf invariant";
      tail.push(entry);
    }
    const late = readableAfter(
      local,
      tail.map((entry) => entry.leaf),
    );
    let first = late ? -1 : stringOperand(value(leaf), head.parent);
    const rest: StringPiece[] = [];
    for (const entry of tail)
      rest.push(lowerStringPiece(entry.leaf, entry.parent));
    if (late) first = stringOperand(value(leaf), head.parent);
    return save(
      emitStringConcat(first, emitStringPieces(rest, node), node),
      "string",
      node,
    );
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
  /** Write a BigInt value into `scratch[offset..offset+1]` as little-endian
   * 64-bit two's complement halves. */
  function emitBigIntToWord64(
    valueSlot: number,
    scratch: number,
    offset: number,
    node: Span,
  ): void {
    const coerced =
      slots[valueSlot] === "reference"
        ? valueSlot
        : save(
            coerce(load(valueSlot, node), "reference", node),
            "reference",
            node,
          );
    emit({
      kind: "call",
      id: undefined,
      target: bigIntRuntime().toWord64,
      arguments: [
        load(coerced, node),
        load(scratch, node),
        load(numberSlot(offset, node), node),
      ],
      start: node.start,
      end: node.end,
    });
  }
  /** Construct a BigIntValue from little-endian 64-bit halves in `scratch[0..1]`. */
  function emitBigIntFromWord64(
    scratch: number,
    signed: boolean,
    node: Span,
  ): number {
    const id = nextValue++;
    emit({
      kind: "call",
      id,
      target: bigIntRuntime().fromWord64,
      arguments: [load(scratch, node), load(booleanSlot(signed, node), node)],
      start: node.start,
      end: node.end,
    });
    const result = save(id, "reference", node);
    bigIntSlots[result] = 1;
    return result;
  }
  /** Bounds-checked typed-array element read returning optional-number (numeric
   * kinds) or optional-reference holding a BigIntValue (BigInt64/BigUint64). */
  function readArrayElement(array: number, index: number, node: Span): number {
    const arrayType = slots[array];
    if (typedArrayBigIntElements(arrayType)) {
      const scratch = word64Scratch(),
        valid = nextValue++;
      emit({
        kind: "array-word64-read",
        id: valid,
        array: load(array, node),
        index: load(index, node),
        scratch: load(scratch, node),
        start: node.start,
        end: node.end,
      });
      const hit = block(),
        miss = block(),
        done = block(),
        result = temporary("optional-reference");
      bigIntSlots[result] = 1;
      choose(valid, hit, miss, node);
      current = hit;
      const val = emitBigIntFromWord64(
          scratch,
          arrayType === "BigInt64Array",
          node,
        ),
        wrapped = nextValue++;
      emit({
        kind: "reference-wrap",
        id: wrapped,
        value: load(val, node),
        start: node.start,
        end: node.end,
      });
      store(result, wrapped, node);
      jump(done.id, node);
      current = miss;
      const none = nextValue++;
      emit({
        kind: "reference-none",
        id: none,
        start: node.start,
        end: node.end,
      });
      store(result, none, node);
      jump(done.id, node);
      current = done;
      return result;
    }
    const id = nextValue++;
    emit({
      kind: "array-read",
      id,
      array: load(array, node),
      index: load(index, node),
      start: node.start,
      end: node.end,
    });
    return save(id, "optional-number", node);
  }
  /** Bounds-checked typed-array element write for numeric or BigInt kinds. */
  function writeArrayElement(
    array: number,
    index: number,
    valueSlot: number,
    node: Span,
  ): void {
    if (typedArrayBigIntElements(slots[array])) {
      const scratch = word64Scratch();
      emitBigIntToWord64(valueSlot, scratch, 0, node);
      emit({
        kind: "array-word64-write",
        array: load(array, node),
        index: load(index, node),
        scratch: load(scratch, node),
        start: node.start,
        end: node.end,
      });
      return;
    }
    emit({
      kind: "array-write",
      array: load(array, node),
      index: load(index, node),
      value: numericInput(valueSlot, node),
      start: node.start,
      end: node.end,
    });
  }
  /** `Atomics.<property>(array, index, ...operands)` on a native integer
   * array, its arguments already evaluated: ValidateAtomicAccess (ToIndex,
   * then the length check) and the sequentially consistent access. */
  function atomicsCall(
    property: string,
    kind:
      | "Uint8Array"
      | "Int8Array"
      | "Uint16Array"
      | "Int16Array"
      | "Uint32Array"
      | "Int32Array"
      | "BigInt64Array"
      | "BigUint64Array",
    args: readonly number[],
    node: Span,
  ): number {
    const source = args[0],
      input = args[1];
    if (source === undefined || input === undefined)
      throw "atomics argument invariant";
    // A narrowed unknown keeps its general carrier: a native array, or a
    // realm typed array viewed natively.
    const array =
      slots[source] === "general"
        ? nativeArrayArgument(source, kind, node)
        : source;
    const operation = atomicOperation(property);
    const index = integerIndex(
      save(numericInput(input, node), "number", node),
      node,
    );
    // ValidateIntegerTypedArray, then ValidateAtomicAccess: a detached view
    // (length 0, a negative byte offset) throws TypeError for any index.
    const inBounds = save(
      load(binarySlot(">=", index, numberSlot(0, node), node), node),
      "boolean",
      node,
    );
    conditionalStore(
      inBounds,
      inBounds,
      () => binarySlot("<", index, arrayLength(array, node), node),
      node,
    );
    const valid = block(),
      invalid = block();
    choose(load(inBounds, node), valid, invalid, node);
    current = invalid;
    rejectDetached(array, node);
    throwNativeError("RangeError", "Invalid atomic access index", node);
    current = valid;
    if (kind === "BigInt64Array" || kind === "BigUint64Array") {
      const scratch = word64Scratch();
      const firstOperand = args[2];
      const secondOperand = args[3];
      if (firstOperand !== undefined)
        emitBigIntToWord64(firstOperand, scratch, 0, node);
      if (secondOperand !== undefined)
        emitBigIntToWord64(secondOperand, scratch, 2, node);
      emit({
        kind: "array-atomic-word64",
        operation,
        array: load(array, node),
        index: load(index, node),
        scratch: load(scratch, node),
        start: node.start,
        end: node.end,
      });
      if (operation === "store") {
        if (firstOperand === undefined) throw "atomics operand invariant";
        return firstOperand;
      }
      return emitBigIntFromWord64(scratch, kind === "BigInt64Array", node);
    }
    const values = args
      .slice(2)
      .map((operand) => save(numericInput(operand, node), "number", node));
    const id = operation === "store" ? undefined : nextValue++;
    emit({
      kind: "array-atomic",
      operation,
      id,
      array: load(array, node),
      index: load(index, node),
      operands: values.map((operand) => load(operand, node)),
      start: node.start,
      end: node.end,
    });
    if (id !== undefined) return save(id, "number", node);
    // Atomics.store returns ToIntegerOrInfinity(value) as a number: +0 for
    // NaN and either zero.
    const stored = values[0];
    if (stored === undefined) throw "atomics operand invariant";
    return binarySlot(
      "+",
      integerIndex(stored, node),
      numberSlot(0, node),
      node,
    );
  }
  /** Extract the raw external address of `array`'s backing buffer (`>= 0` for
   * a borrowed/shared buffer, `-1` for an ordinary owned buffer). */
  function arrayBufferExternalAddress(array: number, node: Span): number {
    const bufferId = nextValue++;
    emit({
      kind: "array-buffer",
      id: bufferId,
      array: load(array, node),
      start: node.start,
      end: node.end,
    });
    const buffer = save(bufferId, "reference", node),
      addressId = nextValue++;
    emit({
      kind: "c-memory",
      access: {
        operation: "address",
        type: { kind: "void" },
        offset: 0,
        minimum: 0,
      },
      id: addressId,
      arguments: [load(buffer, node)],
      start: node.start,
      end: node.end,
    });
    return save(addressId, "number", node);
  }
  /** Absolute byte offset of element `index` inside `array`'s backing buffer. */
  function arrayElementByteOffset(
    array: number,
    index: number,
    width: number,
    node: Span,
  ): number {
    const offsetId = nextValue++;
    emit({
      kind: "array-byte-offset",
      id: offsetId,
      array: load(array, node),
      start: node.start,
      end: node.end,
    });
    const baseOffset = save(offsetId, "number", node);
    return binarySlot(
      "+",
      baseOffset,
      binarySlot("*", index, numberSlot(width, node), node),
      node,
    );
  }
  /** `Atomics.wait(array, index, value, timeout?)` on native Int32Array or
   * BigInt64Array. Validates detached/shared before index bounds per spec. */
  function atomicsWaitCall(
    kind: "Int32Array" | "BigInt64Array",
    callee: number,
    args: readonly number[],
    node: Span,
  ): number {
    const source = args[0],
      indexArg = args[1],
      valueArg = args[2],
      timeoutArg = args[3];
    if (
      source === undefined ||
      indexArg === undefined ||
      valueArg === undefined
    )
      throw "atomics wait argument invariant";
    const array =
      slots[source] === "general"
        ? nativeArrayArgument(source, kind, node)
        : source;
    rejectDetached(array, node);
    const bufferAddress = arrayBufferExternalAddress(array, node);
    requireCondition(
      binarySlot(">=", bufferAddress, numberSlot(0, node), node),
      "TypeError",
      "Atomics.wait cannot be called in this context",
      node,
    );
    const index = integerIndex(
      save(numericInput(indexArg, node), "number", node),
      node,
    );
    const inBounds = save(
      load(binarySlot(">=", index, numberSlot(0, node), node), node),
      "boolean",
      node,
    );
    conditionalStore(
      inBounds,
      inBounds,
      () => binarySlot("<", index, arrayLength(array, node), node),
      node,
    );
    requireCondition(
      inBounds,
      "RangeError",
      "Invalid atomic access index",
      node,
    );
    const width = kind === "Int32Array" ? 4 : 8;
    const byteOffset = arrayElementByteOffset(array, index, width, node);
    let expectedLo: number;
    let expectedHi: number;
    if (kind === "Int32Array") {
      expectedLo = binarySlot(
        ">>>",
        save(numericInput(valueArg, node), "number", node),
        numberSlot(0, node),
        node,
      );
      expectedHi = numberSlot(0, node);
    } else {
      const scratch = word64Scratch();
      emitBigIntToWord64(valueArg, scratch, 0, node);
      const readLo = nextValue++,
        loVal = nextValue++,
        readHi = nextValue++,
        hiVal = nextValue++;
      emit({
        kind: "array-read",
        id: readLo,
        array: load(scratch, node),
        index: load(numberSlot(0, node), node),
        start: node.start,
        end: node.end,
      });
      emit({
        kind: "optional-value",
        id: loVal,
        value: readLo,
        start: node.start,
        end: node.end,
      });
      emit({
        kind: "array-read",
        id: readHi,
        array: load(scratch, node),
        index: load(numberSlot(1, node), node),
        start: node.start,
        end: node.end,
      });
      emit({
        kind: "optional-value",
        id: hiVal,
        value: readHi,
        start: node.start,
        end: node.end,
      });
      expectedLo = save(loVal, "number", node);
      expectedHi = save(hiVal, "number", node);
    }
    const timeout =
      timeoutArg === undefined
        ? numberSlot(Infinity, node)
        : save(numericInput(timeoutArg, node), "number", node);
    const resultId = nextValue++;
    emit({
      kind: "call",
      id: resultId,
      target: callee,
      arguments: [
        load(bufferAddress, node),
        load(byteOffset, node),
        load(numberSlot(width, node), node),
        load(expectedLo, node),
        load(expectedHi, node),
        load(timeout, node),
      ],
      start: node.start,
      end: node.end,
    });
    const result = save(resultId, "string", node);
    // An empty string signals a worker termination stop request observed while
    // parked: entering a natural loop in this worker function triggers codegen's
    // workerStopPoll() and throws the uncatchable worker-stop payload at once.
    const lenId = nextValue++;
    emit({
      kind: "string-length",
      id: lenId,
      string: load(result, node),
      start: node.start,
      end: node.end,
    });
    const interrupted = block(),
      done = block();
    choose(
      load(
        binarySlot(
          "===",
          save(lenId, "number", node),
          numberSlot(0, node),
          node,
        ),
        node,
      ),
      interrupted,
      done,
      node,
    );
    current = interrupted;
    jump(interrupted.id, node);
    current = done;
    return result;
  }
  /** `Atomics.notify(array, index, count?)` on native Int32Array or
   * BigInt64Array. Ordinary ArrayBuffers validate index and return 0. */
  function atomicsNotifyCall(
    kind: "Int32Array" | "BigInt64Array",
    callee: number,
    args: readonly number[],
    node: Span,
  ): number {
    const source = args[0],
      indexArg = args[1],
      countArg = args[2];
    if (source === undefined || indexArg === undefined)
      throw "atomics notify argument invariant";
    const array =
      slots[source] === "general"
        ? nativeArrayArgument(source, kind, node)
        : source;
    rejectDetached(array, node);
    const index = integerIndex(
      save(numericInput(indexArg, node), "number", node),
      node,
    );
    const inBounds = save(
      load(binarySlot(">=", index, numberSlot(0, node), node), node),
      "boolean",
      node,
    );
    conditionalStore(
      inBounds,
      inBounds,
      () => binarySlot("<", index, arrayLength(array, node), node),
      node,
    );
    requireCondition(
      inBounds,
      "RangeError",
      "Invalid atomic access index",
      node,
    );
    let count: number;
    if (countArg === undefined) count = numberSlot(Infinity, node);
    else if (slots[countArg] === "optional-number") {
      const present = nextValue++;
      emitPresence(present, load(countArg, node), false, node);
      const countSlot = numberSlot(Infinity, node);
      conditionalStore(
        save(present, "boolean", node),
        countSlot,
        () => save(numericInput(countArg, node), "number", node),
        node,
      );
      count = countSlot;
    } else count = save(numericInput(countArg, node), "number", node);
    const bufferAddress = arrayBufferExternalAddress(array, node);
    const width = kind === "Int32Array" ? 4 : 8;
    const byteOffset = arrayElementByteOffset(array, index, width, node);
    const resultId = nextValue++;
    emit({
      kind: "call",
      id: resultId,
      target: callee,
      arguments: [
        load(bufferAddress, node),
        load(byteOffset, node),
        load(numberSlot(width, node), node),
        load(count, node),
      ],
      start: node.start,
      end: node.end,
    });
    return save(resultId, "number", node);
  }
  /** TypeError when native typed array `array` is a detached view (its
   * data before its owner's, a negative byte offset). A detached view is
   * empty, so a nonempty array costs one length test. */
  function rejectDetached(array: number, node: Span): void {
    const empty = binarySlot(
      "===",
      arrayLength(array, node),
      numberSlot(0, node),
      node,
    );
    const check = block(),
      done = block();
    choose(load(empty, node), check, done, node);
    current = check;
    const offset = nextValue++;
    emit({
      kind: "array-byte-offset",
      id: offset,
      array: load(array, node),
      start: node.start,
      end: node.end,
    });
    requireCondition(
      binarySlot(">=", save(offset, "number", node), numberSlot(0, node), node),
      "TypeError",
      "Cannot perform this operation on a detached ArrayBuffer",
      node,
    );
    jump(done.id, node);
    current = done;
  }
  /** ValidateTypedArray for a native typed-array receiver slot: TypeError
   * when it is a detached view (other receivers are unchanged). */
  function rejectDetachedReceiver(receiver: number, node: Span): void {
    if (isNativeTypedArray(slots[receiver])) rejectDetached(receiver, node);
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
  /** `x as T` from a general value: one test per accepted category and
   * record layout; a value passing none throws a TypeError (an explicit
   * contract), and a passing value converts to T's representation. */
  function nativeErrorTest(
    value: number,
    error: "Error" | "RangeError" | "TypeError" | "ReferenceError",
    node: IRSpan,
  ): number {
    if (
      nodeErrors === undefined ||
      error === "ReferenceError" ||
      (error === "TypeError" && nodeErrors.type === undefined)
    )
      return intrinsicErrorTest(value, error, node);
    const candidates: (number | undefined)[] =
      error === "TypeError"
        ? [nodeErrors.type]
        : error === "RangeError"
          ? [nodeErrors.range]
          : [
              nodeErrors.coded,
              nodeErrors.range,
              nodeErrors.system,
              nodeErrors.type,
            ];
    const operand = save(value, "general", node);
    const yes = block(),
      done = block(),
      result = temporary("boolean");
    for (const record of candidates) {
      if (record === undefined) continue;
      const next = block();
      choose(
        errorRecordTest(load(operand, node), record, node),
        yes,
        next,
        node,
      );
      current = next;
    }
    store(result, intrinsicErrorTest(load(operand, node), error, node), node);
    jump(done.id, node);
    current = yes;
    store(result, load(booleanSlot(true, node), node), node);
    jump(done.id, node);
    current = done;
    return load(result, node);
  }
  function intrinsicErrorTest(
    value: number,
    error: "Error" | "RangeError" | "TypeError" | "ReferenceError",
    node: IRSpan,
  ): number {
    const layouts = realmErrors;
    if (layouts !== undefined) {
      if (error === "TypeError")
        return errorRecordTest(value, layouts.typeError, node);
      if (error === "RangeError")
        return errorRecordTest(value, layouts.rangeError, node);
      if (error === "ReferenceError")
        return errorRecordTest(value, layouts.referenceError, node);
      const candidates: number[] = [
        layouts.error,
        layouts.typeError,
        layouts.rangeError,
        layouts.referenceError,
      ];
      const operand = save(value, "general", node);
      const yes = block(),
        done = block(),
        result = temporary("boolean");
      for (const record of candidates) {
        if (record === undefined) throw "mixed error layout invariant";
        const next = block();
        choose(
          errorRecordTest(load(operand, node), record, node),
          yes,
          next,
          node,
        );
        current = next;
      }
      store(result, load(booleanSlot(false, node), node), node);
      jump(done.id, node);
      current = yes;
      store(result, load(booleanSlot(true, node), node), node);
      jump(done.id, node);
      current = done;
      return load(result, node);
    }
    const id = nextValue++;
    emit({
      kind: "error-is",
      error,
      id,
      value,
      start: node.start,
      end: node.end,
    });
    return id;
  }
  function emitPrivateRecordAccess(
    objectSlot: number,
    transferSlot: number,
    operation: "read" | "write",
    access: RecordAccess,
    node: Span,
    onFail: () => void,
  ): void {
    if (slots[objectSlot] === "reference") {
      recordAccess(objectSlot, transferSlot, operation, access, node, onFail);
      return;
    }
    const gen = save(
      coerce(load(objectSlot, node), "general", node),
      "general",
      node,
    );
    const done = block();
    for (const choice of access.choices) {
      if (choice === undefined) throw "private record choice invariant";
      const next = block(),
        matched = block();
      const isRecord = nextValue++;
      emit({
        kind: "general-record-is",
        id: isRecord,
        value: load(gen, node),
        record: choice.record,
        start: node.start,
        end: node.end,
      });
      choose(isRecord, matched, next, node);
      current = matched;
      const refSlot = save(
        coerce(load(gen, node), "reference", node),
        "reference",
        node,
      );
      recordAccess(
        refSlot,
        transferSlot,
        operation,
        { type: access.type, choices: [choice] },
        node,
        () => {
          jump(next.id, node);
        },
      );
      if (current !== undefined) jump(done.id, node);
      current = next;
    }
    onFail();
    if (current !== undefined) jump(done.id, node);
    current = done;
  }
  function requireStaticPrivateOwner(
    objectSlot: number,
    ownerLocal: number,
    name: string,
    operation: "read" | "write",
    node: Span,
  ): number {
    const owner = save(readLocal(ownerLocal, node), "reference", node);
    const same = binarySlot("===", objectSlot, owner, node);
    requireCondition(
      same,
      "TypeError",
      "Cannot " +
        operation +
        " private member " +
        name +
        " from an object whose class did not declare it",
      node,
    );
    return owner;
  }
  function emitPrivateAccess(
    objectSlot: number,
    plan: PrivateAccessPlan,
    operation: "read" | "write",
    transferSlot: number,
    node: Span,
  ): void {
    const failMessage =
      "Cannot " +
      operation +
      " private member " +
      plan.name +
      " from an object whose class did not declare it";
    const onFail = (): void => {
      throwNativeError("TypeError", failMessage, node);
    };
    if (plan.kind === "instance-field") {
      const access = plan.fieldAccess;
      if (access === undefined) throw "private instance field invariant";
      emitPrivateRecordAccess(
        objectSlot,
        transferSlot,
        operation,
        access,
        node,
        onFail,
      );
      return;
    }
    const ownerLocal = plan.ownerLocal;
    if (ownerLocal === undefined) throw "private owner local invariant";
    if (plan.kind === "static-field") {
      const owner = requireStaticPrivateOwner(
        objectSlot,
        ownerLocal,
        plan.name,
        operation,
        node,
      );
      const access = plan.staticFieldAccess;
      if (access === undefined) throw "private static field invariant";
      recordAccess(owner, transferSlot, operation, access, node, onFail);
      return;
    }
    if (plan.kind === "instance-method") {
      if (operation !== "read") throw "private method write invariant";
      const brand = plan.brandCheck,
        methodAccess = plan.methodAccess;
      if (brand === undefined || methodAccess === undefined)
        throw "private instance method invariant";
      const dummy = temporary("boolean");
      emitPrivateRecordAccess(objectSlot, dummy, "read", brand, node, onFail);
      const owner = save(readLocal(ownerLocal, node), "reference", node);
      recordAccess(owner, transferSlot, "read", methodAccess, node);
      return;
    }
    if (plan.kind === "static-method") {
      if (operation !== "read") throw "private static method write invariant";
      const owner = requireStaticPrivateOwner(
        objectSlot,
        ownerLocal,
        plan.name,
        "read",
        node,
      );
      const methodAccess = plan.methodAccess;
      if (methodAccess === undefined) throw "private static method invariant";
      recordAccess(owner, transferSlot, "read", methodAccess, node);
      return;
    }
    let owner: number;
    if (plan.kind === "instance-accessor") {
      const brand = plan.brandCheck;
      if (brand === undefined)
        throw "private instance accessor brand invariant";
      const dummy = temporary("boolean");
      emitPrivateRecordAccess(objectSlot, dummy, "read", brand, node, onFail);
      owner = save(readLocal(ownerLocal, node), "reference", node);
    } else {
      owner = requireStaticPrivateOwner(
        objectSlot,
        ownerLocal,
        plan.name,
        operation,
        node,
      );
    }
    const accessor = plan.accessor;
    const read = operation === "read";
    const closureAccess = read ? accessor?.get : accessor?.set;
    const target = read ? accessor?.getTarget : accessor?.setTarget;
    if (closureAccess === undefined || target === undefined)
      throw "private accessor closure invariant";
    const closure = temporary(closureAccess.type);
    recordAccess(owner, closure, "read", closureAccess, node);
    const signature = signatures[target];
    if (signature === undefined) throw "private accessor signature invariant";
    let callee = load(closure, node);
    if (valueTypes[callee] === "optional-reference") {
      const unwrapped = nextValue++;
      emitUnwrap(unwrapped, callee, "reference", node);
      callee = unwrapped;
    }
    const args: number[] = [];
    if (!read) {
      const parameter = signature.parameters[0];
      if (parameter === undefined) throw "private setter parameter invariant";
      args.push(coerce(load(transferSlot, node), parameter, node));
    }
    const call = callValue(callee, args),
      id = read ? nextValue++ : undefined;
    if (read && signature.returnType === "void")
      throw "private getter result invariant";
    emit({
      kind: "call-indirect",
      id,
      target,
      callee: call.callee,
      arguments: call.arguments,
      receiver: coerce(load(objectSlot, node), "general", node),
      start: node.start,
      end: node.end,
    });
    if (id !== undefined)
      store(transferSlot, coerce(id, plan.type, node), node);
  }
  function emitPrivateBrandCheck(
    node: Expression & { readonly kind: "private-in" },
    plan: PrivateBrandCheckPlan,
  ): number {
    const objectSlot = value(node.object);
    if (slots[objectSlot] !== "reference") {
      const receiver = save(
        coerce(load(objectSlot, node), "general", node),
        "general",
        node,
      );
      const valid = nextValue++;
      emit({
        kind: "general-is",
        id: valid,
        value: load(receiver, node),
        type: "object",
        start: node.start,
        end: node.end,
      });
      requireCondition(
        save(valid, "boolean", node),
        "TypeError",
        "Cannot use 'in' operator to search for '" +
          plan.name +
          "' in non-object",
        node,
      );
    }
    const result = temporary("boolean");
    if (plan.static) {
      const ownerLocal = plan.ownerLocal;
      if (ownerLocal === undefined) throw "static private-in owner invariant";
      const owner = save(readLocal(ownerLocal, node), "reference", node);
      const same = binarySlot("===", objectSlot, owner, node);
      const check = plan.check;
      if (check === undefined) return same;
      const matched = block(),
        rejected = block(),
        done = block();
      choose(load(same, node), matched, rejected, node);
      current = matched;
      const dummy = temporary(check.type);
      const found = block();
      recordAccess(owner, dummy, "read", check, node, () => {
        jump(rejected.id, node);
      });
      if (current !== undefined) jump(found.id, node);
      current = found;
      const yes = nextValue++;
      emit({
        kind: "constant",
        id: yes,
        value: true,
        start: node.start,
        end: node.end,
      });
      store(result, yes, node);
      jump(done.id, node);
      current = rejected;
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
      current = done;
      return result;
    }
    const check = plan.check;
    if (check === undefined) throw "instance private-in check invariant";
    const dummy = temporary(check.type),
      matched = block(),
      rejected = block(),
      done = block();
    emitPrivateRecordAccess(objectSlot, dummy, "read", check, node, () => {
      jump(rejected.id, node);
    });
    if (current !== undefined) jump(matched.id, node);
    current = matched;
    const yes = nextValue++;
    emit({
      kind: "constant",
      id: yes,
      value: true,
      start: node.start,
      end: node.end,
    });
    store(result, yes, node);
    jump(done.id, node);
    current = rejected;
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
    current = done;
    return result;
  }
  function classInstanceOf(
    node: Expression & { readonly kind: "binary" },
    test: ClassInstanceTest,
  ): number {
    const operand = value(node.left),
      constructor = value(node.right);
    const prototype = temporary("reference");
    recordAccess(constructor, prototype, "read", test.prototype, node);
    const result = temporary("boolean"),
      linked = temporary("reference"),
      matched = block(),
      rejected = block(),
      done = block();
    const emptyChain: readonly {
      readonly record: number;
      readonly linkField: number;
    }[] = [];
    const members: readonly {
      readonly instance: number;
      readonly prototypeField: number;
      readonly prototypeChain: readonly {
        readonly record: number;
        readonly linkField: number;
      }[];
    }[] = test.family ?? [
      {
        instance: test.instance,
        prototypeField: test.prototypeField,
        prototypeChain: emptyChain,
      },
    ];
    const general =
      slots[operand] === "reference"
        ? undefined
        : save(coerce(load(operand, node), "general", node), "general", node);
    for (const member of members) {
      if (member === undefined) throw "class instanceof family invariant";
      const nextMember = block();
      let object: number;
      if (general === undefined) object = load(operand, node);
      else {
        const isRecord = nextValue++;
        emit({
          kind: "general-record-is",
          id: isRecord,
          value: load(general, node),
          record: member.instance,
          start: node.start,
          end: node.end,
        });
        const instanceBlock = block();
        choose(isRecord, instanceBlock, nextMember, node);
        current = instanceBlock;
        object = coerce(load(general, node), "reference", node);
      }
      const checkProto = block();
      finish({
        kind: "record",
        object,
        record: member.instance,
        field: member.prototypeField,
        operation: "read",
        slot: linked,
        consequent: checkProto.id,
        alternate: nextMember.id,
        start: node.start,
        end: node.end,
      });
      current = checkProto;
      for (let step = 0; step <= member.prototypeChain.length; step++) {
        const same = nextValue++;
        emit({
          kind: "binary",
          operator: "===",
          id: same,
          left: load(linked, node),
          right: load(prototype, node),
          start: node.start,
          end: node.end,
        });
        const link = member.prototypeChain[step];
        if (link === undefined) {
          choose(same, matched, rejected, node);
          break;
        }
        const walk = block();
        choose(same, matched, walk, node);
        current = walk;
        const nextProto = block();
        finish({
          kind: "record",
          object: load(linked, node),
          record: link.record,
          field: link.linkField,
          operation: "read",
          slot: linked,
          consequent: nextProto.id,
          alternate: rejected.id,
          start: node.start,
          end: node.end,
        });
        current = nextProto;
      }
      current = nextMember;
    }
    jump(rejected.id, node);
    current = matched;
    store(result, load(booleanSlot(true, node), node), node);
    jump(done.id, node);
    current = rejected;
    store(result, load(booleanSlot(false, node), node), node);
    jump(done.id, node);
    current = done;
    return result;
  }
  function errorRecordTest(
    value: number,
    record: number,
    node: IRSpan,
  ): number {
    const id = nextValue++;
    emit({
      kind: "general-record-is",
      id,
      value,
      record,
      start: node.start,
      end: node.end,
    });
    return id;
  }
  function newNativeError(
    error: "Error" | "RangeError" | "TypeError" | "ReferenceError",
    message: number,
    present: number | undefined,
    node: IRSpan,
  ): number {
    const layouts = realmErrors;
    if (layouts !== undefined) {
      const record =
        error === "TypeError"
          ? layouts.typeError
          : error === "RangeError"
            ? layouts.rangeError
            : error === "ReferenceError"
              ? layouts.referenceError
              : layouts.error;
      const flag = load(present ?? booleanSlot(true, node), node);
      const args: (number | undefined)[] = [message, flag, undefined];
      const id = nextValue++;
      emit({
        kind: "record-new",
        id,
        record,
        arguments: args,
        start: node.start,
        end: node.end,
      });
      return id;
    }
    const id = nextValue++;
    emit({
      kind: "error-new",
      id,
      error,
      message,
      start: node.start,
      end: node.end,
    });
    return id;
  }
  function realmErrorOperation(
    operand: number,
    operation: string,
    node: Span,
  ): number {
    const runtime = realmErrors;
    if (runtime === undefined) throw "error realm operation invariant";
    const target = runtime.operation;
    const args: number[] = [operand, errorString(operation, node)];
    const result = runtimeCall(target, args, node);
    if (result === undefined) throw "error realm result invariant";
    return result;
  }
  function exposedError(operand: number, node: Span): number {
    const runtime = realmErrors;
    if (runtime === undefined) throw "error realm view invariant";
    const result = runtimeCall(runtime.view, [operand], node);
    if (result === undefined) throw "error view result invariant";
    return result;
  }
  function mayCarryError(slot: number): boolean {
    const type = slots[slot];
    return (
      type === "general" ||
      type === "reference" ||
      type === "optional-reference"
    );
  }
  function errorInstanceOf(
    operand: number,
    error: "Error" | "RangeError" | "TypeError",
    node: Span,
  ): number {
    if (realmErrors === undefined)
      return save(
        nativeErrorTest(
          coerce(load(operand, node), "general", node),
          error,
          node,
        ),
        "boolean",
        node,
      );
    const result = temporary("boolean");
    const answer = realmErrorOperation(
      exposedError(operand, node),
      error,
      node,
    );
    const semantic = block(),
      native = block(),
      done = block();
    choose(nonNullish(answer, node), semantic, native, node);
    current = semantic;
    store(result, coerce(load(answer, node), "boolean", node), node);
    jump(done.id, node);
    current = native;
    store(
      result,
      nativeErrorTest(
        coerce(load(operand, node), "general", node),
        error,
        node,
      ),
      node,
    );
    jump(done.id, node);
    current = done;
    return result;
  }
  function errorString(text: string, node: IRSpan): number {
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
  function nativeOrStructuralErrorProperty(
    node: Expression & { readonly kind: "member" },
    operand: number,
  ): number {
    const access = records?.accesses.get(node);
    if (access === undefined || access.choices.length === 0) {
      if (realmErrors !== undefined) {
        const receiver = coerce(load(operand, node), "general", node);
        const native = nativeErrorTest(receiver, "Error", node);
        requireCondition(
          save(native, "boolean", node),
          "TypeError",
          "Error property access requires a native error or a realm view",
          node,
        );
      }
      return nativeErrorProperty(operand, node.property, node);
    }
    const result = temporary(access.type);
    const native = block(),
      structural = block(),
      done = block();
    const receiver = coerce(load(operand, node), "general", node);
    choose(nativeErrorTest(receiver, "Error", node), native, structural, node);
    current = native;
    store(
      result,
      load(nativeErrorProperty(operand, node.property, node), node),
      node,
    );
    jump(done.id, node);
    current = structural;
    recordAccess(
      operand,
      result,
      "read",
      access,
      node,
      node.property !== "stack"
        ? undefined
        : (): void => {
            const id = nextValue++;
            emit({
              kind: "string-none",
              id,
              start: node.start,
              end: node.end,
            });
            store(result, id, node);
          },
    );
    jump(done.id, node);
    current = done;
    return result;
  }
  function errorProperty(
    node: Expression & { readonly kind: "member" },
  ): number {
    const operand = value(node.object);
    if (realmErrors === undefined) {
      const runtime = dynamicObjects;
      if (
        runtime === undefined ||
        info(node).arrayMethod === undefined ||
        records?.accesses.get(node) !== undefined
      )
        return nativeOrStructuralErrorProperty(node, operand);
      const result = temporary(
        node.property === "stack" ? "optional-string" : "string",
      );
      const native = block(),
        realm = block(),
        done = block();
      choose(
        nativeErrorTest(
          coerce(load(operand, node), "general", node),
          "Error",
          node,
        ),
        native,
        realm,
        node,
      );
      current = native;
      store(
        result,
        load(nativeErrorProperty(operand, node.property, node), node),
        node,
      );
      jump(done.id, node);
      current = realm;
      const read = dynamicResult(
        runtime.read,
        [operand, stringSlot(node.property, node)],
        node,
      );
      store(result, load(read, node), node);
      jump(done.id, node);
      current = done;
      return result;
    }
    const exposed = exposedError(operand, node);
    const type: ScalarType =
      node.property === "stack" ? "optional-string" : "string";
    const result = temporary(type);
    const semantic = block(),
      native = block(),
      done = block();
    choose(
      truth(realmErrorOperation(exposed, "attached", node), node),
      semantic,
      native,
      node,
    );
    current = semantic;
    const read = realmErrorOperation(exposed, node.property, node);
    store(result, coerce(load(read, node), type, node), node);
    jump(done.id, node);
    current = native;
    store(
      result,
      load(nativeOrStructuralErrorProperty(node, operand), node),
      node,
    );
    jump(done.id, node);
    current = done;
    return result;
  }
  function nativeErrorProperty(
    operand: number,
    property: string,
    node: Span,
  ): number {
    if (property === "name") return errorName(operand, node);
    if (property === "stack") {
      const id = nextValue++;
      emit({ kind: "string-none", id, start: node.start, end: node.end });
      return save(id, "optional-string", node);
    }
    const input = load(operand, node),
      id = nextValue++;
    emit({
      kind: "error-message",
      id,
      value: input,
      start: node.start,
      end: node.end,
    });
    return save(id, "string", node);
  }
  function errorName(operand: number, node: IRSpan): number {
    const result = temporary("string");
    const done = block();
    const kinds: ("TypeError" | "RangeError" | "ReferenceError")[] = [
      "TypeError",
      "RangeError",
      "ReferenceError",
    ];
    for (const kind of kinds) {
      if (kind === undefined) throw "error kind invariant";
      const matches = nativeErrorTest(
        coerce(load(operand, node), "general", node),
        kind,
        node,
      );
      const yes = block(),
        no = block();
      choose(matches, yes, no, node);
      current = yes;
      store(result, load(errorString(kind, node), node), node);
      jump(done.id, node);
      current = no;
    }
    const system = nodeErrors?.system;
    if (system !== undefined) {
      const yes = block(),
        no = block();
      choose(
        errorRecordTest(
          coerce(load(operand, node), "general", node),
          system,
          node,
        ),
        yes,
        no,
        node,
      );
      current = yes;
      store(result, load(errorString("SystemError", node), node), node);
      jump(done.id, node);
      current = no;
    }
    store(result, load(errorString("Error", node), node), node);
    jump(done.id, node);
    current = done;
    return result;
  }
  function rawPropertyField(
    object: number,
    record: number,
    field: number,
    type: ScalarType,
    node: Span,
  ): number {
    const slot = temporary(type),
      read = block(),
      wrong = block();
    finish({
      kind: "record",
      object,
      record,
      field,
      operation: "read",
      slot,
      consequent: read.id,
      alternate: wrong.id,
      start: node.start,
      end: node.end,
    });
    current = wrong;
    finish({ kind: "trap", start: node.start, end: node.end });
    current = read;
    return slot;
  }
  function fieldPresent(
    object: number,
    record: number,
    field: number,
    node: Span,
  ): number {
    const id = nextValue++;
    emit({
      kind: "record-has",
      id,
      object,
      record,
      field,
      start: node.start,
      end: node.end,
    });
    return id;
  }
  function nativeProperty(
    operand: number,
    property: string,
    membership: boolean,
    node: Expression,
  ): number {
    const type: ScalarType = membership ? "boolean" : "general";
    const result = temporary(type),
      done = block();
    const general = save(
      coerce(load(operand, node), "general", node),
      "general",
      node,
    );
    const reference = (): number =>
      coerce(load(general, node), "reference", node);
    function answer(raw: number): void {
      store(result, load(raw, node), node);
      jump(done.id, node);
    }
    function chooseRecord(record: number): Builder {
      const yes = block(),
        next = block();
      choose(
        errorRecordTest(load(general, node), record, node),
        yes,
        next,
        node,
      );
      current = yes;
      return next;
    }
    const coded = nodeErrors?.coded,
      range = nodeErrors?.range,
      system = nodeErrors?.system;
    if (property === "code") {
      for (const record of [coded, range, system, nodeErrors?.type]) {
        if (record === undefined) continue;
        const next = chooseRecord(record);
        answer(
          membership
            ? booleanSlot(true, node)
            : rawPropertyField(reference(), record, 1, "string", node),
        );
        current = next;
      }
    }
    if (property === "errno" && coded !== undefined) {
      const next = chooseRecord(coded);
      answer(
        membership
          ? save(fieldPresent(reference(), coded, 2, node), "boolean", node)
          : rawPropertyField(reference(), coded, 2, "optional-number", node),
      );
      current = next;
    }
    const details = nodeErrors?.info;
    if (
      system !== undefined &&
      details !== undefined &&
      (property === "info" || property === "errno" || property === "syscall")
    ) {
      const next = chooseRecord(system);
      if (membership) answer(booleanSlot(true, node));
      else {
        const context = rawPropertyField(
          reference(),
          system,
          2,
          "reference",
          node,
        );
        answer(
          property === "info"
            ? context
            : rawPropertyField(
                load(context, node),
                details,
                property === "errno" ? 0 : 3,
                property === "errno" ? "number" : "string",
                node,
              ),
        );
      }
      current = next;
    }
    for (const field of records?.accesses.get(node)?.choices ?? []) {
      if (field === undefined) throw "literal property layout invariant";
      const next = chooseRecord(field.record);
      // An accessor is always present (on the prototype); a read calls it.
      const accessor = field.accessor;
      if (accessor !== undefined) {
        if (membership) answer(booleanSlot(true, node));
        else {
          const value = temporary("general");
          accessorCall(
            reference(),
            field,
            accessor,
            value,
            "read",
            "general",
            next.id,
            node,
          );
          answer(value);
        }
        current = next;
        continue;
      }
      function readField(receiver: number, field: RecordAccessChoice): void {
        const inherited = field.prototype;
        const present = fieldPresent(
          load(receiver, node),
          field.record,
          field.field,
          node,
        );
        const own = block(),
          absent = block();
        choose(present, own, absent, node);
        current = own;
        answer(
          membership
            ? booleanSlot(true, node)
            : rawPropertyField(
                load(receiver, node),
                field.record,
                field.field,
                field.type,
                node,
              ),
        );
        current = absent;
        if (inherited === undefined) jump(next.id, node);
        else {
          const prototype = rawPropertyField(
            load(receiver, node),
            field.record,
            inherited.field,
            "reference",
            node,
          );
          const parentField = inherited.access.choices[0];
          if (parentField === undefined)
            throw "literal property prototype invariant";
          readField(prototype, parentField);
        }
      }
      readField(save(reference(), "reference", node), field);
      current = next;
    }
    if (membership && (property === "name" || property === "message"))
      answer(
        save(
          nativeErrorTest(load(general, node), "Error", node),
          "boolean",
          node,
        ),
      );
    else if (membership) answer(booleanSlot(false, node));
    else {
      const id = nextValue++;
      emit({ kind: "general-none", id, start: node.start, end: node.end });
      answer(save(id, "general", node));
    }
    current = done;
    return result;
  }
  function literalPropertyOperation(
    operand: number,
    property: string,
    membership: boolean,
    node: Expression,
  ): number {
    if (realmErrors === undefined)
      return nativeProperty(operand, property, membership, node);
    const exposed = exposedError(operand, node);
    const result = temporary(membership ? "boolean" : "general");
    const semantic = block(),
      native = block(),
      done = block();
    choose(
      truth(realmErrorOperation(exposed, "attached", node), node),
      semantic,
      native,
      node,
    );
    current = semantic;
    const value = realmErrorOperation(
      exposed,
      (membership ? "has:" : "get:") + property,
      node,
    );
    store(result, load(value, node), node);
    jump(done.id, node);
    current = native;
    store(
      result,
      load(nativeProperty(operand, property, membership, node), node),
      node,
    );
    jump(done.id, node);
    current = done;
    return result;
  }
  /** A speculative carrier reaching typed storage crosses a checked contract.
   * Open locals and expressions have general slots, so they never project here. */
  function requireSpeculativeContract(
    input: number,
    type: ScalarType,
    node: IRSpan,
  ): void {
    const tests: DowncastTest[] = [];
    switch (type) {
      case "number":
        tests.push("number");
        break;
      case "string":
        tests.push("string");
        break;
      case "boolean":
        tests.push("boolean");
        break;
      case "Uint8Array":
        tests.push("Uint8Array");
        break;
      case "optional-number":
        tests.push("undefined", "number");
        break;
      case "optional-string":
        tests.push("undefined", "string");
        break;
      case "optional-boolean":
        tests.push("undefined", "boolean");
        break;
      case "primitive":
        tests.push("undefined", "null", "string", "number", "boolean");
        break;
      default:
        throw "speculative value requires a testable written contract";
    }
    const accepted = block();
    for (const type of tests) {
      if (type === undefined) throw "speculative contract category invariant";
      const id = nextValue++,
        rejected = block();
      emit({
        kind: "general-is",
        id,
        value: load(input, node),
        type,
        start: node.start,
        end: node.end,
      });
      choose(id, accepted, rejected, node);
      current = rejected;
    }
    requireCondition(
      booleanSlot(false, node),
      "TypeError",
      "value does not match its declared type",
      node,
    );
    jump(accepted.id, node);
    current = accepted;
  }
  function speculativePropertyRead(
    node: Expression & { readonly kind: "member" | "index" },
  ): number {
    const runtime = dynamicObjects;
    if (runtime === undefined)
      throw "speculative property read requires the program realm";
    return dynamicResult(
      runtime.read,
      [value(node.object), dynamicKey(node)],
      node,
    );
  }
  function speculativeBinaryOperation(
    node: Expression & { readonly kind: "binary" },
    left: number,
    right: number,
  ): number {
    const helper = dynamicObjects?.speculativeBinary;
    if (helper === undefined)
      throw "speculative binary operation requires the program realm";
    // Without realm error views (a typed-only build) no error view exists
    // to substitute; identity compares the values themselves.
    const identity =
      realmErrors !== undefined &&
      (node.operator === "===" ||
        node.operator === "!==" ||
        node.operator === "==" ||
        node.operator === "!=");
    const result = dynamicResult(
      helper,
      [
        stringSlot(node.operator, node),
        identity && mayCarryError(left) ? exposedError(left, node) : left,
        identity && mayCarryError(right) ? exposedError(right, node) : right,
      ],
      node,
    );
    const type = scalarType(node);
    return type === "general"
      ? result
      : save(coerce(load(result, node), type, node), type, node);
  }
  function flowPropertyRead(
    node: Expression & { readonly kind: "member" | "index" },
  ): number {
    const object = value(node.object);
    if (node.kind === "index") value(node.index);
    const key = info(node).propertyKey;
    if (key === undefined) throw "flow property key invariant";
    const raw = literalPropertyOperation(object, key, false, node);
    const type = scalarType(node);
    if (type === "general") return raw;
    const bigintRecord = info(node).bigIntRecord;
    let matches: number;
    if (type === "reference" && bigintRecord !== undefined)
      matches = errorRecordTest(load(raw, node), bigintRecord, node);
    else {
      let test: DowncastTest;
      if (info(node).undefinedValue === true) test = "undefined";
      else if (type === "string" || type === "number" || type === "boolean")
        test = type;
      else throw "flow property read requires a testable narrowed type";
      matches = nextValue++;
      emit({
        kind: "general-is",
        id: matches,
        value: load(raw, node),
        type: test,
        start: node.start,
        end: node.end,
      });
    }
    requireCondition(
      save(matches, "boolean", node),
      "TypeError",
      "Property " + key + " no longer matches its narrowed type",
      node,
    );
    return save(coerce(load(raw, node), type, node), type, node);
  }
  function errorMessage(
    argument: Expression | undefined,
    node: Span,
    presence?: number,
  ): number {
    if (argument === undefined) {
      if (presence !== undefined)
        store(presence, load(booleanSlot(false, node), node), node);
      return errorString("", node);
    }
    const input = value(argument);
    if (slots[input] === "string") {
      if (presence !== undefined)
        store(presence, load(booleanSlot(true, node), node), node);
      return input;
    }
    if (undefinedSlots[input] === 1) {
      if (presence !== undefined)
        store(presence, load(booleanSlot(false, node), node), node);
      return errorString("", node);
    }
    const result = temporary("string");
    const yes = block(),
      no = block(),
      done = block();
    const presentTest = nonNullish(input, node);
    if (presence !== undefined) store(presence, presentTest, node);
    choose(presentTest, yes, no, node);
    current = yes;
    const present = load(input, node),
      unwrapped = nextValue++;
    emitUnwrap(unwrapped, present, "string", node);
    store(result, unwrapped, node);
    jump(done.id, node);
    current = no;
    store(result, load(errorString("", node), node), node);
    jump(done.id, node);
    current = done;
    return result;
  }
  function checkedDowncast(
    operand: number,
    node: Expression,
    downcast: CheckedDowncast,
  ): number {
    if (slots[operand] !== "general")
      throw "downcast operand representation invariant";
    // Values are block-local: each test block reloads the operand slot.
    const matched =
      downcast.sharedBuffer === true
        ? save(coerce(load(operand, node), "general", node), "general", node)
        : operand;
    const accepted = block();
    for (const test of downcast.tests) {
      if (test === undefined) throw "downcast test invariant";
      let matchId: number;
      if (test === "Uint8Array")
        matchId = load(
          nativeTypedArrayInstanceTest(operand, "Uint8Array", node),
          node,
        );
      else {
        matchId = nextValue++;
        emit({
          kind: "general-is",
          id: matchId,
          value: load(operand, node),
          type: test,
          start: node.start,
          end: node.end,
        });
      }
      const next = block();
      choose(matchId, accepted, next, node);
      current = next;
    }
    if (downcast.sharedBuffer === true) {
      const next = block();
      choose(
        load(nativeSharedArrayBufferTest(operand, node), node),
        accepted,
        next,
        node,
      );
      current = next;
      const project = dynamicObjects?.projectSharedArrayBuffer;
      if (project !== undefined) {
        const projected = dynamicResult(project, [operand], node);
        const acceptProjected = block(),
          rejectProjected = block();
        choose(
          load(nativeArrayTest(projected, "Uint8Array", node), node),
          acceptProjected,
          rejectProjected,
          node,
        );
        current = acceptProjected;
        store(matched, load(projected, node), node);
        jump(accepted.id, node);
        current = rejectProjected;
      }
    }
    for (const record of downcast.records) {
      if (record === undefined) throw "downcast record invariant";
      const id = nextValue++;
      emit({
        kind: "general-record-is",
        id,
        value: load(operand, node),
        record,
        start: node.start,
        end: node.end,
      });
      const next = block();
      choose(id, accepted, next, node);
      current = next;
    }
    const errors = downcast.errors;
    if (errors !== undefined) {
      const rejected = realmErrors === undefined ? undefined : block();
      if (rejected !== undefined) {
        const receiver = exposedError(operand, node);
        const attached = truth(
          realmErrorOperation(receiver, "attached", node),
          node,
        );
        const semantic = block(),
          native = block();
        choose(attached, semantic, native, node);
        current = semantic;
        const contract = truth(
          realmErrorOperation(receiver, "contract", node),
          node,
        );
        choose(contract, accepted, rejected, node);
        current = native;
      }
      for (const error of errors) {
        if (error === undefined) throw "downcast error invariant";
        const matches = nativeErrorTest(load(operand, node), error, node);
        const next = block();
        choose(matches, accepted, next, node);
        current = next;
      }
      if (rejected !== undefined) {
        jump(rejected.id, node);
        current = rejected;
      }
    }
    throwNativeError(
      "TypeError",
      "value does not match the asserted type",
      node,
    );
    current = accepted;
    const type = scalarType(node);
    return save(coerce(load(matched, node), type, node), type, node);
  }
  function requireRange(condition: number, node: Span): void {
    requireCondition(condition, "RangeError", "Invalid range", node);
  }
  /** ToIndex of an optional typed number argument; absent is `fallback`. */
  function argumentIndex(
    argument: number | undefined,
    fallback: () => number,
    node: Span,
  ): number {
    if (argument === undefined || undefinedSlots[argument] === 1)
      return fallback();
    const index = integerIndex(
      save(numericInput(argument, node), "number", node),
      node,
    );
    requireRange(binarySlot(">=", index, numberSlot(0, node), node), node);
    requireRange(
      binarySlot("<=", index, numberSlot(9007199254740991, node), node),
      node,
    );
    if (slots[argument] === "optional-number") {
      const present = nextValue++;
      emitPresence(present, load(argument, node), false, node);
      conditionalStore(
        unarySlot("!", save(present, "boolean", node), "boolean", node),
        index,
        fallback,
        node,
      );
    }
    return index;
  }
  /** `new ArrayBuffer(length)`: a zeroed owned byte array, typed as the
   * buffer it roots. */
  function arrayBufferNew(node: Expression & { readonly kind: "new" }): number {
    const size = node.arguments[0];
    const length = argumentIndex(
      size === undefined ? undefined : value(size),
      () => numberSlot(0, node),
      node,
    );
    const array = nextValue++;
    emit({
      kind: "array-new",
      id: array,
      type: "Uint8Array",
      length: load(length, node),
      start: node.start,
      end: node.end,
    });
    const owned = save(array, "Uint8Array", node),
      buffer = nextValue++;
    emit({
      kind: "array-buffer",
      id: buffer,
      array: load(owned, node),
      start: node.start,
      end: node.end,
    });
    return save(buffer, "reference", node);
  }
  /** `new SharedArrayBuffer(length)` (a fixed-length buffer): a new block
   * of the isolate's shared block service (the checker's callee), whose
   * payload a borrowed byte array views without ever moving, typed as the
   * buffer it roots. */
  function sharedArrayBufferNew(
    node: Expression & { readonly kind: "new" },
  ): number {
    const size = node.arguments[0];
    const length = argumentIndex(
      size === undefined ? undefined : value(size),
      () => numberSlot(0, node),
      node,
    );
    const allocator = info(node).callee;
    if (allocator === undefined) throw "shared block allocator invariant";
    const address = nextValue++;
    emit({
      kind: "call",
      id: address,
      target: allocator,
      arguments: [load(length, node)],
      start: node.start,
      end: node.end,
    });
    const payload = save(address, "number", node),
      empty = nextValue++;
    emit({
      kind: "array-new",
      id: empty,
      type: "Uint8Array",
      length: load(numberSlot(0, node), node),
      start: node.start,
      end: node.end,
    });
    const owned = save(empty, "Uint8Array", node),
      adopted = nextValue++;
    const operands: number[] = [
      load(owned, node),
      load(payload, node),
      load(length, node),
    ];
    emit({
      kind: "c-memory",
      access: {
        operation: "adopt",
        type: { kind: "void" },
        offset: 0,
        minimum: 0,
      },
      id: adopted,
      arguments: operands,
      start: node.start,
      end: node.end,
    });
    const borrowed = save(adopted, "Uint8Array", node),
      buffer = nextValue++;
    emit({
      kind: "array-buffer",
      id: buffer,
      array: load(borrowed, node),
      start: node.start,
      end: node.end,
    });
    return save(buffer, "reference", node);
  }
  /** `new T(buffer, byteOffset?, length?)` (InitializeTypedArrayFromArrayBuffer
   * for a fixed-length buffer): the offset must be a multiple of the element
   * width; without a length the view runs to the buffer's end, which must
   * fall on an element boundary; with one, the view must fit. */
  function arrayViewBytes(
    node: Expression & { readonly kind: "new" },
    type: NativeTypedArray,
  ): number {
    const width: number = typedArrayLayout(type).elementBytes;
    const source = node.arguments[0],
      offsetArgument = node.arguments[1],
      lengthArgument = node.arguments[2];
    if (source === undefined) throw "array view buffer invariant";
    const rawBuffer = value(source),
      offsetInput =
        offsetArgument === undefined ? undefined : value(offsetArgument),
      lengthInput =
        lengthArgument === undefined ? undefined : value(lengthArgument),
      buffer =
        slots[rawBuffer] === "general"
          ? nativeSharedArrayBufferArgument(rawBuffer, node)
          : rawBuffer;
    const zero = numberSlot(0, node),
      elementBytes = numberSlot(width, node);
    const offset = argumentIndex(offsetInput, () => zero, node);
    if (width > 1)
      requireCondition(
        binarySlot(
          "===",
          binarySlot("%", offset, elementBytes, node),
          zero,
          node,
        ),
        "RangeError",
        "start offset of " + type + " should be a multiple of " + String(width),
        node,
      );
    const byteLengthId = nextValue++;
    emit({
      kind: "array-buffer-byte-length",
      id: byteLengthId,
      buffer: load(buffer, node),
      start: node.start,
      end: node.end,
    });
    const bytes = save(byteLengthId, "number", node);
    // The view's element count when no length is given.
    function remaining(): number {
      if (width > 1)
        requireCondition(
          binarySlot(
            "===",
            binarySlot("%", bytes, elementBytes, node),
            zero,
            node,
          ),
          "RangeError",
          "byte length of " +
            type +
            " should be a multiple of " +
            String(width),
          node,
        );
      requireCondition(
        binarySlot("<=", offset, bytes, node),
        "RangeError",
        "start offset is outside the bounds of the buffer",
        node,
      );
      return binarySlot(
        "/",
        binarySlot("-", bytes, offset, node),
        elementBytes,
        node,
      );
    }
    const length = argumentIndex(lengthInput, remaining, node);
    if (lengthInput !== undefined && undefinedSlots[lengthInput] !== 1) {
      // An explicit length must fit: checked again for an absent optional
      // length, where it holds by construction.
      requireCondition(
        binarySlot(
          "<=",
          binarySlot(
            "+",
            offset,
            binarySlot("*", length, elementBytes, node),
            node,
          ),
          bytes,
          node,
        ),
        "RangeError",
        "invalid typed array length",
        node,
      );
    }
    const id = nextValue++;
    emit({
      kind: "array-view",
      id,
      type,
      buffer: load(buffer, node),
      byteOffset: load(offset, node),
      length: load(length, node),
      start: node.start,
      end: node.end,
    });
    return save(id, type, node);
  }
  function arrayViewNew(node: Expression & { readonly kind: "new" }): number {
    const rawType = nativeTypedArray(scalarType(node));
    if (rawType === undefined) throw "array view contract invariant";
    return arrayViewBytes(node, rawType);
  }
  function dataViewNew(node: Expression & { readonly kind: "new" }): number {
    const bytes = arrayViewBytes(node, "Uint8Array");
    const target = info(node).callee;
    if (target === undefined) throw "DataView constructor helper invariant";
    const created = runtimeCall(target, [bytes], node);
    if (created === undefined) throw "DataView constructor result invariant";
    return created;
  }
  /** Continue when boolean slot `condition` holds, else throw `error`. */
  /** Records and typed arrays: present references (never undefined). */
  function referenceSlot(type: ScalarType | undefined): boolean {
    return type === "reference" || isNativeTypedArray(type);
  }
  /** A slot of the boolean "this list read is not a hole". */
  function holeAbsent(slot: number, node: IRSpan): number {
    const type = slots[slot],
      id = nextValue++;
    if (type === "primitive") {
      if (primitives === undefined) throw "primitive runtime invariant";
      const absent = primitiveCall(primitives.fromUndefined, [], node);
      const hole = save(
        primitiveCall(
          primitives.strictEqual,
          [
            primitiveReference(load(slot, node), node),
            primitiveReference(absent, node),
          ],
          node,
        ),
        "boolean",
        node,
      );
      return unarySlot("!", hole, "boolean", node);
    }
    if (type === "general") {
      emit({
        kind: "general-is",
        id,
        value: load(slot, node),
        type: "undefined",
        start: node.start,
        end: node.end,
      });
      return unarySlot("!", save(id, "boolean", node), "boolean", node);
    }
    if (type === "optional-reference")
      emit({
        kind: "unary",
        operator: "truthy",
        id,
        operand: load(slot, node),
        start: node.start,
        end: node.end,
      });
    else if (
      type === "optional-number" ||
      type === "optional-string" ||
      type === "optional-boolean"
    )
      emitPresence(id, load(slot, node), type === "optional-string", node);
    // Non-optional reads (typed arrays, number lists) have no holes.
    else
      emit({
        kind: "constant",
        id,
        value: true,
        start: node.start,
        end: node.end,
      });
    return save(id, "boolean", node);
  }
  function requireCondition(
    condition: number,
    error: "TypeError" | "RangeError" | "ReferenceError",
    text: string,
    node: IRSpan,
  ): void {
    const yes = block(),
      no = block();
    choose(load(condition, node), yes, no, node);
    current = no;
    throwNativeError(error, text, node);
    current = yes;
  }
  function throwNativeError(
    error: "TypeError" | "RangeError" | "ReferenceError",
    text: string,
    node: IRSpan,
  ): void {
    const message = nextValue++;
    emit({
      kind: "string-literal",
      id: message,
      value: text,
      start: node.start,
      end: node.end,
    });
    const thrown = newNativeError(error, message, undefined, node);
    finish({
      kind: "throw",
      value: coerce(thrown, "general", node),
      start: node.start,
      end: node.end,
    });
  }
  // C views (docs/native-ffi.md, "C views"): each member access is one
  // c-memory load or store at a constant offset from the view's data, with
  // no length check (creating the view proved its size); writes check the
  // member's contract (TypeError) and element indexes their range
  // (RangeError) first.
  /** The view use of `node` when it reads a nested record or array. */
  function nestedView(node: Expression): CViewUse | undefined {
    const object = ungroup(node);
    if (object.kind !== "member" && object.kind !== "index") return undefined;
    const use = info(object).cView,
      member = use === undefined ? undefined : use.member;
    return member !== undefined && member.value === "view" ? use : undefined;
  }
  /** Evaluate the receiver (and index) of view target `node` into its
   * place, folding chains of nested members into one offset. */
  function viewPlace(node: Expression, use: CViewUse): ViewPlace {
    const target = ungroup(node);
    if (target.kind !== "member" && target.kind !== "index")
      throw "C view target invariant";
    const member = use.member;
    if (member === undefined) throw "C view member invariant";
    const object = ungroup(target.object),
      inner = nestedView(object);
    let root: ViewPlace;
    if (inner === undefined)
      root = {
        base: value(object),
        offset: 0,
        minimum: use.size,
        index: -1,
        stride: 0,
        count: 0,
      };
    else {
      const nested = viewPlace(object, inner),
        innerMember = inner.member;
      if (innerMember === undefined) throw "C view nesting invariant";
      // One dynamic index per access: an element of an indexed element
      // goes through the materialized inner view, whose own index is
      // checked first (before the outer index is evaluated).
      if (use.kind === "element" && nested.index >= 0) {
        requireViewIndex(nested, object);
        root = {
          base: viewSubarray(nested, innerMember, object),
          offset: 0,
          minimum: innerMember.size,
          index: -1,
          stride: 0,
          count: 0,
        };
      } else root = nested;
    }
    if (use.kind === "member")
      return {
        base: root.base,
        offset: root.offset + member.offset,
        minimum: root.minimum,
        index: root.index,
        stride: root.stride,
        count: root.count,
      };
    if (target.kind !== "index") throw "C view element invariant";
    return {
      base: root.base,
      offset: root.offset,
      minimum: root.minimum,
      index: value(target.index),
      stride: member.size,
      count: use.length,
    };
  }
  /** An element index must be an integer in [0, count). */
  function requireViewIndex(place: ViewPlace, node: IRSpan): void {
    if (place.index < 0) return;
    const text = "C array index out of range";
    requireCondition(
      unarySlot("is-integer", place.index, "boolean", node),
      "RangeError",
      text,
      node,
    );
    requireCondition(
      binarySlot(">=", place.index, numberSlot(0, node), node),
      "RangeError",
      text,
      node,
    );
    requireCondition(
      binarySlot("<", place.index, numberSlot(place.count, node), node),
      "RangeError",
      text,
      node,
    );
  }
  function viewAccess(
    operation: "load" | "store",
    place: ViewPlace,
    member: CViewMember,
  ): ForeignMemoryAccess {
    const type = viewScalarType(member.scalar);
    return place.index < 0
      ? { operation, type, offset: place.offset, minimum: place.minimum }
      : {
          operation,
          type,
          offset: place.offset,
          minimum: place.minimum,
          stride: place.stride,
          length: place.count,
        };
  }
  function viewOperands(place: ViewPlace, node: IRSpan): number[] {
    const operands: number[] = [load(place.base, node)];
    if (place.index >= 0) operands.push(load(place.index, node));
    return operands;
  }
  /** Read scalar `member` at `place` (index already checked). */
  function viewLoad(
    place: ViewPlace,
    member: CViewMember,
    node: IRSpan,
  ): number {
    const id = nextValue++;
    emit({
      kind: "c-memory",
      access: viewAccess("load", place, member),
      id,
      arguments: viewOperands(place, node),
      start: node.start,
      end: node.end,
    });
    return save(id, member.value === "boolean" ? "boolean" : "number", node);
  }
  /** Write slot `input` to scalar `member` at `place` (index already
   * checked): integer and address members take exact integers in their
   * range, else TypeError (never truncated). */
  function viewStore(
    place: ViewPlace,
    member: CViewMember,
    input: number,
    node: IRSpan,
  ): void {
    const scalar = member.scalar;
    if (scalar !== "bool" && scalar !== "f32" && scalar !== "f64") {
      // One exact conversion check: an integer in [low, limit).
      const fits = nextValue++;
      emit({
        kind: "c-memory",
        access: {
          operation: "fits",
          type: viewScalarType(member.scalar),
          offset: 0,
          minimum: 0,
        },
        id: fits,
        arguments: [load(input, node)],
        start: node.start,
        end: node.end,
      });
      requireCondition(
        save(fits, "boolean", node),
        "TypeError",
        "value out of range for C " + member.scalar + " member " + member.name,
        node,
      );
    }
    const operands = viewOperands(place, node);
    operands.push(load(input, node));
    emit({
      kind: "c-memory",
      access: viewAccess("store", place, member),
      id: undefined,
      arguments: operands,
      start: node.start,
      end: node.end,
    });
  }
  /** A nested record or array as a value: a view of its bytes. */
  function viewSubarray(
    place: ViewPlace,
    member: CViewMember,
    node: IRSpan,
  ): number {
    let begin = numberSlot(place.offset, node);
    if (place.index >= 0)
      begin = binarySlot(
        "+",
        begin,
        binarySlot("*", place.index, numberSlot(place.stride, node), node),
        node,
      );
    const id = nextValue++;
    emit({
      kind: "array-subarray",
      id,
      array: load(place.base, node),
      begin: load(begin, node),
      length: load(numberSlot(member.size, node), node),
      start: node.start,
      end: node.end,
    });
    return save(id, "Uint8Array", node);
  }
  /** A view read (`v.m`, `v[i]`, `v.length`). */
  function viewRead(node: Expression, use: CViewUse): number {
    const target = ungroup(node);
    if (use.kind === "length") {
      if (target.kind === "member" || target.kind === "index")
        value(target.object);
      return numberSlot(use.length, node);
    }
    const member = use.member;
    if (member === undefined) throw "C view read invariant";
    const place = viewPlace(node, use);
    requireViewIndex(place, node);
    return member.value === "view"
      ? viewSubarray(place, member, node)
      : viewLoad(place, member, node);
  }
  /** `R.view(bytes)`: the bytes themselves, once they hold R. */
  function viewNew(node: Expression, use: CViewUse): number {
    if (node.kind !== "call") throw "C view creation invariant";
    const argument = node.arguments[0];
    if (argument === undefined) throw "C view argument invariant";
    const bytes = value(argument),
      length = nextValue++;
    emit({
      kind: "array-length",
      id: length,
      array: load(bytes, node),
      start: node.start,
      end: node.end,
    });
    requireCondition(
      binarySlot(
        ">=",
        save(length, "number", node),
        numberSlot(use.size, node),
        node,
      ),
      "RangeError",
      "a C view of " + use.view + " needs " + String(use.size) + " bytes",
      node,
    );
    return bytes;
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
    if (
      typedArrayBigIntElements(slots[source]) &&
      typedArrayBigIntElements(slots[destination])
    ) {
      const scratch = word64Scratch(),
        valid = nextValue++;
      emit({
        kind: "array-word64-read",
        id: valid,
        array: load(source, node),
        index: load(binarySlot("+", sourceOffset, index, node), node),
        scratch: load(scratch, node),
        start: node.start,
        end: node.end,
      });
      emit({
        kind: "array-word64-write",
        array: load(destination, node),
        index: load(binarySlot("+", offset, index, node), node),
        scratch: load(scratch, node),
        start: node.start,
        end: node.end,
      });
    } else {
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
    }
    store(
      index,
      load(binarySlot("+", index, numberSlot(1, node), node), node),
      node,
    );
    jump(head.id, node);
    current = done;
  }
  function supplyOmittedArguments(
    argumentsSlots: number[],
    parameters: readonly ScalarType[],
    limit: number,
    node: Span,
  ): void {
    while (argumentsSlots.length < limit) {
      if (
        ![
          "optional-number",
          "optional-boolean",
          "primitive",
          "optional-string",
          "optional-reference",
          "general",
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
  }
  function callArguments(
    args: readonly Expression[],
    target: number,
    node: Expression,
  ): number[] {
    const rest = info(node).rest;
    if (rest === undefined) return args.map(value);
    const argumentsSlots = args.slice(0, rest.start).map(value);
    const parameters = signatures[target]?.parameters;
    if (parameters === undefined) throw "rest signature invariant";
    supplyOmittedArguments(argumentsSlots, parameters, rest.start, node);
    argumentsSlots.push(packCallArguments(args, rest, node));
    return argumentsSlots;
  }
  function packCallArguments(
    args: readonly Expression[],
    rest: RestArguments,
    node: Span,
  ): number {
    const runtime = listRuntimeForElement(rest.element);
    const list = listValue(
      runtime,
      "create",
      [numberSlot(Math.max(0, args.length - rest.start), node)],
      node,
    );
    for (let index = rest.start; index < args.length; index++) {
      const argument = args[index];
      if (argument === undefined) throw "rest argument invariant";
      if (argument.kind === "spread")
        arrayValues(argument.value, argument, (item, typed) => {
          if (!typed && !rest.admitsUndefined)
            requireCondition(
              holeAbsent(item, argument),
              "TypeError",
              "array hole is not a value of the declared element type",
              argument,
            );
          listCall(runtime, "push", [list, item], argument);
        });
      else listCall(runtime, "push", [list, value(argument)], argument);
    }
    return list;
  }
  function invoke(
    target: number,
    argumentsSlots: number[],
    calleeSlot: number | undefined,
    receiver: number | undefined,
    node: Expression,
    scriptArguments?: readonly number[],
    tail: boolean = false,
  ): number | undefined {
    const signature = signatures[target];
    if (signature === undefined) throw "call signature invariant";
    const parameters = signature.parameters;
    supplyOmittedArguments(argumentsSlots, parameters, parameters.length, node);
    const metadata = info(node);
    const type = metadata.type,
      candidates = metadata.voidCallResults;
    const id =
      candidates !== undefined || signature.returnType === "void"
        ? undefined
        : nextValue++;
    const prepared = argumentsSlots.map((slot, i) => {
      const parameter = parameters[i];
      if (parameter === undefined) throw "call parameter invariant";
      if (slots[slot] === parameter) return slot;
      if (slots[slot] === "general" && isNativeTypedArray(parameter))
        return nativeArrayArgument(slot, typedArraySlot(parameter), node);
      return save(coerce(load(slot, node), parameter, node), parameter, node);
    });
    const preparedReceiver =
      receiver === undefined
        ? undefined
        : save(coerce(load(receiver, node), "general", node), "general", node);
    if (candidates !== undefined) {
      const callee = calleeSlot;
      if (callee === undefined)
        throw "observed callback requires an indirect callee";
      const actual = nextValue++;
      emit({
        kind: "host-call",
        operation: "native-function-signature",
        id: actual,
        arguments: [load(callee, node)],
        start: node.start,
        end: node.end,
      });
      const actualSignature = save(actual, "number", node);
      const result = temporary("general"),
        done = block();
      for (const candidate of candidates) {
        if (candidate === undefined)
          throw "callback signature candidate invariant";
        const expected = nextValue++;
        emit({
          kind: "function-address",
          part: "signature",
          id: expected,
          target: candidate,
          start: node.start,
          end: node.end,
        });
        const call = block(),
          next = block();
        const matches = binarySlot(
          "===",
          actualSignature,
          save(expected, "number", node),
          node,
        );
        choose(load(matches, node), call, next, node);
        current = call;
        const representation = signatures[candidate]?.returnType;
        if (representation === undefined)
          throw "callback return signature invariant";
        const id = representation === "void" ? undefined : nextValue++;
        const receiverValue =
          preparedReceiver === undefined
            ? undefined
            : load(preparedReceiver, node);
        const args = prepared.map((slot) => load(slot, node));
        emit({
          kind: "call-indirect",
          id,
          target: candidate,
          callee: load(callee, node),
          arguments: args,
          ...(receiverValue === undefined ? {} : { receiver: receiverValue }),
          start: node.start,
          end: node.end,
        });
        if (id === undefined) {
          const absent = nextValue++;
          emit({
            kind: "general-none",
            id: absent,
            start: node.start,
            end: node.end,
          });
          store(result, absent, node);
        } else store(result, coerce(id, "general", node), node);
        jump(done.id, node);
        current = next;
      }
      finish({ kind: "trap", start: node.start, end: node.end });
      current = done;
      return result;
    }
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
      if (tail) {
        if (scriptArguments === undefined) throw "script tail call invariant";
        emit({
          kind: "call-indirect",
          ...call,
          callee: operation.callee,
          arguments: operation.arguments,
          scriptArguments: scriptArguments.map((slot) =>
            coerce(load(slot, node), "general", node),
          ),
          tail: true,
        });
      } else
        emit({
          kind: "call-indirect",
          ...call,
          ...(info(node).discardCallResult === true
            ? { discardResult: true }
            : {}),
          callee: operation.callee,
          arguments: operation.arguments,
          ...(scriptArguments === undefined
            ? {}
            : {
                scriptArguments: scriptArguments.map((slot) =>
                  coerce(load(slot, node), "general", node),
                ),
              }),
        });
      if (tail) {
        // The entry returns the callee's completion at once; the source's
        // own return of this value follows in an unreachable block.
        if (id === undefined || finalizer !== undefined)
          throw "script tail call outside a returning position";
        finish({ kind: "return", value: id, start: node.start, end: node.end });
        current = block();
        const absent = nextValue++;
        emit({
          kind: "general-none",
          id: absent,
          start: node.start,
          end: node.end,
        });
        return save(absent, "general", node);
      }
    }
    if (type === "void") return undefined;
    if (id !== undefined) return save(id, type, node);
    if (metadata.type !== "general")
      throw "observed void direct call invariant";
    const absent = nextValue++;
    emit({
      kind: "general-none",
      id: absent,
      start: node.start,
      end: node.end,
    });
    return save(absent, "general", node);
  }
  function dispatchRecordKey(
    paths: readonly FiniteRecordAccess[],
    object: number,
    key: number,
    result: number,
    operation: "read" | "write",
    node: Span,
  ): void {
    const done = block();
    for (const path of paths) {
      if (path === undefined) throw "finite record path invariant";
      const selected = block(),
        next = block();
      const equal = binarySlot("===", key, stringSlot(path.key, node), node);
      choose(load(equal, node), selected, next, node);
      current = selected;
      recordAccess(object, result, operation, path.access, node);
      jump(done.id, node);
      current = next;
    }
    finish({ kind: "trap", start: node.start, end: node.end });
    current = done;
  }
  /** Reads or writes a class accessor property: loads the getter or setter
   * closure (through the receiver's prototype pointer, which also guards the
   * layout, or from the receiver itself) and calls it with the receiver. */
  function accessorCall(
    receiver: number,
    choice: RecordAccessChoice,
    accessor: RecordAccessor,
    transfer: number,
    operation: "read" | "write" | "delete",
    type: ScalarType,
    mismatch: number,
    node: Span,
  ): void {
    if (operation === "delete") throw "class accessors cannot be deleted";
    const self = save(receiver, "reference", node);
    let closures = self;
    if (choice.field >= 0) {
      const pointer = temporary("reference"),
        found = block();
      finish({
        kind: "record",
        object: load(self, node),
        record: choice.record,
        field: choice.field,
        operation: "read",
        slot: pointer,
        consequent: found.id,
        alternate: mismatch,
        start: node.start,
        end: node.end,
      });
      current = found;
      closures = pointer;
    }
    const read = operation === "read",
      closureAccess = read ? accessor.get : accessor.set,
      target = read ? accessor.getTarget : accessor.setTarget;
    if (closureAccess === undefined || target === undefined)
      throw "class setter invariant";
    const closure = temporary(closureAccess.type);
    recordAccess(closures, closure, "read", closureAccess, node);
    const signature = signatures[target];
    if (signature === undefined) throw "class accessor signature invariant";
    let callee = load(closure, node);
    if (valueTypes[callee] === "optional-reference") {
      const unwrapped = nextValue++;
      emitUnwrap(unwrapped, callee, "reference", node);
      callee = unwrapped;
    }
    const args: number[] = [];
    if (!read) {
      const parameter = signature.parameters[0];
      if (parameter === undefined) throw "class setter parameter invariant";
      args.push(coerce(load(transfer, node), parameter, node));
    }
    const call = callValue(callee, args),
      id = read ? nextValue++ : undefined;
    if (read && signature.returnType === "void")
      throw "class getter result invariant";
    emit({
      kind: "call-indirect",
      id,
      target,
      callee: call.callee,
      arguments: call.arguments,
      receiver: coerce(load(self, node), "general", node),
      start: node.start,
      end: node.end,
    });
    if (id !== undefined) store(transfer, coerce(id, type, node), node);
  }
  function requireSuperCalled(node: IRSpan): void {
    if (superCalled === undefined) return;
    requireCondition(
      superCalled,
      "ReferenceError",
      "Must call super constructor in derived class before accessing 'this' or returning from derived constructor",
      node,
    );
  }
  function rawInstanceReference(node: Span): number {
    if (receiverReference !== undefined) {
      const id = nextValue++;
      emit({
        kind: "reference-value",
        id,
        value: load(receiverReference, node),
        start: node.start,
        end: node.end,
      });
      return save(id, "reference", node);
    }
    if (receiverSlot === undefined) throw "receiver entry storage invariant";
    return save(
      coerce(load(receiverSlot, node), "reference", node),
      "reference",
      node,
    );
  }
  /** The callee of `object.method(...)` or `super.method(...)` when the method
   * is read through a prototype contract (class instances): the ordinary read
   * into `transfer`, plus per-choice inherited slots (see InheritedRead). */
  function methodCallee(
    input: Expression,
    direct?: {
      readonly onLeaf: (leafSlot: number, receiver: number) => void;
      readonly done: number;
    },
  ):
    | {
        readonly transfer: number;
        readonly receiver: number;
        readonly read: InheritedRead;
      }
    | undefined {
    const member = ungroup(input);
    if (member.kind !== "member" || member.optional === true) return undefined;
    const memberBuiltin = info(member).builtin;
    if (memberBuiltin !== undefined && memberBuiltin !== "super-member")
      return undefined;
    const access = records?.accesses.get(member);
    if (
      access === undefined ||
      !access.choices.every(
        (choice) => choice !== undefined && choice.prototype !== undefined,
      )
    )
      return undefined;
    let object: number;
    if (memberBuiltin === "super-member") {
      requireSuperCalled(member);
      object = rawInstanceReference(member);
    } else {
      object = value(member.object);
    }
    const transfer = temporary(access.type),
      armSlots: number[] = [];
    if (direct === undefined) {
      for (let i = 0; i < access.choices.length; i++) {
        const armSlot = temporary("optional-reference");
        const none = nextValue++;
        emit({
          kind: "reference-none",
          id: none,
          start: member.start,
          end: member.end,
        });
        store(armSlot, none, member);
        armSlots.push(armSlot);
      }
    }
    const read: InheritedRead = {
      slots: armSlots,
      arm: direct === undefined ? numberSlot(-1, member) : -1,
      directCall: direct?.onLeaf,
      receiver: object,
      done: direct?.done,
    };
    callReceivers.set(member, object);
    recordAccess(object, transfer, "read", access, member, undefined, read);
    return { transfer, receiver: object, read };
  }
  function recordAccess(
    object: number,
    transfer: number,
    operation: "read" | "write" | "delete",
    access: RecordAccess,
    node: Span,
    otherwise?: () => void,
    inheritance?: InheritedRead,
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
    // Converted reads of one field representation share their transfer slot
    // and conversion block, so equally placed layouts fuse into one
    // membership test and one read (see recordDispatchChains).
    const conversions = new Map<
      string,
      { readonly slot: number; readonly success: number }
    >();
    for (
      let choiceIndex = 0;
      choiceIndex < access.choices.length;
      choiceIndex++
    ) {
      const choice = access.choices[choiceIndex];
      if (choice === undefined) throw "record choice invariant";
      const next = block(),
        converted = operation === "read" && choice.type !== access.type,
        conversionKey = choice.type + (choice.primitive ? ":primitive" : ""),
        shared = converted ? conversions.get(conversionKey) : undefined,
        success = converted && shared === undefined ? block() : merge,
        successId = shared === undefined ? success.id : shared.success,
        slot = converted
          ? shared === undefined
            ? temporary(choice.type)
            : shared.slot
          : transfer;
      if (converted && shared === undefined)
        conversions.set(conversionKey, { slot, success: success.id });
      let physicalSlot = slot;
      if (operation !== "read" && choice.type !== access.type) {
        physicalSlot = temporary(choice.type);
        store(physicalSlot, load(transfer, node), node);
      }
      let receiver = load(object, node);
      if (valueTypes[receiver] === "optional-reference") {
        const unwrapped = nextValue++;
        emitUnwrap(unwrapped, receiver, "reference", node);
        receiver = unwrapped;
      }
      const accessor = choice.accessor;
      if (accessor !== undefined) {
        accessorCall(
          receiver,
          choice,
          accessor,
          transfer,
          operation,
          access.type,
          next.id,
          node,
        );
        jump(merge.id, node);
        current = next;
        continue;
      }
      const prototype = choice.prototype;
      const armIndex =
        inheritance === undefined ? -1 : (inheritance.armIndex ?? choiceIndex);
      if (operation === "read" && prototype !== undefined) {
        if (prototype.access.type !== access.type)
          throw "prototype result representation invariant";
        const receiverSlot = save(receiver, "reference", node),
          prototypeSlot = temporary("reference"),
          dispatch = block();
        const childInheritance: InheritedRead | undefined =
          inheritance === undefined
            ? undefined
            : {
                slots: inheritance.slots,
                arm: inheritance.arm,
                armIndex,
                directCall: inheritance.directCall,
                receiver: inheritance.receiver,
                done: inheritance.done,
              };
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
        if (prototype.skipOwn === true) {
          recordAccess(
            prototypeSlot,
            transfer,
            "read",
            prototype.access,
            node,
            undefined,
            childInheritance,
          );
          if (current !== undefined) jump(merge.id, node);
          current = next;
          continue;
        }
        const own = block(),
          inherited = block();
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
        recordAccess(
          prototypeSlot,
          transfer,
          "read",
          prototype.access,
          node,
          undefined,
          childInheritance,
        );
        if (current !== undefined) jump(merge.id, node);
        current = own;
        receiver = load(receiverSlot, node);
      }
      // At a prototype leaf inside `methodCallee`, read into a dedicated
      // reference temp: either invoke immediately (0-arg calls, preserving the
      // receiver's layout dominance) or wrap into the arm's optional-reference
      // slot so `devirtualizeClosureCalls` proves each arm's closure target.
      const directCall = inheritance?.directCall;
      const directReceiver = inheritance?.receiver;
      const directDone = inheritance?.done;
      const directLeaf =
        operation === "read" &&
        directCall !== undefined &&
        directReceiver !== undefined &&
        directDone !== undefined &&
        prototype === undefined &&
        choice.type === "reference" &&
        access.type === "reference" &&
        !converted;
      const armSlot =
        operation === "read" &&
        inheritance !== undefined &&
        !directLeaf &&
        prototype === undefined &&
        choice.type === "reference" &&
        access.type === "reference" &&
        !converted
          ? inheritance.slots[armIndex]
          : undefined;
      const leafSlot =
        directLeaf || armSlot !== undefined
          ? temporary("reference")
          : undefined;
      const leafSuccess = leafSlot !== undefined ? block() : undefined;
      const targetSuccessId =
        leafSuccess !== undefined ? leafSuccess.id : successId;
      const targetSlot = leafSlot !== undefined ? leafSlot : physicalSlot;
      // Terminators carry every field from construction: IR copies keep
      // the shape, and added fields would live out of object on hosts.
      const record = choice.record,
        field = choice.field,
        alternate = next.id;
      if (choice.initialized === true) {
        if (operation === "delete")
          throw "initialized record fields cannot be deleted";
        finish({
          kind: "record-cell",
          object: receiver,
          record,
          field,
          operation,
          slot: targetSlot,
          consequent: targetSuccessId,
          alternate,
          start: node.start,
          end: node.end,
        });
      } else
        finish({
          kind: "record",
          object: receiver,
          record,
          field,
          operation,
          slot: targetSlot,
          consequent: targetSuccessId,
          alternate,
          start: node.start,
          end: node.end,
        });
      if (
        leafSuccess !== undefined &&
        leafSlot !== undefined &&
        inheritance !== undefined
      ) {
        current = leafSuccess;
        if (
          directLeaf &&
          directCall !== undefined &&
          directReceiver !== undefined &&
          directDone !== undefined
        ) {
          directCall(leafSlot, directReceiver);
          if (current !== undefined) jump(directDone, node);
        } else if (armSlot !== undefined) {
          const loaded = load(leafSlot, node),
            wrapped = nextValue++;
          emit({
            kind: "reference-wrap",
            id: wrapped,
            value: loaded,
            start: node.start,
            end: node.end,
          });
          store(armSlot, wrapped, node);
          store(transfer, loaded, node);
          store(inheritance.arm, load(numberSlot(armIndex, node), node), node);
          jump(merge.id, node);
        }
      }
      if (converted && shared === undefined) {
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
    if (otherwise === undefined)
      finish({ kind: "trap", start: node.start, end: node.end });
    else {
      otherwise();
      if (current !== undefined) jump(merge.id, node);
    }
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
    return listRuntimeForElement(info(node).listElement);
  }
  function listRuntimeForElement(
    element: CollectionElement | undefined,
  ): ListRuntime {
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
      case "pop":
        target = runtime.pop;
        break;
      case "wrap":
        target = runtime.wrap;
        break;
    }
    if (target === undefined) throw "numeric list runtime invariant";
    return runtimeCall(target, args, node);
  }
  function runtimeCall(
    target: number,
    args: readonly number[],
    node: IRSpan,
    callee?: number,
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
    const call = {
      id,
      target,
      arguments: prepared.map((slot) => load(slot, node)),
      start: node.start,
      end: node.end,
    };
    if (callee === undefined) emit({ kind: "call", ...call });
    else {
      const operation = callValue(readLocal(callee, node), call.arguments);
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
    if (operation !== "length") return result;
    // Array lengths are uint32 (ECMAScript ArraySetLength): state it for
    // range analysis and integer selection downstream.
    const id = nextValue++;
    emit({
      kind: "unary",
      id,
      operator: "uint32",
      operand: load(result, node),
      start: node.start,
      end: node.end,
    });
    return save(id, "number", node);
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
        reference && isNativeTypedArray(resultType) ? resultType : carrier;
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
  const pipelineFacts: PipelineFacts = {
    builtin: (expression: Expression): string | undefined =>
      info(expression).builtin,
    callbackParameters: (call: Expression): number => {
      const witness = info(call).callee;
      const signature = witness === undefined ? undefined : signatures[witness];
      return signature === undefined ? 3 : signature.parameters.length;
    },
    listSource: (expression: Expression): boolean => {
      const type = scalarType(expression);
      return !isNativeTypedArray(type);
    },
  };
  /** Unwraps an optional slot value when the destination expects its present
   * payload type, then coerces to `targetType`. */
  function unwrapSlotValue(
    slot: number,
    targetType: ScalarType,
    node: Span,
  ): number {
    let id = load(slot, node);
    if (
      (slots[slot] === "optional-number" && targetType === "number") ||
      (slots[slot] === "optional-string" && targetType === "string") ||
      (slots[slot] === "optional-reference" && targetType === "reference")
    ) {
      const extracted = nextValue++;
      emitUnwrap(extracted, id, targetType, node);
      id = extracted;
    }
    return coerce(id, targetType, node);
  }
  /** Allocates an accumulator slot initialized on entry so loop-carried
   * phis and GC root slots are always defined on every path. */
  function allocateAccumulatorSlot(
    accType: ScalarType,
    initial: number | undefined,
    node: Span,
  ): { readonly slot: number; readonly storageType: ScalarType } {
    if (initial !== undefined) {
      const slot = temporary(accType);
      store(slot, unwrapSlotValue(initial, accType, node), node);
      return { slot, storageType: accType };
    }
    if (accType === "reference" || isNativeTypedArray(accType)) {
      const slot = temporary("optional-reference");
      const none = nextValue++;
      emit({
        kind: "reference-none",
        id: none,
        start: node.start,
        end: node.end,
      });
      store(slot, none, node);
      return { slot, storageType: "optional-reference" };
    }
    const slot = temporary(accType);
    const id = nextValue++;
    if (accType === "number")
      emit({
        kind: "constant",
        id,
        value: 0,
        start: node.start,
        end: node.end,
      });
    else if (accType === "boolean")
      emit({
        kind: "constant",
        id,
        value: false,
        start: node.start,
        end: node.end,
      });
    else if (accType === "string")
      emit({
        kind: "string-literal",
        id,
        value: "",
        start: node.start,
        end: node.end,
      });
    else if (accType === "optional-number")
      emit({ kind: "undefined", id, start: node.start, end: node.end });
    else if (accType === "optional-boolean")
      emit({ kind: "boolean-none", id, start: node.start, end: node.end });
    else if (accType === "optional-string")
      emit({ kind: "string-none", id, start: node.start, end: node.end });
    else if (accType === "optional-reference")
      emit({ kind: "reference-none", id, start: node.start, end: node.end });
    else {
      emit({ kind: "undefined", id, start: node.start, end: node.end });
      store(slot, coerce(id, accType, node), node);
      return { slot, storageType: accType };
    }
    store(slot, id, node);
    return { slot, storageType: accType };
  }
  /** Arguments for a callback from (item, index, list) slots, unwrapping
   * optional slots the callback declares as present. */
  function callbackArguments(
    parameters: readonly ScalarType[],
    args: readonly number[],
    node: Span,
  ): number[] {
    const values: number[] = [];
    for (let i = 0; i < parameters.length; i++) {
      const parameter = parameters[i],
        slot = args[i];
      if (parameter === undefined || slot === undefined)
        throw "callback argument invariant";
      values.push(unwrapSlotValue(slot, parameter, node));
    }
    return values;
  }
  /** Calls a pipeline callback; returns its result slot (undefined for void). */
  function callCallback(
    call: Expression,
    callback: number,
    args: readonly number[],
    node: Span,
  ): number | undefined {
    const witness = info(call).callee;
    const signature = witness === undefined ? undefined : signatures[witness];
    if (witness === undefined || signature === undefined)
      throw "pipeline signature invariant";
    const returned = signature.returnType === "void" ? undefined : nextValue++;
    emit({
      kind: "call-indirect",
      id: returned,
      target: witness,
      callee: load(callback, node),
      arguments: callbackArguments(signature.parameters, args, node),
      start: node.start,
      end: node.end,
    });
    if (returned === undefined || signature.returnType === "void") {
      const id = nextValue++;
      emit({ kind: "undefined", id, start: node.start, end: node.end });
      return save(id, "optional-number", node);
    }
    return save(returned, signature.returnType, node);
  }
  /** Legalizes a fused HIR pipeline: one loop over the source list in which
   * each element flows through the stages into the sink; filters skip to
   * the next element and no intermediate list is built. */
  function lowerPipeline(plan: PipelinePlan, node: Expression): number {
    const receiver = value(plan.source),
      input = listRuntime(plan.source);
    const callbacks: number[] = [];
    for (const stage of plan.stages) {
      if (stage === undefined) throw "pipeline stage invariant";
      callbacks.push(value(stage.callback));
    }
    const sink = plan.sink,
      sinkCallback =
        sink.callback === undefined ? undefined : value(sink.callback),
      sinkInitial =
        sink.kind === "reduce" && sink.initialValue !== undefined
          ? value(sink.initialValue)
          : undefined;
    const length = listValue(input, "length", [receiver], node);
    let output: ListRuntime | undefined,
      result: number,
      hasAccumulator: number | undefined,
      reduceResultType: ScalarType | undefined;
    if (sink.kind === "collect") {
      // Without filters the output has exactly the source's length: reserve
      // it once. Filtered output grows as elements arrive.
      output = listRuntime(sink.call);
      const exact = plan.stages.every(
        (stage) => stage !== undefined && stage.kind === "map",
      );
      result = listValue(
        output,
        "create",
        [exact ? length : numberSlot(0, node)],
        node,
      );
    } else if (sink.kind === "count" || sink.kind === "find-index")
      result = numberSlot(sink.kind === "count" ? 0 : -1, node);
    else if (sink.kind === "find") {
      result = temporary(scalarType(sink.call));
      const id = nextValue++;
      emit({ kind: "undefined", id, start: node.start, end: node.end });
      store(result, id, node);
    } else if (sink.kind === "for-each") {
      const id = nextValue++;
      emit({ kind: "undefined", id, start: node.start, end: node.end });
      result = save(id, "optional-number", node);
    } else if (sink.kind === "reduce") {
      reduceResultType = scalarType(sink.call);
      const allocated = allocateAccumulatorSlot(
        reduceResultType,
        sinkInitial,
        node,
      );
      result = allocated.slot;
      if (sinkInitial === undefined) hasAccumulator = booleanSlot(false, node);
    } else {
      const id = nextValue++;
      emit({
        kind: "constant",
        id,
        value: sink.kind === "every",
        start: node.start,
        end: node.end,
      });
      result = save(id, "boolean", node);
    }
    // Position of the current element in each later stage's (virtual)
    // input and in the sink's: the count of elements that reached it.
    const positions: number[] = [];
    for (let k = 0; k <= plan.stages.length; k++)
      positions.push(numberSlot(0, node));
    const index = numberSlot(0, node),
      head = block(),
      visit = block(),
      invoke = block(),
      advance = block(),
      done = block();
    jump(head.id, node);
    current = head;
    choose(load(binarySlot("<", index, length, node), node), visit, done, node);
    current = visit;
    // Read first: a present element needs no separate membership test.
    // Holes and present `undefined` elements read alike, so only an absent
    // read asks whether the index is a hole.
    let item = listValue(input, "read", [receiver, index], node);
    const itemType = slots[item];
    let presence: number | undefined;
    if (itemType === "optional-reference" || itemType === "optional-number") {
      presence = nextValue++;
      if (itemType === "optional-number")
        emit({
          kind: "optional-present",
          id: presence,
          value: load(item, node),
          start: node.start,
          end: node.end,
        });
      else
        emit({
          kind: "unary",
          id: presence,
          operator: "truthy",
          operand: load(item, node),
          start: node.start,
          end: node.end,
        });
    }
    if (presence === undefined)
      choose(
        load(listValue(input, "has", [receiver, index], node), node),
        invoke,
        advance,
        node,
      );
    else {
      const absent = block();
      choose(presence, invoke, absent, node);
      current = absent;
      choose(
        load(listValue(input, "has", [receiver, index], node), node),
        invoke,
        advance,
        node,
      );
    }
    current = invoke;
    function reached(k: number): number {
      const position = positions[k];
      if (position === undefined) throw "pipeline position invariant";
      const at = save(load(position, node), "number", node);
      store(
        position,
        load(binarySlot("+", position, numberSlot(1, node), node), node),
        node,
      );
      return at;
    }
    function callbackNeedsIndex(call: Expression): boolean {
      const witness = info(call).callee;
      const signature = witness === undefined ? undefined : signatures[witness];
      return signature !== undefined && signature.parameters.length >= 2;
    }
    for (let k = 0; k < plan.stages.length; k++) {
      const stage = plan.stages[k],
        callback = callbacks[k];
      if (stage === undefined || callback === undefined)
        throw "pipeline stage invariant";
      const args =
        k === 0
          ? [item, index, receiver]
          : callbackNeedsIndex(stage.call)
            ? [item, reached(k)]
            : [item];
      const returned = callCallback(stage.call, callback, args, node);
      if (returned === undefined) throw "pipeline callback result invariant";
      if (stage.kind === "filter") {
        const keep = block();
        choose(truth(returned, node), keep, advance, node);
        current = keep;
      } else item = returned;
    }
    if (sink.kind === "collect") {
      if (output === undefined) throw "pipeline output invariant";
      // The output starts empty and gains one element per reached item:
      // append (the runtime's dense fast path).
      listCall(output, "push", [result, item], node);
    } else if (sink.kind === "count")
      store(
        result,
        load(binarySlot("+", result, numberSlot(1, node), node), node),
        node,
      );
    else if (sink.kind === "reduce") {
      if (sinkCallback === undefined) throw "pipeline sink callback invariant";
      const witness = info(sink.call).callee;
      const signature = witness === undefined ? undefined : signatures[witness];
      const at =
        signature !== undefined && signature.parameters.length >= 3
          ? reached(plan.stages.length)
          : undefined;
      const accType = slots[result];
      if (accType === undefined) throw "pipeline reduce invariant";
      if (hasAccumulator === undefined) {
        const returned = callCallback(
          sink.call,
          sinkCallback,
          at === undefined ? [result, item] : [result, item, at],
          node,
        );
        if (returned === undefined) throw "pipeline reduce result invariant";
        store(result, unwrapSlotValue(returned, accType, node), node);
      } else {
        const initAcc = block(),
          callReduce = block();
        choose(load(hasAccumulator, node), callReduce, initAcc, node);
        current = initAcc;
        store(result, unwrapSlotValue(item, accType, node), node);
        store(hasAccumulator, load(booleanSlot(true, node), node), node);
        jump(advance.id, node);
        current = callReduce;
        const returned = callCallback(
          sink.call,
          sinkCallback,
          at === undefined ? [result, item] : [result, item, at],
          node,
        );
        if (returned === undefined) throw "pipeline reduce result invariant";
        store(result, unwrapSlotValue(returned, accType, node), node);
      }
    } else {
      if (sinkCallback === undefined) throw "pipeline sink callback invariant";
      const at =
        sink.kind === "find-index" || callbackNeedsIndex(sink.call)
          ? reached(plan.stages.length)
          : undefined;
      const returned = callCallback(
        sink.call,
        sinkCallback,
        at === undefined ? [item] : [item, at],
        node,
      );
      if (returned === undefined) throw "pipeline sink result invariant";
      if (sink.kind !== "for-each") {
        const found = block();
        choose(
          truth(returned, node),
          sink.kind === "every" ? advance : found,
          sink.kind === "every" ? found : advance,
          node,
        );
        current = found;
        if (sink.kind === "find-index") {
          if (at === undefined) throw "pipeline find-index invariant";
          store(result, load(at, node), node);
        } else if (sink.kind === "find") {
          const type = slots[result];
          if (type === undefined) throw "pipeline find invariant";
          store(result, coerce(load(item, node), type, node), node);
        } else {
          const id = nextValue++;
          emit({
            kind: "constant",
            id,
            value: sink.kind !== "every",
            start: node.start,
            end: node.end,
          });
          store(result, id, node);
        }
        jump(done.id, node);
        current = advance;
      }
    }
    if (current !== advance) jump(advance.id, node);
    current = advance;
    store(
      index,
      load(binarySlot("+", index, numberSlot(1, node), node), node),
      node,
    );
    jump(head.id, node);
    current = done;
    if (hasAccumulator !== undefined) {
      const ready = block(),
        empty = block();
      choose(load(hasAccumulator, node), ready, empty, node);
      current = empty;
      throwNativeError(
        "TypeError",
        "Reduce of empty array with no initial value",
        node,
      );
      current = ready;
      if (reduceResultType !== undefined && slots[result] !== reduceResultType)
        return save(
          unwrapSlotValue(result, reduceResultType, node),
          reduceResultType,
          node,
        );
    }
    return result;
  }
  let localUseCounts: Map<number, number> | undefined;
  function localReferenceCount(localId: number): number {
    if (localUseCounts === undefined) {
      const counts = new Map<number, number>();
      fn.expressions.forEach((exprInfo, expr) => {
        if (expr.kind === "identifier" && exprInfo.local !== undefined) {
          const id = exprInfo.local;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      });
      localUseCounts = counts;
    }
    return localUseCounts.get(localId) ?? 0;
  }
  /** Legalizes a fused HIR pipeline whose output feeds directly into a
   * `for-of` loop body, avoiding materializing the intermediate list. */
  function lowerForOfPipeline(
    plan: PipelinePlan,
    node: Statement,
    local: Local,
    named: readonly LabelTarget[] = [],
  ): void {
    if (node.kind !== "for-of") throw "for-of pipeline invariant";
    const binding = node.binding,
      iterable = node.iterable,
      mode = node.mode,
      loopBody = node.body;
    const receiver = value(plan.source),
      input = listRuntime(plan.source);
    const callbacks: number[] = [];
    for (const stage of plan.stages) {
      if (stage === undefined) throw "pipeline stage invariant";
      callbacks.push(value(stage.callback));
    }
    const length = listValue(input, "length", [receiver], node);
    const positions: number[] = [];
    for (let k = 0; k <= plan.stages.length; k++)
      positions.push(numberSlot(0, node));
    const index = numberSlot(0, node),
      head = block(),
      visit = block(),
      invoke = block(),
      advance = block(),
      done = block();
    jump(head.id, node);
    current = head;
    choose(load(binarySlot("<", index, length, node), node), visit, done, node);
    current = visit;
    let item = listValue(input, "read", [receiver, index], node);
    const itemType = slots[item];
    let presence: number | undefined;
    if (itemType === "optional-reference" || itemType === "optional-number") {
      presence = nextValue++;
      if (itemType === "optional-number")
        emit({
          kind: "optional-present",
          id: presence,
          value: load(item, node),
          start: node.start,
          end: node.end,
        });
      else
        emit({
          kind: "unary",
          id: presence,
          operator: "truthy",
          operand: load(item, node),
          start: node.start,
          end: node.end,
        });
    }
    if (presence === undefined)
      choose(
        load(listValue(input, "has", [receiver, index], node), node),
        invoke,
        advance,
        node,
      );
    else {
      const absent = block();
      choose(presence, invoke, absent, node);
      current = absent;
      choose(
        load(listValue(input, "has", [receiver, index], node), node),
        invoke,
        advance,
        node,
      );
    }
    current = invoke;
    function reached(k: number): number {
      const position = positions[k];
      if (position === undefined) throw "pipeline position invariant";
      const at = save(load(position, node), "number", node);
      store(
        position,
        load(binarySlot("+", position, numberSlot(1, node), node), node),
        node,
      );
      return at;
    }
    function callbackNeedsIndex(call: Expression): boolean {
      const witness = info(call).callee;
      const signature = witness === undefined ? undefined : signatures[witness];
      return signature !== undefined && signature.parameters.length >= 2;
    }
    for (let k = 0; k < plan.stages.length; k++) {
      const stage = plan.stages[k],
        callback = callbacks[k];
      if (stage === undefined || callback === undefined)
        throw "pipeline stage invariant";
      const args =
        k === 0
          ? [item, index, receiver]
          : callbackNeedsIndex(stage.call)
            ? [item, reached(k)]
            : [item];
      const returned = callCallback(stage.call, callback, args, node);
      if (returned === undefined) throw "pipeline callback result invariant";
      if (stage.kind === "filter") {
        const keep = block();
        choose(truth(returned, node), keep, advance, node);
        current = keep;
      } else item = returned;
    }
    allocateCells(node);
    const outType = slots[item];
    let bound = load(item, node);
    const isOptionalOut =
      outType === "optional-number" ||
      outType === "optional-string" ||
      outType === "optional-reference" ||
      outType === "optional-boolean";
    if (isOptionalOut && info(iterable).holeCheck === true) {
      requireCondition(
        holeAbsent(item, node),
        "TypeError",
        "array hole is not a value of the declared element type",
        node,
      );
      bound = load(item, node);
    }
    if (
      (outType === "optional-number" && local.type === "number") ||
      (outType === "optional-string" && local.type === "string") ||
      (outType === "optional-reference" && local.type === "reference") ||
      (outType === "optional-boolean" && local.type === "boolean")
    ) {
      const extracted = nextValue++;
      emitUnwrap(extracted, bound, local.type, node);
      store(local.id, extracted, node);
    } else {
      store(local.id, coerce(bound, local.type, node), node);
    }
    cellAccess(local.id, mode === "var" ? "write" : "initialize", binding);
    statement(loopBody, iterationTarget(advance.id, done.id, named));
    if (current !== undefined) jump(advance.id, node);
    current = advance;
    store(
      index,
      load(binarySlot("+", index, numberSlot(1, node), node), node),
      node,
    );
    jump(head.id, node);
    current = done;
  }
  function expression(node: Expression): number | undefined {
    const known = expressionOverrides.get(node);
    if (known !== undefined) return known;
    const patternRead = patternReads.get(node);
    if (patternRead !== undefined) return patternRead();
    let result =
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
    if (result === undefined && info(node).voidValueCall === true) {
      const absent = nextValue++;
      emit({
        kind: "general-none",
        id: absent,
        start: node.start,
        end: node.end,
      });
      result = save(absent, "general", node);
    }
    const downcast = info(node).downcast;
    if (
      result !== undefined &&
      downcast !== undefined &&
      node.kind !== "satisfies"
    )
      result = checkedDowncast(result, node, downcast);
    const enrollment = info(node).dynamicEnrollment;
    if (result !== undefined && enrollment !== undefined) {
      const runtime = dynamicObjects;
      if (runtime === undefined) throw "dynamic enrollment runtime invariant";
      result = dynamicResult(
        runtime.enroll,
        [result, stringSlot(enrollment, node)],
        node,
      );
    }
    if (result !== undefined && info(node).undefinedValue)
      undefinedSlots[result] = 1;
    if (result !== undefined && info(node).bigint === true)
      bigIntSlots[result] = 1;
    if (result !== undefined && info(node).speculative === true)
      speculativeSlots[result] = 1;
    if (result !== undefined && info(node).sharedBufferFlow === true)
      sharedBufferFlowSlots[result] = 1;
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
        (receiverType === "general" ||
          receiverType === "primitive" ||
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
          (liveReceiver === "reference" || isNativeTypedArray(liveReceiver))) ||
        (receiverType === "optional-string" && liveReceiver === "string")
      ) {
        const id = nextValue++;
        emitUnwrap(id, load(receiver, input), definedType(liveReceiver), input);
        receiver = save(id, definedType(liveReceiver), input);
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
  function stringSlot(value: string, node: Span): number {
    const id = nextValue++;
    emit({
      kind: "string-literal",
      id,
      value,
      start: node.start,
      end: node.end,
    });
    return save(id, "string", node);
  }
  function dynamicCall(
    callee: number,
    args: readonly number[],
    node: IRSpan,
  ): number | undefined {
    const target = dynamicSignatures[callee];
    if (target === undefined) throw "dynamic object signature invariant";
    return runtimeCall(target, args, node, callee);
  }
  function dynamicResult(
    target: number,
    args: readonly number[],
    node: IRSpan,
  ): number {
    const result = dynamicCall(target, args, node);
    if (result === undefined) throw "dynamic object result invariant";
    return result;
  }
  function projectDynamicResult(
    runtime: DynamicObjectRuntime,
    raw: number,
    metadata: ExpressionInfo,
    node: Expression,
  ): number {
    const schema = metadata.dynamicContract,
      type = metadata.type;
    if (schema === undefined || type === "void")
      throw "dynamic object projection invariant";
    const checked = dynamicResult(
      runtime.project,
      [raw, stringSlot(schema, node)],
      node,
    );
    return save(load(checked, node), type, node);
  }
  function dynamicKey(node: Expression): number {
    if (node.kind === "index") return value(node.index);
    if (node.kind === "member") return stringSlot(node.property, node);
    throw "dynamic object key invariant";
  }
  function dynamicArray(
    runtime: DynamicObjectRuntime,
    elements: readonly Expression[],
    node: Span,
  ): number {
    const array = dynamicResult(
      runtime.createArray,
      [numberSlot(elements.length, node)],
      node,
    );
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (element === undefined) throw "realm array element invariant";
      if (element.kind === "elision") continue;
      dynamicCall(
        runtime.define,
        [array, stringSlot(String(i), element), value(element)],
        element,
      );
    }
    return array;
  }
  function dynamicExpression(
    node: Expression,
    metadata: ExpressionInfo,
  ): number {
    const runtime = dynamicObjects;
    if (runtime === undefined) throw "dynamic object runtime invariant";
    const operation = metadata.dynamicObject;
    if (operation === undefined) throw "dynamic object operation invariant";
    switch (operation) {
      case "array-literal":
        if (node.kind !== "array") throw "realm array literal invariant";
        return dynamicArray(runtime, node.elements, node);
      case "array-method":
      case "static-call": {
        if (node.kind !== "call") throw "realm method call invariant";
        const target = node.callee;
        if (target.kind !== "member") throw "realm method target invariant";
        const receiver =
          operation === "array-method"
            ? value(target.object)
            : dynamicResult(runtime.objectConstructor, [], node);
        const callee = dynamicResult(
          runtime.read,
          [receiver, stringSlot(target.property, node)],
          node,
        );
        const args = dynamicArray(runtime, node.arguments, node);
        const raw = dynamicResult(
          runtime.invoke,
          [receiver, callee, args],
          node,
        );
        const schema = metadata.dynamicContract;
        const type = metadata.type;
        if (schema === undefined || type === "void")
          throw "realm method result invariant";
        const checked = dynamicResult(
          runtime.project,
          [raw, stringSlot(schema, node)],
          node,
        );
        return save(load(checked, node), type, node);
      }
      case "own-enumeration": {
        if (node.kind !== "call") throw "Object enumeration invariant";
        const target = ungroup(node.callee);
        const argument = node.arguments[0];
        if (target.kind !== "member" || argument === undefined)
          throw "Object enumeration call invariant";
        const receiver = dynamicResult(runtime.objectConstructor, [], node);
        const callee = dynamicResult(
          runtime.read,
          [receiver, stringSlot(target.property, node)],
          node,
        );
        return dynamicResult(
          runtime.invokeEnumeration,
          [receiver, callee, value(argument)],
          node,
        );
      }
      case "enroll": {
        const schema = metadata.dynamicContract;
        if (node.kind !== "satisfies" || schema === undefined)
          throw "dynamic object enrollment invariant";
        return dynamicResult(
          runtime.enroll,
          [value(node.expression), stringSlot(schema, node)],
          node,
        );
      }
      case "literal": {
        if (node.kind !== "object") throw "dynamic object literal invariant";
        const schema = stringSlot(metadata.dynamicContract ?? "", node);
        const object = dynamicResult(runtime.create, [schema], node);
        for (const property of node.properties) {
          if (property === undefined) throw "dynamic object property invariant";
          if (property.kind === "spread") {
            dynamicCall(
              runtime.spread,
              [object, value(property.value)],
              property,
            );
            continue;
          }
          if (property.prototypeSetter === true) {
            dynamicCall(
              runtime.setPrototype,
              [object, value(property.value)],
              property,
            );
            continue;
          }
          const keyExpression = property.keyExpression;
          const key =
            keyExpression === undefined
              ? stringSlot(property.name, property)
              : dynamicResult(
                  runtime.convertKey,
                  [value(keyExpression)],
                  property,
                );
          dynamicCall(
            runtime.define,
            [object, key, value(property.value)],
            property,
          );
        }
        dynamicCall(runtime.finish, [object, schema], node);
        return object;
      }
      case "read": {
        if (node.kind !== "member" && node.kind !== "index")
          throw "dynamic object read invariant";
        const object = value(node.object),
          key = dynamicKey(node);
        const raw = dynamicResult(runtime.read, [object, key], node);
        if (metadata.downcast !== undefined) return raw;
        const schema = metadata.dynamicContract;
        const type = metadata.type;
        if (schema === undefined || type === "void")
          throw "dynamic object projection invariant";
        const checked = dynamicResult(
          runtime.project,
          [raw, stringSlot(schema, node)],
          node,
        );
        return save(load(checked, node), type, node);
      }
      case "write": {
        if (node.kind !== "assignment") throw "dynamic object write invariant";
        const target = ungroup(node.target);
        if (target.kind !== "member" && target.kind !== "index")
          throw "dynamic object target invariant";
        const object = value(target.object),
          key = dynamicKey(target);
        const assigned = value(node.value);
        dynamicCall(runtime.write, [object, key, assigned], node);
        return assigned;
      }
      case "update":
      case "compound": {
        if (node.kind !== "update" && node.kind !== "compound")
          throw "realm property update invariant";
        const target = ungroup(node.target);
        if (target.kind !== "member" && target.kind !== "index")
          throw "realm property target invariant";
        const object = value(target.object),
          key = dynamicKey(target);
        if (node.kind === "update") {
          const update = runtime.update;
          if (update === undefined) throw "realm update helper invariant";
          const raw = dynamicResult(
            update,
            [
              object,
              key,
              stringSlot(node.operator, node),
              booleanSlot(node.prefix, node),
            ],
            node,
          );
          return projectDynamicResult(runtime, raw, metadata, node);
        }
        const canonical = dynamicResult(runtime.convertKey, [key], target);
        const old = dynamicResult(runtime.read, [object, canonical], target);
        if (
          node.operator === "??" ||
          node.operator === "&&" ||
          node.operator === "||"
        ) {
          const assign = block(),
            done = block();
          const result = temporary("general");
          store(result, load(old, target), target);
          if (node.operator === "??")
            choose(nonNullish(old, target), done, assign, node);
          else if (node.operator === "&&")
            choose(truth(old, target), assign, done, node);
          else choose(truth(old, target), done, assign, node);
          current = assign;
          const right = value(node.value);
          dynamicCall(runtime.write, [object, canonical, right], node);
          store(result, load(right, node), node);
          jump(done.id, node);
          current = done;
          return projectDynamicResult(runtime, result, metadata, node);
        }
        const binary = runtime.speculativeBinary;
        if (binary === undefined) throw "realm compound helper invariant";
        const right = value(node.value);
        const result = dynamicResult(
          binary,
          [stringSlot(node.operator, node), old, right],
          node,
        );
        dynamicCall(runtime.write, [object, canonical, result], node);
        return projectDynamicResult(runtime, result, metadata, node);
      }
      case "has":
        if (node.kind !== "binary") throw "dynamic object membership invariant";
        return dynamicResult(
          runtime.has,
          [value(node.left), value(node.right)],
          node,
        );
      case "delete": {
        if (node.kind !== "unary") throw "dynamic object deletion invariant";
        const operand = ungroup(node.operand);
        if (operand.kind !== "member" && operand.kind !== "index")
          throw "dynamic object deletion target invariant";
        const object = value(operand.object);
        if (operand.optional !== true)
          return dynamicResult(
            runtime.remove,
            [object, dynamicKey(operand)],
            node,
          );
        const output = temporary("boolean"),
          proceed = block(),
          skipped = block(),
          done = block();
        choose(nonNullish(object, node), proceed, skipped, node);
        current = proceed;
        const removed = dynamicResult(
          runtime.remove,
          [object, dynamicKey(operand)],
          node,
        );
        store(output, load(removed, node), node);
        jump(done.id, node);
        current = skipped;
        const yes = nextValue++;
        emit({
          kind: "constant",
          id: yes,
          value: true,
          start: node.start,
          end: node.end,
        });
        store(output, yes, node);
        jump(done.id, node);
        current = done;
        return output;
      }
      default:
        throw "dynamic object operation invariant";
    }
  }
  /** Advance a fixed-arity FFI call only after evaluating the real callee
   * and arguments. A missed witness reuses those values in ordinary lowering. */
  function fixedFfiCall(
    node: Expression & { readonly kind: "call" },
    target: number,
    assertion?: Expression,
  ): number {
    const call = info(node).generalCall;
    if (call === undefined) throw "fixed FFI fallback invariant";
    const callee = ungroup(node.callee);
    const base =
      callee.kind === "member" || callee.kind === "index"
        ? callee.object
        : undefined;
    const overrides: {
      readonly expression: Expression;
      readonly previous: number | undefined;
    }[] = [];
    function useValue(expression: Expression, slot: number): void {
      overrides.push({
        expression,
        previous: expressionOverrides.get(expression),
      });
      expressionOverrides.set(expression, slot);
    }
    const fixedReceiver = base === undefined ? undefined : value(base);
    const previousBase =
      base === undefined ? undefined : expressionOverrides.get(base);
    if (base !== undefined && fixedReceiver !== undefined)
      expressionOverrides.set(base, fixedReceiver);
    const bound = value(node.callee);
    if (base !== undefined) {
      if (previousBase === undefined) expressionOverrides.delete(base);
      else expressionOverrides.set(base, previousBase);
    }
    const argumentsSlots = node.arguments.map(value);
    if (base !== undefined && fixedReceiver !== undefined)
      useValue(base, fixedReceiver);
    useValue(node.callee, bound);
    for (let index = 0; index < node.arguments.length; index++) {
      const argument = node.arguments[index],
        slot = argumentsSlots[index];
      if (argument === undefined || slot === undefined)
        throw "fixed FFI argument invariant";
      useValue(argument, slot);
    }
    const fast = runtimeCall(target, [bound, ...argumentsSlots], node);
    if (fast === undefined) throw "fixed FFI result invariant";
    const type = assertion === undefined ? "general" : "number";
    const output = temporary(type);
    const hit = block(),
      miss = block(),
      done = block();
    const present = nextValue++;
    emit({
      kind: "optional-present",
      id: present,
      value: load(fast, node),
      start: node.start,
      end: node.end,
    });
    choose(present, hit, miss, node);
    current = hit;
    const result = nextValue++;
    emit({
      kind: "optional-value",
      id: result,
      value: load(fast, node),
      start: node.start,
      end: node.end,
    });
    store(output, coerce(result, type, node), node);
    jump(done.id, node);
    current = miss;
    const generic = generalCall(node, call);
    const downcast =
      assertion === undefined ? undefined : info(assertion).downcast;
    const returned =
      assertion === undefined || downcast === undefined
        ? generic
        : checkedDowncast(generic, assertion, downcast);
    store(output, load(returned, node), node);
    jump(done.id, node);
    for (let index = overrides.length - 1; index >= 0; index--) {
      const override = overrides[index];
      if (override === undefined) throw "fixed FFI override invariant";
      if (override.previous === undefined)
        expressionOverrides.delete(override.expression);
      else expressionOverrides.set(override.expression, override.previous);
    }
    current = done;
    return output;
  }

  function generalCall(
    node: Expression & { readonly kind: "call" | "new" },
    call: { readonly target: number | undefined },
  ): number {
    if (node.kind === "new") {
      const callee = value(node.callee);
      const rest = info(node).rest;
      const constructor = call.target;
      if (rest === undefined || constructor === undefined)
        throw "general construction invariant";
      const argumentsList = packCallArguments(node.arguments, rest, node);
      const result = runtimeCall(constructor, [callee, argumentsList], node);
      if (result === undefined) throw "general construction result invariant";
      return result;
    }
    const target = ungroup(node.callee);
    const base =
      target.kind === "member" || target.kind === "index"
        ? target.object
        : undefined;
    let receiver: number;
    if (base === undefined) {
      const absent = nextValue++;
      emit({ kind: "undefined", id: absent, start: node.start, end: node.end });
      receiver = save(absent, "optional-number", node);
    } else {
      receiver = value(base);
      expressionOverrides.set(base, receiver);
    }
    const callee = value(node.callee);
    if (base !== undefined) expressionOverrides.delete(base);
    const rest = info(node).rest;
    if (rest === undefined) throw "general call argument list invariant";
    const argumentsList = packCallArguments(node.arguments, rest, node);

    const kind = nextValue++;
    emit({
      kind: "general-kind",
      id: kind,
      value: load(callee, node),
      start: node.start,
      end: node.end,
    });
    requireCondition(
      binarySlot(
        "!==",
        save(kind, "string", node),
        stringSlot("function", node),
        node,
      ),
      "TypeError",
      nativeClosureCallMessage,
      node,
    );
    const helper = call.target;
    if (helper === undefined) {
      // A typed-only image contains no realm callable representation.
      throwNativeError("TypeError", "Called value is not a function", node);
      current = block();
      return save(
        coerce(load(receiver, node), "general", node),
        "general",
        node,
      );
    }
    const result = runtimeCall(helper, [callee, receiver, argumentsList], node);
    if (result === undefined) throw "general call result invariant";
    return result;
  }
  function nativeArrayTest(
    slot: number,
    kind: NativeTypedArray,
    node: IRSpan,
  ): number {
    const packed = coerce(load(slot, node), "general", node);
    const test = nextValue++;
    emit({
      kind: "general-is",
      id: test,
      value: packed,
      type: kind,
      start: node.start,
      end: node.end,
    });
    return save(test, "boolean", node);
  }
  /** True when `operand` is a native typed SharedArrayBuffer (a borrowed
   * Uint8Array viewing a published block of the isolate's shared block
   * service). */
  function nativeSharedArrayBufferTest(operand: number, node: IRSpan): number {
    const checker = sharedBlockCheck;
    if (checker === undefined) return booleanSlot(false, node);
    const general = save(
      coerce(load(operand, node), "general", node),
      "general",
      node,
    );
    const result = temporary("boolean");
    const check = block(),
      notBuffer = block(),
      done = block();
    choose(
      load(nativeArrayTest(general, "Uint8Array", node), node),
      check,
      notBuffer,
      node,
    );
    current = check;
    const array = save(
      coerce(load(general, node), "Uint8Array", node),
      "Uint8Array",
      node,
    );
    const args: number[] = [load(array, node)];
    const id = nextValue++;
    emit({
      kind: "call",
      id,
      target: checker,
      arguments: args,
      start: node.start,
      end: node.end,
    });
    store(result, id, node);
    jump(done.id, node);
    current = notBuffer;
    store(result, load(booleanSlot(false, node), node), node);
    jump(done.id, node);
    current = done;
    return result;
  }
  /** True when `operand` is a native typed array of `kind`, excluding native
   * typed SharedArrayBuffers (which share the Uint8Array tag). */
  function nativeTypedArrayInstanceTest(
    operand: number,
    kind: NativeTypedArray,
    node: IRSpan,
  ): number {
    if (kind !== "Uint8Array" || sharedBlockCheck === undefined)
      return nativeArrayTest(operand, kind, node);
    const result = temporary("boolean");
    const check = block(),
      notArray = block(),
      done = block();
    choose(
      load(nativeArrayTest(operand, kind, node), node),
      check,
      notArray,
      node,
    );
    current = check;
    store(
      result,
      load(
        unarySlot(
          "!",
          nativeSharedArrayBufferTest(operand, node),
          "boolean",
          node,
        ),
        node,
      ),
      node,
    );
    jump(done.id, node);
    current = notArray;
    store(result, load(booleanSlot(false, node), node), node);
    jump(done.id, node);
    current = done;
    return result;
  }
  /** A general value consumed as a native SharedArrayBuffer: a native typed
   * SharedArrayBuffer or a fixed-length realm SharedArrayBuffer projected to
   * its borrowed byte array (projectNativeSharedArrayBuffer), else TypeError. */
  function nativeSharedArrayBufferArgument(slot: number, node: IRSpan): number {
    const source = save(
      coerce(load(slot, node), "general", node),
      "general",
      node,
    );
    sharedBufferFlowSlots[source] = 0;
    const accepted = block(),
      projecting = block();
    choose(
      load(nativeSharedArrayBufferTest(source, node), node),
      accepted,
      projecting,
      node,
    );
    current = projecting;
    const project = dynamicObjects?.projectSharedArrayBuffer;
    if (project !== undefined) {
      const projected = dynamicResult(project, [source], node);
      const acceptProjected = block(),
        reject = block();
      choose(
        load(nativeArrayTest(projected, "Uint8Array", node), node),
        acceptProjected,
        reject,
        node,
      );
      current = acceptProjected;
      store(source, load(projected, node), node);
      jump(accepted.id, node);
      current = reject;
    }
    throwNativeError("TypeError", nativeSharedArrayBufferMessage, node);
    current = accepted;
    return save(
      coerce(load(source, node), "reference", node),
      "reference",
      node,
    );
  }
  /** A general value passed to a native typed-array parameter: a native
   * array of `kind`, or a realm typed array of that kind viewed natively
   * (projectNativeTypedArray), else a TypeError. */
  function nativeArrayArgument(
    slot: number,
    kind: NativeTypedArray,
    node: Span,
  ): number {
    const project = dynamicObjects?.projectTypedArray;
    let source = slot;
    if (project !== undefined) {
      source = save(coerce(load(slot, node), "general", node), "general", node);
      const native = block(),
        projecting = block();
      choose(
        load(nativeTypedArrayInstanceTest(slot, kind, node), node),
        native,
        projecting,
        node,
      );
      current = projecting;
      const projected = dynamicResult(
        project,
        [source, stringSlot(kind, node)],
        node,
      );
      store(source, load(projected, node), node);
      jump(native.id, node);
      current = native;
    }
    const test = nativeTypedArrayInstanceTest(source, kind, node);
    requireCondition(test, "TypeError", nativeArrayArgumentMessage, node);
    return save(coerce(load(source, node), kind, node), kind, node);
  }
  function arrayInstanceOf(
    node: Expression & { readonly kind: "binary" },
    kind: NativeTypedArray,
    metadata: ExpressionInfo,
  ): number {
    const operand = value(node.left);
    const global = metadata.realmGlobal,
      instance = metadata.realmInstanceOf;
    if (global === undefined || instance === undefined)
      return nativeTypedArrayInstanceTest(operand, kind, node);
    const constructor = dynamicResult(
      global,
      [
        stringSlot(kind, node.right),
        stringSlot("installTypedArrayIntrinsics", node.right),
      ],
      node.right,
    );
    return callRealmInstanceOf(instance, operand, constructor, node);
  }
  function sharedBufferInstanceOf(
    node: Expression & { readonly kind: "binary" },
    metadata: ExpressionInfo,
  ): number {
    const operand = value(node.left);
    const global = metadata.realmGlobal,
      instance = metadata.realmInstanceOf;
    if (global === undefined || instance === undefined)
      return nativeSharedArrayBufferTest(operand, node);
    const constructor = dynamicResult(
      global,
      [
        stringSlot("SharedArrayBuffer", node.right),
        stringSlot("installSharedArrayBufferIntrinsics", node.right),
      ],
      node.right,
    );
    return callRealmInstanceOf(instance, operand, constructor, node);
  }
  function callRealmInstanceOf(
    instance: number,
    operand: number,
    constructor: number,
    node: Span,
  ): number {
    const left =
      realmErrors === undefined ? operand : exposedError(operand, node);
    const kind = temporary("string"),
      done = block();
    if (sharedBlockCheck !== undefined) {
      const yes = block(),
        no = block();
      choose(
        load(nativeSharedArrayBufferTest(left, node), node),
        yes,
        no,
        node,
      );
      current = yes;
      store(kind, load(stringSlot("SharedArrayBuffer", node), node), node);
      jump(done.id, node);
      current = no;
    }
    for (const array of nativeTypedArrays) {
      if (array === undefined) throw "native typed array kind invariant";
      const yes = block(),
        no = block();
      choose(load(nativeArrayTest(left, array, node), node), yes, no, node);
      current = yes;
      store(kind, load(stringSlot(array, node), node), node);
      jump(done.id, node);
      current = no;
    }
    const errors: ("Error" | "TypeError" | "RangeError" | "ReferenceError")[] =
      ["TypeError", "RangeError", "ReferenceError", "Error"];
    for (const error of errors) {
      if (error === undefined) throw "native error kind invariant";
      const yes = block(),
        no = block();
      choose(
        nativeErrorTest(coerce(load(left, node), "general", node), error, node),
        yes,
        no,
        node,
      );
      current = yes;
      store(kind, load(stringSlot(error, node), node), node);
      jump(done.id, node);
      current = no;
    }
    store(kind, load(stringSlot("", node), node), node);
    jump(done.id, node);
    current = done;
    return dynamicResult(instance, [left, constructor, kind], node);
  }
  function libraryMemberResult(
    valueSlot: number,
    type: ScalarType,
    node: Expression,
    runtime: DynamicObjectRuntime,
  ): number {
    const schema = info(node).dynamicContract;
    const checked =
      schema === undefined
        ? valueSlot
        : dynamicResult(
            runtime.project,
            [valueSlot, stringSlot(schema, node)],
            node,
          );
    return save(load(checked, node), type, node);
  }
  function realmMemberOperation(
    runtime: DynamicObjectRuntime,
    invokeMethod: number,
    target: Expression,
    node: Expression,
    object: number,
  ): number | undefined {
    const operation = node,
      resultType = info(node).type;
    const key = dynamicKey(target);
    if (operation.kind === "call") {
      const callable = dynamicResult(runtime.read, [object, key], node);
      const args = operation.arguments.map(value);
      const missing = nextValue++;
      emit({
        kind: "general-none",
        id: missing,
        start: node.start,
        end: node.end,
      });
      const absent = save(missing, "general", node);
      const output = dynamicResult(
        invokeMethod,
        [
          object,
          callable,
          numberSlot(args.length, node),
          args[0] ?? absent,
          args[1] ?? absent,
          args[2] ?? absent,
        ],
        node,
      );
      return resultType === "void"
        ? undefined
        : libraryMemberResult(output, resultType, node, runtime);
    } else if (operation.kind === "assignment") {
      const assigned = value(operation.value);
      dynamicCall(runtime.write, [object, key, assigned], node);
      return assigned;
    } else {
      const output = dynamicResult(runtime.read, [object, key], node);
      return resultType === "void"
        ? undefined
        : libraryMemberResult(output, resultType, node, runtime);
    }
  }
  function arrayFlowOperation(
    node: Expression,
    kind: NativeTypedArray | "realm",
  ): number | undefined {
    const metadata = info(node);
    let target = node;
    if (node.kind === "call") target = ungroup(node.callee);
    if (
      node.kind === "assignment" ||
      node.kind === "compound" ||
      node.kind === "update"
    )
      target = ungroup(node.target);
    if (target.kind !== "member" && target.kind !== "index")
      throw "typed-array flow receiver invariant";
    const receiver = target.object;
    const object = value(receiver);
    function native(kind: NativeTypedArray): number | undefined {
      const typed = save(coerce(load(object, node), kind, node), kind, node);
      expressionOverrides.set(receiver, typed);
      if (metadata.type === "general")
        informationOverrides.set(node, { ...metadata, type: kind });
      const output = expressionCore(node);
      expressionOverrides.delete(receiver);
      if (metadata.type === "general") informationOverrides.set(node, metadata);
      return output;
    }
    const runtime = dynamicObjects;
    const invokeMethod = metadata.arrayMethod;
    if (kind === "realm") {
      if (runtime === undefined || invokeMethod === undefined)
        throw "Realm typed-array operation requires the program realm";
      return realmMemberOperation(runtime, invokeMethod, target, node, object);
    }
    const condition = nativeArrayTest(object, kind, node);
    if (runtime === undefined || invokeMethod === undefined) {
      requireCondition(
        condition,
        "TypeError",
        "Typed array operation requires matching native storage",
        node,
      );
      return native(kind);
    }
    const result =
      metadata.type === "void" ? undefined : temporary(metadata.type);
    const fast = block(),
      realm = block(),
      done = block();
    choose(load(condition, node), fast, realm, node);
    current = fast;
    const fastResult = native(kind);
    if (result !== undefined && fastResult !== undefined)
      store(result, load(fastResult, node), node);
    jump(done.id, node);
    current = realm;
    const realmResult = realmMemberOperation(
      runtime,
      invokeMethod,
      target,
      node,
      object,
    );
    if (result !== undefined && realmResult !== undefined)
      store(result, load(realmResult, node), node);
    jump(done.id, node);
    current = done;
    return result;
  }
  function expressionValue(node: Expression): number | undefined {
    const metadata = info(node);
    if (metadata.realmMember === true) {
      const target = node.kind === "call" ? ungroup(node.callee) : node;
      if (target.kind !== "member") throw "realm library member invariant";
      const runtime = dynamicObjects,
        method = metadata.arrayMethod;
      if (runtime === undefined || method === undefined)
        throw "realm library requires the program realm";
      return realmMemberOperation(
        runtime,
        method,
        target,
        node,
        value(target.object),
      );
    }
    const array = info(node).arrayReceiver;
    return array === undefined
      ? expressionCore(node)
      : arrayFlowOperation(node, array);
  }
  function expressionCore(input: Expression): number | undefined {
    const node = input;
    const metadata = info(node);
    if (metadata.dynamicObject !== undefined)
      return dynamicExpression(node, metadata);
    const constant = metadata.constant;
    if (
      constant !== undefined &&
      metadata.builtin !== "array-bytes-per-element"
    ) {
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
        // Dense numeric array literal: evaluate all elements first (preserving
        // exact evaluation order and throw semantics), then populate one
        // Float64Array with unchecked stores and wrap it as a dense NumberList.
        if (
          runtime.wrap !== undefined &&
          node.elements.length >= 1 &&
          node.elements.length <= 32
        ) {
          let denseNumeric = true;
          for (let i = 0; i < node.elements.length; i++) {
            const element = node.elements[i];
            if (
              element === undefined ||
              element.kind === "elision" ||
              element.kind === "spread" ||
              scalarType(element) !== "number"
            ) {
              denseNumeric = false;
              break;
            }
          }
          if (denseNumeric) {
            const elementSlots: number[] = [];
            for (let i = 0; i < node.elements.length; i++) {
              const element = node.elements[i];
              if (
                element === undefined ||
                element.kind === "elision" ||
                element.kind === "spread"
              )
                throw "dense numeric array literal invariant";
              elementSlots.push(value(element));
            }
            const lenConst = nextValue++;
            emit({
              kind: "constant",
              id: lenConst,
              value: elementSlots.length,
              start: node.start,
              end: node.end,
            });
            const arrayId = nextValue++;
            emit({
              kind: "array-new",
              id: arrayId,
              type: "Float64Array",
              length: lenConst,
              start: node.start,
              end: node.end,
            });
            const arraySlot = save(arrayId, "Float64Array", node);
            for (let i = 0; i < elementSlots.length; i++) {
              const elSlot = elementSlots[i];
              if (elSlot === undefined)
                throw "dense numeric array literal invariant";
              const idxConst = nextValue++;
              emit({
                kind: "constant",
                id: idxConst,
                value: i,
                start: node.start,
                end: node.end,
              });
              emit({
                kind: "array-store",
                array: load(arraySlot, node),
                index: idxConst,
                value: load(elSlot, node),
                start: node.start,
                end: node.end,
              });
            }
            return listValue(runtime, "wrap", [arraySlot], node);
          }
        }
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
        const general = metadata.generalCall;
        if (general !== undefined) return generalCall(node, general);
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
          const argumentsSlots = callArguments(
            node.arguments,
            construction.target,
            node,
          );
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
          info(node).builtin === "range-error-new" ||
          info(node).builtin === "error-new"
        ) {
          const builtin = info(node).builtin;
          const kind: "Error" | "TypeError" | "RangeError" =
            builtin === "range-error-new"
              ? "RangeError"
              : builtin === "error-new"
                ? "Error"
                : "TypeError";
          const argument = node.arguments[0];
          const presence =
            realmErrors === undefined ? undefined : temporary("boolean");
          const message = errorMessage(argument, node, presence);
          // Preserve the typed-only value numbering of error-new and its operand.
          if (realmErrors === undefined) {
            const id = nextValue++;
            emit({
              kind: "error-new",
              error: kind,
              id,
              message: load(message, node),
              start: node.start,
              end: node.end,
            });
            return save(id, "reference", node);
          }
          const id = newNativeError(kind, load(message, node), presence, node);
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
        if (info(node).builtin === "array-buffer-new")
          return arrayBufferNew(node);
        if (info(node).builtin === "shared-array-buffer-new")
          return sharedArrayBufferNew(node);
        if (info(node).builtin === "array-view-new") return arrayViewNew(node);
        if (info(node).builtin === "data-view-new") return dataViewNew(node);
        const type = scalarType(node);
        if (info(node).builtin !== "array-new" || !isNativeTypedArray(type))
          throw "array constructor contract invariant";
        const arg = node.arguments[0],
          input = arg === undefined ? numberSlot(0, node) : value(arg);
        const sourceList =
          arg !== undefined && info(arg).listElement !== undefined
            ? arg
            : undefined;
        const inputType = slots[input],
          copy = isNativeTypedArray(inputType),
          length =
            sourceList !== undefined
              ? listValue(listRuntime(sourceList), "length", [input], node)
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
          type: typedArraySlot(type),
          length: load(length, node),
          start: node.start,
          end: node.end,
        });
        const result = save(id, type, node);
        if (sourceList !== undefined) {
          const index = numberSlot(0, node);
          arrayValues(
            sourceList,
            node,
            (item, _typed): void => {
              if (typedArrayBigIntElements(type)) {
                let unwrapped = item;
                if (slots[item] === "optional-reference") {
                  const noneId = nextValue++;
                  emit({
                    kind: "reference-none",
                    id: noneId,
                    start: node.start,
                    end: node.end,
                  });
                  requireCondition(
                    binarySlot(
                      "!==",
                      item,
                      save(noneId, "optional-reference", node),
                      node,
                    ),
                    "TypeError",
                    "Cannot convert undefined to a BigInt",
                    node,
                  );
                  const valId = nextValue++;
                  emitUnwrap(valId, load(item, node), "reference", node);
                  unwrapped = save(valId, "reference", node);
                }
                writeArrayElement(result, index, unwrapped, node);
              } else {
                emit({
                  kind: "array-write",
                  array: load(result, node),
                  index: load(index, node),
                  value: numericInput(item, node),
                  start: node.start,
                  end: node.end,
                });
              }
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
              store(present, load(booleanSlot(true, node), node), node);
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
                store(present, load(booleanSlot(false, node), node), node);
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
      case "bigint": {
        const constant = evalConstantBigInt(node);
        if (constant !== undefined) return bigIntConstantSlot(constant);
        const text = nextValue++;
        emit({
          kind: "string-literal",
          id: text,
          value: node.value,
          start: node.start,
          end: node.end,
        });
        return bigIntCall(
          bigIntRuntime().literal,
          [save(text, "string", node)],
          node,
        );
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
      case "class-expression":
        return emitClassDefinition(node);
      case "private-in": {
        const plan = records?.privateBrandChecks?.get(node);
        if (plan === undefined) throw "private brand check plan invariant";
        return emitPrivateBrandCheck(node, plan);
      }
      case "new-target": {
        const ctx = owned?.constructorContext;
        if (ctx !== undefined) {
          const slot = parameters[ctx.newTarget];
          if (slot === undefined) throw "new.target parameter invariant";
          const targetType = scalarType(node);
          return save(
            coerce(load(slot, node), targetType, node),
            targetType,
            node,
          );
        }
        const id = nextValue++;
        emit({ kind: "undefined", id, start: node.start, end: node.end });
        const targetType = scalarType(node);
        return save(coerce(id, targetType, node), targetType, node);
      }
      case "this": {
        requireSuperCalled(node);
        const local = info(node).local;
        if (local !== undefined)
          return save(
            coerce(readLocal(local, node), scalarType(node), node),
            scalarType(node),
            node,
          );
        if (receiverSlot === undefined)
          throw "receiver entry storage invariant";
        if (
          receiverReference !== undefined &&
          scalarType(node) === "reference"
        ) {
          const id = nextValue++;
          emit({
            kind: "reference-value",
            id,
            value: load(receiverReference, node),
            start: node.start,
            end: node.end,
          });
          return save(id, "reference", node);
        }
        return save(
          coerce(load(receiverSlot, node), scalarType(node), node),
          scalarType(node),
          node,
        );
      }
      case "identifier": {
        const global = info(node).realmGlobal;
        if (global !== undefined)
          return dynamicResult(
            global,
            [
              stringSlot(node.name, node),
              stringSlot(info(node).realmInstaller ?? "", node),
            ],
            node,
          );
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
      case "satisfies": {
        const downcast = info(node).downcast;
        if (downcast === undefined) return expression(node.expression);
        const called = ungroup(node.expression);
        if (
          called.kind === "call" &&
          scalarType(node) === "number" &&
          downcast.tests.length === 1 &&
          downcast.tests[0] === "number" &&
          downcast.records.length === 0 &&
          downcast.errors === undefined
        ) {
          const target = info(called).fixedFfiCall;
          if (target !== undefined) return fixedFfiCall(called, target, node);
        }
        return checkedDowncast(value(node.expression), node, downcast);
      }
      case "group":
        return expression(node.expression);
      case "unary": {
        if (node.operator === "-" || node.operator === "~") {
          const constant = evalConstantBigInt(node);
          if (constant !== undefined) return bigIntConstantSlot(constant);
        }
        if (info(node).builtin === "property-delete") {
          // Clears the presence byte and stores undefined: later reads see
          // undefined, `in` and own-key enumeration no longer see the field.
          const target = ungroup(node.operand);
          if (target.kind !== "member")
            throw "property delete target invariant";
          const access = records?.accesses.get(target);
          if (access === undefined) throw "property delete access invariant";
          const object = value(target.object),
            absent = nextValue++;
          emit({
            kind: "undefined",
            id: absent,
            start: node.start,
            end: node.end,
          });
          const cleared = save(
            coerce(absent, access.type, node),
            access.type,
            node,
          );
          recordAccess(object, cleared, "delete", access, node);
          return booleanSlot(true, node);
        }
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
            const classifier =
              node.generalTag === true ? undefined : info(node).realmTypeof;
            if (classifier !== undefined)
              return save(
                primitiveCall(classifier, [load(operand, node)], node),
                "string",
                node,
              );
            const record = info(node).bigIntRecord;
            const kind = (): number => {
              const id = nextValue++;
              emit({
                kind: "general-kind",
                id,
                value: load(operand, node),
                start: node.start,
                end: node.end,
              });
              return id;
            };
            if (record === undefined) return save(kind(), "string", node);
            // General values carry BigInts as BigIntValue objects.
            const result = temporary("string"),
              bigint = block(),
              other = block(),
              merge = block(),
              test = nextValue++;
            emit({
              kind: "general-record-is",
              id: test,
              value: load(operand, node),
              record,
              start: node.start,
              end: node.end,
            });
            choose(test, bigint, other, node);
            current = bigint;
            const name = nextValue++;
            emit({
              kind: "string-literal",
              id: name,
              value: "bigint",
              start: node.start,
              end: node.end,
            });
            store(result, name, node);
            jump(merge.id, node);
            current = other;
            store(result, kind(), node);
            jump(merge.id, node);
            current = merge;
            return result;
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
                ? info(node).typeofFunction
                  ? "function"
                  : info(node.operand).bigint === true
                    ? "bigint"
                    : "object"
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
                : info(node.operand).bigint === true
                  ? "bigint"
                  : type === "void"
                    ? "undefined"
                    : type === "number" ||
                        type === "boolean" ||
                        type === "string"
                      ? type
                      : "object",
            );
          return result;
        }
        if (info(node).speculative === true) {
          const helper = dynamicObjects?.speculativeUnary;
          if (helper === undefined)
            throw "speculative unary operation requires the program realm";
          return dynamicResult(
            helper,
            [stringSlot(node.operator, node), value(node.operand)],
            node,
          );
        }
        if (info(node.operand).bigint === true) {
          const operand = value(node.operand);
          if (node.operator === "!")
            return unarySlot(
              "!",
              save(truth(operand, node), "boolean", node),
              "boolean",
              node,
            );
          if (node.operator === "-" || node.operator === "~")
            return bigIntCall(
              node.operator === "-"
                ? bigIntRuntime().negate
                : bigIntRuntime().not,
              [operand],
              node,
            );
          throw "BigInt unary operator invariant";
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
        const operation = info(node).builtin;
        if (operation === "speculative-property-read")
          return speculativePropertyRead(node);
        if (
          operation === "flow-property-read" ||
          operation === "flow-property-read-boxed"
        )
          return flowPropertyRead(node);
        const indexView = info(node).cView;
        if (indexView !== undefined) return viewRead(node, indexView);
        const reference = propertyReference(
          value(node.object),
          value(node.index),
        );
        const finite = records?.finiteAccesses?.get(node);
        if (finite !== undefined) {
          const type = info(node).type;
          if (type === "void") throw "finite record read type invariant";
          const result = temporary(type);
          dispatchRecordKey(
            finite,
            reference.base,
            reference.key,
            result,
            "read",
            node,
          );
          return result;
        }
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
        return readArrayElement(array, index, node);
      }
      case "member": {
        const priv = records?.privateAccesses?.get(node);
        if (priv !== undefined) {
          const object = value(node.object),
            result = temporary(priv.type);
          callReceivers.set(node, object);
          emitPrivateAccess(object, priv, "read", result, node);
          return result;
        }
        const builtin = info(node).builtin;
        if (builtin === "super-member") {
          requireSuperCalled(node);
          const access = records?.accesses.get(node);
          if (access === undefined) throw "super member access invariant";
          const object = rawInstanceReference(node),
            result = temporary(access.type);
          callReceivers.set(node, object);
          recordAccess(object, result, "read", access, node);
          return result;
        }
        if (builtin === "speculative-property-read")
          return speculativePropertyRead(node);
        if (
          builtin === "flow-property-read" ||
          builtin === "flow-property-read-boxed"
        )
          return flowPropertyRead(node);
        if (builtin === "error-property") return errorProperty(node);
        const memberView = info(node).cView;
        if (memberView !== undefined) return viewRead(node, memberView);
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
        if (lengthKind === "list-length") {
          const plan = planPipeline(node, pipelineFacts);
          if (plan !== undefined) return lowerPipeline(plan, node);
        }
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
        const metadata = info(node).builtin;
        if (metadata === "array-bytes-per-element") {
          value(node.object);
          const bytes = info(node).constant;
          return numberSlot(typeof bytes === "number" ? bytes : 0, node);
        }
        if (
          metadata === "data-view-buffer" ||
          metadata === "data-view-byte-offset" ||
          metadata === "data-view-byte-length"
        ) {
          const helper = info(node).callee;
          if (helper === undefined) throw "DataView accessor helper invariant";
          const view = value(node.object);
          const bytes = runtimeCall(helper, [view], node);
          if (bytes === undefined) throw "DataView bytes invariant";
          const id = nextValue++;
          emit({
            kind:
              metadata === "data-view-buffer"
                ? "array-buffer"
                : metadata === "data-view-byte-offset"
                  ? "array-byte-offset"
                  : "array-byte-length",
            id,
            array: load(bytes, node.object),
            start: node.start,
            end: node.end,
          });
          const result = save(
            id,
            metadata === "data-view-buffer" ? "reference" : "number",
            node,
          );
          if (metadata === "data-view-byte-offset")
            conditionalStore(
              binarySlot("<", result, numberSlot(0, node), node),
              result,
              () => numberSlot(0, node),
              node,
            );
          return result;
        }
        if (metadata === "array-buffer-byte-length") {
          const rawBuffer = value(node.object),
            buffer =
              slots[rawBuffer] === "general"
                ? nativeSharedArrayBufferArgument(rawBuffer, node)
                : rawBuffer,
            id = nextValue++;
          emit({
            kind: "array-buffer-byte-length",
            id,
            buffer: load(buffer, node.object),
            start: node.start,
            end: node.end,
          });
          return save(id, "number", node);
        }
        const array = value(node.object),
          id = nextValue++;
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
        const result = save(
          id,
          metadata === "array-buffer" ? "reference" : "number",
          node,
        );
        // A detached view's data sits before its owner's (a negative
        // offset): its byteOffset is 0.
        if (metadata === "array-byte-offset")
          conditionalStore(
            binarySlot("<", result, numberSlot(0, node), node),
            result,
            () => numberSlot(0, node),
            node,
          );
        return result;
      }
      case "binary": {
        const constantBigInt = evalConstantBigInt(node);
        if (constantBigInt !== undefined)
          return bigIntConstantSlot(constantBigInt);
        if (info(node).builtin === "list-has") {
          const index = value(node.left),
            receiver = value(node.right);
          return listValue(
            listRuntime(node.right),
            "has",
            [receiver, index],
            node,
          );
        }

        const classTest = records?.classInstanceTests?.get(node);
        if (classTest !== undefined) return classInstanceOf(node, classTest);
        const metadata = info(node);
        const array = metadata.arrayInstance;
        if (array !== undefined) return arrayInstanceOf(node, array, metadata);
        if (metadata.sharedBufferInstance === true)
          return sharedBufferInstanceOf(node, metadata);
        const instance = metadata.realmInstanceOf;
        if (instance !== undefined && metadata.builtin === undefined) {
          const left = value(node.left);
          const right = value(node.right);
          return callRealmInstanceOf(instance, left, right, node);
        }
        const builtin = metadata.builtin;
        if (builtin === "data-view-instanceof") {
          const left = value(node.left);
          const record = metadata.dataViewRecord;
          if (record === undefined) return booleanSlot(false, node);
          const leftType = slots[left];
          if (
            leftType !== "general" &&
            leftType !== "reference" &&
            leftType !== "optional-reference"
          )
            return booleanSlot(false, node);
          const boxed =
            leftType === "general"
              ? load(left, node)
              : coerce(load(left, node), "general", node);
          const id = nextValue++;
          emit({
            kind: "general-record-is",
            id,
            value: boxed,
            record,
            start: node.start,
            end: node.end,
          });
          return save(id, "boolean", node);
        }
        if (builtin === "literal-property-has") {
          value(node.left);
          const object = value(node.right);
          // A typed record is never a realm error: test its layouts natively
          // (a realm error check would pass it to general code).
          const typedRecord =
            slots[object] === "reference" ||
            slots[object] === "optional-reference";
          const property = info(node).propertyKey;
          if (property === undefined) throw "literal property key invariant";
          const receiver = save(
            coerce(load(object, node), "general", node),
            "general",
            node,
          );
          const valid = nextValue++;
          emit({
            kind: "general-is",
            id: valid,
            value: load(receiver, node),
            type: "object",
            start: node.start,
            end: node.end,
          });
          requireCondition(
            save(valid, "boolean", node),
            "TypeError",
            "in requires an object operand",
            node,
          );
          return typedRecord
            ? nativeProperty(receiver, property, true, node)
            : literalPropertyOperation(receiver, property, true, node);
        }
        if (
          builtin === "type-error-is" ||
          builtin === "range-error-is" ||
          builtin === "error-is"
        ) {
          const kind: "Error" | "RangeError" | "TypeError" =
            builtin === "range-error-is"
              ? "RangeError"
              : builtin === "error-is"
                ? "Error"
                : "TypeError";
          const left = value(node.left),
            global = metadata.realmGlobal;
          if (global !== undefined && instance !== undefined) {
            const constructor = dynamicResult(
              global,
              [
                stringSlot(kind, node.right),
                stringSlot("installErrorIntrinsics", node.right),
              ],
              node.right,
            );
            return callRealmInstanceOf(instance, left, constructor, node);
          }
          return errorInstanceOf(left, kind, node);
        }

        if (node.operator === ",") {
          expression(node.left);
          return expression(node.right);
        }
        if (node.operator === "??")
          return nullishValue(value(node.left), node.left, node, () =>
            value(node.right),
          );
        if (
          generalObjectViews &&
          (node.operator === "===" || node.operator === "!==")
        ) {
          const literal =
            node.left.kind === "null" ||
            node.left.kind === "string" ||
            builtinUndefined(node.left)
              ? node.left
              : node.right;
          const compared = literal === node.left ? node.right : node.left;
          let tested = compared;
          let category:
            | "null"
            | "number"
            | "boolean"
            | "string"
            | "undefined"
            | "object"
            | undefined;
          if (literal.kind === "null") category = "null";
          else if (builtinUndefined(literal)) category = "undefined";
          else if (
            literal.kind === "string" &&
            compared.kind === "unary" &&
            compared.operator === "typeof"
          ) {
            const name = literal.value;
            // The realm classifier differs from the value tag only for
            // values with the object tag: callable and [[IsHTMLDDA]] objects,
            // symbols and BigInts. Number, boolean and string results are
            // the tag itself; "undefined" also covers [[IsHTMLDDA]].
            if (
              name === "number" ||
              name === "boolean" ||
              name === "string" ||
              (name === "undefined" &&
                (compared.generalTag === true ||
                  info(compared).realmTypeof === undefined)) ||
              (name === "object" && compared.generalTag === true)
            ) {
              category = name;
              tested = compared.operand;
            }
          }
          if (category !== undefined && info(tested).type === "general") {
            // The literal has no effects. Read the tag without materializing
            // a null box or a typeof result string.
            const operand = value(tested);
            const id = nextValue++;
            emit({
              kind: "general-is",
              id,
              value: coerce(load(operand, tested), "general", tested),
              type: category,
              branch: true,
              start: node.start,
              end: node.end,
            });
            const equal = save(id, "boolean", node);
            return node.operator === "==="
              ? equal
              : unarySlot("!", equal, "boolean", node);
          }
        }
        // A typed string `+` chain of three or more operands is built with
        // one allocation. Its operands are primitive, so converting each
        // right after evaluating it is unobservable.
        if (
          node.operator === "+" &&
          fusibleStringPlus(node) &&
          node.left.kind === "binary" &&
          fusibleStringPlus(node.left)
        ) {
          const leaves: StringChainLeaf[] = [];
          stringChainLeaves(node, leaves);
          const pieces: StringPiece[] = [];
          for (const entry of leaves) {
            if (entry === undefined) throw "string chain leaf invariant";
            pieces.push(lowerStringPiece(entry.leaf, entry.parent));
          }
          return emitStringPieces(pieces, node);
        }
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
        if (speculativeSlots[left] === 1 || speculativeSlots[right] === 1)
          return speculativeBinaryOperation(node, left, right);
        if (bigIntSlots[left] === 1 || bigIntSlots[right] === 1) {
          const lowered = bigIntBinary(node, left, right);
          if (lowered !== undefined) return lowered;
        }
        const errorContext = realmErrors;
        if (
          errorContext !== undefined &&
          (node.operator === "===" || node.operator === "!==") &&
          mayCarryError(left) &&
          mayCarryError(right) &&
          errorContext.applies(node)
        )
          return binarySlot(
            node.operator,
            exposedError(left, node),
            exposedError(right, node),
            node,
          );
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
            (referenceSlot(slots[left]) && undefinedSlots[right] === 1) ||
            (referenceSlot(slots[right]) && undefinedSlots[left] === 1),
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
        const updateView = info(node).cView,
          updateMember =
            updateView === undefined ? undefined : updateView.member;
        if (updateView !== undefined && updateMember !== undefined) {
          const place = viewPlace(target, updateView);
          requireViewIndex(place, target);
          const old = viewLoad(place, updateMember, target);
          // Members are never nullish: `??=` keeps the value.
          if (node.kind === "compound" && node.operator === "??") return old;
          if (
            node.kind === "compound" &&
            (node.operator === "&&" || node.operator === "||")
          )
            return logicalAssignment(old, node, (next) =>
              viewStore(
                place,
                updateMember,
                save(
                  next,
                  updateMember.value === "boolean" ? "boolean" : "number",
                  node,
                ),
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
          viewStore(place, updateMember, updated, node);
          return node.kind === "update" && !node.prefix ? old : updated;
        }
        const privateUpdate =
          target.kind === "member"
            ? records?.privateAccesses?.get(target)
            : undefined;
        if (target.kind === "member" && privateUpdate !== undefined) {
          const object = value(target.object);
          const old = temporary(privateUpdate.type);
          emitPrivateAccess(object, privateUpdate, "read", old, target);
          if (node.kind === "compound" && node.operator === "??")
            return nullishValue(old, target, node, () => {
              const next = value(node.value),
                transfer = save(
                  load(next, node.value),
                  privateUpdate.type,
                  node,
                );
              emitPrivateAccess(
                object,
                privateUpdate,
                "write",
                transfer,
                target,
              );
              return next;
            });
          if (
            node.kind === "compound" &&
            (node.operator === "&&" || node.operator === "||")
          )
            return logicalAssignment(old, node, (next) => {
              const transfer = save(next, privateUpdate.type, node);
              emitPrivateAccess(
                object,
                privateUpdate,
                "write",
                transfer,
                target,
              );
            });
          if (
            privateUpdate.type === "string" &&
            node.kind === "compound" &&
            node.operator === "+"
          ) {
            const right = value(node.value);
            const id = nextValue++;
            emit({
              kind: "string-concat",
              id,
              left: load(old, node),
              right: load(right, node),
              start: node.start,
              end: node.end,
            });
            const updated = save(id, "string", node);
            emitPrivateAccess(object, privateUpdate, "write", updated, target);
            return updated;
          }
          if (privateUpdate.type !== "number")
            throw "numeric private property update contract invariant";
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
          emitPrivateAccess(object, privateUpdate, "write", updated, target);
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
        // `s += piece` reads s after the piece when that is unobservable.
        if (
          string &&
          node.kind === "compound" &&
          node.operator === "+" &&
          slots[local] === "string" &&
          readableAfter(local, [node.value])
        ) {
          const right = value(node.value),
            old = save(readLocal(local, node.target), "string", node.target);
          const id = nextValue++;
          emit({
            kind: "string-concat",
            id,
            left: load(old, node),
            right: load(right, node),
            start: node.start,
            end: node.end,
          });
          const updated = save(id, "string", node);
          writeLocal(local, load(updated, node), node);
          return updated;
        }
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
        const plan = fn.bindingInitializations?.get(node);
        if (plan !== undefined)
          return initializeBindingPlan(plan, value(node.value));
        const target = ungroup(node.target);
        const finite = records?.finiteAccesses?.get(node);
        if (finite !== undefined) {
          if (target.kind !== "index")
            throw "finite record write target invariant";
          const object = value(target.object),
            key = value(target.index),
            assigned = value(node.value);
          dispatchRecordKey(finite, object, key, assigned, "write", node);
          return assigned;
        }
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
        const assignedView = info(node).cView,
          assignedMember =
            assignedView === undefined ? undefined : assignedView.member;
        if (assignedView !== undefined && assignedMember !== undefined) {
          const place = viewPlace(target, assignedView),
            result = value(node.value);
          requireViewIndex(place, node);
          viewStore(place, assignedMember, result, node);
          return result;
        }
        const privateAssign =
          target.kind === "member"
            ? records?.privateAccesses?.get(target)
            : undefined;
        if (target.kind === "member" && privateAssign !== undefined) {
          const object = value(target.object);
          const result = value(node.value);
          const transfer = save(load(result, node), privateAssign.type, node);
          emitPrivateAccess(object, privateAssign, "write", transfer, target);
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
          writeArrayElement(array, index, result, node);
          return result;
        }
        const local = info(node).local;
        if (local === undefined) throw "assignment invariant";
        const result = appendedChain(node.value, local) ?? value(node.value);
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
        // Empty literal parts add nothing; the pieces are concatenated at
        // once (emitStringPieces).
        const pieces: StringPiece[] = [];
        if (first.length > 0) pieces.push(stringLiteralPiece(first));
        for (let i = 0; i < node.substitutions.length; i++) {
          const substitution = node.substitutions[i],
            tail = node.parts[i + 1];
          if (substitution === undefined || tail === undefined)
            throw "template substitution invariant";
          const input = value(substitution);
          if (info(substitution).undefinedValue)
            pieces.push(stringLiteralPiece("undefined"));
          else if (info(substitution).nullValue)
            pieces.push(stringLiteralPiece("null"));
          else
            pieces.push({
              slot: stringOperand(input, node),
              oneByte: isStaticallyOneByteString(substitution),
              twoByte: false,
            });
          if (tail.length > 0) pieces.push(stringLiteralPiece(tail));
        }
        return pieces.length === 0 ? part("") : emitStringPieces(pieces, node);
      }
      case "call": {
        if (node.scriptArgument === "count") {
          const id = nextValue++;
          emit({
            kind: "script-argument-count",
            id,
            start: node.start,
            end: node.end,
          });
          return save(id, "number", node);
        }
        if (node.scriptArgument === "index") {
          const argument = node.arguments[0];
          if (argument === undefined) throw "script argument index invariant";
          const index = load(value(argument), node),
            id = nextValue++;
          emit({
            kind: "script-argument",
            id,
            index,
            start: node.start,
            end: node.end,
          });
          return save(id, "general", node);
        }
        if (metadata.fixedFfiCall !== undefined)
          return fixedFfiCall(node, metadata.fixedFfiCall);
        const general = metadata.generalCall;
        if (general !== undefined) return generalCall(node, general);
        const created = info(node).cView;
        if (created !== undefined) return viewNew(node, created);
        const builtin = info(node).builtin;
        if (builtin === "super-call") {
          const ctx = owned?.constructorContext,
            baseInit = ctx?.baseInit;
          if (
            ctx === undefined ||
            baseInit === undefined ||
            superCalled === undefined
          )
            throw "super call context invariant";
          const baseSig = signatures[baseInit.target];
          if (baseSig === undefined) throw "base init signature invariant";
          const rest = info(node).rest;
          let userArgs: number[];
          if (rest === undefined) userArgs = node.arguments.map(value);
          else {
            userArgs = node.arguments.slice(0, rest.start).map(value);
            supplyOmittedArguments(
              userArgs,
              baseSig.parameters.slice(2),
              rest.start,
              node,
            );
            userArgs.push(packCallArguments(node.arguments, rest, node));
          }
          const instanceRef = rawInstanceReference(node),
            newTargetSlot = parameters[ctx.newTarget],
            baseInitSlot = parameters[baseInit.parameter];
          if (newTargetSlot === undefined || baseInitSlot === undefined)
            throw "super call parameter invariant";
          const initSlots: number[] = [instanceRef, newTargetSlot];
          for (const arg of userArgs) initSlots.push(arg);
          supplyOmittedArguments(
            initSlots,
            baseSig.parameters,
            baseSig.parameters.length,
            node,
          );
          const preparedInit = initSlots.map((slot, index) => {
            const param = baseSig.parameters[index];
            if (param === undefined) throw "base init parameter invariant";
            return slots[slot] === param
              ? slot
              : save(coerce(load(slot, node), param, node), param, node);
          });
          const initCall = callValue(
            load(baseInitSlot, node),
            preparedInit.map((slot) => load(slot, node)),
          );
          emit({
            kind: "call-indirect",
            id: undefined,
            target: baseInit.target,
            callee: initCall.callee,
            arguments: initCall.arguments,
            start: node.start,
            end: node.end,
          });
          const already = block(),
            fresh = block();
          choose(load(superCalled, node), already, fresh, node);
          current = already;
          throwNativeError(
            "ReferenceError",
            "Super constructor may only be called once",
            node,
          );
          current = fresh;
          store(superCalled, load(booleanSlot(true, node), node), node);
          const ctorReceiverLocal = fn.receiverLocal;
          if (ctorReceiverLocal !== undefined && receiverSlot !== undefined) {
            store(
              ctorReceiverLocal,
              coerce(load(receiverSlot, node), slots[ctorReceiverLocal], node),
              node,
            );
            cellAccess(ctorReceiverLocal, "initialize", node);
          }
          const ownFields = ctx.ownFields;
          if (ownFields !== undefined) {
            const ownFieldsSlot = parameters[ownFields.parameter];
            if (ownFieldsSlot === undefined)
              throw "super own fields parameter invariant";
            const fieldsCall = callValue(load(ownFieldsSlot, node), [
              load(instanceRef, node),
            ]);
            emit({
              kind: "call-indirect",
              id: undefined,
              target: ownFields.target,
              callee: fieldsCall.callee,
              arguments: fieldsCall.arguments,
              start: node.start,
              end: node.end,
            });
          }
          const targetType = scalarType(node);
          return save(
            coerce(load(instanceRef, node), targetType, node),
            targetType,
            node,
          );
        }
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
          if (speculativeSlots[input] === 1) return stringOperand(input, node);
          if (slots[input] === "general") return unknownToString(input, node);
          return stringOperand(input, node);
        }
        if (builtin === "bigint-from-string") {
          const argument = node.arguments[0];
          if (argument === undefined || argument.kind === "spread")
            throw "BigInt conversion argument invariant";
          const helper = dynamicObjects?.bigIntFromString;
          if (helper === undefined)
            throw "BigInt(string) requires the program realm";
          const slot = dynamicResult(helper, [value(argument)], node);
          bigIntSlots[slot] = 1;
          return slot;
        }
        if (builtin === "json-parse" || builtin === "json-stringify") {
          const helper =
            builtin === "json-parse"
              ? dynamicObjects?.jsonParse
              : dynamicObjects?.jsonStringify;
          if (helper === undefined)
            throw builtin + " requires the program realm";
          const args = node.arguments.map(value);
          function missingArgument(): number {
            const id = nextValue++;
            emit({
              kind: "general-none",
              id,
              start: node.start,
              end: node.end,
            });
            return save(id, "general", node);
          }
          if (builtin === "json-parse") {
            const textArg = args[0] ?? missingArgument();
            const reviverArg = args[1] ?? missingArgument();
            return dynamicResult(helper, [textArg, reviverArg], node);
          }
          const valueArg = args[0] ?? missingArgument();
          const replacerArg = args[1] ?? missingArgument();
          const spaceArg = args[2] ?? missingArgument();
          const raw = dynamicResult(
            helper,
            [valueArg, replacerArg, spaceArg],
            node,
          );
          const expected = info(node).type;
          if (expected === "optional-string" || expected === "void") return raw;
          if (expected === "string") {
            const present = nextValue++;
            emitPresence(present, load(raw, node), true, node);
            requireCondition(
              save(present, "boolean", node),
              "TypeError",
              "JSON.stringify returned undefined",
              node,
            );
            const unwrapped = nextValue++;
            emit({
              kind: "string-value",
              id: unwrapped,
              value: load(raw, node),
              start: node.start,
              end: node.end,
            });
            return save(unwrapped, "string", node);
          }
          return save(coerce(load(raw, node), expected, node), expected, node);
        }
        if (
          builtin === "number-from-bigint" ||
          builtin === "bigint-identity" ||
          builtin === "bigint-from-number" ||
          builtin === "bigint-from-boolean"
        ) {
          const argument = node.arguments[0];
          if (argument === undefined || argument.kind === "spread")
            throw "BigInt conversion argument invariant";
          const input = value(argument);
          if (builtin === "bigint-identity") return input;
          const runtime = bigIntRuntime();
          if (builtin === "number-from-bigint") {
            const result = runtimeCall(runtime.toNumber, [input], node);
            if (result === undefined) throw "BigInt conversion invariant";
            return result;
          }
          return bigIntCall(
            builtin === "bigint-from-number"
              ? runtime.fromNumber
              : runtime.fromBoolean,
            [input],
            node,
          );
        }
        if (builtin === "gc-epoch") {
          const id = nextValue++;
          emit({ kind: "gc-epoch", id, start: node.start, end: node.end });
          return save(id, "number", node);
        }
        if (builtin === "uses-address-hash") {
          const first = node.arguments[0];
          if (first === undefined) return booleanSlot(false, node);
          const arg = value(first),
            slotType = slots[arg];
          const addressHashed =
            bigIntSlots[arg] !== 1 &&
            (slotType === "reference" ||
              slotType === "optional-reference" ||
              slotType === "general" ||
              nativeTypedArray(slotType) !== undefined);
          return booleanSlot(addressHashed, node);
        }
        if (builtin === "reference-hash") {
          const first = node.arguments[0];
          if (first === undefined) return numberSlot(0, node);
          const arg = value(first),
            slotType = slots[arg];
          if (bigIntSlots[arg] === 1 && slotType === "reference") {
            const hashed = runtimeCall(bigIntRuntime().hash, [arg], node);
            if (hashed === undefined) throw "BigInt hash invariant";
            return hashed;
          }
          if (bigIntSlots[arg] === 1 && slotType === "optional-reference") {
            const result = temporary("number"),
              present = block(),
              absent = block(),
              done = block(),
              test = nextValue++;
            emit({
              kind: "unary",
              operator: "truthy",
              id: test,
              operand: load(arg, node),
              start: node.start,
              end: node.end,
            });
            choose(test, present, absent, node);
            current = present;
            const presentSlot = save(load(arg, node), "reference", node);
            const hashed = runtimeCall(
              bigIntRuntime().hash,
              [presentSlot],
              node,
            );
            if (hashed === undefined) throw "BigInt hash invariant";
            store(result, load(hashed, node), node);
            jump(done.id, node);
            current = absent;
            store(result, load(numberSlot(0, node), node), node);
            jump(done.id, node);
            current = done;
            return result;
          }
          if (slotType === "general") {
            const bigintRecord = info(node).bigIntRecord;
            if (bigints !== undefined && bigintRecord !== undefined) {
              const result = temporary("number"),
                asBigInt = block(),
                notBigInt = block(),
                done = block();
              choose(
                errorRecordTest(load(arg, node), bigintRecord, node),
                asBigInt,
                notBigInt,
                node,
              );
              current = asBigInt;
              const bigintRef = save(
                coerce(load(arg, node), "reference", node),
                "reference",
                node,
              );
              const hashed = runtimeCall(
                bigIntRuntime().hash,
                [bigintRef],
                node,
              );
              if (hashed === undefined) throw "BigInt hash invariant";
              store(result, load(hashed, node), node);
              jump(done.id, node);
              current = notBigInt;
              const id = nextValue++;
              emit({
                kind: "reference-hash",
                id,
                value: load(arg, node),
                start: node.start,
                end: node.end,
              });
              store(result, id, node);
              jump(done.id, node);
              current = done;
              return result;
            }
            const id = nextValue++;
            emit({
              kind: "reference-hash",
              id,
              value: load(arg, node),
              start: node.start,
              end: node.end,
            });
            return save(id, "number", node);
          }
          if (
            slotType === "reference" ||
            slotType === "optional-reference" ||
            nativeTypedArray(slotType) !== undefined
          ) {
            const id = nextValue++;
            emit({
              kind: "reference-hash",
              id,
              value: load(arg, node),
              start: node.start,
              end: node.end,
            });
            return save(id, "number", node);
          }
          return numberSlot(0, node);
        }
        if (builtin !== undefined && builtin !== "function-call") {
          const target = ungroup(node.callee);
          if (target.kind !== "member") throw "builtin target invariant";
          if (builtin === "math-min" || builtin === "math-max") {
            // Every argument is evaluated before folding. A pairwise min/max
            // propagates NaN and orders -0 below +0, as the builtin does.
            const args = node.arguments.map(value),
              min = builtin === "math-min",
              first = args[0];
            if (first === undefined)
              return numberSlot(min ? 1 / 0 : -1 / 0, node);
            let result = save(load(first, node), "number", node);
            for (let i = 1; i < args.length; i++) {
              const arg = args[i];
              if (arg === undefined) throw "argument slot invariant";
              result = binarySlot(min ? "min" : "max", result, arg, node);
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
            builtin === "indexed-reduce"
          ) {
            const plan = planPipeline(node, pipelineFacts);
            if (plan !== undefined) return lowerPipeline(plan, node);
          }
          if (
            builtin === "indexed-reduce" ||
            builtin === "indexed-reduce-right"
          ) {
            const reverse = builtin === "indexed-reduce-right";
            const receiver = value(target.object);
            const callbackArg = node.arguments[0];
            if (callbackArg === undefined) throw "reduce callback invariant";
            const callback = value(callbackArg);
            const initialArg = node.arguments[1];
            const initial =
              initialArg === undefined ? undefined : value(initialArg);
            const receiverType = slots[receiver];
            const typed = isNativeTypedArray(receiverType);
            if (typed) rejectDetachedReceiver(receiver, node);
            const input = typed ? undefined : listRuntime(target.object);
            const length =
              input === undefined
                ? arrayLength(receiver, node)
                : listValue(input, "length", [receiver], node);
            const accType = scalarType(node);
            const allocated = allocateAccumulatorSlot(accType, initial, node);
            const result = allocated.slot;
            const storageType = allocated.storageType;
            let hasAccumulator: number | undefined;
            if (initial === undefined)
              hasAccumulator = booleanSlot(false, node);
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
            if (typed) jump(invoke.id, node);
            else {
              if (input === undefined) throw "list reduce runtime invariant";
              choose(
                load(listValue(input, "has", [receiver, index], node), node),
                invoke,
                advance,
                node,
              );
            }
            current = invoke;
            const item =
              input === undefined
                ? readArrayElement(receiver, index, node)
                : listValue(input, "read", [receiver, index], node);
            if (hasAccumulator === undefined) {
              const returned = callCallback(
                node,
                callback,
                [result, item, index, receiver],
                node,
              );
              if (returned === undefined) throw "reduce result invariant";
              store(result, unwrapSlotValue(returned, storageType, node), node);
              jump(advance.id, node);
            } else {
              const initAcc = block(),
                callReduce = block();
              choose(load(hasAccumulator, node), callReduce, initAcc, node);
              current = initAcc;
              store(result, unwrapSlotValue(item, storageType, node), node);
              store(hasAccumulator, load(booleanSlot(true, node), node), node);
              jump(advance.id, node);
              current = callReduce;
              const returned = callCallback(
                node,
                callback,
                [result, item, index, receiver],
                node,
              );
              if (returned === undefined) throw "reduce result invariant";
              store(result, unwrapSlotValue(returned, storageType, node), node);
              jump(advance.id, node);
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
            if (hasAccumulator !== undefined) {
              const ready = block(),
                empty = block();
              choose(load(hasAccumulator, node), ready, empty, node);
              current = empty;
              throwNativeError(
                "TypeError",
                "Reduce of empty array with no initial value",
                node,
              );
              current = ready;
              if (storageType !== accType)
                return save(
                  unwrapSlotValue(result, accType, node),
                  accType,
                  node,
                );
            }
            return result;
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
            const typed = isNativeTypedArray(receiverType);
            const callback = value(argument);
            if (typed) rejectDetachedReceiver(receiver, node);
            const input = typed ? undefined : listRuntime(target.object),
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
            if (input === undefined)
              item = readArrayElement(receiver, index, node);
            else item = listValue(input, "read", [receiver, index], node);
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
            if (runtime.pop !== undefined)
              return listValue(runtime, "pop", [receiver], node);
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
              args = node.arguments.map(value);
            if (builtin === "array-join")
              rejectDetachedReceiver(receiver, node);
            const runtime =
              builtin === "list-join" ? listRuntime(target.object) : undefined;
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
              if (runtime === undefined)
                item = readArrayElement(receiver, index, node);
              else item = listValue(runtime, "read", [receiver, index], node);
              const present = nextValue++,
                itemSlotType = slots[item],
                isOptionalRef = itemSlotType === "optional-reference",
                isString = itemSlotType === "optional-string";
              if (isOptionalRef)
                emit({
                  kind: "unary",
                  operator: "truthy",
                  id: present,
                  operand: load(item, node),
                  start: node.start,
                  end: node.end,
                });
              else emitPresence(present, load(item, node), isString, node);
              const include = block(),
                advance = block();
              choose(present, include, advance, node);
              current = include;
              const extracted = nextValue++;
              const elementType = isOptionalRef
                ? "reference"
                : isString
                  ? "string"
                  : itemSlotType === "optional-boolean"
                    ? "boolean"
                    : "number";
              emitUnwrap(extracted, load(item, node), elementType, node);
              const unwrappedSlot = save(extracted, elementType, node);
              if (isOptionalRef)
                visit(
                  bigIntCall(bigIntRuntime().toString, [unwrappedSlot], node),
                );
              else visit(stringOperand(unwrappedSlot, node));
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
            // The result is two-byte exactly when some part is (strings
            // are canonical).
            const total = numberSlot(0, node),
              twoByte = booleanSlot(false, node);
            visitParts((part) => {
              add(total, lengthOf(part));
              const wide = nextValue++;
              emit({
                kind: "string-two-byte",
                id: wide,
                string: load(part, node),
                start: node.start,
                end: node.end,
              });
              conditionalStore(
                save(wide, "boolean", node),
                twoByte,
                () => booleanSlot(true, node),
                node,
              );
            });
            const allocated = nextValue++;
            emit({
              kind: "string-allocate",
              id: allocated,
              length: load(total, node),
              twoByte: load(twoByte, node),
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
            // Omitted bounds copy from 0 to the length: the count is the
            // length and source indices are the (integer) loop index itself.
            const fromStart = begin === zero,
              count =
                fromStart && limit === length
                  ? length
                  : binarySlot("-", limit, begin, node);
            if (count !== length)
              conditionalStore(
                binarySlot("<", count, zero, node),
                count,
                () => zero,
                node,
              );
            // A number list reserves the count. A reference list gets no
            // hint: the dense copy fast path (bulkListCopies) allocates the
            // destination's vector at the count itself, but only while the
            // destination has none.
            const result = listValue(
              output,
              "create",
              [info(node).listElement === "number" ? count : zero],
              node,
            );
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
            const sourceIndex = fromStart
              ? index
              : binarySlot("+", begin, index, node);
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
              input = args[0];
            rejectDetachedReceiver(destination, node);
            if (input === undefined) throw "set source invariant";
            const kind = info(node).arraySetSource;
            let source = input;
            if (slots[input] === "general") {
              if (kind === undefined) {
                requireCondition(
                  booleanSlot(false, node),
                  "TypeError",
                  nativeArrayArgumentMessage,
                  node,
                );
                return undefined;
              }
              source = nativeArrayArgument(input, kind, node);
            }
            const type = slots[source];
            if (!isNativeTypedArray(type)) throw "set element kind invariant";
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
              type: typedArraySlot(type),
              length: load(length, node),
              start: node.start,
              end: node.end,
            });
            const snapshot = save(id, typedArraySlot(type), node);
            copyElements(source, snapshot, length, zero, zero, node);
            copyElements(snapshot, destination, length, offset, zero, node);
            jump(done.id, node);
            current = done;
            return undefined;
          }
          if (builtin === "array-subarray" || builtin === "array-slice") {
            const array = value(target.object),
              args = node.arguments.map(value);
            rejectDetachedReceiver(array, node);
            const lengthId = nextValue++;
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
              if (!isNativeTypedArray(type)) throw "slice receiver invariant";
              const id = nextValue++;
              emit({
                kind: "array-new",
                id,
                type: typedArraySlot(type),
                length: load(count, node),
                start: node.start,
                end: node.end,
              });
              const result = save(id, typedArraySlot(type), node);
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
            const receiver = value(target.object);
            if (builtin === "array-reverse")
              rejectDetachedReceiver(receiver, node);
            const runtime =
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
              if (typedArrayBigIntElements(slots[receiver])) {
                const leftOpt = readArrayElement(receiver, lower, node),
                  rightOpt = readArrayElement(receiver, upper, node),
                  leftVal = nextValue++,
                  rightVal = nextValue++;
                emitUnwrap(leftVal, load(leftOpt, node), "reference", node);
                emitUnwrap(rightVal, load(rightOpt, node), "reference", node);
                writeArrayElement(
                  receiver,
                  lower,
                  save(rightVal, "reference", node),
                  node,
                );
                writeArrayElement(
                  receiver,
                  upper,
                  save(leftVal, "reference", node),
                  node,
                );
              } else {
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
              }
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
            if (builtin === "array-at") rejectDetachedReceiver(receiver, node);
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
            const resultType = scalarType(node),
              result = temporary(resultType),
              absent = nextValue++;
            if (resultType === "optional-reference") {
              emit({
                kind: "reference-none",
                id: absent,
                start: node.start,
                end: node.end,
              });
              if (typedArrayBigIntElements(slots[receiver]))
                bigIntSlots[result] = 1;
            } else {
              emit({
                kind: "undefined",
                id: absent,
                start: node.start,
                end: node.end,
              });
            }
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
              const readSlot = readArrayElement(receiver, index, node);
              store(result, load(readSlot, node), node);
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
            const cacheable =
                inputLimit === undefined && slots[list] === "reference",
              finish = cacheable ? block() : done;
            function copySplitList(
              source: number,
              target: number,
              count: number,
              after: Builder,
            ): void {
              listCall(runtime, "resize", [target, count], node);
              const copyIndex = numberSlot(0, node),
                copyOne = numberSlot(1, node),
                copyHead = block(),
                copyVisit = block(),
                copyBody = block(),
                copyStep = block();
              jump(copyHead.id, node);
              current = copyHead;
              choose(
                load(binarySlot("<", copyIndex, count, node), node),
                copyVisit,
                after,
                node,
              );
              current = copyVisit;
              choose(
                load(
                  listValue(runtime, "has", [source, copyIndex], node),
                  node,
                ),
                copyBody,
                copyStep,
                node,
              );
              current = copyBody;
              const item = listValue(
                runtime,
                "read",
                [source, copyIndex],
                node,
              );
              listCall(runtime, "write", [target, copyIndex, item], node);
              jump(copyStep.id, node);
              current = copyStep;
              store(
                copyIndex,
                load(binarySlot("+", copyIndex, copyOne, node), node),
                node,
              );
              jump(copyHead.id, node);
            }
            if (cacheable) {
              const cachedId = nextValue++;
              emit({
                kind: "string-split-cached",
                id: cachedId,
                string: load(string, node),
                separator: load(separator, node),
                template: load(list, node),
                start: node.start,
                end: node.end,
              });
              const cached = save(cachedId, "optional-reference", node),
                hitCheck = nextValue++;
              emit({
                kind: "unary",
                id: hitCheck,
                operator: "truthy",
                operand: load(cached, node),
                start: node.start,
                end: node.end,
              });
              const hit = block(),
                miss = block();
              choose(hitCheck, hit, miss, node);
              current = hit;
              const unwrapped = nextValue++;
              emit({
                kind: "reference-value",
                id: unwrapped,
                value: load(cached, node),
                start: node.start,
                end: node.end,
              });
              const snapshot = save(unwrapped, "reference", node),
                cachedLength = listValue(runtime, "length", [snapshot], node);
              copySplitList(snapshot, list, cachedLength, done);
              current = miss;
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
              finish,
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
              finish,
              node,
            );
            current = unitBody;
            const next = binarySlot("+", index, numberSlot(1, node), node);
            append(index, next);
            store(index, load(next, node), node);
            jump(unitHead.id, node);
            current = delimited;
            // Each piece ends at the separator's next occurrence at or after
            // its start.
            const head = block(),
              matched = block(),
              resume = block(),
              tail = block();
            jump(head.id, node);
            current = head;
            const found = nextValue++;
            emit({
              kind: "string-index-of",
              id: found,
              string: load(string, node),
              search: load(separator, node),
              position: load(start, node),
              reverse: false,
              start: node.start,
              end: node.end,
            });
            const position = save(found, "number", node);
            choose(
              load(binarySlot("<", position, zero, node), node),
              tail,
              matched,
              node,
            );
            current = matched;
            append(start, position);
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
              finish,
              resume,
              node,
            );
            current = resume;
            store(
              start,
              load(binarySlot("+", position, width, node), node),
              node,
            );
            jump(head.id, node);
            current = tail;
            append(start, length);
            jump(finish.id, node);
            if (cacheable) {
              current = finish;
              const count = listValue(runtime, "length", [list], node),
                maxCached = numberSlot(256, node),
                storeCheck = block(),
                storeCache = block(),
                commitCache = block();
              choose(
                load(binarySlot(">", count, zero, node), node),
                storeCheck,
                done,
                node,
              );
              current = storeCheck;
              choose(
                load(binarySlot("<=", count, maxCached, node), node),
                storeCache,
                done,
                node,
              );
              current = storeCache;
              const snapshot = listValue(runtime, "create", [zero], node);
              copySplitList(list, snapshot, count, commitCache);
              current = commitCache;
              emit({
                kind: "string-split-cache",
                string: load(string, node),
                separator: load(separator, node),
                value: load(snapshot, node),
                start: node.start,
                end: node.end,
              });
              jump(done.id, node);
            }
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
            const found = nextValue++;
            emit({
              kind: "string-index-of",
              id: found,
              string: load(string, node),
              search: load(search, node),
              position: load(index, node),
              reverse,
              start: node.start,
              end: node.end,
            });
            const result = save(found, "number", node);
            if (indexResult) return result;
            return binarySlot("!==", result, numberSlot(-1, node), node);
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
              args = node.arguments.map(value);
            if (args[1] === undefined) {
              const first = args[0],
                start =
                  first === undefined
                    ? numberSlot(0, node)
                    : save(numericInput(first, node), "number", node);
              if (first !== undefined) {
                const clamp = block(),
                  done = block();
                choose(
                  load(binarySlot(">", start, numberSlot(0, node), node), node),
                  done,
                  clamp,
                  node,
                );
                current = clamp;
                store(start, load(numberSlot(0, node), node), node);
                jump(done.id, node);
                current = done;
              }
              const limit = nextValue++;
              emit({
                kind: "undefined",
                id: limit,
                start: node.start,
                end: node.end,
              });
              const id = nextValue++;
              emit({
                kind: "string-slice",
                id,
                string: load(string, node),
                begin: load(start, node),
                limit,
                start: node.start,
                end: node.end,
              });
              return save(id, "string", node);
            }
            const lengthId = nextValue++;
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
          if (builtin === "helper-call") {
            const helper = info(node).callee;
            if (helper === undefined) throw "builtin helper callee invariant";
            const callArgs = node.arguments.map(value);
            const result = runtimeCall(helper, callArgs, node);
            if (result === undefined) throw "builtin helper result invariant";
            return result;
          }
          if (builtin === "math-hypot") {
            const callArgs = node.arguments.map(value);
            if (callArgs.length === 0) return numberSlot(0, node);
            if (callArgs.length === 1) {
              const firstArg = callArgs[0];
              if (firstArg === undefined) throw "math hypot argument invariant";
              const result = save(load(firstArg, node), "number", node),
                zero = numberSlot(0, node);
              conditionalStore(
                binarySlot("<", firstArg, zero, node),
                result,
                () => unarySlot("-", firstArg, "number", node),
                node,
              );
              conditionalStore(
                binarySlot("===", firstArg, zero, node),
                result,
                () => zero,
                node,
              );
              return result;
            }
            const helper = info(node).callee;
            if (helper === undefined) throw "math hypot helper invariant";
            if (callArgs.length === 2 || callArgs.length === 3) {
              const result = runtimeCall(helper, callArgs, node);
              if (result === undefined) throw "math hypot result invariant";
              return result;
            }
            const count = numberSlot(callArgs.length, node),
              arrId = nextValue++;
            emit({
              kind: "array-new",
              id: arrId,
              type: "Float64Array",
              length: load(count, node),
              start: node.start,
              end: node.end,
            });
            const arr = save(arrId, "Float64Array", node);
            for (let i = 0; i < callArgs.length; i++) {
              const arg = callArgs[i];
              if (arg === undefined) throw "math hypot element invariant";
              emit({
                kind: "array-write",
                array: load(arr, node),
                index: load(numberSlot(i, node), node),
                value: load(arg, node),
                start: node.start,
                end: node.end,
              });
            }
            const result = runtimeCall(helper, [arr], node);
            if (result === undefined) throw "math hypot result invariant";
            return result;
          }
          if (builtin === "string-helper") {
            const helper = info(node).callee;
            if (helper === undefined) throw "string helper callee invariant";
            const receiver = value(target.object);
            const callArgs = node.arguments.map(value);
            const result = runtimeCall(helper, [receiver, ...callArgs], node);
            if (result === undefined) throw "string helper result invariant";
            return result;
          }
          if (builtin === "string-normalize") {
            const helper = info(node).callee;
            if (helper === undefined) throw "string normalize callee invariant";
            const receiver = value(target.object);
            let form: number;
            if (node.arguments.length === 0) {
              const none = nextValue++;
              emit({
                kind: "string-none",
                id: none,
                start: node.start,
                end: node.end,
              });
              form = save(none, "optional-string", node);
            } else {
              const arg = node.arguments[0];
              if (arg === undefined)
                throw "string normalize argument invariant";
              form = value(arg);
            }
            const result = runtimeCall(helper, [receiver, form], node);
            if (result === undefined) throw "string normalize result invariant";
            return result;
          }
          if (builtin === "number-to-string") {
            return stringOperand(value(target.object), node);
          }
          if (builtin === "number-format") {
            const helper = info(node).callee;
            if (helper === undefined) throw "number format callee invariant";
            const receiver = value(target.object);
            let argument: number;
            if (node.arguments.length === 0) {
              const none = nextValue++;
              emit({
                kind: "undefined",
                id: none,
                start: node.start,
                end: node.end,
              });
              argument = save(none, "optional-number", node);
            } else {
              const arg = node.arguments[0];
              if (arg === undefined) throw "number format argument invariant";
              argument = value(arg);
            }
            const result = runtimeCall(helper, [receiver, argument], node);
            if (result === undefined) throw "number format result invariant";
            return result;
          }
          if (builtin === "data-view-get" || builtin === "data-view-set") {
            const helper = info(node).callee;
            const sig = helper === undefined ? undefined : signatures[helper];
            if (helper === undefined || sig === undefined)
              throw "DataView method callee invariant";
            const receiver = value(target.object);
            const callArgs: number[] = [receiver];
            for (const arg of node.arguments) {
              if (arg === undefined) throw "DataView argument invariant";
              callArgs.push(value(arg));
            }
            while (callArgs.length < sig.parameters.length) {
              const expected = sig.parameters[callArgs.length];
              if (expected === "optional-boolean") {
                const none = nextValue++;
                emit({
                  kind: "boolean-none",
                  id: none,
                  start: node.start,
                  end: node.end,
                });
                callArgs.push(save(none, "optional-boolean", node));
              } else if (expected === "boolean") {
                callArgs.push(booleanSlot(false, node));
              } else {
                throw "DataView optional parameter invariant";
              }
            }
            return runtimeCall(helper, callArgs, node);
          }
          const filling = builtin === "array-fill" || builtin === "list-fill";
          const array = filling ? value(target.object) : undefined;
          const args = node.arguments.map(value),
            first = args[0];
          if (first === undefined) throw "builtin argument invariant";
          if (builtin === "array-fill" && array !== undefined)
            rejectDetachedReceiver(array, node);
          if (
            builtin === "atomics-wait-int32" ||
            builtin === "atomics-wait-bigint64"
          ) {
            const waitCallee = info(node).callee;
            if (waitCallee === undefined) throw "atomics wait callee invariant";
            return atomicsWaitCall(
              builtin === "atomics-wait-int32" ? "Int32Array" : "BigInt64Array",
              waitCallee,
              args,
              node,
            );
          }
          if (
            builtin === "atomics-notify-int32" ||
            builtin === "atomics-notify-bigint64"
          ) {
            const notifyCallee = info(node).callee;
            if (notifyCallee === undefined)
              throw "atomics notify callee invariant";
            return atomicsNotifyCall(
              builtin === "atomics-notify-int32"
                ? "Int32Array"
                : "BigInt64Array",
              notifyCallee,
              args,
              node,
            );
          }
          if (
            builtin === "atomics-uint8" ||
            builtin === "atomics-int8" ||
            builtin === "atomics-uint16" ||
            builtin === "atomics-int16" ||
            builtin === "atomics-uint32" ||
            builtin === "atomics-int32" ||
            builtin === "atomics-bigint64" ||
            builtin === "atomics-biguint64"
          ) {
            if (target.kind !== "member") throw "atomics callee invariant";
            const atomicKind =
              builtin === "atomics-uint8"
                ? "Uint8Array"
                : builtin === "atomics-int8"
                  ? "Int8Array"
                  : builtin === "atomics-uint16"
                    ? "Uint16Array"
                    : builtin === "atomics-int16"
                      ? "Int16Array"
                      : builtin === "atomics-uint32"
                        ? "Uint32Array"
                        : builtin === "atomics-int32"
                          ? "Int32Array"
                          : builtin === "atomics-bigint64"
                            ? "BigInt64Array"
                            : "BigUint64Array";
            return atomicsCall(target.property, atomicKind, args, node);
          }
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
              builtin === "ceil" ||
                builtin === "trunc" ||
                builtin === "sqrt" ||
                builtin === "fround" ||
                builtin === "f16round"
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
          if (runtime === undefined) {
            // One bulk store of the value, converted once to the element
            // encoding (the conversion is pure, so this equals per-element
            // writes).
            if (typedArrayBigIntElements(slots[array])) {
              const scratch = word64Scratch();
              emitBigIntToWord64(first, scratch, 0, node);
              emit({
                kind: "array-word64-fill",
                array: load(array, node),
                scratch: load(scratch, node),
                from: load(index, node),
                to: load(limit, node),
                start: node.start,
                end: node.end,
              });
            } else {
              emit({
                kind: "array-fill",
                array: load(array, node),
                value: load(first, node),
                from: load(index, node),
                to: load(limit, node),
                start: node.start,
                end: node.end,
              });
            }
            return array;
          }
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
          listCall(runtime, "write", [array, index, first], node);
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
        const target = info(node).callee;
        const pureConstantArgs = node.arguments.every(
          (arg) =>
            arg !== undefined &&
            (arg.kind === "number" ||
              arg.kind === "boolean" ||
              arg.kind === "string" ||
              arg.kind === "null"),
        );
        const directMethodCall =
          info(node).indirect &&
          !explicitReceiver &&
          node.scriptCall !== true &&
          info(node).voidCallResults === undefined &&
          pureConstantArgs &&
          info(node).rest === undefined &&
          target !== undefined;
        if (directMethodCall && target !== undefined) {
          const directDone = block();
          const targetSignature = signatures[target];
          const directResultType =
            targetSignature?.returnType === "void" || info(node).type === "void"
              ? undefined
              : scalarType(node);
          const directResult =
            directResultType === undefined
              ? undefined
              : temporary(directResultType);
          const directMethod = methodCallee(calleeNode, {
            onLeaf: (leafSlot, receiverSlotId) => {
              const returned = invoke(
                target,
                callArguments(node.arguments, target, node),
                leafSlot,
                receiverSlotId,
                node,
              );
              if (
                directResult !== undefined &&
                directResultType !== undefined &&
                returned !== undefined
              )
                store(
                  directResult,
                  coerce(load(returned, node), directResultType, node),
                  node,
                );
            },
            done: directDone.id,
          });
          if (directMethod !== undefined) {
            if (current !== undefined) {
              const returned = invoke(
                target,
                callArguments(node.arguments, target, node),
                directMethod.transfer,
                directMethod.receiver,
                node,
              );
              if (
                directResult !== undefined &&
                directResultType !== undefined &&
                returned !== undefined
              )
                store(
                  directResult,
                  coerce(load(returned, node), directResultType, node),
                  node,
                );
              if (current !== undefined) jump(directDone.id, node);
            }
            current = directDone;
            return directResult;
          }
        }
        const method =
          info(node).indirect &&
          !explicitReceiver &&
          node.scriptCall !== true &&
          info(node).voidCallResults === undefined
            ? methodCallee(calleeNode)
            : undefined;
        // A call through a method-syntax signature passes its object as the
        // receiver (evaluated once, before the callee read).
        let memberReceiver: number | undefined;
        let memberReceiverOverride = false;
        if (
          method === undefined &&
          !explicitReceiver &&
          info(node).methodReceiver === true &&
          receiverTarget.kind === "member"
        ) {
          if (info(receiverTarget).builtin === "super-member") {
            requireSuperCalled(receiverTarget);
            memberReceiver = rawInstanceReference(receiverTarget);
          } else {
            memberReceiver = value(receiverTarget.object);
            expressionOverrides.set(receiverTarget.object, memberReceiver);
            memberReceiverOverride = true;
          }
        }
        const calleeSlot =
          method !== undefined
            ? method.transfer
            : info(node).indirect
              ? value(calleeNode)
              : undefined;
        if (memberReceiverOverride && receiverTarget.kind === "member")
          expressionOverrides.delete(receiverTarget.object);
        const receiverArgument = explicitReceiver
          ? node.arguments[0]
          : undefined;
        const receiver = explicitReceiver
          ? receiverArgument === undefined
            ? undefined
            : value(receiverArgument)
          : (callReceivers.get(receiverTarget) ?? memberReceiver);
        const args = explicitReceiver
          ? node.arguments.slice(1)
          : node.arguments;
        if (target === undefined) throw "call invariant";
        if (node.scriptCall === true) {
          if (calleeSlot === undefined) throw "script call entry invariant";
          const header = callArguments(args.slice(0, 4), target, node);
          return invoke(
            target,
            header,
            calleeSlot,
            undefined,
            node,
            args.slice(4).map(value),
            node.scriptTail === true,
          );
        }
        const prepared = callArguments(args, target, node);
        if (method === undefined)
          return invoke(target, prepared, calleeSlot, receiver, node);
        // Each inherited prototype arm calls through its dedicated
        // optional-reference slot, whose single closure target the optimizer
        // proves and devirtualizes; own overrides take the ordinary call.
        const done = block();
        const resultType =
          signatures[target]?.returnType === "void" ||
          info(node).type === "void"
            ? undefined
            : scalarType(node);
        const result =
          resultType === undefined ? undefined : temporary(resultType);
        const callInCurrent = (callee: number): void => {
          const returned = invoke(
            target,
            prepared.slice(),
            callee,
            receiver,
            node,
          );
          if (
            result !== undefined &&
            resultType !== undefined &&
            returned !== undefined
          )
            store(result, coerce(load(returned, node), resultType, node), node);
          if (current !== undefined) jump(done.id, node);
        };
        for (
          let armIndex = 0;
          armIndex < method.read.slots.length;
          armIndex++
        ) {
          const armSlot = method.read.slots[armIndex];
          if (armSlot === undefined) throw "method arm slot invariant";
          const armBlock = block(),
            nextCheck = block();
          choose(
            load(
              binarySlot(
                "===",
                method.read.arm,
                numberSlot(armIndex, node),
                node,
              ),
              node,
            ),
            armBlock,
            nextCheck,
            node,
          );
          current = armBlock;
          const unwrapped = nextValue++;
          emit({
            kind: "reference-value",
            id: unwrapped,
            value: load(armSlot, node),
            start: node.start,
            end: node.end,
          });
          callInCurrent(save(unwrapped, "reference", node));
          current = nextCheck;
        }
        callInCurrent(method.transfer);
        current = done;
        return result;
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
  function initializeBindingPlan(
    plan: BindingInitialization,
    source: number,
  ): number {
    const input = save(
      load(source, plan.root),
      scalarType(plan.root),
      plan.root,
    );
    expressionOverrides.set(plan.root, input);
    const realm = dynamicObjects;
    const iterators = createKeyIndex<Expression, number>(syntaxHash);
    const exclusions = createKeyIndex<Expression, number>(syntaxHash);
    const counts = createKeyIndex<Expression, number>(syntaxHash);
    const cleanup: {
      readonly cursor: number;
      readonly caught: Builder;
      readonly error: number;
      readonly previous:
        { readonly target: number; readonly slot: number } | undefined;
    }[] = [];
    const exhausted = createKeyIndex<Expression, number>(syntaxHash);
    for (const step of plan.steps) {
      if (step === undefined) throw "binding step invariant";
      const action = step.realmAction;
      if (action !== undefined) {
        if (realm === undefined) throw "binding realm runtime invariant";
        const source = step.read;
        if (action === "object") {
          const target = realm.bindingObject;
          if (target === undefined) throw "binding object helper invariant";
          dynamicCall(target, [value(source)], source);
        } else if (action === "iterator") {
          const target = realm.bindingIterator;
          if (target === undefined) throw "binding iterator helper invariant";
          const cursor = dynamicResult(target, [value(source)], source);
          iterators.set(source, cursor);
          const caught = block(),
            body = block();
          const error = temporary("general");
          cleanup.push({ cursor, caught, error, previous: exception });
          jump(body.id, source);
          current = body;
          exception = { target: caught.id, slot: error };
        } else if (action === "skip") {
          const target = realm.bindingSkip;
          const cursor = iterators.get(source);
          if (target === undefined || cursor === undefined)
            throw "binding iterator elision invariant";
          dynamicCall(target, [cursor], source);
        } else {
          const target = realm.bindingClose;
          const frame = cleanup.pop();
          if (target === undefined || frame === undefined)
            throw "binding iterator close invariant";
          const normal = block();
          jump(normal.id, source);
          exception = frame.previous;
          current = frame.caught;
          dynamicCall(
            target,
            [frame.cursor, booleanSlot(true, source)],
            source,
          );
          finish({
            kind: "throw",
            value: load(frame.error, source),
            start: source.start,
            end: source.end,
          });
          current = normal;
          dynamicCall(
            target,
            [frame.cursor, booleanSlot(false, source)],
            source,
          );
          iterators.delete(source);
        }
        continue;
      }
      const currentStep = step;
      function readStep(): number {
        const array = currentStep.array;
        const rest = currentStep.realmRest;
        if (rest !== undefined) {
          if (realm === undefined) throw "binding rest runtime invariant";
          const target = realm.bindingRest;
          if (target === undefined) throw "binding rest helper invariant";
          const keys =
            exclusions.get(rest) ??
            dynamicResult(realm.createArray, [numberSlot(0, rest)], rest);
          return dynamicResult(
            target,
            [value(rest), keys, numberSlot(counts.get(rest) ?? 0, rest)],
            rest,
          );
        }
        if (array === undefined)
          return bindingDefault(value(currentStep.read), currentStep, false);
        if (array.realm === true) {
          if (realm === undefined) throw "binding iterator runtime invariant";
          const target = array.rest ? realm.bindingTail : realm.bindingNext;
          const cursor = iterators.get(array.source),
            node = currentStep.read;
          const schema = info(node).dynamicContract;
          if (
            target === undefined ||
            cursor === undefined ||
            schema === undefined
          )
            throw "binding iterator read invariant";
          const raw = dynamicResult(target, [cursor], node);
          const checked = dynamicResult(
            realm.project,
            [raw, stringSlot(schema, node)],
            node,
          );
          return bindingDefault(
            save(load(checked, node), scalarType(node), node),
            currentStep,
            false,
          );
        }
        const node = currentStep.read;
        const source = value(array.source);
        const runtime =
          slots[source] === "reference" ? listRuntime(array.source) : undefined;
        if (array.inBounds) {
          if (runtime === undefined) throw "fixed binding position invariant";
          const position = numberSlot(array.position, node);
          const item = listValue(runtime, "read", [source, position], node);
          return bindingDefault(item, currentStep, true);
        }
        // Once the native iterator reaches its end, subsequent defaults can
        // grow the list but cannot restart iteration. Elisions have no read.
        let done = exhausted.get(array.source);
        if (done === undefined) {
          done = booleanSlot(false, node);
          exhausted.set(array.source, done);
        }
        const active = block(),
          after = block();
        if (array.rest) {
          const target = listRuntime(node);
          const rest = listValue(target, "create", [numberSlot(0, node)], node);
          choose(load(done, node), after, active, node);
          current = active;
          arrayValues(
            array.source,
            node,
            (item, _typed) => listCall(target, "push", [rest, item], node),
            source,
            array.position,
          );
          jump(after.id, node);
          current = after;
          return bindingDefault(rest, currentStep, false);
        }
        const absent = nextValue++;
        emit({
          kind: "undefined",
          id: absent,
          start: node.start,
          end: node.end,
        });
        const read = save(absent, scalarType(node), node);
        choose(load(done, node), after, active, node);
        current = active;
        const position = numberSlot(array.position, node);
        const length =
          runtime === undefined
            ? arrayLength(source, node)
            : listValue(runtime, "length", [source], node);
        store(done, load(binarySlot(">=", position, length, node), node), node);
        const item = block();
        choose(load(done, node), after, item, node);
        current = item;
        if (runtime !== undefined)
          store(
            read,
            load(listValue(runtime, "read", [source, position], node), node),
            node,
          );
        else {
          const readSlot = readArrayElement(source, position, node);
          store(read, load(readSlot, node), node);
        }
        jump(after.id, node);
        current = after;
        return bindingDefault(read, currentStep, false);
      }
      const assignment = step.assignment;
      const key = step.computedKey;
      const object = step.realmObject;
      const realmRead = info(step.read).dynamicObject === "read";
      let keySlot: number | undefined;
      if (
        key !== undefined &&
        (assignment !== undefined || object !== undefined)
      ) {
        const slot = value(key);
        if (realmRead) {
          if (realm === undefined)
            throw "binding property key runtime invariant";
          keySlot = dynamicResult(realm.convertKey, [slot], key);
        } else keySlot = save(load(slot, key), scalarType(key), key);
        expressionOverrides.set(key, keySlot);
      }
      if (object !== undefined) {
        if (realm === undefined) throw "binding key list runtime invariant";
        const source = step.read;
        const excluded =
          keySlot ??
          (source.kind === "member"
            ? stringSlot(source.property, source)
            : undefined);
        if (excluded === undefined) throw "binding excluded key invariant";
        const keys =
          exclusions.get(object) ??
          dynamicResult(realm.createArray, [numberSlot(0, source)], source);
        exclusions.set(object, keys);
        const count = counts.get(object) ?? 0;
        dynamicCall(
          realm.define,
          [keys, stringSlot(String(count), source), excluded],
          source,
        );
        counts.set(object, count + 1);
      }
      if (assignment !== undefined) {
        // Normal assignment captures its reference before requesting the RHS.
        patternReads.set(step.target, readStep);
        expression(assignment);
        patternReads.delete(step.target);
        if (keySlot !== undefined && key !== undefined)
          expressionOverrides.delete(key);
        continue;
      }
      const item = readStep();
      if (keySlot !== undefined && key !== undefined)
        expressionOverrides.delete(key);
      const binding = step.binding;
      if (binding === undefined) expressionOverrides.set(step.target, item);
      else {
        const local = fn.declarations.get(binding);
        if (local === undefined) throw "binding pattern local invariant";
        writeLocal(local.id, load(item, binding), binding);
      }
    }
    expressionOverrides.delete(plan.root);
    for (const step of plan.steps)
      if (step !== undefined) expressionOverrides.delete(step.target);
    return input;
  }
  function bindingDefault(
    read: number,
    step: BindingInitializationStep,
    inBounds: boolean,
  ): number {
    const initializer = step.initializer;
    const type = scalarType(step.target);
    if (initializer === undefined)
      return inBounds
        ? save(bindingPayload(read, type, step.target), type, step.target)
        : read;
    if (undefinedSlots[read] === 1) return value(initializer);
    const item = temporary(type);
    const defined = block(),
      absent = block(),
      done = block();
    choose(
      load(holeAbsent(read, step.read), step.read),
      defined,
      absent,
      step.read,
    );
    current = defined;
    store(item, bindingPayload(read, type, step.target), step.target);
    jump(done.id, step.target);
    current = absent;
    store(item, load(value(initializer), initializer), step.target);
    jump(done.id, step.target);
    current = done;
    return item;
  }
  function bindingPayload(
    read: number,
    target: ScalarType,
    node: Span,
  ): number {
    const source = slots[read];
    const payload = load(read, node);
    if (
      (source === "optional-number" && target === "number") ||
      (source === "optional-string" && target === "string") ||
      (source === "optional-reference" && target === "reference")
    ) {
      const id = nextValue++;
      emitUnwrap(id, payload, target, node);
      return id;
    }
    return payload;
  }
  function emitClassDefinition(
    node:
      | (Statement & { readonly kind: "class" })
      | (Expression & { readonly kind: "class-expression" }),
  ): number {
    const plan = owned?.classes?.find(
      (item) => item !== undefined && item.declaration === node,
    );
    if (plan === undefined) throw "class definition contract invariant";
    // ClassDefinitionEvaluation: member closures exist before the
    // prototype and constructor; the class scope binding is initialized
    // before static fields, and the statement binding after them.
    allocateCells(node.definition);
    const heritageArgs: number[] = [];
    const heritage = plan.heritage;
    if (heritage !== undefined) {
      const baseConstructor = value(heritage.expression);
      const basePrototype = temporary("reference"),
        baseInit = temporary("reference");
      recordAccess(
        baseConstructor,
        basePrototype,
        "read",
        heritage.prototype,
        node,
      );
      recordAccess(baseConstructor, baseInit, "read", heritage.init, node);
      heritageArgs.push(load(basePrototype, node), load(baseInit, node));
    }
    const environment = nextValue++;
    emit({
      kind: "record-new",
      id: environment,
      record: plan.environment,
      arguments: plan.members.map((target) =>
        load(functionValue(target, node), node),
      ),
      start: node.start,
      end: node.end,
    });
    const definition = nextValue++;
    emit({
      kind: "function-new",
      id: definition,
      target: plan.definition,
      environment,
      start: node.start,
      end: node.end,
    });
    const constructor = nextValue++;
    emit({
      kind: "call-indirect",
      id: constructor,
      target: plan.definition,
      callee: definition,
      arguments: heritageArgs,
      start: node.start,
      end: node.end,
    });
    const ctorValue = save(constructor, "reference", node),
      inner = plan.innerLocal;
    if (inner !== undefined)
      writeLocal(
        inner,
        coerce(load(ctorValue, node), slots[inner], node),
        node.definition,
      );
    const statics = plan.statics;
    if (statics !== undefined) {
      const initializers = statics.members.map((target) =>
        functionValue(target, node),
      );
      const staticsEnvironment = nextValue++;
      emit({
        kind: "record-new",
        id: staticsEnvironment,
        record: statics.environment,
        arguments: [
          load(ctorValue, node),
          ...initializers.map((slot) => load(slot, node)),
        ],
        start: node.start,
        end: node.end,
      });
      const initialize = nextValue++;
      emit({
        kind: "function-new",
        id: initialize,
        target: statics.target,
        environment: staticsEnvironment,
        start: node.start,
        end: node.end,
      });
      emit({
        kind: "call-indirect",
        id: undefined,
        target: statics.target,
        callee: initialize,
        arguments: [],
        start: node.start,
        end: node.end,
      });
    }
    return ctorValue;
  }
  function statement(
    input: Statement,
    loop: LoopTarget | undefined,
    named: readonly LabelTarget[] = [],
    cellsAllocated: boolean = false,
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
        if (!cellsAllocated) allocateCells(node);
        hoistFunctions(node);
        for (let i = 0; i < node.statements.length; i++) {
          const child = node.statements[i];
          if (child === undefined) throw "block statement invariant";
          if (child === fn.bindingPrologue) continue;
          if (
            child.kind === "variable" &&
            child.mode === "const" &&
            child.declarations.length === 1
          ) {
            const decl = child.declarations[0],
              next = node.statements[i + 1];
            if (
              decl !== undefined &&
              decl.kind !== "object-binding" &&
              decl.kind !== "array-binding" &&
              decl.initializer !== undefined &&
              next !== undefined &&
              next.kind === "for-of" &&
              next !== fn.bindingPrologue
            ) {
              const nextBinding = next.binding,
                declInit = decl.initializer;
              if (
                declInit !== undefined &&
                nextBinding.kind !== "object-binding" &&
                nextBinding.kind !== "array-binding" &&
                fn.bindingInitializations?.get(nextBinding) === undefined
              ) {
                const declLocal = fn.declarations.get(decl),
                  iterLocal = fn.declarations.get(nextBinding);
                let iter: Expression = next.iterable;
                while (iter.kind === "group") iter = iter.expression;
                if (
                  declLocal !== undefined &&
                  iterLocal !== undefined &&
                  cellPointers[declLocal.id] === undefined &&
                  iter.kind === "identifier" &&
                  info(iter).local === declLocal.id &&
                  info(next.iterable).setElement === undefined &&
                  scalarType(next.iterable) !== "string" &&
                  localReferenceCount(declLocal.id) === 1
                ) {
                  const plan = planPipeline(declInit, pipelineFacts);
                  if (
                    plan !== undefined &&
                    forOfPipelineCompatible(plan, next.body)
                  ) {
                    allocateCells(next);
                    lowerForOfPipeline(plan, next, iterLocal);
                    createSunkFunctions(child);
                    createSunkFunctions(next);
                    i++;
                    continue;
                  }
                }
              }
            }
          }
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
      case "class": {
        const plan = owned?.classes?.find(
          (item) => item !== undefined && item.declaration === node,
        );
        const outer = plan?.local;
        if (plan === undefined || outer === undefined)
          throw "class definition contract invariant";
        const ctorValue = emitClassDefinition(node);
        writeLocal(
          outer,
          coerce(load(ctorValue, node), slots[outer], node),
          node,
        );
        break;
      }
      case "debugger":
      case "empty":
        break;
      case "variable":
        for (const d of node.declarations) {
          if (d === undefined) throw "declaration invariant";
          if (d.kind === "object-binding" || d.kind === "array-binding") {
            const plan = fn.bindingInitializations?.get(d);
            const input = plan?.input;
            if (plan === undefined || input === undefined)
              throw "unchecked binding pattern";
            initializeBindingPlan(plan, value(input));
            continue;
          }
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
        const pattern =
          binding === undefined
            ? undefined
            : fn.bindingInitializations?.get(binding);
        let local: Local | undefined;
        if (
          binding !== undefined &&
          binding.kind !== "object-binding" &&
          binding.kind !== "array-binding"
        )
          local = fn.declarations.get(binding);
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
          if (pattern !== undefined) {
            allocateCells(handler.body);
            initializeBindingPlan(pattern, caughtSlot);
          }
          statement(handler.body, loop, [], pattern !== undefined);
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
        if (current !== undefined) {
          requireSuperCalled(node);
          finish({
            kind: "return",
            value: saved === undefined ? undefined : load(saved, node),
            start: node.start,
            end: node.end,
          });
        }
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
      case "for-in":
      case "for-in-assignment": {
        const runtime = dynamicObjects;
        if (runtime === undefined) throw "for-in runtime invariant";
        const cursor = dynamicResult(
          runtime.enumerate,
          [value(node.iterable)],
          node,
        );
        const head = block(),
          body = block(),
          exit = block();
        jump(head.id, node);
        current = head;
        const next = dynamicResult(runtime.advance, [cursor], node);
        choose(nonNullish(next, node), body, exit, node);
        current = body;
        const keyValue = nextValue++;
        emitUnwrap(keyValue, load(next, node), "string", node);
        const key = save(keyValue, "string", node);
        if (node.kind === "for-in") {
          const binding = node.binding;
          if (
            binding.kind === "array-binding" ||
            binding.kind === "object-binding"
          )
            throw "unchecked for-in binding pattern";
          const local = fn.declarations.get(binding);
          if (local === undefined) throw "for-in binding invariant";
          allocateCells(node);
          store(local.id, load(key, node), node);
          cellAccess(
            local.id,
            node.mode === "var" ? "write" : "initialize",
            binding,
          );
        } else if (node.kind === "for-in-assignment") {
          const target = ungroup(node.target);
          if (target.kind === "identifier") {
            const local = info(target).local;
            if (local === undefined)
              throw "for-in assignment binding invariant";
            writeLocal(local, load(key, node), node);
          } else if (target.kind === "member" || target.kind === "index") {
            const object = value(target.object);
            dynamicCall(
              runtime.write,
              [object, dynamicKey(target), key],
              target,
            );
          } else throw "for-in assignment target invariant";
        }
        statement(node.body, iterationTarget(head.id, exit.id, named));
        if (current !== undefined) jump(head.id, node);
        current = exit;
        break;
      }
      case "for-of": {
        const binding = node.binding;
        const pattern = fn.bindingInitializations?.get(binding);
        if (binding.kind === "array-binding" && pattern === undefined) {
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
        const local =
          pattern === undefined
            ? binding.kind === "object-binding" ||
              binding.kind === "array-binding"
              ? undefined
              : fn.declarations.get(binding)
            : fn.bindingIterationLocals?.get(binding);
        if (local === undefined) throw "iteration binding invariant";
        allocateCells(node);
        if (info(node.iterable).setElement !== undefined) {
          const runtime = setRuntime(node.iterable).iterator;
          if (runtime === undefined) throw "set iterator runtime invariant";
          const receiver = value(node.iterable),
            cursor = runtimeCall(runtime.create, [receiver], node);
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
          allocateCells(node);
          const item = runtimeCall(runtime.read, [cursor], node);
          if (item === undefined) throw "set read result invariant";
          store(local.id, load(item, node), node);
          cellAccess(
            local.id,
            node.mode === "var" ? "write" : "initialize",
            binding,
          );
          if (pattern !== undefined) initializeBindingPlan(pattern, local.id);
          statement(node.body, iterationTarget(head.id, exit.id, named));
          if (current !== undefined) jump(head.id, node);
          current = exit;
          break;
        }
        if (scalarType(node.iterable) === "string") {
          const string = value(node.iterable),
            index = numberSlot(0, node),
            lengthId = nextValue++;
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
          if (pattern !== undefined) initializeBindingPlan(pattern, local.id);
          statement(node.body, iterationTarget(update.id, exit.id, named));
          if (current !== undefined) jump(update.id, node);
          current = update;
          store(index, load(limit, node), node);
          jump(head.id, node);
          current = exit;
          break;
        }
        if (
          pattern === undefined &&
          binding.kind !== "object-binding" &&
          binding.kind !== "array-binding"
        ) {
          const plan = planPipeline(node.iterable, pipelineFacts);
          if (plan !== undefined && forOfPipelineCompatible(plan, node.body)) {
            lowerForOfPipeline(plan, node, local, named);
            break;
          }
        }
        const array = value(node.iterable),
          index = numberSlot(0, node);
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
        else read = load(readArrayElement(array, index, node), node);
        if (info(node.iterable).holeCheck === true) {
          // The element type excludes undefined: a hole is not a value of
          // it, so iteration throws rather than binding undefined.
          const held = save(read, valueTypes[read] ?? local.type, node);
          requireCondition(
            holeAbsent(held, node),
            "TypeError",
            "array hole is not a value of the declared element type",
            node,
          );
          read = load(held, node);
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
        if (pattern !== undefined) initializeBindingPlan(pattern, local.id);
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
  const parameters: number[] = fn.node.parameters.map((p, index): number => {
    const local = fn.declarations.get(p);
    if (local === undefined) throw "parameter invariant";
    const incoming = fn.parameters[index];
    if (incoming === undefined) throw "parameter encoding invariant";
    return p.initializer === undefined ? local.id : temporary(incoming);
  });
  for (
    let index = fn.node.parameters.length;
    index < fn.parameters.length;
    index++
  ) {
    const hidden = fn.parameters[index];
    if (hidden === undefined) throw "hidden parameter encoding invariant";
    parameters.push(temporary(hidden));
  }
  if (superCalled !== undefined)
    store(superCalled, load(booleanSlot(false, fn.node), fn.node), fn.node);
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
  if (receiverReference !== undefined && receiverSlot !== undefined) {
    const isObject = nextValue++;
    emit({
      kind: "general-is",
      id: isObject,
      value: load(receiverSlot, fn.node),
      type: "object",
      start: fn.node.start,
      end: fn.node.end,
    });
    const object = block(),
      other = block(),
      converted = block();
    choose(isObject, object, other, fn.node);
    current = object;
    const value = nextValue++,
      wrapped = nextValue++;
    emit({
      kind: "general-value",
      id: value,
      value: load(receiverSlot, fn.node),
      type: "reference",
      start: fn.node.start,
      end: fn.node.end,
    });
    emit({
      kind: "reference-wrap",
      id: wrapped,
      value,
      start: fn.node.start,
      end: fn.node.end,
    });
    store(receiverReference, wrapped, fn.node);
    jump(converted.id, fn.node);
    current = other;
    const none = nextValue++;
    emit({
      kind: "reference-none",
      id: none,
      start: fn.node.start,
      end: fn.node.end,
    });
    store(receiverReference, none, fn.node);
    jump(converted.id, fn.node);
    current = converted;
  }
  const receiverLocal = fn.receiverLocal;
  if (receiverLocal !== undefined && !isDerivedConstructor) {
    if (receiverSlot === undefined) throw "receiver local entry invariant";
    store(
      receiverLocal,
      coerce(load(receiverSlot, fn.node), slots[receiverLocal], fn.node),
      fn.node,
    );
    cellAccess(receiverLocal, "initialize", fn.node);
  }
  const bindingPrologue = fn.bindingPrologue;
  if (bindingPrologue !== undefined) statement(bindingPrologue, undefined);
  for (let i = 0; i < fn.node.parameters.length; i++) {
    const p = fn.node.parameters[i],
      input = parameters[i];
    if (p === undefined || input === undefined) throw "parameter invariant";
    const initializer = p.initializer;
    if (initializer === undefined) {
      cellAccess(input, "initialize", p);
      const pattern = fn.bindingInitializations?.get(p);
      if (pattern !== undefined) initializeBindingPlan(pattern, input);
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
      isNativeTypedArray(local.type)
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
    const pattern = fn.bindingInitializations?.get(p);
    if (pattern !== undefined) initializeBindingPlan(pattern, local.id);
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
  if (current !== undefined) requireSuperCalled(fn.node);
  if (bigIntConstants.length > 0) {
    const entryBlock = blocks[0];
    if (entryBlock === undefined) throw "entry block invariant";
    const runtime = bigIntRuntime();
    const hoisted: Instruction[] = [];
    for (let i = 0; i < bigIntConstants.length; i++) {
      const item = bigIntConstants[i];
      if (item === undefined) continue;
      const integer = item.integer;
      const callId = nextValue++;
      if (integer.len <= 4) {
        const negId = nextValue++,
          lenId = nextValue++,
          d0Id = nextValue++,
          d1Id = nextValue++,
          d2Id = nextValue++,
          d3Id = nextValue++;
        hoisted.push(
          {
            kind: "constant",
            id: negId,
            value: integer.negative,
            start: fn.node.start,
            end: fn.node.end,
          },
          {
            kind: "constant",
            id: lenId,
            value: integer.len,
            start: fn.node.start,
            end: fn.node.end,
          },
          {
            kind: "constant",
            id: d0Id,
            value: integer.d0,
            start: fn.node.start,
            end: fn.node.end,
          },
          {
            kind: "constant",
            id: d1Id,
            value: integer.d1,
            start: fn.node.start,
            end: fn.node.end,
          },
          {
            kind: "constant",
            id: d2Id,
            value: integer.d2,
            start: fn.node.start,
            end: fn.node.end,
          },
          {
            kind: "constant",
            id: d3Id,
            value: integer.d3,
            start: fn.node.start,
            end: fn.node.end,
          },
          {
            kind: "call",
            id: callId,
            target: runtime.literalInline,
            arguments: [negId, lenId, d0Id, d1Id, d2Id, d3Id],
            start: fn.node.start,
            end: fn.node.end,
          },
          {
            kind: "store",
            slot: item.slot,
            value: callId,
            start: fn.node.start,
            end: fn.node.end,
          },
        );
      } else {
        const text = formatBigInteger(integer, 10);
        if (text === undefined) throw "BigInt constant format invariant";
        const textId = nextValue++;
        hoisted.push(
          {
            kind: "string-literal",
            id: textId,
            value: text,
            start: fn.node.start,
            end: fn.node.end,
          },
          {
            kind: "call",
            id: callId,
            target: runtime.literal,
            arguments: [textId],
            start: fn.node.start,
            end: fn.node.end,
          },
          {
            kind: "store",
            slot: item.slot,
            value: callId,
            start: fn.node.start,
            end: fn.node.end,
          },
        );
      }
    }
    for (let i = hoisted.length - 1; i >= 0; i--) {
      const instruction = hoisted[i];
      if (instruction !== undefined)
        entryBlock.instructions.unshift(instruction);
    }
  }
  if (word64ScratchSlot !== undefined) {
    const entryBlock = blocks[0];
    if (entryBlock === undefined) throw "entry block invariant";
    const scratchLengthId = nextValue++,
      scratchArrayId = nextValue++;
    entryBlock.instructions.unshift(
      {
        kind: "constant",
        id: scratchLengthId,
        value: 4,
        start: fn.node.start,
        end: fn.node.end,
      },
      {
        kind: "array-new",
        id: scratchArrayId,
        type: "Uint32Array",
        length: scratchLengthId,
        start: fn.node.start,
        end: fn.node.end,
      },
      {
        kind: "store",
        slot: word64ScratchSlot,
        value: scratchArrayId,
        start: fn.node.start,
        end: fn.node.end,
      },
    );
  }
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
      // Keep the instructions without the spare capacity of the builder array.
      instructions: b.instructions.slice(),
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
