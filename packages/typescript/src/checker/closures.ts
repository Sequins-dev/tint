import { numericConstant } from "./numeric-constants.ts";
import { checkClassInitialization } from "./class-initialization.ts";
import {
  syntaxHash,
  literalPropertyName,
  isOptionalChain,
  rewriteModule,
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
  type CheckedCellOperation,
  type CellOperation,
} from "../types/index.ts";
import {
  resolveInterfaceTypes,
  type ClassContract,
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
  | "math-min"
  | "math-max"
  | "numeric-constant"
  | "array-set"
  | "array-subarray"
  | "array-slice"
  | "array-new"
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
  | "range-error-new"
  | "range-error-is"
  | "type-error-new"
  | "type-error-is"
  | "array-buffer"
  | "array-byte-offset"
  | "array-byte-length"
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
export interface ClosureBody {
  readonly node: Span;
  readonly parameters: readonly Parameter[];
  readonly body: Expression | BlockStatement;
  readonly result: number;
}
export interface CheckedTypeFlow {
  readonly source: number;
  readonly target: number;
  readonly node: Span;
}
export interface CheckedClosures {
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
  /** `x as T` assertions from `unknown` to T: checked downcasts, which
   * throw a TypeError when the value is not a T (docs/unified-pipeline.md). */
  readonly downcasts?: ReadonlyKeyIndex<Expression, number>;
  readonly operations: readonly BindingOperation[];
}
export interface CheckedTypeSystem {
  readonly types: readonly Type[];
  readonly system: TypeSystem;
}
export interface ClosureDiagnostic extends Span {
  readonly code: string;
  readonly message: string;
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
  // Syntax the checker synthesizes for an existing node reuses that node's
  // span; distinct hashes, above any traversal ordinal, keep each one apart
  // from the source node and from the others in syntax-keyed indexes.
  let nextSyntheticHash = 0x40000000;
  function syntheticNodeHash(): number {
    return nextSyntheticHash++;
  }
  const bound = bindModule(module, [
    "undefined",
    "NaN",
    "Infinity",
    "Set",
    "Map",
    "Number",
    "String",
    "Math",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
    "TypeError",
    "RangeError",
  ]);
  if (!bound.ok) return bound;
  const graph = bound.value,
    abort = {},
    annotations: TypeNode[] = [];
  const collectionConstructors = createKeyIndex<Expression, TypeNode>(
    syntaxHash,
  );
  const uninitialized = new Set<Span>(),
    varAssignments = new Set<Span>();
  const varInitializers = createKeyIndex<Span, Expression>(syntaxHash);
  const declared = createKeyIndex<Span, TypeNode>(syntaxHash),
    signatures = createKeyIndex<Span, TypeNode>(syntaxHash),
    literals = createKeyIndex<Expression, TypeNode>(syntaxHash);
  let error: ClosureDiagnostic | undefined,
    depth = 0;
  function fail(node: Span, code: string, message: string): never {
    error = { start: node.start, end: node.end, code, message };
    throw abort;
  }
  function annotation(node: Span, type: TypeNode | undefined): void {
    if (type !== undefined) {
      annotations.push(type);
      declared.set(node, type);
    }
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
    for (const p of params) {
      if (p === undefined) throw "missing parameter";
      if (p.kind === "pattern-parameter")
        fail(
          p,
          "UNSUPPORTED",
          "typed parameter destructuring is not supported yet",
        );
      if (p.rest)
        fail(
          p,
          "UNSUPPORTED",
          "typed rest parameter layouts are not implemented",
        );
      if (p.initializer !== undefined) collect(p.initializer);
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
          : p.type,
      );
    }
    if (result !== undefined) annotations.push(result);
    if (
      params.every((p) => p !== undefined && p.type !== undefined) &&
      result !== undefined
    ) {
      const type: TypeNode = {
        kind: "function",
        parameters: params,
        ...(receiver === undefined ? {} : { receiver }),
        returnType: result,
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
          if (node.definition.typeParameters.length !== 0)
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
              );
            if (member.kind !== "field" && member.async)
              fail(
                member,
                "UNSUPPORTED",
                "typed async method lowering is not implemented",
              );
            if (member.kind !== "field" && member.generator)
              fail(
                member,
                "UNSUPPORTED",
                "generator suspension lowering is not implemented",
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
            );
          if (node.generator)
            fail(
              node,
              "UNSUPPORTED",
              "generator suspension lowering is not implemented",
            );
          if (node.typeParameters?.length)
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
          if (node.async)
            fail(
              node,
              "UNSUPPORTED",
              "typed async function lowering is not implemented",
            );
          if (node.kind === "function-expression" && node.generator)
            fail(
              node,
              "UNSUPPORTED",
              "generator suspension lowering is not implemented",
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
            if (
              binding.kind === "object-binding" ||
              binding.kind === "array-binding"
            )
              fail(
                binding,
                "UNSUPPORTED",
                "typed catch destructuring is not supported yet",
              );
            const bindingType = binding.type;
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
            if (d.kind === "object-binding" || d.kind === "array-binding")
              fail(
                d,
                "UNSUPPORTED",
                "typed binding patterns are not implemented",
              );
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
        case "for-of": {
          if (node.await)
            fail(
              node,
              "UNSUPPORTED",
              "typed for-await lowering is not implemented",
            );
          const loopBinding = node.binding;
          if (loopBinding.kind === "object-binding")
            fail(
              loopBinding,
              "UNSUPPORTED",
              "typed object iteration patterns are not supported yet",
            );
          if (loopBinding.kind === "array-binding") {
            for (const element of loopBinding.elements)
              if (element !== undefined) {
                annotation(element, element.type);
                if (node.mode === "var") varAssignments.add(element);
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
  if (!resolved.ok) return resolved;
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
  const narrowed: { binding: number; type: number; property?: string }[] = [],
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
  ): number {
    const key =
        String(binding) +
        ":" +
        String(type) +
        ":" +
        (property === undefined ? "object" : "field:" + property),
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
    const id = contracts.names.get(name);
    if (id === undefined) throw "primitive invariant";
    return id;
  }
  const number = primitive("number"),
    boolean = primitive("boolean"),
    undefinedType = primitive("undefined"),
    nullType = primitive("null"),
    string = primitive("string"),
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
          fact.property === undefined &&
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
    // C views are byte arrays with members only.
    if (t.kind === "Uint8Array") return t.view === undefined;
    return (
      t.kind === "Uint16Array" ||
      t.kind === "Uint32Array" ||
      t.kind === "Float64Array"
    );
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
      value.kind === "never" ||
      value.kind === "number" ||
      value.kind === "string" ||
      value.kind === "boolean" ||
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
    return value?.kind === "array" && listValueElement(value.element, path);
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
  function requireType(actual: number, expected: number, node: Span): void {
    recordTypeFlow(actual, expected, node);
    if (!system.assignable(actual, expected))
      fail(node, "TYPE_MISMATCH", "value does not match its declared type");
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
      fail(node, "UNSUPPORTED", "parameter is not initialized: " + b.name);
    const type = bindingTypes[b.id];
    if (type === undefined)
      fail(
        node,
        "UNSUPPORTED",
        "forward or recursive inferred bindings require an annotation",
      );
    if (deferred.has(b.id)) {
      if ((b.captured && b.kind !== "var") || b.owner === undefined)
        fail(
          node,
          "UNSUPPORTED",
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
    if (!checked.ok) fail(node, checked.error, "invalid binding operation");
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
          if (fact !== undefined && fact.property === property)
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
      return type.receiver === undefined
        ? "f" + type.result + "(" + type.parameters.join(",") + ")"
        : undefined;
    if (type.kind === "never") return "n";
    if (type.kind === "array")
      return type.readonly ? undefined : "a" + type.element;
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
        (fact.property === undefined || fact.property === info.property)
      )
        result.delete(token);
    }
    const tagTypes = selected.map((v): number => {
      if (v === undefined) throw "missing selected discriminant";
      return v.tag;
    });
    result.add(narrowToken(info.binding, type));
    result.add(
      narrowToken(info.binding, unionSubset(tagTypes, node), info.property),
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
    if (target.kind !== "identifier") return undefined;
    const binding = references.get(target);
    if (binding === undefined) return undefined;
    const declared = bindingTypes[binding.id];
    if (declared === undefined) return undefined;
    const selected: number[] = [],
      seen = new Set<number>();
    const equal = truth === (node.operator === "===");
    function collect(id: number): boolean {
      if (seen.has(id)) return true;
      seen.add(id);
      const type = types[id];
      if (type?.kind === "union") return type.members.every(collect);
      if (typeQuery) {
        if (type?.kind === "unknown") {
          if (!equal) selected.push(id);
          else if (literalValue === "number") selected.push(number);
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
                type?.kind === "Uint8Array" ||
                type?.kind === "Uint16Array" ||
                type?.kind === "Uint32Array" ||
                type?.kind === "Float64Array" ||
                type?.kind === "TypeError" ||
                type?.kind === "RangeError"
              ? "object"
              : type?.kind;
        if (
          tag !== "number" &&
          tag !== "boolean" &&
          tag !== "string" &&
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
    if (
      !collect(narrowedType(binding.id, declared, base)) ||
      selected.length === 0
    )
      return undefined;
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
        fact.property === target.property
      )
        result.delete(token);
    }
    result.add(narrowToken(binding.id, selectedType, target.property));
    return result;
  }
  /** Bindings an expression assigns directly (not inside nested
   * functions, whose bindings are captured and so never retain facts across
   * effects), or undefined when a destructuring target hides them. */
  function assignedWithin(node: Expression): Set<number> | undefined {
    const written = new Set<number>();
    let complete = true;
    rewriteModule(
      {
        start: node.start,
        end: node.end,
        imports: [],
        statements: [
          {
            start: node.start,
            end: node.end,
            kind: "expression",
            expression: node,
          },
        ],
      },
      {
        expression: (mapped: Expression, original: Expression): Expression => {
          if (
            original.kind === "assignment" ||
            original.kind === "compound" ||
            original.kind === "update"
          ) {
            const target = ungroup(original.target);
            const binding =
              target.kind === "identifier" ? references.get(target) : undefined;
            if (binding !== undefined) written.add(binding.id);
            else if (target.kind !== "member" && target.kind !== "index")
              complete = false;
          }
          return mapped;
        },
      },
    );
    return complete ? written : undefined;
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
    const nullable = refineNullBinding(node, truth, base);
    if (nullable !== undefined) return nullable;
    const literal = refineLiteralBinding(node, truth, base);
    if (literal !== undefined) return literal;
    const tagged = refineDiscriminant(node, truth, base);
    if (tagged !== undefined) return tagged;
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
          fact.property !== undefined ||
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
      fail(
        node,
        "UNSUPPORTED",
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
              fail(
                property,
                "UNSUPPORTED",
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
  ): number {
    const savedFacts = present,
      savedCallSafeFacts = callSafeFacts;
    present = inheritStableFacts ? stableFacts() : new Set<number>();
    try {
      const type = types[signature];
      if (type?.kind !== "function") throw "signature invariant";
      if (params.length !== type.parameters.length)
        fail(node, "ARITY", "parameter count does not match context");
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
            fail(
              p,
              "UNSUPPORTED",
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
        const b = binding(p);
        bindingTypes[b.id] = actual;
        cell(b, { kind: "initialize", value: actual }, p, owner);
        pendingParameters.delete(b.id);
      }
      let result =
        returnAnnotation === undefined ? type.result : typeOf(returnAnnotation);
      requireType(result, type.result, node);
      bodies.set(owner, { node, parameters: params, body, result });
      if (body.kind === "block") {
        const returns: number[] = [];
        if (inferResult) inferredReturns.set(owner, returns);
        const completed = statement(body, owner, result);
        if (inferResult) inferredReturns.delete(owner);
        if (inferResult) {
          if (returns.length === 0)
            result = (completed & 1) !== 0 ? voidType : neverType(body);
          else {
            if ((completed & 1) !== 0) returns.push(undefinedType);
            result = unionSubset(returns, body);
          }
          bodies.set(owner, { node, parameters: params, body, result });
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
          bodies.set(owner, { node, parameters: params, body, result });
        }
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
  function condition(node: Expression, owner: number | undefined): void {
    if (expression(node, owner) === voidType)
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
      fail(initialization, initialization.code, initialization.message);
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
    downcasts = createKeyIndex<Expression, number>(syntaxHash);
  /** Types a checked downcast can test at run time: primitives, 1-byte
   * typed arrays, plain object (record) types, and unions of these. */
  function downcastable(type: number): boolean {
    const t = types[type];
    if (t === undefined) return false;
    switch (t.kind) {
      case "number":
      case "string":
      case "boolean":
      case "undefined":
      case "null":
      case "Uint8Array":
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
  function expression(
    input: Expression,
    owner: number | undefined,
    inputExpected?: number,
    preserveContext: boolean = false,
  ): number {
    const node = input;
    // unknown constrains assignability but supplies no contextual shape.
    const expected =
      inputExpected !== undefined && types[inputExpected]?.kind === "unknown"
        ? undefined
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
        case "private-in":
          return fail(
            node,
            "UNSUPPORTED",
            "typed private brand checks require private layouts",
          );
        case "new-target":
          return fail(
            node,
            "UNSUPPORTED",
            "typed new.target requires constructor context support",
          );
        case "super":
          return fail(
            node,
            "UNSUPPORTED",
            "typed super references require class receiver support",
          );
        case "this": {
          const receiverOwner =
            owner === undefined ? undefined : graph.functions[owner]?.receiver;
          if (receiverOwner === undefined) result = undefinedType;
          else {
            const receiver = receiverTypes.get(receiverOwner);
            if (receiver === undefined)
              fail(
                node,
                "UNSUPPORTED",
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
        case "identifier": {
          const b = references.get(node);
          if (b === undefined) {
            if (numericConstant("", node.name) !== undefined) {
              result = number;
              intrinsics.set(node, "numeric-constant");
              break;
            }
            if (node.name !== "undefined")
              fail(node, "UNSUPPORTED", "unsupported global");
            result = undefinedType;
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
          );
          const proof = contextualProofs.get(node.expression);
          if (proof !== undefined) contextualProofs.set(node, proof);
          break;
        case "tagged-template":
          return fail(
            node,
            "UNSUPPORTED",
            "typed template tag calls are not implemented",
          );
        case "template-expression":
          for (const substitution of node.substitutions) {
            if (substitution === undefined)
              throw "TEMPLATE_SUBSTITUTION_INVARIANT";
            const input = expression(substitution, owner);
            if (
              ![number, string, boolean, undefinedType, nullType].some((type) =>
                system.assignable(input, type),
              )
            )
              fail(
                substitution,
                "UNSUPPORTED",
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
            if (isList(iterable)) return listReadType(iterable, element);
            fail(
              element,
              "UNSUPPORTED",
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
            else if (system.assignable(firstType, boolean))
              context = arrayOf(firstType, first);
            else if (
              system.assignable(presentType(firstType) ?? firstType, string) ||
              listReferenceElement(presentType(firstType) ?? firstType)
            )
              context = arrayOf(firstType, first);
            else
              fail(
                first,
                "UNSUPPORTED",
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
          if (
            node.properties.some(
              (p) => p.kind !== "spread" && p.keyExpression !== undefined,
            )
          )
            fail(
              node,
              "UNSUPPORTED",
              "typed dynamic object keys require dynamic layout support",
            );
          if (
            node.properties.some(
              (p) => p.kind !== "spread" && p.prototypeSetter === true,
            )
          )
            fail(
              node,
              "UNSUPPORTED",
              "typed prototype setters require prototype layout support",
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
            );
          const hasSpread = node.properties.some((p) => p.kind === "spread");
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
                    fail(
                      property,
                      "UNSUPPORTED",
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
              fail(
                p,
                "UNSUPPORTED",
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
          checkFunction(
            node,
            node.parameters,
            node.returnType,
            node.body,
            result,
            false,
            true,
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
          const literal = literalProperty(obj, node.property, node);
          const p = system.property(obj, node.property);
          if (!p.ok) fail(node, p.error, "invalid property read");
          result = literal ?? p.value;
          const binding = references.get(receiver);
          if (binding !== undefined)
            for (const token of present) {
              const fact = narrowed[token - graph.bindings.length];
              if (
                fact !== undefined &&
                fact.binding === binding.id &&
                fact.property === node.property
              ) {
                result = fact.type;
                break;
              }
            }
          break;
        }
        case "index": {
          const object = chainReceiver(node.object, node.optional === true);
          const keyType = expression(node.index, owner),
            property = checkedPropertyName(node.index, types[keyType]);
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
            intrinsics.set(node, "record-read");
            result = read.value;
            break;
          }
          if (!isList(object)) requireArray(object, node.object);
          requireType(keyType, number, node.index);
          intrinsics.set(node, isList(object) ? "list-read" : "array-read");
          result = isList(object) ? listReadType(object, node) : optionalNumber;
          break;
        }
        case "new": {
          const target = ungroup(node.callee);
          if (
            target.kind === "identifier" &&
            (target.name === "TypeError" || target.name === "RangeError") &&
            !references.has(target)
          ) {
            if (node.arguments.length > 1)
              fail(
                node,
                "ARITY",
                "native errors accept at most one message in this slice",
              );
            for (const argument of node.arguments) {
              if (argument === undefined) throw "error argument invariant";
              requireType(expression(argument, owner), string, argument);
            }
            intrinsics.set(
              node,
              target.name === "TypeError"
                ? "type-error-new"
                : "range-error-new",
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
                fail(
                  node,
                  "UNSUPPORTED",
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
                  fail(
                    input,
                    "UNSUPPORTED",
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
                  fail(
                    node,
                    "UNSUPPORTED",
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
              if (element !== undefined)
                requireType(element, set.element, node);
            }
            if (types[result]?.kind !== (map ? "map" : "set"))
              fail(node, "UNSUPPORTED", "collection type is shadowed");
            intrinsics.set(node, map ? "map-new" : "set-new");
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
            const args = node.arguments.map((argument, index) =>
              expression(argument, owner, signature.parameters[index]),
            );
            const constructed = system.construct(callee, args);
            if (!constructed.ok)
              fail(node, constructed.error, "invalid construction");
            invalidateCalls();
            result = constructed.value;
            break;
          }
          if (node.typeArguments.length !== 0 || node.arguments.length > 1)
            fail(
              node,
              "ARITY",
              "typed-array construction accepts an optional numeric length, numeric array or supported typed-array source",
            );
          for (const arg of node.arguments) {
            if (arg === undefined) throw "missing call argument";
            const input = expression(
              arg,
              owner,
              ungroup(arg).kind === "array"
                ? typeOf(optionalNumericListAnnotation)
                : undefined,
            );
            if (isList(input))
              requireType(listReadType(input, arg), optionalNumber, arg);
            else if (!isArray(input)) requireType(input, optionalNumber, arg);
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
            const args = node.arguments.map((a, i) =>
              expression(a, owner, signature.parameters[i]),
            );
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
                ![number, string, boolean, undefinedType].some((type) =>
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
            requireType(expression(argument, owner), string, argument);
            intrinsics.set(node, "number-from-string");
            result = number;
            break;
          }
          if (target.kind === "member") {
            const receiver = ungroup(target.object);
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
            if (map?.kind === "function" && target.property === "call") {
              const suppliedReceiver = node.arguments[0];
              const receiver =
                suppliedReceiver === undefined
                  ? undefinedType
                  : expression(suppliedReceiver, owner, map.receiver);
              const args: number[] = [];
              for (let i = 1; i < node.arguments.length; i++) {
                const argument = node.arguments[i];
                if (argument === undefined) throw "call argument invariant";
                args.push(expression(argument, owner, map.parameters[i - 1]));
              }
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
                  fail(
                    callback,
                    "UNSUPPORTED",
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
                fail(
                  node,
                  "UNSUPPORTED",
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
              result = isList(obj) ? listReadType(obj, node) : optionalNumber;
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
                : number;
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
            if (!member.ok) fail(target, member.error, "invalid method call");
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
            const args = node.arguments.map((a, i) =>
              expression(a, owner, signature.parameters[i]),
            );
            const checked = system.call(member.value, args, obj);
            if (!checked.ok) fail(node, checked.error, "invalid call");
            invalidateCalls();
            result = checked.value;
            break;
          }
          const callee = expression(node.callee, owner),
            signature = types[callee];
          if (signature?.kind !== "function")
            fail(node, "TYPE_MISMATCH", "callee must have a function type");
          const args = node.arguments.map((a, i) =>
            expression(a, owner, signature.parameters[i]),
          );
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
              fail(
                target,
                "UNSUPPORTED",
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
                fail(
                  target,
                  "UNSUPPORTED",
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
                fail(
                  target,
                  "UNSUPPORTED",
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
            const checked = system.writeProperty(object, propertyName, number);
            if (!checked.ok)
              fail(target, checked.error, "invalid property update");
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
            if (primitive === undefined)
              fail(
                target,
                "UNSUPPORTED",
                "nullish assignment requires an optional primitive local",
              );
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
              fail(
                target,
                "UNSUPPORTED",
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
          if (target.kind === "identifier") {
            const b = references.get(target);
            if (b === undefined)
              fail(target, "UNSUPPORTED", "global assignment is unsupported");
            result = expression(node.value, owner, bindingTypes[b.id]);
            cell(b, { kind: "write", value: result }, target, owner);
          } else if (target.kind === "member" || target.kind === "index") {
            const receiver = expression(target.object, owner);
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
              const checked = system.writeProperty(receiver, property, result);
              if (!checked.ok)
                fail(target, checked.error, "invalid property assignment");
              intrinsics.set(node, "record-write");
              invalidateCalls();
            } else {
              if (isList(receiver)) requireMutableList(receiver, target.object);
              else requireArray(receiver, target.object);
              if (keyType === undefined) throw "index type invariant";
              requireType(keyType, number, target.index);
              const element = isList(receiver)
                ? listElement(receiver, target.object)
                : number;
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
          if (node.operator === "instanceof") {
            const target = ungroup(node.right);
            if (
              target.kind !== "identifier" ||
              (target.name !== "TypeError" && target.name !== "RangeError") ||
              references.has(target)
            )
              fail(
                node,
                "UNSUPPORTED",
                "instanceof requires an unshadowed supported error constructor in this slice",
              );
            const operand = expression(node.left, owner);
            if (operand === voidType)
              fail(
                node.left,
                "TYPE_MISMATCH",
                "void is not an instanceof operand",
              );
            intrinsics.set(
              node,
              target.name === "TypeError" ? "type-error-is" : "range-error-is",
            );
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
            if (left === voidType)
              fail(node.left, "TYPE_MISMATCH", "void is not a logical operand");
            if (node.operator === "??") {
              if (
                left !== nullType &&
                !system.assignable(left, optionalNumber) &&
                presentType(left, true) === undefined
              )
                fail(
                  node.left,
                  "UNSUPPORTED",
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
              if (right === voidType)
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
              if (right === voidType)
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
          if (left === voidType || right === voidType)
            fail(
              node,
              "TYPE_MISMATCH",
              "void result cannot be a binary operand",
            );
          if (["===", "!==", "==", "!="].includes(node.operator))
            result = boolean;
          else if (
            node.operator === "+" &&
            (system.assignable(left, string) ||
              system.assignable(right, string)) &&
            [left, right].every(
              (t) =>
                system.assignable(t, string) ||
                system.assignable(t, number) ||
                system.assignable(t, boolean),
            )
          )
            result = string;
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
            fail(
              node,
              "UNSUPPORTED",
              "unsupported binary operator: " + node.operator,
            );
          break;
        }
        case "unary": {
          const value = expression(node.operand, owner);
          if (
            value === voidType &&
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
          else if (["+", "-", "~"].includes(node.operator)) {
            requireType(value, number, node);
            result = number;
          } else fail(node, "UNSUPPORTED", "unary operation is unsupported");
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
      const skippedFacts = skipped;
      if (skippedFacts !== undefined) {
        chainValues.set(node, result);
        present = intersect(skippedFacts, present);
        if (result !== voidType && !system.assignable(undefinedType, result))
          result = unionSubset([result, undefinedType], node);
      } else chainValues.delete(node);
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
            if (d.kind === "object-binding" || d.kind === "array-binding")
              fail(
                d,
                "UNSUPPORTED",
                "typed binding patterns are not implemented",
              );
            const b = binding(d);
            if (node.mode === "var" && d.initializer === undefined) {
              continue;
            }
            if (deferred.has(b.id) && node.mode !== "var") {
              if (b.captured || b.owner === undefined)
                fail(
                  d,
                  "UNSUPPORTED",
                  "deferred captured or module bindings require initialization support",
                );
              present.add(declaredToken(b.id));
              present.delete(assignedToken(b.id));
              continue;
            }
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
          const type = typeOf(signature);
          cell(binding(node), { kind: "initialize", value: type }, node, owner);
          checkFunction(node, node.parameters, node.returnType, body, type);
          return 1;
        }
        case "try": {
          const definiteEntry = stableFacts();
          const handler = node.handler;
          const finalizer = node.finalizer;
          const invariant = stableFacts(definiteEntry, true);
          let pending = statement(node.body, owner, result);
          let normal = assignedFacts();
          if (handler !== undefined) {
            present = new Set(definiteEntry);
            if (handler.binding !== undefined) {
              const caught = handler.binding,
                b = binding(caught),
                type = bindingTypes[b.id];
              if (type === undefined) throw "catch type invariant";
              cell(b, { kind: "initialize", value: type }, caught, owner);
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
          if (inferred === undefined)
            requireType(
              actual === undefinedType && result === voidType
                ? voidType
                : actual,
              result,
              node,
            );
          else inferred.push(actual === voidType ? undefinedType : actual);
          return types[actual]?.kind === "never" ? throwCompletion : 2;
        }
        case "throw":
          expression(node.expression, owner);
          return throwCompletion;
        case "expression":
          // A never result cannot continue normally; it may throw or diverge.
          return types[expression(node.expression, owner)]?.kind === "never"
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
          const definiteEntry = stableFacts();
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
          const definiteEntry = stableFacts();
          const completion = statement(node.body, owner, result);
          // Labelled exits can bypass assignments in their body. Keep entry
          // facts until completion analysis tracks individual named targets.
          present = new Set(definiteEntry);
          return completion | 1;
        }
        case "do-while": {
          const definiteEntry = stableFacts();
          present = new Set(definiteEntry);
          const body = loopBody(node.body, owner, result);
          present = new Set(definiteEntry);
          condition(node.test, owner);
          present = new Set(definiteEntry);
          return loopCompletion(body, true, unconditionalTest(node.test));
        }
        case "while": {
          const definiteEntry = stableFacts();
          present = new Set(definiteEntry);
          condition(node.test, owner);
          present = refine(node.test, true, present);
          {
            const body = loopBody(node.body, owner, result);
            present = new Set(definiteEntry);
            return loopCompletion(body, false, unconditionalTest(node.test));
          }
        }
        case "for-of": {
          if (node.await)
            fail(
              node,
              "UNSUPPORTED",
              "typed for-await lowering is not implemented",
            );
          const loopBinding = node.binding;
          if (loopBinding.kind === "object-binding")
            fail(
              loopBinding,
              "UNSUPPORTED",
              "typed object iteration patterns are not supported yet",
            );
          // The iterable is evaluated once, under the incoming facts. Only
          // immutable object discriminants remain valid across iterations.
          const iterable = expression(node.iterable, owner);
          const definiteEntry = stableFacts();
          present = new Set(definiteEntry);
          if (loopBinding.kind === "array-binding") {
            const map = types[iterable];
            if (map?.kind !== "map")
              fail(
                node.iterable,
                "UNSUPPORTED",
                "destructured iteration currently requires a Map",
              );
            for (let index = 0; index < loopBinding.elements.length; index++) {
              const element = loopBinding.elements[index];
              if (element === undefined) continue;
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
          const element =
            iterableSet && set?.kind === "set"
              ? set.element
              : isList(iterable)
                ? listReadType(iterable, node.iterable)
                : system.assignable(iterable, string)
                  ? string
                  : number;
          initializeIteration(loopBinding, element, owner, node.mode === "var");
          const body = loopBody(node.body, owner, result);
          present = new Set(definiteEntry);
          return loopCompletion(body, false);
        }
        case "for": {
          if (node.initializer !== undefined)
            statement(node.initializer, owner, result);
          const definiteEntry = stableFacts();
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
      expressions,
      chainValues,
      chainReceivers,
      downcasts,
      operations,
      intrinsics,
      cViewUses,
      cViews,
      bodies,
    },
  };
}
