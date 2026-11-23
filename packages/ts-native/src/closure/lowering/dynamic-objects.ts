import {
  rewriteModule,
  syntaxHash,
  type Binding,
  type BlockStatement,
  type Expression,
  type Module,
  type Parameter,
  type TypeNode,
  type Span,
  type Statement,
} from "@tint/typescript/syntax";
import { createKeyIndex } from "@tint/foundation/collections/key-index";
import { nativeCallableProjectionAlias } from "@tint/typescript/checker";
import type {
  CheckedClosures,
  NativeRecordViewField,
  NativeTypedArray,
} from "@tint/typescript/checker";
import { projectRecordExpression } from "./record-view.ts";

export interface DynamicObjectRuntime {
  readonly create: number;
  readonly createArray: number;
  readonly invoke: number;
  readonly finish: number;
  readonly enroll: number;
  readonly convertKey: number;
  readonly define: number;
  readonly setPrototype: number;
  readonly read: number;
  readonly project: number;
  readonly write: number;
  readonly update?: number | undefined;
  readonly has: number;
  readonly remove: number;
  readonly spread: number;
  readonly enumerate: number;
  readonly advance: number;
  readonly objectConstructor: number;
  readonly invokeEnumeration: number;
  readonly speculativeBinary?: number | undefined;
  readonly speculativeString?: number | undefined;
  readonly speculativeUnary?: number | undefined;
  /** String() of a value typed as unknown (see stringConstructor). */
  readonly stringConstructor?: number | undefined;
  readonly bindingObject?: number;
  readonly bindingIterator?: number;
  readonly bindingNext?: number;
  readonly bindingSkip?: number;
  readonly bindingTail?: number;
  readonly bindingClose?: number;
  readonly bindingRest?: number;
}

export function dynamicObjectRuntime(
  resolve: (name: string) => number,
  patterns: boolean = false,
): DynamicObjectRuntime {
  return {
    create: resolve("create"),
    createArray: resolve("createArray"),
    invoke: resolve("invoke"),
    finish: resolve("finish"),
    enroll: resolve("enroll"),
    convertKey: resolve("convertKey"),
    define: resolve("define"),
    setPrototype: resolve("setPrototype"),
    read: resolve("read"),
    project: resolve("project"),
    write: resolve("write"),
    has: resolve("has"),
    remove: resolve("remove"),
    spread: resolve("spread"),
    enumerate: resolve("enumerate"),
    advance: resolve("advance"),
    objectConstructor: resolve("objectConstructor"),
    invokeEnumeration: resolve("invokeEnumeration"),
    ...(patterns
      ? {
          bindingObject: resolve("bindingObject"),
          bindingIterator: resolve("bindingIterator"),
          bindingNext: resolve("bindingNext"),
          bindingSkip: resolve("bindingSkip"),
          bindingTail: resolve("bindingTail"),
          bindingClose: resolve("bindingClose"),
          bindingRest: resolve("bindingRest"),
        }
      : {}),
  };
}

export const realmInstanceofHelpers: readonly string[] = [
  "realmGlobal",
  "realmInstanceOf",
  "invokeArrayMethod",
];

/** The receiver's checked brand is independent of its physical carrier. */
export function arrayFlowReceiver(
  checked: CheckedClosures,
  node: Expression,
  intrinsic: string | undefined,
): NativeTypedArray | "realm" | undefined {
  if (
    intrinsic === undefined ||
    !intrinsic.startsWith("array-") ||
    intrinsic === "array-instanceof"
  )
    return undefined;
  let target = node;
  if (node.kind === "call") target = node.callee;
  if (
    node.kind === "assignment" ||
    node.kind === "compound" ||
    node.kind === "update"
  )
    target = node.target;
  while (target.kind === "group" || target.kind === "satisfies")
    target = target.expression;
  if (target.kind !== "member" && target.kind !== "index") return undefined;
  const receiver = checked.types[checked.expressions.get(target.object) ?? -1];
  if (receiver?.kind === "object")
    return receiver.realmTypedArray === undefined ? undefined : "realm";
  if (receiver === undefined) return undefined;
  switch (receiver.kind) {
    case "Uint8Array":
    case "Int8Array":
    case "Uint8ClampedArray":
    case "Uint16Array":
    case "Int16Array":
    case "Uint32Array":
    case "Int32Array":
    case "Float32Array":
    case "Float64Array":
      return receiver.arrayFlow === true ? receiver.kind : undefined;
    default:
      return undefined;
  }
}
function isNativeRealmGuard(
  intrinsic: string,
  site: Span,
  canCaptureErrorRealm: (site: Span) => boolean,
): boolean {
  return (
    intrinsic === "array-instanceof" ||
    ((intrinsic === "error-is" ||
      intrinsic === "type-error-is" ||
      intrinsic === "range-error-is" ||
      intrinsic === "error-property") &&
      canCaptureErrorRealm(site))
  );
}

export function usesRealmInstanceof(
  checked: CheckedClosures,
  realmGuards: boolean,
  canCaptureErrorRealm: (site: Span) => boolean,
): boolean {
  let used = false;
  checked.intrinsics.forEach((intrinsic, node) => {
    if (
      intrinsic.startsWith("realm-library-") ||
      intrinsic === "realm-global" ||
      intrinsic === "realm-instanceof" ||
      (realmGuards &&
        isNativeRealmGuard(intrinsic, node, canCaptureErrorRealm)) ||
      arrayFlowReceiver(checked, node, intrinsic) === "realm"
    )
      used = true;
  });
  return used;
}

export function hasDynamicObject(
  checked: CheckedClosures,
  id: number,
): boolean {
  const type = checked.types[id];
  if (type?.kind === "object")
    return type.stringIndex !== undefined || type.realmRecord === true;
  if (type?.kind === "array") return type.realmArray === true;
  return (
    type?.kind === "union" &&
    type.members.some(
      (member) => member !== undefined && hasDynamicObject(checked, member),
    )
  );
}

/** Reads that produce a speculative general value under a checked type: a
 * refined dynamic property (an accessor can change its result), and a class
 * field read before its first assignment would give `undefined`. */
function flowRead(checked: CheckedClosures, node: Expression): boolean {
  const intrinsic = checked.intrinsics.get(node);
  return (
    intrinsic === "flow-property-read" ||
    intrinsic === "flow-property-read-boxed" ||
    intrinsic === "uninitialized-field-read"
  );
}
function hasFlowReads(checked: CheckedClosures): boolean {
  let found = false;
  checked.intrinsics.forEach((_intrinsic, node) => {
    if (flowRead(checked, node)) found = true;
  });
  return found;
}
/** Uninitialized field reads need the speculative helpers in every build,
 * not only in partitioned ones. */
export function hasUninitializedReads(checked: CheckedClosures): boolean {
  let found = false;
  checked.intrinsics.forEach((intrinsic, _node) => {
    if (intrinsic === "uninitialized-field-read") found = true;
  });
  return found;
}

interface FlowPropertyStorage {
  readonly values: ReadonlySet<Expression>;
  readonly bindings: ReadonlySet<number>;
}

/** A refined property still produces a general value when an accessor can
 * change its result. Follow that storage through open local slots. The checked
 * type graph remains intact for assignability and written contracts. */
export function planFlowPropertyStorage(
  checked: CheckedClosures,
): FlowPropertyStorage | undefined {
  if (!hasFlowReads(checked)) return undefined;
  const values = new Set<Expression>(),
    bindings = new Set<number>(),
    inferred = new Set<number>(),
    declarations = createKeyIndex<Span, number>(syntaxHash),
    references = createKeyIndex<Expression, number>(syntaxHash);
  for (const binding of checked.bindings.bindings)
    if (binding !== undefined) declarations.set(binding.node, binding.id);
  for (const reference of checked.bindings.references)
    if (reference !== undefined && reference.binding !== undefined)
      references.set(reference.node, reference.binding);
  let changed = true;
  while (changed) {
    changed = false;
    rewriteModule(checked.module, {
      statement: (mapped, original) => {
        if (original.kind === "variable")
          for (const declaration of original.declarations) {
            if (
              declaration === undefined ||
              declaration.type !== undefined ||
              declaration.kind === "object-binding" ||
              declaration.kind === "array-binding"
            )
              continue;
            const id = declarations.get(declaration);
            if (id === undefined) continue;
            if (!inferred.has(id)) {
              inferred.add(id);
              changed = true;
            }
            if (
              declaration.initializer !== undefined &&
              values.has(declaration.initializer) &&
              !bindings.has(id)
            ) {
              bindings.add(id);
              changed = true;
            }
          }
        return mapped;
      },
      expression: (mapped, original) => {
        if (values.has(original)) return mapped;
        let boxed = flowRead(checked, original);
        switch (original.kind) {
          case "identifier": {
            const id = references.get(original);
            boxed = id !== undefined && bindings.has(id);
            break;
          }
          case "group":
            boxed = values.has(original.expression);
            break;
          case "satisfies":
            boxed =
              checked.downcasts?.get(original) === undefined &&
              values.has(original.expression);
            break;
          case "conditional":
            boxed =
              values.has(original.consequent) || values.has(original.alternate);
            break;
          case "member":
          case "index":
            boxed = boxed || values.has(original.object);
            break;
          case "binary":
            if (original.operator === ",") boxed = values.has(original.right);
            else
              boxed =
                ![
                  "===",
                  "!==",
                  "==",
                  "!=",
                  "<",
                  "<=",
                  ">",
                  ">=",
                  "in",
                  "instanceof",
                ].includes(original.operator) &&
                (values.has(original.left) || values.has(original.right));
            break;
          case "unary":
            boxed =
              ["+", "-", "~"].includes(original.operator) &&
              values.has(original.operand);
            break;
          case "assignment": {
            if (!values.has(original.value)) break;
            const id = references.get(original.target);
            boxed = id !== undefined && inferred.has(id);
            if (id !== undefined && boxed && !bindings.has(id)) {
              bindings.add(id);
              changed = true;
            }
            break;
          }
        }
        if (boxed) {
          values.add(original);
          changed = true;
        }
        return mapped;
      },
    });
  }
  return { values, bindings };
}

/** Type-only declarations cannot require an executable realm. */
export function usesDynamicObjectRuntime(
  checked: CheckedClosures,
  speculativeFlow?: boolean,
): boolean {
  if (speculativeFlow === true && hasFlowReads(checked)) return true;
  if (hasUninitializedReads(checked)) return true;
  if (checked.needsBindingRealm === true) return true;
  // In mixed programs the program realm is already linked, so String() of an
  // unknown value aliases stringConstructor for realm objects and Symbols.
  // Pure typed programs convert primitives, native errors and BigInt natively
  // without pulling in the realm.
  if (speculativeFlow === true) {
    let realmString = false;
    checked.intrinsics.forEach((intrinsic, _node) => {
      if (intrinsic === "dynamic-object-string") realmString = true;
    });
    if (realmString) return true;
  }
  if (
    !checked.types.some(
      (type) =>
        (type?.kind === "object" &&
          (type.stringIndex !== undefined || type.realmRecord === true)) ||
        (type?.kind === "array" && type.realmArray === true),
    )
  )
    return false;
  if (
    checked.bindingTypes.some(
      (id) => id !== undefined && hasDynamicObject(checked, id),
    )
  )
    return true;
  for (const [id, body] of checked.bodies)
    if (hasDynamicObject(checked, body.result)) return true;
  let used = false;
  checked.intrinsics.forEach((intrinsic, _node) => {
    if (intrinsic.startsWith("dynamic-object-")) used = true;
  });
  return used;
}

/** Encode the reachable immutable graph, registering a type before its edges
 * so recursive indexed interfaces use backreferences. The runtime interns the
 * compact string and only decodes a particular contract on its first use. */
export function encodeDynamicContract(
  checked: CheckedClosures,
  root: number,
): string {
  const ids = new Map<number, number>();
  const pending: number[] = [];
  const parts: string[] = [];
  function emit(token: string): void {
    parts.push(String(token.length) + ":" + token);
  }
  function reference(id: number): string {
    const seen = ids.get(id);
    if (seen !== undefined) return String(seen);
    const index = pending.length;
    pending.push(id);
    ids.set(id, index);
    return String(index);
  }
  reference(root);
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i];
    if (id === undefined) throw "dynamic contract reference invariant";
    const type = checked.types[id];
    if (type === undefined) throw "dynamic contract type invariant";
    switch (type.kind) {
      case "number":
      case "string":
      case "boolean":
      case "undefined":
      case "null":
      case "bigint":
      case "unknown":
      case "never":
        emit(type.kind);
        break;
      case "realm-callable":
      case "dynamic-result":
        emit("unknown");
        break;
      case "literal": {
        const value = type.value;
        emit(typeof value + "-literal");
        if (typeof value === "string") emit(value);
        else if (typeof value === "number") emit(String(value));
        else emit(value ? "true" : "false");
        break;
      }
      case "union":
        emit("union");
        emit(String(type.members.length));
        for (const member of type.members) {
          if (member === undefined) throw "dynamic contract member invariant";
          emit(reference(member));
        }
        break;
      case "array":
        if (type.tupleElements !== undefined) emit("array");
        else {
          emit("array-elements");
          emit(reference(type.element));
          emit(type.readonly ? "1" : "0");
        }
        break;
      case "object": {
        const index = type.stringIndex;
        emit("object");
        emit(index === undefined ? "-1" : reference(index.type));
        emit(index?.readonly === true ? "1" : "0");
        emit(String(type.properties.length));
        for (const field of type.properties) {
          if (field === undefined) throw "dynamic contract field invariant";
          emit(field.name);
          emit(reference(field.type));
          emit(field.optional ? "0" : "1");
          emit(field.readonly ? "1" : "0");
        }
        break;
      }
      default:
        throw "unsupported dynamic-key object property contract";
    }
  }
  const length = String(pending.length);
  return String(length.length) + ":" + length + parts.join("");
}

/** The program realm and its helper closures belong to the module instance.
 * Explicit source reads of the helper functions keep their lexical captures
 * visible to ordinary closure planning before the scalar operations call them. */
export const dynamicRuntimeAliasPrefix: string = "$tint$dynamic$";

export function insertDynamicObjectRuntime(
  module: Module,
  checked: CheckedClosures,
  helpers: ReadonlyMap<string, string>,
  realmInstanceof: boolean,
  speculativeFlow: boolean,
  canCaptureErrorRealm: (site: Span) => boolean,
  sourceNames?: ReadonlyMap<string, string>,
): Module {
  const uses: Span[] = [];
  const patterns: Span[] = [];
  const compoundUses: Span[] = [],
    updates: Span[] = [],
    stringUses: Span[] = [];
  const callableViews: Span[] = [];
  const listViews: Span[] = [];
  const recordViews: Span[] = [];
  // These expressions were checked in the specialized copy. The rewrite
  // consumes the linked source, before additional runtime specialization.
  const callableSites = new Set<string>();
  const listSites = new Set<string>();
  const recordSites = new Map<string, readonly NativeRecordViewField[]>();
  function sourceSite(node: Expression): string {
    return node.kind + ":" + String(node.start) + ":" + String(node.end);
  }
  checked.nativeCallableViews?.forEach((_value, site) => {
    callableViews.push(site);
    callableSites.add(sourceSite(site));
    uses.push(site);
  });
  checked.nativeListViews?.forEach((_value, site) => {
    listViews.push(site);
    listSites.add(sourceSite(site));
    uses.push(site);
  });
  checked.nativeRecordViews?.forEach((fields, site) => {
    recordViews.push(site);
    recordSites.set(sourceSite(site), fields);
    uses.push(site);
  });
  checked.bindingRealm?.forEach((_value, site) => {
    patterns.push(site);
    uses.push(site);
  });
  checked.intrinsics.forEach((intrinsic, node) => {
    if (intrinsic === "dynamic-object-compound") compoundUses.push(node);
    if (intrinsic === "dynamic-object-update") updates.push(node);
    if (intrinsic === "dynamic-object-string") stringUses.push(node);
    if (
      intrinsic.startsWith("dynamic-object-") ||
      (realmInstanceof &&
        (intrinsic.startsWith("realm-library-") ||
          intrinsic === "realm-global" ||
          intrinsic === "realm-instanceof" ||
          isNativeRealmGuard(intrinsic, node, canCaptureErrorRealm) ||
          arrayFlowReceiver(checked, node, intrinsic) !== undefined))
    )
      uses.push(node);
  });
  const flow =
    speculativeFlow === true || hasUninitializedReads(checked)
      ? planFlowPropertyStorage(checked)
      : undefined;
  const flowUses: Span[] = [];
  if (flow !== undefined)
    for (const use of flow.values) {
      flowUses.push(use);
      uses.push(use);
    }
  rewriteModule(module, {
    statement: (node, original) => {
      if (original.kind === "for-in" || original.kind === "for-in-assignment")
        uses.push(original);
      return node;
    },
  });
  checked.dynamicEnrollments?.forEach((_type, node) => {
    uses.push(node);
  });
  for (const binding of checked.bindings.bindings) {
    if (binding === undefined) continue;
    const type = checked.bindingTypes[binding.id];
    if (type !== undefined && hasDynamicObject(checked, type))
      uses.push(binding.node);
  }
  for (const [id, body] of checked.bodies)
    if (body.explicitResult === true && hasDynamicObject(checked, body.result))
      uses.push(body.node);
  if (uses.length === 0) return module;
  function usesRuntime(node: Span): boolean {
    return uses.some(
      (use) =>
        use !== undefined && use.start >= node.start && use.end <= node.end,
    );
  }
  function isDynamicAnnotation(node: TypeNode): boolean {
    switch (node.kind) {
      case "object":
        return node.indexSignature !== undefined;
      case "group":
        return isDynamicAnnotation(node.type);
      case "intersection":
      case "union":
        return node.members.some(
          (member) => member !== undefined && isDynamicAnnotation(member),
        );
      case "named": {
        const name = checked.typeNames.get(node.name);
        if (name !== undefined) {
          const type = checked.types[name];
          return type?.kind !== "object"
            ? hasDynamicObject(checked, name)
            : type.stringIndex !== undefined;
        }
        const key = node.arguments?.[0];
        return (
          node.name === "Record" &&
          key?.kind === "named" &&
          key.name === "string"
        );
      }
      default:
        return false;
    }
  }
  function aliasesAt(scope: Span, includePatterns: boolean = false): Statement {
    const declarations: Binding[] = [];
    function alias(name: string): number {
      const linked = helpers.get("dynamic-object:" + name);
      if (linked === undefined) throw "dynamic object helper invariant";
      declarations.push({
        name:
          name === "projectUnaryNumber"
            ? nativeCallableProjectionAlias
            : dynamicRuntimeAliasPrefix + name,
        type: undefined,
        initializer: {
          kind: "identifier",
          name: linked,
          start: scope.start,
          end: scope.start,
        },
        start: scope.start,
        end: scope.start,
      });
      return 0;
    }
    dynamicObjectRuntime(
      alias,
      patterns.some(
        (site) =>
          site !== undefined &&
          site.start >= scope.start &&
          site.end <= scope.end,
      ) || includePatterns,
    );
    function contains(sites: readonly Span[]): boolean {
      return sites.some(
        (use) =>
          use !== undefined && use.start >= scope.start && use.end <= scope.end,
      );
    }
    const speculative = contains(flowUses);
    if (speculative || contains(compoundUses)) alias("speculativeBinary");
    if (speculative) {
      alias("speculativeString");
      alias("speculativeUnary");
    }
    if (contains(updates)) alias("update");
    if (contains(stringUses)) alias("stringConstructor");
    if (contains(callableViews)) alias("projectUnaryNumber");
    if (contains(listViews)) alias("projectNumberList");
    if (contains(recordViews)) alias("projectNativeRecord");
    if (realmInstanceof)
      for (const name of realmInstanceofHelpers) {
        if (name === undefined) throw "realm instanceof helper invariant";
        alias(name);
      }
    return {
      kind: "variable",
      mode: "const",
      exported: false,
      declarations,
      start: scope.start,
      end: scope.start,
    };
  }
  function bodyWithRuntime(
    body: Statement,
    parameters: readonly Parameter[],
  ): BlockStatement {
    // Rewriting creates new parameter nodes, while the checker indexes the
    // original (possibly specialized) syntax. Runtime selection uses spans.
    const realmParameters = parameters.some(
      (parameter) =>
        parameter !== undefined &&
        patterns.some(
          (site) =>
            site !== undefined &&
            site.start >= parameter.start &&
            site.end <= parameter.end,
        ),
    );
    const statements: Statement[] = [aliasesAt(body, realmParameters)];
    for (const parameter of parameters) {
      if (parameter === undefined || parameter.kind === "pattern-parameter")
        continue;
      const type = parameter.type;
      if (type === undefined || !isDynamicAnnotation(type)) continue;
      const begin = parameter.start,
        end = parameter.end;
      const absent: TypeNode = {
        kind: "named",
        name: "undefined",
        start: begin,
        end,
      };
      const target: TypeNode =
        parameter.optional === true
          ? { kind: "union", members: [type, absent], start: begin, end }
          : type;
      statements.push({
        kind: "expression",
        expression: {
          kind: "satisfies",
          assertion: "as",
          type: target,
          expression: {
            kind: "identifier",
            name: parameter.name,
            start: begin,
            end,
          },
          start: begin,
          end,
        },
        start: begin,
        end,
      });
    }
    if (body.kind === "block") {
      for (const statement of body.statements) {
        if (statement === undefined) throw "dynamic object statement invariant";
        statements.push(statement);
      }
    } else statements.push(body);
    return { kind: "block", statements, start: body.start, end: body.end };
  }
  const rewritten = rewriteModule(module, {
    statement: (node, original) => {
      if (node.kind === "function" && usesRuntime(original))
        return { ...node, body: bodyWithRuntime(node.body, node.parameters) };
      // Methods and constructors get their own aliases like functions; field
      // initializers see the enclosing scope's.
      if (node.kind === "class" && usesRuntime(original))
        return {
          ...node,
          definition: {
            ...node.definition,
            elements: node.definition.elements.map((element) =>
              element !== undefined &&
              (element.kind === "method" ||
                element.kind === "get" ||
                element.kind === "set") &&
              usesRuntime(element.body)
                ? {
                    ...element,
                    body: bodyWithRuntime(element.body, element.parameters),
                  }
                : element,
            ),
          },
        };
      return node;
    },
    expression: (node, original) => {
      const site =
        callableSites.size + listSites.size + recordSites.size === 0
          ? ""
          : sourceSite(original);
      const record = recordSites.get(site);
      if (record !== undefined)
        return projectRecordExpression(
          node,
          record,
          dynamicRuntimeAliasPrefix + "projectNativeRecord",
        );
      const callable = callableSites.has(site);
      if (callable || listSites.has(site)) {
        const start = node.start,
          end = node.end;
        const helper = callable ? "projectUnaryNumber" : "projectNumberList";
        const args: Expression[] = [node];
        if (callable) {
          let source = original;
          while (source.kind === "group" || source.kind === "satisfies")
            source = source.expression;
          const name =
            source.kind === "identifier"
              ? (sourceNames?.get(source.name) ?? "")
              : source.kind === "function-expression"
                ? (source.name ?? "")
                : "";
          args.push({ kind: "string", value: name, start, end });
        }
        return {
          kind: "call",
          callee: {
            kind: "identifier",
            name: callable
              ? nativeCallableProjectionAlias
              : dynamicRuntimeAliasPrefix + helper,
            start,
            end,
          },
          arguments: args,
          typeArguments: [],
          start,
          end,
        };
      }
      if (
        (node.kind !== "arrow" && node.kind !== "function-expression") ||
        !usesRuntime(original)
      )
        return node;
      const body = node.body;
      if (body.kind === "block")
        return { ...node, body: bodyWithRuntime(body, node.parameters) };
      const returned: Statement = {
        kind: "return",
        expression: body,
        start: body.start,
        end: body.end,
      };
      return { ...node, body: bodyWithRuntime(returned, node.parameters) };
    },
  });
  const first = module.statements.findIndex(
    (statement) =>
      statement !== undefined &&
      (statement.kind === "variable" || statement.kind === "class") &&
      usesRuntime(statement),
  );
  if (first >= 0) {
    const statements: Statement[] = [];
    for (let index = 0; index < rewritten.statements.length; index++) {
      const item = rewritten.statements[index];
      if (item === undefined) throw "dynamic module statement invariant";
      if (index === first)
        statements.push(aliasesAt(item, patterns.length !== 0));
      statements.push(item);
    }
    return { ...rewritten, statements };
  }
  return rewritten;
}
