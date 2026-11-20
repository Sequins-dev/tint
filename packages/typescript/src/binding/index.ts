import {
  installedNonConstructorGlobals,
  otherLibraryGlobals,
} from "./realm-library.ts";
import { statementFunctionDeclaration } from "./script.ts";
import {
  type KeyIndex,
  createKeyIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
import {
  bindingIdentifiers,
  visitBindingExpressions,
  parameterIdentifiers,
  visitParameterExpressions,
  parameterHasExpressions,
  isSimpleParameter,
  isDirectEvalCandidate,
  syntaxHash,
} from "../syntax/index.ts";
import type {
  Module,
  Statement,
  Expression,
  Span,
  Parameter,
  BlockStatement,
  ClassDefinition,
} from "../syntax/index.ts";
export interface Scope {
  readonly id: number;
  readonly parent: number | undefined;
  readonly owner: number | undefined;
  /** Binder-established mode. Missing metadata cannot authorize strict proofs. */
  readonly strict?: boolean;
  readonly kind:
    "module" | "script" | "function" | "function-body" | "block" | "for";
  readonly node: Span;
}
export interface Binding {
  readonly id: number;
  readonly name: string;
  readonly scope: number;
  readonly owner: number | undefined;
  readonly kind:
    "var" | "let" | "const" | "parameter" | "function" | "import" | "catch";
  readonly mutable: boolean;
  readonly captured: boolean;
  readonly node: Span;
}
export interface Capture {
  readonly binding: number;
  readonly read: boolean;
  readonly write: boolean;
  readonly forwarded: boolean;
}
export interface ReceiverReference {
  readonly node: Expression;
  readonly scope: number;
  /** Undefined denotes the enclosing Script/Module receiver. */
  readonly owner: number | undefined;
}
export interface FunctionBinding {
  /** Script body vars initialized from parameters after defaults finish.
   * Function declarations initialize their own bindings instead. */
  readonly parameterCopies?: readonly {
    readonly source: number;
    readonly target: number;
  }[];
  /** Hidden immutable binding allocated only when an arrow captures this receiver. */
  readonly receiverBinding?: number;
  /** Ordinary functions own their receiver; arrows inherit this identity. */
  readonly receiver: number | undefined;
  readonly id: number;
  readonly parent: number | undefined;
  readonly scope: number;
  readonly node: Span;
  readonly captures: readonly Capture[];
}
export interface Reference {
  readonly node: Expression;
  readonly scope: number;
  readonly binding: number | undefined;
  readonly global: string | undefined;
  readonly access: "read" | "write" | "read-write";
}
export interface BindingAlias {
  readonly node: Span;
  readonly binding: number;
}
export interface AnnexFunctionCopy {
  readonly node: Span;
  readonly name: string;
  /** Undefined denotes the Script's variable environment. */
  readonly owner: Span | undefined;
}
export interface BoundModule {
  /** Eval names not declared by an eval-local class, in first-encounter order. */
  readonly externalPrivateNames?: readonly string[] | undefined;
  /** Owners of syntactic eval calls, separated by parameter and body phase. */
  readonly directEvalOwners?:
    | readonly {
        readonly owner: Span | undefined;
        readonly parameters: boolean;
      }[]
    | undefined;
  readonly annexFunctionCopies?: readonly AnnexFunctionCopy[];
  /** Ordinary functions whose own arguments object can be observed: a syntactic
   * `arguments` reference or a direct eval, in the function itself or in a
   * nested arrow (which shares its receiver). Conservative: shadowed names and
   * unreachable code still count. Functions absent here never need one. */
  readonly argumentsOwners: readonly Span[];
  /** Whether any `with` statement occurs in this unit. Without one, no
   * identifier resolves to an object environment with a base object, so an
   * identifier callee's this value is always undefined. */
  readonly containsWith: boolean;
  /** Script var initializers/iteration writes whose target differs from the
   * hoisted declaration (a same-named simple catch parameter). */
  readonly varInitializerTargets?: readonly BindingAlias[];
  readonly receiverReferences: readonly ReceiverReference[];
  readonly aliases?: readonly BindingAlias[];
  readonly scopes: readonly Scope[];
  readonly bindings: readonly Binding[];
  readonly functions: readonly FunctionBinding[];
  readonly references: readonly Reference[];
}
export interface BindingError extends Span {
  readonly code:
    | "UNKNOWN_NAME"
    | "DUPLICATE_NAME"
    | "IMMUTABLE"
    | "INVALID_CONTEXT"
    | "LIMIT"
    | "UNSUPPORTED";
  readonly message: string;
}
export type BindingResult =
  | { readonly ok: true; readonly value: BoundModule }
  | { readonly ok: false; readonly error: BindingError };
interface BindingState extends Binding {
  captured: boolean;
}
interface CaptureState extends Capture {
  read: boolean;
  write: boolean;
  forwarded: boolean;
}
interface FunctionState extends FunctionBinding {
  receiverBinding?: number;
  captures: CaptureState[];
}
interface ScopeState extends Scope {
  readonly strict: boolean;
  names: KeyIndex<string, number>;
}
/** Value-namespace binding only. Initialization, type checking and escape proofs are separate passes. */
export function bindModule(
  module: Module,
  globals: readonly string[] = [],
): BindingResult {
  return bindProgram(module, globals, false, "module");
}
/** Bind a parsed strict JavaScript Script. Unresolved names and writes to
 * immutable bindings remain runtime operations. */
export function bindStrictScript(script: Module): BindingResult {
  if (script.strict === false)
    return {
      ok: false,
      error: {
        start: script.start,
        end: script.end,
        code: "UNSUPPORTED",
        message: "strict binding requires strict Script input",
      },
    };
  return bindProgram(script, [], true, "script");
}
/** Resolve optional Annex B vars only after checking the original declarations.
 * The second binding pass makes those vars visible to references and captures;
 * replacing a lexical declaration before validation would change early errors. */
export function bindScript(script: Module): BindingResult {
  return bindScriptProgram(script, undefined);
}
/** A caller private environment defers external names to eval declaration
 * instantiation. Field restrictions follow arrows, not ordinary functions. */
export interface EvalBindingContext {
  readonly privateEnvironment: boolean;
  readonly fieldInitializer: boolean;
}
export function bindEvalScript(
  script: Module,
  context: EvalBindingContext,
): BindingResult {
  return bindScriptProgram(script, context);
}
function bindScriptProgram(
  script: Module,
  context: EvalBindingContext | undefined,
): BindingResult {
  const initial = bindProgram(script, [], true, "script", false, [], context);
  if (!initial.ok) return initial;
  const copies = initial.value.annexFunctionCopies ?? [];
  return copies.length === 0
    ? initial
    : bindProgram(script, [], true, "script", false, copies, context);
}
/** JavaScript modules retain module declaration rules while unresolved names and
 * immutable writes remain runtime operations, as in Script binding. */
export function bindJavaScriptModule(module: Module): BindingResult {
  return bindProgram(module, [], true, "module");
}
/** Check declaration and context early errors without promising executable
 * binding plans for syntax whose runtime binding rules are still unsupported. */
export function validateJavaScriptBindings(
  module: Module,
  goal: "script" | "module",
): BindingError | undefined {
  const result = bindProgram(module, [], true, goal, true);
  return result.ok ? undefined : result.error;
}
function bindProgram(
  module: Module,
  globals: readonly string[],
  javascript: boolean,
  rootKind: "script" | "module",
  syntaxOnly: boolean = false,
  annexPlan: readonly AnnexFunctionCopy[] = [],
  evalContext: EvalBindingContext | undefined = undefined,
): BindingResult {
  const scopes: ScopeState[] = [],
    bindings: BindingState[] = [],
    aliases: BindingAlias[] = [],
    varInitializerTargets: BindingAlias[] = [],
    functions: FunctionState[] = [],
    references: Reference[] = [],
    receiverReferences: ReceiverReference[] = [];
  const directEvalOwners: { owner: Span | undefined; parameters: boolean }[] =
    [];
  const directEvalOwnerKeys = new Set<string>();
  let containsWith = false;
  const argumentsOwnerIds = new Set<number>();
  const argumentsOwners: Span[] = [];
  /** Attribute a possible arguments observation to the receiver-owning function. */
  function observeArguments(s: ScopeState): void {
    if (s.owner === undefined) return;
    const receiver = functions[s.owner]?.receiver;
    if (receiver === undefined || argumentsOwnerIds.has(receiver)) return;
    const owner = functions[receiver];
    if (owner === undefined) throw "arguments owner invariant";
    argumentsOwnerIds.add(receiver);
    argumentsOwners.push(owner.node);
  }
  const parameterOwners = new Set<number>();
  // Syntax nodes have no hashable identity in native images, where an
  // object-keyed Set scans its members; hashing the node's syntax identity
  // keeps identity equality while making membership constant time.
  function nodeSet(): KeyIndex<Span, boolean> {
    return createKeyIndex<Span, boolean>((node: Span): number =>
      syntaxHash(node),
    );
  }
  const simpleCatchBindings = nodeSet();
  const annexFunctions = nodeSet();
  const annexScopes = new Map<
    Statement & { readonly kind: "function" },
    ScopeState
  >();
  const parameterNames = new Map<number, Set<string>>();
  const declaredFunctions = nodeSet();
  const external = new Set(globals),
    abort = {};
  let error: BindingError | undefined,
    depth = 0;
  function fail(
    node: Span,
    code: BindingError["code"],
    message: string,
  ): never {
    error = { start: node.start, end: node.end, code, message };
    throw abort;
  }
  function scope(
    parent: ScopeState | undefined,
    kind: Scope["kind"],
    node: Span,
    owner: number | undefined,
    strict: boolean = parent === undefined
      ? module.strict !== false
      : parent.strict,
  ): ScopeState {
    const result: ScopeState = {
      strict,
      id: scopes.length,
      parent: parent?.id,
      owner,
      kind,
      node,
      names: createStringIndex<number>(),
    };
    scopes.push(result);
    return result;
  }
  function declare(
    s: ScopeState,
    name: string,
    kind: Binding["kind"],
    node: Span,
  ): void {
    const previousId = s.names.get(name);
    if (previousId !== undefined) {
      const previous = bindings[previousId];
      if (previous === undefined) throw "binding invariant";
      if (
        kind === "var" &&
        (previous.kind === "var" ||
          previous.kind === "parameter" ||
          (previous.kind === "function" && s.kind !== "module"))
      ) {
        aliases.push({ node, binding: previousId });
        return;
      }
      if (
        kind === "function" &&
        ((previous.kind === "var" && s.kind !== "module") ||
          (javascript &&
            (s.kind === "script" ||
              s.kind === "function" ||
              s.kind === "function-body") &&
            (previous.kind === "function" ||
              (s.kind === "function" && previous.kind === "parameter"))))
      ) {
        // Script/function-body declarations share a var binding. Strict block
        // functions remain lexical and cannot redeclare another block binding.
        aliases.push({ node: previous.node, binding: previousId });
        bindings[previousId] = { ...previous, kind, node };
        return;
      }
      if (
        javascript &&
        kind === "function" &&
        previous.kind === "function" &&
        !s.strict &&
        annexFunctions.has(node) &&
        annexFunctions.has(previous.node)
      ) {
        aliases.push({ node: previous.node, binding: previousId });
        bindings[previousId] = { ...previous, node };
        return;
      }
      fail(node, "DUPLICATE_NAME", `duplicate value binding: ${name}`);
    }
    s.names.set(name, registerBinding(s, name, kind, node));
  }
  function registerBinding(
    s: ScopeState,
    name: string,
    kind: Binding["kind"],
    node: Span,
  ): number {
    const id = bindings.length;
    bindings.push({
      id,
      name,
      kind,
      scope: s.id,
      owner: s.owner,
      mutable: kind !== "const" && kind !== "import",
      captured: false,
      node,
    });
    return id;
  }
  function predeclare(nodes: readonly Statement[], s: ScopeState): void {
    for (const input of nodes) {
      if (input === undefined) throw "statement invariant";
      const node = javascript
        ? (statementFunctionDeclaration(input) ?? input)
        : input;
      if (node.kind === "variable" && node.mode !== "var")
        for (const b of node.declarations) {
          if (b === undefined) throw "declaration invariant";
          for (const identifier of bindingIdentifiers(b)) {
            if (identifier === undefined) throw "binding identifier invariant";
            declare(s, identifier.name, node.mode, identifier);
          }
        }
      else if (
        javascript &&
        node.kind === "export-default" &&
        node.declaration
      ) {
        const value = node.value;
        if (value.kind === "function-expression" && value.name !== undefined)
          declare(s, value.name, "function", value);
        else if (value.kind === "class-expression") {
          const definition = value.definition;
          if (definition.name !== undefined)
            declare(s, definition.name, "let", definition);
        }
      } else if (node.kind === "class") declare(s, node.name, "let", node);
      else if (node.kind === "function") {
        declaredFunctions.set(node, true);
        if (
          javascript &&
          !node.generator &&
          !node.async &&
          !s.strict &&
          (s.kind === "block" || s.kind === "for")
        ) {
          annexFunctions.set(node, true);
          annexScopes.set(node, s);
        }
        declare(s, node.name, "function", node);
      } else if (node.kind === "import")
        for (const b of node.declaration.bindings) {
          if (b === undefined) throw "import binding invariant";
          if (!node.declaration.typeOnly && !b.typeOnly)
            declare(s, b.local, "import", node);
        }
    }
  }
  function hoistVariables(node: Statement, target: ScopeState): void {
    if (++depth > 256) fail(node, "LIMIT", "binding nesting limit exceeded");
    try {
      switch (node.kind) {
        case "variable":
          if (node.mode === "var")
            for (const declaration of node.declarations) {
              if (declaration === undefined) throw "declaration invariant";
              for (const identifier of bindingIdentifiers(declaration)) {
                if (identifier === undefined)
                  throw "binding identifier invariant";
                declare(target, identifier.name, "var", identifier);
              }
            }
          break;
        case "block":
          for (const child of node.statements) {
            if (child === undefined) throw "statement invariant";
            hoistVariables(child, target);
          }
          break;
        case "if":
          hoistVariables(node.consequent, target);
          if (node.alternate !== undefined)
            hoistVariables(node.alternate, target);
          break;
        case "with":
        case "label":
        case "while":
        case "do-while":
        case "for-of-assignment":
        case "for-in-assignment":
          hoistVariables(node.body, target);
          break;
        case "for":
          if (node.initializer !== undefined)
            hoistVariables(node.initializer, target);
          hoistVariables(node.body, target);
          break;
        case "for-in":
        case "for-of": {
          if (node.mode === "var") {
            const binding = node.binding;
            for (const item of bindingIdentifiers(binding))
              if (item !== undefined) declare(target, item.name, "var", item);
          }
          hoistVariables(node.body, target);
          break;
        }
        case "switch":
          for (const clause of node.clauses) {
            if (clause === undefined) throw "clause invariant";
            for (const child of clause.statements) {
              if (child === undefined) throw "statement invariant";
              hoistVariables(child, target);
            }
          }
          break;
        case "try":
          hoistVariables(node.body, target);
          if (node.handler !== undefined)
            hoistVariables(node.handler.body, target);
          if (node.finalizer !== undefined)
            hoistVariables(node.finalizer, target);
          break;
      }
    } finally {
      depth--;
    }
  }
  function checkVarPath(
    name: string,
    node: Span,
    scope: ScopeState,
    writes: boolean = true,
  ): void {
    let cursor: ScopeState | undefined = scope;
    let caught: number | undefined;
    while (
      cursor !== undefined &&
      cursor.kind !== "function" &&
      cursor.kind !== "function-body" &&
      cursor.kind !== "module" &&
      cursor.kind !== "script"
    ) {
      const existing = cursor.names.get(name);
      if (existing !== undefined) {
        const existingBinding = bindings[existing];
        if (
          existingBinding !== undefined &&
          simpleCatchBindings.has(existingBinding.node)
        ) {
          if (!javascript)
            fail(
              node,
              "UNSUPPORTED",
              "var redeclarations of catch parameters require separate initializer bindings",
            );
          if (caught === undefined) caught = existing;
        } else
          fail(
            node,
            "DUPLICATE_NAME",
            "var conflicts with an enclosing lexical binding: " + name,
          );
      }
      cursor = cursor.parent === undefined ? undefined : scopes[cursor.parent];
    }
    if (writes && caught !== undefined)
      varInitializerTargets.push({ node, binding: caught });
  }
  function reference(
    node: Expression & { readonly kind: "identifier" },
    s: ScopeState,
    access: Reference["access"],
    instanceConstructor: boolean = false,
  ): void {
    if (restrictedArguments && node.name === "arguments")
      fail(
        node,
        "INVALID_CONTEXT",
        "arguments is not allowed in class initializers",
      );
    if (node.name === "arguments") observeArguments(s);
    let cursor: ScopeState | undefined = s,
      id: number | undefined;
    while (cursor !== undefined) {
      id = cursor.names.get(node.name);
      if (id !== undefined) break;
      cursor = cursor.parent === undefined ? undefined : scopes[cursor.parent];
    }
    if (id === undefined) {
      if (!javascript && !external.has(node.name)) {
        if (otherLibraryGlobals.includes(node.name))
          fail(
            node,
            "UNKNOWN_NAME",
            "Program realm does not install the library global " + node.name,
          );
        if (
          instanceConstructor &&
          installedNonConstructorGlobals.includes(node.name)
        )
          fail(
            node,
            "UNKNOWN_NAME",
            "Program realm global " +
              node.name +
              " has no supported constructor projection",
          );
        if (instanceConstructor)
          fail(
            node,
            "UNKNOWN_NAME",
            "No pinned TypeScript library value named " + node.name,
          );
        fail(node, "UNKNOWN_NAME", "unknown value name: " + node.name);
      }
      references.push({
        node,
        scope: s.id,
        binding: undefined,
        global: node.name,
        access,
      });
      return;
    }
    const bindingId = id;
    const b = bindings[bindingId];
    if (b === undefined) throw "binding invariant";
    if (!javascript && access !== "read" && !b.mutable)
      fail(node, "IMMUTABLE", "cannot assign immutable binding: " + node.name);
    references.push({
      node,
      scope: s.id,
      binding: bindingId,
      global: undefined,
      access,
    });
    capture(bindingId, s, access);
  }
  function capture(
    bindingId: number,
    s: ScopeState,
    access: Reference["access"],
  ): void {
    const b = bindings[bindingId];
    if (b === undefined) throw "capture binding invariant";
    // Module bindings live in the module environment and are not closure captures.
    if (b.owner === undefined) return;
    let owner = s.owner;
    while (owner !== undefined && owner !== b.owner) {
      const f = functions[owner];
      if (f === undefined) throw "function invariant";
      let c = f.captures.find(
        (c) => c !== undefined && c.binding === bindingId,
      );
      if (c === undefined) {
        c = { binding: bindingId, read: false, write: false, forwarded: false };
        f.captures.push(c);
      }
      if (owner === s.owner) {
        if (!c.read) c.read = access !== "write";
        if (!c.write) c.write = access !== "read";
      } else c.forwarded = true;
      b.captured = true;
      owner = f.parent;
    }
  }
  const privateScopes: { names: Map<string, number> }[] = [];
  const externalPrivateNames: string[] = [];
  const externalPrivateSet = new Set<string>();
  let restrictedArguments: boolean =
    evalContext !== undefined && evalContext.fieldInitializer;
  function declareAnnexVariables(
    target: ScopeState,
    owner: Span | undefined,
  ): void {
    for (const copy of annexPlan) {
      if (copy === undefined) throw "annex copy invariant";
      if (
        copy.owner !== owner ||
        (owner !== undefined && copy.name === "arguments") ||
        target.names.get(copy.name) !== undefined
      )
        continue;
      declare(target, copy.name, "var", {
        start: copy.node.start,
        end: copy.node.end,
      });
    }
  }
  function fn(
    node: Span,
    parameters: readonly Parameter[],
    body: BlockStatement | Expression,
    parent: ScopeState,
    lexicalReceiver: boolean,
    classInitializer: boolean = false,
    strict: boolean = true,
  ): void {
    const outerArguments = restrictedArguments;
    if (!lexicalReceiver) restrictedArguments = classInitializer;
    const id = functions.length,
      s = scope(parent, "function", node, id, strict);
    functions.push({
      receiver: lexicalReceiver
        ? parent.owner === undefined
          ? undefined
          : functions[parent.owner]?.receiver
        : id,
      id,
      parent: parent.owner,
      scope: s.id,
      node,
      captures: [],
    });
    const names = new Set<string>();
    parameterNames.set(id, names);
    for (const parameter of parameters) {
      if (parameter === undefined) throw "parameter invariant";
      for (const identifier of parameterIdentifiers(parameter)) {
        if (identifier === undefined) throw "parameter identifier invariant";
        names.add(identifier.name);
      }
    }
    const duplicateParameters =
      javascript &&
      !strict &&
      !lexicalReceiver &&
      parameters.every((p) => isSimpleParameter(p));
    for (const parameter of parameters) {
      if (parameter === undefined) throw "parameter invariant";
      if (!javascript && parameter.kind === "pattern-parameter")
        registerBinding(s, "", "parameter", parameter);
      for (const p of parameterIdentifiers(parameter)) {
        if (p === undefined) throw "parameter identifier invariant";
        const existing = s.names.get(p.name);
        if (existing !== undefined && duplicateParameters)
          aliases.push({ node: p, binding: existing });
        else declare(s, p.name, "parameter", p);
      }
    }
    // Defaults see every parameter (including later TDZ bindings), but no body locals.
    parameterOwners.add(id);
    for (const p of parameters) {
      if (p === undefined) throw "parameter invariant";
      visitParameterExpressions(p, (expression) => expr(expression, s));
    }
    parameterOwners.delete(id);
    if (body.kind === "block") {
      if (
        javascript &&
        parameters.some((p) => p !== undefined && parameterHasExpressions(p))
      ) {
        const local = scope(s, "function-body", body, id);
        // Lexical declarations cannot redeclare parameters even when the var
        // environment is separate. Nested blocks may still shadow them.
        for (const statement of body.statements) {
          if (statement === undefined) throw "statement invariant";
          if (
            statement.kind === "class" &&
            s.names.get(statement.name) !== undefined
          )
            fail(
              statement,
              "DUPLICATE_NAME",
              "lexical binding conflicts with parameter: " + statement.name,
            );
          if (statement.kind !== "variable" || statement.mode === "var")
            continue;
          for (const declaration of statement.declarations) {
            if (declaration === undefined) throw "declaration invariant";
            for (const identifier of bindingIdentifiers(declaration)) {
              if (identifier === undefined)
                throw "binding identifier invariant";
              if (s.names.get(identifier.name) !== undefined)
                fail(
                  identifier,
                  "DUPLICATE_NAME",
                  "lexical binding conflicts with parameter: " +
                    identifier.name,
                );
            }
          }
        }
        hoistVariables(body, local);
        declareAnnexVariables(local, node);
        predeclare(body.statements, local);
        const copies: { source: number; target: number }[] = [];
        for (const parameter of parameters) {
          if (parameter === undefined) throw "parameter invariant";
          for (const identifier of parameterIdentifiers(parameter)) {
            if (identifier === undefined)
              throw "parameter identifier invariant";
            const source = s.names.get(identifier.name),
              target = local.names.get(identifier.name);
            if (
              source !== undefined &&
              target !== undefined &&
              bindings[target]?.kind === "var"
            )
              copies.push({ source, target });
          }
        }
        const fn = functions[id];
        if (fn === undefined) throw "function invariant";
        functions[id] = { ...fn, parameterCopies: copies };
        for (const statement of body.statements) {
          if (statement === undefined) throw "statement invariant";
          stmt(statement, local);
        }
      } else {
        hoistVariables(body, s);
        declareAnnexVariables(s, node);
        statements(body.statements, s);
      }
    } else expr(body, s);
    restrictedArguments = outerArguments;
  }
  function classDefinition(node: ClassDefinition, parent: ScopeState): void {
    for (const decorator of node.decorators ?? []) {
      if (decorator === undefined) throw "CLASS_DECORATOR_INVARIANT";
      expr(decorator, parent);
    }
    const local = scope(parent, "block", node, parent.owner);
    if (node.name !== undefined) declare(local, node.name, "const", node);
    if (node.heritage !== undefined) expr(node.heritage, local);
    const names = new Map<string, number>();
    for (const element of node.elements) {
      if (element === undefined) throw "CLASS_ELEMENT_INVARIANT";
      if (element.kind === "static-block" || !element.private) continue;
      const key = element.key;
      if (key.kind !== "string") throw "PRIVATE_NAME_INVARIANT";
      const mask =
        (element.static ? 8 : 0) |
        (element.kind === "get" ? 1 : element.kind === "set" ? 2 : 4);
      const existing = names.get(key.value);
      if (existing !== undefined) {
        if (
          (existing & 8) !== (mask & 8) ||
          ((existing | mask) & 7) !== 3 ||
          (existing & mask & 7) !== 0
        )
          fail(
            element,
            "DUPLICATE_NAME",
            `duplicate private name: ${key.value}`,
          );
        names.set(key.value, existing | mask);
      } else names.set(key.value, mask);
    }
    privateScopes.push({ names });
    try {
      for (const element of node.elements) {
        if (element === undefined) throw "CLASS_ELEMENT_INVARIANT";
        if (element.kind === "static-block") {
          fn(element, [], element.body, local, false, true);
          continue;
        }
        for (const decorator of element.decorators ?? []) {
          if (decorator === undefined) throw "ELEMENT_DECORATOR_INVARIANT";
          expr(decorator, local);
        }
        if (element.computed) expr(element.key, local);
        if (element.kind !== "field")
          fn(element, element.parameters, element.body, local, false);
        else if (element.initializer !== undefined)
          fn(element, [], element.initializer, local, false, true);
      }
    } finally {
      privateScopes.pop();
    }
  }
  function checkPrivateName(name: string, node: Span): void {
    for (let i = privateScopes.length - 1; i >= 0; i--) {
      const privateScope = privateScopes[i];
      if (privateScope === undefined) throw "PRIVATE_SCOPE_INVARIANT";
      if (privateScope.names.has(name)) return;
    }
    if (evalContext !== undefined && evalContext.privateEnvironment) {
      if (!externalPrivateSet.has(name)) {
        externalPrivateSet.add(name);
        externalPrivateNames.push(name);
      }
      return;
    }
    fail(node, "INVALID_CONTEXT", `undeclared private name: ${name}`);
  }
  function expr(
    node: Expression,
    s: ScopeState,
    access: Reference["access"] = "read",
  ): void {
    if (++depth > 256) fail(node, "LIMIT", "binding nesting limit exceeded");
    try {
      switch (node.kind) {
        case "class-expression":
          classDefinition(node.definition, s);
          break;
        case "private-in":
          checkPrivateName(node.name, node);
          expr(node.object, s);
          break;
        case "new-target":
          break;
        case "import-meta":
          if (!javascript)
            fail(node, "UNSUPPORTED", "typed import.meta is not implemented");
          break;
        case "import-call":
          if (!javascript)
            fail(
              node,
              "UNSUPPORTED",
              "typed dynamic import is not implemented",
            );
          expr(node.specifier, s);
          if (node.options !== undefined) expr(node.options, s);
          break;
        case "super":
        case "this": {
          const owner =
            s.owner === undefined ? undefined : functions[s.owner]?.receiver;
          if (owner !== undefined && owner !== s.owner) {
            const fn = functions[owner];
            if (fn === undefined) throw "receiver owner invariant";
            let binding = fn.receiverBinding;
            if (binding === undefined) {
              binding = bindings.length;
              bindings.push({
                id: binding,
                name: "[[ThisValue]]",
                kind: "const",
                scope: fn.scope,
                owner,
                mutable: false,
                captured: false,
                node,
              });
              fn.receiverBinding = binding;
            }
            capture(binding, s, "read");
          }
          receiverReferences.push({
            node,
            scope: s.id,
            owner:
              s.owner === undefined ? undefined : functions[s.owner]?.receiver,
          });
          break;
        }
        case "identifier":
          reference(node, s, access);
          break;
        case "satisfies":
        case "group":
          expr(node.expression, s, access);
          break;
        case "function-expression":
        case "arrow": {
          let parent = s;
          const selfName =
            node.kind === "function-expression" ? node.name : undefined;
          if (selfName !== undefined) {
            if (!javascript)
              fail(
                node,
                "UNSUPPORTED",
                "typed named function expression lowering is not implemented",
              );
            parent = scope(s, "block", node, s.owner);
            declare(parent, selfName, "const", node);
          }
          fn(
            node,
            node.parameters,
            node.body,
            parent,
            node.kind === "arrow",
            false,
            node.strict !== false,
          );
          break;
        }
        case "await":
        case "yield":
          if (node.expression !== undefined) expr(node.expression, s);
          break;
        case "spread":
          expr(node.value, s, access);
          break;
        case "template-expression":
          for (const substitution of node.substitutions) {
            if (substitution === undefined)
              throw "TEMPLATE_SUBSTITUTION_INVARIANT";
            expr(substitution, s);
          }
          break;
        case "tagged-template":
          expr(node.tag, s);
          expr(node.template, s);
          break;
        case "array":
          for (const element of node.elements) {
            if (element === undefined) throw "array element invariant";
            expr(element, s, access);
          }
          break;
        case "object":
          for (const p of node.properties) {
            if (p === undefined) throw "object property invariant";
            if (p.kind !== "spread" && p.keyExpression !== undefined)
              expr(p.keyExpression, s);
            expr(p.value, s, access === "write" ? "write" : "read");
          }
          break;
        case "member":
          if (node.private) checkPrivateName(node.property, node);
          expr(node.object, s);
          break;
        case "index":
          expr(node.object, s);
          expr(node.index, s);
          break;
        case "unary":
          expr(node.operand, s);
          break;
        case "binary": {
          expr(node.left, s);
          let target = node.right;
          while (target.kind === "group") target = target.expression;
          if (node.operator === "instanceof" && target.kind === "identifier")
            reference(target, s, "read", true);
          else expr(node.right, s);
          break;
        }
        case "conditional":
          expr(node.test, s);
          expr(node.consequent, s);
          expr(node.alternate, s);
          break;
        case "new":
        case "call":
          if (isDirectEvalCandidate(node)) {
            observeArguments(s);
            const parameters =
              s.owner !== undefined && parameterOwners.has(s.owner);
            const key =
              (s.owner === undefined ? -1 : s.owner) + ":" + parameters;
            if (!directEvalOwnerKeys.has(key)) {
              directEvalOwnerKeys.add(key);
              directEvalOwners.push({
                owner:
                  s.owner === undefined ? undefined : functions[s.owner]?.node,
                parameters,
              });
            }
          }
          expr(node.callee, s);
          for (const a of node.arguments) {
            if (a === undefined) throw "argument invariant";
            expr(a, s);
          }
          break;
        case "update":
          expr(node.target, s, "read-write");
          break;
        case "compound":
          expr(node.target, s, "read-write");
          expr(node.value, s);
          break;
        case "assignment":
          expr(node.target, s, "write");
          expr(node.value, s);
          break;
        case "regexp":
          if (!javascript)
            fail(
              node,
              "UNSUPPORTED",
              "typed RegExp values are not implemented",
            );
          break;
        case "bigint":
        case "number":
        case "boolean":
        case "string":
        case "null":
          break;
      }
    } finally {
      depth--;
    }
  }
  function statements(nodes: readonly Statement[], s: ScopeState): void {
    predeclare(nodes, s);
    for (const node of nodes) {
      if (node === undefined) throw "statement invariant";
      stmt(node, s);
    }
  }
  function stmt(node: Statement, s: ScopeState): void {
    if (++depth > 256) fail(node, "LIMIT", "binding nesting limit exceeded");
    try {
      switch (node.kind) {
        case "class":
          classDefinition(node.definition, s);
          break;
        case "try": {
          stmt(node.body, s);
          const handler = node.handler;
          if (handler !== undefined) {
            const caught = scope(s, "block", handler.body, s.owner);
            const binding = handler.binding;
            if (binding !== undefined) {
              if (
                binding.kind !== "object-binding" &&
                binding.kind !== "array-binding"
              )
                simpleCatchBindings.set(binding, true);
              for (const identifier of bindingIdentifiers(binding)) {
                if (identifier === undefined) throw "catch binding invariant";
                declare(caught, identifier.name, "catch", identifier);
              }
              visitBindingExpressions(binding, (expression) =>
                expr(expression, caught),
              );
            }
            statements(handler.body.statements, caught);
          }
          if (node.finalizer !== undefined) stmt(node.finalizer, s);
          break;
        }
        case "block":
          statements(node.statements, scope(s, "block", node, s.owner));
          break;
        case "variable":
          if (!javascript && node.disposal !== undefined)
            fail(node, "UNSUPPORTED", "resource disposal is not implemented");
          for (const b of node.declarations) {
            if (b === undefined) throw "declaration invariant";
            if (node.mode === "var")
              for (const identifier of bindingIdentifiers(b)) {
                if (identifier === undefined)
                  throw "binding identifier invariant";
                checkVarPath(
                  identifier.name,
                  identifier,
                  s,
                  b.initializer !== undefined,
                );
              }
            visitBindingExpressions(b, (expression) => expr(expression, s));
          }
          break;
        case "function": {
          if (
            javascript &&
            !s.strict &&
            !node.async &&
            !node.generator &&
            !declaredFunctions.has(node)
          ) {
            // Annex B.3.3 treats an if-arm declaration as a synthetic block.
            statements([node], scope(s, "block", node, s.owner));
            break;
          }
          const body = node.body;
          if (body.kind !== "block") throw "function body invariant";
          fn(
            node,
            node.parameters,
            body,
            s,
            false,
            false,
            node.strict !== false,
          );
          break;
        }
        case "expression":
        case "throw":
          expr(node.expression, s);
          break;
        case "return":
          if (node.expression !== undefined) expr(node.expression, s);
          break;
        case "if":
          expr(node.test, s);
          stmt(node.consequent, s);
          if (node.alternate !== undefined) stmt(node.alternate, s);
          break;
        case "switch": {
          expr(node.expression, s);
          const body = scope(s, "block", node, s.owner);
          const children: Statement[] = [];
          for (const clause of node.clauses) {
            if (clause === undefined) throw "switch clause invariant";
            for (const child of clause.statements) {
              if (child === undefined) throw "switch statement invariant";
              children.push(child);
            }
          }
          predeclare(children, body);
          for (const clause of node.clauses) {
            if (clause === undefined) throw "switch clause invariant";
            if (clause.test !== undefined) expr(clause.test, body);
            for (const child of clause.statements) {
              if (child === undefined) throw "switch statement invariant";
              stmt(child, body);
            }
          }
          break;
        }
        case "label":
          stmt(node.body, s);
          break;
        case "with":
          if (!javascript)
            fail(node, "UNSUPPORTED", "with requires dynamic name resolution");
          containsWith = true;
          expr(node.object, s);
          stmt(node.body, s);
          break;
        case "do-while":
        case "while":
          expr(node.test, s);
          stmt(node.body, s);
          break;
        case "for-of-assignment":
        case "for-in-assignment":
          if (!javascript && node.kind === "for-of-assignment")
            fail(
              node,
              "UNSUPPORTED",
              "typed iteration assignment lowering is not implemented",
            );
          expr(node.iterable, s);
          expr(node.target, s, "write");
          stmt(node.body, s);
          break;
        case "for-in":
        case "for-of": {
          if (!javascript && node.disposal !== undefined)
            fail(node, "UNSUPPORTED", "resource disposal is not implemented");
          const loop = scope(s, "for", node, s.owner);
          const iterationBinding = node.binding;
          for (const element of bindingIdentifiers(iterationBinding))
            if (element !== undefined) {
              if (node.mode === "var") checkVarPath(element.name, element, s);
              else declare(loop, element.name, node.mode, element);
            }
          expr(node.iterable, loop);
          visitBindingExpressions(iterationBinding, (expression) =>
            expr(expression, loop),
          );
          stmt(node.body, loop);
          break;
        }
        case "for": {
          const loop = scope(s, "for", node, s.owner);
          const initializer = node.initializer;
          if (initializer !== undefined) {
            predeclare([initializer], loop);
            stmt(initializer, loop);
          }
          if (node.test !== undefined) expr(node.test, loop);
          if (node.update !== undefined) expr(node.update, loop);
          stmt(node.body, loop);
          break;
        }
        case "type-alias":
        case "interface":
        case "export":
        case "import":
        case "break":
        case "continue":
        case "debugger":
        case "empty":
          break;
        case "export-default": {
          if (!javascript)
            fail(
              node,
              "UNSUPPORTED",
              "typed default export lowering is not implemented",
            );
          const value = node.value;
          if (node.declaration && value.kind === "function-expression")
            fn(
              value,
              value.parameters,
              value.body,
              s,
              false,
              false,
              value.strict !== false,
            );
          else expr(value, s);
          break;
        }
      }
    } finally {
      depth--;
    }
  }
  function checkModuleExports(root: ScopeState): void {
    const names = createStringIndex<boolean>();
    function exported(name: string, node: Span): void {
      if (names.has(name))
        fail(node, "DUPLICATE_NAME", "duplicate export: " + name);
      names.set(name, true);
    }
    for (const node of module.statements) {
      if (node === undefined) throw "module statement invariant";
      if (node.kind === "export-default") exported("default", node);
      else if (node.kind === "export") {
        const declaration = node.declaration;
        if (declaration.typeOnly) continue;
        for (const binding of declaration.bindings ?? []) {
          if (binding === undefined) throw "export binding invariant";
          if (binding.typeOnly) continue;
          exported(binding.exported, declaration);
          if (
            declaration.source === undefined &&
            !root.names.has(binding.local)
          )
            fail(
              declaration,
              "INVALID_CONTEXT",
              "export has no local binding: " + binding.local,
            );
        }
      } else if (node.kind === "variable" && node.exported) {
        for (const declaration of node.declarations) {
          if (declaration === undefined) throw "declaration invariant";
          for (const binding of bindingIdentifiers(declaration)) {
            if (binding === undefined) throw "binding identifier invariant";
            exported(binding.name, binding);
          }
        }
      } else if (
        (node.kind === "function" || node.kind === "class") &&
        node.exported
      )
        exported(node.name, node);
    }
  }
  try {
    const root = scope(undefined, rootKind, module, undefined);
    for (const node of module.statements) {
      if (node === undefined) throw "statement invariant";
      hoistVariables(node, root);
    }
    declareAnnexVariables(root, undefined);
    statements(module.statements, root);
    if (javascript && rootKind === "module") checkModuleExports(root);
  } catch (e) {
    if (e !== abort) throw e;
  }
  if (error !== undefined) return { ok: false, error };
  const annexFunctionCopies: AnnexFunctionCopy[] = [];
  for (const [node, block] of annexScopes) {
    if (node === undefined || block === undefined)
      throw "annex scope invariant";
    if (
      block.owner !== undefined &&
      parameterNames.get(block.owner)?.has(node.name)
    )
      continue;
    let cursor = block.parent === undefined ? undefined : scopes[block.parent];
    let allowed = true;
    while (cursor !== undefined) {
      const existing = cursor.names.get(node.name);
      const binding = existing === undefined ? undefined : bindings[existing];
      if (
        binding !== undefined &&
        !(
          binding.kind === "var" ||
          (binding.kind === "function" &&
            cursor.kind !== "block" &&
            cursor.kind !== "for") ||
          (binding.kind === "catch" && simpleCatchBindings.has(binding.node))
        )
      ) {
        allowed = false;
        break;
      }
      if (
        cursor.kind === "function" ||
        cursor.kind === "function-body" ||
        cursor.kind === "script"
      )
        break;
      cursor = cursor.parent === undefined ? undefined : scopes[cursor.parent];
    }
    if (allowed)
      annexFunctionCopies.push({
        node,
        name: node.name,
        owner:
          block.owner === undefined ? undefined : functions[block.owner]?.node,
      });
  }
  for (const f of functions) {
    if (f === undefined) throw "function invariant";
    f.captures.sort((a, b): number => {
      if (a === undefined || b === undefined) throw "capture invariant";
      return a.binding - b.binding;
    });
  }
  return {
    ok: true,
    value: {
      externalPrivateNames:
        externalPrivateNames.length === 0 ? undefined : externalPrivateNames,
      directEvalOwners:
        directEvalOwners.length === 0 ? undefined : directEvalOwners,
      argumentsOwners,
      containsWith,
      varInitializerTargets,
      annexFunctionCopies,
      receiverReferences,
      aliases,
      scopes: scopes.map((s) => ({
        strict: s.strict,
        id: s.id,
        parent: s.parent,
        owner: s.owner,
        kind: s.kind,
        node: s.node,
      })),
      bindings,
      functions,
      references,
    },
  };
}
export {
  statementFunctionDeclaration,
  collectStrictScriptDeclarations,
  collectScriptDeclarations,
  collectModuleDeclarations,
  type ModuleDeclarations,
  type ModuleDefaultFunction,
  type ScriptDeclarations,
  type ScriptLexicalDeclaration,
} from "./script.ts";
