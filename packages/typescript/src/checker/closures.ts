import {
  aggregatePayload,
  planLocalRealm,
  type LocalRealmPlan,
} from "./local-realm.ts";
import { numericConstant } from "./numeric-constants.ts";
import { checkClassInitialization } from "./class-initialization.ts";
import {
  typeParameterCount,
  syntaxHash,
  literalPropertyName,
  isOptionalChain,
  rewriteModule,
  visitBindingExpressions,
  bindingIdentifiers,
} from "../syntax/index.ts";
import { createUnionIndex } from "./union-index.ts";
import {
  cViewMember,
  type CViewMember,
  type CViewRegistry,
  type CViewShape,
  type CViewUse,
} from "./c-views.ts";
import {
  createKeyIndex,
  type ReadonlyKeyIndex,
  type KeyIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
import {
  sequenceCompletion,
  catchCompletion,
  finallyCompletion,
  loopCompletion,
  throwCompletion,
} from "./completion.ts";
import type {
  Module,
  Statement,
  Expression,
  Span,
  TypeNode,
  Parameter,
  BlockStatement,
  ClassDefinition,
  ClassElement,
  VariableBinding,
  Binding as SyntaxBinding,
  ObjectBindingProperty,
  PropertySignature,
} from "../syntax/index.ts";
import {
  bindModule,
  type BoundModule,
  type Binding,
} from "../binding/index.ts";
import {
  type Type,
  type TypeSystem,
  type Property,
  type ObjectValue,
  unsupportedDynamicPayload,
  type CheckedCellOperation,
  type CellOperation,
} from "../types/index.ts";
import {
  installedNonConstructorGlobals,
  realmLibraryConstructor,
} from "../binding/realm-library.ts";
import {
  realmArrayInstance,
  realmConstructorInstance,
  realmOnlyTypedArrays,
  withRealmGlobals,
  realmLibraryType,
  resolveInterfaceTypes,
  type ClassContract,
  type InterfaceFallback,
  type InterfaceResolutionCache,
} from "./interfaces.ts";
/** A fixed key proven by syntax or a singleton checked type, never by speculation. */
export function checkedPropertyName(
  node: Expression,
  type: Type | undefined,
): string | undefined {
  while (
    node.kind === "group" ||
    node.kind === "satisfies" ||
    (node.kind === "binary" && node.operator === ",")
  )
    node = node.kind === "binary" ? node.right : node.expression;
  const literal = literalPropertyName(node);
  if (literal !== undefined) return literal;
  if (type?.kind === "literal") {
    const value = type.value;
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}
export interface BindingOperation {
  readonly node: Span;
  readonly function: number | undefined;
  readonly binding: number;
  readonly operation: CheckedCellOperation;
}
export type ClosureIntrinsic =
  | "function-call"
  | "general-call"
  | "map-new"
  | "map-get"
  | "map-has"
  | "map-set"
  | "map-delete"
  | "map-clear"
  | "map-size"
  | "set-new"
  | "set-has"
  | "set-add"
  | "set-delete"
  | "set-clear"
  | "set-size"
  | "record-read"
  | "record-write"
  | "list-read"
  | "list-write"
  | "list-length"
  | "list-join"
  | "list-sort"
  | "list-filter"
  | "list-map"
  | "indexed-for-each"
  | "indexed-some"
  | "indexed-every"
  | "indexed-find-last-index"
  | "indexed-find-last"
  | "indexed-find-index"
  | "indexed-find"
  | "list-splice"
  | "list-slice"
  | "list-index-of"
  | "list-includes"
  | "list-pop"
  | "list-shift"
  | "list-unshift"
  | "list-push"
  | "number-from-string"
  | "number-from-bigint"
  | "bigint-identity"
  | "bigint-from-number"
  | "bigint-from-boolean"
  | "number-is-integer"
  | "string-convert"
  | "number-is-safe-integer"
  | "number-is-finite"
  | "number-is-nan"
  | "math-ceil"
  | "math-sqrt"
  | "math-round"
  | "math-clz32"
  | "math-trunc"
  | "math-abs"
  | "math-sign"
  | "math-floor"
  | "math-imul"
  | "atomics"
  | "math-min"
  | "math-max"
  | "numeric-constant"
  | "array-set"
  | "array-subarray"
  | "array-slice"
  | "array-new"
  | "array-view-new"
  | "array-buffer-new"
  | "shared-array-buffer-new"
  | "array-buffer-byte-length"
  | "array-join"
  | "array-at"
  | "array-reverse"
  | "list-reverse"
  | "list-resize"
  | "list-at"
  | "array-fill"
  | "list-fill"
  | "array-read"
  | "array-write"
  | "error-new"
  | "realm-library-read"
  | "realm-library-call"
  | "realm-global"
  | "realm-instanceof"
  | "array-instanceof"
  | "error-is"
  | "error-property"
  | "literal-property-has"
  | "list-has"
  | "flow-property-read"
  | "flow-property-read-boxed"
  | "range-error-new"
  | "range-error-is"
  | "type-error-new"
  | "type-error-is"
  | "array-buffer"
  | "array-byte-offset"
  | "array-byte-length"
  | "dynamic-object-array-literal"
  | "dynamic-object-array-method"
  | "dynamic-object-static-call"
  | "dynamic-object-own-enumeration"
  | "dynamic-object-enroll"
  | "dynamic-object-open-literal"
  | "dynamic-object-literal"
  | "dynamic-object-read"
  | "dynamic-object-write"
  | "dynamic-object-update"
  | "dynamic-object-compound"
  | "dynamic-object-has"
  | "dynamic-object-delete"
  | "array-length"
  | "string-from-code-units"
  | "string-from-code-points"
  | "string-length"
  | "string-starts-with"
  | "string-ends-with"
  | "string-includes"
  | "string-index-of"
  | "string-last-index-of"
  | "string-split"
  | "string-repeat"
  | "string-pad-start"
  | "string-pad-end"
  | "string-concat"
  | "string-trim"
  | "string-trim-start"
  | "string-trim-end"
  | "string-substring"
  | "string-slice"
  | "string-read"
  | "string-code-point"
  | "string-char-at"
  | "string-at"
  | "string-code-unit";
/** The Atomics functions typed code runs inline on native integer arrays. */
const atomicsOperations: readonly string[] = [
  "load",
  "store",
  "add",
  "sub",
  "and",
  "or",
  "xor",
  "exchange",
  "compareExchange",
];
export interface ClosureBody {
  readonly node: Span;
  readonly scriptEntry: true | undefined;
  readonly parameters: readonly Parameter[];
  readonly body: Expression | BlockStatement;
  readonly result: number;
  readonly explicitResult?: boolean;
}
export interface CheckedTypeFlow {
  readonly source: number;
  readonly target: number;
  readonly node: Span;
}
export interface RestCall {
  /** First packed argument, relative to the arguments after any explicit receiver. */
  readonly start: number;
  readonly list: number;
  readonly admitsUndefined: boolean;
}
export interface BindingInitialization {
  /** Evaluated once for declarations/assignments. Parameter and loop
   * sites provide the input from their existing entry slots. */
  readonly input: Expression | undefined;
  readonly root: Expression;
  readonly steps: readonly BindingInitializationStep[];
}
export interface BindingInitializationStep {
  readonly read: Expression;
  readonly initializer: Expression | undefined;
  readonly target: Expression;
  readonly binding: SyntaxBinding | undefined;
  readonly array?: ArrayBindingRead;
  readonly assignment?: Expression;
  readonly computedKey?: Expression;
  readonly realmObject?: Expression;
  readonly realmRest?: Expression;
  readonly realmAction?: "object" | "iterator" | "skip" | "close";
}
interface ArrayBindingRead {
  readonly source: Expression;
  readonly position: number;
  readonly rest: boolean;
  readonly inBounds: boolean;
  readonly realm?: boolean;
}
export interface CheckedClosures {
  readonly bindingRealm?: ReadonlyKeyIndex<Span, boolean>;
  readonly needsBindingRealm?: boolean;
  readonly bindingInitializations?:
    ReadonlyKeyIndex<Span, BindingInitialization> | undefined;
  readonly bindingValues?: ReadonlyKeyIndex<Expression, number>;
  readonly bindingRestExclusions?: ReadonlyKeyIndex<
    Expression,
    readonly string[]
  >;
  /** Resolved declaration names share IDs with this result's finite type graph. */
  readonly typeNames: ReadonlyKeyIndex<string, number>;
  readonly classes: readonly ClassContract[];
  readonly typeFlows: readonly CheckedTypeFlow[];
  readonly receiverTypes: ReadonlyMap<number, number>;
  readonly exhaustiveSwitches: ReadonlySet<Statement>;
  readonly module: Module;
  readonly bodies: ReadonlyMap<number, ClosureBody>;
  readonly intrinsics: ReadonlyKeyIndex<Expression, ClosureIntrinsic>;
  /** C view operations (c-views.ts): creations, member and element reads
   * and write targets. */
  readonly cViewUses: ReadonlyKeyIndex<Expression, CViewUse>;
  /** The registry those views come from (shapes by key). */
  readonly cViews?: CViewRegistry | undefined;
  readonly bindings: BoundModule;
  readonly types: readonly Type[];
  /** The checker's own relation system, kept in lockstep with exactly
   * `typeSystem.types`. Consumers must confirm that array is this result's
   * `types` before reusing it; a copied graph needs its own system. */
  readonly typeSystem?: CheckedTypeSystem;
  readonly bindingTypes: readonly (number | undefined)[];
  readonly expressions: ReadonlyKeyIndex<Expression, number>;
  readonly chainValues: ReadonlyKeyIndex<Expression, number>;
  readonly chainReceivers: ReadonlyKeyIndex<Expression, number>;
  readonly restCalls?: ReadonlyKeyIndex<Expression, RestCall>;
  readonly voidResultDiscard?: boolean;
  readonly voidValueCalls?: ReadonlyKeyIndex<Expression, boolean>;
  readonly voidValueReturns?: ReadonlySet<number>;
  /** `x as T` assertions from `unknown` to T: checked downcasts, which
   * throw a TypeError when the value is not a T (docs/unified-pipeline.md). */
  readonly downcasts?: ReadonlyKeyIndex<Expression, number>;
  readonly dynamicEnrollments?: ReadonlyKeyIndex<Expression, number>;
  readonly nativeCallableViews?: ReadonlyKeyIndex<Expression, boolean>;
  readonly nativeListViews?: ReadonlyKeyIndex<Expression, boolean>;
  readonly nativeRecordViews?: ReadonlyKeyIndex<
    Expression,
    readonly NativeRecordViewField[]
  >;
  readonly finitePropertyKeys?: ReadonlyKeyIndex<Expression, readonly string[]>;
  readonly operations: readonly BindingOperation[];
}
export interface NativeRecordViewField {
  readonly name: string;
  readonly type: "number" | "string" | "boolean" | "unknown";
  readonly optional: boolean;
  readonly readonly: boolean;
}
/** A generated binding name. The parser cannot create it from source. */
export const nativeCallableProjectionAlias =
  "$tint$dynamic$@projectUnaryNumber";
export interface CheckedTypeSystem {
  readonly types: readonly Type[];
  readonly system: TypeSystem;
}
export interface ClosureDiagnostic extends Span {
  readonly code: string;
  readonly message: string;
  readonly preventsFallback?: boolean;
  readonly fallback?: ClosureFallback;
}
export interface ClosureFallback {
  readonly capability:
    | "generator-suspension"
    | "async-suspension"
    | InterfaceFallback["capability"]
    | "function-signature-inference"
    | "open-binding-write"
    | "checked-index-read"
    | "object-accessor-layout"
    | "binding-initialization"
    | "aggregate-inference"
    | "aggregate-spread"
    | "default-parameter-layout"
    | "rest-call-layout"
    | "optional-call"
    | "iterable-layout"
    | "lexical-receiver"
    | "collection-construction"
    | "realm-library-global"
    | "realm-library-member"
    | "realm-library-construction"
    | "union-member-narrowing"
    | "union-field-write"
    | "realm-aggregate-update"
    | "general-result-projection"
    | "operator-layout";
  readonly ownerKind: "function" | "class" | "module";
  readonly owner: Span;
}
export type ClosureResult =
  | { readonly ok: true; readonly value: CheckedClosures }
  | { readonly ok: false; readonly error: ClosureDiagnostic };
/** Contextual source checking; operations are attached requirements, not an ordered IR. */
export interface ClosureCheckOptions {
  /** Reuse declared-type resolution across modules with equal type
   * declarations (see InterfaceResolutionCache). */
  readonly interfaceCache?: InterfaceResolutionCache | undefined;
  /** C binding records usable as views (c-views.ts). */
  readonly cViews?: CViewRegistry | undefined;
}
export function checkClosureModule(
  module: Module,
  options: ClosureCheckOptions = {},
): ClosureResult {
  return checkClosureModuleLayout(module, options);
}

function checkClosureModuleLayout(
  module: Module,
  options: ClosureCheckOptions,
  realmPlan?: LocalRealmPlan,
): ClosureResult {
  const realmSinks = createKeyIndex<Expression, boolean>(syntaxHash);
  const realmReads = createKeyIndex<Expression, boolean>(syntaxHash);
  const realmReturnOwners = createKeyIndex<Span, number>(syntaxHash);
  let replayRealm = false;
  // Syntax the checker synthesizes for an existing node reuses that node's
  // span; distinct hashes, above any traversal ordinal, keep each one apart
  // from the source node and from the others in syntax-keyed indexes.
  let nextSyntheticHash = 0x40000000;
  function syntheticNodeHash(): number {
    return nextSyntheticHash++;
  }
  const nativeGlobals: readonly string[] = [
    "undefined",
    "NaN",
    "Infinity",
    "Set",
    "Map",
    "Number",
    "String",
    "BigInt",
    "Object",
    "Math",
    "Atomics",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
    "ArrayBuffer",
    "SharedArrayBuffer",
    "TypeError",
    "RangeError",
    "Error",
  ];
  const bound = bindModule(module, withRealmGlobals(nativeGlobals));
  if (!bound.ok) {
    const diagnostic = bound.error;
    return {
      ok: false,
      error: {
        start: diagnostic.start,
        end: diagnostic.end,
        code: diagnostic.code,
        message: diagnostic.message,
      },
    };
  }
  const graph = bound.value,
    abort = {},
    annotations: TypeNode[] = [];
  const collectionConstructors = createKeyIndex<Expression, TypeNode>(
    syntaxHash,
  );
  const uninitialized = new Set<Span>(),
    varAssignments = new Set<Span>();
  const varInitializers = createKeyIndex<Span, Expression>(syntaxHash);
  const bindingInitializations = createKeyIndex<Span, BindingInitialization>(
    syntaxHash,
  );
  const bindingRealm = createKeyIndex<Span, boolean>(syntaxHash);
  let needsBindingRealm = false;
  const patternValues = createKeyIndex<Expression, number>(syntaxHash);
  const bindingRestExclusions = createKeyIndex<Expression, readonly string[]>(
    syntaxHash,
  );
  const declared = createKeyIndex<Span, TypeNode>(syntaxHash),
    signatures = createKeyIndex<Span, TypeNode>(syntaxHash),
    literals = createKeyIndex<Expression, TypeNode>(syntaxHash);
  let error: ClosureDiagnostic | undefined,
    depth = 0;
  function fail(
    node: Span,
    code: string,
    message: string,
    definitive: boolean = false,
    fallback?: ClosureFallback,
  ): never {
    error = {
      start: node.start,
      end: node.end,
      code,
      message,
      ...(definitive ? { preventsFallback: true } : {}),
      ...(fallback === undefined ? {} : { fallback }),
    };
    throw abort;
  }
  // On a rejection, recover the source owner from the bound declarations. A
  // class is one unit even when the unsupported operation is inside a method.
  function fallbackAt(
    node: Span,
    capability: ClosureFallback["capability"],
  ): ClosureFallback {
    for (const statement of module.statements)
      if (
        statement?.kind === "class" &&
        statement.start <= node.start &&
        node.end <= statement.end
      )
        return {
          capability,
          ownerKind: "class",
          owner: { start: statement.start, end: statement.end },
        };
    let owner: Span | undefined;
    for (const frame of graph.functions)
      if (
        frame !== undefined &&
        frame.node.start <= node.start &&
        node.end <= frame.node.end &&
        (owner === undefined ||
          frame.node.end - frame.node.start < owner.end - owner.start)
      )
        owner = frame.node;
    return owner === undefined
      ? {
          capability,
          ownerKind: "module",
          owner: { start: node.start, end: node.end },
        }
      : {
          capability,
          ownerKind: "function",
          owner: { start: owner.start, end: owner.end },
        };
  }
  function unsupported(
    node: Span,
    capability: ClosureFallback["capability"],
    message: string,
    blocked: boolean = false,
  ): never {
    return fail(
      node,
      "UNSUPPORTED",
      message,
      blocked,
      fallbackAt(node, capability),
    );
  }
  function annotation(node: Span, type: TypeNode | undefined): void {
    if (type !== undefined) {
      annotations.push(type);
      declared.set(node, type);
    }
  }
  function literalDefaultType(value: Expression): TypeNode | undefined {
    const node = ungroup(value);
    const span: Span = {
      start: node.start,
      end: node.end,
      nodeHash: syntheticNodeHash(),
    };
    switch (node.kind) {
      case "number":
      case "string":
      case "boolean":
      case "bigint":
      case "null":
        return { ...span, kind: "named", name: node.kind };
      case "object":
        if (node.properties.length === 0)
          return { ...span, kind: "object", properties: [] };
        break;
      case "satisfies":
        return node.type;
    }
    return undefined;
  }
  function emptyPatternContext(
    pattern: VariableBinding,
    input: Expression,
  ): TypeNode | undefined {
    const source = ungroup(input);
    const span: Span = {
      start: pattern.start,
      end: pattern.end,
      nodeHash: syntheticNodeHash(),
    };
    if (
      pattern.kind === "object-binding" &&
      source.kind === "object" &&
      source.properties.length === 0
    ) {
      const properties: PropertySignature[] = [];
      for (const property of pattern.properties) {
        const value = property?.binding.initializer;
        if (
          property === undefined ||
          property.keyExpression !== undefined ||
          value === undefined
        )
          return undefined;
        const type = literalDefaultType(value);
        if (type === undefined) return undefined;
        properties.push({
          name: property.name,
          type,
          readonly: false,
          optional: true,
          start: property.start,
          end: property.end,
          nodeHash: syntheticNodeHash(),
        });
      }
      return { ...span, kind: "object", properties };
    }
    if (
      pattern.kind === "array-binding" &&
      source.kind === "array" &&
      source.elements.length === 0
    ) {
      return {
        ...span,
        kind: "array",
        element: {
          ...span,
          kind: "named",
          name: "undefined",
          nodeHash: syntheticNodeHash(),
        },
      };
    }
    return undefined;
  }
  function collectFunction(
    node: Span,
    params: readonly Parameter[],
    result: TypeNode | undefined,
    body: Expression | Statement,
    named: boolean,
    receiver?: TypeNode,
  ): void {
    if (receiver !== undefined) annotations.push(receiver);
    let contextualParameters: Parameter[] | undefined;
    for (let index = 0; index < params.length; index++) {
      const p = params[index];
      if (p === undefined) throw "missing parameter";
      if (p.kind === "pattern-parameter")
        visitBindingExpressions(p.pattern, (expression) => collect(expression));
      const initializer = p.initializer;
      if (initializer !== undefined) collect(initializer);
      const inferred =
        p.type === undefined &&
        p.kind === "pattern-parameter" &&
        initializer !== undefined
          ? emptyPatternContext(p.pattern, initializer)
          : undefined;
      if (inferred !== undefined) {
        const contextual = contextualParameters ?? params.slice();
        contextual[index] = { ...p, type: inferred };
        contextualParameters = contextual;
      }
      annotation(
        p,
        p.optional && p.type !== undefined
          ? {
              kind: "union",
              members: [
                p.type,
                {
                  kind: "named",
                  name: "undefined",
                  start: p.start,
                  end: p.end,
                  nodeHash: syntheticNodeHash(),
                },
              ],
              start: p.start,
              end: p.end,
              nodeHash: syntheticNodeHash(),
            }
          : (p.type ?? inferred),
      );
    }
    const signatureParameters = contextualParameters ?? params;
    if (result !== undefined) annotations.push(result);
    let signatureResult = result;
    if (result === undefined && !named && params.some((p) => p.rest)) {
      const provisional: TypeNode = {
        kind: "named",
        name: "void",
        start: node.start,
        end: node.end,
        nodeHash: syntheticNodeHash(),
      };
      signatureResult = provisional;
    }
    if (
      signatureParameters.every(
        (p) => p !== undefined && p.type !== undefined,
      ) &&
      signatureResult !== undefined
    ) {
      const type: TypeNode = {
        kind: "function",
        parameters: signatureParameters,
        ...(receiver === undefined ? {} : { receiver }),
        returnType: signatureResult,
        start: node.start,
        end: node.end,
        nodeHash: syntheticNodeHash(),
      };
      annotations.push(type);
      signatures.set(node, type);
    } else if (named)
      fail(
        node,
        "UNSUPPORTED",
        "named functions require parameter and return annotations",
        false,
        {
          capability: "function-signature-inference",
          ownerKind: "function",
          owner: node,
        },
      );
    collect(body);
  }
  function collect(node: Expression | Statement | undefined): void {
    if (node === undefined) throw "missing syntax node";
    let literal: TypeNode | undefined;
    if (
      node.kind === "string" ||
      node.kind === "boolean" ||
      (node.kind === "number" && Number.isFinite(node.value))
    )
      literal = {
        kind: "literal",
        value: node.value,
        start: node.start,
        end: node.end,
        nodeHash: syntheticNodeHash(),
      };
    if (node.kind === "unary" && node.operator === "-") {
      const operand = node.operand;
      if (operand.kind === "number" && Number.isFinite(operand.value))
        literal = {
          kind: "literal",
          value: -operand.value,
          start: node.start,
          end: node.end,
          nodeHash: syntheticNodeHash(),
        };
    }
    if (
      literal !== undefined &&
      (node.kind === "string" ||
        node.kind === "boolean" ||
        node.kind === "number" ||
        node.kind === "unary")
    ) {
      literals.set(node, literal);
      annotations.push(literal);
    }
    if (++depth > 256)
      fail(node, "LIMIT", "closure checking nesting limit exceeded");
    try {
      switch (node.kind) {
        case "class":
          if (typeParameterCount(node.definition.typeParameters) !== 0)
            fail(
              node,
              "UNSUPPORTED",
              "generic class bodies require specialization",
            );
          for (const member of node.definition.elements) {
            if (member === undefined) throw "class member invariant";
            if (member.kind === "static-block")
              fail(
                member,
                "UNSUPPORTED",
                "typed class static blocks require initialization lowering",
                false,
                {
                  capability: "class-static-block",
                  ownerKind: "class",
                  owner: node,
                },
              );
            if (member.kind !== "field" && member.async)
              fail(
                member,
                "UNSUPPORTED",
                "typed async method lowering is not implemented",
                false,
                {
                  capability: "async-suspension",
                  ownerKind: "class",
                  owner: node,
                },
              );
            if (member.kind !== "field" && member.generator)
              fail(
                member,
                "UNSUPPORTED",
                "generator suspension lowering is not implemented",
                false,
                {
                  capability: "generator-suspension",
                  ownerKind: "class",
                  owner: node,
                },
              );
            if (
              member.kind !== "field" &&
              typeParameterCount(member.typeParameters)
            )
              fail(
                member,
                "UNSUPPORTED",
                "generic class methods require specialization",
              );
            if (member.kind === "field") {
              annotation(member, member.type);
              if (member.initializer !== undefined) collect(member.initializer);
            } else
              collectFunction(
                member,
                member.parameters,
                member.returnType,
                member.body,
                false,
              );
          }
          break;
        case "function":
          if (node.async)
            fail(
              node,
              "UNSUPPORTED",
              "typed async function lowering is not implemented",
              false,
              {
                capability: "async-suspension",
                ownerKind: "function",
                owner: node,
              },
            );
          if (node.generator)
            fail(
              node,
              "UNSUPPORTED",
              "generator suspension lowering is not implemented",
              false,
              {
                capability: "generator-suspension",
                ownerKind: "function",
                owner: node,
              },
            );
          if (typeParameterCount(node.typeParameters))
            fail(
              node,
              "UNSUPPORTED",
              "generic functions require specialization",
            );
          collectFunction(
            node,
            node.parameters,
            node.returnType,
            node.body,
            true,
            node.receiver,
          );
          break;
        case "function-expression":
        case "arrow":
          if (typeParameterCount(node.typeParameters))
            fail(
              node,
              "UNSUPPORTED",
              "generic function expressions require specialization",
            );
          if (node.async)
            fail(
              node,
              "UNSUPPORTED",
              "typed async function lowering is not implemented",
              false,
              {
                capability: "async-suspension",
                ownerKind: "function",
                owner: node,
              },
            );
          if (node.kind === "function-expression" && node.generator)
            fail(
              node,
              "UNSUPPORTED",
              "generator suspension lowering is not implemented",
              false,
              {
                capability: "generator-suspension",
                ownerKind: "function",
                owner: node,
              },
            );
          collectFunction(
            node,
            node.parameters,
            node.returnType,
            node.body,
            false,
            node.kind === "function-expression" ? node.receiver : undefined,
          );
          break;
        case "try": {
          const handler = node.handler;
          if (handler !== undefined && handler.binding !== undefined) {
            const binding = handler.binding;
            const pattern =
              binding.kind === "object-binding" ||
              binding.kind === "array-binding";
            if (pattern) {
              const type = binding.type;
              if (type?.kind !== "named" || type.name !== "any")
                fail(
                  binding,
                  "TYPE_MISMATCH",
                  "catch patterns require an any annotation",
                  true,
                );
              visitBindingExpressions(binding, (expression) =>
                collect(expression),
              );
            }
            const bindingType = pattern ? undefined : binding.type;
            if (
              bindingType !== undefined &&
              (bindingType.kind !== "named" || bindingType.name !== "unknown")
            )
              fail(
                binding,
                "TYPE_MISMATCH",
                "catch binding must have type unknown",
              );
            annotation(
              binding,
              bindingType ?? {
                kind: "named",
                name: "unknown",
                start: binding.start,
                end: binding.end,
                nodeHash: syntheticNodeHash(),
              },
            );
          }
          collect(node.body);
          if (handler !== undefined) collect(handler.body);
          if (node.finalizer !== undefined) collect(node.finalizer);
          break;
        }
        case "block":
          for (const s of node.statements) collect(s);
          break;
        case "variable":
          for (const d of node.declarations) {
            if (d === undefined) throw "missing declaration";
            if (d.kind === "object-binding" || d.kind === "array-binding") {
              const initializer = d.initializer;
              annotation(
                d,
                d.type ??
                  (initializer === undefined
                    ? undefined
                    : emptyPatternContext(d, initializer)),
              );
              visitBindingExpressions(d, (expression) => collect(expression));
              continue;
            }
            annotation(d, d.type);
            const initializer = d.initializer;
            if (initializer !== undefined) {
              collect(initializer);
              if (node.mode === "var") {
                varAssignments.add(d);
                varInitializers.set(d, initializer);
              }
            } else uninitialized.add(d);
          }
          break;
        case "spread":
          collect(node.value);
          break;
        case "template-expression":
          for (const substitution of node.substitutions) collect(substitution);
          break;
        case "tagged-template":
          collect(node.tag);
          collect(node.template);
          break;
        case "array":
          for (const element of node.elements) collect(element);
          break;
        case "object":
          for (const p of node.properties) {
            if (p === undefined) throw "missing object property";
            collect(p.value);
          }
          break;
        case "if":
          collect(node.test);
          collect(node.consequent);
          if (node.alternate !== undefined) collect(node.alternate);
          break;
        case "switch":
          collect(node.expression);
          for (const clause of node.clauses) {
            if (clause === undefined) throw "missing switch clause";
            if (clause.test !== undefined) collect(clause.test);
            for (const child of clause.statements) collect(child);
          }
          break;
        case "label":
          collect(node.body);
          break;
        case "do-while":
        case "while":
          collect(node.test);
          collect(node.body);
          break;
        case "for-in-assignment":
          collect(node.iterable);
          collect(node.target);
          collect(node.body);
          break;
        case "for-in":
        case "for-of": {
          if (node.await)
            unsupported(
              node,
              "async-suspension",
              "typed for-await lowering is not implemented",
            );
          const loopBinding = node.binding;
          if (
            loopBinding.kind === "object-binding" ||
            loopBinding.kind === "array-binding"
          ) {
            visitBindingExpressions(loopBinding, (expression) =>
              collect(expression),
            );
            if (node.mode === "var")
              for (const element of bindingIdentifiers(loopBinding)) {
                if (element === undefined) throw "iteration binding invariant";
                annotation(element, element.type);
                varAssignments.add(element);
              }
          } else {
            annotation(loopBinding, loopBinding.type);
            if (node.mode === "var") varAssignments.add(loopBinding);
          }
          collect(node.iterable);
          collect(node.body);
          break;
        }
        case "for":
          if (node.initializer !== undefined) collect(node.initializer);
          if (node.test !== undefined) collect(node.test);
          if (node.update !== undefined) collect(node.update);
          collect(node.body);
          break;
        case "return":
          if (node.expression !== undefined) collect(node.expression);
          break;
        case "satisfies":
          annotations.push(node.type);
          collect(node.expression);
          break;
        case "throw":
        case "expression":
        case "group":
          collect(node.expression);
          break;
        case "member":
          collect(node.object);
          break;
        case "index":
          collect(node.object);
          collect(node.index);
          break;
        case "unary":
          collect(node.operand);
          break;
        case "binary":
          collect(node.left);
          collect(node.right);
          break;
        case "assignment":
        case "compound":
          collect(node.target);
          collect(node.value);
          break;
        case "update":
          collect(node.target);
          break;
        case "conditional":
          collect(node.test);
          collect(node.consequent);
          collect(node.alternate);
          break;
        case "new": {
          const target = ungroup(node.callee);

          if (
            target.kind === "identifier" &&
            (target.name === "Set" || target.name === "Map") &&
            node.typeArguments.length > 0
          ) {
            const type: TypeNode = {
              kind: "named",
              name: target.name,
              arguments: node.typeArguments,
              start: node.start,
              end: node.end,
              nodeHash: syntheticNodeHash(),
            };
            annotations.push(type);
            collectionConstructors.set(node, type);
          }
          for (const argument of node.typeArguments) {
            if (argument === undefined) throw "missing type argument";
            annotations.push(argument);
          }
          collect(node.callee);
          for (const argument of node.arguments) collect(argument);
          break;
        }
        case "call":
          collect(node.callee);
          for (const a of node.arguments) collect(a);
          break;
        default:
          break;
      }
    } finally {
      depth--;
    }
  }
  try {
    for (const node of module.statements) collect(node);
  } catch (e) {
    if (e !== abort) throw e;
  }
  if (error !== undefined) return { ok: false, error };
  const optionalAnnotation: TypeNode = {
    kind: "union",
    members: [
      { kind: "named", name: "number", start: 0, end: 0 },
      { kind: "named", name: "undefined", start: 0, end: 0 },
    ],
    start: 0,
    end: 0,
  };
  const numericListAnnotation: TypeNode & { readonly kind: "array" } = {
    kind: "array",
    element: { kind: "named", name: "number", start: 0, end: 0 },
    readonly: false,
    start: 0,
    end: 0,
  };
  const optionalNumericListAnnotation: TypeNode = {
    ...numericListAnnotation,
    element: optionalAnnotation,
  };
  const stringListAnnotation: TypeNode = {
    ...numericListAnnotation,
    element: { kind: "named", name: "string", start: 0, end: 0 },
  };
  annotations.push(
    optionalAnnotation,
    numericListAnnotation,
    optionalNumericListAnnotation,
    stringListAnnotation,
  );
  const resolved = resolveInterfaceTypes(
    module,
    annotations,
    options.interfaceCache,
    options.cViews,
  );
  if (!resolved.ok) {
    const diagnostic = resolved.error;
    return {
      ok: false,
      error: {
        start: diagnostic.start,
        end: diagnostic.end,
        code: diagnostic.code,
        message: diagnostic.message,
        ...(diagnostic.preventsFallback === true
          ? { preventsFallback: true }
          : {}),
        ...(diagnostic.fallback === undefined
          ? {}
          : {
              fallback:
                diagnostic.fallback.ownerKind === "class"
                  ? diagnostic.fallback
                  : fallbackAt(diagnostic, diagnostic.fallback.capability),
            }),
      },
    };
  }
  const contracts = resolved.value;
  const classContracts = createKeyIndex<ClassDefinition, ClassContract>(
    syntaxHash,
  );
  for (const contract of contracts.classes) {
    if (contract === undefined) throw "class contract invariant";
    classContracts.set(contract.definition, contract);
  }
  const types: Type[] = [];
  const unionIndex = createUnionIndex(types);
  for (const type of contracts.types) {
    if (type === undefined) throw "missing resolved type";
    types.push(type);
  }
  const system = contracts.system;
  const bindingTypes: number[] = [],
    expressions = createKeyIndex<Expression, number>(syntaxHash),
    operations: BindingOperation[] = [];
  const restCalls = createKeyIndex<Expression, RestCall>(syntaxHash);
  const typeFlows: CheckedTypeFlow[] = [];
  const flowTargets = new Map<number, Set<number>>();
  function recordTypeFlow(source: number, target: number, node: Span): void {
    if (source === target) return;
    const from = types[source],
      to = types[target];
    if (from === undefined || to === undefined) return;
    if (
      (from.kind !== "array" &&
        from.kind !== "object" &&
        from.kind !== "union" &&
        from.kind !== "function") ||
      (to.kind !== "array" &&
        to.kind !== "object" &&
        to.kind !== "union" &&
        to.kind !== "function")
    )
      return;
    let targets = flowTargets.get(source);
    if (targets === undefined) {
      targets = new Set<number>();
      flowTargets.set(source, targets);
    }
    if (targets.has(target)) return;
    targets.add(target);
    typeFlows.push({ source, target, node });
  }
  /** Speculative relation queries can make a void result compatible even
   * when the value never flows to that type. Only checked value flows need a
   * physical result-discarding witness. */
  function requiresVoidResultDiscard(): boolean {
    if (!system.usesVoidResultDiscard()) return false;
    const seen = new Set<number>();
    function pair(
      source: number | undefined,
      target: number | undefined,
    ): boolean {
      if (source === undefined) return false;
      if (target === undefined) return false;
      if (source === target) return false;
      const left: number = source,
        right: number = target;
      const key = left * types.length + right;
      if (seen.has(key)) return false;
      seen.add(key);
      const from = types[left],
        to = types[right];
      if (from === undefined || to === undefined) return false;
      if (from.kind === "union")
        return from.members.some((member) => pair(member, right));
      if (to.kind === "union")
        return to.members.some(
          (member) =>
            member !== undefined &&
            system.assignable(left, member) &&
            pair(left, member),
        );
      if (from.kind === "function" && to.kind === "function") {
        const kind = types[from.result]?.kind;
        if (
          types[to.result]?.kind === "void" &&
          kind !== "void" &&
          kind !== "never"
        )
          return true;
        return (
          pair(from.result, to.result) ||
          pair(to.receiver, from.receiver) ||
          from.parameters.some((parameter, index) =>
            pair(to.parameters[index], parameter),
          )
        );
      }
      if (from.kind === "array" && to.kind === "array")
        return pair(from.element, to.element);
      if (from.kind === "object" && to.kind === "function")
        return pair(from.call, right);
      if (from.kind === "function" && to.kind === "object")
        return pair(left, to.call);
      if (from.kind !== "object" || to.kind !== "object") return false;
      const properties = from.properties;
      return (
        pair(from.call, to.call) ||
        pair(from.construct, to.construct) ||
        to.properties.some((property) => {
          if (property === undefined) throw "type flow property invariant";
          const own = properties.find(
            (candidate) => candidate?.name === property.name,
          );
          return pair(own?.type, property.type);
        })
      );
    }
    return typeFlows.some(
      (flow) => flow !== undefined && pair(flow.source, flow.target),
    );
  }
  const intrinsics = createKeyIndex<Expression, ClosureIntrinsic>(syntaxHash);
  // Validation witnesses for fresh contextual literals are separate from their
  // retained inferred types. They never authorize a runtime reference conversion.
  const contextualProofs = createKeyIndex<Expression, number>(syntaxHash);
  const inferredReturns = new Map<number, number[]>();
  const receiverTypes = new Map<number, number>();
  const bodies = new Map<number, ClosureBody>(),
    exhaustiveSwitches = new Set<Statement>();
  // One fact set drives the existing branch joins. Binding IDs encode numeric
  // presence; interned tokens above that ID range encode narrowed object types.
  // Tokens are stable so equivalent facts survive set intersection at merges.
  let present = new Set<number>();
  // After a call, stable additions and deletions cannot introduce another fact
  // that a later call must remove. Branch refinements use fresh set identities.
  let callSafeFacts: Set<number> | undefined;
  const pendingParameters = new Set<number>();
  const openPatternBindings = new Set<number>();
  let writablePatternCandidates: Set<number> | undefined;
  const narrowed: {
      binding: number;
      type: number;
      property?: string;
      checkedRead?: boolean;
    }[] = [],
    narrowKeys = createStringIndex<number>();
  // Interned tokens outlive branch snapshots. This index limits queries and
  // invalidation by binding; each snapshot still decides active membership.
  const narrowingTokens = new Map<number, number[]>();
  function forgetNarrowed(binding: number): void {
    const tokens = narrowingTokens.get(binding);
    if (tokens !== undefined)
      for (const token of tokens)
        if (token !== undefined) present.delete(token);
  }
  function invalidatePropertyFacts(binding: number, prefix?: string): void {
    const tokens = narrowingTokens.get(binding);
    if (tokens === undefined) return;
    for (const token of tokens) {
      if (token === undefined) continue;
      const property = narrowed[token - graph.bindings.length]?.property;
      if (
        property !== undefined &&
        (prefix === undefined || property.startsWith(prefix))
      )
        present.delete(token);
    }
  }
  function narrowedType(
    binding: number,
    declared: number,
    facts: Set<number>,
  ): number {
    let type = declared,
      matches = 0;
    const tokens = narrowingTokens.get(binding);
    if (tokens !== undefined)
      for (const token of tokens) {
        if (token === undefined || !facts.has(token)) continue;
        const fact = narrowed[token - graph.bindings.length];
        if (fact !== undefined && fact.property === undefined) {
          type = fact.type;
          if (++matches > 1) break;
        }
      }
    // A single active candidate has no ordering ambiguity. If there are several,
    // preserve the fact set's original first-match order, not token creation order.
    if (matches > 1)
      for (const token of facts) {
        const fact = narrowed[token - graph.bindings.length];
        if (
          fact !== undefined &&
          fact.binding === binding &&
          fact.property === undefined
        ) {
          type = fact.type;
          break;
        }
      }
    return facts.has(binding) ? (presentType(type) ?? type) : type;
  }
  function narrowToken(
    binding: number,
    type: number,
    property?: string,
    checkedRead?: boolean,
  ): number {
    const key =
        String(binding) +
        ":" +
        String(type) +
        ":" +
        (property === undefined
          ? "object"
          : (checkedRead === true ? "checked-field:" : "field:") + property),
      known = narrowKeys.get(key);
    if (known !== undefined) return known;
    const token = graph.bindings.length + narrowed.length;
    narrowKeys.set(key, token);
    const tokens = narrowingTokens.get(binding);
    if (tokens === undefined) narrowingTokens.set(binding, [token]);
    else tokens.push(token);
    narrowed.push({
      binding,
      type,
      ...(property === undefined ? {} : { property }),
      ...(checkedRead === true ? { checkedRead } : {}),
    });
    return token;
  }
  const declarations = createKeyIndex<Span, Binding>(syntaxHash),
    references = createKeyIndex<Expression, Binding>(syntaxHash),
    functions = createKeyIndex<Span, number>(syntaxHash);
  for (const b of graph.bindings) {
    if (b === undefined) throw "missing binding";
    declarations.set(b.node, b);
  }
  for (const alias of graph.aliases ?? []) {
    if (alias === undefined) throw "binding alias invariant";
    const b = graph.bindings[alias.binding];
    if (b === undefined) throw "binding alias invariant";
    declarations.set(alias.node, b);
  }
  for (const f of graph.functions) {
    if (f === undefined) throw "missing function";
    functions.set(f.node, f.id);
  }
  for (const r of graph.references) {
    if (r === undefined) throw "missing reference";
    if (r.binding !== undefined) {
      const b = graph.bindings[r.binding];
      if (b === undefined) throw "reference invariant";
      references.set(r.node, b);
    }
  }
  function typeOf(node: TypeNode): number {
    const id = contracts.annotations.get(node);
    if (id === undefined) throw "annotation invariant";
    return id;
  }
  function primitive(name: string): number {
    const id =
      name === "Error"
        ? types.findIndex((type) => type?.kind === "Error")
        : contracts.names.get(name);
    if (id === undefined || id < 0) throw "primitive invariant";
    return id;
  }
  const number = primitive("number"),
    boolean = primitive("boolean"),
    undefinedType = primitive("undefined"),
    nullType = primitive("null"),
    string = primitive("string"),
    bigint = primitive("bigint"),
    voidType = primitive("void"),
    optionalNumber = typeOf(optionalAnnotation);
  declared.forEach((type, node) => {
    const b = declarations.get(node);
    if (b !== undefined) {
      const actual = typeOf(type),
        previous = bindingTypes[b.id];
      if (
        previous !== undefined &&
        (!system.assignable(previous, actual) ||
          !system.assignable(actual, previous))
      )
        error = {
          start: node.start,
          end: node.end,
          code: "TYPE_MISMATCH",
          message: "redeclaration must preserve the binding type",
        };
      bindingTypes[b.id] = actual;
    }
  });
  if (error !== undefined) return { ok: false, error };
  signatures.forEach((type, node) => {
    const b = declarations.get(node);
    if (b !== undefined) bindingTypes[b.id] = typeOf(type);
  });
  for (const node of module.statements) {
    if (node === undefined || node.kind !== "class") continue;
    const contract = classContracts.get(node.definition);
    if (contract === undefined) throw "class contract invariant";
    const outer = declarations.get(node),
      inner = declarations.get(node.definition);
    if (outer !== undefined) bindingTypes[outer.id] = contract.constructor;
    if (inner !== undefined) bindingTypes[inner.id] = contract.constructor;
  }
  const assignedVars = new Set<number>();
  for (const node of varAssignments) {
    const b = declarations.get(node);
    if (b !== undefined) assignedVars.add(b.id);
  }
  varInitializers.forEach((input, node) => {
    const b = declarations.get(node),
      value = ungroup(input);
    if (b === undefined || bindingTypes[b.id] !== undefined) return;
    if (value.kind === "number") bindingTypes[b.id] = number;
    else if (value.kind === "string") bindingTypes[b.id] = string;
    else if (value.kind === "boolean") bindingTypes[b.id] = boolean;
  });
  for (const b of graph.bindings) {
    if (b === undefined) throw "binding invariant";
    if (
      b.kind === "var" &&
      bindingTypes[b.id] === undefined &&
      !assignedVars.has(b.id)
    )
      bindingTypes[b.id] = undefinedType;
  }
  const deferred = new Set<number>();
  for (const node of uninitialized) {
    const b = declarations.get(node),
      type = b === undefined ? undefined : bindingTypes[b.id];
    if (
      b !== undefined &&
      b.kind !== "parameter" &&
      b.kind !== "function" &&
      type !== undefined &&
      !system.assignable(undefinedType, type)
    )
      deferred.add(b.id);
  }
  for (const b of graph.bindings) {
    if (b === undefined) throw "binding invariant";
    const type = bindingTypes[b.id];
    if (
      b.kind === "var" &&
      type !== undefined &&
      !system.assignable(undefinedType, type)
    )
      deferred.add(b.id);
  }
  function declaredToken(id: number): number {
    return -1 - graph.bindings.length - id;
  }
  function assignedToken(id: number): number {
    return -1 - id;
  }
  function assignedFacts(): Set<number> {
    const facts = new Set<number>();
    for (const fact of present) if (fact < 0) facts.add(fact);
    return facts;
  }
  function stableFacts(
    source: Set<number> = present,
    immutableOnly: boolean = false,
  ): Set<number> {
    const facts = new Set<number>();
    for (const token of source) {
      if (token < 0) {
        facts.add(token);
        continue;
      }
      const fact = narrowed[token - graph.bindings.length];
      if (fact !== undefined) {
        if (
          (fact.property === undefined || fact.checkedRead === true) &&
          (graph.bindings[fact.binding]?.mutable === false ||
            (!immutableOnly &&
              graph.bindings[fact.binding]?.captured === false))
        )
          facts.add(token);
      } else if (graph.bindings[token]?.mutable === false) facts.add(token);
    }
    return facts;
  }
  // Literal module constants have independently known types, even when their
  // declarations follow a function body. Initialization operations stay in source order.
  for (const statement of module.statements) {
    if (statement === undefined) throw "missing module statement";
    if (statement.kind !== "variable" || statement.mode !== "const") continue;
    for (const declaration of statement.declarations) {
      if (declaration === undefined) throw "missing declaration";
      if (declaration.type !== undefined) continue;
      const value = declaration.initializer,
        b = declarations.get(declaration);
      if (b === undefined || value === undefined) continue;
      if (value.kind === "number") bindingTypes[b.id] = number;
      else if (value.kind === "boolean") bindingTypes[b.id] = boolean;
      else if (value.kind === "string") bindingTypes[b.id] = string;
    }
  }
  function isArray(type: number): boolean {
    const t = types[type];
    if (t === undefined) return false;
    if (t.kind === "object" && t.realmTypedArray !== undefined) return true;
    // C views are byte arrays with members only.
    if (t.kind === "Uint8Array") return t.view === undefined;
    return (
      t.kind === "Uint16Array" ||
      t.kind === "Uint32Array" ||
      t.kind === "Float64Array"
    );
  }
  function arrayElementType(type: number): number {
    const array = types[type];
    return array?.kind === "object" &&
      (array.realmTypedArray === "BigInt64Array" ||
        array.realmTypedArray === "BigUint64Array")
      ? bigint
      : number;
  }
  function objectElement(
    type: number,
    seen: Set<number> = new Set<number>(),
  ): boolean {
    if (seen.has(type)) return false;
    const t = types[type];
    if (t?.kind === "object") return true;
    if (t?.kind !== "union") return false;
    const path = new Set(seen);
    path.add(type);
    return (
      t.members.length > 0 && t.members.every((m) => objectElement(m, path))
    );
  }
  function listReferenceElement(
    type: number,
    seen: Set<number> = new Set<number>(),
  ): boolean {
    // C views are byte arrays too (references with the same layout).
    if (objectElement(type) || isArray(type) || viewOf(type) !== undefined)
      return true;
    if (seen.has(type)) return false;
    const value = types[type];
    if (value?.kind === "function") return true;
    if (value?.kind === "array") return isList(type, seen);
    if (value?.kind === "set")
      return (
        system.assignable(value.element, number) ||
        system.assignable(value.element, string)
      );
    if (value?.kind !== "union") return false;
    const path = new Set(seen);
    path.add(type);
    return (
      value.members.length > 0 &&
      value.members.every((m) => listReferenceElement(m, path))
    );
  }
  function listValueElement(
    type: number,
    seen: Set<number> = new Set<number>(),
  ): boolean {
    if (seen.has(type)) return false;
    const value = types[type];
    if (value === undefined) return false;
    if (
      value.kind === "unknown" ||
      value.kind === "void-value" ||
      value.kind === "never" ||
      value.kind === "number" ||
      value.kind === "string" ||
      value.kind === "boolean" ||
      value.kind === "bigint" ||
      value.kind === "undefined" ||
      value.kind === "literal"
    )
      return true;
    if (value.kind !== "union") return listReferenceElement(type, seen);
    const path = new Set(seen);
    path.add(type);
    return (
      value.members.length > 0 &&
      value.members.every((member) => listValueElement(member, path))
    );
  }
  function isList(
    type: number,
    seen: Set<number> = new Set<number>(),
  ): boolean {
    if (seen.has(type)) return false;
    const path = new Set(seen);
    path.add(type);
    const value = types[type];
    return (
      value?.kind === "array" &&
      value.realmArray !== true &&
      listValueElement(value.element, path)
    );
  }
  function listElement(type: number, node: Span): number {
    const value = types[type];
    if (value?.kind !== "array" || !isList(type))
      fail(node, "TYPE_MISMATCH", "expected a supported array");
    return value.element;
  }
  function listReadType(type: number, node: Span): number {
    const element = listElement(type, node);
    if (types[element]?.kind === "never") return undefinedType;
    return system.assignable(undefinedType, element)
      ? element
      : unionSubset([element, undefinedType], node);
  }
  function listIterationElement(type: number, node: Span): number {
    const element = listElement(type, node);
    return types[element]?.kind === "never" ? undefinedType : element;
  }
  function requireMutableList(type: number, node: Span): void {
    const value = types[type];
    if (value?.kind !== "array" || !isList(type))
      fail(node, "TYPE_MISMATCH", "expected a supported array");
    if (value.readonly)
      fail(node, "IMMUTABLE", "cannot mutate a readonly array");
  }
  function requireArray(type: number, node: Span): void {
    if (!isArray(type))
      fail(node, "TYPE_MISMATCH", "expected an supported numeric typed array");
  }
  function binding(node: Span): Binding {
    const b = declarations.get(node);
    if (b === undefined) throw "declaration invariant";
    return b;
  }
  /** Whether an assigned value cannot be undefined. A conditional is
   * judged by its branches: its own type joins them into the contextual
   * (declared) type, which TypeScript does not narrow by. */
  function assignsPresent(
    value: Expression,
    type: number,
    presentAfter: number,
  ): boolean {
    if (system.assignable(type, presentAfter)) return true;
    const node = ungroup(value);
    if (node.kind !== "conditional") return false;
    const yes = expressions.get(node.consequent),
      no = expressions.get(node.alternate);
    return (
      yes !== undefined &&
      no !== undefined &&
      assignsPresent(node.consequent, yes, presentAfter) &&
      assignsPresent(node.alternate, no, presentAfter)
    );
  }
  function mentionsNull(id: number): boolean {
    const type = types[id];
    if (type?.kind === "null") return true;
    return (
      type?.kind === "union" &&
      type.members.some(
        (member: number | undefined) =>
          member !== undefined && mentionsNull(member),
      )
    );
  }
  /** Whether undefined or null is a value of the type. */
  function nullable(id: number): boolean {
    const type = types[id];
    if (type === undefined) return true;
    if (
      type.kind === "undefined" ||
      type.kind === "null" ||
      type.kind === "void" ||
      type.kind === "unknown"
    )
      return true;
    return (
      type.kind === "union" &&
      type.members.some(
        (member: number | undefined) =>
          member === undefined || nullable(member),
      )
    );
  }
  function mentionsBigInt(id: number): boolean {
    const type = types[id];
    if (type?.kind === "bigint") return true;
    return (
      type?.kind === "union" &&
      type.members.some(
        (member: number | undefined) =>
          member !== undefined && mentionsBigInt(member),
      )
    );
  }
  function dynamicObject(type: number): boolean {
    const value = types[type];
    return value?.kind === "object" && value.stringIndex !== undefined;
  }
  function requireType(actual: number, expected: number, node: Span): void {
    recordTypeFlow(actual, expected, node);
    if (!system.assignable(actual, expected))
      fail(
        node,
        "TYPE_MISMATCH",
        "value does not match its declared type",
        dynamicObject(expected) || dynamicObject(actual),
      );
  }
  // C views (c-views.ts): nominal Uint8Array types over binding records.
  const cViews = options.cViews,
    cViewUses = createKeyIndex<Expression, CViewUse>(syntaxHash),
    cViewTypes = createStringIndex<number>();
  /** The view key of `type`, if it is a C view. */
  function viewOf(type: number): string | undefined {
    const t = types[type];
    if (t === undefined || t.kind !== "Uint8Array") return undefined;
    return t.view;
  }
  function viewShape(key: string, node: Span): CViewShape {
    const shape = cViews === undefined ? undefined : cViews.shapes.get(key);
    if (shape === undefined)
      fail(node, "INVALID_TYPE", "unknown C view " + key);
    return shape;
  }
  function viewType(key: string, node: Span): number {
    const known = cViewTypes.get(key);
    if (known !== undefined) return known;
    viewShape(key, node);
    const id = appendType(
      { kind: "Uint8Array", view: key },
      node,
      "invalid C view type",
    );
    cViewTypes.set(key, id);
    return id;
  }
  /** The TypeScript type of a view member's value. */
  function viewValueType(member: CViewMember, node: Span): number {
    return member.value === "number"
      ? number
      : member.value === "boolean"
        ? boolean
        : viewType(member.view, node);
  }
  /** The view use of `target` (`v.m`, `v["m"]` or `v[i]`) when its
   * receiver `object` is a C view; it is recorded on `target`. Record views
   * have only their members; array views have elements (an index must be
   * a number; out-of-range indexes throw RangeError) and `length`. */
  function viewAccess(
    target: Expression,
    object: number,
    property: string | undefined,
    keyType: number | undefined,
    write: boolean,
  ): CViewUse | undefined {
    const key = viewOf(object);
    if (key === undefined) return undefined;
    const shape = viewShape(key, target),
      element = shape.element;
    let use: CViewUse;
    if (element !== undefined && property === "length") {
      if (write) fail(target, "IMMUTABLE", "a C array's length is fixed");
      use = {
        kind: "length",
        view: key,
        size: shape.size,
        length: shape.length,
      };
    } else if (element !== undefined) {
      if (target.kind !== "index" || keyType === undefined)
        fail(target, "PROPERTY", "C arrays have elements and length only");
      requireType(keyType, number, target.index);
      use = {
        kind: "element",
        view: key,
        size: shape.size,
        length: shape.length,
        member: element,
      };
    } else {
      const member =
        property === undefined ? undefined : cViewMember(shape, property);
      if (member === undefined)
        fail(
          target,
          "PROPERTY",
          property === undefined
            ? "C record members need a literal name"
            : "C record has no member " + property,
        );
      use = {
        kind: "member",
        view: key,
        size: shape.size,
        length: shape.length,
        member,
      };
    }
    const member = use.member;
    if (write && member !== undefined && member.value === "view")
      fail(
        target,
        "IMMUTABLE",
        "nested C records and arrays are assigned member by member",
      );
    cViewUses.set(target, use);
    return use;
  }
  /** `viewAt(R, address)` or `arrayAt(R, address, count)` of
   * `tint:ffi/unsafe` (already checked as calls returning byte arrays):
   * with `R` a binding Layout constant, a view of R (or an array of views)
   * over memory C owns. */
  function foreignView(
    node: Expression & { readonly kind: "call" },
    kind: "view" | "array",
  ): number {
    const first = node.arguments[0],
      layout = first === undefined ? undefined : ungroup(first);
    const key =
      cViews === undefined ||
      layout === undefined ||
      layout.kind !== "identifier"
        ? undefined
        : cViews.layouts.get(layout.name);
    if (key === undefined)
      fail(
        node,
        "TYPE_MISMATCH",
        "foreign views name a binding Layout constant",
      );
    const view = viewType(key, node);
    return kind === "view" ? view : arrayOf(view, node);
  }
  /** The value type a view use reads (and a write must provide). */
  function viewUseType(use: CViewUse, node: Span): number {
    const member = use.member;
    return member === undefined ? number : viewValueType(member, node);
  }
  function cell(
    b: Binding,
    op: CellOperation,
    node: Span,
    owner: number | undefined,
  ): number {
    if (
      op.kind !== "initialize" &&
      b.owner === owner &&
      pendingParameters.has(b.id)
    )
      unsupported(
        node,
        "binding-initialization",
        "parameter is not initialized: " + b.name,
      );
    const type = bindingTypes[b.id];
    if (type === undefined)
      unsupported(
        node,
        "binding-initialization",
        "forward or recursive inferred bindings require an annotation",
      );
    if (deferred.has(b.id)) {
      if ((b.captured && b.kind !== "var") || b.owner === undefined)
        unsupported(
          node,
          "binding-initialization",
          "deferred captured or module bindings require initialization support",
        );
      if (
        (b.kind !== "var" && !present.has(declaredToken(b.id))) ||
        (op.kind === "read" && !present.has(assignedToken(b.id)))
      )
        fail(
          node,
          "TYPE_MISMATCH",
          "binding may be read or written before definite initialization: " +
            b.name,
        );
    }
    const checked = system.cell({ type, mutable: b.mutable }, op);
    if (!checked.ok) {
      if (checked.error === "TYPE_MISMATCH" && op.kind !== "read") {
        const source = types[op.value],
          target = types[type];
        if (
          source?.kind === "function" &&
          target?.kind === "function" &&
          (source.rest === true || target.rest === true) &&
          ((source.rest === true) !== (target.rest === true) ||
            source.parameters.length !== target.parameters.length)
        )
          fail(
            node,
            checked.error,
            "rest function assignments require matching rest layouts",
          );
      }
      if (
        checked.error === "TYPE_MISMATCH" &&
        op.kind === "write" &&
        b.mutable &&
        !declared.has(b.node)
      ) {
        const frame = owner === undefined ? undefined : graph.functions[owner];
        fail(
          node,
          checked.error,
          "invalid binding operation",
          false,
          frame === undefined
            ? {
                capability: "open-binding-write",
                ownerKind: "module",
                owner: node,
              }
            : {
                capability: "open-binding-write",
                ownerKind: "function",
                owner: frame.node,
              },
        );
      }
      fail(node, checked.error, "invalid binding operation");
    }
    operations.push({
      node,
      function: owner,
      binding: b.id,
      operation: checked.value,
    });
    if (op.kind !== "read") {
      if (b.mutable && b.captured) callSafeFacts = undefined;
      if (deferred.has(b.id)) present.add(assignedToken(b.id));
      forgetNarrowed(b.id);
      if (openPatternBindings.has(b.id))
        present.add(narrowToken(b.id, op.value));
      // Presence only narrows a declared union containing undefined. Definite
      // assignment has separate tokens; definite types need no snapshot entry.
      if (
        presentType(type) !== undefined &&
        !system.assignable(undefinedType, op.value)
      )
        present.add(b.id);
      else present.delete(b.id);
    }
    return type;
  }
  function presentType(
    type: number | undefined,
    nullish: boolean = false,
  ): number | undefined {
    if (type === undefined) return undefined;
    if (types[type]?.kind !== "union") return undefined;
    const members: number[] = [],
      seen = new Set<number>();
    let absent = false;
    function collect(id: number): void {
      if (seen.has(id)) return;
      seen.add(id);
      const t = types[id];
      if (t?.kind === "union") {
        for (const m of t.members) {
          if (m === undefined) throw "missing union member";
          collect(m);
        }
      } else if (t?.kind === "undefined" || (nullish && t?.kind === "null"))
        absent = true;
      else members.push(id);
    }
    collect(type);
    return absent && members.length > 0
      ? unionSubset(members, { start: 0, end: 0 })
      : undefined;
  }
  function optional(type: number | undefined): boolean {
    const id = type;
    return (
      id !== undefined &&
      system.assignable(id, optionalNumber) &&
      system.assignable(number, id) &&
      system.assignable(undefinedType, id)
    );
  }
  function intersect(a: Set<number>, b: Set<number>): Set<number> {
    const result = new Set<number>();
    for (const id of a) if (b.has(id)) result.add(id);
    return result;
  }
  function ungroup(node: Expression): Expression {
    while (node.kind === "group" || node.kind === "satisfies")
      node = node.expression;
    return node;
  }
  function pure(node: Expression): boolean {
    switch (node.kind) {
      case "identifier":
      case "number":
      case "boolean":
      case "string":
      case "null":
        return true;
      case "member":
        return pure(node.object);
      case "index":
        // Strict-profile indexed reads do not invoke user-defined accessors.
        return pure(node.object) && pure(node.index);
      case "satisfies":
      case "group":
        return pure(node.expression);
      case "unary":
        return pure(node.operand);
      case "binary":
        return pure(node.left) && pure(node.right);
      case "call":
        return (
          (intrinsics.get(node) === "number-is-integer" ||
            intrinsics.get(node) === "number-is-finite" ||
            intrinsics.get(node) === "number-is-safe-integer") &&
          node.arguments.every(pure)
        );
      default:
        return false;
    }
  }
  function isUndefined(node: Expression): boolean {
    node = ungroup(node);
    return (
      node.kind === "identifier" &&
      node.name === "undefined" &&
      !references.has(node)
    );
  }
  function discriminants(
    node: Expression,
    facts: Set<number>,
  ):
    | {
        binding: number;
        property: string;
        optional: boolean;
        variants: {
          type: number;
          tag: number;
          value: string | number | boolean | undefined;
        }[];
      }
    | undefined {
    node = ungroup(node);
    if (node.kind !== "member") return undefined;
    const b = references.get(ungroup(node.object));
    if (b === undefined) return undefined;
    const declared = bindingTypes[b.id];
    if (declared === undefined) return undefined;
    const property = node.property,
      bindingId = b.id,
      optional = node.optional === true;
    const variants: {
        type: number;
        tag: number;
        value: string | number | boolean | undefined;
      }[] = [],
      visited = new Set<number>();
    // Narrowed types of `property` among the binding's facts, in token order.
    // They depend on neither the variant nor its tag, so they are gathered
    // once per test instead of rescanning every token for every literal tag.
    const factTypes: number[] = [];
    let gathered = false;
    function propertyFacts(): number[] {
      if (gathered) return factTypes;
      gathered = true;
      const tokens = narrowingTokens.get(bindingId);
      if (tokens !== undefined)
        for (const token of tokens) {
          if (token === undefined || !facts.has(token)) continue;
          const fact = narrowed[token - graph.bindings.length];
          if (fact !== undefined && fact.property === factKey(property))
            factTypes.push(fact.type);
        }
      return factTypes;
    }
    function collect(id: number): boolean {
      if (visited.has(id)) return true;
      visited.add(id);
      const t = types[id];
      if (t?.kind === "union") return t.members.every(collect);
      if (optional && t?.kind === "undefined") return true;
      if (t?.kind !== "object") return false;
      const p = t.properties.find(
        (p) => p !== undefined && p.name === property,
      );
      if (p === undefined || !p.readonly) return false;
      if (p.optional)
        variants.push({ type: id, tag: undefinedType, value: undefined });
      const tags = new Set<number>();
      function collectTag(tagId: number): boolean {
        if (tags.has(tagId)) return true;
        tags.add(tagId);
        const tag = types[tagId];
        if (tag?.kind === "union") return tag.members.every(collectTag);
        if (tag?.kind === "undefined") {
          variants.push({ type: id, tag: undefinedType, value: undefined });
          return true;
        }
        if (tag?.kind !== "literal") return false;
        for (const factType of propertyFacts())
          if (factType !== undefined && !system.assignable(tagId, factType))
            return true;
        variants.push({ type: id, tag: tagId, value: tag.value });
        return true;
      }
      return collectTag(p.type);
    }
    return collect(narrowedType(b.id, declared, facts))
      ? { binding: b.id, property, optional, variants }
      : undefined;
  }
  // Structural interning of inferred function, never, array and Set types
  // used to scan the whole table per request (quadratic in program size).
  // The index catches up with appended types before each lookup and keeps the
  // first id per key, which is what the scan returned; entries of these kinds
  // are never replaced in place.
  const interned = createStringIndex<number>();
  let internedCount = 0;
  function internKey(type: Type): string | undefined {
    if (type.kind === "function")
      return type.receiver === undefined &&
        type.rest !== true &&
        type.instancePredicate === undefined
        ? "f" + type.result + "(" + type.parameters.join(",") + ")"
        : undefined;
    if (type.kind === "never") return "n";
    if (type.kind === "realm-callable" || type.kind === "dynamic-result")
      return type.kind;
    if (type.kind === "array")
      return type.readonly || type.realmArray === true
        ? undefined
        : "a" + type.element;
    if (type.kind === "set")
      return type.readonly ? undefined : "s" + type.element;
    return undefined;
  }
  function internedType(key: string): number {
    while (internedCount < types.length) {
      const type = types[internedCount];
      if (type !== undefined) {
        const typeKey = internKey(type);
        if (typeKey !== undefined && !interned.has(typeKey))
          interned.set(typeKey, internedCount);
      }
      internedCount++;
    }
    return interned.get(key) ?? -1;
  }
  function appendType(type: Type, node: Span, message: string): number {
    const added = system.append(type);
    if (!added.ok) fail(node, added.error, message);
    if (added.value !== types.length) throw "type graph append invariant";
    types.push(type);
    return added.value;
  }
  // unionSubset's visited marks: one epoch per call (it never reenters
  // itself), so wide unions need no hashed number sets.
  let subsetStamps = new Uint32Array(0),
    subsetEpoch = 0;
  function unionSubset(members: readonly number[], node: Span): number {
    if (subsetStamps.length < types.length) {
      subsetStamps = new Uint32Array(types.length * 2);
      subsetEpoch = 0;
    }
    if (subsetEpoch === 0xffffffff) {
      subsetStamps.fill(0);
      subsetEpoch = 0;
    }
    const epoch = ++subsetEpoch,
      stamps = subsetStamps,
      distinct: number[] = [];
    // Preserve record-union identities used by collection layout contracts.
    // Primitive alternatives have no such layout identity and can be flattened.
    function primitiveAlternative(member: number): boolean {
      const type = types[member];
      return type?.kind === "union"
        ? type.members.every(primitiveAlternative)
        : type?.kind === "literal" ||
            type?.kind === "number" ||
            type?.kind === "string" ||
            type?.kind === "boolean" ||
            type?.kind === "undefined" ||
            type?.kind === "null";
    }
    function collect(member: number): void {
      if (stamps[member] === epoch) return;
      stamps[member] = epoch;
      const type = types[member];
      if (type?.kind === "union" && primitiveAlternative(member)) {
        for (const child of type.members) {
          if (child === undefined) throw "missing union member";
          collect(child);
        }
      } else distinct.push(member);
    }
    for (const member of members) {
      if (member === undefined) throw "missing union member";
      collect(member);
    }
    const unique = distinct;
    const first = unique[0];
    if (first === undefined) throw "nonempty subset invariant";
    if (unique.length === 1) return first;
    const known = unionIndex.find(unique);
    if (known !== undefined) return known;
    return appendType(
      { kind: "union", members: unique },
      node,
      "invalid narrowed type graph",
    );
  }
  function functionOf(
    parameters: readonly number[],
    result: number,
    node: Span,
  ): number {
    const known = internedType("f" + result + "(" + parameters.join(",") + ")");
    if (known >= 0) return known;
    return appendType(
      { kind: "function", parameters: parameters.slice(), result },
      node,
      "invalid callback type graph",
    );
  }
  function neverType(node: Span): number {
    const known = internedType("n");
    return known >= 0
      ? known
      : appendType({ kind: "never" }, node, "invalid never type");
  }
  function arrayOf(element: number, node: Span): number {
    const known = internedType("a" + element);
    if (known >= 0) return known;
    return appendType(
      { kind: "array", element, readonly: false },
      node,
      "invalid inferred array type graph",
    );
  }
  function coveredSwitch(
    node: Statement & { readonly kind: "switch" },
  ): boolean {
    const id = expressions.get(node.expression);
    if (id === undefined) return false;
    const values = new Set<string | number | boolean | undefined>(),
      seen = new Set<number>();
    function collect(id: number): boolean {
      if (seen.has(id)) return true;
      seen.add(id);
      const type = types[id];
      if (type?.kind === "literal") {
        values.add(type.value);
        return true;
      }
      if (type?.kind === "boolean") {
        values.add(false);
        values.add(true);
        return true;
      }
      if (type?.kind === "undefined") {
        values.add(undefined);
        return true;
      }
      return type?.kind === "union" && type.members.every(collect);
    }
    if (!collect(id) || values.size === 0) return false;
    for (const clause of node.clauses) {
      if (clause === undefined) throw "missing switch clause";
      const test = clause.test;
      if (test === undefined) return true;
      const literal = literals.get(ungroup(test));
      if (literal?.kind === "literal") values.delete(literal.value);
      else if (isUndefined(test)) values.delete(undefined);
    }
    return values.size === 0;
  }
  function literalProperty(
    receiver: number,
    name: string,
    node: Span,
  ): number | undefined {
    const members: number[] = [],
      seen = new Set<number>();
    function collect(id: number): boolean {
      if (seen.has(id)) return true;
      seen.add(id);
      const type = types[id];
      if (type?.kind === "union") return type.members.every(collect);
      if (type?.kind !== "object") return false;
      const field = type.properties.find(
        (p) => p !== undefined && p.name === name,
      );
      if (field === undefined || types[field.type]?.kind !== "literal")
        return false;
      if (!members.includes(field.type)) members.push(field.type);
      if (field.optional && !members.includes(undefinedType))
        members.push(undefinedType);
      return true;
    }
    return collect(receiver) && members.length > 0
      ? unionSubset(members, node)
      : undefined;
  }
  function selectedDiscriminants(
    info: { binding: number; property: string },
    selected: readonly {
      type: number;
      tag: number;
      value: string | number | boolean | undefined;
    }[],
    base: Set<number>,
    node: Span,
  ): Set<number> | undefined {
    if (selected.length === 0) return undefined;
    const type = unionSubset(
      selected.map((v) => v.type),
      node,
    );
    const result = new Set(base);
    for (const token of result) {
      const fact = narrowed[token - graph.bindings.length];
      if (
        fact !== undefined &&
        fact.binding === info.binding &&
        (fact.property === undefined ||
          fact.property === factKey(info.property))
      )
        result.delete(token);
    }
    const tagTypes = selected.map((v): number => {
      if (v === undefined) throw "missing selected discriminant";
      return v.tag;
    });
    result.add(narrowToken(info.binding, type));
    result.add(
      narrowToken(
        info.binding,
        unionSubset(tagTypes, node),
        factKey(info.property),
      ),
    );
    return result;
  }
  function refineNullBinding(
    node: Expression,
    truth: boolean,
    base: Set<number>,
  ): Set<number> | undefined {
    if (
      node.kind !== "binary" ||
      (node.operator !== "===" && node.operator !== "!==")
    )
      return undefined;
    const left = ungroup(node.left),
      right = ungroup(node.right);
    const target =
      left.kind === "null" ? right : right.kind === "null" ? left : undefined;
    if (target?.kind !== "identifier") return undefined;
    const binding = references.get(target);
    if (binding === undefined) return undefined;
    const declared = bindingTypes[binding.id];
    if (declared === undefined) return undefined;
    const equal = truth === (node.operator === "==="),
      selected: number[] = [],
      seen = new Set<number>();
    function collect(id: number): void {
      if (seen.has(id)) return;
      seen.add(id);
      const type = types[id];
      if (type?.kind === "union") {
        for (const member of type.members) {
          if (member === undefined) throw "nullable member invariant";
          collect(member);
        }
      } else if ((type?.kind === "null") === equal) selected.push(id);
    }
    collect(narrowedType(binding.id, declared, base));
    if (selected.length === 0) return undefined;
    const result = new Set(base);
    for (const token of result) {
      const fact = narrowed[token - graph.bindings.length];
      if (
        fact !== undefined &&
        fact.binding === binding.id &&
        fact.property === undefined
      )
        result.delete(token);
    }
    result.add(narrowToken(binding.id, unionSubset(selected, node)));
    return result;
  }
  function isErrorKind(kind: string | undefined): boolean {
    return kind === "Error" || kind === "TypeError" || kind === "RangeError";
  }
  function isErrorType(id: number): boolean {
    const type = types[id];
    if (type?.kind === "union") return type.members.every(isErrorType);
    return isErrorKind(type?.kind);
  }
  let instancePropertyNarrowing = false;
  const instanceofTypes = createKeyIndex<Expression, number>(syntaxHash);
  const arrayFlowTypes = createStringIndex<number>();
  function refineInstanceof(
    node: Expression,
    truth: boolean,
    base: Set<number>,
  ): Set<number> | undefined {
    if (node.kind !== "binary" || node.operator !== "instanceof")
      return undefined;
    const candidate = instanceofTypes.get(node);
    const target = stablePath(node.left);
    const binding = target?.binding,
      property = target?.property;
    const declared = expressions.get(node.left);
    if (
      candidate === undefined ||
      binding === undefined ||
      declared === undefined
    )
      return undefined;
    const selected: number[] = [];
    const instance = candidate;
    if (!truth && types[expressions.get(node.right) ?? -1]?.kind === "union")
      return undefined;
    function derived(id: number, base: number): boolean {
      if (id === base) return true;
      const kind = types[id]?.kind,
        baseKind = types[base]?.kind;
      if (isErrorKind(kind) && isErrorKind(baseKind))
        return baseKind === "Error";
      // An empty object (the instance type of a plain callable) never
      // excludes a constituent. Unknown likewise survives the false edge.
      const baseType = types[base];
      if (
        kind === "unknown" ||
        (baseType?.kind === "object" && baseType.properties.length === 0)
      )
        return false;
      const sourceType = types[id];
      if (
        sourceType?.kind === "object" &&
        sourceType.realmConstructor !== true
      ) {
        const name = sourceType.realmLibrary;
        if (name !== undefined) {
          if (
            baseType?.kind === "object" &&
            baseType.realmConstructor !== true &&
            baseType.realmLibrary === name
          )
            return true;
          const entry = realmLibraryConstructor(name);
          if (baseKind === "Error" && entry?.bases.includes("Error") === true)
            return true;
        }
      }
      // Structural compatibility does not establish prototype derivation.
      if (!truth && kind === "object") return false;
      return system.assignable(id, base);
    }
    function collect(id: number): void {
      const type = types[id];
      if (type?.kind === "union") {
        for (const member of type.members) {
          if (member === undefined) throw "instanceof member invariant";
          collect(member);
        }
      } else if (derived(id, instance)) {
        if (truth) selected.push(id);
      } else if (!truth) selected.push(id);
      else if (type?.kind === "unknown" || derived(instance, id))
        selected.push(instance);
    }
    collect(declared);
    if (selected.length === 0) {
      if (!truth && types[declared]?.kind !== "union") return undefined;
      if (truth && types[declared]?.kind === "object") selected.push(candidate);
      else return undefined;
    }
    if (truth && declared !== instance && isArray(instance)) {
      const kind = types[instance]?.kind;
      if (
        kind === "Uint8Array" ||
        kind === "Uint16Array" ||
        kind === "Uint32Array" ||
        kind === "Float64Array"
      ) {
        const known = arrayFlowTypes.get(kind);
        const flow =
          known ??
          appendType(
            { kind, arrayFlow: true },
            node,
            "invalid typed-array flow type",
          );
        arrayFlowTypes.set(kind, flow);
        selected.length = 0;
        selected.push(flow);
      }
    }
    const refined = unionSubset(selected, node);
    if (refined === declared) return undefined;
    const result = new Set(base);
    for (const token of result) {
      const fact = narrowed[token - graph.bindings.length];
      if (
        fact !== undefined &&
        fact.binding === binding.id &&
        fact.property === property
      )
        result.delete(token);
    }
    if (property !== undefined) instancePropertyNarrowing = true;
    result.add(narrowToken(binding.id, refined, property));
    return result;
  }
  const globalConstructors = createStringIndex<number>();
  const libraryInstances = createStringIndex<number>();
  function libraryInstance(name: string, node: Span): number {
    const entry = realmLibraryConstructor(name);
    if (entry === undefined) throw "missing realm library constructor";
    const known = libraryInstances.get(name);
    if (known !== undefined) return known;
    const named = contracts.names.get(entry.instanceName);
    const namedType = named === undefined ? undefined : types[named];
    if (
      named !== undefined &&
      namedType?.kind === "object" &&
      namedType.realmLibrary === name
    )
      return named;
    let instance = realmLibraryType(entry, false);
    if (realmOnlyTypedArrays.includes(name)) {
      const brand = appendType(
        { kind: "literal", value: name },
        node,
        "invalid typed-array brand",
      );
      instance = realmArrayInstance(name, brand);
    } else if (
      name !== "ArrayBuffer" &&
      realmConstructorInstance(name) !== undefined
    ) {
      return primitive(name);
    }
    const id = appendType(instance, node, "invalid library instance type");
    libraryInstances.set(name, id);
    return id;
  }
  function libraryRead(type: Type, name: string, node: Span): number {
    if (type.kind !== "object") throw "realm library object invariant";
    const entry = realmLibraryConstructor(type.realmLibrary ?? "");
    if (entry === undefined) throw "realm library type invariant";
    if (
      type.realmConstructor === true &&
      name === "prototype" &&
      entry.prototype
    ) {
      const instance = libraryInstance(entry.name, node);
      if (types[instance]?.kind === "object") return instance;
    }
    if (type.realmConstructor !== true) {
      for (const member of entry.members) {
        if (member === undefined) throw "realm library member invariant";
        const fields = member.split("|");
        if (fields[0] !== name) continue;
        const result = fields[1];
        if (result !== undefined && result !== "") return primitive(result);
        break;
      }
    }
    return unsupported(
      node,
      "realm-library-member",
      "Realm property " +
        entry.name +
        "." +
        name +
        " has no supported library representation",
      type.realmConstructor !== true,
    );
  }
  function libraryCall(
    type: Type,
    name: string,
    args: readonly Expression[],
    owner: number | undefined,
    node: Span,
  ): number {
    if (type.kind !== "object") throw "realm library object invariant";
    const entry = realmLibraryConstructor(type.realmLibrary ?? "");
    if (entry === undefined) throw "realm library type invariant";
    if (type.realmConstructor !== true) {
      for (const member of entry.members) {
        if (member === undefined) throw "realm library method invariant";
        const fields = member.split("|");
        if (fields[0] !== name) continue;
        if (fields.length <= 2) break;
        const actual: number[] = [];
        for (const arg of args) {
          if (arg === undefined) throw "realm method argument invariant";
          actual.push(expression(arg, owner));
        }
        for (let i = 2; i < fields.length; i++) {
          const signature = fields[i];
          if (signature === undefined)
            throw "realm library signature invariant";
          const parts = signature.split(",");
          if (parts.length !== args.length + 1) continue;
          let matches = true;
          for (let j = 0; j < args.length; j++) {
            const value = actual[j],
              expected = parts[j];
            if (
              value === undefined ||
              expected === undefined ||
              !system.assignable(value, primitive(expected))
            )
              matches = false;
          }
          const result = parts[parts.length - 1];
          if (matches && result !== undefined) return primitive(result);
        }
        return fail(
          node,
          "TYPE_MISMATCH",
          "No pinned library overload matches " + entry.name + "." + name,
          true,
        );
      }
    }
    return unsupported(
      node,
      "realm-library-member",
      "Realm method " +
        entry.name +
        "." +
        name +
        " requires unsupported library signature lowering",
      type.realmConstructor !== true,
    );
  }
  function globalConstructor(name: string, node: Span): number | undefined {
    const known = globalConstructors.get(name);
    if (known !== undefined) return known;
    const entry = realmLibraryConstructor(name);
    if (entry === undefined) return undefined;
    const id = appendType(
      realmLibraryType(entry, true),
      node,
      "invalid library constructor type",
    );
    globalConstructors.set(name, id);
    return id;
  }
  function instanceofCandidate(
    ctor: number,
    operand: number,
    node: Expression,
  ): number | undefined {
    const type = types[ctor];
    if (type?.kind === "union") {
      const candidates: number[] = [];
      let complete = true;
      for (const member of type.members) {
        if (member === undefined)
          throw "instanceof constructor union invariant";
        const candidate = instanceofCandidate(member, operand, node);
        if (candidate === undefined) complete = false;
        else candidates.push(candidate);
      }
      return complete ? unionSubset(candidates, node) : undefined;
    }
    if (type?.kind === "object") {
      const library = type.realmLibrary;
      if (library !== undefined && type.realmConstructor === true) {
        const entry = realmLibraryConstructor(library);
        if (entry === undefined) throw "missing library signature";
        if (entry.construct.length !== 0 || entry.call.length !== 0)
          return libraryInstance(library, node);
      }
      const hook = type.properties.find(
        (property) =>
          property !== undefined &&
          property.hasInstanceSymbol === true &&
          !property.optional,
      );
      const method = hook === undefined ? undefined : types[hook.type];
      if (method?.kind === "function") {
        const args: number[] = [operand];
        const callable = hook?.type;
        if (callable === undefined) throw "hasInstance signature invariant";
        if (!system.call(callable, args, ctor).ok)
          fail(
            node,
            "TYPE_MISMATCH",
            "instanceof operand does not match Symbol.hasInstance parameters",
          );
        if (!system.assignable(method.result, boolean))
          fail(
            node,
            "TYPE_MISMATCH",
            "Symbol.hasInstance must return a boolean",
          );
        const predicate = method.instancePredicate;
        if (predicate !== undefined) return predicate;
      }
      const construct = type.construct;
      const call = type.call;
      if (construct !== undefined || call !== undefined) {
        const prototype = type.properties.find(
          (property) => property?.name === "prototype",
        );
        if (
          prototype !== undefined &&
          types[prototype.type]?.kind !== "unknown"
        )
          return prototype.type;
        const signature =
          construct === undefined ? undefined : types[construct];
        if (signature?.kind === "function") return signature.result;
      }
      if (method?.kind === "function") return undefined;
      if (construct !== undefined || call !== undefined)
        return appendType(
          { kind: "object", properties: [] },
          node,
          "invalid instanceof instance type",
        );
    }
    if (type?.kind === "function")
      return appendType(
        { kind: "object", properties: [] },
        node,
        "invalid instanceof instance type",
      );
    if (type?.kind === "never") return undefined;
    return fail(
      node,
      "TYPE_MISMATCH",
      "instanceof requires a callable, constructible, or Symbol.hasInstance operand",
    );
  }
  function validInstanceofOperand(id: number): boolean {
    const type = types[id];
    if (type?.kind === "union")
      return type.members.some(validInstanceofOperand);
    return (
      type?.kind === "unknown" ||
      type?.kind === "never" ||
      type?.kind === "object" ||
      type?.kind === "array" ||
      type?.kind === "function" ||
      type?.kind === "map" ||
      type?.kind === "set" ||
      type?.kind === "ArrayBuffer" ||
      type?.kind === "SharedArrayBuffer" ||
      type?.kind === "Uint8Array" ||
      type?.kind === "Uint16Array" ||
      type?.kind === "Uint32Array" ||
      type?.kind === "Float64Array" ||
      isErrorKind(type?.kind)
    );
  }
  function generalFact(
    kind: "realm-callable" | "dynamic-result" | "void-value",
    node: Span,
  ): number {
    const known = internedType(kind);
    return known >= 0
      ? known
      : appendType({ kind }, node, "invalid general value fact");
  }
  function refineLiteralBinding(
    node: Expression,
    truth: boolean,
    base: Set<number>,
  ): Set<number> | undefined {
    if (
      node.kind !== "binary" ||
      (node.operator !== "===" && node.operator !== "!==")
    )
      return undefined;
    const left = literals.get(ungroup(node.left)),
      right = literals.get(ungroup(node.right));
    const literal = left ?? right;
    if (literal?.kind !== "literal") return undefined;
    const literalValue = literal.value;
    const literalType = typeOf(literal);
    const compared = ungroup(left === undefined ? node.left : node.right);
    const typeQuery =
      compared.kind === "unary" && compared.operator === "typeof";
    const target =
      compared.kind === "unary" && compared.operator === "typeof"
        ? ungroup(compared.operand)
        : compared;
    let receiver = target;
    let property: string | undefined;
    if (target.kind !== "identifier") {
      if (!typeQuery || literalValue !== "function") return undefined;
      if (target.kind === "member" && !target.optional) {
        receiver = ungroup(target.object);
        property = target.property;
      } else if (target.kind === "index" && !target.optional) {
        receiver = ungroup(target.object);
        property = checkedPropertyName(
          target.index,
          types[expressions.get(target.index) ?? -1],
        );
      }
      if (property === undefined) return undefined;
    }
    const binding = references.get(receiver);
    if (binding === undefined) return undefined;
    const declared = bindingTypes[binding.id];
    if (declared === undefined) return undefined;
    let input = narrowedType(binding.id, declared, base);
    if (property !== undefined) {
      const read = system.property(input, property);
      if (!read.ok) return undefined;
      input = propertyFact(receiver, property, base) ?? read.value;
    }
    const selected: number[] = [],
      seen = new Set<number>();
    const comparison = node;
    const equal = truth === (node.operator === "===");
    function collect(id: number): boolean {
      if (seen.has(id)) return true;
      seen.add(id);
      const type = types[id];
      if (type?.kind === "union") return type.members.every(collect);
      if (typeQuery) {
        if (type?.kind === "unknown" || type?.kind === "dynamic-result") {
          if (!equal) selected.push(id);
          else if (literalValue === "function")
            selected.push(generalFact("realm-callable", comparison));
          else if (literalValue === "number") selected.push(number);
          else if (literalValue === "bigint") selected.push(bigint);
          else if (literalValue === "boolean") selected.push(boolean);
          else if (literalValue === "string") selected.push(string);
          else if (literalValue === "undefined") selected.push(undefinedType);
          else return false;
          return true;
        }
        const tag =
          type?.kind === "literal"
            ? typeof type.value
            : type?.kind === "null" ||
                type?.kind === "array" ||
                type?.kind === "set" ||
                type?.kind === "map" ||
                type?.kind === "ArrayBuffer" ||
                type?.kind === "SharedArrayBuffer" ||
                type?.kind === "Uint8Array" ||
                type?.kind === "Uint16Array" ||
                type?.kind === "Uint32Array" ||
                type?.kind === "Float64Array" ||
                isErrorKind(type?.kind)
              ? "object"
              : type?.kind === "realm-callable"
                ? "function"
                : type?.kind;
        if (
          tag !== "number" &&
          tag !== "boolean" &&
          tag !== "string" &&
          tag !== "bigint" &&
          tag !== "undefined" &&
          tag !== "object" &&
          tag !== "function"
        )
          return false;
        if ((tag === literalValue) === equal) selected.push(id);
        return true;
      }
      if (type?.kind === "unknown") {
        // Equality proves the primitive value; the opposite branch cannot
        // represent unknown-minus-one-literal and must retain unknown.
        selected.push(equal ? literalType : id);
        return true;
      }
      if (type?.kind === "undefined") {
        if (!equal) selected.push(id);
        return true;
      }
      if (
        type?.kind === "string" ||
        type?.kind === "number" ||
        type?.kind === "boolean"
      ) {
        if (equal) {
          if (type.kind === typeof literalValue) selected.push(literalType);
        } else selected.push(id);
        return true;
      }
      if (type?.kind !== "literal") return false;
      if ((type.value === literalValue) === equal) selected.push(id);
      return true;
    }
    if (!collect(input) || selected.length === 0) return undefined;
    const propertyKey = property === undefined ? undefined : factKey(property);
    const result = new Set(base);
    for (const token of result) {
      const fact = narrowed[token - graph.bindings.length];
      if (
        fact !== undefined &&
        fact.binding === binding.id &&
        fact.property === propertyKey
      )
        result.delete(token);
    }
    result.add(
      narrowToken(binding.id, unionSubset(selected, node), propertyKey),
    );
    return result;
  }
  function refineDiscriminant(
    node: Expression,
    truth: boolean,
    base: Set<number>,
  ): Set<number> | undefined {
    node = ungroup(node);
    let target = node,
      value: string | number | boolean | undefined,
      equals = truth;
    if (
      node.kind === "binary" &&
      (node.operator === "===" || node.operator === "!==")
    ) {
      const left = literals.get(ungroup(node.left)),
        right = literals.get(ungroup(node.right));
      const literal = left ?? right;
      if (literal?.kind !== "literal") {
        const a = discriminants(node.left, base),
          b = discriminants(node.right, base);
        if (a === undefined || b === undefined || a.optional || b.optional)
          return undefined;
        const equal = truth === (node.operator === "===");
        const av = new Set(a.variants.map((v) => v.value)),
          bv = new Set(b.variants.map((v) => v.value));
        const selectedA = a.variants.filter((v) =>
          equal ? bv.has(v.value) : bv.size !== 1 || !bv.has(v.value),
        );
        const selectedB = b.variants.filter((v) =>
          equal ? av.has(v.value) : av.size !== 1 || !av.has(v.value),
        );
        const result = selectedDiscriminants(a, selectedA, base, node);
        return result === undefined
          ? undefined
          : selectedDiscriminants(b, selectedB, result, node);
      }
      target = left === undefined ? node.left : node.right;
      value = literal.value;
      equals = truth === (node.operator === "===");
    }
    const info = discriminants(target, base);
    if (info === undefined) return undefined;
    // An optional access produces undefined for an absent receiver. Only
    // refine when that outcome cannot satisfy the selected branch.
    if (info.optional && (value === undefined ? !truth : !equals))
      return undefined;
    const selected = info.variants.filter((v) =>
      value === undefined
        ? !!v.value === truth
        : (v.value === value) === equals,
    );
    return selectedDiscriminants(info, selected, base, node);
  }

  function alternateFacts(
    a: Set<number>,
    b: Set<number>,
    node: Span,
  ): Set<number> {
    const result = intersect(a, b);
    for (const token of a) {
      const left = narrowed[token - graph.bindings.length];
      if (left === undefined) continue;
      for (const other of b) {
        const right = narrowed[other - graph.bindings.length];
        if (
          right === undefined ||
          left.binding !== right.binding ||
          left.property !== right.property
        )
          continue;
        result.delete(token);
        result.delete(other);
        result.add(
          narrowToken(
            left.binding,
            unionSubset([left.type, right.type], node),
            left.property,
          ),
        );
      }
    }
    return result;
  }
  function membershipObject(id: number): boolean {
    const type = types[id];
    if (type?.kind === "union") return type.members.every(membershipObject);
    return type?.kind === "object" || isErrorKind(type?.kind);
  }
  function unknownType(node: Span): number {
    const id = types.findIndex((type) => type?.kind === "unknown");
    return id >= 0
      ? id
      : appendType({ kind: "unknown" }, node, "invalid unknown property type");
  }
  function withPropertyFact(
    base: Set<number>,
    binding: number,
    property: string,
    type: number,
    checkedRead: boolean,
  ): Set<number> {
    const result = new Set(base);
    for (const token of narrowingTokens.get(binding) ?? []) {
      if (token === undefined) throw "property fact invariant";
      if (
        narrowed[token - graph.bindings.length]?.property === factKey(property)
      )
        result.delete(token);
    }
    result.add(narrowToken(binding, type, factKey(property), checkedRead));
    return result;
  }
  function refineIntroducedProperty(
    node: Expression,
    truth: boolean,
    base: Set<number>,
  ): Set<number> | undefined {
    if (
      node.kind !== "binary" ||
      (node.operator !== "===" && node.operator !== "!==")
    )
      return undefined;
    if (truth !== (node.operator === "===")) return undefined;
    const left = literals.get(ungroup(node.left));
    const literal = left ?? literals.get(ungroup(node.right));
    if (literal?.kind !== "literal") return undefined;
    const compared = ungroup(left === undefined ? node.left : node.right);
    const query = compared.kind === "unary" && compared.operator === "typeof";
    const target =
      query && compared.kind === "unary" ? ungroup(compared.operand) : compared;
    if (target.kind !== "member" && target.kind !== "index") return undefined;
    const read = intrinsics.get(target);
    if (read !== "flow-property-read" && read !== "flow-property-read-boxed")
      return undefined;
    const binding = references.get(ungroup(target.object));
    const property =
      target.kind === "member"
        ? target.property
        : checkedPropertyName(
            target.index,
            types[expressions.get(target.index) ?? -1],
          );
    if (
      binding === undefined ||
      property === undefined ||
      propertyFact(target.object, property, base) === undefined
    )
      return undefined;
    const value = literal.value;
    const selected = query
      ? value === "string"
        ? string
        : value === "number"
          ? number
          : value === "boolean"
            ? boolean
            : value === "bigint"
              ? bigint
              : value === "undefined"
                ? undefinedType
                : undefined
      : typeOf(literal);
    return selected === undefined
      ? undefined
      : withPropertyFact(base, binding.id, property, selected, true);
  }
  function refineField(
    node: Expression,
    truth: boolean,
    base: Set<number>,
  ): Set<number> | undefined {
    node = ungroup(node);
    if (
      node.kind !== "binary" ||
      (node.operator !== "===" && node.operator !== "!==")
    )
      return undefined;
    const equality = truth === (node.operator === "===");
    const absentLeft = isUndefined(node.left),
      absentRight = isUndefined(node.right);
    const left = literals.get(ungroup(node.left)),
      right = literals.get(ungroup(node.right));
    const literal = left ?? right;
    if (
      !absentLeft &&
      !absentRight &&
      (literal?.kind !== "literal" || !equality)
    )
      return undefined;
    const target = ungroup(
      absentLeft
        ? node.right
        : absentRight
          ? node.left
          : left === undefined
            ? node.left
            : node.right,
    );
    if (target.kind !== "member" || target.optional) return undefined;
    const binding = references.get(ungroup(target.object));
    if (binding === undefined) return undefined;
    const declared = bindingTypes[binding.id];
    if (declared === undefined) return undefined;
    const objectId = narrowedType(binding.id, declared, base),
      property = target.property;
    const visited = new Set<number>();
    function readonlyField(id: number): boolean {
      if (visited.has(id)) return true;
      visited.add(id);
      const object = types[id];
      if (object?.kind === "union") return object.members.every(readonlyField);
      if (object?.kind !== "object") return false;
      const field = object.properties.find(
        (p) => p !== undefined && p.name === property,
      );
      return field !== undefined && field.readonly;
    }
    if (!readonlyField(objectId)) return undefined;
    const read = system.property(objectId, target.property);
    if (!read.ok) return undefined;
    let exact: number | undefined;
    if (absentLeft || absentRight) {
      if (!system.assignable(undefinedType, read.value)) return undefined;
      exact = equality ? undefinedType : presentType(read.value);
    } else if (literal !== undefined) exact = typeOf(literal);
    const selectedType = exact;
    if (
      selectedType === undefined ||
      !system.assignable(selectedType, read.value)
    )
      return undefined;
    const result = new Set(base);
    for (const token of result) {
      const fact = narrowed[token - graph.bindings.length];
      if (
        fact !== undefined &&
        fact.binding === binding.id &&
        fact.property === factKey(target.property)
      )
        result.delete(token);
    }
    result.add(narrowToken(binding.id, selectedType, factKey(target.property)));
    return result;
  }
  /** Bindings an expression assigns directly (not inside nested
   * functions, whose bindings are captured and so never retain facts across
   * effects), or undefined when a destructuring target hides them. */
  function assignedWithin(node: Expression): Set<number> | undefined {
    return assignedWithinStatement({
      start: node.start,
      end: node.end,
      kind: "expression",
      expression: node,
    });
  }
  /** Bindings a statement assigns directly, as assignedWithin; `var`
   * declarations and for-in/of assignment targets assign too. */
  function assignedWithinStatement(node: Statement): Set<number> | undefined {
    const written = new Set<number>();
    let complete = true;
    function assignTarget(node: Expression): void {
      const target = ungroup(node);
      const binding =
        target.kind === "identifier" ? references.get(target) : undefined;
      if (binding !== undefined) written.add(binding.id);
      else if (target.kind !== "member" && target.kind !== "index")
        complete = false;
    }
    function declare(declaration: VariableBinding): void {
      if (
        declaration.kind === "object-binding" ||
        declaration.kind === "array-binding"
      ) {
        complete = false;
        return;
      }
      const binding = declarations.get(declaration);
      if (binding !== undefined) written.add(binding.id);
    }
    rewriteModule(
      { start: node.start, end: node.end, imports: [], statements: [node] },
      {
        statement: (mapped: Statement, original: Statement): Statement => {
          if (
            original.kind === "for-in-assignment" ||
            original.kind === "for-of-assignment"
          )
            assignTarget(original.target);
          else if (
            (original.kind === "for-in" || original.kind === "for-of") &&
            original.mode === "var"
          )
            declare(original.binding);
          else if (original.kind === "variable" && original.mode === "var")
            for (const declaration of original.declarations) {
              if (declaration === undefined) throw "declaration invariant";
              declare(declaration);
            }
          return mapped;
        },
        expression: (mapped: Expression, original: Expression): Expression => {
          if (
            original.kind === "assignment" ||
            original.kind === "compound" ||
            original.kind === "update"
          )
            assignTarget(original.target);
          return mapped;
        },
      },
    );
    return complete ? written : undefined;
  }
  /** Facts that hold on every entry to a statement that loops or joins
   * several exits (a loop, switch or labelled statement): stableFacts, plus
   * the presence of uncaptured mutable bindings the statement never assigns,
   * which no iteration, call or exit can change. */
  function entryFacts(node: Statement): Set<number> {
    const facts = stableFacts();
    const written = assignedWithinStatement(node);
    if (written === undefined) return facts;
    for (const token of present)
      if (
        token >= 0 &&
        token < graph.bindings.length &&
        graph.bindings[token]?.captured === false &&
        !written.has(token)
      )
        facts.add(token);
    return facts;
  }
  function refine(
    node: Expression,
    truth: boolean,
    base: Set<number>,
    evaluated: Set<number> = base,
  ): Set<number> {
    node = ungroup(node);
    if (node.kind === "unary" && node.operator === "!")
      return refine(node.operand, !truth, base, evaluated);
    if (node.kind === "binary") {
      if (
        truth &&
        node.operator === "in" &&
        intrinsics.get(node) === "dynamic-object-has"
      ) {
        const object = expressions.get(node.right);
        const binding = references.get(ungroup(node.right));
        const keyType = expressions.get(node.left);
        const key = checkedPropertyName(
          node.left,
          keyType === undefined ? undefined : types[keyType],
        );
        if (
          object !== undefined &&
          binding !== undefined &&
          key !== undefined
        ) {
          const targets = dynamicPropertyTargets(object, keyType, key, node);
          const field = targets[0];
          if (field === undefined) throw "dynamic presence field invariant";
          const narrowed = new Set(base);
          narrowed.add(narrowToken(binding.id, field.type, factKey(key)));
          return narrowed;
        }
      }
      if (
        truth &&
        node.operator === "in" &&
        intrinsics.get(node) === "literal-property-has"
      ) {
        const binding = references.get(ungroup(node.right));
        const object = expressions.get(node.right);
        const key = checkedPropertyName(
          node.left,
          types[expressions.get(node.left) ?? -1],
        );
        if (
          binding !== undefined &&
          object !== undefined &&
          key !== undefined
        ) {
          const property = system.property(object, key);
          const existing = propertyFact(node.right, key, base);
          if (existing === undefined)
            return withPropertyFact(
              base,
              binding.id,
              key,
              property.ok ? property.value : unknownType(node),
              !property.ok,
            );
        }
      }
      if (node.operator === "&&")
        return truth
          ? refine(
              node.right,
              true,
              refine(node.left, true, base, evaluated),
              evaluated,
            )
          : alternateFacts(
              refine(node.left, false, base, evaluated),
              refine(
                node.right,
                false,
                refine(node.left, true, base, evaluated),
                evaluated,
              ),
              node,
            );
      if (node.operator === "||")
        return !truth
          ? refine(
              node.right,
              false,
              refine(node.left, false, base, evaluated),
              evaluated,
            )
          : alternateFacts(
              refine(node.left, true, base, evaluated),
              refine(
                node.right,
                true,
                refine(node.left, false, base, evaluated),
                evaluated,
              ),
              node,
            );
    }
    if (!pure(node)) {
      // Evaluation already invalidated unsafe preexisting facts. Only newly
      // reconstructed short-circuit facts need to survive another effect:
      // facts of bindings no closure captures survive calls, except for
      // bindings the operand itself assigns.
      const written = assignedWithin(node);
      const retained = stableFacts(base);
      // stableFacts keeps facts of immutable bindings and narrowed facts of
      // uncaptured bindings; binding facts of uncaptured mutable bindings
      // survive too unless the operand assigns them.
      for (const token of base)
        if (
          token >= 0 &&
          token < graph.bindings.length &&
          graph.bindings[token]?.captured === false &&
          written !== undefined &&
          !written.has(token)
        )
          retained.add(token);
      if (written === undefined || written.size !== 0) {
        const tokens: number[] = [];
        for (const token of retained) tokens.push(token);
        for (const token of tokens) {
          if (token === undefined) throw "refined token invariant";
          let binding: number | undefined = undefined;
          if (token >= 0 && token < graph.bindings.length) binding = token;
          else if (token >= graph.bindings.length)
            binding = narrowed[token - graph.bindings.length]?.binding;
          if (
            binding !== undefined &&
            graph.bindings[binding]?.mutable !== false &&
            (written === undefined || written.has(binding))
          )
            retained.delete(token);
        }
      }
      for (const token of base) if (evaluated.has(token)) retained.add(token);
      return retained;
    }
    const instance = refineInstanceof(node, truth, base);
    if (instance !== undefined) return instance;
    const nullable = refineNullBinding(node, truth, base);
    if (nullable !== undefined) return nullable;
    const literal = refineLiteralBinding(node, truth, base);
    if (literal !== undefined) return literal;
    const tagged = refineDiscriminant(node, truth, base);
    if (tagged !== undefined) return tagged;
    const introduced = refineIntroducedProperty(node, truth, base);
    if (introduced !== undefined) return introduced;
    const field = refineField(node, truth, base);
    if (field !== undefined) return field;
    // Delegated refinements produce their own result. Copy only when this
    // fallback owns the facts it is about to update.
    const result = new Set(base);
    if (node.kind === "binary") {
      if (["===", "!==", "==", "!="].includes(node.operator)) {
        const local = isUndefined(node.left)
          ? ungroup(node.right)
          : isUndefined(node.right)
            ? ungroup(node.left)
            : undefined;
        const b = local === undefined ? undefined : references.get(local);
        if (b !== undefined && presentType(bindingTypes[b.id]) !== undefined) {
          if (truth === (node.operator === "!==" || node.operator === "!="))
            result.add(b.id);
          else result.delete(b.id);
        }
      }
    } else if (node.kind === "identifier" && truth) {
      const b = references.get(node);
      if (b !== undefined && presentType(bindingTypes[b.id]) !== undefined)
        result.add(b.id);
    }
    return result;
  }
  function join(
    a: number,
    b: number,
    node: Span,
    expected?: number,
    preserveShapes: boolean = false,
  ): number {
    if (expected !== undefined) {
      requireType(a, expected, node);
      requireType(b, expected, node);
      return expected;
    }
    // Width subtyping does not prove equal runtime shapes. Preserve both object
    // variants so later spreads cannot silently discard fields from one branch.
    const objectShapes =
      preserveShapes &&
      types[a]?.kind === "object" &&
      types[b]?.kind === "object";
    if (!objectShapes) {
      if (system.assignable(a, b)) {
        recordTypeFlow(a, b, node);
        return b;
      }
      if (system.assignable(b, a)) {
        recordTypeFlow(b, a, node);
        return a;
      }
    } else if (a === b) return a;
    // Preserve the actual alternatives. Numeric literals can both fit an
    // optional number without either branch admitting undefined.
    const members = new Set<number>(),
      visited = new Set<number>();
    function collect(id: number): void {
      if (visited.has(id)) return;
      visited.add(id);
      const type = types[id];
      if (type?.kind === "union") {
        for (const member of type.members) {
          if (member === undefined) throw "missing union member";
          collect(member);
        }
      } else members.add(id);
    }
    collect(a);
    collect(b);
    return unionSubset([...members], node);
  }
  function invalidateCalls(): void {
    if (present === callSafeFacts) return;
    for (const id of present) {
      const fact = narrowed[id - graph.bindings.length];
      if (fact !== undefined) {
        // An observed field value can change through a writable alias even
        // when this view and its binding are readonly. Declared discriminant
        // variants remain stable for const bindings under strict assignment.
        if (
          (fact.property !== undefined && fact.checkedRead !== true) ||
          (graph.bindings[fact.binding]?.mutable !== false &&
            graph.bindings[fact.binding]?.captured !== false)
        )
          present.delete(id);
        continue;
      }
      const b = graph.bindings[id];
      if (b !== undefined && b.mutable && b.captured) present.delete(id);
    }
    callSafeFacts = present;
  }
  function choose(
    expected: number | undefined,
    kind: "object" | "function" | "array",
    node: Expression,
  ): number {
    if (expected === undefined)
      unsupported(
        node,
        "aggregate-inference",
        "object, array and arrow expressions need a contextual or explicit type",
      );
    const t = types[expected];
    if (t?.kind === kind) return expected;
    const choices: number[] = [],
      visited = new Set<number>();
    function candidates(id: number): void {
      if (visited.has(id)) return;
      visited.add(id);
      const candidate = types[id];
      if (candidate?.kind === "union") {
        for (const member of candidate.members) {
          if (member === undefined) throw "missing candidate member";
          candidates(member);
        }
      } else if (
        candidate !== undefined &&
        candidate.kind === kind &&
        !choices.includes(id)
      ) {
        if (candidate.kind === "object" && node.kind === "object") {
          const properties = node.properties;
          const candidateProperties = candidate.properties;
          if (
            candidateProperties.some(
              (p) =>
                p !== undefined &&
                !p.optional &&
                !properties.some(
                  (n) =>
                    n !== undefined && n.kind !== "spread" && n.name === p.name,
                ),
            )
          )
            return;
          for (const property of properties) {
            if (property === undefined) throw "missing object property";
            if (property.kind === "spread")
              unsupported(
                property,
                "aggregate-spread",
                "object spread requires property-copy checking and lowering",
              );
            const field = candidateProperties.find(
              (p) => p !== undefined && p.name === property.name,
            );
            if (field === undefined) return;
            const literal = literals.get(ungroup(property.value));
            if (
              literal !== undefined &&
              !system.assignable(typeOf(literal), field.type)
            )
              return;
          }
        }
        choices.push(id);
      }
    }
    candidates(expected);
    const first = choices[0];
    if (
      first !== undefined &&
      (choices.length === 1 ||
        (kind === "array" &&
          choices.every(
            (id) =>
              id !== undefined &&
              system.assignable(id, first) &&
              system.assignable(first, id),
          )))
    )
      return first;
    return fail(
      node,
      "TYPE_MISMATCH",
      "expected an unambiguous " + kind + " type",
      false,
      fallbackAt(node, "aggregate-inference"),
    );
  }
  function checkFunction(
    node: Span,
    params: readonly Parameter[],
    returnAnnotation: TypeNode | undefined,
    body: Expression | BlockStatement,
    signature: number,
    inferResult: boolean = false,
    inheritStableFacts: boolean = false,
    scriptEntry: true | undefined = undefined,
  ): number {
    const savedFacts = present,
      savedCallSafeFacts = callSafeFacts;
    present = inheritStableFacts ? stableFacts() : new Set<number>();
    try {
      const type = types[signature];
      if (type?.kind !== "function") throw "signature invariant";
      if (params.length !== type.parameters.length)
        fail(node, "ARITY", "parameter count does not match context");
      if ((params[params.length - 1]?.rest === true) !== (type.rest === true))
        fail(
          node,
          "TYPE_MISMATCH",
          "rest parameter layout does not match context",
        );
      const owner = functions.get(node);
      if (owner === undefined) throw "function identity invariant";
      const receiverType = type.receiver;
      if (
        graph.functions[owner]?.receiver === owner &&
        receiverType !== undefined
      ) {
        receiverTypes.set(owner, receiverType);
        const receiverBinding = graph.functions[owner]?.receiverBinding;
        if (receiverBinding !== undefined)
          bindingTypes[receiverBinding] = receiverType;
      }
      for (const p of params) {
        if (p === undefined) throw "missing parameter";
        pendingParameters.add(binding(p).id);
      }
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        const expected: number | undefined = type.parameters[i];
        if (p === undefined || expected === undefined)
          throw "parameter invariant";
        const parameterAnnotation = declared.get(p);
        let actual: number =
          parameterAnnotation === undefined
            ? expected
            : typeOf(parameterAnnotation);
        const b = binding(p);
        if (realmPlan?.bindings.has(b.id)) actual = realmPayload(actual, p);
        const initializer = p.initializer;
        if (initializer === undefined) requireType(expected, actual, p);
        else {
          const defined = presentType(actual) ?? actual;
          if (
            !system.assignable(defined, number) &&
            !system.assignable(defined, string) &&
            !system.assignable(defined, boolean) &&
            !objectElement(defined) &&
            !isList(defined) &&
            !isArray(defined) &&
            types[defined]?.kind !== "set" &&
            types[defined]?.kind !== "map"
          )
            unsupported(
              p,
              "default-parameter-layout",
              "default parameters currently require primitive, object, collection or supported array types",
            );
          requireType(presentType(expected) ?? expected, actual, p);
          const initial = expression(initializer, owner, actual);
          requireType(initial, actual, initializer);
          if (
            parameterAnnotation === undefined &&
            !system.assignable(undefinedType, initial)
          )
            actual = defined;
        }
        bindingTypes[b.id] = actual;
        cell(b, { kind: "initialize", value: actual }, p, owner);
        pendingParameters.delete(b.id);
        if (p.kind === "pattern-parameter") {
          if (p.rest)
            unsupported(
              p,
              "rest-call-layout",
              "destructured rest parameters require rest parameter lowering",
            );
          initializeBindingPattern(
            p.pattern,
            undefined,
            initializer === undefined
              ? actual
              : (presentType(actual) ?? actual),
            owner,
            p,
            undefined,
            false,
            p.type !== undefined,
          );
        }
      }
      let result =
        returnAnnotation === undefined ? type.result : typeOf(returnAnnotation);
      if (realmPlan?.results.has(owner)) result = realmPayload(result, node);
      if (type.result !== voidType) requireType(result, type.result, node);
      bodies.set(owner, {
        node,
        scriptEntry,
        parameters: params,
        body,
        result,
        ...(returnAnnotation !== undefined ? { explicitResult: true } : {}),
      });
      if (body.kind === "block") {
        const returns: number[] = [];
        if (inferResult) inferredReturns.set(owner, returns);
        const completed = statement(body, owner, result);
        if (inferResult) inferredReturns.delete(owner);
        if (inferResult) {
          if (returns.length === 0)
            result = (completed & 1) !== 0 ? voidType : neverType(body);
          else if (returns.every((value) => value === voidType))
            result = voidType;
          else {
            if ((completed & 1) !== 0) returns.push(undefinedType);
            result = unionSubset(
              returns.map((value) =>
                value === voidType ? undefinedType : value,
              ),
              body,
            );
          }
          bodies.set(owner, {
            node,
            scriptEntry,
            parameters: params,
            body,
            result,
          });
        } else if ((completed & 1) !== 0 && result !== voidType) {
          requireType(undefinedType, result, body);
        }
      } else {
        const actual = expression(
          body,
          owner,
          inferResult ? undefined : result,
        );
        if (inferResult) {
          result = actual;
          bodies.set(owner, {
            node,
            scriptEntry,
            parameters: params,
            body,
            result,
          });
        }
        if (result === voidType && types[actual]?.kind === "void-value")
          recordVoidReturn(owner, body);
        requireType(
          actual === undefinedType && result === voidType ? voidType : actual,
          result,
          body,
        );
      }
      return result;
    } finally {
      for (const p of params) {
        if (p === undefined) throw "missing parameter";
        pendingParameters.delete(binding(p).id);
      }
      present = savedFacts;
      callSafeFacts = savedCallSafeFacts;
    }
  }
  function isVoidExpression(type: number): boolean {
    return type === voidType || types[type]?.kind === "void-value";
  }
  function condition(node: Expression, owner: number | undefined): void {
    if (isVoidExpression(expression(node, owner)))
      fail(
        node,
        "TYPE_MISMATCH",
        "void result cannot be tested for truthiness",
      );
  }
  function checkClass(
    node: Statement & { readonly kind: "class" },
    owner: number | undefined,
  ): void {
    if (owner !== undefined)
      fail(
        node,
        "UNSUPPORTED",
        "local classes require scoped contract resolution",
      );
    const contract = classContracts.get(node.definition);
    if (contract === undefined)
      fail(node, "UNSUPPORTED", "class contract is unavailable");
    const required = new Set<ClassElement>(),
      receiverOwners = new Set<number>();
    for (const member of contract.members) {
      if (member === undefined) throw "class member contract invariant";
      const element = member.node;
      const constructor =
        element.kind === "method" &&
        !element.static &&
        literalPropertyName(element.key) === "constructor";
      if (
        element.kind === "field" &&
        !system.assignable(undefinedType, member.type)
      )
        required.add(element);
      if (element.kind === "field" || constructor) {
        const id = functions.get(element);
        if (id !== undefined) receiverOwners.add(id);
      }
    }
    const receivers = new Set<Expression>(),
      constructors = new Set<Expression>();
    const outer = binding(node),
      inner = declarations.get(node.definition);
    for (const reference of graph.receiverReferences) {
      if (reference === undefined) throw "receiver reference invariant";
      const id = reference.owner;
      if (id !== undefined && receiverOwners.has(id))
        receivers.add(reference.node);
    }
    for (const reference of graph.references) {
      if (reference === undefined) throw "reference invariant";
      if (
        reference.binding === outer.id ||
        (inner !== undefined && reference.binding === inner.id)
      )
        constructors.add(reference.node);
    }
    const initialization = checkClassInitialization(
      node.definition,
      required,
      receivers,
      constructors,
    );
    if (initialization !== undefined)
      fail(
        initialization,
        initialization.code,
        initialization.message,
        undefined,
        initialization.code === "UNSUPPORTED"
          ? {
              capability: "class-initialization",
              ownerKind: "class",
              owner: node,
            }
          : undefined,
      );
    cell(
      outer,
      { kind: "initialize", value: contract.constructor },
      node,
      owner,
    );
    if (inner !== undefined)
      cell(
        inner,
        { kind: "initialize", value: contract.constructor },
        node.definition,
        owner,
      );
    for (const member of contract.members) {
      if (member === undefined) throw "class member contract invariant";
      const element = member.node;
      if (element.kind === "field") {
        const initializer = element.initializer;
        if (initializer === undefined) continue;
        const signature = appendType(
          {
            kind: "function",
            parameters: [],
            result: member.type,
            receiver: member.receiver,
          },
          element,
          "invalid field initializer signature",
        );
        checkFunction(element, [], undefined, initializer, signature);
      } else {
        const constructor =
          element.kind === "method" &&
          !element.static &&
          literalPropertyName(element.key) === "constructor";
        let signature = member.type;
        if (constructor) {
          const type = types[signature];
          if (type?.kind !== "function")
            throw "constructor signature invariant";
          signature = appendType(
            { ...type, result: voidType, receiver: member.receiver },
            element,
            "invalid constructor body signature",
          );
        }
        if (element.kind === "static-block")
          fail(
            element,
            "UNSUPPORTED",
            "typed class static blocks require initialization lowering",
          );
        checkFunction(
          element,
          element.parameters,
          element.returnType,
          element.body,
          signature,
        );
      }
    }
  }
  // Live results exclude only the undefined introduced by a skipped chain.
  // Ordinary undefined-valued properties remain part of the live contract.
  const chainValues = createKeyIndex<Expression, number>(syntaxHash),
    chainReceivers = createKeyIndex<Expression, number>(syntaxHash),
    downcasts = createKeyIndex<Expression, number>(syntaxHash),
    dynamicEnrollments = createKeyIndex<Expression, number>(syntaxHash),
    nativeCallableViews = createKeyIndex<Expression, boolean>(syntaxHash),
    nativeListViews = createKeyIndex<Expression, boolean>(syntaxHash),
    nativeRecordViews = createKeyIndex<
      Expression,
      readonly NativeRecordViewField[]
    >(syntaxHash),
    finitePropertyKeys = createKeyIndex<Expression, readonly string[]>(
      syntaxHash,
    );
  /** Types a checked downcast can test at run time: primitives, 1-byte
   * typed arrays, plain object (record) types, and unions of these. */
  function downcastable(type: number): boolean {
    const t = types[type];
    if (t === undefined) return false;
    switch (t.kind) {
      case "number":
      case "string":
      case "boolean":
      case "bigint":
      case "undefined":
      case "null":
      case "Uint8Array":
      case "TypeError":
      case "RangeError":
      case "Error":
        return true;
      case "object":
        return t.call === undefined && t.construct === undefined;
      case "union":
        return t.members.every(
          (member: number | undefined) =>
            member !== undefined && downcastable(member),
        );
      default:
        return false;
    }
  }
  function callReceiverType(input: Expression): number {
    const target = ungroup(input);
    if (target.kind !== "member" && target.kind !== "index")
      return undefinedType;
    const receiver =
      chainReceivers.get(target) ?? expressions.get(target.object);
    if (receiver === undefined) throw "checked receiver invariant";
    return receiver;
  }
  function callArguments(
    node: Expression & { readonly kind: "call" | "new" },
    owner: number | undefined,
    signature: Type & { readonly kind: "function" },
    offset: number = 0,
  ): number[] {
    const start = signature.parameters.length - 1;
    const list =
      signature.rest === true ? signature.parameters[start] : undefined;
    const rest = list === undefined ? undefined : types[list];
    const element = rest?.kind === "array" ? rest.element : undefined;
    if (list !== undefined && element !== undefined) {
      if (!isList(list))
        unsupported(
          node,
          "rest-call-layout",
          "rest parameter requires a supported array layout",
        );
      restCalls.set(node, {
        start,
        list,
        admitsUndefined: system.assignable(undefinedType, element),
      });
    }
    const args: number[] = [];
    for (let i = offset; i < node.arguments.length; i++) {
      const argument = node.arguments[i];
      if (argument === undefined) throw "call argument invariant";
      const position = i - offset;
      if (node.kind === "call" && node.scriptCall === true && position >= 4) {
        expression(argument, owner);
        continue;
      }
      const trailing = element !== undefined && position >= start;
      if (argument.kind !== "spread") {
        args.push(
          expression(
            argument,
            owner,
            trailing ? element : signature.parameters[position],
          ),
        );
        continue;
      }
      if (!trailing || element === undefined)
        unsupported(
          argument,
          "rest-call-layout",
          "spread arguments are only supported in the rest position",
        );
      const source = expression(
        argument.value,
        owner,
        ungroup(argument.value).kind === "array" ? list : undefined,
      );
      const spread = types[source];
      const supplied = isArray(source)
        ? number
        : spread?.kind === "array" &&
            spread.realmArray !== true &&
            isList(source)
          ? spread.element
          : undefined;
      if (supplied === undefined)
        unsupported(
          argument,
          "rest-call-layout",
          "rest spread requires a supported array",
        );
      recordTypeFlow(supplied, element, argument);
      if (!system.assignable(supplied, element))
        fail(
          argument,
          "TYPE_MISMATCH",
          "rest spread element does not match rest parameter",
        );
      args.push(supplied);
    }
    return args;
  }
  function generalCall(
    node: Expression & { readonly kind: "call" },
    owner: number | undefined,
  ): number {
    if (isOptionalChain(node))
      unsupported(
        node,
        "optional-call",
        "general calls through optional chains require reference lowering",
      );
    const unknown = primitive("unknown");
    const list = arrayOf(unknown, node);
    callArguments(node, owner, {
      kind: "function",
      parameters: [list],
      result: unknown,
      rest: true,
    });
    intrinsics.set(node, "general-call");
    invalidateCalls();
    return generalFact("dynamic-result", node);
  }
  function requireForInObject(id: number, node: Span): void {
    if (!dynamicObject(presentType(id, true) ?? id))
      unsupported(
        node,
        "iterable-layout",
        "typed for-in requires a dynamic-key object",
      );
  }
  function realmArray(
    element: number,
    node: Span,
    tupleElements?: readonly number[],
  ): number {
    return appendType(
      {
        kind: "array",
        element,
        readonly: false,
        realmArray: true,
        ...(tupleElements === undefined ? {} : { tupleElements }),
      },
      node,
      "invalid realm array type",
    );
  }
  /** Checks a record field write. Through a union receiver the value must
   * fit every member's declared field type (system.writeProperty), while
   * TypeScript accepts any value of the union's read type. The native write
   * has no per-member run-time check, so a value TypeScript accepts but some
   * member's contract rejects falls back to the general path. */
  function checkFieldWrite(
    target: Span,
    receiver: number,
    name: string,
    value: number,
    message: string,
  ): void {
    const checked = system.writeProperty(receiver, name, value);
    if (checked.ok) return;
    if (
      checked.error === "TYPE_MISMATCH" &&
      types[receiver]?.kind === "union"
    ) {
      const read = system.property(receiver, name);
      if (read.ok && system.assignable(value, read.value))
        unsupported(
          target,
          "union-field-write",
          "a write through a union receiver requires a value of every member's declared field type",
        );
    }
    fail(target, checked.error, message);
  }
  function finiteRecordKeys(
    object: number,
    keyType: number,
  ): readonly string[] | undefined {
    const record = types[object];
    if (
      record?.kind !== "object" ||
      record.stringIndex !== undefined ||
      types[keyType]?.kind !== "union"
    )
      return undefined;
    const keys: string[] = [];
    function collect(id: number): boolean {
      const type = types[id];
      if (type?.kind === "union")
        return type.members.every(
          (member) => member !== undefined && collect(member),
        );
      if (type?.kind !== "literal") return false;
      const value = type.value;
      if (typeof value !== "string") return false;
      if (!keys.includes(value)) keys.push(value);
      return true;
    }
    return collect(keyType) && keys.length > 0 ? keys : undefined;
  }
  function dynamicPropertyTargets(
    object: number,
    key: number | undefined,
    name: string | undefined,
    node: Span,
  ): Property[] {
    const target = types[object];
    if (target?.kind !== "object") throw "dynamic object target invariant";
    const index = target.stringIndex;
    if (index === undefined) throw "dynamic object index invariant";
    const result: Property[] = [];
    const properties = target.properties;
    const fallback: Property = {
      name: "",
      type: index.type,
      optional: true,
      readonly: index.readonly,
    };
    function add(name: string | undefined): void {
      const field =
        name === undefined
          ? undefined
          : properties.find((p) => p !== undefined && p.name === name);
      result.push(field ?? fallback);
    }
    function collect(id: number): void {
      const type = types[id];
      if (type?.kind === "union") {
        for (const member of type.members) {
          if (member === undefined) throw "dynamic key invariant";
          collect(member);
        }
      } else if (type?.kind === "string" || type?.kind === "number")
        add(undefined);
      else if (type?.kind === "literal") {
        const value = type.value;
        if (typeof value === "string") add(value);
        else if (typeof value === "number") add(String(value));
        else
          fail(
            node,
            "TYPE_MISMATCH",
            "dynamic-key object keys must be string or number",
            true,
          );
      } else
        fail(
          node,
          "TYPE_MISMATCH",
          "dynamic-key object keys must be string or number",
          true,
        );
    }
    if (name !== undefined) add(name);
    else if (key !== undefined) collect(key);
    else throw "dynamic key invariant";
    return result;
  }
  function dynamicRead(
    object: number,
    key: number,
    name: string | undefined,
    node: Span,
  ): number {
    const fields = dynamicPropertyTargets(object, key, name, node);
    const readTypes: number[] = [];
    for (const field of fields) {
      if (field === undefined) throw "dynamic property invariant";
      readTypes.push(field.type);
      if (field.optional) readTypes.push(undefinedType);
    }
    return unionSubset(readTypes, node);
  }
  function factKey(property: string): string {
    return String(property.length) + ":" + property;
  }
  function stablePath(
    input: Expression,
  ): { binding: Binding; property?: string } | undefined {
    const node = ungroup(input);
    const binding = references.get(node);
    if (binding !== undefined) return { binding };
    if ((node.kind !== "member" && node.kind !== "index") || node.optional)
      return undefined;
    const parent = stablePath(node.object);
    const name =
      node.kind === "member"
        ? node.property
        : checkedPropertyName(
            node.index,
            types[expressions.get(node.index) ?? -1],
          );
    if (parent === undefined || name === undefined) return undefined;
    return {
      binding: parent.binding,
      property: (parent.property ?? "") + factKey(name),
    };
  }
  function propertyFact(
    receiver: Expression,
    property: string,
    facts: Set<number> = present,
  ): number | undefined {
    const path = instancePropertyNarrowing ? stablePath(receiver) : undefined;
    const binding = path?.binding ?? references.get(ungroup(receiver));
    if (binding === undefined) return undefined;
    const key = (path?.property ?? "") + factKey(property);
    for (const token of facts) {
      const fact = narrowed[token - graph.bindings.length];
      if (
        fact !== undefined &&
        fact.binding === binding.id &&
        fact.property === key
      )
        return fact.type;
    }
    return undefined;
  }
  const realmTypes = new Map<number, number>();
  const convertingRealm = new Set<number>();
  function realmPayload(id: number, node: Span): number {
    if (!aggregatePayload(types, id)) return id;
    const known = realmTypes.get(id);
    if (known !== undefined) return known;
    if (convertingRealm.has(id))
      unsupported(
        node,
        "realm-payload-layout",
        "recursive fixed realm payload types require recursive layout selection",
        true,
      );
    convertingRealm.add(id);
    const type = types[id];
    let result = id;
    if (type?.kind === "array") {
      result = appendType(
        {
          ...type,
          element: realmPayload(type.element, node),
          realmArray: true,
        },
        node,
        "invalid realm array type",
      );
    } else if (type?.kind === "object") {
      const properties: Property[] = [];
      for (const field of type.properties) {
        if (field === undefined) throw "realm property invariant";
        properties.push({ ...field, type: realmPayload(field.type, node) });
      }
      result = appendType(
        { ...type, properties, realmRecord: true },
        node,
        "invalid realm record type",
      );
    } else if (type?.kind === "union") {
      const members: number[] = [];
      for (const member of type.members) {
        if (member === undefined) throw "realm union invariant";
        members.push(realmPayload(member, node));
      }
      result = unionSubset(members, node);
    }
    convertingRealm.delete(id);
    realmTypes.set(id, result);
    return result;
  }
  function dynamicPayloadType(id: number, node: Span): number {
    return realmPlan === undefined ? id : realmPayload(id, node);
  }
  function readDynamicPayload(value: number, node: Expression): number {
    if (realmPlan !== undefined) return realmPayload(value, node);
    if (aggregatePayload(types, value)) {
      realmReads.set(node, true);
      replayRealm = true;
    }
    return value;
  }
  function unaryNumberCallable(value: number): boolean {
    const signature = types[value];
    return (
      signature?.kind === "function" &&
      signature.receiver === undefined &&
      signature.rest !== true &&
      signature.parameters.length === 1 &&
      signature.minimumArguments !== 0 &&
      signature.parameters[0] === number &&
      signature.result === number
    );
  }
  function projectedCallable(node: Expression): boolean {
    const callee = node.kind === "call" ? node.callee : undefined;
    return (
      callee?.kind === "identifier" &&
      callee.name === nativeCallableProjectionAlias
    );
  }
  function checkDynamicPayload(
    value: number,
    node: Expression,
    erased?: number,
  ): void {
    const unsupported = unsupportedDynamicPayload(types, value);
    if (unsupported === undefined) return;
    const erasing = types[erased ?? -1]?.kind === "unknown";
    if (erasing && unaryNumberCallable(value)) {
      nativeCallableViews.set(node, true);
      return;
    }
    const signature = types[value];
    if (erasing) {
      const source = ungroup(node);
      const declaration =
        source.kind === "identifier" ? references.get(source) : undefined;
      if (
        declaration !== undefined &&
        declared.get(declaration.node) !== undefined
      ) {
        if (
          signature?.kind === "array" &&
          signature.element === number &&
          !signature.readonly &&
          signature.tupleElements === undefined
        ) {
          nativeListViews.set(node, true);
          return;
        }
        if (
          signature?.kind === "object" &&
          signature.call === undefined &&
          signature.construct === undefined
        ) {
          const fields: NativeRecordViewField[] = [];
          for (const field of signature.properties) {
            if (field === undefined) throw "native view field invariant";
            const type = types[field.type]?.kind;
            if (
              type !== "number" &&
              type !== "string" &&
              type !== "boolean" &&
              type !== "unknown"
            )
              break;
            fields.push({
              name: field.name,
              type,
              optional: field.optional === true,
              readonly: field.readonly,
            });
          }
          if (fields.length === signature.properties.length) {
            nativeRecordViews.set(node, fields);
            return;
          }
        }
      }
    }
    if (realmPlan === undefined && aggregatePayload(types, value)) {
      realmSinks.set(node, true);
      replayRealm = true;
      return;
    }
    fail(
      node,
      "UNSUPPORTED",
      unsupported.message,
      true,
      fallbackAt(node, unsupported.capability),
    );
  }
  function realmAggregate(id: number): boolean {
    const type = types[id];
    return (
      (type?.kind === "array" && type.realmArray === true) ||
      (type?.kind === "object" && type.realmRecord === true)
    );
  }
  function checkDynamicLiteral(
    node: Expression & { readonly kind: "object" },
    owner: number | undefined,
    context: number,
    open: boolean = false,
  ): void {
    const type = types[context];
    if (type?.kind !== "object") throw "dynamic literal context invariant";
    const own = new Set<string>();
    for (const property of node.properties) {
      if (property === undefined) throw "dynamic literal property invariant";
      if (property.kind === "spread") {
        const source = types[expression(property.value, owner)];
        if (source?.kind === "null" || source?.kind === "undefined") continue;
        const index = type.stringIndex;
        const sourceIndex =
          source?.kind === "object" ? source.stringIndex : undefined;
        if (
          source?.kind !== "object" ||
          sourceIndex === undefined ||
          index === undefined
        )
          unsupported(
            property,
            "aggregate-spread",
            "typed dynamic spread requires a dynamic-key object source",
          );
        requireType(sourceIndex.type, index.type, property);
        for (const field of source.properties) {
          if (field === undefined) throw "dynamic spread field invariant";
          const target = type.properties.find(
            (entry) => entry !== undefined && entry.name === field.name,
          );
          requireType(field.type, target?.type ?? index.type, property);
          if (!field.optional) own.add(field.name);
        }
        continue;
      }
      if (property.accessor !== undefined)
        unsupported(
          property,
          "native-callable-view",
          "typed dynamic object accessors require callable views",
        );
      if (property.prototypeSetter === true) {
        checkDynamicPayload(expression(property.value, owner), property.value);
        continue;
      }
      const key = property.keyExpression;
      const name = key === undefined ? property.name : undefined;
      const keyType = key === undefined ? undefined : expression(key, owner);
      const known =
        key === undefined
          ? name
          : checkedPropertyName(
              key,
              keyType === undefined ? undefined : types[keyType],
            );
      const fields = dynamicPropertyTargets(context, keyType, known, property);
      const first = fields[0];
      if (first === undefined) throw "dynamic literal field invariant";
      const value = expression(
        property.value,
        owner,
        dynamicPayloadType(first.type, property.value),
      );
      checkDynamicPayload(value, property.value, first.type);
      for (const field of fields) {
        if (field === undefined) throw "dynamic literal field invariant";
        if (
          !system.assignable(
            value,
            dynamicPayloadType(field.type, property.value),
          )
        )
          fail(
            property.value,
            "TYPE_MISMATCH",
            "dynamic-key object property value does not match its declared type",
            true,
          );
      }
      if (known !== undefined) own.add(known);
    }
    for (const field of type.properties) {
      if (field === undefined) throw "dynamic literal field invariant";
      if (!field.optional && !own.has(field.name))
        fail(
          node,
          "PROPERTY",
          "missing required dynamic-key object property " + field.name,
          true,
        );
    }
    intrinsics.set(
      node,
      open ? "dynamic-object-open-literal" : "dynamic-object-literal",
    );
  }
  const voidValueCalls = createKeyIndex<Expression, boolean>(syntaxHash);
  const voidValueReturns = new Set<number>();
  const voidReturnCallers = new Map<number, number[]>();
  const functionIdsByBinding = new Map<number, number>();
  for (const fn of graph.functions) {
    if (fn === undefined) throw "callback function invariant";
    const b = declarations.get(fn.node);
    if (b?.kind === "function") functionIdsByBinding.set(b.id, fn.id);
  }
  function recordVoidReturn(
    owner: number,
    input: Expression | undefined,
  ): void {
    if (input === undefined) return;
    const node = ungroup(input);
    if (node.kind === "call") {
      const target = ungroup(node.callee);
      const b = references.get(target);
      const source =
        b === undefined ? undefined : functionIdsByBinding.get(b.id);
      if (source !== undefined) {
        let callers = voidReturnCallers.get(source);
        if (callers === undefined) {
          callers = [];
          voidReturnCallers.set(source, callers);
        }
        callers.push(owner);
        return;
      }
      const builtin = intrinsics.get(node);
      if (builtin !== undefined && builtin !== "function-call") return;
    }
    voidValueReturns.add(owner);
  }
  function propagateVoidReturns(): void {
    const queue: number[] = [];
    for (const id of voidValueReturns) {
      if (id === undefined) throw "void result source invariant";
      queue.push(id);
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (id === undefined) throw "void result queue invariant";
      for (const caller of voidReturnCallers.get(id) ?? []) {
        if (caller === undefined) throw "void result caller invariant";
        if (voidValueReturns.has(caller)) continue;
        voidValueReturns.add(caller);
        queue.push(caller);
      }
    }
  }
  function expression(
    input: Expression,
    owner: number | undefined,
    inputExpected?: number,
    preserveContext: boolean = false,
    discarded: boolean = false,
  ): number {
    const node = input;
    const fromPattern = patternValues.get(node);
    if (fromPattern !== undefined) return fromPattern;
    // unknown constrains assignability but supplies no contextual shape.
    const selected = realmPlan?.literals.has(node) === true;
    const expected =
      inputExpected === undefined || types[inputExpected]?.kind === "unknown"
        ? undefined
        : selected
          ? realmPayload(inputExpected, node)
          : inputExpected;
    contextualProofs.delete(node);
    if (++depth > 256)
      fail(node, "LIMIT", "closure checking nesting limit exceeded");
    try {
      let result: number;
      let skipped: Set<number> | undefined;
      function chainReceiver(input: Expression, optional: boolean): number {
        const full = expression(input, owner);
        let live = chainValues.get(input) ?? full;
        if (chainValues.has(input)) skipped = new Set(present);
        if (
          optional &&
          (system.assignable(undefinedType, live) ||
            system.assignable(nullType, live))
        ) {
          skipped = new Set(present);
          live = presentType(live, true) ?? live;
        }
        chainReceivers.set(node, live);
        return live;
      }
      switch (node.kind) {
        case "spread":
          return unsupported(
            node,
            "rest-call-layout",
            "spread arguments are only supported in the rest position",
          );
        case "private-in":
          return fail(
            node,
            "UNSUPPORTED",
            "typed private brand checks require private layouts",
          );
        case "new-target":
          return unsupported(
            node,
            "lexical-receiver",
            "typed new.target requires constructor context support",
          );
        case "super":
          return unsupported(
            node,
            "lexical-receiver",
            "typed super references require class receiver support",
          );
        case "this": {
          const receiverOwner =
            owner === undefined ? undefined : graph.functions[owner]?.receiver;
          if (receiverOwner === undefined) result = undefinedType;
          else {
            const receiver = receiverTypes.get(receiverOwner);
            if (receiver === undefined)
              unsupported(
                node,
                "lexical-receiver",
                "receiver-aware native calls require a receiver annotation or context",
              );
            result = receiver;
          }
          break;
        }
        case "null":
          result = nullType;
          break;
        case "number":
          result = number;
          break;
        case "boolean":
          result = boolean;
          break;
        case "string":
          result = string;
          break;
        case "bigint":
          result = bigint;
          break;
        case "identifier": {
          const b = references.get(node);
          if (b === undefined) {
            if (numericConstant("", node.name) !== undefined) {
              result = number;
              intrinsics.set(node, "numeric-constant");
              break;
            }
            if (node.name === "undefined") {
              result = undefinedType;
              break;
            }
            const constructor = globalConstructor(node.name, node);
            if (constructor !== undefined) {
              intrinsics.set(node, "realm-global");
              result = constructor;
              break;
            }
            if (installedNonConstructorGlobals.includes(node.name))
              unsupported(node, "realm-library-global", "unsupported global");
            return fail(node, "UNSUPPORTED", "unsupported global");
          } else {
            const declared = cell(b, { kind: "read" }, node, owner);
            result = narrowedType(b.id, declared, present);
          }
          break;
        }
        case "satisfies": {
          const constraint = typeOf(node.type);
          result = expression(
            node.expression,
            owner,
            types[constraint]?.kind === "unknown" ? undefined : constraint,
            true,
          );
          if (
            node.assertion === "as" &&
            dynamicObject(presentType(constraint, true) ?? constraint) &&
            (types[result]?.kind === "unknown" ||
              system.assignable(result, constraint))
          ) {
            intrinsics.set(node, "dynamic-object-enroll");
            result = constraint;
            break;
          }
          const target = types[constraint];
          if (
            node.assertion === "as" &&
            types[result]?.kind === "unknown" &&
            target?.kind === "object" &&
            target.iteratorElement !== undefined
          ) {
            result = constraint;
            break;
          }
          // `x as T` from unknown is a checked downcast (an explicit
          // contract): the value is tested at run time and a mismatch
          // throws a TypeError.
          if (
            node.assertion === "as" &&
            types[result]?.kind === "unknown" &&
            types[constraint]?.kind !== "unknown" &&
            downcastable(constraint)
          ) {
            downcasts.set(node, constraint);
            result = constraint;
            break;
          }
          requireType(
            contextualProofs.get(node.expression) ?? result,
            constraint,
            node,
          );
          // An upcast (proven above) has the asserted type; `x!` and
          // `as const` assert `unknown` and keep the operand's type.
          if (
            node.assertion === "as" &&
            types[constraint]?.kind !== "unknown"
          ) {
            result = constraint;
            const proof = contextualProofs.get(node.expression);
            if (proof !== undefined) contextualProofs.set(node, proof);
          }
          break;
        }
        case "group":
          result = expression(
            node.expression,
            owner,
            expected,
            preserveContext,
            discarded,
          );
          const proof = contextualProofs.get(node.expression);
          if (proof !== undefined) contextualProofs.set(node, proof);
          break;
        case "tagged-template":
          return unsupported(
            node,
            "template-call",
            "typed template tag calls are not implemented",
          );
        case "template-expression":
          for (const substitution of node.substitutions) {
            if (substitution === undefined)
              throw "TEMPLATE_SUBSTITUTION_INVARIANT";
            const input = expression(substitution, owner);
            if (
              ![number, string, boolean, undefinedType, nullType, bigint].some(
                (type) => system.assignable(input, type),
              )
            )
              unsupported(
                substitution,
                "template-call",
                "typed templates require fixed primitive substitution types",
              );
          }
          result = string;
          break;
        case "array": {
          function elementType(element: Expression, context?: number): number {
            if (element.kind === "elision") return undefinedType;
            if (element.kind !== "spread")
              return expression(element, owner, context, preserveContext);
            const iterable = expression(element.value, owner);
            const type = types[iterable];
            if (
              type?.kind === "set" &&
              (system.assignable(type.element, number) ||
                system.assignable(type.element, string))
            )
              return type.element;
            if (isArray(iterable)) return number;
            if (isList(iterable)) {
              if (context !== undefined && expected !== undefined) {
                const item = listIterationElement(iterable, element);
                if (
                  system.assignable(item, number) &&
                  system.assignable(context, number)
                )
                  return item;
              }
              return listReadType(iterable, element);
            }
            unsupported(
              element,
              "iterable-layout",
              "array spread requires a supported array until general iterable lowering is available",
            );
          }
          let context = expected,
            firstType: number | undefined;
          const first = node.elements.find(
            (element) => element !== undefined && element.kind !== "elision",
          );
          const hasHoles = node.elements.some(
            (element) => element !== undefined && element.kind === "elision",
          );
          if (context === undefined && first === undefined && hasHoles)
            context = arrayOf(undefinedType, node);
          if (preserveContext && context === undefined && first === undefined)
            context = arrayOf(neverType(node), node);
          if (context === undefined && first !== undefined) {
            firstType = elementType(first);
            if (system.assignable(firstType, number))
              context = typeOf(numericListAnnotation);
            else if (system.assignable(firstType, optionalNumber))
              context = typeOf(optionalNumericListAnnotation);
            else if (system.assignable(firstType, string))
              context = typeOf(stringListAnnotation);
            else if (
              system.assignable(firstType, boolean) ||
              types[firstType]?.kind === "void-value"
            )
              context = arrayOf(firstType, first);
            else if (
              system.assignable(presentType(firstType) ?? firstType, string) ||
              listReferenceElement(presentType(firstType) ?? firstType)
            )
              context = arrayOf(firstType, first);
            else
              unsupported(
                first,
                "aggregate-inference",
                "array elements require an explicit supported context",
              );
          }
          result = choose(context, "array", node);
          if (expected === undefined && hasHoles) {
            const inferred = types[result];
            if (inferred?.kind !== "array") throw "array inference invariant";
            result = arrayOf(
              unionSubset([inferred.element, undefinedType], node),
              node,
            );
          }
          let array = types[result];
          if (array?.kind !== "array") throw "array context invariant";
          const inferredElements: number[] = [];
          for (let i = 0; i < node.elements.length; i++) {
            const element = node.elements[i];
            if (element === undefined) throw "array element invariant";
            const actual =
              element === first && firstType !== undefined
                ? firstType
                : elementType(element, array.element);
            const actualPresent = presentType(actual);
            if (
              expected === undefined &&
              actualPresent !== undefined &&
              system.assignable(actualPresent, array.element) &&
              system.assignable(array.element, actualPresent)
            ) {
              result = arrayOf(
                unionSubset([array.element, undefinedType], element),
                element,
              );
              array = types[result];
              if (array?.kind !== "array") throw "array context invariant";
            }
            requireType(
              preserveContext
                ? (contextualProofs.get(element) ?? actual)
                : actual,
              array.element,
              element,
            );
            if (preserveContext) inferredElements.push(actual);
          }
          if (preserveContext) {
            contextualProofs.set(node, result);
            const element =
              inferredElements.length === 0
                ? neverType(node)
                : unionSubset(inferredElements, node);
            result = arrayOf(element, node);
          }
          break;
        }
        case "object": {
          const contextType =
            expected === undefined ? undefined : types[expected];
          const dynamicContext =
            contextType?.kind === "union" &&
            contextType.members.some(
              (member) => member !== undefined && dynamicObject(member),
            )
              ? (presentType(expected, true) ?? expected)
              : expected;
          if (dynamicContext !== undefined && dynamicObject(dynamicContext)) {
            checkDynamicLiteral(node, owner, dynamicContext, preserveContext);
            result = dynamicContext;
            break;
          }
          if (
            expected === undefined &&
            node.properties.some(
              (p) =>
                p.kind !== "spread" &&
                (p.keyExpression !== undefined || p.prototypeSetter === true),
            )
          ) {
            const unknown = appendType(
              { kind: "unknown" },
              node,
              "invalid dynamic object value type",
            );
            result = appendType(
              {
                kind: "object",
                properties: [],
                stringIndex: {
                  type: unknown,
                  readonly: false,
                  origin: "signature",
                },
              },
              node,
              "invalid dynamic object type",
            );
            checkDynamicLiteral(node, owner, result, true);
            break;
          }
          if (
            node.properties.some(
              (p) =>
                p.kind !== "spread" &&
                (p.keyExpression !== undefined || p.prototypeSetter === true),
            )
          )
            unsupported(
              node,
              "aggregate-inference",
              "dynamic object literal requires an indexed object context",
            );
          if (
            node.properties.some(
              (p) => p.kind !== "spread" && p.accessor !== undefined,
            )
          )
            fail(
              node,
              "UNSUPPORTED",
              "typed object accessors require accessor layout support",
              false,
              {
                capability: "object-accessor-layout",
                ownerKind: owner === undefined ? "module" : "function",
                owner:
                  owner === undefined
                    ? node
                    : (graph.functions[owner]?.node ?? node),
              },
            );
          const hasSpread = node.properties.some((p) => p.kind === "spread");
          if (types[expected ?? -1]?.kind === "Error") {
            // Keep the actual record shape, even when the context is Error.
            // Its optional stack may be absent and its identity is observable.
            const actual = expression(node, owner, undefined, preserveContext);
            requireType(actual, primitive("Error"), node);
            result = actual;
            break;
          }
          if (expected === undefined || hasSpread || preserveContext) {
            const contexts: number[] = [];
            const visited = new Set<number>();
            function collectContext(id: number): void {
              if (visited.has(id)) return;
              visited.add(id);
              const type = types[id];
              if (type?.kind === "union") {
                for (const member of type.members) {
                  if (member === undefined) throw "missing context member";
                  collectContext(member);
                }
              } else if (type?.kind === "object") contexts.push(id);
            }
            if (expected !== undefined) collectContext(expected);
            if (expected !== undefined && contexts.length === 0)
              fail(
                node,
                "TYPE_MISMATCH",
                "object literal requires an object context",
              );
            let variants: { fields: Map<string, Property> }[] = [
              { fields: new Map<string, Property>() },
            ];
            function merge(
              fields: Map<string, Property>,
              field: Property,
            ): void {
              const prior = fields.get(field.name);
              const type =
                prior !== undefined &&
                field.optional === true &&
                prior.type !== field.type
                  ? unionSubset([prior.type, field.type], node)
                  : field.type;
              fields.set(field.name, {
                name: field.name,
                type,
                readonly: false,
                optional:
                  field.optional === true &&
                  (prior === undefined || prior.optional === true),
              });
            }
            for (const inputProperty of node.properties) {
              if (inputProperty === undefined) throw "missing object property";
              const property = inputProperty;
              if (property.kind === "spread") {
                const sources: number[] = [];
                const seen = new Set<number>();
                function collectSource(id: number): void {
                  if (seen.has(id)) return;
                  seen.add(id);
                  const source = types[id];
                  if (source?.kind === "union") {
                    for (const member of source.members) {
                      if (member === undefined) throw "spread member invariant";
                      collectSource(member);
                    }
                  } else if (source?.kind === "object") sources.push(id);
                  else
                    unsupported(
                      property,
                      "aggregate-spread",
                      "object spread requires finite object source variants",
                    );
                }
                collectSource(
                  expression(property.value, owner, undefined, true),
                );
                if (
                  sources.length === 0 ||
                  variants.length * sources.length > 256
                )
                  fail(
                    property,
                    "LIMIT",
                    "object spread variant limit exceeded",
                  );
                const expanded: { fields: Map<string, Property> }[] = [];
                for (const variant of variants) {
                  if (variant === undefined) throw "spread variant invariant";
                  for (const id of sources) {
                    if (id === undefined) throw "spread source invariant";
                    const source = types[id];
                    if (source?.kind !== "object")
                      throw "spread source invariant";
                    const fields = new Map<string, Property>();
                    for (const [name, field] of variant.fields)
                      fields.set(name, field);
                    for (const field of source.properties) {
                      if (field === undefined)
                        throw "spread property invariant";
                      merge(fields, field);
                    }
                    expanded.push({ fields });
                  }
                }
                variants = expanded;
              } else {
                if (
                  !hasSpread &&
                  variants.some(
                    (variant) =>
                      variant !== undefined &&
                      variant.fields.has(property.name),
                  )
                )
                  fail(property, "PROPERTY", "duplicate object property");
                const fieldTypes = new Set<number>();
                for (const id of contexts) {
                  if (id === undefined) throw "missing object context";
                  const context = types[id];
                  if (context?.kind !== "object")
                    throw "object context invariant";
                  const field = context.properties.find(
                    (p) => p !== undefined && p.name === property.name,
                  );
                  if (field !== undefined) fieldTypes.add(field.type);
                }
                const fieldType =
                  fieldTypes.size === 0
                    ? undefined
                    : unionSubset([...fieldTypes], property);
                const supplied = expression(
                  property.value,
                  owner,
                  fieldType,
                  preserveContext,
                );
                for (const variant of variants) {
                  if (variant === undefined) throw "spread variant invariant";
                  merge(variant.fields, {
                    name: property.name,
                    type: supplied,
                    readonly: false,
                  });
                }
              }
            }
            if (hasSpread && expected === undefined && variants.length > 1) {
              // Alternatives differing only in field presence share one optional
              // shape. Conflicting field types retain their correlated variants.
              const merged = new Map<string, Property>();
              let compatible = true;
              for (const variant of variants) {
                if (variant === undefined) throw "spread variant invariant";
                for (const [name, field] of variant.fields) {
                  const prior = merged.get(name);
                  if (prior !== undefined && prior.type !== field.type)
                    compatible = false;
                  merged.set(name, field);
                }
              }
              if (compatible) {
                for (const [name, field] of merged) {
                  const optional = variants.some((variant) => {
                    if (variant === undefined) throw "spread variant invariant";
                    const property = variant.fields.get(name);
                    return property === undefined || property.optional === true;
                  });
                  merged.set(name, { ...field, optional });
                }
                variants = [{ fields: merged }];
              }
            }
            const results: number[] = [],
              proofs: number[] = [];
            for (const variant of variants) {
              if (variant === undefined) throw "spread variant invariant";
              const properties: Property[] = [];
              for (const [name, field] of variant.fields)
                properties.push(field);
              if (expected !== undefined) {
                const validated =
                  preserveContext && !hasSpread
                    ? properties.map((field): Property => {
                        const source = node.properties.find(
                          (property) =>
                            property !== undefined &&
                            property.kind !== "spread" &&
                            property.name === field.name,
                        );
                        const proof =
                          source === undefined
                            ? undefined
                            : contextualProofs.get(source.value);
                        return proof === undefined
                          ? field
                          : { ...field, type: proof };
                      })
                    : properties;
                const matches = contexts.filter(
                  (id) => id !== undefined && system.object(id, validated).ok,
                );
                const match = matches[0];
                if (matches.length !== 1 || match === undefined)
                  fail(
                    node,
                    "TYPE_MISMATCH",
                    "each object variant requires one compatible context variant",
                  );
                proofs.push(match);
                results.push(
                  preserveContext
                    ? appendType(
                        { kind: "object", properties },
                        node,
                        "invalid inferred object type graph",
                      )
                    : match,
                );
              } else {
                results.push(
                  appendType(
                    { kind: "object", properties },
                    node,
                    "invalid inferred object type graph",
                  ),
                );
              }
            }
            result = unionSubset(results, node);
            if (preserveContext && proofs.length > 0)
              contextualProofs.set(node, unionSubset(proofs, node));
            break;
          }
          result = choose(expected, "object", node);
          const context = types[result];
          if (context?.kind !== "object") throw "object context invariant";
          const values = node.properties.map((inputProperty): ObjectValue => {
            if (inputProperty === undefined) throw "missing object property";
            const p = inputProperty;
            if (p.kind === "spread")
              unsupported(
                p,
                "aggregate-spread",
                "object spread requires property-copy checking and lowering",
              );
            const field = context.properties.find(
              (field) => field !== undefined && field.name === p.name,
            );
            if (field === undefined)
              fail(p, "PROPERTY", "unknown object property");
            return {
              name: p.name,
              type: expression(p.value, owner, field.type),
            };
          });
          const checked = system.object(result, values);
          if (!checked.ok)
            fail(node, checked.error, "object does not match its context");
          break;
        }
        case "function-expression":
        case "arrow": {
          const own = signatures.get(node);
          result = choose(
            expected ?? (own === undefined ? undefined : typeOf(own)),
            "function",
            node,
          );
          if (
            node.kind === "function-expression" &&
            node.receiver !== undefined
          ) {
            const signature = types[result];
            if (signature?.kind !== "function")
              throw "receiver signature invariant";
            result = appendType(
              { ...signature, receiver: typeOf(node.receiver) },
              node,
              "invalid receiver signature",
            );
          }
          const signature = types[result];
          if (signature?.kind !== "function")
            throw "callback signature invariant";
          const infer =
            node.returnType === undefined && signature.result === voidType;
          const returned = checkFunction(
            node,
            node.parameters,
            node.returnType,
            node.body,
            result,
            infer,
            true,
            node.kind === "arrow" ? node.scriptEntry : undefined,
          );
          if (signature.result === voidType && returned !== voidType)
            result = appendType(
              { ...signature, result: returned },
              node,
              "invalid callback result signature",
            );
          break;
        }
        case "member": {
          const receiver = ungroup(node.object);
          if (
            receiver.kind === "identifier" &&
            !references.has(receiver) &&
            numericConstant(receiver.name, node.property) !== undefined
          ) {
            result = number;
            intrinsics.set(node, "numeric-constant");
            break;
          }
          const obj = chainReceiver(node.object, node.optional === true);
          const library = types[obj];
          if (
            library?.kind === "object" &&
            library.realmLibrary !== undefined
          ) {
            if (node.optional === true || skipped !== undefined)
              unsupported(
                node,
                "optional-call",
                "Optional realm library property access requires optional chain lowering",
                true,
              );
            intrinsics.set(node, "realm-library-read");
            result = libraryRead(library, node.property, node);
            break;
          }
          if (
            isErrorType(obj) &&
            (node.property === "message" ||
              node.property === "name" ||
              node.property === "stack")
          ) {
            intrinsics.set(node, "error-property");
            result =
              node.property === "stack"
                ? unionSubset([string, undefinedType], node)
                : string;
            break;
          }
          const objectType = types[obj];
          if (objectType?.kind === "array" && objectType.realmArray === true) {
            if (node.property !== "length")
              unsupported(
                node,
                "realm-library-member",
                "realm array member requires typed array method lowering",
              );
            intrinsics.set(node, "dynamic-object-read");
            result = number;
            break;
          }
          const viewRead = viewAccess(
            node,
            obj,
            node.property,
            undefined,
            false,
          );
          if (viewRead !== undefined) {
            result = viewUseType(viewRead, node);
            break;
          }
          if (
            (types[obj]?.kind === "set" || types[obj]?.kind === "map") &&
            node.property === "size"
          ) {
            intrinsics.set(
              node,
              types[obj]?.kind === "map" ? "map-size" : "set-size",
            );
            result = number;
            break;
          }
          if (system.assignable(obj, string) && node.property === "length") {
            intrinsics.set(node, "string-length");
            result = number;
            break;
          }
          if (
            (types[obj]?.kind === "ArrayBuffer" ||
              types[obj]?.kind === "SharedArrayBuffer") &&
            node.property === "byteLength"
          ) {
            intrinsics.set(node, "array-buffer-byte-length");
            result = number;
            break;
          }
          if (
            isArray(obj) &&
            ["buffer", "byteOffset", "byteLength"].includes(node.property)
          ) {
            intrinsics.set(
              node,
              node.property === "buffer"
                ? "array-buffer"
                : node.property === "byteOffset"
                  ? "array-byte-offset"
                  : "array-byte-length",
            );
            result =
              node.property === "buffer" ? primitive("ArrayBuffer") : number;
            break;
          }
          if ((isArray(obj) || isList(obj)) && node.property === "length") {
            intrinsics.set(node, isList(obj) ? "list-length" : "array-length");
            result = number;
            break;
          }
          if (dynamicObject(obj) || realmAggregate(obj))
            intrinsics.set(node, "dynamic-object-read");
          const literal = literalProperty(obj, node.property, node);
          const p = system.property(obj, node.property);
          const fact = propertyFact(receiver, node.property);
          if (!p.ok) {
            if (fact === undefined)
              fail(
                node,
                p.error,
                "invalid property read",
                false,
                types[obj]?.kind === "union"
                  ? fallbackAt(node, "union-member-narrowing")
                  : undefined,
              );
            intrinsics.set(
              node,
              types[inputExpected ?? -1]?.kind === "unknown"
                ? "flow-property-read-boxed"
                : "flow-property-read",
            );
            result = fact;
          } else result = fact ?? literal ?? p.value;
          if (dynamicObject(obj)) result = readDynamicPayload(result, node);
          break;
        }
        case "index": {
          const object = chainReceiver(node.object, node.optional === true);
          const keyType = expression(node.index, owner),
            property = checkedPropertyName(node.index, types[keyType]);
          const objectType = types[object];
          if (
            objectType?.kind === "object" &&
            objectType.realmLibrary !== undefined
          )
            unsupported(
              node,
              "realm-library-member",
              "Realm indexed read on " +
                objectType.realmLibrary +
                " requires library index lowering",
              true,
            );
          if (objectType?.kind === "array" && objectType.realmArray === true) {
            intrinsics.set(node, "dynamic-object-read");
            if (property === "length") result = number;
            else {
              requireType(keyType, number, node.index);
              const tuple = objectType.tupleElements;
              if (tuple !== undefined && property !== undefined) {
                const position = tuple[Number(property)];
                if (position === undefined)
                  fail(node, "PROPERTY", "tuple position does not exist", true);
                result = position;
              } else
                result = unionSubset([objectType.element, undefinedType], node);
            }
            break;
          }
          if (dynamicObject(object)) {
            intrinsics.set(node, "dynamic-object-read");
            const fact =
              property === undefined
                ? undefined
                : propertyFact(node.object, property);
            result = readDynamicPayload(
              fact ?? dynamicRead(object, keyType, property, node),
              node,
            );
            break;
          }
          if (property !== undefined && !system.property(object, property).ok) {
            const fact = propertyFact(node.object, property);
            if (fact !== undefined) {
              intrinsics.set(
                node,
                types[inputExpected ?? -1]?.kind === "unknown"
                  ? "flow-property-read-boxed"
                  : "flow-property-read",
              );
              result = fact;
              break;
            }
          }
          const viewRead = viewAccess(node, object, property, keyType, false);
          if (viewRead !== undefined) {
            result = viewUseType(viewRead, node);
            break;
          }
          if (
            property === "length" &&
            (isList(object) ||
              isArray(object) ||
              system.assignable(object, string))
          ) {
            intrinsics.set(
              node,
              isList(object)
                ? "list-length"
                : isArray(object)
                  ? "array-length"
                  : "string-length",
            );
            result = number;
            break;
          }
          if (system.assignable(object, string)) {
            requireType(keyType, number, node.index);
            intrinsics.set(node, "string-read");
            result = unionSubset([string, undefinedType], node);
            break;
          }
          if (!isList(object) && !isArray(object) && property !== undefined) {
            const read = system.property(object, property);
            if (!read.ok)
              fail(node, read.error, "invalid literal property read");
            intrinsics.set(
              node,
              realmAggregate(object) ? "dynamic-object-read" : "record-read",
            );
            result = propertyFact(node.object, property) ?? read.value;
            break;
          }
          const finite = finiteRecordKeys(object, keyType);
          if (finite !== undefined) {
            const reads: number[] = [];
            for (const name of finite) {
              if (name === undefined) throw "finite record key invariant";
              const read = system.property(object, name);
              if (!read.ok)
                fail(
                  node,
                  read.error,
                  "invalid finite record property read",
                  true,
                );
              reads.push(read.value);
            }
            if (realmAggregate(object))
              intrinsics.set(node, "dynamic-object-read");
            else finitePropertyKeys.set(node, finite);
            result = unionSubset(reads, node);
            break;
          }
          if (!isList(object)) requireArray(object, node.object);
          requireType(keyType, number, node.index);
          intrinsics.set(node, isList(object) ? "list-read" : "array-read");
          result = isList(object)
            ? listReadType(object, node)
            : arrayElementType(object) === number
              ? optionalNumber
              : unionSubset([bigint, undefinedType], node);
          break;
        }
        case "new": {
          const target = ungroup(node.callee);
          if (
            target.kind === "identifier" &&
            isErrorKind(target.name) &&
            !references.has(target)
          ) {
            if (node.arguments.length > 1)
              unsupported(
                node,
                "realm-library-construction",
                "Error options (cause) require the realm Error constructor",
              );
            for (const argument of node.arguments) {
              if (argument === undefined) throw "error argument invariant";
              const messageType = unionSubset([string, undefinedType], node);
              requireType(expression(argument, owner), messageType, argument);
            }
            intrinsics.set(
              node,
              target.name === "TypeError"
                ? "type-error-new"
                : target.name === "RangeError"
                  ? "range-error-new"
                  : "error-new",
            );
            result = primitive(target.name);
            break;
          }

          if (
            target.kind === "identifier" &&
            (target.name === "Set" || target.name === "Map") &&
            !references.has(target)
          ) {
            const map = target.name === "Map";
            const annotation = collectionConstructors.get(node);
            if (map) {
              if (node.arguments.length !== 0 || annotation === undefined)
                unsupported(
                  node,
                  "collection-construction",
                  "Map construction requires explicit type arguments and no iterable yet",
                );
              result = typeOf(annotation);
            } else {
              if (node.arguments.length > 1)
                fail(node, "ARITY", "Set accepts at most one iterable");
              let element: number | undefined;
              const input = node.arguments[0];
              if (input !== undefined) {
                const iterable = expression(input, owner),
                  iterableType = types[iterable];
                if (iterableType?.kind === "set")
                  element = iterableType.element;
                else if (isArray(iterable)) element = number;
                else if (isList(iterable))
                  element = listReadType(iterable, input);
                else
                  unsupported(
                    input,
                    "collection-construction",
                    "Set input requires a supported array or Set until general iteration is available",
                  );
              }
              const context =
                expected === undefined ? undefined : types[expected];
              if (annotation !== undefined) result = typeOf(annotation);
              else if (
                expected !== undefined &&
                context?.kind === "set" &&
                !context.readonly
              )
                result = expected;
              else {
                if (element === undefined)
                  unsupported(
                    node,
                    "collection-construction",
                    "empty Set requires an explicit or contextual element type",
                  );
                const inferredElement = element;
                const known = internedType("s" + inferredElement);
                if (known >= 0) result = known;
                else {
                  result = appendType(
                    { kind: "set", element: inferredElement, readonly: false },
                    node,
                    "invalid inferred collection type",
                  );
                }
              }
              const set = types[result];
              if (set?.kind !== "set")
                fail(node, "UNSUPPORTED", "collection type is shadowed");
              if (
                element !== undefined &&
                !system.assignable(element, set.element)
              )
                unsupported(
                  node,
                  "collection-construction",
                  "Set iterable does not match the native element layout",
                );
              if (element !== undefined)
                recordTypeFlow(element, set.element, node);
            }
            if (types[result]?.kind !== (map ? "map" : "set"))
              fail(node, "UNSUPPORTED", "collection type is shadowed");
            intrinsics.set(node, map ? "map-new" : "set-new");
            break;
          }
          if (
            target.kind === "identifier" &&
            !references.has(target) &&
            target.name === "ArrayBuffer" &&
            node.typeArguments.length === 0 &&
            node.arguments.length <= 1
          ) {
            // A fixed-length buffer of zeroed bytes. A resizable one (with
            // a maxByteLength option) takes the realm constructor.
            const size = node.arguments[0];
            if (size !== undefined)
              requireType(expression(size, owner), optionalNumber, size);
            result = primitive("ArrayBuffer");
            intrinsics.set(node, "array-buffer-new");
            break;
          }
          if (
            target.kind === "identifier" &&
            !references.has(target) &&
            target.name === "SharedArrayBuffer" &&
            node.typeArguments.length === 0 &&
            node.arguments.length <= 1
          ) {
            // A fixed-length block of the isolate's shared block service
            // (a growable one, with a maxByteLength option, takes the realm
            // constructor).
            const size = node.arguments[0];
            if (size !== undefined)
              requireType(expression(size, owner), optionalNumber, size);
            result = primitive("SharedArrayBuffer");
            intrinsics.set(node, "shared-array-buffer-new");
            break;
          }

          if (
            target.kind !== "identifier" ||
            references.has(target) ||
            ![
              "Uint8Array",
              "Uint16Array",
              "Uint32Array",
              "Float64Array",
            ].includes(target.name)
          ) {
            if (node.typeArguments.length !== 0)
              fail(
                node,
                "UNSUPPORTED",
                "generic construction requires specialization",
              );
            const callee = expression(node.callee, owner);
            const contract = types[callee];
            if (
              contract?.kind === "object" &&
              contract.realmLibrary !== undefined
            )
              unsupported(
                node,
                "realm-library-construction",
                "Realm constructor " +
                  contract.realmLibrary +
                  " requires library overload lowering",
              );
            const construct =
              contract?.kind === "object" ? contract.construct : undefined;
            const signature =
              construct === undefined ? undefined : types[construct];
            if (signature?.kind !== "function")
              fail(
                node.callee,
                "TYPE_MISMATCH",
                "callee must have a construct signature",
              );
            const args = callArguments(node, owner, signature);
            const constructed = system.construct(callee, args);
            if (!constructed.ok)
              fail(node, constructed.error, "invalid construction");
            invalidateCalls();
            result = constructed.value;
            break;
          }
          if (node.typeArguments.length !== 0)
            fail(
              node,
              "ARITY",
              "typed-array construction accepts an optional numeric length, numeric array or supported typed-array source",
            );
          const source = node.arguments[0];
          const input =
            source === undefined
              ? undefined
              : expression(
                  source,
                  owner,
                  ungroup(source).kind === "array"
                    ? typeOf(optionalNumericListAnnotation)
                    : undefined,
                );
          if (
            source !== undefined &&
            input !== undefined &&
            (types[input]?.kind === "ArrayBuffer" ||
              types[input]?.kind === "SharedArrayBuffer")
          ) {
            // A view of the buffer's bytes: (buffer, byteOffset?, length?).
            if (node.arguments.length > 3)
              fail(
                node,
                "ARITY",
                "typed-array buffer views accept a byte offset and a length",
              );
            for (const arg of node.arguments.slice(1)) {
              if (arg === undefined) throw "missing call argument";
              requireType(expression(arg, owner), optionalNumber, arg);
            }
            result = primitive(target.name);
            intrinsics.set(node, "array-view-new");
            break;
          }
          if (node.arguments.length > 1)
            unsupported(
              node,
              "realm-library-construction",
              "typed-array byte offsets and lengths require a buffer",
            );
          if (source !== undefined && input !== undefined) {
            if (isList(input))
              requireType(listReadType(input, source), optionalNumber, source);
            else if (!isArray(input))
              requireType(input, optionalNumber, source);
          }
          result = primitive(target.name);
          intrinsics.set(node, "array-new");
          break;
        }
        case "call": {
          if (node.typeArguments?.length)
            fail(node, "UNSUPPORTED", "generic calls require specialization");
          if (
            isOptionalChain(node) &&
            (node.optional || node.callee.kind !== "member")
          ) {
            const callee = chainReceiver(node.callee, node.optional === true),
              signature = types[callee];
            if (signature?.kind !== "function")
              fail(
                node.callee,
                "TYPE_MISMATCH",
                "callee must have a function type",
              );
            const args = callArguments(node, owner, signature);
            const checked = system.call(
              callee,
              args,
              callReceiverType(node.callee),
            );
            if (!checked.ok)
              fail(node, checked.error, "invalid optional-chain call");
            invalidateCalls();
            result = checked.value;
            break;
          }
          const target = ungroup(node.callee);
          if (
            target.kind === "member" &&
            !target.optional &&
            !node.optional &&
            (target.property === "hasOwn" ||
              target.property === "defineProperty")
          ) {
            const object = ungroup(target.object);
            if (
              object.kind === "identifier" &&
              object.name === "Object" &&
              !references.has(object)
            ) {
              const input = node.arguments[0],
                key = node.arguments[1];
              const definition = target.property === "defineProperty";
              if (
                input === undefined ||
                key === undefined ||
                node.arguments.length !== (definition ? 3 : 2)
              )
                fail(
                  node,
                  "ARITY",
                  "typed Object method received an incorrect argument count",
                );
              const source = expression(input, owner);
              if (
                !dynamicObject(source) &&
                !(target.property === "hasOwn" && realmAggregate(source))
              ) {
                if (
                  !definition &&
                  realmPlan === undefined &&
                  aggregatePayload(types, source)
                )
                  replayRealm = true;
                else
                  unsupported(
                    input,
                    "realm-aggregate-update",
                    "typed Object method requires a realm record",
                  );
              }
              const keyType = expression(key, owner);
              if (
                !system.assignable(keyType, unionSubset([string, number], key))
              )
                fail(
                  key,
                  "TYPE_MISMATCH",
                  "typed Object property key must be a string or number",
                  true,
                );
              if (definition) {
                const descriptor = node.arguments[2];
                if (descriptor?.kind !== "object")
                  unsupported(
                    node,
                    "realm-aggregate-update",
                    "typed Object.defineProperty requires a data descriptor literal",
                  );
                const name = checkedPropertyName(key, types[keyType]);
                const fields = dynamicPropertyTargets(
                  source,
                  keyType,
                  name,
                  key,
                );
                const field = fields[0];
                if (field === undefined) throw "descriptor field invariant";
                const members: Property[] = [
                  {
                    name: "value",
                    type: dynamicPayloadType(field.type, descriptor),
                    readonly: false,
                  },
                  {
                    name: "writable",
                    type: boolean,
                    optional: true,
                    readonly: false,
                  },
                  {
                    name: "enumerable",
                    type: boolean,
                    optional: true,
                    readonly: false,
                  },
                  {
                    name: "configurable",
                    type: boolean,
                    optional: true,
                    readonly: false,
                  },
                ];
                for (const property of descriptor.properties) {
                  if (property === undefined)
                    throw "data descriptor property invariant";
                  if (
                    property.kind === "spread" ||
                    property.accessor !== undefined ||
                    property.keyExpression !== undefined ||
                    property.prototypeSetter === true
                  )
                    unsupported(
                      property,
                      "realm-aggregate-update",
                      "typed Object.defineProperty requires a data descriptor literal",
                    );
                }
                const context = appendType(
                  { kind: "object", properties: members },
                  descriptor,
                  "invalid data descriptor context",
                );
                const checked = expression(descriptor, owner, context);
                checkDynamicPayload(checked, descriptor);
                for (const property of descriptor.properties) {
                  if (property === undefined || property.kind === "spread")
                    throw "data descriptor invariant";
                  if (property.name !== "value") continue;
                  const value = expressions.get(property.value);
                  if (value === undefined)
                    throw "data descriptor value invariant";
                  checkDynamicPayload(value, property.value);
                  for (const allowed of fields) {
                    if (allowed === undefined)
                      throw "data descriptor target invariant";
                    if (allowed.readonly)
                      fail(
                        key,
                        "IMMUTABLE",
                        "cannot write a readonly dynamic-key object property",
                        true,
                      );
                    requireType(
                      value,
                      dynamicPayloadType(allowed.type, property.value),
                      property.value,
                    );
                  }
                }
              }
              intrinsics.set(node, "dynamic-object-static-call");
              invalidateCalls();
              result = definition ? source : boolean;
              break;
            }
          }
          if (
            target.kind === "member" &&
            !target.optional &&
            !node.optional &&
            (target.property === "keys" ||
              target.property === "values" ||
              target.property === "entries")
          ) {
            const object = ungroup(target.object);
            if (
              object.kind === "identifier" &&
              object.name === "Object" &&
              !references.has(object)
            ) {
              const argument = node.arguments[0];
              if (node.arguments.length !== 1 || argument === undefined)
                fail(node, "ARITY", "Object enumeration requires one argument");
              const sourceType = expression(argument, owner);
              const source = types[sourceType];
              const index =
                source?.kind === "object" ? source.stringIndex : undefined;
              if (
                index === undefined &&
                !(target.property === "keys" && realmAggregate(sourceType))
              ) {
                if (
                  target.property === "keys" &&
                  realmPlan === undefined &&
                  aggregatePayload(types, sourceType)
                )
                  replayRealm = true;
                else
                  unsupported(
                    argument,
                    "realm-aggregate-update",
                    "typed Object enumeration requires a dynamic-key object",
                  );
              }
              let element = string;
              if (index !== undefined && target.property !== "keys")
                element = readDynamicPayload(index.type, node);
              if (target.property === "entries") {
                const pair: number[] = [string, element];
                element = realmArray(unionSubset(pair, node), node, pair);
              }
              result = realmArray(element, node);
              intrinsics.set(node, "dynamic-object-own-enumeration");
              invalidateCalls();
              break;
            }
          }
          // `R.view(bytes)` with R a binding Layout constant: a view of R
          // over `bytes` (which must hold R's size, else RangeError).
          const layout =
            target.kind === "member" && target.property === "view"
              ? ungroup(target.object)
              : undefined;
          const layoutView =
            cViews === undefined ||
            layout === undefined ||
            layout.kind !== "identifier"
              ? undefined
              : cViews.layouts.get(layout.name);
          if (layoutView !== undefined) {
            const bytes = node.arguments[0];
            if (node.arguments.length !== 1 || bytes === undefined)
              fail(node, "ARITY", "a C view is made from one byte array");
            const uint8Array = primitive("Uint8Array");
            requireType(
              expression(bytes, owner, uint8Array),
              uint8Array,
              bytes,
            );
            const created = viewShape(layoutView, node);
            cViewUses.set(node, {
              kind: "new",
              view: layoutView,
              size: created.size,
              length: created.length,
            });
            result = viewType(layoutView, node);
            break;
          }
          if (
            target.kind === "identifier" &&
            target.name === "String" &&
            !references.has(target)
          ) {
            if (node.arguments.length > 1)
              fail(
                node,
                "ARITY",
                "String accepts at most one argument in this slice",
              );
            const argument = node.arguments[0];
            if (argument !== undefined) {
              const input = expression(argument, owner);
              if (
                ![number, string, boolean, undefinedType, bigint].some((type) =>
                  system.assignable(input, type),
                )
              )
                fail(
                  argument,
                  "UNSUPPORTED",
                  "String requires a supported primitive input",
                );
            }
            intrinsics.set(node, "string-convert");
            result = string;
            break;
          }
          if (
            target.kind === "identifier" &&
            target.name === "Number" &&
            !references.has(target)
          ) {
            if (node.arguments.length !== 1)
              fail(
                node,
                "ARITY",
                "Number currently requires one string argument",
              );
            const argument = node.arguments[0];
            if (argument === undefined) throw "Number argument invariant";
            const input = expression(argument, owner);
            if (system.assignable(input, bigint))
              intrinsics.set(node, "number-from-bigint");
            else {
              requireType(input, string, argument);
              intrinsics.set(node, "number-from-string");
            }
            result = number;
            break;
          }
          if (
            target.kind === "identifier" &&
            target.name === "BigInt" &&
            !references.has(target)
          ) {
            // BigInt(value): integral Numbers convert exactly (others throw
            // a RangeError) and booleans give 0n/1n. Strings parse as
            // StringIntegerLiteral and invalid text throws a SyntaxError,
            // which typed code gains with realm errors (slice 4).
            if (node.arguments.length !== 1)
              fail(node, "ARITY", "BigInt requires one argument");
            const argument = node.arguments[0];
            if (argument === undefined || argument.kind === "spread")
              fail(node, "UNSUPPORTED", "BigInt requires one plain argument");
            const input = expression(argument, owner);
            intrinsics.set(
              node,
              system.assignable(input, bigint)
                ? "bigint-identity"
                : system.assignable(input, number)
                  ? "bigint-from-number"
                  : system.assignable(input, string)
                    ? fail(
                        argument,
                        "UNSUPPORTED",
                        "BigInt(string) needs realm SyntaxError (slice 4)",
                      )
                    : system.assignable(input, boolean)
                      ? "bigint-from-boolean"
                      : fail(
                          argument,
                          "TYPE_MISMATCH",
                          "BigInt requires a bigint, number, string or boolean",
                        ),
            );
            result = bigint;
            break;
          }
          if (target.kind === "member") {
            const receiver = ungroup(target.object);
            if (
              receiver.kind === "identifier" &&
              receiver.name === "Atomics" &&
              !references.has(receiver) &&
              atomicsOperations.includes(target.property)
            ) {
              // Atomics on a native integer array are inline (the pinned
              // library types them on integer typed arrays only).
              const arity =
                target.property === "load"
                  ? 2
                  : target.property === "compareExchange"
                    ? 4
                    : 3;
              if (node.arguments.length !== arity)
                fail(
                  node,
                  "ARITY",
                  "Atomics." +
                    target.property +
                    " takes " +
                    String(arity) +
                    " arguments",
                );
              const source = node.arguments[0];
              if (source === undefined) throw "missing call argument";
              const array = types[expression(source, owner)]?.kind;
              if (array === "Float64Array")
                fail(
                  source,
                  "TYPE_MISMATCH",
                  "Atomics operations require an integer typed array",
                );
              if (
                array !== "Uint8Array" &&
                array !== "Uint16Array" &&
                array !== "Uint32Array"
              )
                unsupported(
                  node,
                  "realm-library-member",
                  "Atomics on a realm typed array requires realm projection",
                );
              for (const argument of node.arguments.slice(1)) {
                if (argument === undefined) throw "missing call argument";
                requireType(expression(argument, owner), number, argument);
              }
              intrinsics.set(node, "atomics");
              result = number;
              break;
            }
            if (
              receiver.kind === "identifier" &&
              receiver.name === "Math" &&
              !references.has(receiver) &&
              (target.property === "min" ||
                target.property === "max" ||
                target.property === "imul")
            ) {
              if (target.property === "imul" && node.arguments.length !== 2)
                fail(
                  node,
                  "ARITY",
                  "Math.imul requires two numeric arguments in this slice",
                );
              for (const argument of node.arguments) {
                if (argument === undefined) throw "missing call argument";
                requireType(expression(argument, owner), number, argument);
              }
              intrinsics.set(
                node,
                target.property === "imul"
                  ? "math-imul"
                  : target.property === "min"
                    ? "math-min"
                    : "math-max",
              );
              result = number;
              break;
            }
            if (
              receiver.kind === "identifier" &&
              receiver.name === "String" &&
              !references.has(receiver) &&
              (target.property === "fromCharCode" ||
                target.property === "fromCodePoint")
            ) {
              for (const argument of node.arguments) {
                if (argument === undefined) throw "missing call argument";
                requireType(expression(argument, owner), number, argument);
              }
              intrinsics.set(
                node,
                target.property === "fromCharCode"
                  ? "string-from-code-units"
                  : "string-from-code-points",
              );
              result = string;
              break;
            }
            if (
              receiver.kind === "identifier" &&
              !references.has(receiver) &&
              ((receiver.name === "Number" &&
                (target.property === "isInteger" ||
                  target.property === "isSafeInteger" ||
                  target.property === "isNaN" ||
                  target.property === "isFinite")) ||
                (receiver.name === "Math" &&
                  [
                    "ceil",
                    "floor",
                    "trunc",
                    "abs",
                    "sign",
                    "clz32",
                    "round",
                    "sqrt",
                  ].includes(target.property)))
            ) {
              if (node.arguments.length !== 1)
                fail(node, "ARITY", "builtin requires one argument");
              const arg = node.arguments[0];
              if (arg === undefined) throw "builtin arity invariant";
              const value = expression(arg, owner);
              if (receiver.name === "Math") {
                requireType(value, number, arg);
                result = number;
                intrinsics.set(
                  node,
                  target.property === "sqrt"
                    ? "math-sqrt"
                    : target.property === "round"
                      ? "math-round"
                      : target.property === "clz32"
                        ? "math-clz32"
                        : target.property === "trunc"
                          ? "math-trunc"
                          : target.property === "abs"
                            ? "math-abs"
                            : target.property === "sign"
                              ? "math-sign"
                              : target.property === "ceil"
                                ? "math-ceil"
                                : "math-floor",
                );
              } else {
                if (value === voidType)
                  fail(arg, "TYPE_MISMATCH", "void result is not a value");
                result = boolean;
                intrinsics.set(
                  node,
                  target.property === "isNaN"
                    ? "number-is-nan"
                    : target.property === "isSafeInteger"
                      ? "number-is-safe-integer"
                      : target.property === "isFinite"
                        ? "number-is-finite"
                        : "number-is-integer",
                );
              }
              break;
            }
            // Check a receiver once, before the arguments; function-valued object properties remain ordinary calls.
            const obj =
              node.callee.kind === "member"
                ? chainReceiver(target.object, target.optional === true)
                : expression(target.object, owner);
            const map = types[obj];
            if (map?.kind === "object" && map.realmLibrary !== undefined) {
              if (
                node.optional === true ||
                target.optional === true ||
                skipped !== undefined
              )
                unsupported(
                  node,
                  "optional-call",
                  "Optional realm library method calls require optional chain lowering",
                  true,
                );
              result = libraryCall(
                map,
                target.property,
                node.arguments,
                owner,
                node,
              );
              intrinsics.set(node, "realm-library-call");
              invalidateCalls();
              break;
            }
            if (map?.kind === "function" && target.property === "call") {
              const suppliedReceiver = node.arguments[0];
              const receiver =
                suppliedReceiver === undefined
                  ? undefinedType
                  : expression(suppliedReceiver, owner, map.receiver);
              const args = callArguments(node, owner, map, 1);
              const called = system.call(obj, args, receiver);
              if (!called.ok)
                fail(node, called.error, "invalid explicit receiver call");
              intrinsics.set(node, "function-call");
              result = called.value;
              invalidateCalls();
              break;
            }
            if (
              map?.kind === "map" &&
              ["get", "has", "set", "delete", "clear"].includes(target.property)
            ) {
              if (
                map.readonly &&
                target.property !== "get" &&
                target.property !== "has"
              )
                fail(node, "IMMUTABLE", "cannot mutate a readonly Map");
              const count =
                target.property === "set"
                  ? 2
                  : target.property === "clear"
                    ? 0
                    : 1;
              if (node.arguments.length !== count)
                fail(node, "ARITY", "incorrect Map method argument count");
              for (let i = 0; i < node.arguments.length; i++) {
                const argument = node.arguments[i];
                if (argument === undefined) throw "map arity invariant";
                requireType(
                  expression(argument, owner, i === 0 ? map.key : map.value),
                  i === 0 ? map.key : map.value,
                  argument,
                );
              }
              if (target.property === "get") {
                result = system.assignable(undefinedType, map.value)
                  ? map.value
                  : unionSubset([map.value, undefinedType], node);
                intrinsics.set(node, "map-get");
              } else if (
                target.property === "has" ||
                target.property === "delete"
              ) {
                result = boolean;
                intrinsics.set(
                  node,
                  target.property === "has" ? "map-has" : "map-delete",
                );
              } else if (target.property === "set") {
                result = obj;
                intrinsics.set(node, "map-set");
              } else {
                result = voidType;
                intrinsics.set(node, "map-clear");
              }
              invalidateCalls();
              break;
            }
            const set = types[obj];
            if (
              set?.kind === "set" &&
              ["has", "add", "delete", "clear"].includes(target.property)
            ) {
              if (set.readonly && target.property !== "has")
                fail(node, "IMMUTABLE", "cannot mutate a readonly Set");
              const count = target.property === "clear" ? 0 : 1;
              if (node.arguments.length !== count)
                fail(node, "ARITY", "incorrect Set method argument count");
              for (const argument of node.arguments) {
                if (argument === undefined) throw "missing call argument";
                requireType(expression(argument, owner), set.element, argument);
              }
              if (target.property === "has") {
                intrinsics.set(node, "set-has");
                result = boolean;
              } else if (target.property === "add") {
                intrinsics.set(node, "set-add");
                result = obj;
              } else if (target.property === "delete") {
                intrinsics.set(node, "set-delete");
                result = boolean;
              } else {
                intrinsics.set(node, "set-clear");
                result = voidType;
              }
              invalidateCalls();
              break;
            }

            if (
              system.assignable(obj, string) &&
              (target.property === "codePointAt" ||
                target.property === "charCodeAt" ||
                target.property === "charAt" ||
                target.property === "at")
            ) {
              if (node.arguments.length > 1)
                fail(
                  node,
                  "ARITY",
                  target.property +
                    " accepts zero or one optional numeric index",
                );
              for (const arg of node.arguments) {
                if (arg === undefined) throw "missing call argument";
                requireType(expression(arg, owner), optionalNumber, arg);
              }
              intrinsics.set(
                node,
                target.property === "codePointAt"
                  ? "string-code-point"
                  : target.property === "charCodeAt"
                    ? "string-code-unit"
                    : target.property === "charAt"
                      ? "string-char-at"
                      : "string-at",
              );
              result =
                target.property === "codePointAt"
                  ? optionalNumber
                  : target.property === "charCodeAt"
                    ? number
                    : target.property === "charAt"
                      ? string
                      : unionSubset([string, undefinedType], node);
              break;
            }
            if (
              system.assignable(obj, string) &&
              (target.property === "padStart" || target.property === "padEnd")
            ) {
              if (node.arguments.length > 2)
                fail(
                  node,
                  "ARITY",
                  "padding accepts an optional numeric length and string filler",
                );
              const length = node.arguments[0],
                filler = node.arguments[1];
              if (length !== undefined)
                requireType(expression(length, owner), optionalNumber, length);
              if (filler !== undefined)
                requireType(
                  expression(filler, owner),
                  unionSubset([string, undefinedType], node),
                  filler,
                );
              intrinsics.set(
                node,
                target.property === "padStart"
                  ? "string-pad-start"
                  : "string-pad-end",
              );
              result = string;
              break;
            }
            if (
              system.assignable(obj, string) &&
              target.property === "repeat"
            ) {
              if (node.arguments.length > 1)
                fail(
                  node,
                  "ARITY",
                  "repeat accepts zero or one optional numeric count",
                );
              for (const arg of node.arguments) {
                if (arg === undefined) throw "repeat argument invariant";
                requireType(expression(arg, owner), optionalNumber, arg);
              }
              intrinsics.set(node, "string-repeat");
              result = string;
              break;
            }
            if (
              system.assignable(obj, string) &&
              target.property === "concat"
            ) {
              for (const argument of node.arguments) {
                if (argument === undefined) throw "concat argument invariant";
                requireType(expression(argument, owner), string, argument);
              }
              intrinsics.set(node, "string-concat");
              result = string;
              break;
            }
            if (
              system.assignable(obj, string) &&
              (target.property === "trim" ||
                target.property === "trimStart" ||
                target.property === "trimEnd")
            ) {
              if (node.arguments.length !== 0)
                fail(node, "ARITY", "string trimming accepts no arguments");
              intrinsics.set(
                node,
                target.property === "trim"
                  ? "string-trim"
                  : target.property === "trimStart"
                    ? "string-trim-start"
                    : "string-trim-end",
              );
              result = string;
              break;
            }
            if (
              system.assignable(obj, string) &&
              (target.property === "slice" || target.property === "substring")
            ) {
              if (node.arguments.length > 2)
                fail(
                  node,
                  "ARITY",
                  target.property +
                    " accepts zero to two optional numeric bounds",
                );
              for (const arg of node.arguments) {
                if (arg === undefined) throw "missing call argument";
                requireType(expression(arg, owner), optionalNumber, arg);
              }
              intrinsics.set(
                node,
                target.property === "slice"
                  ? "string-slice"
                  : "string-substring",
              );
              result = string;
              break;
            }
            if (system.assignable(obj, string) && target.property === "split") {
              if (node.arguments.length > 2)
                fail(
                  node,
                  "ARITY",
                  "split accepts a separator and optional limit",
                );
              const separator = node.arguments[0],
                limit = node.arguments[1];
              if (separator !== undefined)
                requireType(
                  expression(separator, owner),
                  unionSubset([string, undefinedType], separator),
                  separator,
                );
              if (limit !== undefined)
                requireType(expression(limit, owner), optionalNumber, limit);
              intrinsics.set(node, "string-split");
              result = typeOf(stringListAnnotation);
              break;
            }
            if (
              system.assignable(obj, string) &&
              (target.property === "startsWith" ||
                target.property === "endsWith" ||
                target.property === "includes" ||
                target.property === "indexOf" ||
                target.property === "lastIndexOf")
            ) {
              if (node.arguments.length < 1 || node.arguments.length > 2)
                fail(
                  node,
                  "ARITY",
                  "string search requires a string and optional numeric position",
                );
              const search = node.arguments[0];
              if (search === undefined) throw "prefix arity invariant";
              requireType(expression(search, owner), string, search);
              const position = node.arguments[1];
              if (position !== undefined)
                requireType(
                  expression(position, owner),
                  optionalNumber,
                  position,
                );
              intrinsics.set(
                node,
                target.property === "lastIndexOf"
                  ? "string-last-index-of"
                  : target.property === "indexOf"
                    ? "string-index-of"
                    : target.property === "includes"
                      ? "string-includes"
                      : target.property === "endsWith"
                        ? "string-ends-with"
                        : "string-starts-with",
              );
              result =
                target.property === "indexOf" ||
                target.property === "lastIndexOf"
                  ? number
                  : boolean;
              break;
            }
            if (
              (isList(obj) ||
                (isArray(obj) &&
                  (target.property === "forEach" ||
                    target.property === "some" ||
                    target.property === "every" ||
                    target.property === "find" ||
                    target.property === "findIndex" ||
                    target.property === "findLast" ||
                    target.property === "findLastIndex"))) &&
              (target.property === "forEach" ||
                target.property === "sort" ||
                target.property === "map" ||
                target.property === "filter" ||
                target.property === "some" ||
                target.property === "every" ||
                target.property === "find" ||
                target.property === "findIndex" ||
                target.property === "findLast" ||
                target.property === "findLastIndex")
            ) {
              const each = target.property === "forEach";
              const sorting = target.property === "sort";
              if (sorting) requireMutableList(obj, target.object);
              const mapping = target.property === "map",
                reverseFinding =
                  target.property === "findLast" ||
                  target.property === "findLastIndex",
                findingIndex =
                  target.property === "findIndex" ||
                  target.property === "findLastIndex",
                finding =
                  target.property === "find" ||
                  target.property === "findLast" ||
                  findingIndex;
              if (node.arguments.length !== 1)
                fail(
                  node,
                  "ARITY",
                  "array method requires one callback in this slice",
                );
              const argument = node.arguments[0];
              if (argument === undefined) throw "map argument invariant";
              const callback = ungroup(argument);
              if (
                mapping &&
                replayRealm &&
                realmPlan === undefined &&
                projectedCallable(callback)
              ) {
                expression(argument, owner);
                result = arrayOf(number, node);
                break;
              }
              const typed = isArray(obj);
              const sortElement = typed
                ? number
                : listElement(obj, target.object);
              const comparatorElement = presentType(sortElement) ?? sortElement;
              const inputs = sorting
                ? [comparatorElement, comparatorElement]
                : [
                    typed
                      ? number
                      : finding
                        ? listReadType(obj, target.object)
                        : listElement(obj, target.object),
                    number,
                    obj,
                  ];
              let callbackType: number;
              if (
                callback.kind === "arrow" ||
                callback.kind === "function-expression"
              ) {
                if (callback.parameters.length > inputs.length)
                  fail(
                    callback,
                    "ARITY",
                    "array callback accepts at most three parameters",
                  );
                if (
                  callback.parameters.some(
                    (p) => p.initializer !== undefined || p.optional,
                  )
                )
                  unsupported(
                    callback,
                    "default-parameter-layout",
                    "array callback defaults and optional parameters require adapted call signatures",
                  );
                const context =
                  !mapping || expected === undefined
                    ? undefined
                    : types[expected];
                const output =
                  callback.returnType === undefined
                    ? sorting
                      ? number
                      : context?.kind === "array"
                        ? context.element
                        : undefined
                    : typeOf(callback.returnType);

                const parameters = inputs.slice(0, callback.parameters.length);
                const provisional = functionOf(
                  parameters,
                  output ?? undefinedType,
                  callback,
                );
                const returned = checkFunction(
                  callback,
                  callback.parameters,
                  callback.returnType,
                  callback.body,
                  provisional,
                  output === undefined,
                  true,
                );
                const accepted = callback.parameters.map((p): number => {
                  if (p === undefined) throw "missing callback parameter";
                  const type = bindingTypes[binding(p).id];
                  if (type === undefined) throw "map parameter type invariant";
                  return type;
                });
                callbackType = functionOf(accepted, returned, callback);
                expressions.set(callback, callbackType);
                expressions.set(argument, callbackType);
              } else callbackType = expression(argument, owner);
              const signature = types[callbackType];
              if (signature?.kind !== "function")
                fail(
                  argument,
                  "TYPE_MISMATCH",
                  "array callback must be a function",
                );
              if (signature.parameters.length > inputs.length)
                fail(
                  argument,
                  "ARITY",
                  "array callback accepts at most three parameters",
                );
              for (let i = 0; i < signature.parameters.length; i++) {
                const input = inputs[i],
                  parameter = signature.parameters[i];
                if (input === undefined || parameter === undefined)
                  throw "map signature invariant";
                requireType(input, parameter, argument);
              }

              if (sorting) requireType(signature.result, number, argument);
              result = each
                ? voidType
                : sorting
                  ? obj
                  : mapping
                    ? arrayOf(signature.result, node)
                    : target.property === "filter"
                      ? arrayOf(listElement(obj, target.object), node)
                      : findingIndex
                        ? number
                        : finding
                          ? typed
                            ? optionalNumber
                            : listReadType(obj, node)
                          : boolean;
              if (mapping && !isList(result))
                unsupported(
                  node,
                  "collection-construction",
                  "map result requires a supported array element encoding",
                );
              intrinsics.set(
                node,
                each
                  ? "indexed-for-each"
                  : sorting
                    ? "list-sort"
                    : mapping
                      ? "list-map"
                      : target.property === "filter"
                        ? "list-filter"
                        : findingIndex
                          ? reverseFinding
                            ? "indexed-find-last-index"
                            : "indexed-find-index"
                          : finding
                            ? reverseFinding
                              ? "indexed-find-last"
                              : "indexed-find"
                            : target.property === "every"
                              ? "indexed-every"
                              : "indexed-some",
              );
              invalidateCalls();
              break;
            }
            if (
              (isList(obj) || isArray(obj)) &&
              target.property === "reverse"
            ) {
              if (node.arguments.length !== 0)
                fail(node, "ARITY", "reverse accepts no arguments");
              if (isList(obj)) requireMutableList(obj, target.object);
              intrinsics.set(
                node,
                isList(obj) ? "list-reverse" : "array-reverse",
              );
              result = obj;
              invalidateCalls();
              break;
            }
            if ((isList(obj) || isArray(obj)) && target.property === "at") {
              if (node.arguments.length > 1)
                fail(
                  node,
                  "ARITY",
                  "at accepts zero or one optional numeric index",
                );
              for (const arg of node.arguments) {
                if (arg === undefined) throw "at argument invariant";
                requireType(expression(arg, owner), optionalNumber, arg);
              }
              intrinsics.set(node, isList(obj) ? "list-at" : "array-at");
              result = isList(obj)
                ? listReadType(obj, node)
                : arrayElementType(obj) === number
                  ? optionalNumber
                  : unionSubset([bigint, undefinedType], node);
              break;
            }
            if (isList(obj) && target.property === "slice") {
              if (node.arguments.length > 2)
                fail(
                  node,
                  "ARITY",
                  "slice accepts zero to two optional numeric bounds",
                );
              for (const argument of node.arguments) {
                if (argument === undefined) throw "slice argument invariant";
                requireType(
                  expression(argument, owner),
                  optionalNumber,
                  argument,
                );
              }
              result = arrayOf(listElement(obj, target.object), node);
              intrinsics.set(node, "list-slice");
              break;
            }
            if ((isList(obj) || isArray(obj)) && target.property === "join") {
              const optionalString = unionSubset([string, undefinedType], node);
              if (isList(obj)) {
                const element = listElement(obj, target.object);
                const optionalBoolean = unionSubset(
                  [boolean, undefinedType],
                  node,
                );
                if (
                  !system.assignable(element, optionalNumber) &&
                  !system.assignable(element, optionalBoolean)
                )
                  requireType(element, optionalString, target.object);
              }
              if (node.arguments.length > 1)
                fail(node, "ARITY", "join accepts at most one separator");
              const separator = node.arguments[0];
              if (separator !== undefined)
                requireType(
                  expression(separator, owner),
                  optionalString,
                  separator,
                );
              intrinsics.set(node, isList(obj) ? "list-join" : "array-join");
              result = string;
              break;
            }
            if (isList(obj) && target.property === "splice") {
              requireMutableList(obj, target.object);
              const element = listElement(obj, target.object);
              for (let i = 0; i < node.arguments.length; i++) {
                const arg = node.arguments[i];
                if (arg === undefined) throw "splice argument invariant";
                const expected = i < 2 ? optionalNumber : element;
                requireType(expression(arg, owner, expected), expected, arg);
              }
              intrinsics.set(node, "list-splice");
              invalidateCalls();
              result = arrayOf(element, node);
              break;
            }
            if (
              isList(obj) &&
              (target.property === "includes" || target.property === "indexOf")
            ) {
              if (node.arguments.length < 1 || node.arguments.length > 2)
                fail(
                  node,
                  "ARITY",
                  "array includes requires a search value and optional numeric position",
                );
              const search = node.arguments[0];
              if (search === undefined) throw "includes argument invariant";
              const element = listReadType(obj, node);
              requireType(expression(search, owner, element), element, search);
              const position = node.arguments[1];
              if (position !== undefined)
                requireType(
                  expression(position, owner),
                  optionalNumber,
                  position,
                );
              intrinsics.set(
                node,
                target.property === "indexOf"
                  ? "list-index-of"
                  : "list-includes",
              );
              result = target.property === "indexOf" ? number : boolean;
              break;
            }
            if (
              isList(obj) &&
              (target.property === "pop" || target.property === "shift")
            ) {
              requireMutableList(obj, target.object);
              if (node.arguments.length !== 0)
                fail(node, "ARITY", "pop and shift accept no arguments");
              intrinsics.set(
                node,
                target.property === "shift" ? "list-shift" : "list-pop",
              );
              result = listReadType(obj, node);
              invalidateCalls();
              break;
            }
            const realmList = types[obj];
            if (realmList?.kind === "array" && realmList.realmArray === true) {
              if (node.optional || target.optional)
                unsupported(
                  target,
                  "optional-call",
                  "optional realm array methods require optional-call lowering",
                  true,
                );
              const method = target.property,
                element = realmList.element;
              const mutates = [
                "push",
                "unshift",
                "pop",
                "shift",
                "splice",
                "fill",
                "copyWithin",
                "reverse",
                "sort",
              ].includes(method);
              if (
                mutates &&
                (realmList.readonly || realmList.tupleElements !== undefined)
              )
                fail(
                  target,
                  "IMMUTABLE",
                  "cannot mutate a readonly realm array",
                  true,
                );
              const args = node.arguments,
                size = args.length;
              function argumentsOf(
                minimum: number,
                positional: readonly number[],
                rest?: number,
              ): void {
                if (
                  size < minimum ||
                  (rest === undefined && size > positional.length)
                )
                  fail(
                    node,
                    "ARITY",
                    "invalid realm array method argument count",
                    true,
                  );
                for (let i = 0; i < size; i++) {
                  const argument = args[i],
                    type = positional[i] ?? rest;
                  if (argument === undefined || type === undefined)
                    throw "realm array argument invariant";
                  if (argument.kind === "spread")
                    unsupported(
                      argument,
                      "rest-call-layout",
                      "realm array method spread arguments require iterable call lowering",
                      true,
                    );
                  const actual = expression(argument, owner, type);
                  requireType(actual, type, argument);
                  checkDynamicPayload(actual, argument);
                }
              }
              switch (method) {
                case "push":
                case "unshift":
                  argumentsOf(0, [], element);
                  result = number;
                  break;
                case "pop":
                case "shift":
                case "at":
                  argumentsOf(
                    method === "at" ? 1 : 0,
                    method === "at" ? [number] : [],
                  );
                  result = unionSubset([element, undefinedType], node);
                  break;
                case "includes":
                case "indexOf":
                case "lastIndexOf":
                  argumentsOf(1, [element, optionalNumber]);
                  result = method === "includes" ? boolean : number;
                  break;
                case "join":
                  argumentsOf(0, [unionSubset([string, undefinedType], node)]);
                  result = string;
                  break;
                case "reverse":
                  argumentsOf(0, []);
                  result = obj;
                  break;
                case "sort":
                case "toSorted":
                  if (size !== 0)
                    unsupported(
                      target,
                      "native-callable-view",
                      "native callbacks passed to realm array methods need slice 2b closure views",
                      true,
                    );
                  result = method === "sort" ? obj : realmArray(element, node);
                  break;
                case "fill":
                  argumentsOf(1, [element, optionalNumber, optionalNumber]);
                  result = obj;
                  break;
                case "copyWithin":
                  argumentsOf(2, [number, number, optionalNumber]);
                  result = obj;
                  break;
                case "slice":
                  argumentsOf(0, [optionalNumber, optionalNumber]);
                  result = realmArray(element, node);
                  break;
                case "splice":
                case "toSpliced":
                  argumentsOf(
                    1,
                    [number, size > 2 ? number : optionalNumber],
                    element,
                  );
                  result = realmArray(element, node);
                  break;
                case "with":
                  argumentsOf(2, [number, element]);
                  result = realmArray(element, node);
                  break;
                case "toReversed":
                  argumentsOf(0, []);
                  result = realmArray(element, node);
                  break;
                case "map": {
                  const callback = args[0];
                  if (
                    size === 1 &&
                    callback !== undefined &&
                    element === number &&
                    callback.kind !== "spread"
                  ) {
                    const actual = expression(callback, owner);
                    if (unaryNumberCallable(actual)) {
                      nativeCallableViews.set(callback, true);
                      result = realmArray(number, node);
                      break;
                    }
                    if (
                      types[actual]?.kind === "unknown" &&
                      projectedCallable(callback)
                    ) {
                      result = realmArray(number, node);
                      break;
                    }
                  }
                  // Other signatures still need their own checked ABI view.
                  unsupported(
                    target,
                    "native-callable-view",
                    "native callbacks passed to realm array methods need slice 2b closure views",
                    true,
                  );
                }
                case "filter":
                case "flatMap":
                case "forEach":
                case "every":
                case "some":
                case "find":
                case "findIndex":
                case "findLast":
                case "findLastIndex":
                case "reduce":
                case "reduceRight":
                  unsupported(
                    target,
                    "native-callable-view",
                    "native callbacks passed to realm array methods need slice 2b closure views",
                    true,
                  );
                default:
                  unsupported(
                    target,
                    "realm-library-member",
                    "realm array method is outside typed realm array checking",
                    true,
                  );
              }
              intrinsics.set(node, "dynamic-object-array-method");
              invalidateCalls();
              break;
            }
            if (
              isList(obj) &&
              (target.property === "push" || target.property === "unshift")
            ) {
              requireMutableList(obj, target.object);
              const element = listElement(obj, target.object);
              for (const arg of node.arguments) {
                if (arg === undefined) throw "missing call argument";
                requireType(expression(arg, owner, element), element, arg);
              }
              intrinsics.set(
                node,
                target.property === "unshift" ? "list-unshift" : "list-push",
              );
              invalidateCalls();
              result = number;
              break;
            }
            if (isArray(obj) && target.property === "set") {
              if (node.arguments.length < 1 || node.arguments.length > 2)
                fail(
                  node,
                  "ARITY",
                  "set requires a typed-array source and optional numeric offset",
                );
              const source = node.arguments[0],
                offset = node.arguments[1];
              if (source === undefined) throw "set source invariant";
              requireArray(expression(source, owner), source);
              if (offset !== undefined)
                requireType(expression(offset, owner), optionalNumber, offset);
              intrinsics.set(node, "array-set");
              result = voidType;
              break;
            }
            if (
              isArray(obj) &&
              (target.property === "subarray" || target.property === "slice")
            ) {
              if (node.arguments.length > 2)
                fail(
                  node,
                  "ARITY",
                  "typed-array slice and subarray accept zero to two optional numeric bounds",
                );
              for (const arg of node.arguments) {
                if (arg === undefined) throw "missing call argument";
                requireType(expression(arg, owner), optionalNumber, arg);
              }
              intrinsics.set(
                node,
                target.property === "slice" ? "array-slice" : "array-subarray",
              );
              result = obj;
              break;
            }
            if ((isArray(obj) || isList(obj)) && target.property === "fill") {
              if (node.arguments.length < 1 || node.arguments.length > 3)
                fail(node, "ARITY", "fill requires one to three arguments");
              if (isList(obj)) requireMutableList(obj, target.object);
              const element = isList(obj)
                ? listElement(obj, target.object)
                : arrayElementType(obj);
              for (let index = 0; index < node.arguments.length; index++) {
                const arg = node.arguments[index];
                if (arg === undefined) throw "fill argument invariant";
                const expected = index === 0 ? element : optionalNumber;
                requireType(expression(arg, owner, expected), expected, arg);
              }
              intrinsics.set(node, isList(obj) ? "list-fill" : "array-fill");
              result = obj;
              invalidateCalls();
              break;
            }
            const member = system.property(obj, target.property);
            if (!member.ok) {
              const receiverKind = types[obj]?.kind;
              fail(
                target,
                member.error,
                "invalid method call",
                false,
                member.error === "PROPERTY" &&
                  (receiverKind === "string" ||
                    receiverKind === "number" ||
                    receiverKind === "literal" ||
                    receiverKind === "array" ||
                    isArray(obj))
                  ? fallbackAt(target, "realm-library-member")
                  : undefined,
              );
            }
            const memberType =
              propertyFact(target.object, target.property) ?? member.value;
            if (types[memberType]?.kind === "realm-callable") {
              expression(node.callee, owner);
              result = generalCall(node, owner);
              break;
            }
            if (skipped !== undefined) {
              chainReceivers.set(target, obj);
              chainValues.set(target, member.value);
              expressions.set(
                target,
                unionSubset([member.value, undefinedType], target),
              );
              chainReceivers.set(node, member.value);
            } else expressions.set(target, member.value);
            let wrapper = node.callee;
            while (wrapper.kind === "group" || wrapper.kind === "satisfies") {
              if (wrapper.kind === "satisfies")
                requireType(member.value, typeOf(wrapper.type), wrapper);
              expressions.set(wrapper, member.value);
              wrapper = wrapper.expression;
            }
            const signature = types[member.value];
            if (signature?.kind !== "function")
              fail(target, "TYPE_MISMATCH", "property must have function type");
            const args = callArguments(node, owner, signature);
            const checked = system.call(member.value, args, obj);
            if (!checked.ok) fail(node, checked.error, "invalid call");
            invalidateCalls();
            result = checked.value;
            break;
          }
          const callee = expression(node.callee, owner),
            signature = types[callee];
          if (
            signature?.kind === "object" &&
            signature.realmLibrary !== undefined
          )
            unsupported(
              node,
              "realm-library-member",
              "Realm callable " +
                signature.realmLibrary +
                " requires library overload lowering",
            );
          if (signature?.kind === "realm-callable") {
            result = generalCall(node, owner);
            break;
          }
          if (signature?.kind !== "function")
            fail(node, "TYPE_MISMATCH", "callee must have a function type");
          const args = callArguments(node, owner, signature);
          const checked = system.call(
            callee,
            args,
            callReceiverType(node.callee),
          );
          if (!checked.ok) fail(node, checked.error, "invalid call");
          invalidateCalls();
          result = checked.value;
          const foreign =
            cViews === undefined || target.kind !== "identifier"
              ? undefined
              : cViews.foreign.get(target.name);
          if (foreign !== undefined) result = foreignView(node, foreign);
          break;
        }
        case "update":
        case "compound": {
          let target = node.target;
          while (target.kind === "group") target = target.expression;
          if (target.kind === "member" || target.kind === "index") {
            const object = expression(target.object, owner);
            const keyType =
              target.kind === "index"
                ? expression(target.index, owner)
                : undefined;
            const propertyName =
              target.kind === "member"
                ? target.property
                : checkedPropertyName(
                    target.index,
                    keyType === undefined ? undefined : types[keyType],
                  );
            if (dynamicObject(object) || realmAggregate(object)) {
              const shape = types[object];
              const fields: Property[] = [];
              if (dynamicObject(object))
                for (const field of dynamicPropertyTargets(
                  object,
                  keyType,
                  propertyName,
                  target,
                )) {
                  if (field === undefined)
                    throw "dynamic update field invariant";
                  fields.push(field);
                }
              else if (shape?.kind === "array") {
                if (propertyName !== "length") {
                  if (target.kind !== "index" || keyType === undefined)
                    fail(
                      target,
                      "PROPERTY",
                      "realm array updates require an index or length",
                      true,
                    );
                  requireType(keyType, number, target.index);
                }
                fields.push({
                  name: propertyName ?? "",
                  type: propertyName === "length" ? number : shape.element,
                  readonly: shape.readonly || shape.tupleElements !== undefined,
                });
              } else if (shape?.kind === "object") {
                const names =
                  propertyName === undefined && keyType !== undefined
                    ? finiteRecordKeys(object, keyType)
                    : propertyName === undefined
                      ? undefined
                      : [propertyName];
                if (names === undefined)
                  fail(
                    target,
                    "PROPERTY",
                    "realm record updates require a known property",
                    true,
                  );
                for (const name of names) {
                  const field = shape.properties.find(
                    (item) => item?.name === name,
                  );
                  if (field === undefined)
                    fail(
                      target,
                      "PROPERTY",
                      "unknown realm record property",
                      true,
                    );
                  fields.push(field);
                }
              }
              const field = fields[0];
              if (field === undefined) throw "realm update field invariant";
              for (const allowed of fields) {
                if (allowed === undefined) throw "realm update field invariant";
                if (allowed.readonly)
                  fail(
                    target,
                    "IMMUTABLE",
                    "cannot update a readonly realm property",
                    true,
                  );
              }
              const old = expression(target, owner);
              let written: number;
              if (
                node.kind === "compound" &&
                (node.operator === "&&" ||
                  node.operator === "||" ||
                  node.operator === "??")
              ) {
                const before = new Set(present);
                written = expression(
                  node.value,
                  owner,
                  dynamicPayloadType(field.type, node.value),
                );
                if (dynamicObject(object))
                  checkDynamicPayload(written, node.value, field.type);
                present = intersect(before, present);
                result = join(
                  node.operator === "??" || node.operator === "||"
                    ? (presentType(old, true) ?? old)
                    : old,
                  written,
                  node,
                  expected,
                );
              } else {
                const right =
                  node.kind === "compound"
                    ? expression(node.value, owner)
                    : number;
                if (
                  node.kind === "compound" &&
                  node.operator === "+" &&
                  (system.assignable(old, string) ||
                    system.assignable(right, string)) &&
                  [old, right].every(
                    (type) =>
                      system.assignable(type, string) ||
                      system.assignable(type, number) ||
                      system.assignable(type, boolean) ||
                      system.assignable(type, bigint),
                  )
                )
                  written = string;
                else if (
                  system.assignable(old, bigint) &&
                  (node.kind === "update" ||
                    system.assignable(right, bigint)) &&
                  (node.kind === "update" || node.operator !== ">>>")
                )
                  written = bigint;
                else {
                  requireType(old, number, target);
                  if (node.kind === "compound")
                    requireType(right, number, node.value);
                  written = number;
                }
                result = written;
              }
              for (const allowed of fields) {
                if (allowed === undefined) throw "realm update field invariant";
                requireType(
                  written,
                  dynamicPayloadType(allowed.type, target),
                  target,
                );
              }
              intrinsics.set(
                node,
                node.kind === "update"
                  ? "dynamic-object-update"
                  : "dynamic-object-compound",
              );
              invalidateCalls();
              break;
            }
            const viewWrite = viewAccess(
              target,
              object,
              propertyName,
              keyType,
              true,
            );
            if (viewWrite !== undefined) {
              const member = viewUseType(viewWrite, target);
              expressions.set(target, member);
              if (
                node.kind === "compound" &&
                (node.operator === "&&" ||
                  node.operator === "||" ||
                  node.operator === "??")
              ) {
                const before = new Set(present),
                  right = expression(node.value, owner, member);
                requireType(right, member, node.value);
                present = intersect(before, present);
                result = member;
                break;
              }
              requireType(member, number, target);
              if (node.kind === "compound")
                requireType(expression(node.value, owner), number, node.value);
              result = number;
              break;
            }
            if (propertyName === undefined)
              unsupported(
                target,
                "realm-aggregate-update",
                "property update requires a singleton key",
              );
            if (isList(object) && propertyName === "length") {
              requireMutableList(object, target.object);
              if (node.kind === "compound") {
                const before = new Set(present);
                requireType(
                  expression(node.value, owner, number),
                  number,
                  node.value,
                );
                if (
                  node.operator === "&&" ||
                  node.operator === "||" ||
                  node.operator === "??"
                )
                  present = intersect(before, present);
              }
              intrinsics.set(node, "list-resize");
              invalidateCalls();
              result = number;
              break;
            }
            const property = system.property(object, propertyName);
            intrinsics.set(node, "record-write");
            if (!property.ok)
              fail(target, property.error, "invalid property update");
            if (
              node.kind === "compound" &&
              (node.operator === "&&" || node.operator === "||")
            ) {
              const primitive = system.assignable(property.value, number)
                ? number
                : system.assignable(property.value, string)
                  ? string
                  : system.assignable(property.value, boolean)
                    ? boolean
                    : undefined;
              if (primitive === undefined)
                unsupported(
                  target,
                  "realm-aggregate-update",
                  "logical property assignment requires a present primitive field",
                );
              expressions.set(target, property.value);
              const before = new Set(present),
                right = expression(node.value, owner, primitive);
              requireType(right, primitive, node.value);
              const checked = system.writeProperty(object, propertyName, right);
              if (!checked.ok)
                fail(target, checked.error, "invalid property assignment");
              invalidateCalls();
              present = intersect(before, present);
              result = primitive;
              break;
            }
            if (node.kind === "compound" && node.operator === "??") {
              const base = presentType(property.value) ?? property.value;
              const primitive = system.assignable(base, number)
                ? number
                : system.assignable(base, string)
                  ? string
                  : system.assignable(base, boolean)
                    ? boolean
                    : undefined;
              if (primitive === undefined)
                unsupported(
                  target,
                  "realm-aggregate-update",
                  "nullish property assignment requires an optional primitive field",
                );
              const optionalPrimitive = unionSubset(
                [primitive, undefinedType],
                node,
              );
              requireType(property.value, optionalPrimitive, target);
              expressions.set(target, property.value);
              const before = new Set(present),
                right = expression(node.value, owner, property.value);
              requireType(right, optionalPrimitive, node.value);
              const checked = system.writeProperty(object, propertyName, right);
              if (!checked.ok)
                fail(target, checked.error, "invalid property assignment");
              invalidateCalls();
              present = system.assignable(property.value, primitive)
                ? before
                : intersect(before, present);
              result =
                system.assignable(property.value, primitive) ||
                system.assignable(right, primitive)
                  ? primitive
                  : optionalPrimitive;
              break;
            }
            requireType(property.value, number, target);
            expressions.set(target, property.value);
            if (node.kind === "compound")
              requireType(expression(node.value, owner), number, node.value);
            checkFieldWrite(
              target,
              object,
              propertyName,
              number,
              "invalid property update",
            );
            invalidateCalls();
            result = number;
            break;
          }
          if (target.kind !== "identifier")
            fail(
              target,
              "UNSUPPORTED",
              "numeric updates require a local binding or numeric property",
            );
          const b = references.get(target);
          if (b === undefined)
            fail(target, "UNSUPPORTED", "global updates are unsupported");
          const declared = cell(b, { kind: "read" }, target, owner);
          const old = present.has(b.id)
            ? (presentType(declared) ?? declared)
            : declared;
          if (node.kind === "compound" && node.operator === "??") {
            const base = presentType(declared) ?? declared;
            const primitive = system.assignable(base, number)
              ? number
              : system.assignable(base, string)
                ? string
                : system.assignable(base, boolean)
                  ? boolean
                  : undefined;
            if (primitive === undefined) {
              // Any other `T | undefined` local: assigns when absent, and the
              // binding is present afterwards.
              const presentBase = presentType(declared);
              if (presentBase === undefined || mentionsNull(declared))
                unsupported(
                  target,
                  "operator-layout",
                  "nullish assignment requires an optional local without null",
                );
              expressions.set(target, old);
              const before = new Set(present);
              const right = expression(node.value, owner, presentBase);
              requireType(right, declared, node.value);
              cell(b, { kind: "write", value: right }, target, owner);
              const assigned = system.assignable(right, presentBase);
              if (system.assignable(old, presentBase)) present = before;
              else {
                const skipped = new Set(before);
                skipped.add(b.id);
                present = alternateFacts(present, skipped, node);
              }
              if (assigned) present.add(b.id);
              result =
                system.assignable(old, presentBase) || assigned
                  ? presentBase
                  : declared;
              break;
            }
            const optionalPrimitive = unionSubset(
              [primitive, undefinedType],
              node,
            );
            requireType(old, optionalPrimitive, target);
            expressions.set(target, old);
            const before = new Set(present);
            const right = expression(node.value, owner, declared);
            requireType(right, optionalPrimitive, node.value);
            cell(b, { kind: "write", value: right }, target, owner);
            if (system.assignable(old, primitive)) present = before;
            else {
              const skipped = new Set(before);
              skipped.add(b.id);
              present = alternateFacts(present, skipped, node);
            }
            result =
              system.assignable(old, primitive) ||
              system.assignable(right, primitive)
                ? primitive
                : optionalPrimitive;
            break;
          }
          if (
            node.kind === "compound" &&
            (node.operator === "&&" || node.operator === "||")
          ) {
            const primitive = system.assignable(old, number)
              ? number
              : system.assignable(old, string)
                ? string
                : system.assignable(old, boolean)
                  ? boolean
                  : undefined;
            if (primitive === undefined)
              unsupported(
                target,
                "operator-layout",
                "logical assignment requires a present primitive local",
              );
            expressions.set(target, old);
            const before = new Set(present);
            requireType(expression(node.value, owner), primitive, node.value);
            present = intersect(before, present);
            cell(b, { kind: "write", value: primitive }, target, owner);
            result = primitive;
            break;
          }
          if (
            node.kind === "compound" &&
            node.operator === "+" &&
            system.assignable(old, string)
          ) {
            expressions.set(target, old);
            requireType(expression(node.value, owner), string, node.value);
            cell(b, { kind: "write", value: string }, target, owner);
            result = string;
            break;
          }
          requireType(old, number, target);
          expressions.set(target, old);
          if (node.kind === "compound")
            requireType(expression(node.value, owner), number, node.value);
          cell(b, { kind: "write", value: number }, target, owner);
          result = number;
          break;
        }
        case "assignment": {
          let target = node.target;
          while (target.kind === "group") target = target.expression;
          if (target.kind === "array" || target.kind === "object") {
            result = expression(node.value, owner);
            const targets = createKeyIndex<Span, Expression>(syntaxHash);
            const pattern = assignmentBinding(target, undefined, targets);
            initializeBindingPattern(
              pattern,
              node.value,
              result,
              owner,
              node,
              targets,
            );
            break;
          }
          if (target.kind === "identifier") {
            const b = references.get(target);
            if (b === undefined)
              fail(target, "UNSUPPORTED", "global assignment is unsupported");
            const targetType = bindingTypes[b.id];
            result = expression(node.value, owner, targetType);
            cell(b, { kind: "write", value: result }, target, owner);
            // Assignment narrows, as in TypeScript: the binding is present
            // exactly when the assigned value cannot be undefined.
            const presentAfter = presentType(bindingTypes[b.id]);
            if (presentAfter !== undefined) {
              if (assignsPresent(node.value, result, presentAfter))
                present.add(b.id);
              else present.delete(b.id);
            }
            if (
              targetType !== undefined &&
              declared.has(b.node) &&
              dynamicObject(presentType(targetType, true) ?? targetType)
            )
              dynamicEnrollments.set(node.value, targetType);
          } else if (target.kind === "member" || target.kind === "index") {
            const receiver = expression(target.object, owner);
            const receiverType = types[receiver];
            if (
              receiverType?.kind === "object" &&
              receiverType.realmLibrary !== undefined
            )
              unsupported(
                target,
                "realm-aggregate-update",
                "Realm property write on " +
                  receiverType.realmLibrary +
                  " requires library mutability lowering",
                true,
              );
            const keyType =
              target.kind === "index"
                ? expression(target.index, owner)
                : undefined;
            const property =
              target.kind === "member"
                ? target.property
                : checkedPropertyName(
                    target.index,
                    keyType === undefined ? undefined : types[keyType],
                  );
            if (dynamicObject(receiver)) {
              const fields = dynamicPropertyTargets(
                receiver,
                keyType,
                property,
                target,
              );
              const field = fields[0];
              if (field === undefined) throw "dynamic write field invariant";
              result = expression(
                node.value,
                owner,
                dynamicPayloadType(field.type, node.value),
              );
              checkDynamicPayload(result, node.value, field.type);
              for (const allowed of fields) {
                if (allowed === undefined)
                  throw "dynamic write field invariant";
                if (allowed.readonly)
                  fail(
                    target,
                    "IMMUTABLE",
                    "cannot write a readonly dynamic-key object property",
                    true,
                  );
                if (
                  !system.assignable(
                    result,
                    dynamicPayloadType(allowed.type, node.value),
                  )
                )
                  fail(
                    node.value,
                    "TYPE_MISMATCH",
                    "dynamic-key object property value does not match its declared type",
                    true,
                  );
              }
              intrinsics.set(node, "dynamic-object-write");
              invalidateCalls();
              break;
            }
            const shape = types[receiver];
            if (shape?.kind === "array" && shape.realmArray === true) {
              if (shape.readonly || shape.tupleElements !== undefined)
                fail(
                  target,
                  "IMMUTABLE",
                  "cannot write a readonly realm array",
                  true,
                );
              if (property !== "length") {
                if (target.kind !== "index" || keyType === undefined)
                  unsupported(
                    target,
                    "realm-aggregate-update",
                    "realm array writes require an index or length",
                    true,
                  );
                requireType(keyType, number, target.index);
              }
              const expected = property === "length" ? number : shape.element;
              result = expression(node.value, owner, expected);
              requireType(result, expected, node.value);
              intrinsics.set(node, "dynamic-object-write");
              invalidateCalls();
              break;
            }
            const viewWrite = viewAccess(
              target,
              receiver,
              property,
              keyType,
              true,
            );
            if (viewWrite !== undefined) {
              const member = viewUseType(viewWrite, target);
              result = expression(node.value, owner, member);
              requireType(result, member, node.value);
              break;
            }
            const finite =
              target.kind === "index" && keyType !== undefined
                ? finiteRecordKeys(receiver, keyType)
                : undefined;
            if (finite !== undefined) {
              result = expression(node.value, owner);
              for (const name of finite) {
                if (name === undefined) throw "finite record key invariant";
                const write = system.writeProperty(receiver, name, result);
                if (!write.ok)
                  fail(
                    target,
                    write.error,
                    "invalid finite record property write",
                    true,
                  );
              }
              if (realmAggregate(receiver))
                intrinsics.set(node, "dynamic-object-write");
              else finitePropertyKeys.set(node, finite);
              invalidateCalls();
              break;
            }
            if (isList(receiver) && property === "length") {
              requireMutableList(receiver, target.object);
              result = expression(node.value, owner, number);
              requireType(result, number, node.value);
              intrinsics.set(node, "list-resize");
              invalidateCalls();
              break;
            }
            if (
              target.kind === "member" ||
              (!isList(receiver) &&
                !isArray(receiver) &&
                property !== undefined)
            ) {
              if (property === undefined)
                throw "literal property name invariant";
              const read = system.property(receiver, property);
              if (!read.ok)
                fail(target, read.error, "invalid property assignment");
              result = expression(node.value, owner, read.value);
              checkFieldWrite(
                target,
                receiver,
                property,
                result,
                "invalid property assignment",
              );
              intrinsics.set(
                node,
                realmAggregate(receiver)
                  ? "dynamic-object-write"
                  : "record-write",
              );
              invalidateCalls();
            } else {
              if (isList(receiver)) requireMutableList(receiver, target.object);
              else requireArray(receiver, target.object);
              if (keyType === undefined) throw "index type invariant";
              requireType(keyType, number, target.index);
              const element = isList(receiver)
                ? listElement(receiver, target.object)
                : arrayElementType(receiver);
              result = expression(node.value, owner, element);
              requireType(result, element, node.value);
              intrinsics.set(
                node,
                isList(receiver) ? "list-write" : "array-write",
              );
            }
          } else
            fail(target, "UNSUPPORTED", "assignment target is unsupported");
          break;
        }
        case "binary": {
          if (node.operator === "in") {
            const key = expression(node.left, owner);
            const object = expression(node.right, owner);
            if (dynamicObject(object)) {
              dynamicPropertyTargets(object, key, undefined, node.left);
              intrinsics.set(node, "dynamic-object-has");
            } else if (isList(object) && system.assignable(key, number)) {
              intrinsics.set(node, "list-has");
            } else {
              if (!membershipObject(object))
                fail(
                  node.right,
                  "TYPE_MISMATCH",
                  "in requires a known object operand",
                );
              if (checkedPropertyName(node.left, types[key]) === undefined)
                unsupported(
                  node.left,
                  "operator-layout",
                  "native in requires a literal property key",
                );
              intrinsics.set(node, "literal-property-has");
            }
            result = boolean;
            break;
          }
          if (node.operator === "instanceof") {
            const operand = expression(node.left, owner);
            const constructor = expression(node.right, owner);
            if (!validInstanceofOperand(operand))
              fail(
                node.left,
                "TYPE_MISMATCH",
                "instanceof requires an object or unknown operand",
              );
            const candidate = instanceofCandidate(
              constructor,
              operand,
              node.right,
            );
            if (candidate !== undefined) instanceofTypes.set(node, candidate);
            const target = ungroup(node.right);
            if (
              target.kind === "identifier" &&
              !references.has(target) &&
              realmConstructorInstance(target.name) !== undefined
            ) {
              if (
                isErrorKind(target.name) ||
                (candidate !== undefined &&
                  isArray(candidate) &&
                  types[candidate]?.kind !== "object")
              ) {
                intrinsics.delete(target);
                intrinsics.set(
                  node,
                  target.name === "TypeError"
                    ? "type-error-is"
                    : target.name === "RangeError"
                      ? "range-error-is"
                      : target.name === "Error"
                        ? "error-is"
                        : "array-instanceof",
                );
              } else intrinsics.set(node, "realm-instanceof");
            } else intrinsics.set(node, "realm-instanceof");
            result = boolean;
            break;
          }
          if (node.operator === ",") {
            expression(node.left, owner);
            result = expression(node.right, owner, expected);
            break;
          }
          if (
            node.operator === "&&" ||
            node.operator === "||" ||
            node.operator === "??"
          ) {
            const left = expression(node.left, owner),
              before = new Set(present);
            if (isVoidExpression(left))
              fail(node.left, "TYPE_MISMATCH", "void is not a logical operand");
            if (node.operator === "??" && !nullable(left)) {
              // A left operand that is never nullish is the result; the
              // right operand is checked but never evaluated (TypeScript
              // accepts this, e.g. `block?.instructions ?? []` on a T element).
              expression(node.right, owner, expected ?? left);
              present = before;
              result = left;
              break;
            }
            if (node.operator === "??") {
              if (
                left !== nullType &&
                !system.assignable(left, optionalNumber) &&
                presentType(left, true) === undefined
              )
                unsupported(
                  node.left,
                  "operator-layout",
                  "nullish coalescing requires a supported optional value",
                );
              const fallback = ungroup(node.right);
              const emptyArray =
                fallback.kind === "array" && fallback.elements.length === 0;
              const right = expression(
                node.right,
                owner,
                expected ?? (emptyArray ? presentType(left, true) : undefined),
              );
              if (isVoidExpression(right))
                fail(
                  node.right,
                  "TYPE_MISMATCH",
                  "void is not a logical operand",
                );
              present = left === number ? before : intersect(before, present);
              result =
                left === number
                  ? number
                  : left === undefinedType || left === nullType
                    ? right
                    : join(
                        presentType(left, true) ?? number,
                        right,
                        node,
                        expected,
                      );
            } else {
              const truth = node.operator === "&&";
              present = refine(node.left, truth, before);
              const right = expression(node.right, owner, expected);
              if (isVoidExpression(right))
                fail(
                  node.right,
                  "TYPE_MISMATCH",
                  "void is not a logical operand",
                );
              present = alternateFacts(
                present,
                refine(node.left, !truth, before),
                node,
              );
              result = join(left, right, node, expected);
            }
            break;
          }
          const left = expression(node.left, owner),
            right = expression(node.right, owner);
          if (
            (isVoidExpression(left) || isVoidExpression(right)) &&
            !(
              ["===", "!==", "==", "!="].includes(node.operator) &&
              (isVoidExpression(left) ||
                left === undefinedType ||
                left === nullType ||
                types[left]?.kind === "unknown") &&
              (isVoidExpression(right) ||
                right === undefinedType ||
                right === nullType ||
                types[right]?.kind === "unknown")
            )
          )
            fail(
              node,
              "TYPE_MISMATCH",
              "void result cannot be a binary operand",
            );
          const leftBigInt = system.assignable(left, bigint),
            rightBigInt = system.assignable(right, bigint);
          if (["===", "!==", "==", "!="].includes(node.operator)) {
            // BigInts compare by value, which lowering does for two bigint
            // operands; a possibly absent BigInt may be tested only against
            // undefined or null (a presence test, no value comparison).
            if (
              (mentionsBigInt(left) || mentionsBigInt(right)) &&
              !(leftBigInt && rightBigInt) &&
              ![left, right].some(
                (type) => type === undefinedType || type === nullType,
              )
            )
              fail(
                node,
                "UNSUPPORTED",
                "BigInt equality requires two bigint operands or a test against undefined or null",
              );
            result = boolean;
          } else if (
            node.operator === "+" &&
            (system.assignable(left, string) ||
              system.assignable(right, string)) &&
            [left, right].every(
              (t) =>
                system.assignable(t, string) ||
                system.assignable(t, number) ||
                system.assignable(t, boolean) ||
                system.assignable(t, bigint),
            )
          )
            result = string;
          else if (
            ["<", ">", "<=", ">="].includes(node.operator) &&
            (leftBigInt || rightBigInt) &&
            [left, right].every(
              (t) =>
                system.assignable(t, bigint) || system.assignable(t, number),
            )
          )
            // BigInt comparisons are exact, also against a Number (no
            // rounding through binary64; NaN is unordered).
            result = boolean;
          else if (
            ["+", "-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>"].includes(
              node.operator,
            ) &&
            (leftBigInt || rightBigInt)
          ) {
            // Mixing BigInt and Number throws a TypeError in JavaScript and
            // is a type error in TypeScript: both operands must be bigint.
            requireType(left, bigint, node.left);
            requireType(right, bigint, node.right);
            result = bigint;
          } else if (node.operator === ">>>" && (leftBigInt || rightBigInt))
            fail(
              node,
              "TYPE_MISMATCH",
              "BigInt values have no unsigned right shift",
            );
          else if (
            ["<", ">", "<=", ">="].includes(node.operator) &&
            system.assignable(left, string) &&
            system.assignable(right, string)
          )
            result = boolean;
          else if (
            [
              "+",
              "-",
              "*",
              "/",
              "%",
              "|",
              "&",
              "^",
              "<<",
              ">>",
              ">>>",
              "<",
              ">",
              "<=",
              ">=",
            ].includes(node.operator)
          ) {
            requireType(left, number, node.left);
            requireType(right, number, node.right);
            result = ["<", ">", "<=", ">="].includes(node.operator)
              ? boolean
              : number;
          } else
            unsupported(
              node,
              "operator-layout",
              "unsupported binary operator: " + node.operator,
            );
          break;
        }
        case "unary": {
          if (node.operator === "delete") {
            const target = ungroup(node.operand);
            if (target.kind === "member" || target.kind === "index") {
              const object = chainReceiver(
                target.object,
                target.optional === true,
              );
              if (dynamicObject(object)) {
                const key =
                  target.kind === "index"
                    ? expression(target.index, owner)
                    : undefined;
                const name =
                  target.kind === "member"
                    ? target.property
                    : key === undefined
                      ? undefined
                      : checkedPropertyName(target.index, types[key]);
                const fields = dynamicPropertyTargets(
                  object,
                  key,
                  name,
                  target,
                );
                const field = fields[0];
                if (field === undefined) throw "dynamic delete field invariant";
                if (fields.some((allowed) => allowed?.readonly === true))
                  fail(
                    target,
                    "IMMUTABLE",
                    "cannot delete a readonly dynamic-key object property",
                    true,
                  );
                if (fields.length === 1 && !field.optional)
                  fail(
                    target,
                    "PROPERTY",
                    "cannot delete a required dynamic-key object property",
                    true,
                  );
                intrinsics.set(node, "dynamic-object-delete");
                result = boolean;
                break;
              }
            }
          }
          const value = expression(
            node.operand,
            owner,
            undefined,
            false,
            node.operator === "void",
          );
          if (
            isVoidExpression(value) &&
            node.operator !== "typeof" &&
            node.operator !== "void"
          )
            fail(
              node,
              "TYPE_MISMATCH",
              "void result cannot be a unary operand",
            );
          if (node.operator === "void") result = undefinedType;
          else if (node.operator === "typeof") result = string;
          else if (node.operator === "!") result = boolean;
          else if (
            (node.operator === "-" || node.operator === "~") &&
            system.assignable(value, bigint)
          )
            result = bigint;
          else if (["+", "-", "~"].includes(node.operator)) {
            // Unary plus on a BigInt throws a TypeError: it requires number.
            requireType(value, number, node);
            result = number;
          } else
            unsupported(
              node,
              "operator-layout",
              "unary operation is unsupported",
            );
          break;
        }
        case "conditional": {
          condition(node.test, owner);
          const before = new Set(present);
          const consequent = ungroup(node.consequent),
            alternate = ungroup(node.alternate);
          const emptyYes =
            consequent.kind === "array" && consequent.elements.length === 0;
          const emptyNo =
            alternate.kind === "array" && alternate.elements.length === 0;
          if (expected === undefined && emptyYes && !emptyNo) {
            present = refine(node.test, false, before);
            const no = expression(node.alternate, owner),
              afterNo = present;
            present = refine(node.test, true, before);
            const yes = expression(node.consequent, owner, no);
            present = alternateFacts(present, afterNo, node);
            result = join(yes, no, node, undefined, preserveContext);
          } else {
            present = refine(node.test, true, before);
            const yes = expression(
                node.consequent,
                owner,
                expected,
                preserveContext,
              ),
              afterYes = present;
            present = refine(node.test, false, before);
            const no = expression(
              node.alternate,
              owner,
              expected ?? (emptyNo ? yes : undefined),
              preserveContext,
            );
            present = alternateFacts(afterYes, present, node);
            if (preserveContext && expected !== undefined) {
              requireType(
                contextualProofs.get(node.consequent) ?? yes,
                expected,
                node.consequent,
              );
              requireType(
                contextualProofs.get(node.alternate) ?? no,
                expected,
                node.alternate,
              );
              contextualProofs.set(node, expected);
              result = join(yes, no, node, undefined, preserveContext);
            } else result = join(yes, no, node, expected, preserveContext);
          }
          break;
        }
        default:
          return fail(
            node,
            "UNSUPPORTED",
            "expression is outside the closure checking slice",
          );
      }
      if (node.kind === "call" && result === voidType && !discarded) {
        voidValueCalls.set(node, true);
        result = generalFact("void-value", node);
      }
      if (selected) {
        result = realmPayload(result, node);
        if (node.kind === "array")
          intrinsics.set(node, "dynamic-object-array-literal");
        if (node.kind === "object")
          intrinsics.set(node, "dynamic-object-open-literal");
      }
      const skippedFacts = skipped;
      if (skippedFacts !== undefined) {
        chainValues.set(node, result);
        present = intersect(skippedFacts, present);
        if (result !== voidType && !system.assignable(undefinedType, result))
          result = unionSubset([result, undefinedType], node);
      } else chainValues.delete(node);
      if (
        expected !== undefined &&
        types[result]?.kind === "dynamic-result" &&
        !system.assignable(result, expected)
      ) {
        if (!downcastable(expected))
          unsupported(
            node,
            "general-result-projection",
            "general call result requires a checked projection to its declared type",
            true,
          );
        downcasts.set(node, expected);
        result = expected;
      }
      const literal = literals.get(ungroup(node));
      if (
        expected !== undefined &&
        literal !== undefined &&
        (!system.assignable(result, expected) ||
          (preserveContext && node.kind === "boolean"))
      ) {
        const exact = typeOf(literal);
        if (system.assignable(exact, expected)) result = exact;
      }
      if (inputExpected !== undefined)
        recordTypeFlow(result, inputExpected, node);
      if (
        instancePropertyNarrowing &&
        (node.kind === "assignment" ||
          node.kind === "compound" ||
          node.kind === "update")
      ) {
        const target = ungroup(node.target);
        if (target.kind === "member" || target.kind === "index") {
          const path = stablePath(target);
          if (path !== undefined)
            invalidatePropertyFacts(path.binding.id, path.property);
          else {
            const parent = stablePath(target.object);
            if (parent !== undefined)
              invalidatePropertyFacts(parent.binding.id, parent.property);
          }
        }
      }
      expressions.set(node, result);
      return result;
    } finally {
      depth--;
    }
  }
  function constPrimitiveType(input: Expression): number | undefined {
    const node = ungroup(input);
    const literal = literals.get(node);
    if (literal !== undefined) return typeOf(literal);
    if (node.kind !== "conditional") return undefined;
    const yes = constPrimitiveType(node.consequent);
    const no = constPrimitiveType(node.alternate);
    return yes === undefined || no === undefined
      ? undefined
      : unionSubset([yes, no], node);
  }
  const breakTargets: (Set<number>[] | undefined)[] = [];
  function loopBody(
    node: Statement,
    owner: number | undefined,
    result: number,
  ): number {
    breakTargets.push(undefined);
    try {
      return statement(node, owner, result);
    } finally {
      breakTargets.pop();
    }
  }
  function unconditionalTest(node: Expression): boolean {
    return node.kind === "boolean" && node.value;
  }
  // Completion sets preserve return and throw separately for handlers/finalizers.
  function sequence(
    nodes: readonly Statement[],
    owner: number | undefined,
    result: number,
  ): number {
    let completion = 1;
    for (const node of nodes) {
      if (node === undefined) throw "missing statement";
      const reachable = (completion & 1) !== 0,
        before = reachable ? undefined : new Set(present),
        done = statement(node, owner, result);
      if (reachable) completion = sequenceCompletion(completion, done);
      else if (before !== undefined) present = before;
    }
    return completion;
  }
  function initializeIteration(
    node: Span,
    element: number,
    owner: number | undefined,
    varMode: boolean,
  ): void {
    const b = binding(node);
    if (varMode) {
      const type =
        bindingTypes[b.id] ?? unionSubset([element, undefinedType], node);
      bindingTypes[b.id] = type;
      if (b.kind === "var" && !system.assignable(undefinedType, type))
        deferred.add(b.id);
    } else bindingTypes[b.id] = element;
    cell(
      b,
      { kind: varMode ? "write" : "initialize", value: element },
      node,
      owner,
    );
  }
  function heldPatternValue(type: number, node: Span): Expression {
    const held: Expression = {
      kind: "identifier",
      name: "",
      start: node.start,
      end: node.end,
      nodeHash: syntheticNodeHash(),
    };
    patternValues.set(held, type);
    expressions.set(held, type);
    return held;
  }
  function assignmentBinding(
    input: Expression,
    initializer: Expression | undefined,
    targets: KeyIndex<Span, Expression>,
  ): VariableBinding {
    const target = ungroup(input);
    const span: Span = {
      start: target.start,
      end: target.end,
      nodeHash: syntheticNodeHash(),
    };
    if (target.kind === "assignment")
      return assignmentBinding(target.target, target.value, targets);
    if (target.kind === "array") {
      const elements: (VariableBinding | undefined)[] = [];
      let rest: VariableBinding | undefined;
      for (const item of target.elements) {
        if (item === undefined) throw "assignment pattern element invariant";
        if (item.kind === "elision") elements.push(undefined);
        else if (item.kind === "spread")
          rest = assignmentBinding(item.value, undefined, targets);
        else elements.push(assignmentBinding(item, undefined, targets));
      }
      return {
        ...span,
        kind: "array-binding",
        elements,
        initializer,
        type: undefined,
        ...(rest === undefined ? {} : { rest }),
      };
    }
    if (target.kind === "object") {
      const properties: ObjectBindingProperty[] = [];
      let rest: SyntaxBinding | undefined;
      for (const property of target.properties) {
        if (property === undefined)
          throw "assignment pattern property invariant";
        const child = assignmentBinding(property.value, undefined, targets);
        if (property.kind === "spread") {
          if (child.kind === "array-binding" || child.kind === "object-binding")
            throw "object assignment rest invariant";
          rest = child;
        } else
          properties.push({
            start: property.start,
            end: property.end,
            nodeHash: syntheticNodeHash(),
            name: property.name,
            binding: child,
            ...(property.keyExpression === undefined
              ? {}
              : { keyExpression: property.keyExpression }),
          });
      }
      return {
        ...span,
        kind: "object-binding",
        properties,
        rest,
        initializer,
        type: undefined,
      };
    }
    const binding: SyntaxBinding = {
      ...span,
      name: "",
      initializer,
      type: undefined,
    };
    targets.set(binding, target);
    return binding;
  }
  function patternWrites(): Set<number> {
    const known = writablePatternCandidates;
    if (known !== undefined) return known;
    const writable = new Set<number>();
    for (const reference of graph.references)
      if (
        reference !== undefined &&
        reference.binding !== undefined &&
        reference.access !== "read"
      )
        writable.add(reference.binding);
    writablePatternCandidates = writable;
    return writable;
  }
  function initializeBindingPattern(
    pattern: VariableBinding,
    input: Expression | undefined,
    type: number,
    owner: number | undefined,
    site: Span = pattern,
    assignments?: ReadonlyKeyIndex<Span, Expression>,
    unchecked: boolean = false,
    annotated: boolean = pattern.type !== undefined,
  ): void {
    const steps: BindingInitializationStep[] = [];
    const root = heldPatternValue(type, pattern);
    function bindChild(
      child: VariableBinding,
      read: Expression,
      readType: number,
      array?: ArrayBindingRead,
      computedKey?: Expression,
      realmObject?: Expression,
      realmRest?: Expression,
    ): void {
      const initializer = child.initializer;
      let type = readType;
      if (initializer !== undefined) {
        const before = new Set(present);
        const defined = presentType(readType);
        const initial = expression(initializer, owner, defined);
        if (readType === undefinedType) type = initial;
        else if (defined !== undefined) {
          type = unionSubset([defined, initial], child);
          present = intersect(before, present);
        } else if (system.assignable(undefinedType, readType)) {
          type = unionSubset([readType, initial], child);
          present = intersect(before, present);
        } else {
          type = unionSubset([readType, initial], child);
          present = before;
        }
      }
      const target = heldPatternValue(type, child);
      const destination = assignments?.get(child);
      let assignment: Expression | undefined;
      let local: SyntaxBinding | undefined;
      if (destination !== undefined) {
        assignment = {
          kind: "assignment",
          target: destination,
          value: target,
          start: child.start,
          end: child.end,
          nodeHash: syntheticNodeHash(),
        };
        expression(assignment, owner);
      } else if (
        child.kind === "object-binding" ||
        child.kind === "array-binding"
      ) {
        steps.push({
          read,
          initializer,
          target,
          binding: undefined,
          ...(array === undefined ? {} : { array }),
          ...(computedKey === undefined ? {} : { computedKey }),
          ...(realmObject === undefined ? {} : { realmObject }),
        });
        project(child, target, type);
        return;
      } else {
        const b = binding(child);
        if (!annotated && b.mutable && types[type]?.kind === "union") {
          if (patternWrites().has(b.id)) {
            openPatternBindings.add(b.id);
            bindingTypes[b.id] = appendType(
              { kind: "unknown" },
              child,
              "invalid open binding type",
            );
          } else bindingTypes[b.id] = type;
        } else bindingTypes[b.id] = type;
        cell(b, { kind: "initialize", value: type }, child, owner);
        local = child;
      }
      steps.push({
        read,
        initializer,
        target,
        binding: local,
        ...(array === undefined ? {} : { array }),
        ...(assignment === undefined ? {} : { assignment }),
        ...(computedKey === undefined ? {} : { computedKey }),
        ...(realmObject === undefined ? {} : { realmObject }),
        ...(realmRest === undefined ? {} : { realmRest }),
      });
    }
    function realmAction(
      action: "object" | "iterator" | "skip" | "close",
      source: Expression,
    ): void {
      needsBindingRealm = true;
      bindingRealm.set(site, true);
      steps.push({
        read: source,
        target: source,
        initializer: undefined,
        binding: undefined,
        realmAction: action,
      });
    }
    function project(
      pattern: VariableBinding,
      source: Expression,
      type: number,
    ): void {
      const general = unchecked && types[type]?.kind === "unknown";
      if (
        !general &&
        (system.assignable(undefinedType, type) ||
          system.assignable(nullType, type))
      )
        fail(
          pattern,
          "TYPE_MISMATCH",
          "binding pattern source may be null or undefined",
          true,
        );
      if (pattern.kind === "object-binding") {
        const realm = general || dynamicObject(type) || realmAggregate(type);
        if (realm) realmAction("object", source);
        const excluded: string[] = [];
        for (const property of pattern.properties) {
          if (property === undefined) throw "binding property invariant";
          const key = property.keyExpression;
          const read: Expression =
            key === undefined
              ? {
                  kind: "member",
                  object: source,
                  property: property.name,
                  start: property.start,
                  end: property.end,
                  nodeHash: syntheticNodeHash(),
                }
              : {
                  kind: "index",
                  object: source,
                  index: key,
                  start: property.start,
                  end: property.end,
                  nodeHash: syntheticNodeHash(),
                };
          let result: number;
          if (general) {
            if (key !== undefined) expression(key, owner);
            intrinsics.set(read, "dynamic-object-read");
            expressions.set(read, type);
            result = type;
          } else result = expression(read, owner);
          if (pattern.rest !== undefined) {
            const name =
              key === undefined
                ? property.name
                : checkedPropertyName(key, types[expressions.get(key) ?? -1]);
            if (name !== undefined) excluded.push(name);
            else if (!realm)
              unsupported(
                property,
                "aggregate-spread",
                "computed object rest requires runtime key exclusion",
                true,
              );
          }
          bindChild(
            property.binding,
            read,
            result,
            undefined,
            key,
            realm && pattern.rest !== undefined ? source : undefined,
          );
        }
        const rest = pattern.rest;
        if (rest !== undefined) {
          const shape = types[type];
          if (
            !realm &&
            (shape?.kind !== "object" ||
              contracts.classes.some(
                (entry) => entry !== undefined && entry.instance === type,
              ))
          )
            unsupported(
              rest,
              "aggregate-spread",
              "typed object rest requires a native record with data fields",
              true,
            );
          const properties: Property[] = [];
          for (const field of shape?.kind === "object"
            ? shape.properties
            : []) {
            if (field === undefined) throw "binding rest property invariant";
            if (!excluded.includes(field.name))
              properties.push({ ...field, readonly: false });
          }
          const index =
            shape?.kind === "object" ? shape.stringIndex : undefined;
          const restType = general
            ? type
            : appendType(
                {
                  kind: "object",
                  properties,
                  ...(index === undefined
                    ? {}
                    : { stringIndex: { ...index, readonly: false } }),
                  ...(realm ? { realmRecord: true } : {}),
                },
                rest,
                "invalid object rest type",
              );
          if (realm) {
            const read = heldPatternValue(restType, rest);
            bindChild(
              rest,
              read,
              restType,
              undefined,
              undefined,
              undefined,
              source,
            );
            return;
          }
          const read: Expression = {
            kind: "object",
            properties: [
              {
                kind: "spread",
                value: source,
                start: rest.start,
                end: rest.end,
              },
            ],
            start: rest.start,
            end: rest.end,
            nodeHash: syntheticNodeHash(),
          };
          expressions.set(read, restType);
          bindingRestExclusions.set(read, excluded);
          bindChild(rest, read, restType);
        }
      } else if (pattern.kind === "array-binding") {
        const shape = types[type];
        const list =
          isList(type) && shape?.kind === "array" && shape.realmArray !== true;
        const iteratorElement =
          shape?.kind === "object" ? shape.iteratorElement : undefined;
        const realm =
          general ||
          iteratorElement !== undefined ||
          (shape?.kind === "array" && shape.realmArray === true) ||
          system.assignable(type, string);
        if (realm) {
          const rawElementType = general
            ? type
            : (iteratorElement ??
              (shape?.kind === "array" ? shape.element : string));
          const elementType = realmPayload(rawElementType, pattern);
          const unsupported = unsupportedDynamicPayload(types, elementType);
          if (unsupported !== undefined)
            fail(
              pattern,
              "UNSUPPORTED",
              unsupported.message,
              true,
              fallbackAt(pattern, unsupported.capability),
            );
          const readType = system.assignable(undefinedType, elementType)
            ? elementType
            : unionSubset([elementType, undefinedType], pattern);
          realmAction("iterator", source);
          for (const element of pattern.elements) {
            if (element === undefined) realmAction("skip", source);
            else {
              const read = heldPatternValue(readType, element);
              bindChild(element, read, readType, {
                source,
                position: 0,
                rest: false,
                inBounds: false,
                realm: true,
              });
            }
          }
          const rest = pattern.rest;
          if (rest !== undefined) {
            const type = general
              ? elementType
              : realmPayload(arrayOf(elementType, rest), rest);
            const read = heldPatternValue(type, rest);
            bindChild(rest, read, type, {
              source,
              position: 0,
              rest: true,
              inBounds: false,
              realm: true,
            });
          }
          realmAction("close", source);
          return;
        }
        if (!list && !isArray(type))
          fail(
            pattern,
            "UNSUPPORTED",
            "typed array binding requires a native list, numeric typed array, string, or realm iterable",
            true,
          );
        const readType = list ? listReadType(type, pattern) : optionalNumber;
        const origin =
          source === root && input !== undefined ? ungroup(input) : undefined;
        const fixedElements =
          origin?.kind === "array" &&
          !origin.elements.some((item) => item.kind === "spread")
            ? origin.elements
            : undefined;
        for (let position = 0; position < pattern.elements.length; position++) {
          const element = pattern.elements[position];
          if (element === undefined) continue;
          const fixed = fixedElements?.[position];
          const elementType =
            fixed === undefined
              ? readType
              : fixed.kind === "elision"
                ? undefinedType
                : (expressions.get(fixed) ?? readType);
          const read = heldPatternValue(elementType, element);
          bindChild(element, read, elementType, {
            source,
            position,
            rest: false,
            inBounds:
              fixed !== undefined &&
              fixed.kind !== "elision" &&
              elementType !== undefinedType,
          });
        }
        const rest = pattern.rest;
        if (rest !== undefined) {
          const restType = arrayOf(list ? readType : number, rest);
          const read = heldPatternValue(restType, rest);
          bindChild(rest, read, restType, {
            source,
            position: pattern.elements.length,
            rest: true,
            inBounds: false,
          });
        }
      } else throw "binding pattern invariant";
    }
    project(pattern, root, type);
    bindingInitializations.set(site, { input, root, steps });
  }
  let patternedThrow = false;
  let patternedThrowOwner: number | undefined;
  function statement(
    input: Statement,
    owner: number | undefined,
    result: number,
  ): number {
    const node = input;
    if (++depth > 256)
      fail(node, "LIMIT", "closure checking nesting limit exceeded");
    try {
      switch (node.kind) {
        case "class":
          checkClass(node, owner);
          return 1;
        case "block": {
          return sequence(node.statements, owner, result);
        }
        case "variable":
          for (const d of node.declarations) {
            if (d === undefined) throw "missing declaration";
            if (d.kind === "object-binding" || d.kind === "array-binding") {
              const initializer = d.initializer;
              if (node.mode === "var")
                fail(
                  d,
                  "UNSUPPORTED",
                  "typed binding patterns require let or const",
                );
              if (initializer === undefined)
                fail(
                  d,
                  "TYPE_MISMATCH",
                  "binding pattern requires an initializer",
                  true,
                );
              const annotation = declared.get(d);
              const expected =
                annotation === undefined ? undefined : typeOf(annotation);
              const actual = expression(initializer, owner, expected);
              if (expected !== undefined) {
                requireType(actual, expected, initializer);
                if (dynamicObject(expected))
                  dynamicEnrollments.set(initializer, expected);
              }
              initializeBindingPattern(
                d,
                initializer,
                expected ?? actual,
                owner,
              );
              continue;
            }
            const b = binding(d);
            if (node.mode === "var" && d.initializer === undefined) {
              continue;
            }
            if (deferred.has(b.id) && node.mode !== "var") {
              if (b.captured || b.owner === undefined)
                unsupported(
                  d,
                  "binding-initialization",
                  "deferred captured or module bindings require initialization support",
                );
              present.add(declaredToken(b.id));
              present.delete(assignedToken(b.id));
              continue;
            }
            const annotation = bindingTypes[b.id];
            if (annotation !== undefined && realmPlan?.bindings.has(b.id))
              bindingTypes[b.id] = realmPayload(annotation, d);
            const expected =
                bindingTypes[b.id] ??
                (node.mode === "const" && d.initializer !== undefined
                  ? constPrimitiveType(d.initializer)
                  : undefined),
              actual =
                d.initializer === undefined
                  ? undefinedType
                  : expression(d.initializer, owner, expected);
            if (bindingTypes[b.id] === undefined) bindingTypes[b.id] = actual;
            if (
              expected !== undefined &&
              d.initializer !== undefined &&
              intrinsics.get(ungroup(d.initializer)) === "array-read" &&
              !system.assignable(actual, expected)
            )
              fail(
                d,
                "TYPE_MISMATCH",
                "invalid binding operation",
                false,
                fallbackAt(d, "checked-index-read"),
              );
            if (
              b.kind === "var" &&
              !system.assignable(undefinedType, bindingTypes[b.id] ?? actual)
            )
              deferred.add(b.id);
            cell(
              b,
              {
                kind:
                  node.mode === "var" && b.kind !== "var"
                    ? "write"
                    : "initialize",
                value: actual,
              },
              d,
              owner,
            );
          }
          return 1;
        case "function": {
          const signature = signatures.get(node);
          const body = node.body;
          if (signature === undefined || body.kind !== "block")
            throw "named function invariant";
          const b = binding(node);
          const type = bindingTypes[b.id] ?? typeOf(signature);
          cell(b, { kind: "initialize", value: type }, node, owner);
          checkFunction(node, node.parameters, node.returnType, body, type);
          return 1;
        }
        case "try": {
          const definiteEntry = stableFacts();
          const handler = node.handler;
          const finalizer = node.finalizer;
          const invariant = stableFacts(definiteEntry, true);
          const priorPattern = patternedThrow;
          const priorOwner = patternedThrowOwner;
          if (handler !== undefined) {
            const caught = handler.binding;
            patternedThrow =
              caught?.kind === "object-binding" ||
              caught?.kind === "array-binding";
            patternedThrowOwner = owner;
          }
          let pending = statement(node.body, owner, result);
          patternedThrow = priorPattern;
          patternedThrowOwner = priorOwner;
          let normal = assignedFacts();
          if (handler !== undefined) {
            present = new Set(definiteEntry);
            if (handler.binding !== undefined) {
              const caught = handler.binding;
              if (
                caught.kind === "object-binding" ||
                caught.kind === "array-binding"
              ) {
                const type = declared.get(caught);
                if (type === undefined) throw "catch pattern type invariant";
                initializeBindingPattern(
                  caught,
                  undefined,
                  typeOf(type),
                  owner,
                  caught,
                  undefined,
                  true,
                );
              } else {
                const b = binding(caught),
                  type = bindingTypes[b.id];
                if (type === undefined) throw "catch type invariant";
                cell(b, { kind: "initialize", value: type }, caught, owner);
              }
            }
            const handled = statement(handler.body, owner, result);
            if ((handled & 1) !== 0)
              normal =
                (pending & 1) !== 0
                  ? intersect(normal, assignedFacts())
                  : assignedFacts();
            // Calls and property operations have not yet been proven nonthrowing.
            pending = catchCompletion(pending, handled, true);
          }
          if (finalizer !== undefined) {
            present = new Set(definiteEntry);
            pending = finallyCompletion(
              pending,
              statement(finalizer, owner, result),
            );
            // Finally runs on exceptional paths too, so its reads above use
            // entry facts. Assignments it guarantees also hold on continuation.
            for (const fact of assignedFacts()) normal.add(fact);
          }
          // A const binding cannot change across any completion path. Property
          // observations and mutable bindings do not have that guarantee.
          for (const fact of invariant) normal.add(fact);
          present = (pending & 1) !== 0 ? normal : new Set(definiteEntry);
          return pending;
        }
        case "return": {
          if (owner !== undefined && node.expression !== undefined)
            realmReturnOwners.set(node, owner);
          const inferred =
            owner === undefined ? undefined : inferredReturns.get(owner);
          const actual =
            node.expression === undefined
              ? undefinedType
              : expression(
                  node.expression,
                  owner,
                  inferred === undefined ? result : undefined,
                );
          if (inferred === undefined) {
            if (
              owner !== undefined &&
              result === voidType &&
              types[actual]?.kind === "void-value"
            )
              recordVoidReturn(owner, node.expression);
            requireType(
              actual === undefinedType && result === voidType
                ? voidType
                : actual,
              result,
              node,
            );
          } else {
            const absent = node.expression === undefined || actual === voidType;
            inferred.push(
              absent && result === voidType
                ? voidType
                : actual === voidType
                  ? undefinedType
                  : actual,
            );
          }
          return types[actual]?.kind === "never" ? throwCompletion : 2;
        }
        case "throw": {
          const value = node.expression;
          const type = expression(value, owner);
          if (patternedThrow && patternedThrowOwner === owner)
            checkDynamicPayload(type, value);
          return throwCompletion;
        }
        case "expression":
          // A never result cannot continue normally; it may throw or diverge.
          return types[
            expression(node.expression, owner, undefined, false, true)
          ]?.kind === "never"
            ? throwCompletion
            : 1;
        case "if": {
          condition(node.test, owner);
          const before = new Set(present);
          present = refine(node.test, true, before);
          const yes = statement(node.consequent, owner, result),
            afterYes = present;
          present = refine(node.test, false, before);
          const no =
            node.alternate === undefined
              ? 1
              : statement(node.alternate, owner, result);
          present =
            (yes & 1) === 0
              ? present
              : (no & 1) === 0
                ? afterYes
                : alternateFacts(afterYes, present, node);
          return yes | no;
        }
        case "switch": {
          const definiteEntry = entryFacts(node);
          const switchNode = node;
          condition(node.expression, owner);
          const before = new Set(present),
            pureTests =
              pure(node.expression) &&
              node.clauses.every((c) => c.test === undefined || pure(c.test));
          let unmatched = new Set(before);
          const entries: Set<number>[] = [];
          for (const clause of node.clauses) {
            if (clause === undefined) throw "missing switch clause";
            const clauseTest = clause.test;
            if (clauseTest === undefined) {
              entries.push(new Set<number>());
              continue;
            }
            present = new Set(unmatched);
            expression(clauseTest, owner);
            const test: Expression = {
              kind: "binary",
              operator: "===",
              left: node.expression,
              right: clauseTest,
              start: clause.start,
              end: clause.end,
            };
            entries.push(
              pureTests ? refine(test, true, unmatched) : new Set<number>(),
            );
            if (pureTests) unmatched = refine(test, false, unmatched);
          }
          let completion = 0,
            fallthrough: Set<number> | undefined,
            hasDefault = false;
          const exits: Set<number>[] = [];
          breakTargets.push(exits);
          try {
            for (let i = 0; i < node.clauses.length; i++) {
              const clause = node.clauses[i];
              if (clause === undefined) throw "switch clause invariant";
              const initialEntry = entries[i];
              if (initialEntry === undefined) throw "switch entry invariant";
              let entry: Set<number> = initialEntry;
              if (clause.test === undefined) {
                hasDefault = true;
                entry = pureTests ? unmatched : new Set<number>();
              }
              present =
                fallthrough === undefined
                  ? new Set(entry)
                  : alternateFacts(entry, fallthrough, clause);
              const done = sequence(clause.statements, owner, result);
              completion |= done & (10 | throwCompletion);
              if ((done & 4) !== 0) completion |= 1;
              fallthrough = (done & 1) !== 0 ? new Set(present) : undefined;
            }
          } finally {
            breakTargets.pop();
          }
          const exhaustive = hasDefault || coveredSwitch(switchNode);
          if (exhaustive) exhaustiveSwitches.add(node);
          if (!exhaustive || fallthrough !== undefined) completion |= 1;
          if (!exhaustive) exits.push(before);
          if (fallthrough !== undefined) exits.push(fallthrough);
          let assigned: Set<number> | undefined;
          for (const exit of exits) {
            if (exit === undefined) throw "missing switch exit";
            assigned =
              assigned === undefined ? exit : intersect(assigned, exit);
          }
          present = new Set(definiteEntry);
          if (assigned !== undefined)
            for (const fact of assigned) if (fact < 0) present.add(fact);
          return completion;
        }
        case "label": {
          const definiteEntry = entryFacts(node);
          const completion = statement(node.body, owner, result);
          // Labelled exits can bypass assignments in their body. Keep entry
          // facts until completion analysis tracks individual named targets.
          present = new Set(definiteEntry);
          return completion | 1;
        }
        case "do-while": {
          const definiteEntry = entryFacts(node);
          present = new Set(definiteEntry);
          const body = loopBody(node.body, owner, result);
          present = new Set(definiteEntry);
          condition(node.test, owner);
          present = new Set(definiteEntry);
          return loopCompletion(body, true, unconditionalTest(node.test));
        }
        case "while": {
          const definiteEntry = entryFacts(node);
          present = new Set(definiteEntry);
          condition(node.test, owner);
          present = refine(node.test, true, present);
          {
            const body = loopBody(node.body, owner, result);
            present = new Set(definiteEntry);
            return loopCompletion(body, false, unconditionalTest(node.test));
          }
        }
        case "for-in-assignment": {
          const iterable = expression(node.iterable, owner);
          requireForInObject(iterable, node.iterable);
          const definiteEntry = entryFacts(node);
          present = new Set(definiteEntry);
          const target = ungroup(node.target);
          if (target.kind === "identifier") {
            const binding = references.get(target);
            if (binding === undefined)
              fail(
                target,
                "UNSUPPORTED",
                "for-in requires a local assignment target",
              );
            expressions.set(
              target,
              cell(binding, { kind: "write", value: string }, target, owner),
            );
          } else if (target.kind === "member" || target.kind === "index") {
            const object = expression(target.object, owner);
            if (!dynamicObject(object))
              fail(
                target,
                "UNSUPPORTED",
                "for-in property assignment requires a dynamic-key object",
              );
            const keyType =
              target.kind === "index"
                ? expression(target.index, owner)
                : undefined;
            const name =
              target.kind === "member"
                ? target.property
                : keyType === undefined
                  ? undefined
                  : checkedPropertyName(target.index, types[keyType]);
            const fields = dynamicPropertyTargets(
              object,
              keyType,
              name,
              target,
            );
            for (const field of fields) {
              if (field === undefined) throw "for-in target field invariant";
              if (field.readonly)
                fail(
                  target,
                  "IMMUTABLE",
                  "cannot write a readonly dynamic-key object property",
                  true,
                );
              requireType(string, field.type, target);
            }
            invalidateCalls();
          } else
            fail(
              target,
              "UNSUPPORTED",
              "for-in requires a local or dynamic property assignment target",
            );
          const body = loopBody(node.body, owner, result);
          present = new Set(definiteEntry);
          return loopCompletion(body, false);
        }
        case "for-in": {
          const iterable = expression(node.iterable, owner);
          requireForInObject(iterable, node.iterable);
          const definiteEntry = entryFacts(node);
          present = new Set(definiteEntry);
          const binding = node.binding;
          if (
            binding.kind === "array-binding" ||
            binding.kind === "object-binding"
          )
            fail(
              binding,
              "UNSUPPORTED",
              "for-in binding patterns are not supported",
            );
          initializeIteration(binding, string, owner, node.mode === "var");
          const body = loopBody(node.body, owner, result);
          present = new Set(definiteEntry);
          return loopCompletion(body, false);
        }
        case "for-of": {
          if (node.await)
            unsupported(
              node,
              "async-suspension",
              "typed for-await lowering is not implemented",
            );
          const loopBinding = node.binding;
          // The iterable is evaluated once, under the incoming facts. Only
          // immutable object discriminants remain valid across iterations.
          const iterable = expression(node.iterable, owner);
          const definiteEntry = entryFacts(node);
          present = new Set(definiteEntry);
          const map = types[iterable];
          if (loopBinding.kind === "array-binding" && map?.kind === "map") {
            if (loopBinding.rest !== undefined)
              fail(
                loopBinding.rest,
                "UNSUPPORTED",
                "typed Map iteration rest requires entry pattern lowering",
              );
            for (let index = 0; index < loopBinding.elements.length; index++) {
              const element = loopBinding.elements[index];
              if (element === undefined) continue;
              if (
                element.kind === "array-binding" ||
                element.kind === "object-binding" ||
                element.initializer !== undefined
              )
                fail(
                  element,
                  "UNSUPPORTED",
                  "typed Map iteration requires a simple entry pattern",
                );
              const type =
                index === 0 ? map.key : index === 1 ? map.value : undefinedType;
              initializeIteration(element, type, owner, node.mode === "var");
            }
            const body = loopBody(node.body, owner, result);
            present = new Set(definiteEntry);
            return loopCompletion(body, false);
          }
          const set = types[iterable];
          const iterableSet = set?.kind === "set";
          if (
            !isArray(iterable) &&
            !isList(iterable) &&
            !iterableSet &&
            !system.assignable(iterable, string)
          )
            fail(
              node.iterable,
              "UNSUPPORTED",
              "for-of currently requires a string, typed array, supported array or set",
            );
          // List elements are typed T, as in TypeScript; reading a hole as
          // a T that excludes undefined throws a TypeError (the declared
          // element type is the contract), see listIterationElement.
          const element =
            iterableSet && set?.kind === "set"
              ? set.element
              : isList(iterable)
                ? listIterationElement(iterable, node.iterable)
                : system.assignable(iterable, string)
                  ? string
                  : number;
          if (
            loopBinding.kind === "object-binding" ||
            loopBinding.kind === "array-binding"
          ) {
            if (node.mode === "var")
              fail(
                loopBinding,
                "UNSUPPORTED",
                "typed iteration binding patterns require let or const",
              );
            initializeBindingPattern(loopBinding, undefined, element, owner);
          } else
            initializeIteration(
              loopBinding,
              element,
              owner,
              node.mode === "var",
            );
          const body = loopBody(node.body, owner, result);
          present = new Set(definiteEntry);
          return loopCompletion(body, false);
        }
        case "for": {
          if (node.initializer !== undefined)
            statement(node.initializer, owner, result);
          const definiteEntry = entryFacts(node);
          present = new Set(definiteEntry);
          const test = node.test;
          if (test !== undefined) {
            condition(test, owner);
            present = refine(test, true, present);
          }
          {
            const body = loopBody(node.body, owner, result);
            present = new Set(definiteEntry);
            if (node.update !== undefined) expression(node.update, owner);
            present = new Set(definiteEntry);
            return loopCompletion(
              body,
              false,
              test === undefined || unconditionalTest(test),
            );
          }
        }
        case "break": {
          const target = breakTargets[breakTargets.length - 1];
          if (node.label === undefined && target !== undefined)
            target.push(assignedFacts());
          return 4;
        }
        case "continue":
          return 8;
        case "type-alias":
        case "interface":
          if (owner !== undefined)
            fail(
              node,
              "UNSUPPORTED",
              "local type declarations require scoped type resolution",
            );
          return 1;
        case "debugger":
        case "empty":
          return 1;
        default:
          return fail(
            node,
            "UNSUPPORTED",
            "statement is outside the closure checking slice",
          );
      }
    } finally {
      depth--;
    }
  }
  try {
    const plan = realmPlan;
    if (plan !== undefined)
      rewriteModule(module, {
        statement: (mapped, node) => {
          if (node.kind !== "function") return mapped;
          const params = node.parameters;
          const b = binding(node),
            owner = functions.get(node);
          const type = types[bindingTypes[b.id] ?? -1];
          if (owner === undefined || type?.kind !== "function")
            throw "realm function signature invariant";
          const result = plan.results.has(owner)
            ? realmPayload(type.result, node)
            : type.result;
          let changed = result !== type.result;
          const parameters = type.parameters.map((id, index) => {
            const p = params[index];
            if (p === undefined) throw "realm parameter invariant";
            if (!plan.bindings.has(binding(p).id)) return id;
            changed = true;
            return realmPayload(id, p);
          });
          if (changed)
            bindingTypes[b.id] = appendType(
              { ...type, parameters, result },
              node,
              "invalid realm function signature",
            );
          return mapped;
        },
      });
    for (const node of module.statements) {
      if (node === undefined) throw "missing module statement";
      if (
        node.kind !== "function" &&
        node.kind !== "variable" &&
        node.kind !== "interface" &&
        node.kind !== "type-alias" &&
        node.kind !== "class" &&
        node.kind !== "empty" &&
        node.kind !== "debugger"
      )
        fail(
          node,
          "UNSUPPORTED",
          "module statement is outside the declaration checking slice",
        );
      statement(node, undefined, undefinedType);
    }
  } catch (e) {
    if (e !== abort) throw e;
  }
  if (error !== undefined) return { ok: false, error };
  if (realmPlan === undefined && replayRealm)
    return checkClosureModuleLayout(
      module,
      options,
      planLocalRealm(
        module,
        graph,
        types,
        bindingTypes,
        expressions,
        references,
        declarations,
        functions,
        realmReturnOwners,
        realmSinks,
        realmReads,
      ),
    );
  propagateVoidReturns();
  return {
    ok: true,
    value: {
      typeNames: contracts.names,
      classes: contracts.classes,
      typeFlows,
      receiverTypes,
      module,
      exhaustiveSwitches,
      bindings: graph,
      types,
      typeSystem: { types, system },
      bindingTypes,
      bindingInitializations,
      bindingRealm,
      needsBindingRealm,
      bindingValues: patternValues,
      bindingRestExclusions,
      expressions,
      chainValues,
      chainReceivers,
      restCalls,
      voidResultDiscard: requiresVoidResultDiscard(),
      voidValueCalls,
      voidValueReturns,
      downcasts,
      dynamicEnrollments,
      nativeCallableViews,
      nativeListViews,
      nativeRecordViews,
      finitePropertyKeys,
      operations,
      intrinsics,
      cViewUses,
      cViews,
      bodies,
    },
  };
}
