import { nativeTargetLayout } from "./target-layout.ts";
import { createSourceTextView } from "@tint/source/text";
import {
  rewriteModule,
  parseModule,
  type Module,
  type Expression,
  type Statement,
  type BlockStatement,
  type TypeNode,
  type Parameter,
  type DynamicFunctionSyntax,
} from "@tint/typescript/syntax";
import {
  bindScript,
  validateJavaScriptBindings,
} from "@tint/typescript/binding";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import {
  optimizeModule,
  optimizationExhaustion,
  pruneClosedModule,
} from "@tint/ir/optimization";
import {
  summarizeEffects,
  effectThrow,
  effectAllocate,
  effectWriteHeap,
  effectInvoke,
  effectEscape,
  type ScalarType,
  type ReturnType,
  type ModuleIR,
  type FunctionIR,
} from "@tint/ir/scalar";
import {
  emitModule,
  type NativeModule,
  type NativeFunction,
} from "@tint/codegen/aarch64/scalar";
import {
  emitModule as emitX64,
  type X64Module,
  type X64Function,
} from "@tint/codegen/x86_64/scalar";
import { linuxX86_64Target } from "@tint/platform/target";

export interface ClosedFunctionOptions {
  /** The publisher registers and retains literal storage through process exit. */
  readonly literals?: "permanent";
}
export interface ClosedFunctionCode {
  readonly native: NativeModule;
  readonly entry: NativeFunction;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ReturnType;
  readonly effects: number;
  readonly requiresPermanentLiterals: boolean;
}
interface ClosedCompilationFailure {
  readonly ok: false;
  readonly error: {
    readonly stage: "profile" | "check" | "lower" | "effects" | "emit";
    readonly message: string;
  };
}
export type ClosedFunctionCompilation =
  | { readonly ok: true; readonly value: ClosedFunctionCode }
  | ClosedCompilationFailure;
export interface ClosedDynamicFunctionCode extends ClosedFunctionCode {
  /** -2: unused; -1: bound this; otherwise the zero-based actual argument. */
  readonly input: number;
  /** Guard indexed arguments reads: absent properties can resolve on prototypes. */
  readonly minimumArguments: number;
  readonly length: number;
  /** Fallthrough and bare return must not introduce a return-expression Await. */
  readonly completion:
    "ordinary" | "async-generator-direct" | "async-generator-await-return";
}
export type ClosedDynamicFunctionCompilation =
  | { readonly ok: true; readonly value: ClosedDynamicFunctionCode }
  | ClosedCompilationFailure;
function failure(
  stage: "profile" | "check" | "lower" | "effects" | "emit",
  message: string,
): ClosedCompilationFailure {
  return { ok: false, error: { stage, message } };
}

export interface NativeEntryPreparationOptions {
  readonly signatureTypes?: boolean;
  readonly recordTypes?: boolean;
}
export interface PreparedNativeFunctionEntry {
  readonly signatureTypes:
    readonly { readonly name: string; readonly witness: number }[] | undefined;
  /** Named source types to final record IDs, after both reachability passes. */
  readonly recordTypes:
    readonly { readonly name: string; readonly record: number }[] | undefined;
  readonly module: ModuleIR;
  readonly entryId: number;
  readonly fn: FunctionIR;
}
/** Pruning maps use compact index plus one; absent identities remain absent. */
function retainedIdentity(
  source: number | undefined,
  first: Uint32Array,
  second: Uint32Array,
): number | undefined {
  if (source === undefined || source < 0) return undefined;
  const intermediate = first[source] ?? 0;
  if (intermediate === 0) return undefined;
  const final = second[intermediate - 1] ?? 0;
  return final === 0 ? undefined : final - 1;
}
/** Shared checked-entry pipeline; publication/effect profiles are selected only
 * after the final optimized/pruned IR has established stable function identities. */
export function prepareNativeFunctionEntry(
  module: Module,
  entry: string,
  options?: NativeEntryPreparationOptions,
):
  | { readonly ok: true; readonly value: PreparedNativeFunctionEntry }
  | ClosedCompilationFailure {
  if (
    module.imports.length !== 0 ||
    module.statements.some(
      (statement) =>
        statement !== undefined &&
        statement.kind !== "function" &&
        statement.kind !== "interface" &&
        statement.kind !== "type-alias",
    )
  )
    return failure(
      "profile",
      "closed functions require declarations without module initialization or imports",
    );
  const declaration = module.statements.find(
    (statement) =>
      statement !== undefined &&
      statement.kind === "function" &&
      statement.name === entry,
  );
  if (declaration === undefined)
    return failure("profile", "closed function entry is missing");
  const checked = checkClosureModule(module);
  if (!checked.ok) return failure("check", checked.error.message);
  const functions = checked.value.bindings.functions.filter(
      (fn) => fn !== undefined && fn.parent === undefined,
    ),
    selected = functions.findIndex(
      (fn) => fn !== undefined && fn.node === declaration,
    );
  if (selected < 0)
    return failure("check", "closed function entry binding is missing");
  const lowered = lowerModuleEntries(
    checked.value,
    functions.map((fn) => fn.id),
    nativeTargetLayout,
    4096,
    {
      recordTypes: options?.recordTypes ?? false,
      signatureTypes: options?.signatureTypes ?? false,
    },
  );
  if (!lowered.ok) return failure("lower", lowered.error);
  const selectedId = functions[selected]?.id;
  const originalEntry =
    selectedId === undefined ? -1 : lowered.value.entries.indexOf(selectedId);
  if (originalEntry < 0)
    return failure("lower", "closed function entry lowering is missing");
  const reachable = pruneClosedModule(lowered.value.module, [originalEntry]);
  if (reachable === undefined)
    return failure(
      "effects",
      "closed function reachability proof is unavailable",
    );
  const firstEntry = (reachable.functionIds[originalEntry] ?? 0) - 1;
  if (firstEntry < 0)
    return failure("effects", "closed function entry was removed");
  // Live compilation keeps the default work budget and fails rather than
  // run a partially optimized function.
  const optimized = optimizeModule(reachable.module),
    exhaustion = optimizationExhaustion(optimized);
  if (exhaustion !== undefined) return failure("effects", exhaustion);
  const pruned = pruneClosedModule(optimized.module, [firstEntry]);
  if (pruned === undefined)
    return failure(
      "effects",
      "optimized function reachability proof is unavailable",
    );
  const entryId = (pruned.functionIds[firstEntry] ?? 0) - 1,
    fn = pruned.module.functions[entryId];
  if (fn === undefined)
    return failure("effects", "optimized closed function entry is missing");
  if (
    fn.environment !== undefined ||
    fn.closureEnvironment !== undefined ||
    fn.receiverSlot !== undefined
  )
    return failure(
      "profile",
      "closed function entry requires an environment or receiver ABI",
    );
  let recordTypes: { name: string; record: number }[] | undefined;
  if (options?.recordTypes === true) {
    const mapped: { name: string; record: number }[] = [];
    const original = lowered.value.recordTypes;
    checked.value.typeNames.forEach((type, name) => {
      const record = retainedIdentity(
        original?.[type],
        reachable.recordIds,
        pruned.recordIds,
      );
      if (record !== undefined) mapped.push({ name, record });
    });
    recordTypes = mapped;
  }
  let signatureTypes: { name: string; witness: number }[] | undefined;
  if (options?.signatureTypes === true) {
    const mapped: { name: string; witness: number }[] = [];
    const original = lowered.value.signatureTypes;
    checked.value.typeNames.forEach((type, name) => {
      const witness = retainedIdentity(
        (original?.[type] ?? 0) - 1,
        reachable.functionIds,
        pruned.functionIds,
      );
      if (witness !== undefined) mapped.push({ name, witness });
    });
    signatureTypes = mapped;
  }
  return {
    ok: true,
    value: { module: pruned.module, entryId, fn, recordTypes, signatureTypes },
  };
}

/** Compile an independently callable function through the ordinary checked IR
 * pipeline. No module initialization, environment pointer, allocation, throwing,
 * managed writes or opaque calls are permitted. Returned references are borrowed
 * from caller-owned values. Code-backed literals require an explicit permanent
 * storage contract; record-layout integration still needs the module loader.
 *
 * Native entry signatures remain explicit. The publisher must retain code/root
 * metadata and select a compatible call adapter; this function never executes it. */
export function compileClosedFunction(
  module: Module,
  entry: string,
  maxByteLength: number = 0xffffffff,
  options: ClosedFunctionOptions | undefined = undefined,
): ClosedFunctionCompilation {
  const prepared = prepareNativeFunctionEntry(module, entry);
  if (!prepared.ok) return prepared;
  const ir = prepared.value.module,
    entryId = prepared.value.entryId,
    fn = prepared.value.fn;
  const effects = summarizeEffects(ir),
    effect = effects === undefined ? undefined : effects[entryId];
  if (
    effect === undefined ||
    (effect &
      (effectThrow |
        effectAllocate |
        effectWriteHeap |
        effectInvoke |
        effectEscape)) !==
      0
  )
    return failure(
      "effects",
      "closed function may allocate, throw, write managed state or invoke opaque code",
    );
  const parameters: ScalarType[] = [];
  for (const slot of fn.parameters) {
    const type = slot === undefined ? undefined : fn.slots[slot];
    if (type === undefined)
      return failure("lower", "closed parameter encoding is missing");
    parameters.push(type);
  }
  const native = emitModule(ir, {
    maxByteLength: maxByteLength,
    debugSpans: true,
  });
  if (!native.ok) return failure("emit", native.error.message);
  if (native.value.imports.length !== 0)
    return failure("profile", "closed function has unresolved native imports");
  if (native.value.records.length !== 0)
    return failure(
      "profile",
      "closed function requires record-layout integration",
    );
  if (
    native.value.strings.length !== 0 &&
    (options === undefined || options.literals !== "permanent")
  )
    return failure(
      "profile",
      "closed function requires code-backed value lifetime integration",
    );
  const emitted = native.value.functions.find(
    (value) => value !== undefined && value.id === entryId,
  );
  if (emitted === undefined)
    return failure("emit", "closed function native entry is missing");
  return {
    ok: true,
    value: {
      native: native.value,
      entry: emitted,
      parameters,
      returnType: fn.returnType,
      effects: effect,
      requiresPermanentLiterals: native.value.strings.length !== 0,
    },
  };
}

/** Closed numeric entry for the x86 publisher, through the same checked IR
 * and effect proof as the ordinary closed-function path. */
export function compileX64ClosedNumberFunction(
  module: Module,
  name: string,
  maxByteLength: number,
):
  | {
      readonly ok: true;
      readonly value: {
        readonly native: X64Module;
        readonly entry: X64Function;
      };
    }
  | ClosedCompilationFailure {
  const prepared = prepareNativeFunctionEntry(module, name);
  if (!prepared.ok) return prepared;
  const ir = prepared.value.module,
    id = prepared.value.entryId;
  const fn = prepared.value.fn;
  if (fn.returnType !== "number" || fn.parameters.length !== 0)
    return failure("profile", "closed numeric entry takes no parameters");
  const effects = summarizeEffects(ir),
    effect = effects === undefined ? undefined : effects[id];
  if (
    effect === undefined ||
    (effect &
      (effectThrow |
        effectAllocate |
        effectWriteHeap |
        effectInvoke |
        effectEscape)) !==
      0
  )
    return failure(
      "effects",
      "closed function may allocate, throw, write managed state or invoke opaque code",
    );
  const emitted = emitX64(
    ir,
    linuxX86_64Target.hostABI,
    false,
    false,
    true,
    [],
    false,
    false,
    { mode: "live", functions: [], records: [] },
  );
  if (!emitted.ok) return failure("emit", emitted.error.message);
  const native = emitted.value;
  if (
    !Number.isSafeInteger(maxByteLength) ||
    native.code.length > maxByteLength
  )
    return failure("emit", "closed function exceeds code budget");
  if (
    native.addressFixups.length !== 0 ||
    native.records.length !== 0 ||
    native.managedImports.length !== 0
  )
    return failure(
      "profile",
      "closed function requires an image or managed identities",
    );
  const entry = native.functions[id];
  if (entry === undefined || entry.import === true)
    return failure("emit", "closed function native entry is missing");
  return { ok: true, value: { native, entry } };
}

function dynamicExpression(
  syntax: DynamicFunctionSyntax,
): (Expression & { readonly kind: "function-expression" }) | undefined {
  const statement = syntax.module.statements[0];
  const fn =
    statement?.kind === "expression" ? statement.expression : undefined;
  return syntax.module.statements.length === 1 &&
    fn?.kind === "function-expression"
    ? fn
    : undefined;
}
function simpleDynamicParameters(
  parameters: readonly Parameter[],
): Map<string, number> | undefined {
  const names = new Map<string, number>();
  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index];
    if (
      parameter === undefined ||
      parameter.kind === "pattern-parameter" ||
      parameter.rest ||
      parameter.initializer !== undefined
    )
      return undefined;
    names.set(parameter.name, index);
  }
  return names;
}

/** Lower the environment-free, nonsuspending body of a dynamic function through the
 * same checked pipeline. One borrowed input is an internal ABI parameter; the
 * realm adapter selects the actual argument or converted receiver identified by
 * the result. The publisher also enforces minimumArguments before indexed
 * arguments reads, since absent properties can resolve through prototypes.
 * JS declarations, mutable global access and nested execution require the Script
 * environment compiler and are rejected rather than given TypeScript semantics. */
export function compileClosedDynamicFunction(
  syntax: DynamicFunctionSyntax,
  maxByteLength: number = 0xffffffff,
  options: ClosedFunctionOptions | undefined = undefined,
): ClosedDynamicFunctionCompilation {
  const fn = dynamicExpression(syntax);
  if (fn === undefined)
    return failure(
      "profile",
      "closed dynamic compilation requires one function expression",
    );
  const bindingError = validateJavaScriptBindings(syntax.module, "script");
  if (bindingError !== undefined) return failure("check", bindingError.message);
  const simpleParameters = simpleDynamicParameters(fn.parameters);
  if (simpleParameters === undefined)
    return failure(
      "profile",
      "dynamic parameter initialization requires Script environment support",
    );
  const parameters = simpleParameters;
  let input = -2;
  let minimumArguments = 0;
  let unconsumedArguments = 0;
  const receiver = "$tint$receiver",
    entry = "$tint$dynamic";
  let unsupported = false;
  let hasAwaitReturn = false;
  let hasDirectReturn = false;
  const span = { start: fn.start, end: fn.end };
  function absent(): Expression {
    return {
      kind: "unary",
      operator: "void",
      operand: {
        kind: "number",
        value: 0,
        raw: "0",
        start: span.start,
        end: span.end,
      },
      start: span.start,
      end: span.end,
    };
  }
  function indexedArgument(node: Expression): number {
    if (node.kind !== "index" || parameters.has("arguments")) return -1;
    const object = node.object,
      index = node.index;
    if (
      object.kind !== "identifier" ||
      object.name !== "arguments" ||
      index.kind !== "number"
    )
      return -1;
    const value = index.value;
    return value >= 0 && value < 0xffffffff && value % 1 === 0 ? value : -1;
  }
  function borrowedInput(index: number, node: Expression): Expression {
    if (input !== -2 && input !== index) unsupported = true;
    input = index;
    return {
      kind: "identifier",
      name: receiver,
      start: node.start,
      end: node.end,
    };
  }
  function dependsOnInput(node: Expression): boolean {
    switch (node.kind) {
      case "identifier":
        return node.name === receiver;
      case "group":
        return dependsOnInput(node.expression);
      case "unary":
        return dependsOnInput(node.operand);
      case "binary":
        return dependsOnInput(node.left) || dependsOnInput(node.right);
      case "conditional":
        return (
          dependsOnInput(node.test) ||
          dependsOnInput(node.consequent) ||
          dependsOnInput(node.alternate)
        );
      default:
        return false;
    }
  }
  function booleanExpression(node: Expression): boolean {
    if (node.kind === "boolean") return true;
    if (node.kind === "group") return booleanExpression(node.expression);
    if (node.kind === "unary" && node.operator === "!")
      return booleanExpression(node.operand);
    if (node.kind !== "binary") return false;
    if (node.operator === "===" || node.operator === "!==") return true;
    return (
      (node.operator === "&&" || node.operator === "||") &&
      booleanExpression(node.left) &&
      booleanExpression(node.right)
    );
  }
  function unsafeTruthiness(node: Expression): boolean {
    return dependsOnInput(node) && !booleanExpression(node);
  }
  // Borrowed Script values include runtime records representing JS primitives.
  // Raw native record truthiness/typeof cannot classify zero BigInt, Symbol or
  // callable wrappers. Keep coercion behind the future realm-aware ABI instead
  // of silently treating those values as ordinary TypeScript objects.
  // Simple unused formals have no observable initialization effects. Resolve
  // repeated names to the final formal, and reject bodies needing multiple
  // input values until the publisher supplies a broader checked call adapter.
  // All user references are resolved before synthetic identifiers are introduced.
  const mapped = rewriteModule(
    { ...syntax.module, statements: fn.body.statements },
    {
      expression(node: Expression, original: Expression): Expression {
        switch (node.kind) {
          case "this":
            return borrowedInput(-1, node);
          case "identifier": {
            const index = parameters.get(node.name);
            if (index !== undefined) return borrowedInput(index, node);
            // Only a supported indexed read may consume this implicit binding.
            // No arguments object is exposed, mutated or captured by this profile.
            if (node.name === "arguments") {
              unconsumedArguments++;
              return node;
            }
            // These immutable global properties cannot be replaced by a global
            // lexical declaration. A same-named formal was resolved above.
            if (node.name === "undefined") return absent();
            if (node.name === "NaN" || node.name === "Infinity")
              return {
                kind: "number",
                value: node.name === "NaN" ? NaN : Infinity,
                raw: node.name,
                start: node.start,
                end: node.end,
              };
            unsupported = true;
            return node;
          }
          case "index": {
            const index = indexedArgument(original);
            if (index >= 0) {
              unconsumedArguments--;
              minimumArguments = Math.max(minimumArguments, index + 1);
              return borrowedInput(index, node);
            }
            unsupported = true;
            return node;
          }
          case "number":
          case "boolean":
          case "null":
          case "string":
          case "group":
            return node;
          case "unary":
            if (node.operator === "!") {
              if (unsafeTruthiness(node.operand)) unsupported = true;
            } else if (node.operator !== "void" && dependsOnInput(node.operand))
              unsupported = true;
            return node;
          case "binary":
            if (node.operator === "&&" || node.operator === "||") {
              if (unsafeTruthiness(node.left)) unsupported = true;
            } else if (
              node.operator !== "===" &&
              node.operator !== "!==" &&
              node.operator !== "??" &&
              dependsOnInput(node)
            )
              unsupported = true;
            return node;
          case "conditional":
            if (unsafeTruthiness(node.test)) unsupported = true;
            return node;
          default:
            unsupported = true;
            return node;
        }
      },
      statement(node: Statement, original: Statement): Statement {
        switch (node.kind) {
          case "block":
          case "expression":
          case "empty":
          case "break":
          case "continue":
            return node;
          case "if":
          case "while":
          case "do-while":
            if (unsafeTruthiness(node.test)) unsupported = true;
            return node;
          case "return":
            if (node.expression === undefined) hasDirectReturn = true;
            else hasAwaitReturn = true;
            return node.expression === undefined
              ? {
                  kind: "return",
                  start: node.start,
                  end: node.end,
                  expression: absent(),
                }
              : node;
          default:
            unsupported = true;
            return node;
        }
      },
    },
  );
  let completion: ClosedDynamicFunctionCode["completion"] = "ordinary";
  if (fn.async && fn.generator) {
    let last: Statement | undefined = undefined;
    for (const statement of fn.body.statements) {
      if (statement === undefined) throw "DYNAMIC_STATEMENT_INVARIANT";
      if (statement.kind !== "empty") last = statement;
    }
    // Return expressions Await; bare return and fallthrough do not. A final
    // return plus no bare returns proves all terminating paths use Await.
    // Mixed completion paths need a discriminator in the native result ABI.
    if (hasAwaitReturn && (hasDirectReturn || last?.kind !== "return"))
      return failure(
        "profile",
        "mixed async-generator completion requires a native completion discriminator",
      );
    completion = hasAwaitReturn
      ? "async-generator-await-return"
      : "async-generator-direct";
  }
  if (unsupported || unconsumedArguments !== 0)
    return failure(
      "profile",
      "dynamic function requires Script environment or nested execution support",
    );
  const unknownType: TypeNode = {
    kind: "named",
    name: "unknown",
    start: span.start,
    end: span.end,
  };
  const statements: Statement[] = mapped.statements.slice();
  statements.push({
    kind: "return",
    expression: absent(),
    start: span.start,
    end: span.end,
  });
  const body: BlockStatement = {
    kind: "block",
    start: fn.body.start,
    end: fn.body.end,
    statements,
  };
  const module: Module = {
    ...syntax.module,
    statements: [
      {
        kind: "function",
        name: entry,
        exported: true,
        strict: fn.strict ?? false,
        parameters: [
          {
            name: receiver,
            type: unknownType,
            start: span.start,
            end: span.end,
          },
        ],
        returnType: unknownType,
        body,
        start: span.start,
        end: span.end,
      },
    ],
  };
  const compiled = compileClosedFunction(
    rewriteModule(module, { hashes: true }),
    entry,
    maxByteLength,
    options,
  );
  if (!compiled.ok) return compiled;
  return {
    ok: true,
    value: {
      ...compiled.value,
      input,
      minimumArguments,
      length: fn.parameters.length,
      completion,
    },
  };
}

export interface ManagedGlobalAccessDynamicFunctionCode {
  readonly globalName: string;
  /** Static property Get operations in source order, after resolving the root. */
  readonly properties: readonly string[];
  readonly strict: boolean;
  readonly length: number;
  readonly native: NativeModule;
  readonly entry: NativeFunction;
  readonly parameters: readonly ScalarType[];
  readonly returnType: "general";
  readonly effects: number;
  readonly readerContract: string;
}
export type ManagedGlobalAccessDynamicFunctionCompilation =
  | {
      readonly ok: true;
      readonly value: ManagedGlobalAccessDynamicFunctionCode;
    }
  | ClosedCompilationFailure;

/** Compile a global GetValue and static property Gets through a managed reader.
 * Binding analysis applies to the original JavaScript tree before synthetic names
 * exist. This compiles code only: resolving globals, imports and publication belong
 * to the realm adapter. The closed/borrowed compilation profile stays separate. */
export function compileManagedGlobalAccessDynamicFunction(
  syntax: DynamicFunctionSyntax,
  maxByteLength: number = 0xffffffff,
): ManagedGlobalAccessDynamicFunctionCompilation {
  const fn = dynamicExpression(syntax);
  if (fn === undefined)
    return failure(
      "profile",
      "managed global access requires one function expression",
    );
  const earlyError = validateJavaScriptBindings(syntax.module, "script");
  if (earlyError !== undefined) return failure("check", earlyError.message);
  if (fn.async || fn.generator)
    return failure(
      "profile",
      "managed global access requires an ordinary nonsuspending function",
    );
  const parameters = simpleDynamicParameters(fn.parameters);
  if (parameters === undefined)
    return failure(
      "profile",
      "dynamic parameter initialization requires Script environment support",
    );
  const bound = bindScript(syntax.module);
  if (!bound.ok) return failure("check", bound.error.message);
  let returned: (Statement & { readonly kind: "return" }) | undefined =
    undefined;
  let directives = true;
  for (const statement of fn.body.statements) {
    if (statement === undefined) throw "managed body statement invariant";
    if (statement.kind === "empty") {
      directives = false;
      continue;
    }
    if (
      directives &&
      statement.kind === "expression" &&
      statement.expression.kind === "string"
    )
      continue;
    directives = false;
    if (statement.kind !== "return" || returned !== undefined)
      return failure(
        "profile",
        "managed global access requires a single global-access return",
      );
    returned = statement;
  }
  const properties: string[] = [];
  const spans: Expression[] = [];
  let expression = returned?.expression;
  while (expression !== undefined) {
    if (expression.kind === "group") {
      expression = expression.expression;
      continue;
    }
    if (
      expression.kind === "member" &&
      !expression.optional &&
      !expression.private
    ) {
      properties.unshift(expression.property);
      spans.unshift(expression);
      expression = expression.object;
      continue;
    }
    if (expression.kind === "index" && !expression.optional) {
      const key = expression.index;
      if (key.kind !== "string") break;
      properties.unshift(key.value);
      spans.unshift(expression);
      expression = expression.object;
      continue;
    }
    break;
  }
  if (expression?.kind !== "identifier" || expression.name === "arguments")
    return failure(
      "profile",
      "managed global access requires an unbound identifier",
    );
  const selectedIdentifier = expression,
    globalName = expression.name,
    identifierStart = expression.start,
    identifierEnd = expression.end;
  const reference = bound.value.references.find(
    (candidate) =>
      candidate !== undefined && candidate.node === selectedIdentifier,
  );
  if (
    reference === undefined ||
    reference.binding !== undefined ||
    reference.global !== globalName ||
    reference.access !== "read"
  )
    return failure(
      "profile",
      "managed global access cannot select a local binding",
    );
  const unknownType: TypeNode = {
    kind: "named",
    name: "unknown",
    start: identifierStart,
    end: identifierEnd,
  };
  const reader = "$tint$reader",
    entryName = "$tint$managedGlobalAccess";
  const numericType: TypeNode = {
    kind: "named",
    name: "number",
    start: identifierStart,
    end: identifierEnd,
  };
  const read = (
    base: Expression,
    step: number,
    span: Expression,
  ): Expression => ({
    kind: "call",
    start: span.start,
    end: span.end,
    callee: {
      kind: "identifier",
      name: reader,
      start: span.start,
      end: span.end,
    },
    arguments: [
      base,
      {
        kind: "number",
        value: step,
        raw: "" + step,
        start: span.start,
        end: span.end,
      },
    ],
  });
  let access: Expression = read(
    {
      kind: "identifier",
      name: "undefined",
      start: identifierStart,
      end: identifierEnd,
    },
    0,
    selectedIdentifier,
  );
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span === undefined) throw "managed property span invariant";
    access = read(access, i + 1, span);
  }
  const synthetic: Module = {
    ...syntax.module,
    statements: [
      {
        kind: "function",
        name: entryName,
        exported: true,
        strict: fn.strict ?? false,
        parameters: [
          {
            name: reader,
            type: {
              kind: "function",
              parameters: [
                {
                  name: "$base",
                  type: unknownType,
                  start: identifierStart,
                  end: identifierEnd,
                },
                {
                  name: "$step",
                  type: numericType,
                  start: identifierStart,
                  end: identifierEnd,
                },
              ],
              returnType: unknownType,
              start: identifierStart,
              end: identifierEnd,
            },
            start: identifierStart,
            end: identifierEnd,
          },
        ],
        returnType: unknownType,
        body: {
          kind: "block",
          start: fn.body.start,
          end: fn.body.end,
          statements: [
            {
              kind: "return",
              start: returned?.start ?? identifierStart,
              end: returned?.end ?? identifierEnd,
              expression: access,
            },
          ],
        },
        start: fn.start,
        end: fn.end,
      },
    ],
  };
  const compiled = compileManagedReaderEntry(
    synthetic,
    entryName,
    properties.length + 1,
    "tint.global-access.v1",
    "tint.managed.global-access",
    maxByteLength,
  );
  if (!compiled.ok) return compiled;
  return {
    ok: true,
    value: {
      ...compiled.value,
      globalName,
      properties,
      strict: fn.strict ?? false,
      length: fn.parameters.length,
    },
  };
}

interface ManagedReaderCode {
  readonly native: NativeModule;
  readonly entry: NativeFunction;
  readonly parameters: readonly ScalarType[];
  readonly returnType: "general";
  readonly effects: number;
  readonly readerContract: string;
}
type ManagedReaderCompilation =
  | { readonly ok: true; readonly value: ManagedReaderCode }
  | ClosedCompilationFailure;
/** Validate the emitted callback witness independently of its realm-owned operation. */
function compileManagedReaderEntry(
  synthetic: Module,
  entryName: string,
  expectedCalls: number,
  readerContract: string,
  signatureName: string,
  maxByteLength: number,
): ManagedReaderCompilation {
  const prepared = prepareNativeFunctionEntry(
    rewriteModule(synthetic, { hashes: true }),
    entryName,
  );
  if (!prepared.ok) return prepared;
  const ir = prepared.value.module,
    entryId = prepared.value.entryId,
    entry = prepared.value.fn;
  const parameter = entry.parameters[0];
  if (
    entry.parameters.length !== 1 ||
    parameter === undefined ||
    entry.slots[parameter] !== "reference" ||
    entry.returnType !== "general"
  )
    return failure(
      "lower",
      "managed global access reader entry ABI is unavailable",
    );
  let witness: number | undefined = undefined;
  let calls = 0;
  const readerSlots = new Set<number>();
  readerSlots.add(parameter);
  const readerValues = new Set<number>();
  // Argument evaluation can spill the callee into a temporary slot across an
  // earlier managed Get. Track those aliases rather than assuming every call
  // reloads the original parameter directly.
  for (const block of entry.blocks) {
    if (block === undefined) throw "managed entry block invariant";
    for (const instruction of block.instructions) {
      if (instruction === undefined)
        throw "managed entry instruction invariant";
      if (instruction.kind === "load" && readerSlots.has(instruction.slot))
        readerValues.add(instruction.id);
      if (instruction.kind === "store") {
        if (readerValues.has(instruction.value))
          readerSlots.add(instruction.slot);
        else readerSlots.delete(instruction.slot);
      }
      if (instruction.kind !== "call-indirect") continue;
      if (
        (witness !== undefined && witness !== instruction.target) ||
        instruction.arguments.length !== 2 ||
        instruction.receiver !== undefined ||
        !readerValues.has(instruction.callee)
      )
        return failure(
          "lower",
          "managed global access requires one two-argument reader call per Get",
        );
      witness = instruction.target;
      calls++;
    }
  }
  const target = witness === undefined ? undefined : ir.functions[witness];
  if (
    target === undefined ||
    target.parameters.length !== 2 ||
    target.slots[target.parameters[0] ?? -1] !== "general" ||
    target.slots[target.parameters[1] ?? -1] !== "number" ||
    target.returnType !== "general" ||
    calls !== expectedCalls ||
    entry.blocks.length !== 1
  )
    return failure(
      "lower",
      "managed global access reader signature witness is unavailable",
    );
  const effects = summarizeEffects(ir),
    effect = effects === undefined ? undefined : effects[entryId];
  if (effect === undefined)
    return failure(
      "effects",
      "managed global access reader effects are unavailable",
    );
  if (witness === undefined)
    return failure("lower", "managed global access reader witness is missing");
  const emitted = emitModule(ir, {
    maxByteLength,
    debugSpans: true,
    managedABI: {
      version: 1,
      functionBrand: {
        name: "tint.managed.function-brand",
        contract: "tint.function.v1",
      },
      signatures: [
        {
          name: signatureName,
          contract: readerContract,
          witness,
          parameters: ["general", "number"],
          returnType: "general",
        },
      ],
    },
  });
  if (!emitted.ok) return failure("emit", emitted.error.message);
  if (emitted.value.imports.length !== 0 || emitted.value.strings.length !== 0)
    return failure(
      "profile",
      "managed global access reader has unsupported foreign imports or literals",
    );
  const nativeEntry = emitted.value.functions.find(
    (value) => value !== undefined && value.id === entryId,
  );
  if (nativeEntry === undefined)
    return failure(
      "emit",
      "managed global access reader native entry is missing",
    );
  return {
    ok: true,
    value: {
      native: emitted.value,
      entry: nativeEntry,
      parameters: ["reference"],
      returnType: "general",
      effects: effect,
      readerContract,
    },
  };
}

export interface ManagedReceiverWriteDynamicFunctionCode extends ManagedReaderCode {
  readonly property: string;
  readonly literal: true;
  readonly returns: "receiver" | "undefined";
  readonly strict: boolean;
  readonly length: number;
}
export type ManagedReceiverWriteDynamicFunctionCompilation =
  | {
      readonly ok: true;
      readonly value: ManagedReceiverWriteDynamicFunctionCode;
    }
  | ClosedCompilationFailure;
function withoutGroups(expression: Expression): Expression {
  let selected = expression;
  while (selected.kind === "group") selected = selected.expression;
  return selected;
}
/** Compile a bounded receiver Set through explicit native callback operations.
 * The realm adapter owns ordinary Set semantics; borrowed code remains read-only. */
export function compileManagedReceiverWriteDynamicFunction(
  syntax: DynamicFunctionSyntax,
  maxByteLength: number = 0xffffffff,
): ManagedReceiverWriteDynamicFunctionCompilation {
  const fn = dynamicExpression(syntax);
  if (fn === undefined || fn.async || fn.generator)
    return failure("profile", "receiver write requires an ordinary function");
  const error = validateJavaScriptBindings(syntax.module, "script");
  if (error !== undefined) return failure("check", error.message);
  if (simpleDynamicParameters(fn.parameters) === undefined)
    return failure(
      "profile",
      "receiver write requires simple parameter initialization",
    );
  const statements: Statement[] = [];
  let directives = true;
  for (const statement of fn.body.statements) {
    if (statement === undefined) throw "RECEIVER_WRITE_STATEMENT_INVARIANT";
    if (statement.kind === "empty") {
      directives = false;
      continue;
    }
    if (
      directives &&
      statement.kind === "expression" &&
      statement.expression.kind === "string"
    )
      continue;
    directives = false;
    statements.push(statement);
  }
  const first = statements[0],
    last = statements[1];
  if (first?.kind !== "expression" || statements.length > 2)
    return failure(
      "profile",
      "receiver write requires one Set and optional receiver return",
    );
  const assignment = withoutGroups(first.expression);
  if (assignment.kind !== "assignment")
    return failure("profile", "receiver write requires simple assignment");
  const target = withoutGroups(assignment.target),
    literal = withoutGroups(assignment.value);
  if (literal.kind !== "boolean" || !literal.value)
    return failure("profile", "receiver write currently requires literal true");
  let property: string;
  if (
    target.kind === "member" &&
    !target.optional &&
    !target.private &&
    withoutGroups(target.object).kind === "this"
  )
    property = target.property;
  else if (
    target.kind === "index" &&
    !target.optional &&
    withoutGroups(target.object).kind === "this"
  ) {
    const key = target.index;
    if (key.kind !== "string")
      return failure("profile", "receiver write requires a static string key");
    property = key.value;
  } else
    return failure(
      "profile",
      "receiver write requires a static own receiver key",
    );
  let returns: "receiver" | "undefined" = "undefined";
  if (last !== undefined) {
    if (
      last.kind !== "return" ||
      last.expression === undefined ||
      withoutGroups(last.expression).kind !== "this"
    )
      return failure("profile", "receiver write only returns the receiver");
    returns = "receiver";
  }
  const entryName = "$tint$managedReceiverWrite";
  // Fixed compiler-owned syntax. User source is never evaluated or interpolated.
  const source = createSourceTextView(
    "export function $tint$managedReceiverWrite(reader:(base:unknown,step:number)=>unknown):unknown{const receiver:unknown=reader(undefined,0);reader(receiver,1);return " +
      (returns === "receiver" ? "receiver" : "undefined") +
      ";}",
  );
  const parsed = parseModule(source);
  if (!parsed.ok)
    return failure("lower", "receiver write synthetic module is unavailable");
  const compiled = compileManagedReaderEntry(
    parsed.value,
    entryName,
    2,
    "tint.receiver-write.v1",
    "tint.managed.receiver-write",
    maxByteLength,
  );
  if (!compiled.ok) return compiled;
  return {
    ok: true,
    value: {
      ...compiled.value,
      property,
      literal: true,
      returns,
      strict: fn.strict ?? false,
      length: fn.parameters.length,
    },
  };
}
