import { forwardSingleUseTemporaries } from "./forward-temporaries.ts";
import { collectTailCalls } from "./tail-position.ts";
import { sourceModuleShape } from "./module-shape.ts";
import {
  directEvalStrict,
  directEvalInFunction,
  directEvalInMethod,
  directEvalInDerivedConstructor,
  directEvalInPrivateEnvironment,
  directEvalInClassFieldInitializer,
} from "./direct-eval-flags.ts";
export * from "./direct-eval-flags.ts";
import {
  scriptRuntimeImports,
  scriptRuntimeTypeArguments,
} from "./runtime-imports.ts";
export {
  scriptRuntimeImports,
  scriptRuntimeSurface,
  scriptRuntimeSupportsDynamicImport,
  scriptRuntimeSupportsTemplateSites,
  scriptRuntimeSupportsCompactResults,
  scriptRuntimeSupportsFusedResults,
  scriptRuntimeSupportsRetainedFunctions,
  scriptRuntimeSupportsLiteralTables,
  scriptRuntimeSupportsEngineAborts,
  type ScriptRuntimeSurfaceEntry,
} from "./runtime-imports.ts";
import { generatorContinuation } from "./generators.ts";
import { primitiveContractBit } from "@tint/foundation/values/primitive-contract";
import {
  isOptionalChain,
  isDirectEvalCandidate,
  expectedArgumentCount,
  bindingIdentifiers,
  rewriteModule,
  parameterIdentifiers,
  parameterHasExpressions,
  typeParameterCount,
  isSimpleParameter,
  type BlockStatement,
  type CatchClause,
  type Parameter,
  type DynamicFunctionSyntax,
  type Binding,
  type VariableBinding,
  type SwitchClause,
  type Module,
  type Statement,
  type Expression,
  type Span,
  type TypeNode,
  type PropertySignature,
  type ObjectProperty,
  type ClassDefinition,
  type ClassElement,
} from "@tint/typescript/syntax";
import {
  bindScript,
  bindJavaScriptModule,
  directEvalUnavailable,
  collectModuleDeclarations,
  type ModuleDefaultFunction,
  bindEvalScript,
  type EvalBindingContext,
  collectScriptDeclarations,
  statementFunctionDeclaration,
} from "@tint/typescript/binding";

export interface ScriptLoweringError extends Span {
  readonly code: "EARLY_ERROR" | "UNSUPPORTED" | "LIMIT";
  readonly message: string;
}
export type ScriptLoweringResult =
  | { readonly ok: true; readonly value: Module }
  | { readonly ok: false; readonly error: ScriptLoweringError };
/** Code compiled at runtime shares a per-entry native code budget. Such entries
 * complete runtime results through out-of-line helpers (throwIfRuntimeError,
 * getIdentifierValue) with unchanged semantics; AOT output keeps inline checks. */
export interface ScriptLoweringOptions {
  readonly runtimeCompiled?: boolean;
  readonly nativeScriptCalls?: boolean;
  /** False when the host creates no Annex B [[IsHTMLDDA]] objects: inline
   * loose equality with null omits their check, and the lowered module
   * excludes such objects when it initializes (markHTMLDDAObject then
   * fails). Defaults to true. */
  readonly htmlDDAObjects?: boolean;
}
/** In-place cell slots of a property layout (js-runtime
 * propertyLayoutSlots): cached cells below this offset are read with
 * readPropertyLayoutSlot. */
export const propertyLayoutSlots = 8;
/** Immutable numeric imports proved by the hosted function planner. */
export interface NumericCallSite extends Span {
  readonly target: string;
}

interface NumericLeaf {
  readonly witness: Expression;
  readonly implementation: Expression;
  readonly arity: number;
  readonly mutable: boolean;
}

interface NumericRecord {
  readonly kind: "numeric-record";
  readonly fields: ReadonlySet<string>;
  readonly methods: ReadonlyMap<string, number>;
}
type NumericBinding =
  | "mutable"
  | "constant"
  | "string"
  | number
  | { readonly kind: "numeric-array"; readonly length: number }
  | {
      readonly kind: "numeric-factory";
      readonly arguments: number;
      readonly closureArguments: number;
    }
  | NumericRecord;

function numericRecord(
  object: Expression,
  bindings: ReadonlyMap<string, NumericBinding>,
): NumericRecord | undefined {
  if (object.kind !== "identifier") return undefined;
  const binding = bindings.get(object.name);
  return typeof binding === "object" && binding.kind === "numeric-record"
    ? binding
    : undefined;
}
function numericMember(
  node: Expression,
  bindings: ReadonlyMap<string, NumericBinding>,
): boolean {
  return (
    node.kind === "member" &&
    !node.optional &&
    !node.private &&
    numericRecord(node.object, bindings)?.fields.has(node.property) === true
  );
}
function numericArrayRead(
  node: Expression,
  bindings: ReadonlyMap<string, NumericBinding>,
): boolean {
  if (node.kind !== "index" || node.optional) return false;
  const object = node.object;
  if (object.kind !== "identifier") return false;
  const array = bindings.get(object.name);
  if (typeof array !== "object" || array.kind !== "numeric-array") return false;
  let index = node.index;
  while (index.kind === "group") index = index.expression;
  if (index.kind === "number")
    return (
      Number.isInteger(index.value) &&
      index.value >= 0 &&
      index.value < array.length
    );
  if (index.kind !== "binary" || index.operator !== "&") return false;
  const mask = index.right;
  return (
    mask.kind === "number" &&
    Number.isInteger(mask.value) &&
    mask.value >= 0 &&
    mask.value <= 2147483647 &&
    mask.value < array.length &&
    numericLeafExpression(index.left, bindings)
  );
}

/** These expressions cannot call user code once the parameters are numbers. */
function numericLeafExpression(
  node: Expression,
  bindings: ReadonlyMap<string, NumericBinding>,
): boolean {
  switch (node.kind) {
    case "number":
      return true;
    case "identifier": {
      const binding = bindings.get(node.name);
      return binding === "mutable" || binding === "constant";
    }
    case "group":
      return numericLeafExpression(node.expression, bindings);
    case "member":
      return numericMember(node, bindings);
    case "index":
      return numericArrayRead(node, bindings);
    case "unary":
      return (
        (node.operator === "+" || node.operator === "-") &&
        numericLeafExpression(node.operand, bindings)
      );
    case "binary":
      if (node.operator === "??")
        return (
          numericArrayRead(node.left, bindings) &&
          numericLeafExpression(node.right, bindings)
        );
      return (
        (node.operator === "+" ||
          node.operator === "-" ||
          node.operator === "*" ||
          node.operator === "/" ||
          node.operator === "%" ||
          node.operator === "&" ||
          node.operator === "|" ||
          node.operator === "^" ||
          node.operator === "<<" ||
          node.operator === ">>" ||
          node.operator === ">>>") &&
        numericLeafExpression(node.left, bindings) &&
        numericLeafExpression(node.right, bindings)
      );
    case "call": {
      const callee = node.callee;
      if (node.optional) return false;
      const arity =
        callee.kind === "identifier"
          ? bindings.get(callee.name)
          : callee.kind === "member" && !callee.optional && !callee.private
            ? numericRecord(callee.object, bindings)?.methods.get(
                callee.property,
              )
            : undefined;
      return (
        typeof arity === "number" &&
        node.arguments.length === arity &&
        node.arguments.every(
          (argument) =>
            argument !== undefined && numericLeafExpression(argument, bindings),
        )
      );
    }
    default:
      return false;
  }
}

/** Runtime-compiled entries read the global environment's fields (hooks,
 * object witness, lexical record, this value; fixed per realm) from
 * execute-level constants read once at entry, instead of a guarded record
 * read per operation. */
function hoistedEntryField(
  span: Span,
  field: string,
  owner: string = "$global",
): Statement {
  return {
    ...span,
    kind: "variable",
    mode: "const",
    exported: false,
    declarations: [
      {
        ...span,
        name: "$" + field,
        type: undefined,
        initializer: {
          ...span,
          kind: "member",
          object: { ...span, kind: "identifier", name: owner },
          property: field,
        },
      },
    ],
  };
}
const realmEntryFields: readonly string[] = [
  "agent",
  "arrayHooks",
  "arrayPrototype",
  "objectPrototype",
];
/** Global-environment and realm fields an entry body reads, each fixed for
 * the realm. Hoisting them keeps long entry bodies free of repeated field
 * reads whose layout proofs would have to reach back across the whole body. */
function hoistedFieldOwner(owner: string, property: string): boolean {
  if (owner === "$global")
    return (
      property === "hooks" ||
      property === "object" ||
      property === "lexical" ||
      property === "thisValue"
    );
  return (
    owner === "$errors" &&
    (property === "agent" ||
      property === "arrayHooks" ||
      property === "arrayPrototype" ||
      property === "objectPrototype")
  );
}
function localizeEntryFields(body: BlockStatement): BlockStatement {
  const rewritten = rewriteModule(
    { start: body.start, end: body.end, imports: [], statements: [body] },
    {
      expression: (mapped: Expression, _original: Expression): Expression => {
        if (mapped.kind !== "member") return mapped;
        const object = mapped.object;
        if (
          object.kind === "identifier" &&
          hoistedFieldOwner(object.name, mapped.property)
        )
          return {
            start: mapped.start,
            end: mapped.end,
            kind: "identifier",
            name: "$" + mapped.property,
          };
        return mapped;
      },
    },
  );
  const localized = rewritten.statements[0];
  if (localized === undefined || localized.kind !== "block")
    throw "SCRIPT_ENTRY_FIELD_INVARIANT";
  return localized;
}

/** Operations with a fused `<name>OrThrow` runtime helper for runtime-compiled
 * entries, and where the helper takes `$errors` when the operation's own
 * arguments lack the realm: 0 never, 1 after them, 2 before them. */
function fusedResultRealm(name: string): number | undefined {
  switch (name) {
    case "binaryObjectValueOperation":
    case "unaryObjectValueOperation":
    case "objectPropertyKey":
    case "stringValue":
    case "getObjectValueProperty":
    case "getObjectValuePropertyWithReceiver":
    case "setObjectValueProperty":
    case "setObjectValuePropertyWithReceiver":
    case "sloppyCallReceiver":
      return 0;
    case "deleteObjectValueProperty":
    case "callObjectValue":
    case "getBindingReference":
    case "putBindingReference":
      return 1;
    case "constructObjectValue":
      return 2;
    default:
      return undefined;
  }
}

interface ScriptResourceScope {
  readonly outer: Expression | undefined;
  readonly asynchronous: boolean;
  readonly resource: Expression;
  readonly failed: Expression;
  readonly thrown: Expression;
  readonly position: number;
}
interface CallableOptions {
  readonly resultType?: TypeNode | undefined;
  readonly sourceStart?: number | undefined;
  readonly generator?: boolean | undefined;
  readonly async?: boolean | undefined;
  readonly derived?: boolean;
  readonly method?: boolean;
  readonly classFieldInitializer?: boolean;
  readonly raw?: boolean;
  /** Hidden dynamic-body carrier receives [callee, newTarget, ...arguments]. */
  readonly packed?: boolean;
  readonly baseConstructor?: boolean;
  readonly inferredName?: Expression | undefined;
  readonly codeStrict?: boolean;
  readonly functionName?: Expression | undefined;
  readonly homeObject?: Expression | undefined;
}

interface PrivateMethodDefinition extends Span {
  readonly name: Expression;
  readonly static: boolean;
  readonly kind: "method" | "accessor";
  readonly value: Expression;
  get: Expression;
  set: Expression;
}

interface AssignmentReference extends Span {
  readonly invalid?: boolean;
  readonly local?: boolean;
  readonly fixedBinding?: number;
  readonly base: Expression;
  readonly property: Expression | undefined;
  /** Read-modify-write references keep a computed key in a mutable temporary.
   * Like ECMA-262 GetValue/PutValue, the first ToPropertyKey result replaces
   * it, so the key is converted once; reconverting a property key is
   * unobservable. */
  readonly retainedKey?: boolean;
  readonly superReceiver?: Expression;
  readonly privateName?: Expression;
}

/** Lower a parsed strict Script to the shared typed native pipeline. Unsupported
 * execution is explicit; no source assertion or harness code is rewritten away. */
export function lowerStrictScript(
  script: Module,
  sourceText?: string,
): ScriptLoweringResult {
  if (script.strict === false)
    return {
      ok: false,
      error: {
        start: script.start,
        end: script.end,
        code: "UNSUPPORTED",
        message: "strict lowering requires strict Script input",
      },
    };
  return lowerScript(script, sourceText);
}
/** Lower supported Script forms while preserving their parsed code modes. */
export function lowerScript(
  script: Module,
  sourceText?: string,
  options: ScriptLoweringOptions = {},
): ScriptLoweringResult {
  return lowerScriptEntry(
    script,
    sourceText,
    "script",
    0,
    undefined,
    options.runtimeCompiled === true,
    undefined,
    false,
    false,
    undefined,
    options.nativeScriptCalls === true,
    options.htmlDDAObjects !== false,
  );
}
/** Lower source-module bodies through the shared execution lowering. */
export function lowerSourceTextModule(
  module: Module,
  sourceText?: string,
  numericCalls?: readonly NumericCallSite[],
  checkContracts: boolean = false,
  checkMethodCalls: boolean = false,
  sourceTypes?: Module,
  nativeScriptCalls: boolean = false,
  htmlDDAObjects: boolean = true,
): ScriptLoweringResult {
  return lowerScriptEntry(
    module,
    sourceText,
    "module",
    0,
    undefined,
    false,
    numericCalls,
    checkContracts,
    checkMethodCalls,
    sourceTypes,
    nativeScriptCalls,
    htmlDDAObjects,
  );
}
/** Indirect eval uses fresh lexical storage and eval declaration admission. */
export function lowerEvalScript(
  script: Module,
  sourceText?: string,
): ScriptLoweringResult {
  return lowerScriptEntry(
    script,
    sourceText,
    "indirect-eval",
    0,
    undefined,
    true,
  );
}
/** Lower a CreateDynamicFunction body of any kind behind a hidden callable carrier. */
export function lowerDynamicFunctionImplementation(
  syntax: DynamicFunctionSyntax,
): ScriptLoweringResult {
  return lowerScriptEntry(
    syntax.module,
    syntax.parseText,
    "dynamic-function",
    0,
    undefined,
    true,
  );
}
/** Direct eval retains its caller's scopes, receiver and effective Script identity. */
export function lowerDirectEvalScript(
  script: Module,
  sourceText: string | undefined,
  flags: number,
  context: EvalBindingContext,
): ScriptLoweringResult {
  return lowerScriptEntry(
    script,
    sourceText,
    "direct-eval",
    flags,
    context,
    true,
  );
}
function lowerScriptEntry(
  script: Module,
  sourceText: string | undefined,
  entryKind:
    "script" | "indirect-eval" | "dynamic-function" | "direct-eval" | "module",
  directFlags: number = 0,
  directContext: EvalBindingContext | undefined = undefined,
  compactResults: boolean = false,
  numericCalls?: readonly NumericCallSite[],
  checkContracts: boolean = false,
  checkMethodCalls: boolean = false,
  sourceTypes?: Module,
  nativeScriptCalls: boolean = false,
  htmlDDAObjects: boolean = true,
): ScriptLoweringResult {
  const bound =
    entryKind === "module"
      ? bindJavaScriptModule(script)
      : directContext === undefined
        ? bindScript(script)
        : bindEvalScript(script, directContext);
  if (!bound.ok) {
    const diagnostic = bound.error;
    return {
      ok: false,
      error: {
        start: diagnostic.start,
        end: diagnostic.end,
        message: diagnostic.message,
        code:
          diagnostic.code === "LIMIT"
            ? "LIMIT"
            : diagnostic.code === "UNSUPPORTED"
              ? "UNSUPPORTED"
              : "EARLY_ERROR",
      },
    };
  }
  const moduleDeclarations =
    entryKind === "module" ? collectModuleDeclarations(script) : undefined;
  const declarations = moduleDeclarations ?? collectScriptDeclarations(script);
  const moduleShape =
    entryKind === "module" ? sourceModuleShape(script) : undefined;
  if (moduleShape !== undefined && !moduleShape.ok)
    return { ok: false, error: { ...moduleShape.error, code: "UNSUPPORTED" } };
  const directEvalOwners = bound.value.directEvalOwners ?? [];
  if (checkContracts && directEvalOwners.length !== 0) {
    const first = directEvalOwners[0];
    if (first === undefined) throw "DIRECT_EVAL_OWNER_INVARIANT";
    const site = first.owner ?? script;
    return {
      ok: false,
      error: {
        start: site.start,
        end: site.end,
        code: "UNSUPPORTED",
        message: directEvalUnavailable,
      },
    };
  }
  const bindingWrites = new Map<number, number>();
  const bindingContracts = new Map<number, number>();
  const bindingRecordContracts = new Map<number, TypeNode>();
  const recordTypes = new Map<string, TypeNode>();
  const boundBindings = bound.value.bindings;
  const containsWith = bound.value.containsWith;
  const dynamicBindings = directEvalOwners.length !== 0 || containsWith;
  // A closure created by eval can outlive each visible activation, even in
  // strict mode. A with lookup can fall through to every enclosing scope.
  // Retain their named cells and let unrelated scopes use native slots.
  const namedScopes = new Set<number>();
  for (const site of bound.value.dynamicNameScopes ?? []) {
    let scope: number | undefined = site;
    while (scope !== undefined && !namedScopes.has(scope)) {
      namedScopes.add(scope);
      scope = bound.value.scopes[scope]?.parent;
    }
  }
  // The binder's capture flag excludes Script scopes. Compare owners for
  // those references as well so a Script's loop can elide unobservable cells.
  const capturedBindings = new Set<number>();
  for (const reference of bound.value.references) {
    if (reference === undefined) throw "SCRIPT_REFERENCE_INVARIANT";
    const index = reference.binding;
    if (index === undefined) continue;
    const binding = boundBindings[index];
    if (
      binding !== undefined &&
      (binding.captured ||
        binding.owner !== bound.value.scopes[reference.scope]?.owner)
    )
      capturedBindings.add(index);
  }
  const copyLoopEnvironments = new Set<number>();
  const localBindingDeclarations = new Map<number, number>();
  const variableDeclarationBindings = new Map<number, number>();
  const functionVariables = new Map<number, number[]>();
  const selfBindings = new Map<Span, number>();
  const blockFunctions = new Map<Span, number>();
  for (const binding of boundBindings) {
    if (binding === undefined) throw "SCRIPT_BINDING_INVARIANT";
    const slotEligible = !namedScopes.has(binding.scope);
    if (
      slotEligible &&
      (binding.kind === "parameter" || binding.kind === "catch")
    ) {
      localBindingDeclarations.set(binding.node.start, binding.id);
      continue;
    }
    const bindingScope = bound.value.scopes[binding.scope];
    if (
      slotEligible &&
      binding.kind === "const" &&
      bindingScope?.kind === "block" &&
      bindingScope.node === binding.node
    ) {
      selfBindings.set(binding.node, binding.id);
      continue;
    }
    if (
      slotEligible &&
      binding.kind === "function" &&
      bindingScope?.kind === "block"
    ) {
      blockFunctions.set(binding.node, binding.id);
      continue;
    }
    if (
      slotEligible &&
      (binding.kind === "var" || binding.kind === "function") &&
      (bindingScope?.kind === "function" ||
        bindingScope?.kind === "function-body") &&
      binding.name !== "arguments"
    ) {
      const owner = binding.owner;
      const fn = owner === undefined ? undefined : bound.value.functions[owner];
      if (fn === undefined) throw "SCRIPT_VARIABLE_OWNER_INVARIANT";
      localBindingDeclarations.set(binding.node.start, binding.id);
      variableDeclarationBindings.set(binding.node.start, binding.id);
      let variables = functionVariables.get(fn.node.end);
      if (variables === undefined) {
        variables = [];
        functionVariables.set(fn.node.end, variables);
      }
      variables.push(binding.id);
      continue;
    }
    if (binding.kind !== "let" && binding.kind !== "const") continue;
    if (
      binding.kind === "let" &&
      bindingScope?.kind === "for" &&
      (capturedBindings.has(binding.id) || namedScopes.has(binding.scope))
    )
      copyLoopEnvironments.add(bindingScope.node.start);
    if (
      slotEligible &&
      (bindingScope?.kind === "for" ||
        bindingScope?.kind === "function" ||
        bindingScope?.kind === "function-body" ||
        bindingScope?.kind === "block")
    )
      localBindingDeclarations.set(binding.node.start, binding.id);
  }
  for (const alias of bound.value.aliases ?? []) {
    if (alias === undefined) throw "SCRIPT_BINDING_ALIAS_INVARIANT";
    const binding = boundBindings[alias.binding];
    if (
      binding !== undefined &&
      variableDeclarationBindings.get(binding.node.start) === binding.id
    )
      variableDeclarationBindings.set(alias.node.start, binding.id);
  }
  for (const target of bound.value.varInitializerTargets ?? []) {
    if (target === undefined) throw "SCRIPT_BINDING_ALIAS_INVARIANT";
    variableDeclarationBindings.set(target.node.start, target.binding);
  }
  const localBindingReferences = new Map<number, number>();
  const writtenSlots = new Set<number>();
  for (const target of bound.value.varInitializerTargets ?? []) {
    if (target === undefined) throw "SCRIPT_BINDING_ALIAS_INVARIANT";
    writtenSlots.add(target.binding);
  }
  if (
    localBindingDeclarations.size !== 0 ||
    selfBindings.size !== 0 ||
    blockFunctions.size !== 0
  )
    for (const reference of bound.value.references) {
      if (reference === undefined) throw "SCRIPT_REFERENCE_INVARIANT";
      const binding = reference.binding;
      if (binding === undefined) continue;
      const target = boundBindings[binding];
      if (
        target !== undefined &&
        (localBindingDeclarations.get(target.node.start) === binding ||
          selfBindings.get(target.node) === binding ||
          blockFunctions.get(target.node) === binding)
      ) {
        localBindingReferences.set(reference.node.start, binding);
        if (reference.access !== "read") writtenSlots.add(binding);
      }
    }
  const fixedCellIndices = new Map<number, number>();
  const fixedCellReferences = new Map<number, number>();
  const fixedCellNames: string[] = [];
  const staticScriptLexicals =
    (entryKind === "script" || entryKind === "indirect-eval") &&
    !dynamicBindings;
  if (entryKind === "module" || staticScriptLexicals)
    for (const reference of bound.value.references) {
      if (reference === undefined) throw "SCRIPT_REFERENCE_INVARIANT";
      const binding = reference.binding;
      if (binding === undefined) continue;
      const target = boundBindings[binding];
      if (target === undefined) continue;
      const kind = bound.value.scopes[target.scope]?.kind;
      if (
        kind !== "module" &&
        !(
          kind === "script" &&
          (target.kind === "let" || target.kind === "const")
        )
      )
        continue;
      fixedCellReferences.set(reference.node.start, binding);
      if (!fixedCellIndices.has(binding)) {
        fixedCellIndices.set(binding, fixedCellNames.length);
        fixedCellNames.push(target.name);
      }
    }
  const localSlots = new Map<number, Expression>();
  const frameLexicals = new Set<number>();
  const sloppySelfBindings = new Set<number>();
  const slotInitialization = new Map<number, Expression>();
  const numericLeaves = new Map<number, NumericLeaf>();
  if (checkContracts) {
    for (const declaration of sourceTypes?.statements ?? []) {
      if (declaration === undefined) throw "SOURCE_TYPE_DECLARATION_INVARIANT";
      if (declaration.kind === "type-alias") {
        if (typeParameterCount(declaration.typeParameters) !== 0) continue;
        recordTypes.set(declaration.name, declaration.type);
      } else if (declaration.kind === "interface") {
        const bases = declaration.bases;
        if (
          typeParameterCount(declaration.typeParameters) !== 0 ||
          (bases !== undefined && bases.length !== 0) ||
          declaration.call !== undefined ||
          declaration.construct !== undefined
        )
          continue;
        const index = declaration.indexSignature;
        const annotated: TypeNode = {
          kind: "object",
          properties: declaration.properties,
          start: declaration.start,
          end: declaration.end,
          ...(index === undefined ? {} : { indexSignature: index }),
        };
        recordTypes.set(declaration.name, annotated);
      }
    }
    rewriteModule(script, {
      statement: (node, _original) => {
        if (node.kind === "variable")
          for (const declaration of node.declarations) {
            if (declaration === undefined) throw "SCRIPT_DECLARATION_INVARIANT";
            if (
              declaration.kind === "object-binding" ||
              declaration.kind === "array-binding"
            )
              continue;
            const type = declaration.type;
            if (type === undefined) continue;
            const mask = contract(type);
            if (mask !== 0) bindingContracts.set(declaration.start, mask);
            else if (recordType(type) !== undefined)
              bindingRecordContracts.set(declaration.start, type);
          }
        return node;
      },
    });
    function writtenBinding(binding: number, site: Span): void {
      const target = boundBindings[binding];
      if (
        target !== undefined &&
        (target.kind === "parameter" ||
          bindingContracts.has(target.node.start) ||
          bindingRecordContracts.has(target.node.start))
      )
        bindingWrites.set(site.start, target.node.start);
    }
    for (const reference of bound.value.references) {
      if (reference.access === "read" || reference.binding === undefined)
        continue;
      writtenBinding(reference.binding, reference.node);
    }
    for (const alias of bound.value.aliases ?? []) {
      if (alias === undefined) throw "BINDING_ALIAS_INVARIANT";
      writtenBinding(alias.binding, alias.node);
    }
  }
  const argumentsOwners = bound.value.argumentsOwners;
  // Global references use a per-site cache. Closures share the table, which
  // keeps their capture layouts independent of the number of identifier sites.
  const globalIdentifierSites = new Set<string>();
  for (const reference of bound.value.references) {
    if (reference === undefined) throw "GLOBAL_REFERENCE_INVARIANT";
    const node = reference.node;
    // The binder tracks implicit arguments separately from named declarations.
    if (node.kind === "identifier" && node.name === "arguments") continue;
    const binding =
      reference.binding === undefined
        ? undefined
        : boundBindings[reference.binding];
    const reachesGlobal =
      binding === undefined ||
      (bound.value.scopes[binding.scope]?.kind === "script" &&
        (binding.kind === "var" || binding.kind === "function"));
    if (reachesGlobal)
      globalIdentifierSites.add(
        String(reference.node.start) + ":" + String(reference.node.end),
      );
  }
  const globalIdentifierCaches = new Map<string, number>();
  const globalCacheInitializers: Expression[] = [];
  const propertyCacheInitializers: Expression[] = [];
  // Fixed record fields work in AOT and managed entries. Each closure
  // captures the groups it uses, and one large host harness cannot exceed a
  // native record's field limit.
  const slotGroupWidth = 24;
  function slotGroupName(prefix: string, index: number): string {
    return prefix + Math.floor(index / slotGroupWidth);
  }
  function slotFieldName(index: number): string {
    return "cell" + (index % slotGroupWidth);
  }
  function slotField(prefix: string, index: number, span: Span): Expression {
    return member(
      id(slotGroupName(prefix, index), span),
      slotFieldName(index),
      span,
    );
  }
  function slotTable(
    prefix: string,
    values: readonly Expression[],
    type: TypeNode | undefined = undefined,
  ): Statement[] {
    const result: Statement[] = [];
    for (let start = 0; start < values.length; start += slotGroupWidth) {
      const entries = values.slice(start, start + slotGroupWidth);
      const names = entries.map((_entry, i) => slotFieldName(i));
      let layout: TypeNode | undefined = undefined;
      if (type !== undefined) {
        const fieldType: TypeNode = type;
        const properties: PropertySignature[] = [];
        for (const name of names) {
          if (name === undefined) throw "SCRIPT_SLOT_FIELD_INVARIANT";
          properties.push({
            ...generated,
            name,
            readonly: false,
            type: fieldType,
          });
        }
        layout = { ...generated, kind: "object", properties };
      }
      result.push({
        ...generated,
        kind: "variable",
        mode: "const",
        exported: false,
        declarations: [
          {
            ...generated,
            name: slotGroupName(prefix, start),
            type: layout,
            initializer: object(names, entries, generated),
          },
        ],
      });
    }
    return result;
  }
  function globalCacheDeclarations(): Statement[] {
    const tables = slotTable("$gc", globalCacheInitializers);
    appendStatements(tables, slotTable("$pc", propertyCacheInitializers));
    return tables;
  }
  function propertyCache(name: string, span: Span): Expression {
    const index = propertyCacheInitializers.length;
    propertyCacheInitializers.push(
      runtimeCall("createScriptPropertyCache", [text(name)], generated),
    );
    return slotField("$pc", index, span);
  }
  function withGlobalIdentifierCache(
    args: readonly Expression[],
    span: Span,
  ): readonly Expression[] {
    const key = String(span.start) + ":" + String(span.end);
    if (!globalIdentifierSites.has(key)) return args;
    let index = globalIdentifierCaches.get(key);
    if (index === undefined) {
      index = globalCacheInitializers.length;
      globalIdentifierCaches.set(key, index);
      globalCacheInitializers.push(
        call("createGlobalIdentifierCache", [], generated),
      );
    }
    const extended = args.slice();
    if (
      (entryKind === "script" || entryKind === "indirect-eval") &&
      !dynamicBindings
    )
      extended[0] = id("$scope");
    extended.push(slotField("$gc", index, span));
    return extended;
  }
  /** Direct eval code may run inside a caller's `with` body. Elsewhere, an
   * identifier callee without any `with` in its unit has an undefined this. */
  const identifierCalleesUnbased =
    entryKind !== "direct-eval" && !bound.value.containsWith;
  /** FunctionDeclarationInstantiation's arguments object is unobservable when
   * the binder found no `arguments` reference or direct eval for this function.
   * Lowering spans of generator/async methods start after modifiers such as
   * `static` (retained source text), so only the closing offset is compared:
   * distinct ordinary functions never share one (only arrows can, and arrows
   * never own an arguments object), and any coincidence only adds an object. */
  /** Functions whose own receiver is read: `this` or `super` in the function
   * or a nested arrow, found by the binder. Compared by closing offset like
   * observesArguments; a coincidence only keeps the receiver conversion. */
  const receiverObservers = new Set<number>();
  for (const reference of bound.value.receiverReferences) {
    if (reference === undefined) throw "RECEIVER_REFERENCE_INVARIANT";
    const owner = reference.owner;
    if (owner === undefined) continue;
    const fn = bound.value.functions[owner];
    if (fn === undefined) throw "RECEIVER_OWNER_INVARIANT";
    receiverObservers.add(fn.node.end);
  }
  // A direct eval can read `this`, and inside an arrow (or an arrow's
  // parameters) that is the enclosing function's receiver: the eval site's
  // owner is the arrow, so mark the function that owns its receiver.
  for (const site of directEvalOwners) {
    if (site === undefined) throw "DIRECT_EVAL_OWNER_INVARIANT";
    const owner = site.owner;
    if (owner === undefined) continue;
    for (const fn of bound.value.functions) {
      if (fn === undefined) throw "RECEIVER_OWNER_INVARIANT";
      if (fn.node.start !== owner.start || fn.node.end !== owner.end) continue;
      const receiverOwner = fn.receiver;
      if (receiverOwner === undefined) continue;
      const receiverFunction = bound.value.functions[receiverOwner];
      if (receiverFunction === undefined) throw "RECEIVER_OWNER_INVARIANT";
      receiverObservers.add(receiverFunction.node.end);
    }
  }
  function observesArguments(span: Span): boolean {
    for (const owner of argumentsOwners) {
      if (owner === undefined) throw "ARGUMENTS_OWNER_INVARIANT";
      if (owner.end === span.end) return true;
    }
    return false;
  }
  const moduleInstantiation: Statement[] = [],
    moduleFunctions: Expression[] = [],
    moduleFunctionNames: string[] = [];
  const statements: Statement[] = [];
  function appendStatements(
    target: Statement[],
    additions: readonly Statement[],
  ): void {
    for (const statement of additions) {
      if (statement === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
      target.push(statement);
    }
  }
  const generated: Span = { start: script.start, end: script.start };
  let serial = 0;
  // Names of const temporaries, and those declared `unknown` (general).
  const immutableTemporaries: Set<string> = new Set<string>(),
    generalTemporaries: Set<string> = new Set<string>();
  let usesAutoAccessors = false;
  let usesDecorators = false;
  // Set when a catch boundary emits rejectEngineAbort.
  let usesEngineAborts = false;
  const abort = {};
  let error: ScriptLoweringError | undefined;
  let scope: Expression = id("$scope");
  let variableScope: Expression =
    entryKind === "indirect-eval" && script.strict === false
      ? call("createGlobalScope", [id("$global")], generated)
      : entryKind === "direct-eval" && script.strict === false
        ? member(id("$site"), "variables")
        : id("$scope");
  let inFunction =
    entryKind === "direct-eval" && (directFlags & directEvalInFunction) !== 0;
  let catchRecords: Expression[] = [];
  let inheritedCatches: Expression =
    entryKind === "direct-eval"
      ? member(id("$site"), "catches")
      : id("undefined");
  let lexical: Expression =
    entryKind === "module"
      ? id("$environment")
      : entryKind === "indirect-eval" || entryKind === "direct-eval"
        ? id("$evalLexical")
        : member(id("$global"), "lexical");
  let receiver: Expression =
    entryKind === "module"
      ? id("undefined")
      : entryKind === "direct-eval"
        ? member(id("$site"), "thisValue")
        : member(id("$global"), "thisValue");
  const scriptStrict = entryKind === "module" || script.strict !== false;
  let strict: boolean = scriptStrict;
  let home: Expression | undefined =
    entryKind === "direct-eval" && (directFlags & directEvalInMethod) !== 0
      ? id("$home")
      : undefined;
  let derivedContext: Expression | undefined =
    entryKind === "direct-eval" &&
    (directFlags & directEvalInDerivedConstructor) !== 0
      ? id("$derived")
      : undefined;
  let activeConstructor: Expression | undefined =
    derivedContext === undefined ? undefined : id("$activeFunction");
  let inClassFieldInitializer =
    entryKind === "direct-eval" &&
    (directFlags & directEvalInClassFieldInitializer) !== 0;
  let newTarget: Expression =
    entryKind === "direct-eval"
      ? member(id("$site"), "newTarget")
      : id("undefined");
  const privateScopes: { names: Map<string, Expression> }[] = [];
  const privateInherited =
    entryKind === "direct-eval" &&
    (directFlags & directEvalInPrivateEnvironment) !== 0;
  const inheritedPrivate: Expression = privateInherited
    ? id("$privateEnvironment")
    : id("undefined");
  const externalPrivate = new Map<string, Expression>();
  const templateSites: Statement[] = [];
  let functionDepth = 0;
  let tailEnds: ReadonlyMap<number, number> = new Map<number, number>();
  let usesTailCalls = false;
  let usesRegisterCalls = false;
  let usesWideRegisterCalls = false;
  let usesNativeScriptCalls = false;
  let usesIndexedWrites = false;
  let usesNullishEquality = false;
  let excludesHTMLDDAObjects = false;
  let usesRelationalFallback = false;
  let usesLooseEqualityFallback = false;
  let usesPrimitiveContracts = false;
  let suspensionInput: string | undefined =
    entryKind === "module" ? "$moduleInput" : undefined;
  let moduleSuspends = false;
  let moduleContinuation: BlockStatement | undefined;
  let asyncGeneratorBody = false;
  let yieldContract = 0;
  let disposalScope: Expression | undefined;
  let usesDirectEval = false;
  let usesImportCall = false;
  let usesImportMeta = false;
  let usesDisposal = false;
  let usesAsyncDisposal = false;
  const annexCopies = bound.value.annexFunctionCopies ?? [];
  const annexAdmissions = new Map<string, Expression>();
  let annexVariableRecord: Expression | undefined;
  function at(node: Span): Span {
    return { start: node.start, end: node.end };
  }
  function finishOutput(
    moduleOutput: Module,
    goal: string,
  ): ScriptLoweringResult {
    try {
      // Generated references often share spans. Fresh per-occurrence hashes keep
      // identity-based binding and import-renaming indexes from clustering them.
      return { ok: true, value: rewriteModule(moduleOutput, { hashes: true }) };
    } catch (caught) {
      if (caught !== "syntax rewrite nesting limit exceeded") throw caught;
      return {
        ok: false,
        error: {
          ...at(script),
          code: "LIMIT",
          message:
            "generated " + goal + " syntax exceeds the supported nesting limit",
        },
      };
    }
  }
  function fail(node: Span, message: string): never {
    error = { start: node.start, end: node.end, code: "UNSUPPORTED", message };
    throw abort;
  }
  function id(name: string, span: Span = generated): Expression {
    return { ...at(span), kind: "identifier", name };
  }
  function scriptIdentity(): Expression {
    if (entryKind === "module") {
      // Module callbacks and source functions already run under their defining
      // context. Capture it after argument evaluation, as for the existing site.
      const context = temporary(
        member(member(id("$errors"), "agent"), "activeContext"),
      );
      statements.push({
        ...generated,
        kind: "if",
        test: {
          ...generated,
          kind: "binary",
          operator: "===",
          left: context,
          right: id("undefined"),
        },
        consequent: {
          ...generated,
          kind: "throw",
          expression: call(
            "rejectUnsupportedExecution",
            [id("$errors")],
            generated,
          ),
        },
        alternate: undefined,
      });
      return member(context, "scriptOrModule");
    }
    return entryKind === "script"
      ? id("$script")
      : entryKind === "direct-eval"
        ? member(id("$site"), "scriptOrModule")
        : member(id("$script"), "hostDefined");
  }
  function text(value: string, span: Span = generated): Expression {
    return { ...at(span), kind: "string", value };
  }
  function named(name: string): TypeNode {
    return { ...generated, kind: "named", name };
  }
  function instantiation(name: string): readonly TypeNode[] {
    return scriptRuntimeTypeArguments(name).map((argument) => named(argument));
  }
  function member(
    object: Expression,
    property: string,
    span: Span = generated,
  ): Expression {
    return { ...at(span), kind: "member", object, property };
  }
  function optionalMember(
    object: Expression,
    property: string,
    span: Span,
  ): Expression {
    return { ...at(span), kind: "member", object, property, optional: true };
  }
  function call(
    name: string,
    args: readonly Expression[],
    span: Span,
  ): Expression {
    return {
      ...at(span),
      kind: "call",
      callee: id(name, span),
      arguments: args,
      typeArguments: instantiation(name),
    };
  }
  function object(
    names: readonly string[],
    values: readonly Expression[],
    span: Span,
  ): Expression {
    return {
      ...at(span),
      kind: "object",
      properties: names.map((name, i) => {
        const value = values[i];
        if (value === undefined) throw "SCRIPT_PROPERTY_INVARIANT";
        return { ...at(span), name, value, shorthand: false };
      }),
    };
  }
  function objectRuntime(
    name: string,
    args: readonly Expression[],
    span: Span,
  ): Expression {
    const arguments_ = args.slice();
    arguments_.push(
      name === "looselyEqual" ||
        name === "objectValueHasProperty" ||
        name === "instanceOfValue"
        ? id("$errors")
        : member(id("$global"), "object", span),
    );
    return runtimeCall(name, arguments_, span);
  }
  function runtimeCall(
    name: string,
    args: readonly Expression[],
    span: Span,
  ): Expression {
    return {
      ...at(span),
      kind: "call",
      callee: id(name, span),
      arguments: args,
      typeArguments: instantiation(name),
    };
  }
  function numericCallAt(span: Span): NumericCallSite | undefined {
    if (numericCalls === undefined) return undefined;
    for (const site of numericCalls)
      if (
        site !== undefined &&
        site.start === span.start &&
        site.end === span.end
      )
        return site;
    return undefined;
  }
  function expression(value: Expression): void {
    statements.push({ ...at(value), kind: "expression", expression: value });
  }
  function temporary(
    value: Expression,
    general: boolean = false,
    mutable: boolean = false,
    annotation: TypeNode | undefined = undefined,
    capture: "reference" | "value" | undefined = undefined,
  ): Expression {
    if (compactResults && !mutable && annotation === undefined) {
      // Runtime-compiled entries never name a scalar literal or a copy of an
      // immutable temporary: each named temporary is a frame slot, which
      // made large entries' frames and code grow with every operation.
      // String literals stay named: shared entries abstract exactly those
      // constants into per-parse literal tables (abstractScriptLiterals).
      if (
        value.kind === "number" ||
        value.kind === "boolean" ||
        value.kind === "null" ||
        (value.kind === "identifier" &&
          (value.name === "undefined" ||
            (immutableTemporaries.has(value.name) &&
              (!general || generalTemporaries.has(value.name)))))
      )
        return value;
    }
    const name = "$value" + serial++;
    if (!mutable) {
      immutableTemporaries.add(name);
      if (general) generalTemporaries.add(name);
    }
    statements.push({
      ...at(value),
      kind: "variable",
      mode: mutable ? "let" : "const",
      exported: false,
      declarations: [
        {
          ...at(value),
          name,
          type: general ? named("unknown") : annotation,
          initializer: value,
          ...(capture === undefined ? {} : { capture }),
        },
      ],
    });
    return id(name, value);
  }
  function resetCompletion(
    span: Span,
    result: Expression = id("undefined"),
  ): void {
    expression({
      ...at(span),
      kind: "assignment",
      target: id("$completion"),
      value: result,
    });
  }
  function check(error: Expression, span: Span): void {
    if (compactResults) {
      // One out-of-line call: inlining both string checks at every result
      // multiplies native entry size (see throwIfRuntimeError).
      expression({
        ...at(span),
        kind: "call",
        callee: id("throwIfRuntimeError", span),
        arguments: [id("$errors"), error],
        typeArguments: [],
      });
      return;
    }
    statements.push({
      ...at(span),
      kind: "if",
      test: {
        ...at(span),
        kind: "binary",
        operator: "===",
        left: error,
        right: text("unsupported", span),
      },
      consequent: {
        ...at(span),
        kind: "expression",
        expression: {
          ...at(span),
          kind: "call",
          callee: id("rejectUnsupportedExecution"),
          arguments: [id("$errors")],
          typeArguments: [],
        },
      },
      alternate: undefined,
    });
    statements.push({
      ...at(span),
      kind: "if",
      test: {
        ...at(span),
        kind: "binary",
        operator: "!==",
        left: error,
        right: text("none", span),
      },
      consequent: {
        ...at(span),
        kind: "throw",
        expression: {
          ...at(span),
          kind: "call",
          callee: id("createRuntimeError", span),
          arguments: [id("$errors"), error],
          typeArguments: [],
        },
      },
      alternate: undefined,
    });
  }
  // Capture every emitted operand effect, including reference-error returns,
  // inside the selected arm. Nested branches use the same statement builder.
  function branchValue(
    target: Expression,
    operand: Expression,
    inferredName: Expression | undefined = undefined,
  ): BlockStatement {
    const start = statements.length;
    const evaluated = value(operand, inferredName);
    expression({
      ...at(operand),
      kind: "assignment",
      target,
      value: evaluated,
    });
    return {
      ...at(operand),
      kind: "block",
      statements: statements.splice(start),
    };
  }
  function reference(name: string, span: Span): Expression {
    return temporary(
      call(
        "resolveBinding",
        withGlobalIdentifierCache(
          [
            scope,
            text(name, span),
            { ...at(span), kind: "boolean", value: strict },
          ],
          span,
        ),
        span,
      ),
    );
  }
  function write(target: Expression, value: Expression, span: Span): void {
    if (hasBindingContract(span)) {
      const assigned = temporary(value, true);
      // PutValue checks the binding's initialization after evaluating the RHS.
      expression(read(target, span));
      value = bindingWriteValue(assigned, span);
    }
    checkedRuntimeCompletion("putBindingReference", [target, value], span);
  }
  function hasBindingContract(span: Span): boolean {
    const declaration = bindingWrites.get(span.start) ?? span.start;
    return (
      bindingContracts.has(declaration) ||
      bindingRecordContracts.has(declaration)
    );
  }
  function bindingWriteValue(assigned: Expression, span: Span): Expression {
    const declaration = bindingWrites.get(span.start) ?? span.start;
    const mask = bindingContracts.get(declaration);
    return mask === undefined
      ? (recordContract(
          assigned,
          bindingRecordContracts.get(declaration),
          span,
        ) ?? assigned)
      : checkedContract(assigned, mask, span);
  }
  function read(
    target: Expression,
    span: Span,
    forTypeof: boolean = false,
  ): Expression {
    if (!forTypeof)
      return checkedRuntimeValue("getBindingReference", [target], span);
    const result = temporary(
      call(
        forTypeof ? "getBindingReferenceForTypeof" : "getBindingReference",
        [target],
        span,
      ),
    );
    check(member(result, "error", span), span);
    return member(result, "value", span);
  }
  /** An identifier read whose reference is not needed afterwards. Resolution
   * and GetValue are adjacent, so every entry fuses them into one call, which
   * reads declarative bindings without allocating a reference or result. */
  function identifierValue(
    name: string,
    span: Span,
    forTypeof: boolean = false,
  ): Expression {
    const local = localSlot(span);
    if (local !== undefined) {
      checkSlotInitialized(span);
      return temporary({ ...local, ...at(span) }, true);
    }
    const fixedBinding = fixedCellReferences.get(span.start);
    if (fixedBinding !== undefined) {
      const cell = fixedCell(fixedBinding, span);
      checkBindingInitialized(member(cell, "initialized", span), span);
      return temporary(member(cell, "value", span), true);
    }
    const args = withGlobalIdentifierCache(
      [
        scope,
        text(name, span),
        { ...at(span), kind: "boolean", value: strict },
        id("$errors"),
        { ...at(span), kind: "boolean", value: forTypeof },
      ],
      span,
    );
    const lookup = call("getIdentifierValue", args, span);
    const start = args[0],
      cache = args[5];
    // Runtime-compiled entries keep one fused lookup per site.
    if (start === undefined || cache === undefined || compactResults)
      return temporary(lookup);
    // A warm cached global binding reads its cell inline.
    const cell = temporary(
      call("cachedGlobalIdentifierCell", [start, cache], span),
    );
    return temporary(
      scalarBranch(
        scalarBinary("!==", cell, id("undefined", span), span),
        member(cell, "value", span),
        lookup,
        span,
      ),
      true,
    );
  }
  function localSlot(
    span: Span,
    forWrite: boolean = false,
  ): Expression | undefined {
    const binding = localBindingReferences.get(span.start);
    const kind =
      binding === undefined ? undefined : boundBindings[binding]?.kind;
    if (
      binding === undefined ||
      (forWrite &&
        kind !== "let" &&
        kind !== "parameter" &&
        kind !== "var" &&
        kind !== "function" &&
        !frameLexicals.has(binding))
    )
      return undefined;
    return localSlots.get(binding);
  }
  function checkSlotInitialized(span: Span): void {
    const binding = localBindingReferences.get(span.start);
    if (binding === undefined) return;
    const initialized = slotInitialization.get(binding);
    if (initialized === undefined) return;
    checkBindingInitialized(initialized, span);
  }
  function fixedCellTable(): Statement[] {
    const type: TypeNode = {
      ...generated,
      kind: "union",
      members: [
        {
          ...generated,
          kind: "named",
          name: "Binding",
          arguments: instantiation("Binding"),
        },
        named("undefined"),
      ],
    };
    return slotTable(
      "$fixedCells",
      fixedCellNames.map(() => id("undefined")),
      type,
    );
  }
  // Copy cell identities after declaration instantiation, including aliases
  // established by module linking. The values and TDZ remain live.
  function loadFixedCells(environment: Expression): Statement[] {
    const initializeCells: Statement[] = [];
    for (let index = 0; index < fixedCellNames.length; index++) {
      const name = fixedCellNames[index];
      if (name === undefined) throw "FIXED_BINDING_CELL_INVARIANT";
      const variable = "$cell" + serial++;
      const cell = id(variable);
      initializeCells.push({
        ...generated,
        kind: "variable",
        mode: "const",
        exported: false,
        declarations: [
          {
            ...generated,
            name: variable,
            type: undefined,
            initializer: call(
              "findBinding",
              [environment, text(name)],
              generated,
            ),
          },
        ],
      });
      initializeCells.push(requireFixedCell(cell, generated));
      initializeCells.push({
        ...generated,
        kind: "expression",
        expression: {
          ...generated,
          kind: "assignment",
          target: slotField("$fixedCells", index, generated),
          value: cell,
        },
      });
    }
    return initializeCells;
  }
  function fixedCell(binding: number, span: Span): Expression {
    const index = fixedCellIndices.get(binding);
    if (index === undefined) throw "FIXED_BINDING_CELL_INVARIANT";
    const cell = temporary(slotField("$fixedCells", index, span));
    statements.push(requireFixedCell(cell, span));
    return cell;
  }
  function requireFixedCell(cell: Expression, span: Span): Statement {
    return {
      ...at(span),
      kind: "if",
      test: {
        ...at(span),
        kind: "binary",
        operator: "===",
        left: cell,
        right: id("undefined", span),
      },
      consequent: {
        ...at(span),
        kind: "throw",
        expression: text("FIXED_BINDING_CELL_INVARIANT", span),
      },
      alternate: undefined,
    };
  }
  function checkBindingInitialized(initialized: Expression, span: Span): void {
    statements.push({
      ...at(span),
      kind: "if",
      test: { ...at(span), kind: "unary", operator: "!", operand: initialized },
      consequent: {
        ...at(span),
        kind: "throw",
        expression: call(
          "createRuntimeError",
          [id("$errors"), text("reference", span)],
          span,
        ),
      },
      alternate: undefined,
    });
  }
  function storeSlot(target: Expression, value: Expression, span: Span): void {
    expression({ ...at(span), kind: "assignment", target, value });
  }
  function reserveLexicalSlots(children: readonly Statement[]): number[] {
    const lexicalSlots: number[] = [];
    for (const child of children) {
      if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
      const fn = statementFunctionDeclaration(child);
      const blockBinding =
        fn === undefined ? undefined : blockFunctions.get(fn);
      if (blockBinding !== undefined) {
        lexicalSlots.push(blockBinding);
        reserveLexicalSlot(blockBinding, child, false);
        continue;
      }
      if (child.kind === "class") {
        const binding = localBindingDeclarations.get(child.start);
        if (binding !== undefined) {
          lexicalSlots.push(binding);
          reserveLexicalSlot(binding, child, true);
        }
        continue;
      }
      if (
        child.kind !== "variable" ||
        child.mode === "var" ||
        child.disposal !== undefined
      )
        continue;
      for (const declaration of child.declarations) {
        if (declaration === undefined) throw "SCRIPT_DECLARATION_INVARIANT";
        reservePatternSlots(declaration, lexicalSlots);
      }
    }
    return lexicalSlots;
  }
  function reservePatternSlots(
    declaration: VariableBinding,
    slots: number[],
  ): void {
    if (declaration.type !== undefined) return;
    for (const identifier of bindingIdentifiers(declaration)) {
      if (identifier === undefined) throw "SCRIPT_BINDING_INVARIANT";
      if (hasBindingContract(identifier)) continue;
      const binding = localBindingDeclarations.get(identifier.start);
      if (binding === undefined) continue;
      slots.push(binding);
      reserveLexicalSlot(binding, identifier, true);
    }
  }
  function reserveLexicalSlot(
    binding: number,
    span: Span,
    hasTDZ: boolean,
  ): Expression {
    const slot = temporary(id("undefined", span), true, true);
    frameLexicals.add(binding);
    localSlots.set(binding, slot);
    if (hasTDZ)
      slotInitialization.set(
        binding,
        temporary(
          { ...at(span), kind: "boolean", value: false },
          false,
          true,
          undefined,
          "reference",
        ),
      );
    return slot;
  }
  function frameLexicalBinding(span: Span): number | undefined {
    const binding = localBindingDeclarations.get(span.start);
    return binding !== undefined && frameLexicals.has(binding)
      ? binding
      : undefined;
  }
  function initializeLexicalSlot(value: Expression, span: Span): boolean {
    const binding = frameLexicalBinding(span);
    if (binding === undefined) return false;
    initializeKnownLexical(binding, value, span);
    return true;
  }
  function initializeKnownLexical(
    binding: number,
    value: Expression,
    span: Span,
  ): void {
    const target = localSlots.get(binding);
    if (target === undefined) throw "SCRIPT_LEXICAL_SLOT_INVARIANT";
    const initialized = slotInitialization.get(binding);
    storeSlot(target, value, span);
    if (initialized !== undefined)
      storeSlot(
        initialized,
        { ...at(span), kind: "boolean", value: true },
        span,
      );
  }
  /** The original scope handles TDZ and declaration initialization. Only
   * initialized bindings invisible to closures and dynamic lookup get slots. */
  function localizeInitialized(node: Statement, initialized: number[]): void {
    if (node.kind === "class") {
      const binding = frameLexicalBinding(node);
      if (binding !== undefined) finalizeLexicalSlot(binding);
      return;
    }
    if (
      node.kind !== "variable" ||
      node.mode === "var" ||
      node.disposal !== undefined
    )
      return;
    for (const declaration of node.declarations) {
      if (declaration === undefined) throw "SCRIPT_BINDING_INVARIANT";
      if (
        declaration.kind === "object-binding" ||
        declaration.kind === "array-binding"
      ) {
        for (const identifier of bindingIdentifiers(declaration)) {
          if (identifier === undefined) throw "SCRIPT_BINDING_INVARIANT";
          const binding = frameLexicalBinding(identifier);
          if (binding !== undefined) finalizeLexicalSlot(binding);
        }
        continue;
      }
      if (hasBindingContract(declaration)) continue;
      const binding = localBindingDeclarations.get(declaration.start);
      if (binding === undefined) continue;
      const frameSlot = localSlots.get(binding);
      let slot: Expression;
      if (frameSlot === undefined) {
        const initial = temporary(
          call(
            "getBindingValue",
            [lexical, text(declaration.name, declaration)],
            declaration,
          ),
        );
        check(member(initial, "error", declaration), declaration);
        slot = temporary(
          member(initial, "value", declaration),
          true,
          node.mode === "let",
        );
        initialized.push(binding);
      } else slot = finalizeLexicalSlot(binding);
      localSlots.set(binding, slot);
      const implementation = numericLeaf(declaration.initializer);
      if (implementation !== undefined) {
        const mutable = node.mode === "let";
        numericLeaves.set(binding, {
          witness: mutable ? temporary(slot, true) : slot,
          implementation: temporary(implementation),
          arity: implementation.parameters.length,
          mutable,
        });
      }
    }
  }
  function finalizeLexicalSlot(binding: number): Expression {
    const current = localSlots.get(binding);
    if (current === undefined) throw "SCRIPT_LEXICAL_SLOT_INVARIANT";
    // Earlier closures retain their checked cell. Later closures can copy
    // an initialized value when no source write can change it.
    const finalized = writtenSlots.has(binding)
      ? current
      : temporary(current, true, false, undefined, "value");
    localSlots.set(binding, finalized);
    slotInitialization.delete(binding);
    return finalized;
  }
  function releaseLocalSlots(initialized: readonly number[]): void {
    for (const binding of initialized) {
      if (binding === undefined) throw "SCRIPT_BINDING_INVARIANT";
      localSlots.delete(binding);
      frameLexicals.delete(binding);
      slotInitialization.delete(binding);
      numericLeaves.delete(binding);
    }
  }
  function numericLeaf(
    initializer: Expression | undefined,
    outer: ReadonlyMap<string, NumericBinding> | undefined = undefined,
  ): (Expression & { readonly kind: "arrow" }) | undefined {
    if (initializer === undefined) return undefined;
    let node = initializer;
    while (node.kind === "group") node = node.expression;
    if (node.kind !== "arrow" && node.kind !== "function-expression")
      return undefined;
    if (
      node.async ||
      node.returnType !== undefined ||
      typeParameterCount(node.typeParameters) !== 0 ||
      (node.kind === "function-expression" &&
        (node.generator ||
          node.receiver !== undefined ||
          node.name !== undefined))
    )
      return undefined;
    let returned: Expression | undefined;
    const body = node.body;
    if (body.kind !== "block") returned = body;
    else if (body.statements.length === 1) {
      const statement = body.statements[0];
      if (statement?.kind === "return") returned = statement.expression;
    }
    const result = returned;
    if (result === undefined) return undefined;
    const bindings = new Map<string, NumericBinding>();
    const parameters = numericParameters(node.parameters, bindings);
    if (parameters === undefined) return undefined;
    if (outer !== undefined)
      for (const [name, binding] of outer)
        if (
          !bindings.has(name) &&
          (node.kind === "arrow" || name !== "arguments")
        )
          bindings.set(name, binding);
    if (
      !numericLeafExpression(result, bindings) ||
      collectTailCalls(body, { strict: true }).size !== 0
    )
      return undefined;
    return {
      ...at(node),
      kind: "arrow",
      parameters,
      returnType: named("number"),
      body: result,
    };
  }
  function numericParameters(
    source: readonly Parameter[],
    bindings: Map<string, NumericBinding>,
  ): Parameter[] | undefined {
    const parameters: Parameter[] = [];
    for (const parameter of source) {
      if (
        parameter === undefined ||
        parameter.kind === "pattern-parameter" ||
        parameter.type !== undefined ||
        parameter.optional ||
        parameter.initializer !== undefined ||
        parameter.rest ||
        bindings.has(parameter.name)
      )
        return undefined;
      bindings.set(parameter.name, "mutable");
      parameters.push({ ...parameter, type: named("number") });
    }
    return parameters;
  }
  function numericWrite(
    node: Expression,
    bindings: ReadonlyMap<string, NumericBinding>,
  ): boolean {
    if (
      node.kind !== "update" &&
      node.kind !== "assignment" &&
      node.kind !== "compound"
    )
      return false;
    const target = node.target;
    if (
      !(
        target.kind === "identifier" && bindings.get(target.name) === "mutable"
      ) &&
      !numericMember(target, bindings)
    )
      return false;
    if (node.kind === "update") return true;
    if (
      node.kind === "compound" &&
      node.operator !== "+" &&
      node.operator !== "-" &&
      node.operator !== "*" &&
      node.operator !== "/"
    )
      return false;
    return numericLeafExpression(node.value, bindings);
  }
  /** Infer a record layout only for fresh, nonescaping literals whose fields
   * remain numeric and whose methods can only observe that fixed receiver. */
  function numericObjectLiteral(
    node: Expression & { readonly kind: "object" },
    outer: ReadonlyMap<string, NumericBinding>,
  ):
    | { readonly value: Expression; readonly binding: NumericRecord }
    | undefined {
    const seen = new Set<string>();
    const fields = new Set<string>();
    const methods = new Map<string, number>();
    const properties: PropertySignature[] = [];
    for (const property of node.properties) {
      if (
        property === undefined ||
        property.kind === "spread" ||
        property.keyExpression !== undefined ||
        property.prototypeSetter ||
        property.accessor !== undefined ||
        seen.has(property.name)
      )
        return undefined;
      seen.add(property.name);
      if (property.method) continue;
      if (!numericLeafExpression(property.value, outer)) return undefined;
      fields.add(property.name);
      properties.push({
        ...at(property),
        name: property.name,
        type: named("number"),
        readonly: false,
      });
    }
    const receiverType: TypeNode = { ...at(node), kind: "object", properties };
    const typedProperties: ObjectProperty[] = [];
    for (const property of node.properties) {
      if (property === undefined || property.kind === "spread")
        throw "SCRIPT_NUMERIC_RECORD_PROPERTY_INVARIANT";
      if (!property.method) {
        typedProperties.push(property);
        continue;
      }
      const method = property.value;
      if (method.kind !== "function-expression") return undefined;
      if (
        method.generator ||
        method.async ||
        method.returnType !== undefined ||
        typeParameterCount(method.typeParameters) !== 0
      )
        return undefined;
      const bindings = new Map<string, NumericBinding>();
      const parameters = numericParameters(method.parameters, bindings);
      if (parameters === undefined) return undefined;
      for (const [name, binding] of outer)
        if (name !== "arguments" && !bindings.has(name))
          bindings.set(name, binding);
      const receiver = "\0numericReceiver";
      bindings.set(receiver, {
        kind: "numeric-record",
        fields,
        methods: new Map<string, number>(),
      });
      const checked = rewriteModule(
        { ...at(method), imports: [], statements: [method.body] },
        {
          expression: (value, _original) =>
            value.kind === "this" ? id(receiver, value) : value,
        },
      ).statements[0];
      const statements = method.body.statements;
      if (
        checked === undefined ||
        statements[statements.length - 1]?.kind !== "return" ||
        !numericReturnTree(checked, bindings) ||
        collectTailCalls(method.body, { strict: true }).size !== 0
      )
        return undefined;
      methods.set(property.name, parameters.length);
      typedProperties.push({
        ...property,
        value: {
          ...method,
          receiver: receiverType,
          parameters,
          returnType: named("number"),
        },
      });
    }
    return {
      value: { ...node, properties: typedProperties },
      binding: { kind: "numeric-record", fields, methods },
    };
  }
  function numericDeclarations(
    node: Statement,
    bindings: Map<string, NumericBinding>,
  ): Statement | undefined {
    if (
      node.kind !== "variable" ||
      node.mode === "var" ||
      node.disposal !== undefined
    )
      return undefined;
    const declarations: VariableBinding[] = [];
    for (const declaration of node.declarations) {
      if (
        declaration === undefined ||
        declaration.kind === "array-binding" ||
        declaration.kind === "object-binding" ||
        declaration.type !== undefined ||
        bindings.has(declaration.name)
      )
        return undefined;
      const initial = declaration.initializer;
      if (initial === undefined) return undefined;
      if (node.mode === "const" && numericString(initial, bindings)) {
        bindings.set(declaration.name, "string");
        declarations.push({ ...declaration, type: named("string") });
        continue;
      }
      if (
        node.mode === "const" &&
        initial.kind === "call" &&
        !initial.optional
      ) {
        const callee = initial.callee;
        const factory =
          callee.kind === "identifier" ? bindings.get(callee.name) : undefined;
        if (
          typeof factory === "object" &&
          factory.kind === "numeric-factory" &&
          initial.arguments.length === factory.arguments &&
          initial.arguments.every(
            (item) =>
              item !== undefined && numericLeafExpression(item, bindings),
          )
        ) {
          bindings.set(declaration.name, factory.closureArguments);
          declarations.push(declaration);
          continue;
        }
      }
      if (node.mode === "const" && initial.kind === "array") {
        if (
          !initial.elements.every(
            (item) =>
              item !== undefined && numericLeafExpression(item, bindings),
          )
        )
          return undefined;
        bindings.set(declaration.name, {
          kind: "numeric-array",
          length: initial.elements.length,
        });
        declarations.push({
          ...declaration,
          type: { ...at(initial), kind: "array", element: named("number") },
        });
        continue;
      }
      if (node.mode === "const" && initial.kind === "object") {
        const numeric = numericObjectLiteral(initial, bindings);
        if (numeric === undefined) return undefined;
        bindings.set(declaration.name, numeric.binding);
        declarations.push({ ...declaration, initializer: numeric.value });
        continue;
      }
      const leaf =
        node.mode === "const" ? numericLeaf(initial, bindings) : undefined;
      if (leaf !== undefined) {
        bindings.set(declaration.name, leaf.parameters.length);
        declarations.push({ ...declaration, initializer: leaf });
      } else {
        if (!numericLeafExpression(initial, bindings)) return undefined;
        bindings.set(
          declaration.name,
          node.mode === "const" ? "constant" : "mutable",
        );
        declarations.push(declaration);
      }
    }
    return { ...node, declarations };
  }
  function numericString(
    node: Expression,
    bindings: ReadonlyMap<string, NumericBinding>,
  ): boolean {
    switch (node.kind) {
      case "string":
        return true;
      case "identifier":
        return bindings.get(node.name) === "string";
      case "group":
        return numericString(node.expression, bindings);
      case "conditional":
        return (
          numericTest(node.test, bindings) &&
          numericString(node.consequent, bindings) &&
          numericString(node.alternate, bindings)
        );
      default:
        return false;
    }
  }
  function numericTest(
    node: Expression,
    bindings: ReadonlyMap<string, NumericBinding>,
  ): boolean {
    if (node.kind === "group") return numericTest(node.expression, bindings);
    if (node.kind !== "binary") return false;
    const equality = node.operator === "===" || node.operator === "!==";
    if (
      equality &&
      numericString(node.left, bindings) &&
      numericString(node.right, bindings)
    )
      return true;
    return (
      (equality || ["<", "<=", ">", ">="].includes(node.operator)) &&
      numericLeafExpression(node.left, bindings) &&
      numericLeafExpression(node.right, bindings)
    );
  }
  function numericLoopAction(
    node: Statement,
    bindings: Map<string, NumericBinding>,
  ): Statement | undefined {
    if (node.kind === "expression")
      return numericWrite(node.expression, bindings) ? node : undefined;
    if (node.kind === "variable") return numericDeclarations(node, bindings);
    if (node.kind === "if") {
      if (!numericTest(node.test, bindings)) return undefined;
      const consequent = numericLoopAction(node.consequent, bindings);
      if (consequent === undefined) return undefined;
      if (node.alternate === undefined) return { ...node, consequent };
      const alternate = numericLoopAction(node.alternate, bindings);
      return alternate === undefined
        ? undefined
        : { ...node, consequent, alternate };
    }
    if (node.kind !== "block") return undefined;
    const local = new Map<string, NumericBinding>();
    for (const [name, binding] of bindings) local.set(name, binding);
    const statements: Statement[] = [];
    for (const child of node.statements) {
      if (child === undefined) return undefined;
      const step = numericLoopAction(child, local);
      if (step === undefined) return undefined;
      statements.push(step);
    }
    return { ...node, statements };
  }
  function numericReturnTree(
    node: Statement,
    bindings: ReadonlyMap<string, NumericBinding>,
  ): boolean {
    switch (node.kind) {
      case "return":
        return (
          node.expression !== undefined &&
          numericLeafExpression(node.expression, bindings)
        );
      case "block":
        return node.statements.every(
          (child) => child !== undefined && numericReturnTree(child, bindings),
        );
      case "if":
        return (
          numericTest(node.test, bindings) &&
          numericReturnTree(node.consequent, bindings) &&
          (node.alternate === undefined ||
            numericReturnTree(node.alternate, bindings))
        );
      default:
        return false;
    }
  }
  function numericRestArguments(
    declaration: Statement & { readonly kind: "function" },
    rest: Parameter,
    owner: BlockStatement,
    body: BlockStatement,
    parameters: Parameter[],
    bindings: Map<string, NumericBinding>,
    outer: ReadonlyMap<string, NumericBinding>,
  ): BlockStatement | undefined {
    if (
      rest.kind === "pattern-parameter" ||
      rest.type !== undefined ||
      bindings.has(rest.name)
    )
      return undefined;
    const restName = rest.name;
    const counts = new Set<number>();
    rewriteModule(
      { ...at(owner), imports: [], statements: owner.statements },
      {
        expression: (value, _original) => {
          if (value.kind !== "call") return value;
          const callee = value.callee;
          if (callee.kind === "identifier" && callee.name === declaration.name)
            counts.add(
              value.arguments.some((argument) => argument?.kind === "spread")
                ? -1
                : value.arguments.length,
            );
          return value;
        },
      },
    );
    if (counts.size !== 1) return undefined;
    let count = -1;
    for (const observed of counts) count = observed;
    const length = count - parameters.length;
    if (length < 0 || length > 8) return undefined;
    const slots: string[] = [];
    for (let i = 0; i < length; i++) {
      let name = "$restValue" + serial++;
      while (bindings.has(name) || outer.has(name) || name === restName)
        name = "$restValue" + serial++;
      slots.push(name);
      bindings.set(name, "constant");
      parameters.push({
        ...at(rest),
        name,
        type: named("number"),
        rest: false,
        optional: false,
      });
    }
    function slot(value: Expression): string | undefined {
      if (value.kind !== "index" || value.optional) return undefined;
      const object = value.object,
        index = value.index;
      if (
        object.kind !== "identifier" ||
        object.name !== restName ||
        index.kind !== "number" ||
        !Number.isInteger(index.value) ||
        index.value < 0
      )
        return undefined;
      return slots[index.value];
    }
    // Packed numeric arguments have an own element at every index before
    // length. Other accesses keep the normal rest object and its prototype.
    const rewritten = rewriteModule(
      { ...at(body), imports: [], statements: [body] },
      {
        hashes: true,
        expression: (value, original) => {
          const name = slot(original);
          if (name !== undefined) return id(name, original);
          if (value.kind === "member" && !value.optional) {
            const object = value.object;
            if (
              object.kind === "identifier" &&
              object.name === restName &&
              value.property === "length"
            )
              return scalarNumber(length, value);
          }
          if (
            value.kind === "binary" &&
            value.operator === "??" &&
            original.kind === "binary" &&
            slot(original.left) !== undefined
          )
            return value.left;
          return value;
        },
      },
    ).statements[0];
    return rewritten?.kind === "block" ? rewritten : undefined;
  }
  /** Infer a native signature when all inputs, captures and return paths
   * stay numeric, including calls to the function's own unchanged binding. */
  function numericClosedFunction(
    node: Statement,
    outer: Map<string, NumericBinding>,
    owner: BlockStatement,
  ): Statement | undefined {
    if (node.kind !== "function") return undefined;
    if (
      node.generator ||
      node.async ||
      node.returnType !== undefined ||
      typeParameterCount(node.typeParameters) !== 0 ||
      node.name === "arguments" ||
      outer.has(node.name)
    )
      return undefined;
    const body = node.body;
    if (
      body.kind !== "block" ||
      body.statements[body.statements.length - 1]?.kind !== "return" ||
      collectTailCalls(body, { strict: true }).size !== 0
    )
      return undefined;
    const bindings = new Map<string, NumericBinding>();
    const last = node.parameters[node.parameters.length - 1];
    const rest = last?.rest ? last : undefined;
    let restName: string | undefined;
    if (rest !== undefined) {
      if (rest.kind === "pattern-parameter") return undefined;
      restName = rest.name;
    }
    const parameters = numericParameters(
      rest === undefined ? node.parameters : node.parameters.slice(0, -1),
      bindings,
    );
    if (parameters === undefined || bindings.has(node.name)) return undefined;
    const implementation =
      rest === undefined
        ? body
        : numericRestArguments(
            node,
            rest,
            owner,
            body,
            parameters,
            bindings,
            outer,
          );
    if (implementation === undefined) return undefined;
    for (const [name, binding] of outer)
      if (!bindings.has(name) && name !== "arguments" && name !== restName)
        bindings.set(name, binding);
    const returned = implementation.statements[0];
    if (
      rest === undefined &&
      implementation.statements.length === 1 &&
      returned?.kind === "return"
    ) {
      const closure = numericLeaf(returned.expression, bindings);
      if (closure !== undefined) {
        outer.set(node.name, {
          kind: "numeric-factory",
          arguments: parameters.length,
          closureArguments: closure.parameters.length,
        });
        const returnedClosure: Statement = { ...returned, expression: closure };
        const factoryBody: BlockStatement = {
          ...implementation,
          statements: [returnedClosure],
        };
        return {
          ...node,
          parameters,
          returnType: {
            ...at(closure),
            kind: "function",
            parameters: closure.parameters,
            returnType: named("number"),
          },
          body: factoryBody,
        };
      }
    }
    bindings.set(node.name, parameters.length);
    if (!numericReturnTree(implementation, bindings)) return undefined;
    outer.set(node.name, parameters.length);
    return {
      ...node,
      parameters,
      body: implementation,
      returnType: named("number"),
    };
  }
  /** Counted loops use a word counter when the bound is an exact nonnegative
   * int32. A four-lane block preserves order, with the original loop for any
   * Number bound outside that lane. The surrounding analysis proves the
   * body cannot call user code or expose its iteration binding. */
  function unrollNumericLoop(
    node: Statement & { readonly kind: "for" },
    initializer: Statement,
    bindings: ReadonlyMap<string, NumericBinding>,
    earlier: readonly Statement[],
  ): Statement | undefined {
    if (
      initializer.kind !== "variable" ||
      initializer.declarations.length !== 1
    )
      return undefined;
    const variable = initializer.declarations[0];
    if (
      variable === undefined ||
      variable.kind === "array-binding" ||
      variable.kind === "object-binding"
    )
      return undefined;
    const start = variable.initializer;
    if (start?.kind !== "number" || start.value !== 0) return undefined;
    const name = variable.name;
    const test = node.test;
    const update = node.update;
    if (
      test?.kind !== "binary" ||
      test.operator !== "<" ||
      update?.kind !== "update" ||
      update.operator !== "++"
    )
      return undefined;
    const bound = test.right;
    const index = test.left,
      target = update.target;
    if (
      index.kind !== "identifier" ||
      index.name !== name ||
      (bound.kind !== "identifier" && bound.kind !== "number") ||
      target.kind !== "identifier" ||
      target.name !== name
    )
      return undefined;
    const body = node.body;
    const items = body.kind === "block" ? body.statements : [body];
    for (const child of items) {
      if (child?.kind !== "expression") return undefined;
      const op = child.expression;
      if (
        op.kind !== "update" &&
        op.kind !== "assignment" &&
        op.kind !== "compound"
      )
        return undefined;
      const written = op.target;
      if (
        written.kind !== "identifier" ||
        written.name === name ||
        (bound.kind === "identifier" && written.name === bound.name)
      )
        return undefined;
    }
    function fresh(): string {
      let candidate = "$counted" + serial++;
      while (bindings.has(candidate)) candidate = "$counted" + serial++;
      return candidate;
    }
    function constant(name: string, value: Expression): Statement {
      return {
        ...at(node),
        kind: "variable",
        mode: "const",
        exported: false,
        declarations: [
          { ...at(node), name, type: named("number"), initializer: value },
        ],
      };
    }
    function word(value: Expression): Expression {
      return scalarBinary(">>>", value, scalarNumber(0, node), node);
    }
    function counter(): Expression {
      return id(name, node);
    }
    function loop(
      initial: Expression,
      end: Expression,
      stride: number,
      body: Statement,
    ): Statement {
      return {
        ...node,
        initializer: {
          ...at(initializer),
          kind: "variable",
          mode: "let",
          exported: false,
          declarations: [
            { ...at(node), name, type: undefined, initializer: initial },
          ],
        },
        test: scalarBinary("<", counter(), end, node),
        update: {
          ...at(node),
          kind: "assignment",
          target: counter(),
          value: word(
            scalarBinary("+", counter(), scalarNumber(stride, node), node),
          ),
        },
        body,
      };
    }
    function lane(offset: number): Statement {
      const copied = rewriteModule(
        { ...at(body), imports: [], statements: [body] },
        {
          hashes: true,
          expression: (value, _original) =>
            offset !== 0 && value.kind === "identifier" && value.name === name
              ? scalarBinary("+", value, scalarNumber(offset, value), value)
              : value,
        },
      ).statements[0];
      if (copied === undefined) throw "SCRIPT_COUNTED_LOOP_BODY_INVARIANT";
      return copied;
    }
    const lengthName = fresh(),
      wideName = fresh();
    const length = id(lengthName, node),
      wide = id(wideName, node);
    const first = items[0];
    const reduction =
      items.length === 1 && first?.kind === "expression"
        ? signedIntegerReduction(first.expression, earlier)
        : undefined;
    const hot: Statement[] = [
      constant(
        wideName,
        scalarBinary("&", length, scalarNumber(-4, node), node),
      ),
    ];
    if (reduction === undefined) {
      const group: BlockStatement = {
        ...at(body),
        kind: "block",
        statements: [lane(0), lane(1), lane(2), lane(3)],
      };
      hot.push(
        loop(scalarNumber(0, node), wide, 4, group),
        loop(wide, length, 1, lane(0)),
      );
    } else {
      const target = id(reduction.name, node);
      const accumulatorName = fresh();
      const accumulator = id(accumulatorName, node);
      function signed(value: Expression): Expression {
        return scalarBinary("|", value, scalarNumber(0, node), node);
      }
      function advance(delta: number): Statement {
        return {
          ...at(body),
          kind: "expression",
          expression: {
            ...at(body),
            kind: "assignment",
            target: accumulator,
            value: signed(
              scalarBinary("+", accumulator, scalarNumber(delta, node), node),
            ),
          },
        };
      }
      hot.push(
        {
          ...at(node),
          kind: "variable",
          mode: "let",
          exported: false,
          declarations: [
            {
              ...at(node),
              name: accumulatorName,
              type: named("number"),
              initializer: signed(target),
            },
          ],
        },
        loop(scalarNumber(0, node), wide, 4, advance(reduction.delta * 4)),
        loop(wide, length, 1, advance(reduction.delta)),
        {
          ...at(node),
          kind: "expression",
          expression: {
            ...at(node),
            kind: "assignment",
            target,
            value: accumulator,
          },
        },
      );
    }
    return {
      ...at(node),
      kind: "block",
      statements: [
        constant(lengthName, word(bound)),
        {
          ...at(node),
          kind: "if",
          test: scalarBinary(
            "&&",
            scalarBinary("===", length, bound, node),
            scalarBinary(
              "<=",
              length,
              scalarNumber(reduction?.count ?? 2147483647, node),
              node,
            ),
            node,
          ),
          consequent: {
            ...at(node),
            kind: "block",
            statements: hot,
          },
          alternate: { ...node, initializer },
        },
      ],
    };
  }
  function signedIntegerLiteral(
    node: Expression | undefined,
  ): number | undefined {
    if (node === undefined) return undefined;
    if (node.kind === "group") return signedIntegerLiteral(node.expression);
    if (
      node.kind === "unary" &&
      (node.operator === "-" || node.operator === "+")
    ) {
      const operand = signedIntegerLiteral(node.operand);
      return operand === undefined
        ? undefined
        : node.operator === "-"
          ? -operand
          : operand;
    }
    return node.kind === "number" && Number.isInteger(node.value)
      ? node.value
      : undefined;
  }
  /** An exact signed range makes four additions equivalent to a single
   * word addition. A double continuation covers all other loop bounds. */
  function signedIntegerReduction(
    operation: Expression,
    earlier: readonly Statement[],
  ):
    | { readonly name: string; readonly delta: number; readonly count: number }
    | undefined {
    if (
      operation.kind !== "compound" ||
      (operation.operator !== "+" && operation.operator !== "-")
    )
      return undefined;
    const target = operation.target;
    if (target.kind !== "identifier") return undefined;
    const name = target.name;
    const term = operation.value;
    const called =
      term.kind === "call" && term.arguments.length === 0
        ? term.callee
        : undefined;
    const callee = called?.kind === "identifier" ? called.name : undefined;
    let initial: number | undefined = undefined;
    let operand = signedIntegerLiteral(term);
    for (const statement of earlier) {
      if (statement?.kind === "function") {
        const body = statement.body;
        if (
          statement.name === callee &&
          body.kind === "block" &&
          body.statements.length === 1
        ) {
          const returned = body.statements[0];
          if (returned?.kind === "return")
            operand = signedIntegerLiteral(returned.expression);
        }
        continue;
      }
      if (statement?.kind !== "variable") return undefined;
      for (const binding of statement.declarations) {
        if (
          binding === undefined ||
          binding.kind === "object-binding" ||
          binding.kind === "array-binding"
        )
          return undefined;
        const value = binding.initializer;
        if (binding.name === name) initial = signedIntegerLiteral(value);
        if (
          binding.name !== callee ||
          statement.mode !== "const" ||
          value?.kind !== "arrow"
        )
          continue;
        const body = value.body;
        if (body.kind !== "block") operand = signedIntegerLiteral(body);
        else if (body.statements.length === 1) {
          const returned = body.statements[0];
          if (returned?.kind === "return")
            operand = signedIntegerLiteral(returned.expression);
        }
      }
    }
    if (
      initial === undefined ||
      (initial === 0 && 1 / initial < 0) ||
      initial > 2147483647 ||
      initial < -2147483648 ||
      operand === undefined ||
      operand === 0 ||
      Math.abs(operand) > 536870911
    )
      return undefined;
    const delta = operation.operator === "+" ? operand : -operand;
    const span = delta > 0 ? 2147483647 - initial : initial + 2147483648;
    return {
      name,
      delta,
      count: Math.min(2147483647, Math.floor(span / Math.abs(delta))),
    };
  }
  /** Accept a closed numeric program with at least one loop. Once the entry
   * operands are numbers, local writes and closed calls preserve that fact. */
  function numericLoopImplementation(
    source: readonly Parameter[],
    body: Expression | BlockStatement,
    span: Span,
  ): Expression | undefined {
    if (body.kind !== "block") return undefined;
    if (!body.statements.some((node) => node?.kind === "for")) return undefined;
    const bindings = new Map<string, NumericBinding>();
    const parameters = numericParameters(source, bindings);
    if (parameters === undefined || parameters.length === 0) return undefined;
    const finish = body.statements[body.statements.length - 1];
    if (finish?.kind !== "return") return undefined;
    const returned = finish.expression;
    if (returned === undefined) return undefined;
    const result: Statement[] = [];
    let loops = 0;
    for (let index = 0; index < body.statements.length - 1; index++) {
      const node = body.statements[index];
      if (node?.kind === "function") {
        const local = numericClosedFunction(node, bindings, body);
        if (local === undefined) return undefined;
        result.push(local);
        continue;
      }
      if (node?.kind === "variable") {
        const local = numericDeclarations(node, bindings);
        if (local === undefined) return undefined;
        result.push(local);
        continue;
      }
      if (node?.kind !== "for") return undefined;
      const test = node.test,
        update = node.update,
        initial = node.initializer;
      if (initial === undefined || test === undefined || update === undefined)
        return undefined;
      const loopBindings = new Map<string, NumericBinding>();
      for (const [name, binding] of bindings) loopBindings.set(name, binding);
      const initializer = numericDeclarations(initial, loopBindings);
      if (
        initializer === undefined ||
        !numericTest(test, loopBindings) ||
        !numericWrite(update, loopBindings)
      )
        return undefined;
      const loopBody = numericLoopAction(node.body, loopBindings);
      if (loopBody === undefined) return undefined;
      loops++;
      const numericLoop: Statement & { readonly kind: "for" } = {
        ...node,
        body: loopBody,
      };
      result.push(
        unrollNumericLoop(numericLoop, initializer, loopBindings, result) ?? {
          ...numericLoop,
          initializer,
        },
      );
    }
    if (loops === 0 || !numericLeafExpression(returned, bindings))
      return undefined;
    result.push(finish);
    const implementationBody: BlockStatement = { ...body, statements: result };
    return {
      ...at(span),
      kind: "arrow",
      parameters,
      returnType: named("number"),
      body: implementationBody,
    };
  }
  /** ToPropertyKey of a constant string key is the key itself, and its only
   * other effect, RequireObjectCoercible(base), is repeated by the adjacent
   * get or set helper, so constant keys skip the conversion call. */
  function convertedKey(
    base: Expression,
    property: Expression,
    span: Span,
  ): Expression {
    if (property.kind === "string") return property;
    return checkedOperatorValue("objectPropertyKey", [base, property], span);
  }
  function propertyValue(
    base: Expression,
    property: Expression,
    span: Span,
  ): Expression {
    const key = convertedKey(base, property, span);
    return readProperty(base, key, span);
  }
  function inlineCachedPropertyCell(
    base: Expression,
    cache: Expression,
    own: boolean,
    span: Span,
  ): Expression {
    const without = id("undefined", span);
    const object = temporary(
      runtimeCall(
        "viewObjectValue",
        [base, member(id("$errors"), "objectPrototype", span)],
        span,
      ),
    );
    const first = temporary(member(cache, "first", span));
    const layout = temporary(
      optionalMember(object, "internalPropertyLayout", span),
    );
    const holder = own ? layout : temporary(layout, false, true);
    if (!own) {
      const expected = temporary(member(first, "holder", span));
      const start = statements.length;
      const prototype = temporary(optionalMember(object, "prototype", span));
      const inherited = temporary(
        optionalMember(prototype, "internalPropertyLayout", span),
      );
      const matches: Expression = {
        ...at(span),
        kind: "binary",
        operator: "&&",
        left: {
          ...at(span),
          kind: "binary",
          operator: "!==",
          left: inherited,
          right: without,
        },
        right: {
          ...at(span),
          kind: "binary",
          operator: "===",
          left: member(inherited, "shape", span),
          right: expected,
        },
      };
      expression({
        ...at(span),
        kind: "assignment",
        target: holder,
        value: scalarBranch(matches, inherited, without, span),
      });
      const consequent: BlockStatement = {
        ...at(span),
        kind: "block",
        statements: statements.splice(start),
      };
      statements.push({
        ...at(span),
        kind: "if",
        test: {
          ...at(span),
          kind: "binary",
          operator: "!==",
          left: expected,
          right: without,
        },
        consequent,
        alternate: undefined,
      });
    }
    const matchingShape: Expression = {
      ...at(span),
      kind: "binary",
      operator: "&&",
      left: {
        ...at(span),
        kind: "binary",
        operator: "!==",
        left: layout,
        right: without,
      },
      right: {
        ...at(span),
        kind: "binary",
        operator: "===",
        left: member(layout, "shape", span),
        right: member(cache, "inlineReceiver", span),
      },
    };
    const present: Expression = own
      ? matchingShape
      : {
          ...at(span),
          kind: "binary",
          operator: "&&",
          left: matchingShape,
          right: {
            ...at(span),
            kind: "binary",
            operator: "!==",
            left: holder,
            right: without,
          },
        };
    // The holder's first cells are in place: one checked load.
    const offset = temporary(member(first, "offset", span));
    // `present` (below) has narrowed the holder.
    const cell = scalarBranch(
      scalarBinary("<", offset, scalarNumber(propertyLayoutSlots, span), span),
      runtimeCall("readPropertyLayoutSlot", [holder, offset], span),
      {
        ...at(span),
        kind: "index",
        object: member(holder, "cells", span),
        index: offset,
      },
      span,
    );
    return temporary(scalarBranch(present, cell, without, span));
  }
  function dataCacheHit(cell: Expression, span: Span): Expression {
    return {
      ...at(span),
      kind: "binary",
      operator: "&&",
      left: {
        ...at(span),
        kind: "binary",
        operator: "!==",
        left: cell,
        right: id("undefined", span),
      },
      right: {
        ...at(span),
        kind: "unary",
        operator: "!",
        operand: member(cell, "accessor", span),
      },
    };
  }
  function readProperty(
    base: Expression,
    key: Expression,
    span: Span,
  ): Expression {
    const cached = key.kind === "string" && !compactResults;
    const object =
      cached && key.kind === "string" && key.value !== "length"
        ? temporary(base, true)
        : base;
    const args = [
      object,
      key,
      member(id("$global"), "hooks", span),
      id("$errors"),
    ];
    const cache =
      cached && key.kind === "string"
        ? propertyCache(key.value, span)
        : undefined;
    if (cache !== undefined) args.push(cache);
    const read = runtimeCall(
      cached ? "readCachedObjectValueProperty" : "readObjectValueProperty",
      args,
      span,
    );
    if (cached && key.kind === "string" && key.value === "length")
      return temporary(
        scalarBranch(
          categoryOperand(base, "string", span),
          member(base, "length", span),
          read,
          span,
        ),
        true,
      );
    if (cache === undefined) return temporary(read, true);
    const cell = inlineCachedPropertyCell(object, cache, false, span);
    return temporary(
      scalarBranch(
        dataCacheHit(cell, span),
        member(cell, "value", span),
        read,
        span,
      ),
      true,
    );
  }
  function readComputedProperty(
    base: Expression,
    key: Expression,
    span: Span,
  ): Expression {
    const slow = runtimeCall(
      "readObjectValuePropertyKey",
      [base, key, member(id("$global"), "hooks", span), id("$errors")],
      span,
    );
    if (compactResults) return temporary(slow, true);
    const zero = scalarNumber(0, span);
    const index = temporary(
      scalarBranch(
        numberOperand(key, span),
        scalarBinary(">>>", key, zero, span),
        scalarNumber(-1, span),
        span,
      ),
    );
    const object = temporary(
      scalarBranch(
        scalarBinary(
          "&&",
          scalarBinary(">=", index, zero, span),
          scalarBinary("===", key, index, span),
          span,
        ),
        runtimeCall(
          "viewObjectValue",
          [base, member(id("$errors"), "objectPrototype", span)],
          span,
        ),
        id("undefined", span),
        span,
      ),
    );
    const elements = temporary(
      optionalMember(object, "internalArrayElements", span),
    );
    // Only the standard Array exotic owns packed elements. The length check
    // excludes holes so the ordinary path can still observe inherited accessors.
    const packed = (list: Expression, fallback: Expression): Expression =>
      scalarBranch(
        scalarBinary(
          "&&",
          scalarBinary("!==", list, id("undefined", span), span),
          scalarBinary("<", index, member(list, "length", span), span),
          span,
        ),
        { ...at(span), kind: "index", object: list, index },
        fallback,
        span,
      );
    const numbers = temporary(optionalMember(elements, "numbers", span));
    const values = temporary(optionalMember(elements, "values", span));
    return temporary(packed(numbers, packed(values, slow)), true);
  }
  function typedList(elementType: string, span: Span): Expression {
    return temporary(
      { ...at(span), kind: "array", elements: [] },
      false,
      false,
      {
        ...at(span),
        kind: "array",
        element: named(elementType),
        readonly: false,
      },
    );
  }
  function privateName(name: string, span: Span): Expression {
    for (let i = privateScopes.length - 1; i >= 0; i--) {
      const privateScope = privateScopes[i];
      if (privateScope === undefined) throw "PRIVATE_SCOPE_INVARIANT";
      const found = privateScope.names.get(name);
      if (found !== undefined) return found;
    }
    const external = externalPrivate.get(name);
    if (external !== undefined) return external;
    return fail(span, "unresolved private name: " + name);
  }
  function thisValue(span: Span): Expression {
    const context = derivedContext;
    if (context === undefined) return receiver;
    const result = temporary(call("getDerivedThis", [context], span));
    check(member(result, "error", span), span);
    return member(result, "value", span);
  }
  function captureAssignment(
    target: Expression,
    readModifyWrite: boolean = false,
  ): AssignmentReference {
    while (target.kind === "group") target = target.expression;
    if (target.kind === "identifier") {
      const local = localSlot(target, true);
      if (local !== undefined)
        return { ...at(target), base: local, property: undefined, local: true };
      const fixedBinding = fixedCellReferences.get(target.start);
      if (fixedBinding !== undefined)
        return {
          ...at(target),
          base: fixedCell(fixedBinding, target),
          property: undefined,
          fixedBinding,
        };
      return {
        ...at(target),
        base: reference(target.name, target),
        property: undefined,
      };
    }
    if (target.kind === "member" || target.kind === "index") {
      if (target.optional)
        fail(target, "Script optional property assignment is not implemented");
      if (target.object.kind === "super") {
        const methodHome = home;
        if (methodHome === undefined)
          fail(target, "super requires a compiled method home object");
        const superReceiver = temporary(thisValue(target), true);
        const key =
          target.kind === "member"
            ? text(target.property, target)
            : temporary(value(target.index), true, readModifyWrite);
        const base = temporary(member(methodHome, "prototype", target), true);
        return {
          ...at(target),
          base,
          property: key,
          superReceiver,
          retainedKey: readModifyWrite && target.kind === "index",
        };
      }
      return propertyReference(
        temporary(value(target.object), true),
        target,
        readModifyWrite,
      );
    }
    if (target.kind === "call") {
      // Annex B.3.9 evaluates the call, then throws before evaluating the RHS.
      temporary(value(target), true);
      check(text("reference", target), target);
      return {
        ...at(target),
        base: id("undefined"),
        property: undefined,
        invalid: true,
      };
    }
    return fail(target, "Script assignment target is not implemented");
  }
  function declareVariableTarget(
    name: string,
    span: Span,
  ): AssignmentReference {
    const binding = variableDeclarationBindings.get(span.start);
    const local = binding === undefined ? undefined : localSlots.get(binding);
    return local === undefined
      ? { ...at(span), base: reference(name, span), property: undefined }
      : { ...at(span), base: local, property: undefined, local: true };
  }
  function propertyReference(
    base: Expression,
    node: Expression,
    readModifyWrite: boolean = false,
  ): AssignmentReference {
    if (node.kind === "member") {
      if (node.private)
        return {
          ...at(node),
          base,
          property: undefined,
          privateName: privateName(node.property, node),
        };
      return { ...at(node), base, property: text(node.property, node) };
    }
    if (node.kind === "index")
      return {
        ...at(node),
        base,
        property: temporary(value(node.index), true, readModifyWrite),
        retainedKey: readModifyWrite,
      };
    throw "PROPERTY_REFERENCE_INVARIANT";
  }
  function assignmentName(target: Expression): Expression | undefined {
    // NamedEvaluation uses the original IsIdentifierRef syntax. Parentheses
    // preserve an assignment reference but do not qualify it for name inference.
    return target.kind === "identifier" ? text(target.name, target) : undefined;
  }
  /** Convert a property Reference key. GetValue stores the result back into
   * a retained key temporary so the later PutValue reuses it unobservably. */
  function referenceKey(
    target: AssignmentReference,
    property: Expression,
    span: Span,
    store: boolean,
  ): Expression {
    const key = convertedKey(target.base, property, span);
    // Return the typed conversion; the stored copy serves the later write.
    if (store && target.retainedKey === true)
      expression({
        ...at(span),
        kind: "assignment",
        target: property,
        value: { ...key },
      });
    return key;
  }
  function readAssignment(target: AssignmentReference): Expression {
    if (target.invalid) return id("undefined");
    if (target.local) {
      checkSlotInitialized(target);
      return { ...target.base, ...at(target) };
    }
    if (target.fixedBinding !== undefined) {
      checkBindingInitialized(
        member(target.base, "initialized", target),
        target,
      );
      return temporary(member(target.base, "value", target), true);
    }
    const property = target.property;
    const superReceiver = target.superReceiver;
    const privateKey = target.privateName;
    if (privateKey !== undefined)
      return checkedOperatorValue(
        "getPrivateObjectValue",
        [target.base, privateKey],
        target,
      );
    if (property === undefined) return read(target.base, target);
    // A computed key that no later PutValue reuses converts inside the read.
    if (
      superReceiver === undefined &&
      property.kind !== "string" &&
      target.retainedKey !== true
    )
      return readComputedProperty(target.base, property, target);
    const key = referenceKey(target, property, target, true);
    if (superReceiver === undefined)
      return readProperty(target.base, key, target);
    return checkedRuntimeValue(
      "getObjectValuePropertyWithReceiver",
      [
        target.base,
        key,
        superReceiver,
        member(id("$global"), "hooks", target),
        id("$errors"),
      ],
      target,
    );
  }
  function writeAssignment(
    target: AssignmentReference,
    assigned: Expression,
  ): void {
    if (target.invalid) return;
    if (target.local) {
      const value = temporary(assigned, true);
      checkSlotInitialized(target);
      const binding = localBindingReferences.get(target.start);
      if (binding !== undefined && boundBindings[binding]?.kind === "const") {
        if (strict || !sloppySelfBindings.has(binding))
          check(text("type", target), target);
      } else storeSlot(target.base, bindingWriteValue(value, target), target);
      return;
    }
    const fixedBinding = target.fixedBinding;
    if (fixedBinding !== undefined) {
      const value = temporary(assigned, true);
      const binding = boundBindings[fixedBinding];
      if (binding === undefined) throw "FIXED_BINDING_CELL_INVARIANT";
      if (binding.kind === "import") {
        check(text("type", target), target);
        return;
      }
      checkBindingInitialized(
        member(target.base, "initialized", target),
        target,
      );
      if (!binding.mutable) check(text("type", target), target);
      else
        storeSlot(
          member(target.base, "value", target),
          bindingWriteValue(value, target),
          target,
        );
      return;
    }
    const property = target.property;
    const superReceiver = target.superReceiver;
    const privateKey = target.privateName;
    if (privateKey !== undefined) {
      check(
        temporary(
          runtimeCall(
            "setPrivateObjectValue",
            [
              target.base,
              privateKey,
              assigned,
              member(id("$global"), "hooks", target),
              member(id("$global"), "object", target),
            ],
            target,
          ),
        ),
        target,
      );
      return;
    }
    if (property === undefined) {
      write(target.base, assigned, target);
      return;
    }
    if (
      superReceiver === undefined &&
      property.kind !== "string" &&
      target.retainedKey !== true &&
      !compactResults
    ) {
      usesIndexedWrites = true;
      expression(
        runtimeCall(
          "writeObjectValuePropertyKey",
          [
            target.base,
            property,
            assigned,
            { ...at(target), kind: "boolean", value: strict },
            member(id("$global"), "hooks", target),
            id("$errors"),
          ],
          target,
        ),
      );
      return;
    }
    const key = referenceKey(target, property, target, false);
    const args: Expression[] = [target.base, key, assigned];
    if (superReceiver !== undefined) args.push(superReceiver);
    args.push(
      { ...at(target), kind: "boolean", value: strict },
      member(id("$global"), "hooks", target),
      id("$errors"),
    );
    if (
      superReceiver === undefined &&
      key.kind === "string" &&
      !compactResults
    ) {
      const cache = propertyCache(key.value, target);
      const value = temporary(assigned, true);
      args[2] = value;
      args.push(cache);
      const cell = inlineCachedPropertyCell(target.base, cache, true, target);
      const fast: Expression = {
        ...at(target),
        kind: "binary",
        operator: "&&",
        left: dataCacheHit(cell, target),
        right: member(cell, "writable", target),
      };
      statements.push({
        ...at(target),
        kind: "if",
        test: fast,
        consequent: {
          ...at(target),
          kind: "expression",
          expression: {
            ...at(target),
            kind: "assignment",
            target: member(cell, "value", target),
            value,
          },
        },
        alternate: {
          ...at(target),
          kind: "expression",
          expression: runtimeCall(
            "writeCachedObjectValueProperty",
            args,
            target,
          ),
        },
      });
      return;
    }
    checkedRuntimeCompletion(
      superReceiver === undefined
        ? "setObjectValueProperty"
        : "setObjectValuePropertyWithReceiver",
      args,
      target,
    );
  }

  function deleteAssignment(
    target: AssignmentReference,
    span: Span,
  ): Expression {
    if (target.superReceiver !== undefined) {
      check(text("reference", span), span);
      return { ...at(span), kind: "boolean", value: true };
    }
    const property = target.property;
    if (property === undefined) throw "SCRIPT_DELETE_PROPERTY_INVARIANT";
    const key = checkedOperatorValue(
      "objectPropertyKey",
      [target.base, property],
      span,
    );
    return checkedRuntimeValue(
      "deleteObjectValueProperty",
      [
        target.base,
        key,
        { ...at(span), kind: "boolean", value: strict },
        member(id("$global"), "object", span),
      ],
      span,
    );
  }
  function callTarget(
    input: Expression,
    checkMethod: boolean = false,
  ): {
    value: Expression;
    receiver: Expression;
    contract: Expression | undefined;
  } {
    let node = input;
    while (node.kind === "group") node = node.expression;
    if (isOptionalChain(node)) {
      const evaluated = optionalChainValue(node, false);
      return {
        value: evaluated.value,
        receiver: evaluated.receiver,
        contract: undefined,
      };
    }
    if (node.kind === "identifier") {
      // Declarative, module and global records have no base object; reading
      // the callee before its arguments preserves evaluation order.
      if (identifierCalleesUnbased || localSlot(node) !== undefined)
        return {
          value: identifierValue(node.name, node),
          receiver: id("undefined", node),
          contract: undefined,
        };
      const resolved = reference(node.name, node);
      return {
        value: read(resolved, node),
        receiver: temporary(call("getBindingThisValue", [resolved], node)),
        contract: undefined,
      };
    }
    if (node.kind === "member" || node.kind === "index") {
      const reference = captureAssignment(node);
      const property = reference.property;
      if (checkMethod && property !== undefined) {
        usesPrimitiveContracts = true;
        const key = referenceKey(reference, property, node, false);
        const superReceiver = reference.superReceiver;
        const args: Expression[] = [reference.base, key];
        if (superReceiver !== undefined) args.push(superReceiver);
        args.push(member(id("$global"), "hooks", node), id("$errors"));
        const callable = temporary(
          checkedRuntimeValue(
            superReceiver === undefined
              ? "getObjectValueProperty"
              : "getObjectValuePropertyWithReceiver",
            args,
            node,
          ),
          true,
        );
        const methodContract = temporary(
          runtimeCall(
            "findClassMethodContract",
            [reference.base, key, id("$errors")],
            node,
          ),
        );
        return {
          value: callable,
          receiver: superReceiver ?? reference.base,
          contract: methodContract,
        };
      }
      return {
        value: readAssignment(reference),
        receiver: reference.superReceiver ?? reference.base,
        contract: undefined,
      };
    }
    return {
      value: value(node),
      receiver: id("undefined", node),
      contract: undefined,
    };
  }
  function invokeEvalCandidate(
    callee: Expression,
    callReceiver: Expression,
    args: readonly Expression[],
    span: Span,
  ): Expression {
    usesDirectEval = true;
    const list = argumentList(args, span);
    let privateEnvironment = inheritedPrivate;
    for (const privateScope of privateScopes) {
      if (privateScope === undefined) throw "PRIVATE_SCOPE_INVARIANT";
      for (const [description, name] of privateScope.names) {
        if (description === undefined || name === undefined)
          throw "PRIVATE_NAME_INVARIANT";
        privateEnvironment = temporary(
          object(["name", "outer"], [name, privateEnvironment], span),
          false,
          false,
          named("DirectEvalPrivateName"),
        );
      }
    }
    const flags =
      (strict ? directEvalStrict : 0) |
      (inFunction ? directEvalInFunction : 0) |
      (home !== undefined ? directEvalInMethod : 0) |
      (derivedContext !== undefined ? directEvalInDerivedConstructor : 0) |
      (privateInherited || privateEnvironment !== inheritedPrivate
        ? directEvalInPrivateEnvironment
        : 0) |
      (inClassFieldInitializer ? directEvalInClassFieldInitializer : 0);
    let site: Expression = id("undefined");
    {
      let catches: Expression = strict ? id("undefined") : inheritedCatches;
      if (!strict)
        for (const record of catchRecords) {
          if (record === undefined) throw "DIRECT_EVAL_CATCH_INVARIANT";
          catches = temporary(
            object(["record", "outer"], [record, catches], span),
            false,
            false,
            {
              ...generated,
              kind: "named",
              name: "DirectEvalCatch",
              arguments: instantiation("DirectEvalCatch"),
            },
          );
        }
      site = temporary(
        object(
          [
            "scriptOrModule",
            "lexical",
            "variables",
            "catches",
            "thisValue",
            "newTarget",
            "home",
            "derived",
            "activeFunction",
            "privateEnvironment",
          ],
          [
            scriptIdentity(),
            scope,
            variableScope,
            catches,
            derivedContext === undefined ? receiver : id("undefined"),
            newTarget,
            home ?? id("undefined"),
            derivedContext ?? id("undefined"),
            activeConstructor ?? id("undefined"),
            privateEnvironment,
          ],
          span,
        ),
        false,
        false,
        named("DirectEvalSite"),
      );
    }
    const result = temporary(
      runtimeCall(
        isTailCall(span) ? "callEvalTailCandidate" : "callEvalCandidate",
        [
          callee,
          callReceiver,
          list,
          member(id("$global"), "object", span),
          id("$errors"),
          { ...at(span), kind: "number", value: flags, raw: String(flags) },
          site,
        ],
        span,
      ),
    );
    check(member(result, "error", span), span);
    return member(result, "value", span);
  }
  function invoke(
    callee: Expression,
    receiver: Expression,
    args: readonly Expression[],
    span: Span,
  ): Expression {
    if (
      nativeScriptCalls &&
      !compactResults &&
      !isTailCall(span) &&
      !args.some((argument) => argument?.kind === "spread")
    ) {
      usesNativeScriptCalls = true;
      const target = temporary(callee, true);
      const thisValue = temporary(receiver, true);
      const actuals = args.map((argument) => {
        if (argument === undefined) throw "SCRIPT_ARGUMENT_INVARIANT";
        return temporary(value(argument), true);
      });
      const errors = id("$errors", span);
      const object = temporary(
        runtimeCall(
          "viewObjectValue",
          [target, member(errors, "objectPrototype", span)],
          span,
        ),
      );
      const slot = temporary({
        ...at(span),
        kind: "member",
        object,
        property: "internalRegisterCall",
        optional: true,
      });
      const entry = temporary({
        ...at(span),
        kind: "member",
        object: slot,
        property: "scriptInvoke",
        optional: true,
      });
      const active = temporary(
        member(member(errors, "agent", span), "activeContext", span),
      );
      const context = member(slot, "context", span);
      let accepts: Expression = {
        ...at(span),
        kind: "binary",
        operator: "!==",
        left: entry,
        right: id("undefined", span),
      };
      for (const left of [slot, active]) {
        if (left === undefined) throw "SCRIPT_NATIVE_GUARD_INVARIANT";
        accepts = {
          ...at(span),
          kind: "binary",
          operator: "&&",
          left: accepts,
          right: {
            ...at(span),
            kind: "binary",
            operator: "!==",
            left,
            right: id("undefined", span),
          },
        };
      }
      for (const property of ["realm", "scriptOrModule"]) {
        if (property === undefined) throw "SCRIPT_CONTEXT_FIELD_INVARIANT";
        const test: Expression = {
          ...at(span),
          kind: "binary",
          operator: "===",
          left: member(active, property, span),
          right: member(context, property, span),
        };
        accepts = {
          ...at(span),
          kind: "binary",
          operator: "&&",
          left: accepts,
          right: test,
        };
      }
      const result = temporary(id("undefined", span), true, true);
      const start = statements.length;
      const slow = invokeList(
        target,
        thisValue,
        {
          ...at(span),
          kind: "array",
          elements: actuals,
        },
        span,
      );
      expression({
        ...at(span),
        kind: "assignment",
        target: result,
        value: slow,
      });
      const alternate: BlockStatement = {
        ...at(span),
        kind: "block",
        statements: statements.splice(start),
      };
      const operands: Expression[] = [
        target,
        thisValue,
        id("undefined", span),
        id("undefined", span),
      ];
      for (const actual of actuals) {
        if (actual === undefined) throw "SCRIPT_ARGUMENT_INVARIANT";
        operands.push(actual);
      }
      statements.push({
        ...at(span),
        kind: "if",
        test: accepts,
        consequent: {
          ...at(span),
          kind: "expression",
          expression: {
            ...at(span),
            kind: "assignment",
            target: result,
            value: {
              ...at(span),
              kind: "call",
              scriptCall: true,
              callee: entry,
              arguments: operands,
            },
          },
        },
        alternate,
      });
      return result;
    }
    if (
      !compactResults &&
      !isTailCall(span) &&
      args.length <= 6 &&
      !args.some((argument) => argument?.kind === "spread")
    ) {
      const wide = args.length > 2;
      if (wide) usesWideRegisterCalls = true;
      else usesRegisterCalls = true;
      const operands: Expression[] = [
        id("$errors"),
        scalarNumber(args.length, span),
        callee,
        receiver,
      ];
      for (const argument of args) {
        if (argument === undefined) throw "SCRIPT_ARGUMENT_INVARIANT";
        operands.push(temporary(value(argument), true));
      }
      const width = wide ? 6 : 2;
      while (operands.length < 4 + width) operands.push(id("undefined", span));
      return temporary(
        runtimeCall(
          wide ? "callWideRegisterObjectValue" : "callRegisterObjectValue",
          operands,
          span,
        ),
        true,
      );
    }
    return invokeList(callee, receiver, argumentList(args, span), span);
  }
  function invokeNumericLeaf(
    leaf: NumericLeaf,
    callee: Expression,
    receiver: Expression,
    args: readonly Expression[],
    span: Span,
  ): Expression | undefined {
    if (
      args.length !== leaf.arity ||
      args.some((arg) => arg === undefined || arg.kind === "spread")
    )
      return undefined;
    let guard: Expression | undefined = leaf.mutable
      ? {
          ...at(span),
          kind: "binary",
          operator: "===",
          left: callee,
          right: leaf.witness,
        }
      : undefined;
    const evaluated: Expression[] = [];
    for (const arg of args) {
      if (arg === undefined) throw "SCRIPT_ARGUMENT_INVARIANT";
      const operand = temporary(value(arg), true);
      evaluated.push(operand);
      const type = numberOperand(operand, arg);
      guard =
        guard === undefined
          ? type
          : {
              ...at(arg),
              kind: "binary",
              operator: "&&",
              left: guard,
              right: type,
            };
    }
    const direct: Expression = {
      ...at(span),
      kind: "call",
      callee: leaf.implementation,
      arguments: evaluated,
    };
    if (guard === undefined) return temporary(direct, true);
    const result = temporary(id("undefined", span), true, true);
    const start = statements.length;
    const fallback = invokePrepared(callee, receiver, evaluated, span);
    expression({
      ...at(span),
      kind: "assignment",
      target: result,
      value: fallback,
    });
    const alternate: BlockStatement = {
      ...at(span),
      kind: "block",
      statements: statements.splice(start),
    };
    const store: Expression = {
      ...at(span),
      kind: "assignment",
      target: result,
      value: direct,
    };
    statements.push({
      ...at(span),
      kind: "if",
      test: guard,
      consequent: { ...at(span), kind: "expression", expression: store },
      alternate,
    });
    return result;
  }
  function argumentList(args: readonly Expression[], span: Span): Expression {
    if (!args.some((argument) => argument?.kind === "spread")) {
      const elements: Expression[] = [];
      for (const argument of args) {
        if (argument === undefined) throw "SCRIPT_ARGUMENT_INVARIANT";
        elements.push(temporary(value(argument), true));
      }
      return { ...at(span), kind: "array", elements };
    }
    const list = temporary(
      { ...at(span), kind: "array", elements: [] },
      false,
      false,
      { ...at(span), kind: "array", element: named("unknown") },
    );
    for (const argument of args) {
      if (argument === undefined) throw "SCRIPT_ARGUMENT_INVARIANT";
      if (argument.kind === "spread") {
        expression(
          runtimeCall(
            "appendScriptArguments",
            [
              list,
              temporary(value(argument.value), true),
              id("$errors"),
              member(id("$global"), "hooks", argument),
            ],
            argument,
          ),
        );
      } else {
        const initialized = temporary(value(argument), true);
        expression({
          ...at(argument),
          kind: "call",
          callee: member(list, "push", argument),
          arguments: [initialized],
        });
      }
    }
    return list;
  }
  function invokePrepared(
    callee: Expression,
    receiver: Expression,
    arguments_: readonly Expression[],
    span: Span,
  ): Expression {
    return invokeList(
      callee,
      receiver,
      { ...at(span), kind: "array", elements: arguments_ },
      span,
    );
  }
  function isTailCall(span: Span): boolean {
    return tailEnds.get(span.start) === span.end;
  }
  function invokeList(
    callee: Expression,
    receiver: Expression,
    arguments_: Expression,
    span: Span,
  ): Expression {
    if (isTailCall(span)) {
      const result = temporary(
        runtimeCall(
          "requestSourceTailCall",
          [
            callee,
            receiver,
            arguments_,
            member(id("$global"), "object", span),
            id("$errors"),
          ],
          span,
        ),
      );
      check(member(result, "error", span), span);
      return member(result, "value", span);
    }
    return checkedRuntimeValue(
      "callObjectValue",
      [callee, receiver, arguments_, member(id("$global"), "object", span)],
      span,
    );
  }
  function optionalChainValue(
    node: Expression,
    deleting: boolean,
  ): { value: Expression; receiver: Expression } {
    const result = temporary(
      deleting
        ? { ...at(node), kind: "boolean", value: true }
        : id("undefined", node),
      true,
      true,
    );
    const resultReceiver = temporary(id("undefined", node), true, true);
    const steps: Expression[] = [];
    let base = node;
    while (
      base.kind === "member" ||
      base.kind === "index" ||
      base.kind === "call"
    ) {
      if (base.kind === "call") {
        if (base.callee.kind === "super") break;
        steps.push(base);
        base = base.callee;
      } else {
        if (base.object.kind === "super") break;
        steps.push(base);
        base = base.object;
      }
    }
    const initial = callTarget(base);
    let current = initial.value,
      receiver = initial.receiver;
    let reference: AssignmentReference | undefined;
    const guards: { start: number; base: Expression; span: Span }[] = [];
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step === undefined) throw "CHAIN_STEP_INVARIANT";
      if (reference !== undefined) {
        current = readAssignment(reference);
        receiver = reference.superReceiver ?? reference.base;
      }
      const previous = temporary(current, true);
      if (
        (step.kind === "call" ||
          step.kind === "member" ||
          step.kind === "index") &&
        step.optional
      )
        guards.push({ start: statements.length, base: previous, span: step });
      if (step.kind === "call") {
        current = isDirectEvalCandidate(step)
          ? invokeEvalCandidate(previous, receiver, step.arguments, step)
          : invoke(previous, receiver, step.arguments, step);
        receiver = id("undefined", step);
        reference = undefined;
      } else {
        reference = propertyReference(previous, step);
        current = id("undefined", step);
      }
    }
    const finalValue: Expression =
      reference === undefined
        ? deleting
          ? { ...at(node), kind: "boolean", value: true }
          : current
        : deleting
          ? deleteAssignment(reference, node)
          : readAssignment(reference);
    expression({
      ...at(node),
      kind: "assignment",
      target: result,
      value: finalValue,
    });
    if (!deleting && reference !== undefined) {
      const finalReceiver: Expression =
        reference.superReceiver ?? reference.base;
      expression({
        ...at(node),
        kind: "assignment",
        target: resultReceiver,
        value: finalReceiver,
      });
    }
    for (let i = guards.length - 1; i >= 0; i--) {
      const guard = guards[i];
      if (guard === undefined) throw "CHAIN_GUARD_INVARIANT";
      const consequent: BlockStatement = {
        ...at(guard.span),
        kind: "block",
        statements: statements.splice(guard.start),
      };
      statements.push({
        ...at(guard.span),
        kind: "if",
        test: {
          ...at(guard.span),
          kind: "unary",
          operator: "!",
          operand: logicalTest("??", guard.base, guard.span),
        },
        consequent,
        alternate: undefined,
      });
    }
    return { value: result, receiver: resultReceiver };
  }

  /** Runtime-compiled entries call the operation's fused `OrThrow` helper,
   * which completes the result as `check` does and returns the value. */
  function fusedResultCall(
    name: string,
    args: readonly Expression[],
    span: Span,
  ): Expression | undefined {
    const realm = compactResults ? fusedResultRealm(name) : undefined;
    if (realm === undefined) return undefined;
    const arguments_: Expression[] = realm === 2 ? [id("$errors")] : [];
    for (const argument of args) {
      if (argument === undefined) throw "FUSED_RESULT_ARGUMENT_INVARIANT";
      arguments_.push(argument);
    }
    if (realm === 1) arguments_.push(id("$errors"));
    return runtimeCall(name + "OrThrow", arguments_, span);
  }
  function checkedRuntimeValue(
    name: string,
    args: readonly Expression[],
    span: Span,
  ): Expression {
    const fused = fusedResultCall(name, args, span);
    if (fused !== undefined) return temporary(fused);
    const result = temporary(runtimeCall(name, args, span));
    check(member(result, "error", span), span);
    return member(result, "value", span);
  }
  /** An operation whose result is only an error kind. */
  function checkedRuntimeCompletion(
    name: string,
    args: readonly Expression[],
    span: Span,
  ): void {
    const fused = fusedResultCall(name, args, span);
    if (fused !== undefined) expression(fused);
    else check(temporary(runtimeCall(name, args, span)), span);
  }
  function checkedOperatorValue(
    name: string,
    args: readonly Expression[],
    span: Span,
  ): Expression {
    const arguments_ = args.slice();
    arguments_.push(member(id("$global"), "hooks", span));
    arguments_.push(
      name === "getPrivateObjectValue" || name === "hasPrivateObjectValue"
        ? member(id("$global"), "object", span)
        : id("$errors"),
    );
    return checkedRuntimeValue(name, arguments_, span);
  }
  function arithmeticOperator(operator: string): boolean {
    return [
      "+",
      "-",
      "*",
      "**",
      "/",
      "%",
      "&",
      "|",
      "^",
      "<<",
      ">>",
      ">>>",
    ].includes(operator);
  }
  function scalarBinary(
    operator: string,
    left: Expression,
    right: Expression,
    span: Span,
  ): Expression {
    return { ...at(span), kind: "binary", operator, left, right };
  }
  function scalarBranch(
    test: Expression,
    consequent: Expression,
    alternate: Expression,
    span: Span,
  ): Expression {
    return { ...at(span), kind: "conditional", test, consequent, alternate };
  }
  function categoryOperand(
    value: Expression,
    category: string,
    span: Span,
  ): Expression {
    const tested: Expression = {
      ...at(span),
      kind: "unary",
      operator: "typeof",
      operand: value,
      generalTag: category === "object" ? true : undefined,
    };
    return scalarBinary("===", tested, text(category, span), span);
  }
  function numberOperand(value: Expression, span: Span): Expression {
    return categoryOperand(value, "number", span);
  }
  function scalarNumber(value: number, span: Span): Expression {
    return { ...at(span), kind: "number", value, raw: "" + value };
  }
  function nullOperand(value: Expression, span: Span): Expression {
    return scalarBinary("===", value, { ...at(span), kind: "null" }, span);
  }
  function undefinedOperand(value: Expression, span: Span): Expression {
    return scalarBinary("===", value, id("undefined", span), span);
  }
  function ungroup(node: Expression): Expression {
    let inner = node;
    while (inner.kind === "group") inner = inner.expression;
    return inner;
  }
  function isNullishLiteral(expression: Expression): boolean {
    const node = ungroup(expression);
    return (
      node.kind === "null" ||
      (node.kind === "unary" && node.operator === "void")
    );
  }
  function nullishEquality(subject: Expression, span: Span): Expression {
    const nullish = scalarBinary(
      "||",
      nullOperand(subject, span),
      undefinedOperand(subject, span),
      span,
    );
    if (!htmlDDAObjects) {
      excludesHTMLDDAObjects = true;
      return nullish;
    }
    usesNullishEquality = true;
    return scalarBranch(
      nullish,
      { ...at(span), kind: "boolean", value: true },
      scalarBinary(
        "&&",
        categoryOperand(subject, "object", span),
        objectRuntime("scriptIsHTMLDDA", [subject], span),
        span,
      ),
      span,
    );
  }
  function negate(value: Expression, span: Span): Expression {
    return { ...at(span), kind: "unary", operator: "!", operand: value };
  }
  function looseEquality(
    left: Expression,
    right: Expression,
    span: Span,
  ): Expression {
    usesLooseEqualityFallback = true;
    return runtimeCall(
      "looselyEqualOrThrow",
      [left, right, member(id("$global"), "hooks", span), id("$errors")],
      span,
    );
  }
  function literalComparison(
    node: Expression & { readonly kind: "binary" },
  ): Expression | undefined {
    const equal = node.operator === "===" || node.operator === "==";
    const strict = node.operator === "===" || node.operator === "!==";
    const left = ungroup(node.left),
      right = ungroup(node.right);
    if (strict) {
      const literal = left.kind === "string" ? left : right;
      const tested = literal === left ? right : left;
      if (
        literal.kind === "string" &&
        tested.kind === "unary" &&
        tested.operator === "typeof" &&
        (literal.value === "number" ||
          literal.value === "boolean" ||
          literal.value === "string")
      ) {
        const operand = ungroup(tested.operand);
        const subject =
          operand.kind === "identifier"
            ? identifierValue(operand.name, operand, true)
            : value(operand);
        const matches = categoryOperand(subject, literal.value, node);
        return equal ? matches : negate(matches, node);
      }
    }
    const leftLiteral = isNullishLiteral(left);
    const rightLiteral = isNullishLiteral(right);
    if (leftLiteral || rightLiteral) {
      // Evaluating void still evaluates its operand in source order.
      const first = left.kind === "null" ? left : temporary(value(left), true);
      const second =
        right.kind === "null" ? right : temporary(value(right), true);
      const subject = leftLiteral ? second : first;
      const literal = leftLiteral ? left : right;
      const matches = strict
        ? literal.kind === "null"
          ? nullOperand(subject, node)
          : undefinedOperand(subject, node)
        : nullishEquality(subject, node);
      return equal ? matches : negate(matches, node);
    }
    if (strict) return undefined;
    const leftUndefined =
      left.kind === "identifier" && left.name === "undefined";
    const rightUndefined =
      right.kind === "identifier" && right.name === "undefined";
    if (!leftUndefined && !rightUndefined) return undefined;
    const first = temporary(value(left), true);
    const second = temporary(value(right), true);
    const matches = scalarBranch(
      undefinedOperand(leftUndefined ? first : second, node),
      nullishEquality(leftUndefined ? second : first, node),
      looseEquality(first, second, node),
      node,
    );
    return equal ? matches : negate(matches, node);
  }
  function bothNumbers(
    left: Expression,
    right: Expression,
    span: Span,
  ): Expression {
    return scalarBinary(
      "&&",
      numberOperand(left, span),
      numberOperand(right, span),
      span,
    );
  }
  function immediateNumberOperand(value: Expression, span: Span): Expression {
    return scalarBinary(
      "||",
      scalarBinary(
        "||",
        categoryOperand(value, "boolean", span),
        nullOperand(value, span),
        span,
      ),
      undefinedOperand(value, span),
      span,
    );
  }
  function primitiveNumberOperand(value: Expression, span: Span): Expression {
    return scalarBinary(
      "||",
      numberOperand(value, span),
      immediateNumberOperand(value, span),
      span,
    );
  }
  /** These primitive categories have no observable ToNumber effects. */
  function primitiveNumber(value: Expression, span: Span): Expression {
    const zero = scalarNumber(0, span);
    return scalarBranch(
      numberOperand(value, span),
      value,
      scalarBranch(
        categoryOperand(value, "boolean", span),
        scalarBranch(value, scalarNumber(1, span), zero, span),
        scalarBranch(nullOperand(value, span), zero, id("NaN", span), span),
        span,
      ),
      span,
    );
  }
  function truthy(value: Expression, span: Span): Expression {
    const fallback = objectRuntime("scriptBoolean", [value], span);
    if (compactResults) return fallback;
    const falsy: Expression = { ...at(span), kind: "boolean", value: false };
    return scalarBranch(
      categoryOperand(value, "boolean", span),
      value,
      scalarBranch(
        numberOperand(value, span),
        scalarBinary(
          "&&",
          scalarBinary("!==", value, scalarNumber(0, span), span),
          scalarBinary("===", value, value, span),
          span,
        ),
        scalarBranch(
          scalarBinary(
            "||",
            nullOperand(value, span),
            undefinedOperand(value, span),
            span,
          ),
          falsy,
          fallback,
          span,
        ),
        span,
      ),
      span,
    );
  }
  function conditionValue(input: Expression, span: Span): Expression {
    const node = ungroup(input);
    if (
      !compactResults &&
      (node.kind === "boolean" ||
        (node.kind === "unary" && node.operator === "!") ||
        (node.kind === "binary" &&
          [
            "==",
            "!=",
            "===",
            "!==",
            "<",
            "<=",
            ">",
            ">=",
            "in",
            "instanceof",
          ].includes(node.operator)))
    )
      return value(node);
    return truthy(temporary(value(input), true), span);
  }
  function strictEqual(
    left: Expression,
    right: Expression,
    span: Span,
  ): Expression {
    const fallback = runtimeCall("scriptStrictEqual", [left, right], span);
    if (compactResults) return fallback;
    const different: Expression = {
      ...at(span),
      kind: "boolean",
      value: false,
    };
    const matched = scalarBinary("===", left, right, span);
    return scalarBranch(
      numberOperand(left, span),
      scalarBranch(numberOperand(right, span), matched, different, span),
      scalarBranch(
        categoryOperand(left, "boolean", span),
        scalarBranch(
          categoryOperand(right, "boolean", span),
          matched,
          different,
          span,
        ),
        scalarBranch(
          nullOperand(left, span),
          nullOperand(right, span),
          scalarBranch(
            undefinedOperand(left, span),
            undefinedOperand(right, span),
            fallback,
            span,
          ),
          span,
        ),
        span,
      ),
      span,
    );
  }
  /** Already evaluated primitive pairs can bypass ToPrimitive and overload
   * dispatch. String concatenation still uses the backend's string storage. */
  function binaryOperation(
    operator: string,
    left: Expression,
    right: Expression,
    span: Span,
  ): Expression {
    const args = [text(operator, span), left, right];
    if (compactResults || operator === "**")
      return checkedOperatorValue("binaryObjectValueOperation", args, span);
    if (
      operator === "<" ||
      operator === "<=" ||
      operator === ">" ||
      operator === ">="
    ) {
      usesRelationalFallback = true;
      const immediatePair = scalarBinary(
        "&&",
        primitiveNumberOperand(left, span),
        primitiveNumberOperand(right, span),
        span,
      );
      const fallback = scalarBinary(
        "===",
        runtimeCall(
          "binaryObjectValueOperationOrThrow",
          [
            text(operator, span),
            left,
            right,
            member(id("$global"), "hooks", span),
            id("$errors"),
          ],
          span,
        ),
        { ...at(span), kind: "boolean", value: true },
        span,
      );
      return scalarBranch(
        bothNumbers(left, right, span),
        scalarBinary(operator, left, right, span),
        scalarBranch(
          immediatePair,
          scalarBinary(
            operator,
            primitiveNumber(left, span),
            primitiveNumber(right, span),
            span,
          ),
          fallback,
          span,
        ),
        span,
      );
    }
    const result = temporary(id("undefined", span), true, true);
    function assigned(value: Expression): Statement {
      return {
        ...at(span),
        kind: "expression",
        expression: { ...at(span), kind: "assignment", target: result, value },
      };
    }
    const start = statements.length;
    const general = checkedOperatorValue(
      "binaryObjectValueOperation",
      args,
      span,
    );
    statements.push(assigned(general));
    const slow: BlockStatement = {
      ...at(span),
      kind: "block",
      statements: statements.splice(start),
    };
    const primitive: Statement = {
      ...at(span),
      kind: "if",
      test: scalarBinary(
        "&&",
        primitiveNumberOperand(left, span),
        primitiveNumberOperand(right, span),
        span,
      ),
      consequent: assigned(
        scalarBinary(
          operator,
          primitiveNumber(left, span),
          primitiveNumber(right, span),
          span,
        ),
      ),
      alternate: slow,
    };
    const nonNumeric: Statement =
      operator === "+"
        ? {
            ...at(span),
            kind: "if",
            test: scalarBinary(
              "&&",
              categoryOperand(left, "string", span),
              categoryOperand(right, "string", span),
              span,
            ),
            consequent: assigned(scalarBinary("+", left, right, span)),
            alternate: primitive,
          }
        : primitive;
    statements.push({
      ...at(span),
      kind: "if",
      test: scalarBinary(
        "&&",
        numberOperand(left, span),
        numberOperand(right, span),
        span,
      ),
      consequent: assigned(scalarBinary(operator, left, right, span)),
      alternate: nonNumeric,
    });
    return result;
  }
  function unaryOperation(
    operator: string,
    operand: Expression,
    span: Span,
  ): Expression {
    const args = [text(operator, span), operand];
    if (compactResults)
      return checkedOperatorValue("unaryObjectValueOperation", args, span);
    const result = temporary(id("undefined", span), true, true);
    const start = statements.length;
    const fallback = checkedOperatorValue(
      "unaryObjectValueOperation",
      args,
      span,
    );
    storeSlot(result, fallback, span);
    const alternate: BlockStatement = {
      ...at(span),
      kind: "block",
      statements: statements.splice(start),
    };
    const numeric: Expression = {
      ...at(span),
      kind: "unary",
      operator,
      operand: primitiveNumber(operand, span),
    };
    statements.push({
      ...at(span),
      kind: "if",
      test: primitiveNumberOperand(operand, span),
      consequent: {
        ...at(span),
        kind: "expression",
        expression: {
          ...at(span),
          kind: "assignment",
          target: result,
          value: numeric,
        },
      },
      alternate,
    });
    return result;
  }
  function updateAssignment(
    target: AssignmentReference,
    previous: Expression,
    node: Expression & { readonly kind: "update" },
  ): Expression {
    function genericUpdate(): Expression {
      const result = temporary(
        runtimeCall(
          "updateObjectValue",
          [
            text(node.operator, node),
            previous,
            member(id("$global"), "hooks", node),
            id("$errors"),
          ],
          node,
        ),
      );
      check(member(result, "error", node), node);
      return result;
    }
    if (compactResults) {
      const result = genericUpdate();
      const assigned = temporary(member(result, "value", node), true);
      writeAssignment(target, assigned);
      return node.prefix ? assigned : member(result, "previous", node);
    }
    const assigned = temporary(id("undefined", node), true, true);
    const old = node.prefix
      ? undefined
      : temporary(id("undefined", node), true, true);
    const start = statements.length;
    const generic = genericUpdate();
    storeSlot(assigned, member(generic, "value", node), node);
    if (old !== undefined)
      storeSlot(old, member(generic, "previous", node), node);
    const slow: BlockStatement = {
      ...at(node),
      kind: "block",
      statements: statements.splice(start),
    };
    function updateNumber(numeric: Expression): BlockStatement {
      const value = temporary(numeric, false, false, named("number"));
      storeSlot(
        assigned,
        scalarBinary(
          "+",
          value,
          scalarNumber(node.operator === "++" ? 1 : -1, node),
          node,
        ),
        node,
      );
      if (old !== undefined) storeSlot(old, value, node);
      return {
        ...at(node),
        kind: "block",
        statements: statements.splice(start),
      };
    }
    const numeric = updateNumber(previous);
    const converted = updateNumber(primitiveNumber(previous, node));
    statements.push({
      ...at(node),
      kind: "if",
      test: numberOperand(previous, node),
      consequent: numeric,
      alternate: {
        ...at(node),
        kind: "if",
        test: immediateNumberOperand(previous, node),
        consequent: converted,
        alternate: slow,
      },
    });
    writeAssignment(target, assigned);
    return old ?? assigned;
  }
  function logicalTest(
    operator: string,
    result: Expression,
    span: Span,
  ): Expression {
    if (operator === "&&") return truthy(result, span);
    if (operator === "||")
      return {
        ...at(span),
        kind: "unary",
        operator: "!",
        operand: truthy(result, span),
      };
    const isNull: Expression = {
      ...at(span),
      kind: "binary",
      operator: "===",
      left: result,
      right: { ...at(span), kind: "null" },
    };
    const isUndefined: Expression = {
      ...at(span),
      kind: "binary",
      operator: "===",
      left: result,
      right: id("undefined", span),
    };
    return {
      ...at(span),
      kind: "binary",
      operator: "||",
      left: isNull,
      right: isUndefined,
    };
  }
  function finish(
    error: Expression,
    result: Expression,
    span: Span,
  ): Expression {
    return {
      ...at(span),
      kind: "call",
      callee: id("finishScriptExecution"),
      arguments: [id("$errors"), error, result],
      typeArguments: [],
    };
  }
  function retainedSource(span: Span): Expression {
    return sourceText === undefined
      ? id("undefined", span)
      : text(sourceText.slice(span.start, span.end), span);
  }
  function retainSource(fn: Expression, span: Span): Expression {
    return sourceText === undefined
      ? fn
      : runtimeCall("retainFunctionSource", [fn, retainedSource(span)], span);
  }
  /** The first executable contracts use the built-in primitive categories. */
  function contract(type: TypeNode | undefined): number {
    if (!checkContracts || type === undefined) return 0;
    if (type.kind === "group") return contract(type.type);
    if (type.kind === "named" && (type.arguments?.length ?? 0) === 0)
      return primitiveContractBit(type.name);
    if (type.kind !== "union") return 0;
    let mask = 0;
    for (const member of type.members) {
      const bit = contract(member);
      if (bit === 0) return 0;
      mask |= bit;
    }
    return mask;
  }
  function recordType(type: TypeNode): TypeNode | undefined {
    if (type.kind === "group") return recordType(type.type);
    if (type.kind === "object") return type;
    if (type.kind !== "named" || (type.arguments?.length ?? 0) !== 0)
      return undefined;
    const named = recordTypes.get(type.name);
    return named?.kind === "object" ? named : undefined;
  }
  function recordContract(
    value: Expression,
    annotation: TypeNode | undefined,
    span: Span,
  ): Expression | undefined {
    if (!checkContracts || annotation === undefined) return undefined;
    const root = recordType(annotation);
    if (root === undefined) return undefined;
    const types: Expression[] = [];
    const seen = new Map<TypeNode, number>();
    function index(value: number): Expression {
      return { ...at(span), kind: "number", value, raw: String(value) };
    }
    function flag(value: boolean): Expression {
      return { ...at(span), kind: "boolean", value };
    }
    function array(elements: readonly Expression[]): Expression {
      return { ...at(span), kind: "array", elements };
    }
    function rule(type: TypeNode): number | undefined {
      if (type.kind === "group") return rule(type.type);
      const resolved = recordType(type);
      if (resolved !== undefined && resolved !== type) return rule(resolved);
      const known = seen.get(type);
      if (known !== undefined) return known;
      const id_ = types.length;
      seen.set(type, id_);
      types.push(object(["kind"], [text("unknown", span)], span));
      let entry: Expression;
      if (
        type.kind === "object" &&
        type.call === undefined &&
        type.construct === undefined
      ) {
        const fields: Expression[] = [];
        for (const field of type.properties) {
          if (field === undefined || field.computed || field.method)
            return undefined;
          const fieldType = rule(field.type);
          if (fieldType === undefined) return undefined;
          fields.push(
            object(
              ["name", "value", "required", "readonly"],
              [
                text(field.name, span),
                index(fieldType),
                flag(!field.optional),
                flag(field.readonly),
              ],
              span,
            ),
          );
        }
        const key = type.indexSignature;
        if (key !== undefined) {
          const keyType = key.keyType;
          if (keyType.kind !== "named" || keyType.name !== "string")
            return undefined;
        }
        const valueType = key === undefined ? -1 : rule(key.valueType);
        if (valueType === undefined) return undefined;
        entry = object(
          ["kind", "stringIndex", "readonlyIndex", "fields"],
          [
            text("object", span),
            index(valueType),
            flag(key?.readonly === true),
            array(fields),
          ],
          span,
        );
      } else if (type.kind === "array") {
        const element = rule(type.element);
        if (element === undefined) return undefined;
        entry = object(
          ["kind", "element", "readonly"],
          [
            text("array-elements", span),
            index(element),
            flag(type.readonly === true),
          ],
          span,
        );
      } else if (type.kind === "union") {
        const members: Expression[] = [];
        for (const part of type.members) {
          if (part === undefined) return undefined;
          const member = rule(part);
          if (member === undefined) return undefined;
          members.push(index(member));
        }
        entry = object(
          ["kind", "members"],
          [text("union", span), array(members)],
          span,
        );
      } else if (
        type.kind === "named" &&
        (type.arguments?.length ?? 0) === 0 &&
        [
          "number",
          "string",
          "boolean",
          "undefined",
          "null",
          "bigint",
          "unknown",
          "never",
        ].includes(type.name)
      ) {
        entry = object(["kind"], [text(type.name, span)], span);
      } else return undefined;
      types[id_] = entry;
      return id_;
    }
    const first = rule(root);
    if (first === undefined) return undefined;
    const schema = object(
      ["types", "root"],
      [array(types), index(first)],
      span,
    );
    usesPrimitiveContracts = true;
    return runtimeCall(
      "projectPropertyContract",
      [value, schema, id("$errors"), flag(true)],
      span,
    );
  }
  function contractValue(mask: number, span: Span): Expression {
    usesPrimitiveContracts = true;
    return { ...at(span), kind: "number", value: mask, raw: String(mask) };
  }
  function checkedContract(
    value: Expression,
    mask: number,
    span: Span,
  ): Expression {
    return runtimeCall(
      "checkPrimitiveContract",
      [id("$errors"), value, contractValue(mask, span)],
      span,
    );
  }
  function callable(
    parameters: readonly Parameter[],
    body: Expression | BlockStatement,
    arrow: boolean,
    span: Span,
    options: CallableOptions = {},
  ): Expression {
    const derived = options.derived ?? false;
    const generator = options.generator ?? false;
    const suspending = generator || (options.async ?? false);
    const resultContract = suspending ? 0 : contract(options.resultType);
    const outerSuspensionInput = suspensionInput;
    const outerAsyncGeneratorBody = asyncGeneratorBody;
    const outerDisposalScope = disposalScope;
    const outerAnnexVariableRecord = annexVariableRecord;
    annexVariableRecord = undefined;
    disposalScope = undefined;
    const asyncGenerator = generator && (options.async ?? false);
    asyncGeneratorBody = asyncGenerator;
    const annotation = options.resultType;
    const suspendedArguments =
      annotation?.kind === "named" &&
      annotation.name ===
        (generator
          ? asyncGenerator
            ? "AsyncGenerator"
            : "Generator"
          : "Promise")
        ? annotation.arguments
        : undefined;
    const outerYieldContract = yieldContract;
    yieldContract = generator ? contract(suspendedArguments?.[0]) : 0;
    const completionContract = contract(
      suspendedArguments?.[generator ? 1 : 0],
    );
    const resumeContract = generator ? contract(suspendedArguments?.[2]) : 0;
    const inputName = "$resumeValue" + serial++;
    const kindName = "$resumeKind" + serial++;
    suspensionInput = suspending ? inputName : undefined;
    const method = options.method ?? false,
      raw = options.raw ?? false,
      inferredName = options.inferredName,
      codeStrict = options.codeStrict ?? strict,
      functionName = options.functionName,
      homeObject = options.homeObject;
    const outerTailEnds = tailEnds;
    const localTailEnds = new Map<number, number>();
    if (!raw && !suspending && resultContract === 0)
      for (const candidate of collectTailCalls(body, { strict: codeStrict })) {
        if (candidate === undefined) throw "TAIL_POSITION_CALL_INVARIANT";
        if (numericCallAt(candidate) === undefined)
          localTailEnds.set(candidate.start, candidate.end);
      }
    const tailEnabled = localTailEnds.size !== 0;
    if (tailEnabled) usesTailCalls = true;
    tailEnds = localTailEnds;
    const numericBody =
      !compactResults &&
      !raw &&
      !suspending &&
      !tailEnabled &&
      !derived &&
      !options.packed &&
      !options.classFieldInitializer &&
      !options.baseConstructor &&
      options.resultType === undefined
        ? numericLoopImplementation(parameters, body, span)
        : undefined;
    const numericImplementation =
      numericBody === undefined ? undefined : temporary(numericBody);
    const hasArguments = !arrow && observesArguments(span);
    const hasRest = parameters.some((parameter) => parameter?.rest);
    const nativeEntry =
      nativeScriptCalls &&
      !compactResults &&
      !raw &&
      !derived &&
      !suspending &&
      !options.packed &&
      !tailEnabled &&
      resultContract === 0;
    const legacyNativeEntry = nativeEntry && !codeStrict && !arrow && !method;
    const materializesArguments = nativeEntry && (hasArguments || hasRest);
    const nativeName = nativeEntry
      ? temporary(
          runtimeCall(
            "propertyFunctionName",
            [functionName ?? text("", span)],
            span,
          ),
        )
      : undefined;
    let nativeArgumentReader: Expression | undefined;
    if (legacyNativeEntry) {
      const readerParameters: Parameter[] = [];
      const readerArguments: Expression[] = [];
      for (const name of ["$index", "$count", "$registers", "$overflow"]) {
        if (name === undefined) throw "SCRIPT_ARGUMENT_READER_INVARIANT";
        readerParameters.push({ ...at(span), name, type: named("number") });
        readerArguments.push(id(name, span));
      }
      nativeArgumentReader = temporary({
        ...at(span),
        kind: "arrow",
        parameters: readerParameters,
        returnType: named("unknown"),
        body: {
          ...at(span),
          kind: "call",
          scriptArgument: "load-frame",
          callee: id("sourceArgumentFromFrame", span),
          arguments: readerArguments,
        },
      });
    }
    if (nativeEntry) usesNativeScriptCalls = true;
    const wideRegister = codeStrict && parameters.length > 2;
    const register =
      !nativeEntry &&
      !compactResults &&
      !raw &&
      !suspending &&
      !options.packed &&
      !tailEnabled &&
      !hasArguments &&
      resultContract === 0 &&
      numericImplementation === undefined &&
      parameters.length <= (wideRegister ? 6 : 2) &&
      !hasRest;
    const registerCount = register ? "$count" + serial++ : "",
      registerFirst = register ? "$first" + serial++ : "",
      registerSecond = register ? "$second" + serial++ : "";
    const registerArguments = [registerFirst, registerSecond];
    if (register) {
      if (wideRegister) {
        usesWideRegisterCalls = true;
        for (let index = 2; index < 6; index++)
          registerArguments.push("$arg" + serial++);
      } else usesRegisterCalls = true;
    }
    // Capture the environment at function creation, even when a loop advances
    // its current environment through a mutable generated variable.
    const capturedScope = temporary(scope);
    const start = statements.length;
    const outerScope = scope,
      outerLexical = lexical,
      outerReceiver = receiver;
    const outerVariableScope = variableScope,
      outerCatchRecords = catchRecords,
      outerInheritedCatches = inheritedCatches;
    catchRecords = [];
    inheritedCatches = id("undefined");
    let evalBody = false,
      evalParameters = false;
    for (const site of directEvalOwners) {
      if (site === undefined) throw "DIRECT_EVAL_OWNER_INVARIANT";
      const owner = site.owner;
      if (
        owner === undefined ||
        owner.start !== span.start ||
        owner.end !== span.end
      )
        continue;
      if (site.parameters) evalParameters = true;
      else evalBody = true;
    }
    const outerStrict = strict;
    const outerHome = home;
    const outerInFunction = inFunction;
    const outerFieldInitializer = inClassFieldInitializer;
    if (!arrow)
      inClassFieldInitializer = options.classFieldInitializer ?? false;
    if (!arrow) inFunction = true;
    const outerNewTarget = newTarget;
    const outerDerivedContext = derivedContext,
      outerConstructor = activeConstructor;
    if (!arrow) home = homeObject;
    strict = codeStrict;
    functionDepth++;
    const receiverName = "$receiver" + serial++,
      argsName = "$args" + serial++,
      calleeName = "$callee" + serial++,
      newTargetName = "$newTarget" + serial++,
      incomingArguments = materializesArguments
        ? "$incoming" + serial++
        : argsName;
    const list: TypeNode = {
      ...at(span),
      kind: "array",
      readonly: true,
      element: named("unknown"),
    };
    function hasList(): Expression {
      return {
        ...at(span),
        kind: "binary",
        operator: "!==",
        left: id(incomingArguments, span),
        right: id("undefined", span),
      };
    }
    function nativeArgument(index: Expression, site: Span): Expression {
      return {
        ...at(site),
        kind: "call",
        scriptArgument: "index",
        callee: id("sourceArgument", site),
        arguments: [index],
      };
    }
    function nativeArgumentCount(site: Span): Expression {
      return {
        ...at(site),
        kind: "call",
        scriptArgument: "count",
        callee: id("sourceArgumentCount", site),
        arguments: [],
      };
    }
    function argumentAt(index: Expression, site: Span): Expression {
      const fromList: Expression = {
        ...at(site),
        kind: "index",
        object: id(argsName, site),
        index,
      };
      return nativeEntry && !materializesArguments
        ? {
            ...at(site),
            kind: "conditional",
            test: hasList(),
            consequent: fromList,
            alternate: nativeArgument(index, site),
          }
        : fromList;
    }
    if (materializesArguments) {
      statements.push({
        ...at(span),
        kind: "variable",
        mode: "let",
        exported: false,
        declarations: [
          { ...at(span), name: argsName, type: list, initializer: undefined },
        ],
      });
      const begin = statements.length;
      const actual = temporary(
        { ...at(span), kind: "array", elements: [] },
        false,
        false,
        { ...at(span), kind: "array", element: named("unknown") },
      );
      const count = temporary(nativeArgumentCount(span));
      const index = temporary(scalarNumber(0, span), false, true);
      const loopStart = statements.length;
      expression({
        ...at(span),
        kind: "call",
        callee: member(actual, "push", span),
        arguments: [nativeArgument(index, span)],
      });
      expression({
        ...at(span),
        kind: "assignment",
        target: index,
        value: {
          ...at(span),
          kind: "binary",
          operator: "+",
          left: index,
          right: scalarNumber(1, span),
        },
      });
      const collectActuals: BlockStatement = {
        ...at(span),
        kind: "block",
        statements: statements.splice(loopStart),
      };
      statements.push({
        ...at(span),
        kind: "while",
        test: {
          ...at(span),
          kind: "binary",
          operator: "<",
          left: index,
          right: count,
        },
        body: collectActuals,
      });
      expression({
        ...at(span),
        kind: "assignment",
        target: id(argsName, span),
        value: actual,
      });
      const collect: BlockStatement = {
        ...at(span),
        kind: "block",
        statements: statements.splice(begin),
      };
      statements.push({
        ...at(span),
        kind: "if",
        test: hasList(),
        consequent: {
          ...at(span),
          kind: "expression",
          expression: {
            ...at(span),
            kind: "assignment",
            target: id(argsName, span),
            value: id(incomingArguments, span),
          },
        },
        alternate: collect,
      });
    }
    if (numericImplementation !== undefined) {
      const operands: Expression[] = [];
      let guard: Expression | undefined;
      for (let i = 0; i < parameters.length; i++) {
        const argument = temporary(
          argumentAt(scalarNumber(i, span), span),
          true,
        );
        operands.push(argument);
        const test = numberOperand(argument, span);
        guard =
          guard === undefined
            ? test
            : {
                ...at(span),
                kind: "binary",
                operator: "&&",
                left: guard,
                right: test,
              };
      }
      if (guard === undefined) throw "SCRIPT_NUMERIC_PARAMETERS_INVARIANT";
      statements.push({
        ...at(span),
        kind: "if",
        test: guard,
        consequent: {
          ...at(span),
          kind: "return",
          expression: {
            ...at(span),
            kind: "call",
            callee: numericImplementation,
            arguments: operands,
          },
        },
        alternate: undefined,
      });
    }
    const packedName = options.packed ? "$packed" + serial++ : undefined;
    if (packedName !== undefined) {
      const packed = id(packedName, span);
      const input = (
        name: string,
        initializer: Expression,
        type: TypeNode,
      ): void => {
        statements.push({
          ...at(span),
          kind: "variable",
          mode: "const",
          exported: false,
          declarations: [{ ...at(span), name, type, initializer }],
        });
      };
      input(
        calleeName,
        {
          ...at(span),
          kind: "index",
          object: packed,
          index: { ...at(span), kind: "number", value: 0, raw: "0" },
        },
        named("unknown"),
      );
      input(
        newTargetName,
        {
          ...at(span),
          kind: "index",
          object: packed,
          index: { ...at(span), kind: "number", value: 1, raw: "1" },
        },
        named("unknown"),
      );
      input(
        argsName,
        { ...at(span), kind: "array", elements: [] },
        {
          ...at(span),
          kind: "array",
          element: named("unknown"),
          readonly: false,
        },
      );
      const index = temporary(
        { ...at(span), kind: "number", value: 2, raw: "2" },
        false,
        true,
      );
      const loopStart = statements.length;
      expression({
        ...at(span),
        kind: "call",
        callee: member(id(argsName, span), "push", span),
        arguments: [{ ...at(span), kind: "index", object: packed, index }],
        typeArguments: [],
      });
      expression({
        ...at(span),
        kind: "assignment",
        target: index,
        value: {
          ...at(span),
          kind: "binary",
          operator: "+",
          left: index,
          right: { ...at(span), kind: "number", value: 1, raw: "1" },
        },
      });
      const loopBody: BlockStatement = {
        ...at(span),
        kind: "block",
        statements: statements.splice(loopStart),
      };
      statements.push({
        ...at(span),
        kind: "while",
        test: {
          ...at(span),
          kind: "binary",
          operator: "<",
          left: index,
          right: member(packed, "length", span),
        },
        body: loopBody,
      });
    }
    if (!arrow) {
      derivedContext = derived ? id(receiverName, span) : undefined;
      activeConstructor = derived ? id(calleeName, span) : undefined;
      newTarget = generator
        ? id("undefined")
        : derived
          ? member(
              member(id(receiverName, span), "newTarget", span),
              "value",
              span,
            )
          : !raw || options.baseConstructor
            ? id(newTargetName, span)
            : id("undefined", span);
    }
    const functionDeclarations = collectScriptDeclarations({
      ...at(body),
      imports: [],
      statements: body.kind === "block" ? body.statements : [],
    });
    const lexicalSlots =
      !raw && body.kind === "block" ? reserveLexicalSlots(body.statements) : [];
    const retainedLexicals =
      lexicalSlots.length === 0
        ? functionDeclarations.lexical
        : functionDeclarations.lexical.filter(
            (declaration) =>
              declaration !== undefined &&
              frameLexicalBinding(declaration) === undefined,
          );
    const hoistedSlots: number[] = [];
    const hoistedNames = new Set<string>();
    if (
      !raw &&
      !options.packed &&
      !hasArguments &&
      !parameters.some(
        (parameter) =>
          parameter !== undefined && parameterHasExpressions(parameter),
      )
    )
      for (const binding of functionVariables.get(span.end) ?? []) {
        if (binding === undefined) throw "SCRIPT_VARIABLE_SLOT_INVARIANT";
        const variable = boundBindings[binding];
        if (variable === undefined) throw "SCRIPT_VARIABLE_SLOT_INVARIANT";
        hoistedSlots.push(binding);
        hoistedNames.add(variable.name);
        localSlots.set(
          binding,
          temporary(id("undefined", variable.node), true, true),
        );
      }
    // Mapped arguments, dynamic lookup and var aliases need the shared
    // parameter record. Other formals have slots, including the bindings
    // observed by defaults that run before the parameter list finishes.
    const directParameters =
      !raw &&
      !options.packed &&
      !hasArguments &&
      parameters.every(
        (parameter) =>
          parameter !== undefined &&
          parameter.type === undefined &&
          parameterIdentifiers(parameter).every(
            (identifier) =>
              identifier !== undefined &&
              localBindingDeclarations.has(identifier.start) &&
              !functionDeclarations.variables.includes(identifier.name) &&
              !annexCopies.some(
                (copy) =>
                  copy !== undefined &&
                  copy.owner?.start === span.start &&
                  copy.owner?.end === span.end &&
                  copy.name === identifier.name,
              ),
          ),
      );
    const directSimpleParameters =
      directParameters &&
      parameters.every(
        (parameter) => parameter !== undefined && isSimpleParameter(parameter),
      );
    // Sloppy functions that never read their receiver skip
    // OrdinaryCallBindThis's conversion: wrapping a primitive receiver has no
    // other effect, and only `this`, `super` or a direct eval could see it.
    // AOT and runtime-compiled entries share the rule.
    const unobservedReceiver =
      !suspending &&
      !derived &&
      !raw &&
      !options.packed &&
      !evalBody &&
      !evalParameters &&
      !receiverObservers.has(span.end) &&
      // argumentsOwners also attributes every direct eval (any depth of
      // arrows, parameters or body) to the receiver-owning function: a
      // second, conservative guard; extra `arguments` uses only keep it.
      !observesArguments(span);
    if (!arrow)
      receiver =
        strict || unobservedReceiver
          ? id(receiverName, span)
          : // An ordinary object receiver is its own ToObject; only nullish
            // and primitive receivers need the sloppy conversion.
            temporary(
              scalarBranch(
                scalarBinary(
                  "!==",
                  runtimeCall(
                    "viewObjectValue",
                    [
                      id(receiverName, span),
                      member(id("$errors"), "objectPrototype", span),
                    ],
                    span,
                  ),
                  id("undefined", span),
                  span,
                ),
                id(receiverName, span),
                checkedRuntimeValue(
                  "sloppyCallReceiver",
                  [
                    id(receiverName, span),
                    member(id("$global"), "thisValue", span),
                    member(id("$global"), "hooks", span),
                    id("$errors"),
                  ],
                  span,
                ),
                span,
              ),
              true,
            );

    const parameterEval =
      !strict &&
      evalParameters &&
      parameters.some((p) => p !== undefined && parameterHasExpressions(p));
    let parameterParent = capturedScope;
    if (parameterEval) {
      const variables = temporary(
        call("createDeclarativeEnvironment", [id("undefined")], span),
      );
      parameterParent = temporary(
        call("createDeclarativeScope", [capturedScope, variables], span),
      );
    }
    // A function with no parameters, declarations, annex B copies, arguments
    // object or direct eval binds nothing in its own environments, so
    // identifier resolution and every closure it creates see the captured
    // scope unchanged; AOT and runtime-compiled entries skip creating them.
    const bindsNothing =
      !raw &&
      !options.packed &&
      !suspending &&
      !derived &&
      !options.classFieldInitializer &&
      !options.baseConstructor &&
      (parameters.length === 0 || directParameters) &&
      !evalBody &&
      !evalParameters &&
      !hasArguments &&
      functionDeclarations.variables.every((name) => hoistedNames.has(name)) &&
      functionDeclarations.functions.every(
        (declaration) =>
          declaration !== undefined && hoistedNames.has(declaration.name),
      ) &&
      retainedLexicals.length === 0 &&
      !annexCopies.some((copy) => {
        const owner = copy.owner;
        return (
          owner !== undefined &&
          owner.start === span.start &&
          owner.end === span.end &&
          !hoistedNames.has(copy.name)
        );
      });
    const parameterRecord = bindsNothing
      ? id("undefined")
      : temporary(
          call("createDeclarativeEnvironment", [id("undefined")], span),
        );
    scope = bindsNothing
      ? capturedScope
      : temporary(
          call(
            "createDeclarativeScope",
            [parameterParent, parameterRecord],
            span,
          ),
        );
    lexical = parameterRecord;
    variableScope = parameterEval ? parameterParent : scope;
    let separate = false;
    let simple = true;
    const created = new Set<string>(),
      initializedParameters = new Set<string>();
    const parameterNames: Expression[] = [];
    const parameterSlots: number[] = [];
    for (const parameter of parameters) {
      if (parameter === undefined) throw "SCRIPT_PARAMETER_INVARIANT";
      if (directParameters) {
        if (!directSimpleParameters)
          for (const identifier of parameterIdentifiers(parameter)) {
            if (identifier === undefined)
              throw "SCRIPT_PARAMETER_SLOT_INVARIANT";
            const binding = localBindingDeclarations.get(identifier.start);
            if (binding === undefined) throw "SCRIPT_PARAMETER_SLOT_INVARIANT";
            reserveLexicalSlot(binding, identifier, true);
            parameterSlots.push(binding);
          }
        if (parameterHasExpressions(parameter)) separate = true;
        continue;
      }
      if (parameter.kind !== "pattern-parameter" && !parameter.rest) {
        const mask = contract(parameter.type);
        if (mask !== 0)
          bindingContracts.set(
            parameter.start,
            parameter.optional
              ? mask | primitiveContractBit("undefined")
              : mask,
          );
      }
      for (const identifier of parameterIdentifiers(parameter)) {
        if (identifier === undefined)
          throw "SCRIPT_PARAMETER_IDENTIFIER_INVARIANT";
        parameterNames.push(text(identifier.name, identifier));
        if (!created.has(identifier.name)) {
          created.add(identifier.name);
          expression(
            call(
              "createMutableBinding",
              [
                parameterRecord,
                text(identifier.name, identifier),
                { ...at(identifier), kind: "boolean", value: false },
              ],
              identifier,
            ),
          );
        }
      }
      if (!isSimpleParameter(parameter)) simple = false;
      if (parameterHasExpressions(parameter)) separate = true;
    }
    if (hasArguments) {
      const argumentPlan = object(
        [
          "arrow",
          "strict",
          "simple",
          "parameterExpressions",
          "parameters",
          "functions",
          "lexical",
        ],
        [
          { ...at(span), kind: "boolean", value: false },
          { ...at(span), kind: "boolean", value: strict },
          { ...at(span), kind: "boolean", value: simple },
          { ...at(span), kind: "boolean", value: separate },
          {
            ...at(span),
            kind: "array",
            elements: parameterNames,
          },
          {
            ...at(span),
            kind: "array",
            elements: functionDeclarations.functions.map((f) =>
              text(f.name, f),
            ),
          },
          {
            ...at(span),
            kind: "array",
            elements: functionDeclarations.lexical.map((d) => text(d.name, d)),
          },
        ],
        span,
      );
      expression(
        runtimeCall(
          "instantiateScriptArguments",
          [
            parameterRecord,
            id(argsName, span),
            raw ? id("undefined") : id(calleeName, span),
            argumentPlan,
            id("$errors"),
            member(id("$global"), "hooks", span),
          ],
          span,
        ),
      );
    }
    for (let i = 0; i < parameters.length; i++) {
      const parameter = parameters[i];
      if (parameter === undefined) throw "SCRIPT_PARAMETER_INVARIANT";
      const offset: Expression = {
        ...at(parameter),
        kind: "number",
        value: i,
        raw: "" + i,
      };
      const annotation = parameter.type;
      if (parameter.rest && annotation?.kind === "array") {
        const mask = contract(annotation.element);
        if (mask !== 0)
          expression(
            runtimeCall(
              "checkPrimitiveRestArguments",
              [
                id("$errors"),
                id(argsName, parameter),
                offset,
                contractValue(mask, parameter),
              ],
              parameter,
            ),
          );
      }
      const argumentValue: Expression = register
        ? id(
            registerArguments[i] ?? fail(parameter, "Missing positional slot"),
            parameter,
          )
        : parameter.rest
          ? runtimeCall(
              "createArrayFromList",
              [
                id(argsName, parameter),
                offset,
                member(id("$errors"), "arrayPrototype", parameter),
                id("$errors"),
                member(id("$global"), "hooks", parameter),
              ],
              parameter,
            )
          : argumentAt(offset, parameter);
      const binding = directSimpleParameters
        ? localBindingDeclarations.get(parameter.start)
        : undefined;
      const argument = temporary(
        argumentValue,
        true,
        false,
        undefined,
        binding !== undefined && !writtenSlots.has(binding)
          ? "value"
          : undefined,
      );
      if (directSimpleParameters) {
        if (binding === undefined) throw "SCRIPT_PARAMETER_SLOT_INVARIANT";
        localSlots.set(
          binding,
          writtenSlots.has(binding)
            ? temporary(argument, true, true)
            : argument,
        );
        parameterSlots.push(binding);
        continue;
      }
      const initializer = parameter.initializer;
      let initialized = argument;
      if (initializer !== undefined) {
        initialized = temporary(argument, true, true);
        const consequent = branchValue(
          initialized,
          initializer,
          parameter.kind === "pattern-parameter"
            ? undefined
            : text(parameter.name, parameter),
        );
        statements.push({
          ...at(parameter),
          kind: "if",
          test: {
            ...at(parameter),
            kind: "binary",
            operator: "===",
            left: argument,
            right: id("undefined"),
          },
          consequent,
          alternate: undefined,
        });
      }
      if (directParameters) {
        if (parameter.kind === "pattern-parameter")
          initializePattern(parameter.pattern, initialized, "let", false);
        else if (!initializeLexicalSlot(initialized, parameter))
          throw "SCRIPT_PARAMETER_SLOT_INVARIANT";
        for (const identifier of parameterIdentifiers(parameter)) {
          if (identifier === undefined) throw "SCRIPT_PARAMETER_SLOT_INVARIANT";
          const cell = frameLexicalBinding(identifier);
          if (cell === undefined) throw "SCRIPT_PARAMETER_SLOT_INVARIANT";
          finalizeLexicalSlot(cell);
        }
        continue;
      }
      if (parameter.kind === "pattern-parameter") {
        initializePattern(parameter.pattern, initialized, "let", false);
        continue;
      }
      const mask = bindingContracts.get(parameter.start);
      if (mask !== undefined)
        initialized = checkedContract(initialized, mask, parameter);
      if (initializedParameters.has(parameter.name)) {
        write(reference(parameter.name, parameter), initialized, parameter);
      } else {
        initializedParameters.add(parameter.name);
        expression(
          call(
            "initializeBinding",
            [parameterRecord, text(parameter.name, parameter), initialized],
            parameter,
          ),
        );
      }
    }
    // Statement completions are local to this invocation, not the enclosing Script.
    statements.push({
      ...at(span),
      kind: "variable",
      mode: "let",
      exported: false,
      declarations: [
        {
          ...at(span),
          name: "$completion",
          type: named("unknown"),
          initializer: id("undefined"),
        },
      ],
    });
    let executionStart = statements.length;
    if (body.kind === "block") {
      const bodyStatements = body.statements;
      const plan = functionDeclarations;
      const variables: Expression[] = plan.variables
        .filter((name) => !hoistedNames.has(name))
        .map((name) => text(name, body));
      for (const copy of annexCopies) {
        if (copy === undefined) throw "SCRIPT_ANNEX_COPY_INVARIANT";
        const owner = copy.owner;
        if (
          owner !== undefined &&
          owner.start === span.start &&
          owner.end === span.end &&
          copy.name !== "arguments" &&
          !hoistedNames.has(copy.name)
        )
          variables.push(text(copy.name, copy.node));
      }
      for (const declaration of plan.functions) {
        if (declaration === undefined) throw "SCRIPT_FUNCTION_INVARIANT";
        if (!hoistedNames.has(declaration.name))
          variables.push(text(declaration.name, declaration));
      }
      const lexicalDeclarations = !strict && evalBody ? [] : retainedLexicals;
      // Without declarations or a separate var environment, the body shares
      // the parameter scope; skip allocating a plan on every invocation.
      const declares =
        (separate && !bindsNothing) ||
        variables.length > 0 ||
        lexicalDeclarations.length > 0;
      const bodyPlan = (): Expression =>
        object(
          ["separate", "variables", "functions", "lexical"],
          [
            { ...at(body), kind: "boolean", value: separate },
            { ...at(body), kind: "array", elements: variables },
            { ...at(body), kind: "array", elements: [] },
            {
              ...at(body),
              kind: "array",
              elements: lexicalDeclarations.map((d) =>
                object(
                  ["name", "constant"],
                  [
                    text(d.name, d),
                    { ...at(d), kind: "boolean", value: d.constant },
                  ],
                  d,
                ),
              ),
            },
          ],
          body,
        );
      scope = temporary(
        declares
          ? call("instantiateFunctionBody", [scope, bodyPlan()], body)
          : { ...scope, ...at(body) },
      );
      variableScope = scope;
      // This operation always establishes a declarative body scope. Bodies
      // that bind nothing never read it (and may share an object scope).
      lexical = member(scope, "declarative", body);
      const record = bindsNothing ? id("undefined") : temporary(lexical);
      if (!bindsNothing)
        statements.push({
          ...at(body),
          kind: "if",
          test: {
            ...at(body),
            kind: "binary",
            operator: "===",
            left: record,
            right: id("undefined"),
          },
          consequent: {
            ...at(body),
            kind: "throw",
            expression: text("SCRIPT_BODY_ENVIRONMENT_INVARIANT"),
          },
          alternate: undefined,
        });
      lexical = record;
      annexVariableRecord = record;
      if (!strict && evalBody) {
        lexical = temporary(
          call("createDeclarativeEnvironment", [id("undefined")], body),
        );
        scope = temporary(
          call("createDeclarativeScope", [scope, lexical], body),
        );
        for (const declaration of plan.lexical) {
          if (declaration === undefined)
            throw "SCRIPT_LEXICAL_DECLARATION_INVARIANT";
          expression(
            call(
              declaration.constant
                ? "createImmutableBinding"
                : "createMutableBinding",
              [
                lexical,
                text(declaration.name, declaration),
                {
                  ...at(declaration),
                  kind: "boolean",
                  value: declaration.constant,
                },
              ],
              declaration,
            ),
          );
        }
      }
      const initialized = new Set<string>();
      for (let i = plan.functions.length - 1; i >= 0; i--) {
        const declaration = plan.functions[i];
        if (declaration === undefined) throw "SCRIPT_FUNCTION_INVARIANT";
        if (initialized.has(declaration.name)) continue;
        initialized.add(declaration.name);
        const functionBody = declaration.body;
        if (functionBody.kind !== "block")
          fail(functionBody, "Script function body must be a block");
        const fn = callable(
          declaration.parameters,
          functionBody,
          false,
          declaration,
          {
            generator: declaration.generator,
            resultType: declaration.returnType,
            async: declaration.async,
            codeStrict: declaration.strict ?? strict,
            functionName: text(declaration.name, declaration),
          },
        );
        writeAssignment(
          declareVariableTarget(declaration.name, declaration),
          fn,
        );
      }
      executionStart = statements.length;
      const resources = beginResources(bodyStatements, body);
      const initializedSlots: number[] = [];
      for (const child of bodyStatements) {
        if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
        statement(child);
        if (!raw && !suspending) localizeInitialized(child, initializedSlots);
      }
      releaseLocalSlots(initializedSlots);
      releaseLocalSlots(lexicalSlots);
      statements.push({
        ...at(body),
        kind: "return",
        expression: id("undefined"),
      });
      finishResources(resources, body);
    } else {
      const result = value(body, inferredName);
      statements.push({ ...at(body), kind: "return", expression: result });
    }
    releaseLocalSlots(parameterSlots);
    releaseLocalSlots(hoistedSlots);
    if (suspending) {
      const executionBody: BlockStatement = {
        ...at(body),
        kind: "block",
        statements: statements.splice(executionStart),
      };
      const resumeName = "$resume" + serial++;
      const initial = generatorContinuation(
        executionBody,
        resumeName,
        kindName,
        inputName,
        (result) =>
          !generator
            ? result
            : runtimeCall(
                "createIteratorResult",
                [
                  result,
                  { ...at(body), kind: "boolean", value: false },
                  id("$errors"),
                  member(id("$global"), "hooks", body),
                ],
                body,
              ),
        (value, following) => {
          const delegateArguments: Expression[] = [
            runtimeCall(
              asyncGenerator ? "getScriptAsyncIterator" : "getScriptIterator",
              [value, id("$errors"), member(id("$global"), "hooks", body)],
              body,
            ),
            following,
          ];
          if (yieldContract !== 0) {
            delegateArguments.push(id("$errors"));
            delegateArguments.push(contractValue(yieldContract, body));
          }
          return runtimeCall(
            asyncGenerator
              ? "createAsyncDelegatingContinuation"
              : "createDelegatingContinuation",
            delegateArguments,
            body,
          );
        },
        (node) =>
          fail(
            node,
            "generator suspension lowering for structured control flow is not implemented",
          ),
        asyncGenerator,
      );
      statements.push({
        ...at(body),
        kind: "variable",
        mode: "let",
        exported: false,
        declarations: [
          {
            ...at(body),
            name: resumeName,
            type: {
              ...at(body),
              kind: "named",
              name: asyncGenerator ? "AsyncGeneratorStep" : "GeneratorStep",
              arguments: instantiation(
                asyncGenerator ? "AsyncGeneratorStep" : "GeneratorStep",
              ),
            },
            initializer: initial,
          },
        ],
      });
      const continuation: Expression = {
        ...at(body),
        kind: "arrow",
        parameters: [
          { ...at(body), name: kindName, type: named("GeneratorResumeKind") },
          { ...at(body), name: inputName, type: named("unknown") },
        ],
        returnType: {
          ...at(body),
          kind: "named",
          name: asyncGenerator ? "AsyncGeneratorOutcome" : "GeneratorOutcome",
          arguments: instantiation(
            asyncGenerator ? "AsyncGeneratorOutcome" : "GeneratorOutcome",
          ),
        },
        body: {
          ...at(body),
          kind: "call",
          callee: id(
            asyncGenerator ? "runAsyncGeneratorSteps" : "runGeneratorSteps",
          ),
          arguments: [
            object(
              ["kind", "next", "inputKind", "value"],
              [
                text("transfer", body),
                id(resumeName),
                id(kindName),
                id(inputName),
              ],
              body,
            ),
          ],
          typeArguments: instantiation(
            asyncGenerator ? "runAsyncGeneratorSteps" : "runGeneratorSteps",
          ),
        },
      };
      statements.push({
        ...at(body),
        kind: "return",
        expression: continuation,
      });
    }
    const callbackBody: BlockStatement = {
      ...at(span),
      kind: "block",
      statements: statements.splice(start),
    };
    scope = outerScope;
    lexical = outerLexical;
    receiver = outerReceiver;
    variableScope = outerVariableScope;
    catchRecords = outerCatchRecords;
    inheritedCatches = outerInheritedCatches;
    home = outerHome;
    inFunction = outerInFunction;
    inClassFieldInitializer = outerFieldInitializer;
    derivedContext = outerDerivedContext;
    activeConstructor = outerConstructor;
    newTarget = outerNewTarget;
    strict = outerStrict;
    tailEnds = outerTailEnds;
    functionDepth--;
    suspensionInput = outerSuspensionInput;
    asyncGeneratorBody = outerAsyncGeneratorBody;
    yieldContract = outerYieldContract;
    disposalScope = outerDisposalScope;
    annexVariableRecord = outerAnnexVariableRecord;
    const callbackParameters: Parameter[] = [
      {
        ...at(span),
        name: receiverName,
        type: derived
          ? {
              ...at(span),
              kind: "named",
              name: "DerivedConstruction",
              arguments: instantiation("DerivedConstruction"),
            }
          : named("unknown"),
      },
      {
        ...at(span),
        name: packedName ?? argsName,
        type: {
          ...at(span),
          kind: "array",
          element: named("unknown"),
          readonly: true,
        },
      },
    ];
    if (!raw || derived)
      callbackParameters.push({
        ...at(span),
        name:
          packedName === undefined ? calleeName : "$ignoredCallee" + serial++,
        type: derived
          ? {
              ...at(span),
              kind: "named",
              name: "OrdinaryObject",
              arguments: instantiation("OrdinaryObject"),
            }
          : named("unknown"),
      });
    if ((!raw || options.baseConstructor) && !generator)
      callbackParameters.push({
        ...at(span),
        name:
          packedName === undefined
            ? newTargetName
            : "$ignoredTarget" + serial++,
        type: named("unknown"),
      });
    const callback: Expression = {
      ...at(span),
      kind: "arrow",
      parameters: callbackParameters,
      returnType: asyncGenerator
        ? {
            ...at(span),
            kind: "named",
            name: "AsyncGeneratorContinuation",
            arguments: instantiation("AsyncGeneratorContinuation"),
          }
        : named(suspending ? "GeneratorContinuation" : "unknown"),
      body: callbackBody,
    };
    if (register) {
      callbackParameters.length = 0;
      for (const name of [calleeName, receiverName, newTargetName])
        callbackParameters.push({ ...at(span), name, type: named("unknown") });
      callbackParameters.push({
        ...at(span),
        name: registerCount,
        type: named("number"),
      });
      for (const name of registerArguments) {
        if (name === undefined) throw "SCRIPT_REGISTER_ARGUMENT_INVARIANT";
        callbackParameters.push({ ...at(span), name, type: named("unknown") });
      }
    }
    if (raw)
      return resultContract === 0
        ? callback
        : runtimeCall(
            "checkClassMethodResult",
            [callback, id("$errors"), contractValue(resultContract, span)],
            span,
          );
    const retainedSpan: Span =
      options.sourceStart === undefined
        ? span
        : { start: options.sourceStart, end: span.end };
    const length = options.packed ? 0 : expectedArgumentCount(parameters);
    if (generator || options.async) {
      const suspensionArguments: Expression[] = [
        callback,
        id("$errors"),
        member(id("$global"), "hooks", span),
        runtimeCall(
          "propertyFunctionName",
          [functionName ?? text("", span)],
          span,
        ),
        { ...at(span), kind: "number", value: length, raw: "" + length },
        homeObject ?? id("undefined"),
      ];
      if (completionContract !== 0 || resumeContract !== 0) {
        suspensionArguments.push(contractValue(completionContract, span));
        if (generator)
          suspensionArguments.push(contractValue(resumeContract, span));
      }
      return retainSource(
        runtimeCall(
          asyncGenerator
            ? "createSourceAsyncGeneratorFunction"
            : generator
              ? "createSourceGeneratorFunction"
              : "createSourceAsyncContinuationFunction",
          suspensionArguments,
          span,
        ),
        retainedSpan,
      );
    }
    const canConstruct = !arrow && !method && !options.packed;
    const constructible: Expression = {
      ...at(span),
      kind: "boolean",
      value: canConstruct,
    };
    const callerPolicy = text(
      options.packed
        ? "none"
        : codeStrict
          ? "opaque"
          : canConstruct
            ? "legacy"
            : "visible",
      span,
    );
    if (nativeEntry) {
      if (nativeName === undefined) throw "SCRIPT_NATIVE_NAME_INVARIANT";
      const optionalList: TypeNode = {
        ...at(span),
        kind: "union",
        members: [list, named("undefined")],
      };
      const args = [calleeName, receiverName, newTargetName, incomingArguments];
      const begin = statements.length;
      const agent = member(id("$errors"), "agent", span);
      const trace = temporary({
        ...at(span),
        kind: "conditional",
        test: hasList(),
        consequent: id("undefined", span),
        alternate: runtimeCall("enterExecutionName", [agent, nativeName], span),
      });
      const depth = temporary({
        ...at(span),
        kind: "conditional",
        test: hasList(),
        consequent: scalarNumber(-1, span),
        alternate:
          nativeArgumentReader === undefined
            ? runtimeCall(
                "enterSourceCall",
                [agent, id(codeStrict ? "undefined" : calleeName, span)],
                span,
              )
            : runtimeCall(
                "enterNativeSourceCall",
                [
                  agent,
                  id(calleeName, span),
                  nativeArgumentCount(span),
                  {
                    ...at(span),
                    kind: "call",
                    scriptArgument: "registers",
                    callee: id("sourceArgumentArea", span),
                    arguments: [],
                  },
                  {
                    ...at(span),
                    kind: "call",
                    scriptArgument: "stack",
                    callee: id("sourceArgumentArea", span),
                    arguments: [],
                  },
                  nativeArgumentReader,
                ],
                span,
              ),
      });
      const cleanup = statements.length;
      expression(runtimeCall("exitSourceCall", [agent, depth], span));
      expression(runtimeCall("leaveExecutionName", [agent, trace], span));
      const cleanupBody = statements.splice(cleanup);
      statements.push({
        ...at(span),
        kind: "try",
        body: callbackBody,
        handler: undefined,
        finalizer: {
          ...at(span),
          kind: "block",
          statements: [
            {
              ...at(span),
              kind: "if",
              test: {
                ...at(span),
                kind: "binary",
                operator: "!==",
                left: trace,
                right: id("undefined", span),
              },
              consequent: {
                ...at(span),
                kind: "block",
                statements: cleanupBody,
              },
              alternate: undefined,
            },
          ],
        },
      });
      const nativeParameters: Parameter[] = [];
      const bridgeParameters: Parameter[] = [];
      const bridgeArguments: Expression[] = [];
      for (const name of args) {
        if (name === undefined) throw "SCRIPT_NATIVE_HEADER_INVARIANT";
        nativeParameters.push({
          ...at(span),
          name,
          type: name === incomingArguments ? optionalList : named("unknown"),
        });
      }
      for (const name of [receiverName, argsName, calleeName, newTargetName]) {
        if (name === undefined) throw "SCRIPT_NATIVE_BRIDGE_INVARIANT";
        bridgeParameters.push({
          ...at(span),
          name,
          type: name === argsName ? list : named("unknown"),
        });
      }
      for (const name of [calleeName, receiverName, newTargetName, argsName]) {
        if (name === undefined) throw "SCRIPT_NATIVE_BRIDGE_INVARIANT";
        bridgeArguments.push(id(name, span));
      }
      const nativeBody = temporary({
        ...at(span),
        kind: "arrow",
        scriptEntry: true,
        parameters: nativeParameters,
        returnType: named("unknown"),
        body: {
          ...at(span),
          kind: "block",
          statements: statements.splice(begin),
        },
      });
      const bridge: Expression = {
        ...at(span),
        kind: "arrow",
        parameters: bridgeParameters,
        returnType: named("unknown"),
        body: {
          ...at(span),
          kind: "call",
          scriptCall: true,
          callee: nativeBody,
          arguments: bridgeArguments,
        },
      };
      return retainSource(
        runtimeCall(
          "createNativeSourceFunction",
          [
            bridge,
            nativeBody,
            constructible,
            id("$errors"),
            member(id("$global"), "hooks", span),
            nativeName,
            scalarNumber(length, span),
            homeObject ?? id("undefined"),
            callerPolicy,
          ],
          span,
        ),
        retainedSpan,
      );
    }
    // One call names, creates and retains the source of each function.
    if (
      compactResults &&
      sourceText !== undefined &&
      !tailEnabled &&
      resultContract === 0
    )
      return runtimeCall(
        "createRetainedSourceFunction",
        [
          callback,
          constructible,
          id("$errors"),
          member(id("$global"), "hooks", span),
          functionName ?? text("", span),
          { ...at(span), kind: "number", value: length, raw: "" + length },
          homeObject ?? id("undefined"),
          callerPolicy,
          retainedSource(retainedSpan),
        ],
        span,
      );
    const functionArguments: Expression[] = [
      callback,
      constructible,
      id("$errors"),
      member(id("$global"), "hooks", span),
      runtimeCall(
        "propertyFunctionName",
        [functionName ?? text("", span)],
        span,
      ),
      { ...at(span), kind: "number", value: length, raw: "" + length },
      homeObject ?? id("undefined"),
      callerPolicy,
    ];
    if (resultContract !== 0)
      functionArguments.push(contractValue(resultContract, span));
    return retainSource(
      {
        ...at(span),
        kind: "call",
        callee: id(
          resultContract !== 0
            ? "createCheckedSourceFunction"
            : tailEnabled
              ? "createTailSourceFunction"
              : register
                ? wideRegister
                  ? "createWideRegisterSourceFunction"
                  : "createRegisterSourceFunction"
                : "createSourceFunction",
        ),
        arguments: functionArguments,
        typeArguments: [],
      },
      retainedSpan,
    );
  }
  function classValue(
    node: ClassDefinition,
    inferredName: Expression | undefined,
  ): Expression {
    const decorated =
      (node.decorators?.length ?? 0) !== 0 ||
      node.elements.some(
        (element) =>
          element.kind !== "static-block" &&
          (element.decorators?.length ?? 0) !== 0,
      );
    if (decorated) usesDecorators = true;
    function decoratorList(
      decorators: readonly Expression[] | undefined,
      span: Span,
    ): Expression {
      const list = typedList("ClassDecorator", span);
      for (const decorator of decorators ?? []) {
        if (decorator === undefined) throw "CLASS_DECORATOR_INVARIANT";
        const target = callTarget(decorator);
        const evaluated = temporary(target.value, true);
        expression({
          ...at(span),
          kind: "call",
          callee: member(list, "push", span),
          arguments: [
            object(["value", "receiver"], [evaluated, target.receiver], span),
          ],
          typeArguments: [],
        });
      }
      return list;
    }
    const classDecorators = decorated
      ? decoratorList(node.decorators, node)
      : id("undefined");
    const decorationState = decorated
      ? temporary(runtimeCall("createClassDecorationState", [], node))
      : id("undefined");
    const outerScope = scope,
      outerLexical = lexical,
      outerStrict = strict;
    strict = true;
    const className = node.name;
    const classBinding = selfBindings.get(node);
    let record: Expression | undefined;
    if (classBinding !== undefined)
      reserveLexicalSlot(classBinding, node, true);
    else if (dynamicBindings || className !== undefined) {
      const classRecord = temporary(
        call("createDeclarativeEnvironment", [id("undefined")], node),
      );
      record = classRecord;
      scope = temporary(
        call("createDeclarativeScope", [outerScope, classRecord], node),
      );
      lexical = classRecord;
      if (className !== undefined)
        expression(
          call(
            "createImmutableBinding",
            [
              classRecord,
              text(className, node),
              { ...at(node), kind: "boolean", value: true },
            ],
            node,
          ),
        );
    }
    function initializeClassName(value: Expression): void {
      if (classBinding !== undefined)
        initializeKnownLexical(classBinding, value, node);
      else if (className !== undefined) {
        const classRecord = record;
        if (classRecord === undefined) throw "SCRIPT_CLASS_BINDING_INVARIANT";
        expression(
          call(
            "initializeBinding",
            [classRecord, text(className, node), value],
            node,
          ),
        );
      }
    }
    const heritage =
      node.heritage === undefined
        ? undefined
        : temporary(
            runtimeCall(
              "classHeritage",
              [
                temporary(value(node.heritage), true),
                id("$errors"),
                member(id("$global"), "hooks", node),
              ],
              node,
            ),
          );
    const privateNames = new Map<string, Expression>();
    for (const element of node.elements) {
      if (element === undefined) throw "CLASS_ELEMENT_INVARIANT";
      if (element.kind === "static-block" || !element.private) continue;
      const key = element.key;
      if (key.kind !== "string") throw "PRIVATE_NAME_INVARIANT";
      if (!privateNames.has(key.value))
        privateNames.set(
          key.value,
          temporary(
            runtimeCall("createPrivateName", [text(key.value, key)], key),
          ),
        );
    }
    privateScopes.push({ names: privateNames });
    const instanceFields = typedList("ClassField", node);
    const instancePrivate = typedList("ClassPrivateMethod", node);
    const staticPrivate = typedList("ClassPrivateMethod", node);
    const privateMethods: PrivateMethodDefinition[] = [];
    const privateAccessors = new Map<string, PrivateMethodDefinition>();
    const staticSteps: Expression[] = [];
    const decoratedSteps: {
      readonly plan: Expression;
      readonly group: number;
      readonly span: Span;
    }[] = [];
    function decorationPlan(
      element: ClassElement,
      key: Expression,
      decorators: Expression,
      target: Expression,
      method: Expression,
      get: Expression,
      set: Expression,
    ): Expression {
      if (element.kind === "static-block")
        throw "CLASS_DECORATOR_ELEMENT_INVARIANT";
      const privateKey = element.key;
      const kind =
        element.kind === "get"
          ? "getter"
          : element.kind === "set"
            ? "setter"
            : element.kind === "field" && element.accessor
              ? "accessor"
              : element.kind;
      const field = temporary(
        object(
          ["initializers", "extraInitializers"],
          [
            { ...at(element), kind: "array", elements: [] },
            { ...at(element), kind: "array", elements: [] },
          ],
          element,
        ),
        false,
        false,
        named("ClassFieldDecoration"),
      );
      const plan = temporary(
        object(
          [
            "target",
            "name",
            "privateName",
            "kind",
            "static",
            "decorators",
            "field",
            "value",
            "get",
            "set",
          ],
          [
            target,
            key,
            element.private && privateKey.kind === "string"
              ? privateName(privateKey.value, element)
              : id("undefined"),
            text(kind, element),
            { ...at(element), kind: "boolean", value: element.static },
            decorators,
            field,
            method,
            get,
            set,
          ],
          element,
        ),
        false,
        false,
        named("ClassElementDecoration"),
      );
      decoratedSteps.push({
        plan,
        group:
          element.kind === "field" && !element.accessor
            ? element.static
              ? 2
              : 3
            : element.static
              ? 0
              : 1,
        span: element,
      });
      return plan;
    }
    function privateDefinition(
      element: ClassElement,
      method: Expression,
      get: Expression,
      set: Expression,
    ): void {
      if (element.kind === "static-block")
        throw "CLASS_DECORATOR_ELEMENT_INVARIANT";
      const key = element.key;
      if (key.kind !== "string") throw "PRIVATE_NAME_INVARIANT";
      if (element.kind === "method" || element.kind === "field") {
        privateMethods.push({
          ...at(element),
          name: privateName(key.value, element),
          static: element.static,
          kind: element.kind === "field" ? "accessor" : "method",
          value: method,
          get,
          set,
        });
      } else {
        let pair = privateAccessors.get(key.value);
        if (pair === undefined) {
          pair = {
            ...at(element),
            name: privateName(key.value, element),
            static: element.static,
            kind: "accessor",
            value: id("undefined"),
            get: id("undefined"),
            set: id("undefined"),
          };
          privateAccessors.set(key.value, pair);
          privateMethods.push(pair);
        }
        if (element.kind === "get") pair.get = method;
        else pair.set = method;
      }
    }
    let constructor: ClassElement | undefined;
    for (const element of node.elements) {
      if (element === undefined) throw "CLASS_ELEMENT_INVARIANT";
      if (element.kind === "static-block") continue;
      const key = element.key;
      if (
        element.kind === "method" &&
        !element.static &&
        !element.computed &&
        key.kind === "string" &&
        key.value === "constructor"
      )
        constructor = element;
    }
    // Prepare the definition-time home before constructor callback creation.
    // The same object is published as C.prototype by createBaseClass.
    const prototype = temporary(
      call(
        "createObject",
        [
          heritage === undefined
            ? member(id("$errors"), "objectPrototype", node)
            : member(heritage, "prototypeParent", node),
        ],
        node,
      ),
    );
    let body: Expression = id("undefined", node),
      length = 0;
    if (constructor !== undefined && constructor.kind === "method") {
      body = callable(
        constructor.parameters,
        constructor.body,
        false,
        constructor,
        {
          raw: true,
          codeStrict: true,
          homeObject: prototype,
          derived: heritage !== undefined,
          baseConstructor: heritage === undefined,
        },
      );
      length = expectedArgumentCount(constructor.parameters);
    }
    const constructorArgs: Expression[] = [
      className === undefined
        ? runtimeCall(
            "propertyFunctionName",
            [inferredName ?? text("", node)],
            node,
          )
        : text(className, node),
      { ...at(node), kind: "number", value: length, raw: "" + length },
      body,
      instanceFields,
      id("$errors"),
      member(id("$global"), "hooks", node),
    ];
    if (heritage !== undefined)
      constructorArgs.push(member(heritage, "constructorParent", node));
    constructorArgs.push(prototype, instancePrivate);
    if (decorated)
      constructorArgs.push(
        member(decorationState, "instanceInitializers", node),
      );
    const classSource: Span =
      node.sourceStart === undefined
        ? node
        : { start: node.sourceStart, end: node.end };
    const result = temporary(
      retainSource(
        runtimeCall(
          heritage === undefined ? "createBaseClass" : "createDerivedClass",
          constructorArgs,
          node,
        ),
        classSource,
      ),
    );
    const staticReceiver = decorated ? temporary(result, false, true) : result;
    for (const element of node.elements) {
      if (element === undefined) throw "CLASS_ELEMENT_INVARIANT";
      if (element === constructor) continue;
      if (element.kind === "static-block") {
        const initialize = temporary(
          callable([], element.body, false, element, {
            raw: true,
            method: true,
            codeStrict: true,
            homeObject: result,
          }),
        );
        staticSteps.push({
          ...at(element),
          kind: "call",
          callee: initialize,
          arguments: [
            staticReceiver,
            { ...at(element), kind: "array", elements: [] },
          ],
          typeArguments: [],
        });
        continue;
      }
      const elementDecorators = decorated
        ? decoratorList(element.decorators, element)
        : id("undefined");
      const key = temporary(
        checkedOperatorValue(
          "objectPropertyKey",
          [result, temporary(value(element.key), true)],
          element,
        ),
      );
      if (decorated && element.kind !== "field") {
        const home = element.static ? result : prototype;
        const methodSpan: Span = {
          start: element.sourceStart ?? element.start,
          end: element.end,
        };
        let method: Expression;
        if (element.generator || element.async) {
          method = temporary(
            callable(element.parameters, element.body, false, methodSpan, {
              generator: element.generator,
              resultType: element.returnType,
              async: element.async,
              method: true,
              codeStrict: true,
              functionName: key,
              homeObject: home,
            }),
          );
        } else {
          const implementation = callable(
            element.parameters,
            element.body,
            false,
            element,
            {
              method: true,
              raw: true,
              codeStrict: true,
              homeObject: home,
              resultType: element.returnType,
            },
          );
          const name = runtimeCall("propertyFunctionName", [key], element);
          const methodName: Expression =
            element.kind === "method"
              ? name
              : {
                  ...at(element),
                  kind: "binary",
                  operator: "+",
                  left: text(element.kind + " ", element),
                  right: name,
                };
          const length = expectedArgumentCount(element.parameters);
          method = temporary(
            runtimeCall(
              "createClassMethod",
              [
                home,
                methodName,
                {
                  ...at(element),
                  kind: "number",
                  value: length,
                  raw: "" + length,
                },
                implementation,
                id("$errors"),
                member(id("$global"), "hooks", element),
                retainedSource(methodSpan),
              ],
              element,
            ),
          );
        }
        const plan = decorationPlan(
          element,
          key,
          elementDecorators,
          home,
          method,
          id("undefined"),
          id("undefined"),
        );
        if (
          checkContracts &&
          element.kind === "method" &&
          !element.private &&
          (element.decorators?.length ?? 0) !== 0
        ) {
          const parameters: Expression[] = [];
          let rest = 0;
          for (const parameter of element.parameters) {
            if (parameter === undefined) throw "SCRIPT_PARAMETER_INVARIANT";
            const annotation = parameter.type;
            if (parameter.rest) {
              if (annotation?.kind === "array")
                rest = contract(annotation.element);
              continue;
            }
            let mask = contract(annotation);
            if (
              mask !== 0 &&
              (parameter.optional || parameter.initializer !== undefined)
            )
              mask |= primitiveContractBit("undefined");
            parameters.push(contractValue(mask, parameter));
          }
          expression(
            runtimeCall(
              "attachClassMethodContract",
              [
                home,
                key,
                object(
                  ["parameters", "rest", "result"],
                  [
                    { ...at(element), kind: "array", elements: parameters },
                    contractValue(rest, element),
                    contractValue(contract(element.returnType), element),
                  ],
                  element,
                ),
                id("$errors"),
              ],
              element,
            ),
          );
        }
        if (element.private)
          privateDefinition(
            element,
            member(plan, "value", element),
            id("undefined"),
            id("undefined"),
          );
        continue;
      }
      if (element.kind !== "field") {
        const methodSpan: Span = {
          start: element.sourceStart ?? element.start,
          end: element.end,
        };
        if (element.generator || element.async) {
          const method = temporary(
            callable(element.parameters, element.body, false, methodSpan, {
              generator: element.generator,
              resultType: element.returnType,
              async: element.async,
              method: true,
              codeStrict: true,
              functionName: key,
              homeObject: element.static ? result : prototype,
            }),
          );
          if (element.private) {
            const privateKey = element.key;
            if (privateKey.kind !== "string") throw "PRIVATE_NAME_INVARIANT";
            privateMethods.push({
              ...at(element),
              name: privateName(privateKey.value, element),
              static: element.static,
              kind: "method",
              value: method,
              get: id("undefined"),
              set: id("undefined"),
            });
          } else {
            expression(
              runtimeCall(
                "defineClassMethodValue",
                [
                  element.static ? result : prototype,
                  key,
                  method,
                  id("$errors"),
                  member(id("$global"), "hooks", element),
                ],
                element,
              ),
            );
          }
          continue;
        }
        const implementation = callable(
          element.parameters,
          element.body,
          false,
          element,
          {
            method: true,
            raw: true,
            resultType: element.returnType,
            codeStrict: true,
            homeObject: element.static ? result : prototype,
          },
        );
        const methodLength = expectedArgumentCount(element.parameters);
        if (element.private) {
          const privateKey = element.key;
          if (privateKey.kind !== "string") throw "PRIVATE_NAME_INVARIANT";
          const method = temporary(
            runtimeCall(
              "createClassMethod",
              [
                element.static ? result : prototype,
                text(
                  (element.kind === "method" ? "" : element.kind + " ") +
                    privateKey.value,
                  element,
                ),
                {
                  ...at(element),
                  kind: "number",
                  value: methodLength,
                  raw: "" + methodLength,
                },
                implementation,
                id("$errors"),
                member(id("$global"), "hooks", element),
                retainedSource(methodSpan),
              ],
              element,
            ),
          );
          if (element.kind === "method") {
            privateMethods.push({
              ...at(element),
              name: privateName(privateKey.value, element),
              static: element.static,
              kind: "method",
              value: method,
              get: id("undefined"),
              set: id("undefined"),
            });
          } else {
            let pair = privateAccessors.get(privateKey.value);
            if (pair === undefined) {
              pair = {
                ...at(element),
                name: privateName(privateKey.value, element),
                static: element.static,
                kind: "accessor",
                value: id("undefined"),
                get: id("undefined"),
                set: id("undefined"),
              };
              privateAccessors.set(privateKey.value, pair);
              privateMethods.push(pair);
            }
            if (element.kind === "get") pair.get = method;
            else pair.set = method;
          }
          continue;
        }
        const lengthValue: Expression = {
          ...at(element),
          kind: "number",
          value: methodLength,
          raw: "" + methodLength,
        };
        const methodArgs: Expression[] = [
          element.static ? result : prototype,
          key,
          element.kind === "method"
            ? lengthValue
            : {
                ...at(element),
                kind: "boolean",
                value: element.kind === "set",
              },
          implementation,
          id("$errors"),
          member(id("$global"), "hooks", element),
        ];
        if (element.kind !== "method") methodArgs.push(lengthValue);
        methodArgs.push(retainedSource(methodSpan));
        expression(
          runtimeCall(
            element.kind === "method"
              ? "defineClassMethod"
              : "defineClassAccessor",
            methodArgs,
            element,
          ),
        );
      } else {
        const initializer: Expression =
          element.initializer === undefined
            ? {
                ...at(element),
                kind: "unary",
                operator: "void",
                operand: { ...at(element), kind: "number", value: 0, raw: "0" },
              }
            : element.initializer;
        const implementation = callable([], initializer, false, element, {
          method: true,
          raw: true,
          inferredName: key,
          codeStrict: true,
          homeObject: element.static ? result : prototype,
          classFieldInitializer: true,
        });
        let accessorGet: Expression = id("undefined"),
          accessorSet: Expression = id("undefined");
        const fieldNames = ["name", "initialize"];
        const fieldValues: Expression[] = [key, implementation];
        const fieldContract = contract(element.type);
        if (fieldContract !== 0) {
          fieldNames.push("contract");
          fieldValues.push(contractValue(fieldContract, element));
          if (element.initializer === undefined) {
            fieldNames.push("deferred");
            fieldValues.push({ ...at(element), kind: "boolean", value: true });
          }
        }
        if (element.accessor) {
          usesAutoAccessors = true;
          const storage = temporary(
            runtimeCall("createPrivateName", [text("", element)], element),
          );
          const privateKey = element.key;
          if (element.private && privateKey.kind !== "string")
            throw "PRIVATE_NAME_INVARIANT";
          const prepared = temporary(
            runtimeCall(
              "prepareClassAutoAccessor",
              [
                element.static ? result : prototype,
                key,
                storage,
                element.private && privateKey.kind === "string"
                  ? privateName(privateKey.value, element)
                  : id("undefined"),
                id("$errors"),
                member(id("$global"), "hooks", element),
              ],
              element,
            ),
            false,
            false,
            decorated ? undefined : named("ClassPrivateMethod"),
          );
          accessorGet = member(prepared, "get", element);
          accessorSet = member(prepared, "set", element);
          if (element.private && !decorated)
            expression({
              ...at(element),
              kind: "call",
              callee: member(
                element.static ? staticPrivate : instancePrivate,
                "push",
                element,
              ),
              arguments: [prepared],
              typeArguments: [],
            });
          fieldNames.push("privateName");
          fieldValues.push(storage);
        } else if (element.private) {
          const privateKey = element.key;
          if (privateKey.kind !== "string") throw "PRIVATE_NAME_INVARIANT";
          fieldNames.push("privateName");
          fieldValues.push(privateName(privateKey.value, element));
        }
        if (decorated) {
          const plan = decorationPlan(
            element,
            key,
            elementDecorators,
            element.static ? result : prototype,
            id("undefined"),
            accessorGet,
            accessorSet,
          );
          fieldNames.push("decoration");
          fieldValues.push(member(plan, "field", element));
          if (element.private && element.accessor)
            privateDefinition(
              element,
              id("undefined"),
              member(plan, "get", element),
              member(plan, "set", element),
            );
        }
        const field = object(fieldNames, fieldValues, element);
        if (element.static) {
          const prepared = temporary(field, false, false, named("ClassField"));
          staticSteps.push(
            runtimeCall(
              "initializeClassFields",
              [
                staticReceiver,
                { ...at(element), kind: "array", elements: [prepared] },
                id("$errors"),
                member(id("$global"), "hooks", element),
              ],
              element,
            ),
          );
        } else {
          expression({
            ...at(element),
            kind: "call",
            callee: member(instanceFields, "push", element),
            arguments: [field],
            typeArguments: [],
          });
        }
      }
    }
    for (let group = 0; group < 4; group++) {
      for (const step of decoratedSteps) {
        if (step === undefined) throw "CLASS_DECORATOR_STEP_INVARIANT";
        if (step.group === group)
          expression(
            runtimeCall(
              "decorateClassElement",
              [
                step.plan,
                decorationState,
                id("$errors"),
                member(id("$global"), "hooks", step.span),
              ],
              step.span,
            ),
          );
      }
    }
    for (const method of privateMethods) {
      if (method === undefined) throw "PRIVATE_METHOD_INVARIANT";
      const definition =
        method.kind === "method"
          ? object(
              ["name", "kind", "value"],
              [method.name, text("method", method), method.value],
              method,
            )
          : object(
              ["name", "kind", "get", "set"],
              [method.name, text("accessor", method), method.get, method.set],
              method,
            );
      expression({
        ...at(method),
        kind: "call",
        callee: member(
          method.static ? staticPrivate : instancePrivate,
          "push",
          method,
        ),
        arguments: [definition],
        typeArguments: [],
      });
    }
    if (!decorated) initializeClassName(result);
    expression(
      runtimeCall(
        "initializeClassPrivateMethods",
        [result, staticPrivate, id("$errors")],
        node,
      ),
    );
    if (decorated) {
      const replacement = runtimeCall(
        "decorateClass",
        [
          result,
          classDecorators,
          decorationState,
          constructorArgs[0] ?? text("", node),
          id("$errors"),
          member(id("$global"), "hooks", node),
        ],
        node,
      );
      expression({
        ...at(node),
        kind: "assignment",
        target: staticReceiver,
        value: replacement,
      });
    }
    if (decorated) initializeClassName(staticReceiver);
    if (decorated)
      expression(
        runtimeCall(
          "runClassInitializers",
          [
            member(decorationState, "staticInitializers", node),
            staticReceiver,
            id("$errors"),
          ],
          node,
        ),
      );
    for (const step of staticSteps) {
      if (step === undefined) throw "CLASS_STATIC_STEP_INVARIANT";
      expression(step);
    }
    if (decorated)
      expression(
        runtimeCall(
          "runClassInitializers",
          [
            member(decorationState, "classInitializers", node),
            staticReceiver,
            id("$errors"),
          ],
          node,
        ),
      );
    privateScopes.pop();
    if (classBinding !== undefined) releaseLocalSlots([classBinding]);
    scope = outerScope;
    lexical = outerLexical;
    strict = outerStrict;
    return staticReceiver;
  }
  function value(
    node: Expression,
    inferredName: Expression | undefined = undefined,
  ): Expression {
    if (isOptionalChain(node)) return optionalChainValue(node, false).value;
    switch (node.kind) {
      case "class-expression":
        return classValue(node.definition, inferredName);
      case "regexp":
        return runtimeCall(
          "createRegExpLiteral",
          [
            text(node.pattern, node),
            text(node.flags, node),
            id("$errors"),
            member(id("$global"), "hooks", node),
          ],
          node,
        );
      case "bigint":
        return runtimeCall(
          "createBigIntLiteral",
          [text(node.value, node)],
          node,
        );
      case "number":
      case "string":
      case "boolean":
      case "null":
        return node;
      case "private-in":
        return checkedOperatorValue(
          "hasPrivateObjectValue",
          [temporary(value(node.object), true), privateName(node.name, node)],
          node,
        );
      case "new-target":
        return newTarget;
      case "super":
        return fail(node, "Script super reference lowering is not implemented");
      case "this":
        return thisValue(node);
      case "tagged-template": {
        const target = callTarget(node.tag);
        const callee = temporary(target.value, true);
        const name = "$templateSite" + serial++;
        const template = node.template;
        templateSites.push({
          ...at(node),
          kind: "variable",
          mode: "const",
          exported: false,
          declarations: [
            {
              ...at(node),
              name,
              type: named("TemplateSite"),
              initializer: object(
                ["cooked", "raw"],
                [
                  {
                    ...at(template),
                    kind: "array",
                    elements: template.parts.map((part) =>
                      part === undefined
                        ? id("undefined", template)
                        : text(part, template),
                    ),
                  },
                  {
                    ...at(template),
                    kind: "array",
                    elements: template.raw.map((part) => text(part, template)),
                  },
                ],
                template,
              ),
            },
          ],
        });
        const arguments_: Expression[] = [
          temporary(
            runtimeCall(
              "getTemplateObject",
              [
                id(name, node),
                id("$errors"),
                member(id("$global"), "hooks", node),
              ],
              node,
            ),
            true,
          ),
        ];
        for (const substitution of template.substitutions) {
          if (substitution === undefined)
            throw "TEMPLATE_SUBSTITUTION_INVARIANT";
          arguments_.push(temporary(value(substitution), true));
        }
        return invokePrepared(callee, target.receiver, arguments_, node);
      }
      case "template-expression": {
        const first = node.parts[0];
        if (
          first === undefined ||
          node.parts.length !== node.substitutions.length + 1
        )
          throw "TEMPLATE_PARTS_INVARIANT";
        let result: Expression = text(first, node);
        for (let i = 0; i < node.substitutions.length; i++) {
          const substitution = node.substitutions[i],
            tail = node.parts[i + 1];
          if (substitution === undefined || tail === undefined)
            throw "TEMPLATE_SUBSTITUTION_INVARIANT";
          const converted = checkedOperatorValue(
            "stringValue",
            [temporary(value(substitution), true)],
            substitution,
          );
          result = temporary({
            ...at(node),
            kind: "binary",
            operator: "+",
            left: {
              ...at(node),
              kind: "binary",
              operator: "+",
              left: result,
              right: converted,
            },
            right: text(tail, node),
          });
        }
        return result;
      }
      case "array": {
        // Track the next index across spreads and elisions, then finalize trailing holes.
        const result = temporary(
          call(
            "createArrayObject",
            [
              {
                ...at(node),
                kind: "number",
                value: 0,
                raw: "0",
              },
              member(id("$errors"), "arrayPrototype", node),
              member(id("$errors"), "arrayHooks", node),
              member(id("$global"), "hooks", node),
            ],
            node,
          ),
        );
        let nextIndex: Expression = {
          ...at(node),
          kind: "number",
          value: 0,
          raw: "0",
        };
        for (let index = 0; index < node.elements.length; index++) {
          const element = node.elements[index];
          if (element === undefined) throw "SCRIPT_ARRAY_ELEMENT_INVARIANT";
          if (element.kind === "spread") {
            nextIndex = temporary(
              runtimeCall(
                "appendScriptArraySpread",
                [
                  result,
                  nextIndex,
                  temporary(value(element.value), true),
                  id("$errors"),
                  member(id("$global"), "hooks", element),
                ],
                element,
              ),
            );
            continue;
          }
          const currentIndex = nextIndex;
          nextIndex = temporary({
            ...at(element),
            kind: "binary",
            operator: "+",
            left: currentIndex,
            right: { ...at(element), kind: "number", value: 1, raw: "1" },
          });
          if (element.kind === "elision") continue;
          const initialized = temporary(value(element), true);
          expression(
            call(
              "createDataProperty",
              [
                result,
                {
                  ...at(element),
                  kind: "call",
                  callee: id("String", element),
                  arguments: [currentIndex],
                },
                initialized,
                member(id("$global"), "hooks", element),
              ],
              element,
            ),
          );
        }
        expression(
          runtimeCall(
            "finishScriptArray",
            [
              result,
              nextIndex,
              id("$errors"),
              member(id("$global"), "hooks", node),
            ],
            node,
          ),
        );
        return result;
      }
      case "object": {
        const result = temporary(
          call(
            "createObject",
            [member(id("$errors"), "objectPrototype", node)],
            node,
          ),
        );
        for (const property of node.properties) {
          if (property === undefined) throw "SCRIPT_PROPERTY_INVARIANT";
          if (property.kind === "spread") {
            expression(
              runtimeCall(
                "copyObjectProperties",
                [
                  result,
                  temporary(value(property.value), true),
                  { ...at(property), kind: "array", elements: [] },
                  member(id("$global"), "hooks", property),
                  id("$errors"),
                ],
                property,
              ),
            );
            continue;
          }
          const propertyName =
            property.keyExpression === undefined
              ? text(property.name, property)
              : temporary(
                  checkedOperatorValue(
                    "objectPropertyKey",
                    [result, temporary(value(property.keyExpression), true)],
                    property,
                  ),
                );
          const propertyValue = property.value;
          const accessor = property.accessor;
          if (property.prototypeSetter === true) {
            expression(
              runtimeCall(
                "setObjectLiteralPrototype",
                [result, temporary(value(propertyValue), true)],
                property,
              ),
            );
            continue;
          }
          const initialized = temporary(
            property.method && propertyValue.kind === "function-expression"
              ? callable(
                  propertyValue.parameters,
                  propertyValue.body,
                  false,
                  propertyValue,
                  {
                    generator: propertyValue.generator,
                    async: propertyValue.async,
                    method: true,
                    codeStrict: propertyValue.strict ?? strict,
                    functionName:
                      accessor === undefined
                        ? propertyName
                        : {
                            ...at(property),
                            kind: "binary",
                            operator: "+",
                            left: text(accessor + " ", property),
                            right: runtimeCall(
                              "propertyFunctionName",
                              [propertyName],
                              property,
                            ),
                          },
                    homeObject: result,
                  },
                )
              : value(propertyValue, propertyName),
            true,
          );
          // The fresh literal has not escaped; its configurable definitions cannot fail.
          if (accessor !== undefined) {
            expression(
              call(
                "createAccessorProperty",
                [
                  result,
                  propertyName,
                  initialized,
                  {
                    ...at(property),
                    kind: "boolean",
                    value: accessor === "set",
                  },
                  member(id("$global"), "hooks", property),
                ],
                property,
              ),
            );
            continue;
          }
          expression(
            call(
              "createDataProperty",
              [
                result,
                propertyName,
                initialized,
                member(id("$global"), "hooks", property),
              ],
              property,
            ),
          );
        }
        return result;
      }
      case "function-expression": {
        const selfName = node.name;
        if (selfName === undefined)
          return callable(node.parameters, node.body, false, node, {
            generator: node.generator,
            resultType: node.returnType,
            async: node.async,
            codeStrict: node.strict ?? strict,
            functionName: inferredName,
          });
        const outerScope = scope;
        const selfBinding = selfBindings.get(node);
        let record: Expression | undefined;
        if (selfBinding !== undefined) {
          reserveLexicalSlot(selfBinding, node, false);
          sloppySelfBindings.add(selfBinding);
        } else {
          const selfRecord = temporary(
            call("createDeclarativeEnvironment", [id("undefined")], node),
          );
          record = selfRecord;
          expression(
            call(
              "createImmutableBinding",
              [
                selfRecord,
                text(selfName, node),
                { ...at(node), kind: "boolean", value: false },
              ],
              node,
            ),
          );
          scope = temporary(
            call("createDeclarativeScope", [outerScope, selfRecord], node),
          );
        }
        const fn = temporary(
          callable(node.parameters, node.body, false, node, {
            generator: node.generator,
            resultType: node.returnType,
            async: node.async,
            codeStrict: node.strict ?? strict,
            functionName: text(selfName, node),
          }),
          true,
        );
        if (selfBinding !== undefined) {
          initializeKnownLexical(selfBinding, fn, node);
          releaseLocalSlots([selfBinding]);
          sloppySelfBindings.delete(selfBinding);
        } else {
          if (record === undefined) throw "SCRIPT_FUNCTION_SELF_INVARIANT";
          expression(
            call("initializeBinding", [record, text(selfName, node), fn], node),
          );
        }
        scope = outerScope;
        return fn;
      }
      case "arrow":
        return callable(node.parameters, node.body, true, node, {
          resultType: node.returnType,
          async: node.async,
          codeStrict: node.strict ?? strict,
          functionName: inferredName,
        });
      case "group":
        return value(node.expression, inferredName);
      case "member":
      case "index": {
        return readAssignment(captureAssignment(node));
      }
      case "new": {
        const target = temporary(value(node.callee), true);
        const args = argumentList(node.arguments, node);
        return checkedRuntimeValue(
          "constructObjectValue",
          [target, args, member(id("$global"), "object", node)],
          node,
        );
      }
      case "call": {
        const numeric = numericCallAt(node);
        if (numeric !== undefined) {
          const checked: Expression[] = [];
          for (const argument of node.arguments) {
            if (argument === undefined) throw "numeric argument invariant";
            const evaluated = temporary(value(argument), true);
            checked.push({
              ...at(argument),
              kind: "satisfies",
              assertion: "as",
              type: named("number"),
              expression: evaluated,
            });
          }
          return runtimeCall(numeric.target, checked, node);
        }
        let target = node.callee;
        while (target.kind === "group") target = target.expression;
        if (target.kind === "super") {
          const context = derivedContext,
            constructor = activeConstructor;
          if (context === undefined || constructor === undefined)
            fail(node, "super call requires a derived constructor context");
          const base = temporary(member(constructor, "prototype", node));
          const args = argumentList(node.arguments, node);
          const result = temporary(
            call(
              "constructSuper",
              [context, base, args, id("undefined")],
              node,
            ),
          );
          check(member(result, "error", node), node);
          return member(result, "value", node);
        }
        const evaluated = callTarget(node.callee, checkMethodCalls);
        const callee = temporary(evaluated.value, true);
        const methodContract = evaluated.contract;
        if (methodContract !== undefined)
          return checkedRuntimeValue(
            "callWithClassMethodContract",
            [
              callee,
              evaluated.receiver,
              argumentList(node.arguments, node),
              methodContract,
              id("$errors"),
            ],
            node,
          );
        if (isDirectEvalCandidate(node))
          return invokeEvalCandidate(
            callee,
            evaluated.receiver,
            node.arguments,
            node,
          );
        const binding =
          target.kind === "identifier"
            ? localBindingReferences.get(target.start)
            : undefined;
        const leaf =
          binding === undefined ? undefined : numericLeaves.get(binding);
        if (leaf !== undefined) {
          const direct = invokeNumericLeaf(
            leaf,
            callee,
            evaluated.receiver,
            node.arguments,
            node,
          );
          if (direct !== undefined) return direct;
        }
        return invoke(callee, evaluated.receiver, node.arguments, node);
      }
      case "conditional": {
        const test = conditionValue(node.test, node);
        const result = temporary(id("undefined", node), true, true);
        const consequent = branchValue(result, node.consequent);
        const alternate = branchValue(result, node.alternate);
        statements.push({
          ...at(node),
          kind: "if",
          test,
          consequent,
          alternate,
        });
        return result;
      }
      case "unary": {
        if (node.operator === "delete") {
          let operand = node.operand;
          while (operand.kind === "group") operand = operand.expression;
          if (operand.kind === "identifier") {
            if (localSlot(operand) !== undefined)
              return { ...at(node), kind: "boolean", value: false };
            return call(
              "deleteBindingReference",
              [reference(operand.name, operand)],
              node,
            );
          }
          if (isOptionalChain(operand))
            return optionalChainValue(operand, true).value;
          if (operand.kind === "member" || operand.kind === "index")
            return deleteAssignment(captureAssignment(operand), node);
          expression(value(operand));
          return { ...at(node), kind: "boolean", value: true };
        }
        if (
          node.operator === "+" ||
          node.operator === "-" ||
          node.operator === "~"
        ) {
          const operand = temporary(value(node.operand), true);
          return unaryOperation(node.operator, operand, node);
        }
        if (node.operator === "!")
          return {
            ...at(node),
            kind: "unary",
            operator: "!",
            operand: conditionValue(node.operand, node),
          };
        if (node.operator === "typeof") {
          let operand = node.operand;
          while (operand.kind === "group") operand = operand.expression;
          let evaluated: Expression;
          if (operand.kind === "identifier") {
            evaluated = identifierValue(operand.name, operand, true);
          } else evaluated = value(operand);
          return objectRuntime(
            "objectValueTypeof",
            [temporary(evaluated, true)],
            node,
          );
        }
        if (node.operator !== "void")
          return fail(
            node,
            "Script unary operator is not implemented: " + node.operator,
          );
        expression(value(node.operand));
        return id("undefined", node);
      }
      case "binary": {
        if (
          !compactResults &&
          (node.operator === "==" ||
            node.operator === "!=" ||
            node.operator === "===" ||
            node.operator === "!==")
        ) {
          const comparison = literalComparison(node);
          if (comparison !== undefined) return comparison;
        }
        if (
          node.operator === "&&" ||
          node.operator === "||" ||
          node.operator === "??"
        ) {
          const result = temporary(value(node.left), true, true);
          const test = logicalTest(node.operator, result, node);
          const consequent = branchValue(result, node.right);
          statements.push({
            ...at(node),
            kind: "if",
            test,
            consequent,
            alternate: undefined,
          });
          return result;
        }
        if (node.operator === ",") {
          expression(value(node.left));
          return value(node.right);
        }
        if (
          node.operator === "instanceof" ||
          node.operator === "in" ||
          node.operator === "==" ||
          node.operator === "!="
        ) {
          const left = temporary(value(node.left), true);
          const right = temporary(value(node.right), true);
          if (
            !compactResults &&
            (node.operator === "==" || node.operator === "!=")
          ) {
            const matches = scalarBranch(
              bothNumbers(left, right, node),
              scalarBinary("===", left, right, node),
              looseEquality(left, right, node),
              node,
            );
            return node.operator === "==" ? matches : negate(matches, node);
          }
          const result = temporary(
            objectRuntime(
              node.operator === "==" || node.operator === "!="
                ? "looselyEqual"
                : node.operator === "in"
                  ? "objectValueHasProperty"
                  : "instanceOfValue",
              [left, right, member(id("$global"), "hooks", node)],
              node,
            ),
          );
          check(member(result, "error", node), node);
          if (node.operator === "!=")
            return {
              ...at(node),
              kind: "unary",
              operator: "!",
              operand: member(result, "value", node),
            };
          return member(result, "value", node);
        }
        if (
          arithmeticOperator(node.operator) ||
          ["<", ">", "<=", ">="].includes(node.operator)
        ) {
          const left = temporary(value(node.left), true);
          const right = temporary(value(node.right), true);
          return binaryOperation(node.operator, left, right, node);
        }
        if (node.operator !== "===" && node.operator !== "!==")
          return fail(
            node,
            "Script binary operator is not implemented: " + node.operator,
          );
        // Capture operands before later effects and retain general encodings:
        // JavaScript permits comparisons of statically disjoint categories.
        const left = temporary(value(node.left), true);
        const right = temporary(value(node.right), true);
        const equal = strictEqual(left, right, node);
        return node.operator === "==="
          ? equal
          : { ...at(node), kind: "unary", operator: "!", operand: equal };
      }
      case "identifier": {
        return identifierValue(node.name, node);
      }
      case "assignment": {
        if (node.target.kind === "object" || node.target.kind === "array") {
          const assigned = temporary(value(node.value), true);
          assignPattern(node.target, assigned);
          return assigned;
        }
        const target = captureAssignment(node.target);
        const assigned = temporary(
          value(node.value, assignmentName(node.target)),
          true,
        );
        writeAssignment(target, assigned);
        return assigned;
      }
      case "compound": {
        const operator = node.operator;
        if (
          !arithmeticOperator(operator) &&
          operator !== "&&" &&
          operator !== "||" &&
          operator !== "??"
        )
          fail(
            node,
            "Script compound operator is not implemented: " + operator,
          );
        const target = captureAssignment(node.target, true);
        const previous = temporary(readAssignment(target), true);
        if (operator === "&&" || operator === "||" || operator === "??") {
          const result = temporary(previous, true, true);
          const test = logicalTest(operator, previous, node);
          const start = statements.length;
          const assigned = temporary(
            value(node.value, assignmentName(node.target)),
            true,
          );
          writeAssignment(target, assigned);
          expression({
            ...at(node),
            kind: "assignment",
            target: result,
            value: assigned,
          });
          const consequent: BlockStatement = {
            ...at(node),
            kind: "block",
            statements: statements.splice(start),
          };
          statements.push({
            ...at(node),
            kind: "if",
            test,
            consequent,
            alternate: undefined,
          });
          return result;
        }
        const right = temporary(value(node.value), true);
        const assigned = temporary(
          binaryOperation(operator, previous, right, node),
          true,
        );
        writeAssignment(target, assigned);
        return assigned;
      }
      case "update": {
        const target = captureAssignment(node.target, true);
        const previous = temporary(readAssignment(target), true);
        return updateAssignment(target, previous, node);
      }
      case "await":
      case "yield": {
        if (
          entryKind === "module" &&
          functionDepth === 0 &&
          node.kind === "await"
        )
          moduleSuspends = true;
        const input = suspensionInput;
        if (input === undefined)
          return fail(node, "suspension requires a native continuation");
        if (node.kind === "await") {
          let operand = node.expression;
          let count = 1;
          for (;;) {
            while (operand.kind === "group") operand = operand.expression;
            if (operand.kind !== "await") break;
            count++;
            operand = operand.expression;
          }
          if (count > 1) return awaitChain(operand, count, node);
        }
        const operand =
          node.expression === undefined
            ? id("undefined")
            : temporary(value(node.expression), true);
        if (node.kind === "await") return awaitLoweredValue(operand, node);
        let yielded =
          asyncGeneratorBody && !node.delegate
            ? awaitLoweredValue(operand, node)
            : operand;
        if (!node.delegate && yieldContract !== 0)
          yielded = temporary(
            checkedContract(yielded, yieldContract, node),
            true,
          );
        statements.push({
          ...at(node),
          kind: "expression",
          expression: {
            ...at(node),
            kind: "yield",
            expression: yielded,
            delegate: node.delegate,
          },
        });
        return temporary(id(input, node), true);
      }
      case "import-call": {
        const specifier = temporary(value(node.specifier), true);
        const options =
          node.options === undefined
            ? id("undefined", node)
            : temporary(value(node.options), true);
        usesImportCall = true;
        const arguments_: Expression[] = [
          specifier,
          options,
          member(id("$global"), "hooks", node),
          id("$errors"),
        ];
        const phase = node.phase;
        if (phase === "source") arguments_.push(text("source", node));
        else if (phase === "defer") arguments_.push(text("defer", node));
        return temporary(
          runtimeCall("evaluateImportCall", arguments_, node),
          true,
        );
      }
      case "import-meta": {
        if (entryKind !== "module") throw "IMPORT_META_GOAL_INVARIANT";
        usesImportMeta = true;
        return temporary(
          runtimeCall("getActiveImportMeta", [id("$errors")], node),
          true,
        );
      }
      default:
        return fail(
          node,
          "Script expression lowering is not implemented: " + node.kind,
        );
    }
  }
  function beginResources(
    children: readonly Statement[],
    span: Span,
  ): ScriptResourceScope | undefined {
    const resources = children.filter(
      (child) => child.kind === "variable" && child.disposal !== undefined,
    );
    if (resources.length === 0) return undefined;
    const asynchronous = resources.some(
      (child) => child.kind === "variable" && child.disposal === "async",
    );
    if (asynchronous && entryKind === "module" && functionDepth === 0)
      moduleSuspends = true;
    if (asynchronous && suspensionInput === undefined)
      fail(span, "async resource disposal requires a native continuation");
    usesDisposal = true;
    usesAsyncDisposal = usesAsyncDisposal || asynchronous;
    const outer = disposalScope,
      resource = temporary(runtimeCall("createLexicalDisposalStack", [], span));
    const failed = temporary(
        { ...at(span), kind: "boolean", value: false },
        false,
        true,
      ),
      thrown = temporary(id("undefined"), true, true);
    disposalScope = resource;
    return {
      outer,
      asynchronous,
      resource,
      failed,
      thrown,
      position: statements.length,
    };
  }
  function finishResources(
    context: ScriptResourceScope | undefined,
    span: Span,
  ): void {
    if (context === undefined) return;
    const body: BlockStatement = {
      ...at(span),
      kind: "block",
      statements: statements.splice(context.position),
    };
    const caught = "$resourceError" + serial++;
    const failure = "$resourceFailure" + serial++;
    usesEngineAborts = true;
    const handler: CatchClause = {
      ...at(span),
      binding: {
        ...at(span),
        name: caught,
        type: undefined,
        initializer: undefined,
      },
      body: {
        ...at(span),
        kind: "block",
        statements: [
          // Engine aborts are not disposal errors; they propagate unwrapped.
          // A stack overflow becomes the RangeError being disposed.
          // Catch parameters are immutable on the managed surface.
          {
            ...at(span),
            kind: "variable",
            mode: "const",
            exported: false,
            declarations: [
              {
                ...at(span),
                name: failure,
                type: named("unknown"),
                initializer: runtimeCall(
                  "rejectEngineAbort",
                  [id("$errors", span), id(caught, span)],
                  span,
                ),
              },
            ],
          },
          {
            ...at(span),
            kind: "expression",
            expression: {
              ...at(span),
              kind: "assignment",
              target: context.failed,
              value: { ...at(span), kind: "boolean", value: true },
            },
          },
          {
            ...at(span),
            kind: "expression",
            expression: {
              ...at(span),
              kind: "assignment",
              target: context.thrown,
              value: id(failure, span),
            },
          },
        ],
      },
    };
    const start = statements.length;
    const cleanup = runtimeCall(
      context.asynchronous
        ? "disposeAsyncLexicalResources"
        : "disposeLexicalResources",
      [
        context.resource,
        context.failed,
        context.thrown,
        id("$errors"),
        member(id("$global"), "hooks", span),
      ],
      span,
    );
    if (context.asynchronous) {
      const completion = temporary(cleanup);
      const branch = statements.length;
      awaitLoweredValue(member(completion, "value", span), span);
      const consequent: BlockStatement = {
        ...at(span),
        kind: "block",
        statements: statements.splice(branch),
      };
      statements.push({
        ...at(span),
        kind: "if",
        test: member(completion, "suspended", span),
        consequent,
        alternate: undefined,
      });
    } else expression(cleanup);
    const finalizer: BlockStatement = {
      ...at(span),
      kind: "block",
      statements: statements.splice(start),
    };
    statements.push({ ...at(span), kind: "try", body, handler, finalizer });
    disposalScope = context.outer;
  }
  function ifBranchStatement(node: Statement): BlockStatement {
    return branchStatement(
      node.kind === "function" && !strict
        ? { ...at(node), kind: "block", statements: [node] }
        : node,
    );
  }
  function branchStatement(node: Statement): BlockStatement {
    const start = statements.length;
    statement(node);
    return { ...at(node), kind: "block", statements: statements.splice(start) };
  }
  function declaredFunction(
    declaration: Statement & { readonly kind: "function" },
  ): Expression {
    const body = declaration.body;
    if (body.kind !== "block")
      fail(body, "Script function body must be a block");
    return callable(declaration.parameters, body, false, declaration, {
      sourceStart: declaration.sourceStart,
      resultType: declaration.returnType,
      generator: declaration.generator,
      async: declaration.async,
      codeStrict: declaration.strict ?? strict,
      functionName: text(declaration.name, declaration),
    });
  }
  function moduleDefaultFunction(
    declaration: ModuleDefaultFunction,
  ): Expression {
    const node = declaration.value;
    return callable(node.parameters, node.body, false, node, {
      generator: node.generator,
      resultType: node.returnType,
      async: node.async,
      codeStrict: node.strict ?? true,
      functionName: text(
        declaration.name === "*default*" ? "default" : declaration.name,
        node,
      ),
    });
  }
  /** Whether a statement list has LexicallyScopedDeclarations (let, const,
   * using, class or block-level function declarations). */
  function blockFunctionSlot(declaration: Span): number | undefined {
    const binding = blockFunctions.get(declaration);
    return binding === undefined || !frameLexicals.has(binding)
      ? undefined
      : binding;
  }
  function declaresLexically(children: readonly Statement[]): boolean {
    for (const child of children) {
      if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
      const declaration = statementFunctionDeclaration(child) ?? child;
      if (
        (declaration.kind === "class" &&
          frameLexicalBinding(declaration) === undefined) ||
        (declaration.kind === "function" &&
          blockFunctionSlot(declaration) === undefined)
      )
        return true;
      if (declaration.kind === "variable" && declaration.mode !== "var")
        for (const binding of declaration.declarations) {
          if (binding === undefined) throw "SCRIPT_DECLARATION_INVARIANT";
          for (const identifier of bindingIdentifiers(binding)) {
            if (identifier === undefined) throw "SCRIPT_BINDING_INVARIANT";
            if (frameLexicalBinding(identifier) === undefined) return true;
          }
        }
    }
    return false;
  }
  function lexicalBindings(
    children: readonly Statement[],
    record: Expression,
  ): void {
    const declarations = children.map(
      (child) => statementFunctionDeclaration(child) ?? child,
    );
    const functions = new Map<
      string,
      Statement & { readonly kind: "function" }
    >();
    for (const child of declarations) {
      if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
      if (child.kind === "function") functions.set(child.name, child);
    }
    const created = new Set<string>();
    // Instantiate all lexical names before executing any statement, retaining
    // TDZ even when a later declaration shadows an initialized outer binding.
    for (const child of declarations) {
      if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
      if (child.kind === "class" || child.kind === "function") {
        if (child.kind === "class" && frameLexicalBinding(child) !== undefined)
          continue;
        if (created.has(child.name)) continue;
        created.add(child.name);
        const fn = functions.get(child.name);
        if (fn !== undefined && blockFunctionSlot(fn) !== undefined) continue;
        expression(
          call(
            "createMutableBinding",
            [
              record,
              text(child.name, child),
              { ...at(child), kind: "boolean", value: false },
            ],
            child,
          ),
        );
        continue;
      }
      if (child.kind !== "variable" || child.mode === "var") continue;
      for (const binding of child.declarations) {
        if (binding === undefined) throw "SCRIPT_DECLARATION_INVARIANT";
        for (const declaration of bindingIdentifiers(binding)) {
          if (declaration === undefined) throw "SCRIPT_BINDING_INVARIANT";
          if (frameLexicalBinding(declaration) !== undefined) continue;
          expression(
            call(
              child.mode === "const"
                ? "createImmutableBinding"
                : "createMutableBinding",
              [
                record,
                text(declaration.name, declaration),
                {
                  ...at(declaration),
                  kind: "boolean",
                  value: child.mode === "const",
                },
              ],
              declaration,
            ),
          );
        }
      }
    }
    // Function objects capture the completed block environment. All names must
    // exist before any function is initialized, including later lexical bindings.
    for (const child of declarations) {
      if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
      if (child.kind === "function" && functions.get(child.name) === child) {
        const binding = blockFunctionSlot(child);
        const fn = declaredFunction(child);
        if (binding === undefined)
          expression(
            call(
              "initializeBinding",
              [record, text(child.name, child), fn],
              child,
            ),
          );
        else initializeKnownLexical(binding, fn, child);
      }
    }
  }
  function iterationContext(
    slots: readonly number[],
    span: Span,
  ):
    | {
        readonly record: Expression;
        readonly type: TypeNode;
        readonly bindings: readonly number[];
        readonly fields: readonly string[];
      }
    | undefined {
    const bindings: number[] = [],
      fields: string[] = [],
      values: Expression[] = [];
    for (const binding of slots) {
      if (binding === undefined) throw "SCRIPT_LOOP_BINDING_INVARIANT";
      if (!capturedBindings.has(binding) || !writtenSlots.has(binding))
        continue;
      const value = localSlots.get(binding);
      if (value === undefined) throw "SCRIPT_LOOP_BINDING_INVARIANT";
      fields.push("value" + bindings.length);
      bindings.push(binding);
      values.push(value);
    }
    if (bindings.length === 0) return undefined;
    const type: TypeNode = {
      ...at(span),
      kind: "object",
      properties: fields.map((name) => ({
        ...at(span),
        name,
        readonly: false,
        type: named("unknown"),
      })),
    };
    return {
      record: temporary(object(fields, values, span), false, true, type),
      type,
      bindings,
      fields,
    };
  }
  function loopTest(test: Expression): void {
    const tested = conditionValue(test, test);
    statements.push({
      ...at(test),
      kind: "if",
      test: {
        ...at(test),
        kind: "unary",
        operator: "!",
        operand: tested,
      },
      consequent: { ...at(test), kind: "break" },
      alternate: undefined,
    });
  }
  function patternDefault(
    incoming: Expression,
    initializer: Expression | undefined,
    name: Expression | undefined,
    span: Span,
  ): Expression {
    if (initializer === undefined) return incoming;
    const initialized = temporary(incoming, true, true);
    const consequent = branchValue(initialized, initializer, name);
    statements.push({
      ...at(span),
      kind: "if",
      test: {
        ...at(span),
        kind: "binary",
        operator: "===",
        left: initialized,
        right: id("undefined", span),
      },
      consequent,
      alternate: undefined,
    });
    return initialized;
  }
  function patternProperty(
    source: Expression,
    key: Expression,
    span: Span,
  ): Expression {
    return temporary(
      checkedRuntimeValue(
        "getObjectValueProperty",
        [source, key, member(id("$global"), "hooks", span), id("$errors")],
        span,
      ),
      true,
    );
  }
  function patternRest(
    source: Expression,
    excluded: readonly Expression[],
    span: Span,
  ): Expression {
    const rest = temporary(
      call(
        "createObject",
        [member(id("$errors"), "objectPrototype", span)],
        span,
      ),
    );
    expression(
      runtimeCall(
        "copyObjectProperties",
        [
          rest,
          source,
          { ...at(span), kind: "array", elements: excluded },
          member(id("$global"), "hooks", span),
          id("$errors"),
        ],
        span,
      ),
    );
    return rest;
  }
  function assignPattern(target: Expression, incoming: Expression): void {
    if (target.kind === "array") {
      const iterator = temporary(
        runtimeCall(
          "getScriptIterator",
          [incoming, id("$errors"), member(id("$global"), "hooks", target)],
          target,
        ),
      );
      const start = statements.length;
      for (const element of target.elements) {
        if (element === undefined) throw "SCRIPT_ARRAY_PATTERN_INVARIANT";
        if (element.kind === "elision") {
          expression(runtimeCall("skipScriptIterator", [iterator], element));
          continue;
        }
        const destination =
          element.kind === "spread"
            ? element.value
            : element.kind === "assignment"
              ? element.target
              : element;
        const reference =
          destination.kind === "object" || destination.kind === "array"
            ? undefined
            : captureAssignment(destination);
        let item: Expression;
        if (element.kind === "spread") {
          item = temporary(
            runtimeCall(
              "collectScriptIterator",
              [
                iterator,
                id("$errors"),
                member(id("$global"), "hooks", element),
              ],
              element,
            ),
          );
        } else {
          const step = temporary(
            runtimeCall("stepScriptIterator", [iterator], element),
          );
          item = member(step, "value", element);
        }
        const initialized = patternDefault(
          item,
          element.kind === "assignment" ? element.value : undefined,
          assignmentName(destination),
          element,
        );
        if (reference === undefined) assignPattern(destination, initialized);
        else writeAssignment(reference, initialized);
      }
      const body: BlockStatement = {
        ...at(target),
        kind: "block",
        statements: statements.splice(start),
      };
      statements.push(withIteratorCleanup(iterator, body, target));
      return;
    }

    if (target.kind !== "object") {
      writeAssignment(captureAssignment(target), incoming);
      return;
    }
    expression(
      runtimeCall("requireObjectCoercible", [incoming, id("$errors")], target),
    );
    const excluded: Expression[] = [];
    for (const property of target.properties) {
      if (property === undefined) throw "SCRIPT_ASSIGNMENT_PATTERN_INVARIANT";
      if (property.kind === "spread") {
        const reference = captureAssignment(property.value);
        writeAssignment(reference, patternRest(incoming, excluded, property));
        continue;
      }
      const key =
        property.keyExpression === undefined
          ? text(property.name, property)
          : temporary(
              checkedOperatorValue(
                "objectPropertyKey",
                [incoming, temporary(value(property.keyExpression), true)],
                property,
              ),
            );
      excluded.push(key);
      const element = property.value;
      const destination =
        element.kind === "assignment" ? element.target : element;
      const initializer =
        element.kind === "assignment" ? element.value : undefined;
      // Capture references before GetV; nested patterns begin after the read/default.
      const reference =
        destination.kind === "object" || destination.kind === "array"
          ? undefined
          : captureAssignment(destination);
      const item = patternProperty(incoming, key, property);
      const initialized = patternDefault(
        item,
        initializer,
        assignmentName(destination),
        element,
      );
      if (reference === undefined) assignPattern(destination, initialized);
      else writeAssignment(reference, initialized);
    }
  }
  function initializePattern(
    binding: VariableBinding,
    incoming: Expression,
    mode: "let" | "const" | "var",
    useDefault: boolean,
    capturedReference: AssignmentReference | undefined = undefined,
  ): void {
    if (binding.kind === "array-binding") {
      const initialized = patternDefault(
        incoming,
        useDefault ? binding.initializer : undefined,
        undefined,
        binding,
      );
      const iterator = temporary(
        runtimeCall(
          "getScriptIterator",
          [initialized, id("$errors"), member(id("$global"), "hooks", binding)],
          binding,
        ),
      );
      const start = statements.length;
      for (const element of binding.elements) {
        if (element === undefined) {
          expression(runtimeCall("skipScriptIterator", [iterator], binding));
        } else {
          const target = patternReference(element, mode);
          const step = temporary(
            runtimeCall("stepScriptIterator", [iterator], element),
          );
          initializePattern(
            element,
            member(step, "value", element),
            mode,
            true,
            target,
          );
        }
      }
      const rest = binding.rest;
      if (rest !== undefined) {
        const target = patternReference(rest, mode);
        const remaining = temporary(
          runtimeCall(
            "collectScriptIterator",
            [iterator, id("$errors"), member(id("$global"), "hooks", rest)],
            rest,
          ),
        );
        initializePattern(rest, remaining, mode, false, target);
      }
      const body: BlockStatement = {
        ...at(binding),
        kind: "block",
        statements: statements.splice(start),
      };
      statements.push(withIteratorCleanup(iterator, body, binding));
      return;
    }
    const target =
      binding.kind !== "object-binding" && mode === "var"
        ? (capturedReference ?? declareVariableTarget(binding.name, binding))
        : undefined;
    const initialized = patternDefault(
      incoming,
      useDefault ? binding.initializer : undefined,
      binding.kind === "object-binding"
        ? undefined
        : text(binding.name, binding),
      binding,
    );
    if (binding.kind !== "object-binding") {
      if (mode === "var") {
        if (target === undefined) throw "SCRIPT_PATTERN_REFERENCE_INVARIANT";
        writeAssignment(target, initialized);
      } else if (!initializeLexicalSlot(initialized, binding))
        expression(
          call(
            "initializeBinding",
            [lexical, text(binding.name, binding), initialized],
            binding,
          ),
        );
      return;
    }
    expression(
      runtimeCall(
        "requireObjectCoercible",
        [initialized, id("$errors")],
        binding,
      ),
    );
    const excluded: Expression[] = [];
    for (const property of binding.properties) {
      if (property === undefined) throw "SCRIPT_PATTERN_PROPERTY_INVARIANT";
      const key =
        property.keyExpression === undefined
          ? text(property.name, property)
          : temporary(
              checkedOperatorValue(
                "objectPropertyKey",
                [initialized, temporary(value(property.keyExpression), true)],
                property,
              ),
            );
      excluded.push(key);
      // Resolve simple var destinations before GetV or their default initializer.
      const target = patternReference(property.binding, mode);
      const item = patternProperty(initialized, key, property);
      initializePattern(property.binding, item, mode, true, target);
    }
    const restBinding = binding.rest;
    if (restBinding !== undefined) {
      const target = patternReference(restBinding, mode);
      const rest = patternRest(initialized, excluded, binding);
      initializePattern(restBinding, rest, mode, false, target);
    }
  }

  function patternReference(
    binding: VariableBinding,
    mode: "let" | "const" | "var",
  ): AssignmentReference | undefined {
    return mode === "var" &&
      binding.kind !== "object-binding" &&
      binding.kind !== "array-binding"
      ? declareVariableTarget(binding.name, binding)
      : undefined;
  }

  function awaitLoweredValue(operand: Expression, span: Span): Expression {
    const input = suspensionInput;
    if (input === undefined)
      return fail(span, "await requires a native continuation");
    const marker: Expression = asyncGeneratorBody
      ? { ...at(span), kind: "await", expression: operand }
      : { ...at(span), kind: "yield", expression: operand, delegate: false };
    statements.push({ ...at(span), kind: "expression", expression: marker });
    return temporary(id(input, span), true);
  }
  /** Each await still suspends independently. Reusing one continuation loop
   * keeps nested await expressions from expanding the generated syntax depth. */
  function awaitChain(
    operand: Expression,
    count: number,
    span: Span,
  ): Expression {
    const held = temporary(value(operand), true, true);
    const remaining = temporary(
      { ...at(span), kind: "number", value: count, raw: String(count) },
      false,
      true,
      named("number"),
    );
    const start = statements.length;
    const resumed = awaitLoweredValue(held, span);
    expression({
      ...at(span),
      kind: "assignment",
      target: held,
      value: resumed,
    });
    expression({
      ...at(span),
      kind: "assignment",
      target: remaining,
      value: {
        ...at(span),
        kind: "binary",
        operator: "-",
        left: remaining,
        right: { ...at(span), kind: "number", value: 1, raw: "1" },
      },
    });
    const body: BlockStatement = {
      ...at(span),
      kind: "block",
      statements: statements.splice(start),
    };
    statements.push({
      ...at(span),
      kind: "while",
      test: {
        ...at(span),
        kind: "binary",
        operator: ">",
        left: remaining,
        right: { ...at(span), kind: "number", value: 0, raw: "0" },
      },
      body,
    });
    return held;
  }
  function asyncIteratorCloseBlock(
    iterator: Expression,
    span: Span,
  ): BlockStatement {
    const start = statements.length;
    const close = temporary(
      runtimeCall("beginScriptAsyncIteratorClose", [iterator], span),
    );
    const branch = statements.length;
    const result = awaitLoweredValue(member(close, "value", span), span);
    statements.push({
      ...at(span),
      kind: "expression",
      expression: runtimeCall(
        "finishScriptAsyncIteratorClose",
        [iterator, result],
        span,
      ),
    });
    const consequent: BlockStatement = {
      ...at(span),
      kind: "block",
      statements: statements.splice(branch),
    };
    statements.push({
      ...at(span),
      kind: "if",
      test: member(close, "needed", span),
      consequent,
      alternate: undefined,
    });
    return { ...at(span), kind: "block", statements: statements.splice(start) };
  }
  function closeIteratorStatement(
    iterator: Expression,
    throwing: boolean,
    span: Span,
  ): Statement {
    return {
      ...at(span),
      kind: "expression",
      expression: runtimeCall(
        "closeScriptIterator",
        [iterator, { ...at(span), kind: "boolean", value: throwing }],
        span,
      ),
    };
  }
  function withIteratorCleanup(
    iterator: Expression,
    body: BlockStatement,
    span: Span,
    asynchronous: boolean = false,
  ): Statement {
    const caught = "$iteratorError" + serial++;
    let closeOnThrow: Statement = closeIteratorStatement(iterator, true, span);
    if (asynchronous) {
      const ignored: CatchClause = {
        ...at(span),
        binding: undefined,
        body: { ...at(span), kind: "block", statements: [] },
      };
      closeOnThrow = {
        ...at(span),
        kind: "try",
        body: asyncIteratorCloseBlock(iterator, span),
        handler: ignored,
        finalizer: undefined,
      };
    }
    const caughtBody: BlockStatement = {
      ...at(span),
      kind: "block",
      statements: [
        closeOnThrow,
        { ...at(span), kind: "throw", expression: id(caught, span) },
      ],
    };
    const handler: CatchClause = {
      ...at(span),
      binding: {
        ...at(span),
        name: caught,
        type: undefined,
        initializer: undefined,
      },
      body: caughtBody,
    };
    const finalizer: BlockStatement = asynchronous
      ? asyncIteratorCloseBlock(iterator, span)
      : {
          ...at(span),
          kind: "block",
          statements: [closeIteratorStatement(iterator, false, span)],
        };
    return {
      ...at(span),
      kind: "try",
      body,
      handler,
      finalizer,
    };
  }
  function labelled(node: Statement, names: readonly string[]): Statement {
    let result = node;
    for (let i = names.length - 1; i >= 0; i--) {
      const name = names[i];
      if (name === undefined) throw "SCRIPT_LABEL_INVARIANT";
      result = { ...at(node), kind: "label", name, body: result };
    }
    return result;
  }
  function statement(input: Statement, labels: readonly string[] = []): void {
    // Helper closures capture this node; keep its discriminated view immutable
    // so native checking can retain variant facts across helper calls.
    const node = input;
    if (entryKind === "module") {
      if (node.kind === "import" || node.kind === "export") return;
      if (node.kind === "export-default") {
        const value_ = node.value;
        if (node.declaration && value_.kind === "function-expression") return;
        const name =
          node.declaration && value_.kind === "class-expression"
            ? (value_.definition.name ?? "*default*")
            : "*default*";
        const initialized =
          node.declaration && value_.kind === "class-expression"
            ? classValue(
                value_.definition,
                text(value_.definition.name ?? "default", node),
              )
            : value(value_, text("default", node));
        expression(
          call(
            "initializeBinding",
            [lexical, text(name, node), initialized],
            node,
          ),
        );
        return;
      }
    }
    if (node.kind === "label") {
      const nested = labels.slice();
      nested.push(node.name);
      statement(node.body, nested);
      return;
    }
    if (
      labels.length !== 0 &&
      ![
        "for",
        "while",
        "do-while",
        "for-of",
        "for-in",
        "for-of-assignment",
        "for-in-assignment",
      ].includes(node.kind)
    ) {
      statements.push(labelled(branchStatement(node), labels));
      return;
    }
    if (node.kind === "with") {
      const outerScope = scope;
      const object = temporary(value(node.object), true);
      scope = temporary(
        runtimeCall(
          "createWithScope",
          [outerScope, object, id("$errors")],
          node,
        ),
        false,
        true,
      );
      resetCompletion(node);
      statement(node.body);
      scope = outerScope;
      return;
    }
    if (
      node.kind === "for-of" ||
      node.kind === "for-in" ||
      node.kind === "for-in-assignment" ||
      node.kind === "for-of-assignment"
    ) {
      const asynchronous = node.await ?? false;
      if (asynchronous && entryKind === "module" && functionDepth === 0)
        moduleSuspends = true;
      let binding: VariableBinding | undefined;
      if (node.kind === "for-in" || node.kind === "for-of") {
        binding = node.binding;
      }
      const outerScope = scope,
        outerLexical = lexical;
      let declaration: Statement | undefined;
      if (
        (node.kind === "for-in" || node.kind === "for-of") &&
        binding !== undefined
      )
        declaration = {
          ...at(binding),
          kind: "variable",
          mode: node.mode,
          disposal: node.disposal,
          declarations:
            binding.kind === "array-binding"
              ? bindingIdentifiers(binding)
              : [binding],
          exported: false,
        };
      function iterationLexical(declaration: Statement): number[] {
        const slots = reserveLexicalSlots([declaration]);
        if (declaresLexically([declaration])) {
          lexical = temporary(
            call("createDeclarativeEnvironment", [id("undefined")], node),
          );
          scope = temporary(
            call("createDeclarativeScope", [outerScope, lexical], node),
          );
          lexicalBindings([declaration], lexical);
        }
        return slots;
      }
      const tdzSlots =
        (node.kind === "for-in" || node.kind === "for-of") &&
        node.mode !== "var" &&
        declaration !== undefined
          ? iterationLexical(declaration)
          : [];
      // Annex B var initializers execute once, before evaluating the RHS,
      // including when enumeration produces no keys.
      if (
        node.kind === "for-in" &&
        node.mode === "var" &&
        binding?.initializer !== undefined &&
        declaration !== undefined
      )
        statement(declaration);
      const source = temporary(value(node.iterable), true);
      releaseLocalSlots(tdzSlots);
      scope = outerScope;
      lexical = outerLexical;
      let iterator: Expression;
      if (node.kind === "for-of" || node.kind === "for-of-assignment") {
        iterator = temporary(
          runtimeCall(
            asynchronous ? "getScriptAsyncIterator" : "getScriptIterator",
            [source, id("$errors"), member(id("$global"), "hooks", node)],
            node,
          ),
        );
      } else {
        const prepared = temporary(
          runtimeCall(
            "enumerateObjectValue",
            [source, member(id("$global"), "hooks", node), id("$errors")],
            node,
          ),
        );
        check(member(prepared, "error", node), node);
        iterator = temporary(member(prepared, "value", node));
      }
      resetCompletion(node);
      const start = statements.length;
      let key: Expression;
      let exhausted: Expression;
      if (node.kind === "for-of" || node.kind === "for-of-assignment") {
        const step = asynchronous
          ? temporary(
              runtimeCall(
                "finishScriptAsyncIteratorStep",
                [
                  iterator,
                  awaitLoweredValue(
                    runtimeCall("nextScriptAsyncIterator", [iterator], node),
                    node,
                  ),
                ],
                node,
              ),
            )
          : temporary(runtimeCall("stepScriptIterator", [iterator], node));
        key = member(step, "value", node);
        exhausted = member(step, "done", node);
      } else {
        key = temporary(call("nextEnumerableProperty", [iterator], node));
        exhausted = {
          ...at(node),
          kind: "binary",
          operator: "===",
          left: key,
          right: id("undefined"),
        };
      }
      statements.push({
        ...at(node),
        kind: "if",
        test: exhausted,
        consequent: { ...at(node), kind: "break" },
        alternate: undefined,
      });
      // Each iteration owns its resources. The enclosing iterator cleanup runs
      // after this scope unwinds, including on break and registration failure.
      const resources = beginResources(
        declaration === undefined ? [] : [declaration],
        node,
      );
      if (resources !== undefined) {
        key = temporary(
          runtimeCall(
            declaration?.kind === "variable" && declaration.disposal === "async"
              ? "registerAsyncLexicalDisposable"
              : "registerLexicalDisposable",
            [
              resources.resource,
              key,
              id("$errors"),
              member(id("$global"), "hooks", node),
            ],
            node,
          ),
          true,
        );
      }
      let iterationSlots: number[] = [];
      if (
        node.kind === "for-in-assignment" ||
        node.kind === "for-of-assignment"
      )
        assignPattern(node.target, key);
      else if (
        (node.kind === "for-in" || node.kind === "for-of") &&
        node.mode === "var" &&
        binding !== undefined
      )
        initializePattern(binding, key, "var", false);
      else if (
        (node.kind === "for-in" || node.kind === "for-of") &&
        binding !== undefined &&
        declaration !== undefined
      ) {
        iterationSlots = iterationLexical(declaration);
        initializePattern(binding, key, node.mode, false);
        for (const slot of iterationSlots) {
          if (slot === undefined) throw "SCRIPT_ITERATION_BINDING_INVARIANT";
          finalizeLexicalSlot(slot);
        }
      } else throw "SCRIPT_ITERATION_BINDING_INVARIANT";
      statement(node.body);
      finishResources(resources, node);
      releaseLocalSlots(iterationSlots);
      const body: BlockStatement = {
        ...at(node),
        kind: "block",
        statements: statements.splice(start),
      };
      const loop: Statement = {
        ...at(node),
        kind: "while",
        test: { ...at(node), kind: "boolean", value: true },
        body,
      };
      if (node.kind === "for-of" || node.kind === "for-of-assignment") {
        const loopBody: BlockStatement = {
          ...at(node),
          kind: "block",
          statements: [labelled(loop, labels)],
        };
        statements.push(
          withIteratorCleanup(iterator, loopBody, node, asynchronous),
        );
      } else statements.push(labelled(loop, labels));
      scope = outerScope;
      lexical = outerLexical;
      return;
    }
    if (node.kind === "class") {
      const record = lexical;
      const constructed = classValue(node.definition, text(node.name, node));
      if (!initializeLexicalSlot(constructed, node))
        expression(
          call(
            "initializeBinding",
            [record, text(node.name, node), constructed],
            node,
          ),
        );
      return;
    }
    if (
      node.kind === "for" ||
      node.kind === "while" ||
      node.kind === "do-while"
    ) {
      const outerScope = scope,
        outerLexical = lexical;
      const initializer = node.kind === "for" ? node.initializer : undefined;
      const iterationNames: string[] = [];
      const initializedSlots: number[] = [];
      let resources: ScriptResourceScope | undefined;
      if (initializer !== undefined) {
        if (initializer.kind === "variable" && initializer.mode !== "var") {
          const copy =
            initializer.mode === "let" &&
            copyLoopEnvironments.has(node.start) &&
            (initializer.disposal !== undefined ||
              initializer.declarations.some(
                (declaration) =>
                  declaration === undefined ||
                  declaration.kind === "object-binding" ||
                  declaration.kind === "array-binding" ||
                  declaration.type !== undefined ||
                  !localBindingDeclarations.has(declaration.start) ||
                  bindingContracts.has(declaration.start) ||
                  bindingRecordContracts.has(declaration.start),
              ));
          if (!copy)
            for (const binding of reserveLexicalSlots([initializer])) {
              if (binding === undefined) throw "SCRIPT_BINDING_INVARIANT";
              initializedSlots.push(binding);
            }
          if (declaresLexically([initializer])) {
            lexical = temporary(
              call("createDeclarativeEnvironment", [id("undefined")], node),
              false,
              true,
            );
            scope = temporary(
              call("createDeclarativeScope", [outerScope, lexical], node),
              false,
              true,
            );
            lexicalBindings([initializer], lexical);
          }
          if (copy) {
            for (const binding of initializer.declarations) {
              if (binding === undefined) throw "SCRIPT_BINDING_INVARIANT";
              for (const identifier of bindingIdentifiers(binding)) {
                if (identifier === undefined) throw "SCRIPT_BINDING_INVARIANT";
                iterationNames.push(identifier.name);
              }
            }
          }
        }
        resources = beginResources([initializer], node);
        statement(initializer);
        if (iterationNames.length === 0)
          localizeInitialized(initializer, initializedSlots);
      }
      // The initializer's cells remain distinct from the first body turn.
      // Each iteration captures its own fixed record, while the carried
      // pointer is updated before the increment, including after continue.
      const fixed = iterationContext(initializedSlots, node);
      resetCompletion(node);
      const first = temporary(
        { ...at(node), kind: "boolean", value: true },
        false,
        true,
      );
      const start = statements.length;
      if (fixed !== undefined) {
        const record = fixed.record;
        const next = temporary(
          object(
            fixed.fields,
            fixed.fields.map((field) => member(record, field, node)),
            node,
          ),
          false,
          false,
          fixed.type,
        );
        storeSlot(record, next, node);
        for (let i = 0; i < fixed.bindings.length; i++) {
          const binding = fixed.bindings[i],
            field = fixed.fields[i];
          if (binding === undefined || field === undefined)
            throw "SCRIPT_LOOP_BINDING_INVARIANT";
          localSlots.set(binding, member(next, field, node));
        }
      }
      if (iterationNames.length !== 0) {
        const next = temporary(
          call("createDeclarativeEnvironment", [id("undefined")], node),
        );
        for (const name of iterationNames) {
          if (name === undefined) throw "SCRIPT_BINDING_INVARIANT";
          expression(
            call(
              "createMutableBinding",
              [
                next,
                text(name, node),
                { ...at(node), kind: "boolean", value: false },
              ],
              node,
            ),
          );
          const previous = temporary(
            call("getBindingValue", [lexical, text(name, node)], node),
          );
          check(member(previous, "error", node), node);
          expression(
            call(
              "initializeBinding",
              [next, text(name, node), member(previous, "value", node)],
              node,
            ),
          );
        }
        expression({
          ...at(node),
          kind: "assignment",
          target: lexical,
          value: next,
        });
        expression({
          ...at(node),
          kind: "assignment",
          target: scope,
          value: call("createDeclarativeScope", [outerScope, next], node),
        });
      }
      // Put the increment (and do-while test) at the next loop entry. Native
      // continue, including one unwinding finally, then reaches it naturally.
      const laterStart = statements.length;
      if (node.kind === "for") {
        const update = node.update;
        if (update !== undefined) expression(value(update));
      } else if (node.kind === "do-while") {
        loopTest(node.test);
      }
      const later: BlockStatement = {
        ...at(node),
        kind: "block",
        statements: statements.splice(laterStart),
      };
      statements.push({
        ...at(node),
        kind: "if",
        test: { ...at(node), kind: "unary", operator: "!", operand: first },
        consequent: later,
        alternate: undefined,
      });
      expression({
        ...at(node),
        kind: "assignment",
        target: first,
        value: { ...at(node), kind: "boolean", value: false },
      });
      if (node.kind !== "do-while") {
        const test = node.test;
        if (test !== undefined) loopTest(test);
      }
      statement(node.body);
      const body: BlockStatement = {
        ...at(node),
        kind: "block",
        statements: statements.splice(start),
      };
      statements.push(
        labelled(
          {
            ...at(node),
            kind: "while",
            test: { ...at(node), kind: "boolean", value: true },
            body,
          },
          labels,
        ),
      );
      finishResources(resources, node);
      releaseLocalSlots(initializedSlots);
      scope = outerScope;
      lexical = outerLexical;
      return;
    }
    if (node.kind === "block") {
      const start = statements.length;
      const outerScope = scope,
        outerLexical = lexical;
      const blockSlots = reserveLexicalSlots(node.statements);
      // Without lexically scoped declarations, BlockDeclarationInstantiation
      // binds nothing, so the block environment is unobservable: resolution
      // and a direct eval's own environment chain past an empty one
      // identically. Skip it (2^21 empty blocks are ~1 KB of code each).
      const recordNeeded = declaresLexically(node.statements);
      if (recordNeeded) {
        const record = temporary(
          call("createDeclarativeEnvironment", [id("undefined")], node),
        );
        scope = temporary(
          call("createDeclarativeScope", [outerScope, record], node),
        );
        lexical = record;
      }
      if (recordNeeded || blockSlots.length !== 0)
        lexicalBindings(node.statements, lexical);
      const resources = beginResources(node.statements, node);
      for (const child of node.statements) {
        if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
        statement(child);
        localizeInitialized(child, blockSlots);
      }
      finishResources(resources, node);
      releaseLocalSlots(blockSlots);
      scope = outerScope;
      lexical = outerLexical;
      const body = statements.splice(start);
      // A block that lowers to nothing (no environment, no statements) leaves
      // no statement: its completion is empty, which never updates the
      // enclosing value, and labels or branches collect an empty body.
      if (body.length !== 0)
        statements.push({ ...at(node), kind: "block", statements: body });
      return;
    }
    if (node.kind === "switch") {
      // The discriminant is evaluated outside the shared CaseBlock environment.
      const discriminant = temporary(value(node.expression), true);
      const outerScope = scope,
        outerLexical = lexical;
      const children: Statement[] = [];
      for (const clause of node.clauses) {
        if (clause === undefined) throw "SCRIPT_CLAUSE_INVARIANT";
        for (const child of clause.statements) {
          if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
          children.push(child);
        }
      }
      for (const child of children) {
        if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
        if (child.kind === "variable" && child.disposal !== undefined)
          fail(child, "resource disposal in switch clauses is not implemented");
      }
      const slots = reserveLexicalSlots(children);
      if (declaresLexically(children)) {
        lexical = temporary(
          call("createDeclarativeEnvironment", [id("undefined")], node),
        );
        scope = temporary(
          call("createDeclarativeScope", [outerScope, lexical], node),
        );
      }
      lexicalBindings(children, lexical);
      resetCompletion(node);
      const noMatch: Expression = {
        ...at(node),
        kind: "number",
        value: -1,
        raw: "-1",
      };
      const selected = temporary(noMatch, false, true);
      let fallback = -1;
      for (let i = 0; i < node.clauses.length; i++) {
        const clause = node.clauses[i];
        if (clause === undefined) throw "SCRIPT_CLAUSE_INVARIANT";
        const test = clause.test;
        if (test === undefined) {
          fallback = i;
          continue;
        }
        const start = statements.length;
        const tested = temporary(value(test), true);
        const index: Expression = {
          ...at(clause),
          kind: "number",
          value: i,
          raw: "" + i,
        };
        const setSelected: Statement = {
          ...at(clause),
          kind: "expression",
          expression: {
            ...at(clause),
            kind: "assignment",
            target: selected,
            value: index,
          },
        };
        statements.push({
          ...at(clause),
          kind: "if",
          test: runtimeCall(
            "scriptStrictEqual",
            [discriminant, tested],
            clause,
          ),
          consequent: setSelected,
          alternate: undefined,
        });
        const testing: BlockStatement = {
          ...at(clause),
          kind: "block",
          statements: statements.splice(start),
        };
        statements.push({
          ...at(clause),
          kind: "if",
          test: {
            ...at(clause),
            kind: "binary",
            operator: "===",
            left: selected,
            right: noMatch,
          },
          consequent: testing,
          alternate: undefined,
        });
      }
      if (fallback !== -1) {
        const index: Expression = {
          ...at(node),
          kind: "number",
          value: fallback,
          raw: "" + fallback,
        };
        const assign: Expression = {
          ...at(node),
          kind: "assignment",
          target: selected,
          value: index,
        };
        statements.push({
          ...at(node),
          kind: "if",
          test: {
            ...at(node),
            kind: "binary",
            operator: "===",
            left: selected,
            right: noMatch,
          },
          consequent: { ...at(node), kind: "expression", expression: assign },
          alternate: undefined,
        });
      }
      const clauses: SwitchClause[] = [];
      for (let i = 0; i < node.clauses.length; i++) {
        const clause = node.clauses[i];
        if (clause === undefined) throw "SCRIPT_CLAUSE_INVARIANT";
        const start = statements.length;
        for (const child of clause.statements) {
          if (child === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
          statement(child);
        }
        const index: Expression = {
          ...at(clause),
          kind: "number",
          value: i,
          raw: "" + i,
        };
        clauses.push({
          ...at(clause),
          test: index,
          statements: statements.splice(start),
        });
      }
      statements.push({
        ...at(node),
        kind: "switch",
        expression: selected,
        clauses,
      });
      releaseLocalSlots(slots);
      scope = outerScope;
      lexical = outerLexical;
      return;
    }
    if (node.kind === "break" || node.kind === "continue") {
      statements.push({
        ...at(node),
        kind: node.kind,
        label: node.label,
      });
      return;
    }
    if (node.kind === "try") {
      resetCompletion(node);
      const body = branchStatement(node.body);
      let handler: CatchClause | undefined;
      if (node.handler !== undefined) {
        const clause = node.handler;
        const caught = "$caught" + serial++;
        const start = statements.length;
        const outerScope = scope;
        const outerLexical = lexical;
        const outerCatchRecords = catchRecords;
        catchRecords = catchRecords.slice();
        // Engine aborts (heap exhaustion) propagate without running the
        // handler; a stack overflow is caught as a RangeError.
        // Catch parameters are immutable on the managed surface, so the
        // converted value gets its own binding.
        usesEngineAborts = true;
        const converted = temporary(
          runtimeCall(
            "rejectEngineAbort",
            [id("$errors", clause), id(caught, clause)],
            clause,
          ),
          true,
        );
        resetCompletion(clause);
        const catchSlots: number[] = [];
        if (clause.binding !== undefined) {
          const binding = clause.binding;
          reservePatternSlots(binding, catchSlots);
          const names = bindingIdentifiers(binding).filter(
            (identifier) =>
              identifier !== undefined &&
              frameLexicalBinding(identifier) === undefined,
          );
          if (names.length !== 0) {
            const record = temporary(
              call("createDeclarativeEnvironment", [id("undefined")], clause),
            );
            scope = temporary(
              call("createDeclarativeScope", [outerScope, record], clause),
            );
            lexical = record;
            catchRecords.push(record);
            for (const identifier of names) {
              if (identifier === undefined)
                throw "SCRIPT_CATCH_BINDING_INVARIANT";
              expression(
                call(
                  "createMutableBinding",
                  [
                    record,
                    text(identifier.name, identifier),
                    { ...at(identifier), kind: "boolean", value: false },
                  ],
                  identifier,
                ),
              );
            }
          }
          initializePattern(binding, converted, "let", false);
          for (const slot of catchSlots) {
            if (slot === undefined) throw "SCRIPT_CATCH_BINDING_INVARIANT";
            finalizeLexicalSlot(slot);
          }
        }
        statement(clause.body);
        releaseLocalSlots(catchSlots);
        scope = outerScope;
        lexical = outerLexical;
        catchRecords = outerCatchRecords;
        const caughtBody: BlockStatement = {
          ...at(clause),
          kind: "block",
          statements: statements.splice(start),
        };
        handler = {
          ...at(clause),
          binding: {
            ...at(clause),
            name: caught,
            type: undefined,
            initializer: undefined,
          },
          body: caughtBody,
        };
      }
      let finalizer: BlockStatement | undefined;
      const sourceFinalizer = node.finalizer;
      if (sourceFinalizer !== undefined) {
        const start = statements.length;
        // The Finally completion F starts empty: an abrupt F carries only its
        // own statement-list value (UpdateEmpty(F, undefined)), while a
        // normal F restores the Block/Catch completion C below.
        const saved = temporary(id("$completion", node), true);
        resetCompletion(sourceFinalizer);
        statement(sourceFinalizer);
        resetCompletion(node, saved);
        finalizer = {
          ...at(sourceFinalizer),
          kind: "block",
          statements: statements.splice(start),
        };
      }
      statements.push({ ...at(node), kind: "try", body, handler, finalizer });
      return;
    }
    if (node.kind === "if") {
      const test = conditionValue(node.test, node);
      // IfStatement applies UpdateEmpty(undefined), so an empty selected arm
      // must not retain a preceding statement-list completion value.
      expression({
        ...at(node),
        kind: "assignment",
        target: id("$completion"),
        value: id("undefined"),
      });
      const consequent = ifBranchStatement(node.consequent);
      const alternative = node.alternate;
      const alternate =
        alternative === undefined ? undefined : ifBranchStatement(alternative);
      statements.push({ ...at(node), kind: "if", test, consequent, alternate });
      return;
    }
    if (node.kind === "function") {
      const annexCopy = annexCopies.find(
        (copy) => copy !== undefined && copy.node === node,
      );
      if (annexCopy !== undefined) {
        const start = statements.length;
        const blockBinding = blockFunctionSlot(node);
        let initialized =
          blockBinding === undefined ? undefined : localSlots.get(blockBinding);
        if (initialized === undefined) {
          const result = temporary(
            call("getBindingValue", [lexical, text(node.name, node)], node),
          );
          check(member(result, "error", node), node);
          initialized = member(result, "value", node);
        }
        const functionValue = initialized;
        const owner = annexCopy.owner;
        if (owner !== undefined)
          for (const binding of functionVariables.get(owner.end) ?? []) {
            if (binding === undefined) throw "SCRIPT_VARIABLE_SLOT_INVARIANT";
            const slot = localSlots.get(binding);
            if (
              boundBindings[binding]?.name !== node.name ||
              slot === undefined
            )
              continue;
            storeSlot(slot, functionValue, node);
            return;
          }
        const record = annexVariableRecord;
        const copy = (target: Expression | undefined): Expression =>
          target === undefined
            ? call(
                "setGlobalBinding",
                [
                  id("$global"),
                  text(node.name, node),
                  functionValue,
                  { ...at(node), kind: "boolean", value: false },
                ],
                node,
              )
            : call(
                "setMutableBinding",
                [
                  target,
                  text(node.name, node),
                  functionValue,
                  { ...at(node), kind: "boolean", value: false },
                ],
                node,
              );
        if (record === undefined && entryKind === "direct-eval") {
          // B.3.2.3 copies into the eval caller's VariableEnvironment: the
          // enclosing function's record, or the global object at top level.
          const variables = temporary(
            member(member(id("$site"), "variables", node), "declarative", node),
          );
          const local = statements.length;
          check(temporary(copy(variables)), node);
          const declarative: BlockStatement = {
            ...at(node),
            kind: "block",
            statements: statements.splice(local),
          };
          check(temporary(copy(undefined)), node);
          const global: BlockStatement = {
            ...at(node),
            kind: "block",
            statements: statements.splice(local),
          };
          statements.push({
            ...at(node),
            kind: "if",
            test: {
              ...at(node),
              kind: "binary",
              operator: "!==",
              left: variables,
              right: id("undefined", node),
            },
            consequent: declarative,
            alternate: global,
          });
        } else check(temporary(copy(record)), node);
        if (record === undefined) {
          const admission = annexAdmissions.get(node.name);
          if (admission === undefined) throw "SCRIPT_ANNEX_ADMISSION_INVARIANT";
          const consequent: BlockStatement = {
            ...at(node),
            kind: "block",
            statements: statements.splice(start),
          };
          statements.push({
            ...at(node),
            kind: "if",
            test: member(admission, "admitted", node),
            consequent,
            alternate: undefined,
          });
        }
      }
      return;
    }
    if (node.kind === "return") {
      if (functionDepth === 0) fail(node, "return outside function");
      const operand = node.expression;
      const returned =
        operand === undefined
          ? id("undefined", node)
          : asyncGeneratorBody
            ? value({ ...at(node), kind: "await", expression: operand })
            : value(operand);
      statements.push({ ...at(node), kind: "return", expression: returned });
      return;
    }
    if (node.kind === "throw") {
      const thrown = value(node.expression);
      statements.push({ ...at(node), kind: "throw", expression: thrown });
      return;
    }
    // No source-level debugging facility is enabled in this execution profile.
    if (node.kind === "empty" || node.kind === "debugger") return;
    if (node.kind === "expression") {
      const result = value(node.expression);
      expression({
        ...at(node),
        kind: "assignment",
        target: id("$completion"),
        value: result,
      });
    } else if (node.kind === "variable") {
      if (node.disposal !== undefined && disposalScope === undefined)
        fail(node, "resource declaration has no supported disposal scope");
      for (const declaration of node.declarations) {
        if (declaration === undefined) throw "SCRIPT_DECLARATION_INVARIANT";
        const initializer = declaration.initializer;
        if (
          declaration.kind === "object-binding" ||
          declaration.kind === "array-binding"
        ) {
          if (initializer === undefined)
            throw "SCRIPT_PATTERN_INITIALIZER_INVARIANT";
          initializePattern(
            declaration,
            temporary(value(initializer), true),
            node.mode,
            false,
          );
          continue;
        }
        if (node.mode === "var") {
          if (initializer !== undefined) {
            const target = declareVariableTarget(declaration.name, declaration);
            writeAssignment(
              target,
              value(initializer, text(declaration.name, declaration)),
            );
          }
        } else {
          let initialized =
            initializer === undefined
              ? id("undefined")
              : value(initializer, text(declaration.name, declaration));
          if (initializer !== undefined) {
            const mask = bindingContracts.get(declaration.start);
            initialized =
              mask === undefined
                ? (recordContract(
                    initialized,
                    bindingRecordContracts.get(declaration.start),
                    declaration,
                  ) ?? initialized)
                : checkedContract(initialized, mask, declaration);
          }
          if (node.disposal !== undefined) {
            const resource = disposalScope;
            if (resource === undefined) throw "SCRIPT_RESOURCE_SCOPE_INVARIANT";
            initialized = runtimeCall(
              node.disposal === "async"
                ? "registerAsyncLexicalDisposable"
                : "registerLexicalDisposable",
              [
                resource,
                initialized,
                id("$errors"),
                member(id("$global"), "hooks", declaration),
              ],
              declaration,
            );
          }
          if (!initializeLexicalSlot(initialized, declaration))
            expression(
              call(
                "initializeBinding",
                [lexical, text(declaration.name, declaration), initialized],
                declaration,
              ),
            );
        }
      }
    } else
      fail(node, "Script statement lowering is not implemented: " + node.kind);
  }
  try {
    if (entryKind === "indirect-eval" || entryKind === "direct-eval")
      statements.push({
        ...generated,
        kind: "variable",
        mode: "const",
        exported: false,
        declarations: [
          {
            ...generated,
            name: "$evalLexical",
            type: undefined,
            initializer: call(
              "createDeclarativeEnvironment",
              [id("undefined")],
              generated,
            ),
          },
        ],
      });
    if (entryKind !== "module") {
      // A constant: closures may capture it without a per-function copy.
      immutableTemporaries.add("$scope");
      statements.push({
        ...generated,
        kind: "variable",
        mode: "const",
        exported: false,
        declarations: [
          {
            ...generated,
            name: "$scope",
            type: undefined,
            initializer:
              entryKind !== "indirect-eval" && entryKind !== "direct-eval"
                ? call("createGlobalScope", [id("$global")], generated)
                : call(
                    "createDeclarativeScope",
                    [
                      entryKind === "direct-eval"
                        ? member(id("$site"), "lexical")
                        : call("createGlobalScope", [id("$global")], generated),
                      id("$evalLexical"),
                    ],
                    generated,
                  ),
          },
        ],
      });
    }
    const externalNames = bound.value.externalPrivateNames ?? [];
    for (const name of externalNames) {
      if (!privateInherited || name === undefined)
        throw "DIRECT_EVAL_PRIVATE_INVARIANT";
      const resolved = temporary(
        call(
          "resolveDirectEvalPrivateName",
          [inheritedPrivate, text(name)],
          generated,
        ),
      );
      statements.push({
        ...generated,
        kind: "if",
        test: {
          ...generated,
          kind: "binary",
          operator: "===",
          left: resolved,
          right: id("undefined"),
        },
        consequent: {
          ...generated,
          kind: "throw",
          expression: call(
            "createRuntimeError",
            [id("$errors"), text("syntax")],
            generated,
          ),
        },
        alternate: undefined,
      });
      externalPrivate.set(name, resolved);
    }
    if (entryKind === "dynamic-function") {
      const node = script.statements[0];
      if (script.statements.length !== 1 || node === undefined)
        return fail(script, "dynamic body requires one function expression");
      if (node.kind !== "expression")
        return fail(node, "dynamic body requires a function expression");
      const fn = node.expression;
      if (fn.kind !== "function-expression")
        return fail(fn, "dynamic body requires a function expression");
      const carrier = callable(fn.parameters, fn.body, false, fn, {
        packed: true,
        generator: fn.generator,
        async: fn.async,
        codeStrict: fn.strict ?? false,
      });
      statements.push({
        ...generated,
        kind: "return",
        expression: finish(text("none"), carrier, generated),
      });
    } else {
      if (moduleDeclarations !== undefined) {
        const start = statements.length;
        let defaultFunction = moduleDeclarations.defaultFunction;
        for (const declaration of declarations.functions) {
          if (declaration === undefined) throw "MODULE_FUNCTION_INVARIANT";
          if (
            defaultFunction !== undefined &&
            defaultFunction.value.start < declaration.start
          ) {
            moduleFunctionNames.push(defaultFunction.name);
            moduleFunctions.push(moduleDefaultFunction(defaultFunction));
            defaultFunction = undefined;
          }
          moduleFunctionNames.push(declaration.name);
          moduleFunctions.push(declaredFunction(declaration));
        }
        if (defaultFunction !== undefined) {
          moduleFunctionNames.push(defaultFunction.name);
          moduleFunctions.push(moduleDefaultFunction(defaultFunction));
        }
        for (const initialized of statements.splice(start)) {
          if (initialized === undefined) throw "MODULE_FUNCTION_INVARIANT";
          moduleInstantiation.push(initialized);
        }
      } else {
        for (const group of fixedCellTable()) {
          if (group === undefined) throw "FIXED_BINDING_CELL_INVARIANT";
          statements.push(group);
        }
        const annexDeclarations: Expression[] = [];
        for (const copy of annexCopies) {
          if (copy === undefined) throw "SCRIPT_ANNEX_COPY_INVARIANT";
          if (copy.owner !== undefined || annexAdmissions.has(copy.name))
            continue;
          const admission = temporary(
            object(
              ["name", "admitted"],
              [
                text(copy.name, copy.node),
                { ...at(copy.node), kind: "boolean", value: false },
              ],
              copy.node,
            ),
            false,
            false,
            named("AnnexGlobalFunction"),
          );
          annexAdmissions.set(copy.name, admission);
          annexDeclarations.push(admission);
        }
        const plan = object(
          ["lexical", "variables", "functions", "annexFunctions"],
          [
            {
              ...generated,
              kind: "array",
              elements: declarations.lexical.map((d) =>
                object(
                  ["name", "constant"],
                  [
                    text(d.name, d),
                    { ...at(d), kind: "boolean", value: d.constant },
                  ],
                  d,
                ),
              ),
            },
            {
              ...generated,
              kind: "array",
              elements: declarations.variables.map((name) => text(name)),
            },
            {
              ...generated,
              kind: "array",
              elements: declarations.functions.map((declaration) => {
                const fn = declaredFunction(declaration);
                const factory: Expression = {
                  ...at(declaration),
                  kind: "arrow",
                  parameters: [],
                  returnType: named("unknown"),
                  body: fn,
                };
                return object(
                  ["name", "instantiate"],
                  [text(declaration.name, declaration), factory],
                  declaration,
                );
              }),
            },
            {
              ...generated,
              kind: "array",
              elements: annexDeclarations,
            },
          ],
          generated,
        );
        check(
          temporary(
            entryKind === "script"
              ? call(
                  "instantiateGlobalDeclarations",
                  [id("$global"), plan],
                  generated,
                )
              : entryKind === "direct-eval"
                ? call(
                    "instantiateDirectEvalDeclarations",
                    [
                      id("$scope"),
                      variableScope,
                      member(id("$site"), "catches"),
                      plan,
                      { ...generated, kind: "boolean", value: scriptStrict },
                    ],
                    generated,
                  )
                : call(
                    "instantiateEvalDeclarations",
                    [
                      id("$global"),
                      id("$evalLexical"),
                      plan,
                      { ...generated, kind: "boolean", value: scriptStrict },
                    ],
                    generated,
                  ),
          ),
          generated,
        );
        for (const slot of loadFixedCells(lexical)) {
          if (slot === undefined) throw "FIXED_BINDING_CELL_INVARIANT";
          statements.push(slot);
        }
      }
      statements.push({
        ...generated,
        kind: "variable",
        mode: "let",
        exported: false,
        declarations: [
          {
            ...generated,
            name: "$completion",
            type: named("unknown"),
            initializer: id("undefined"),
          },
        ],
      });
      const resources = beginResources(script.statements, script);
      for (const node of script.statements) {
        if (node === undefined) throw "SCRIPT_STATEMENT_INVARIANT";
        statement(node);
      }
      if (entryKind === "module") finishResources(resources, script);
      statements.push({
        ...generated,
        kind: "return",
        expression:
          entryKind === "module" && moduleSuspends
            ? id("undefined")
            : finish(text("none"), id("$completion"), generated),
      });
      if (entryKind !== "module") finishResources(resources, script);
    }
    if (entryKind === "module" && moduleSuspends) {
      const resumeName = "$moduleResume",
        kindName = "$moduleKind",
        inputName = "$moduleInput";
      const initial = generatorContinuation(
        { ...at(script), kind: "block", statements: statements.slice() },
        resumeName,
        kindName,
        inputName,
        (result) => result,
        (_value, _following) =>
          fail(script, "module yield delegation is invalid"),
        (node) =>
          fail(
            node,
            "module suspension lowering for structured control flow is not implemented",
          ),
      );
      moduleContinuation = {
        ...at(script),
        kind: "block",
        statements: [
          {
            ...generated,
            kind: "variable",
            mode: "let",
            exported: false,
            declarations: [
              {
                ...generated,
                name: resumeName,
                type: {
                  ...generated,
                  kind: "named",
                  name: "GeneratorStep",
                  arguments: instantiation("GeneratorStep"),
                },
                initializer: initial,
              },
            ],
          },
          {
            ...generated,
            kind: "return",
            expression: {
              ...generated,
              kind: "arrow",
              parameters: [
                {
                  ...generated,
                  name: kindName,
                  type: named("GeneratorResumeKind"),
                },
                { ...generated, name: inputName, type: named("unknown") },
              ],
              returnType: {
                ...generated,
                kind: "named",
                name: "GeneratorOutcome",
                arguments: instantiation("GeneratorOutcome"),
              },
              body: runtimeCall(
                "runGeneratorSteps",
                [
                  object(
                    ["kind", "next", "inputKind", "value"],
                    [
                      text("transfer"),
                      id(resumeName),
                      id(kindName),
                      id(inputName),
                    ],
                    generated,
                  ),
                ],
                generated,
              ),
            },
          },
        ],
      };
    }
  } catch (caught) {
    if (caught !== abort) throw caught;
  }
  if (error !== undefined) return { ok: false, error };
  const imports = scriptRuntimeImports(
    generated,
    usesDisposal,
    usesAsyncDisposal,
    usesDirectEval,
    entryKind === "dynamic-function" ? "function" : entryKind,
    annexAdmissions.size !== 0,
    usesImportCall,
    usesImportMeta,
    usesTailCalls,
    moduleSuspends,
    false,
    compactResults,
    usesAutoAccessors,
    usesDecorators,
    false,
    usesEngineAborts,
    compactResults,
    compactResults,
    usesPrimitiveContracts,
    fixedCellNames.length !== 0,
    usesRegisterCalls,
    propertyCacheInitializers.length !== 0,
    usesWideRegisterCalls,
    usesNativeScriptCalls,
    usesIndexedWrites,
    usesNullishEquality,
    usesRelationalFallback,
    usesLooseEqualityFallback,
    excludesHTMLDDAObjects,
  );
  const output: Statement[] = imports.map((declaration): Statement => ({
    ...generated,
    kind: "import",
    declaration,
  }));
  // Inline checks above assumed no [[IsHTMLDDA]] objects: the Script or
  // module holds its host to that before any of its code runs.
  const htmlDDAExclusion: Statement[] = excludesHTMLDDAObjects
    ? [
        {
          ...generated,
          kind: "expression",
          expression: call("excludeHTMLDDAObjects", [], generated),
        },
      ]
    : [];
  const execution: BlockStatement = {
    ...at(script),
    kind: "block",
    statements,
  };
  const body: BlockStatement = {
    ...at(script),
    kind: "block",
    statements: [
      {
        ...at(script),
        kind: "try",
        body: execution,
        handler: {
          ...generated,
          binding: {
            ...generated,
            name: "$thrown",
            type: undefined,
            initializer: undefined,
          },
          body: {
            ...generated,
            kind: "block",
            statements: [
              {
                ...generated,
                kind: "return",
                expression: finish(text("throw"), id("$thrown"), generated),
              },
            ],
          },
        },
        finalizer: undefined,
      },
    ],
  };
  if (entryKind === "module") {
    if (
      moduleShape === undefined ||
      !moduleShape.ok ||
      moduleDeclarations === undefined
    )
      throw "MODULE_LOWERING_INVARIANT";
    const shape = moduleShape.value;
    function array(elements: readonly Expression[]): Expression {
      return { ...generated, kind: "array", elements };
    }
    const shapeLiteral = object(
      [
        "requests",
        "imports",
        "localExports",
        "indirectExports",
        "starExports",
        "hasTopLevelAwait",
      ],
      [
        array(
          shape.requests.map((request) => {
            const names: string[] = ["specifier", "attributes"];
            const values: Expression[] = [
              text(request.specifier),
              array(
                request.attributes.map((attribute) =>
                  object(
                    ["key", "value"],
                    [text(attribute.key), text(attribute.value)],
                    generated,
                  ),
                ),
              ),
            ];
            const phase = request.phase;
            if (phase !== undefined) {
              names.push("phase");
              values.push(text(phase));
            }
            return object(names, values, generated);
          }),
        ),
        array(
          shape.imports.map((entry) =>
            object(
              ["request", "importName", "localName"],
              [
                {
                  ...generated,
                  kind: "number",
                  value: entry.request,
                  raw: "" + entry.request,
                },
                entry.importName === undefined
                  ? id("undefined")
                  : text(entry.importName),
                text(entry.localName),
              ],
              generated,
            ),
          ),
        ),
        array(
          shape.localExports.map((entry) =>
            object(
              ["exportName", "localName"],
              [text(entry.exportName), text(entry.localName)],
              generated,
            ),
          ),
        ),
        array(
          shape.indirectExports.map((entry) =>
            object(
              ["exportName", "request", "importName"],
              [
                text(entry.exportName),
                {
                  ...generated,
                  kind: "number",
                  value: entry.request,
                  raw: "" + entry.request,
                },
                entry.importName === undefined
                  ? id("undefined")
                  : text(entry.importName),
              ],
              generated,
            ),
          ),
        ),
        array(
          shape.starExports.map((request) => ({
            ...generated,
            kind: "number",
            value: request,
            raw: "" + request,
          })),
        ),
        { ...generated, kind: "boolean", value: moduleSuspends },
      ],
      generated,
    );
    const declarationsLiteral = object(
      ["variables", "lexical", "functions"],
      [
        array(declarations.variables.map((name) => text(name))),
        array(
          declarations.lexical.map((entry) =>
            object(
              ["name", "constant"],
              [
                text(entry.name),
                { ...generated, kind: "boolean", value: entry.constant },
              ],
              generated,
            ),
          ),
        ),
        array(moduleFunctionNames.map((name) => text(name))),
      ],
      generated,
    );
    const parameters: readonly Parameter[] = [
      {
        ...generated,
        name: "$scope",
        type: {
          ...generated,
          kind: "named",
          name: "EnvironmentScope",
          arguments: instantiation("EnvironmentScope"),
        },
      },
      {
        ...generated,
        name: "$environment",
        type: {
          ...generated,
          kind: "named",
          name: "DeclarativeEnvironment",
          arguments: instantiation("DeclarativeEnvironment"),
        },
      },
    ];
    moduleInstantiation.push({
      ...generated,
      kind: "return",
      expression: array(moduleFunctions),
    });
    const initializeStatements = loadFixedCells(id("$environment"));
    appendStatements(initializeStatements, moduleInstantiation);
    const initialize: Expression = {
      ...generated,
      kind: "arrow",
      parameters,
      returnType: {
        ...generated,
        kind: "array",
        element: named("unknown"),
        readonly: true,
      },
      body: {
        ...generated,
        kind: "block",
        statements: initializeStatements,
      },
    };
    const execute: Expression = {
      ...generated,
      kind: "arrow",
      parameters,
      returnType: named(
        moduleSuspends ? "GeneratorContinuation" : "ScriptCompletionRecord",
      ),
      body: moduleContinuation ?? body,
    };
    const factoryStatements: Statement[] = [];
    appendStatements(factoryStatements, htmlDDAExclusion);
    appendStatements(factoryStatements, globalCacheDeclarations());
    appendStatements(factoryStatements, fixedCellTable());
    // Each Module Record owns its parsed template sites even when the host
    // reuses a compiled factory for equal source text at different specifiers.
    for (const site of templateSites)
      if (site !== undefined) factoryStatements.push(site);
    factoryStatements.push({
      ...generated,
      kind: "variable",
      mode: "const",
      exported: false,
      declarations: [
        {
          ...generated,
          name: "$moduleShape",
          type: named("SourceModuleShape"),
          initializer: shapeLiteral,
        },
      ],
    });
    factoryStatements.push({
      ...generated,
      kind: "variable",
      mode: "const",
      exported: false,
      declarations: [
        {
          ...generated,
          name: "$moduleDeclarations",
          type: named("SourceModuleDeclarations"),
          initializer: declarationsLiteral,
        },
      ],
    });
    factoryStatements.push({
      ...generated,
      kind: "return",
      expression: call(
        moduleSuspends
          ? "createLoweredAsyncSourceModule"
          : "createLoweredSourceModule",
        [
          id("$global"),
          id("$errors"),
          id("$hostDefined"),
          id("$moduleShape"),
          id("$moduleDeclarations"),
          initialize,
          execute,
        ],
        generated,
      ),
    });
    const factoryBody: BlockStatement = {
      ...at(script),
      kind: "block",
      statements: factoryStatements,
    };
    output.push({
      ...generated,
      kind: "function",
      name: "create",
      exported: true,
      parameters: [
        {
          ...generated,
          name: "$global",
          type: {
            ...generated,
            kind: "named",
            name: "GlobalEnvironment",
            arguments: instantiation("GlobalEnvironment"),
          },
        },
        { ...generated, name: "$errors", type: named("ErrorRealm") },
        { ...generated, name: "$hostDefined", type: named("unknown") },
      ],
      returnType: named("ModuleRecord"),
      body: factoryBody,
    });
    // The two callbacks have independent lexical parameters. Materialize fresh
    // syntax per occurrence before identity-based binding and import renaming.
    const moduleOutput: Module = { ...at(script), imports, statements: output };
    return finishOutput(moduleOutput, "module");
  }
  for (const site of templateSites) {
    if (site !== undefined) output.push(site);
  }
  const contextArguments = instantiation("runScriptContext");
  const resultType = contextArguments[0];
  if (contextArguments.length !== 1 || resultType === undefined)
    throw "SCRIPT_CONTEXT_TYPE_INVARIANT";
  // The host creates a fresh Script record per parse. The entry is never a
  // value, so managed compilation can prove it as an internal direct callee.
  const sitePrologue: Statement[] = [];
  if (entryKind === "direct-eval") {
    sitePrologue.push({
      ...generated,
      kind: "variable",
      mode: "const",
      exported: false,
      declarations: [
        {
          ...generated,
          name: "$site",
          type: undefined,
          initializer: call(
            "viewDirectEvalSite",
            [member(id("$script"), "hostDefined")],
            generated,
          ),
        },
      ],
    });
    sitePrologue.push({
      ...generated,
      kind: "if",
      test: {
        ...generated,
        kind: "binary",
        operator: "===",
        left: id("$site"),
        right: id("undefined"),
      },
      consequent: {
        ...generated,
        kind: "return",
        expression: finish(text("unsupported"), id("undefined"), generated),
      },
      alternate: undefined,
    });
  }
  if (entryKind === "direct-eval") {
    const fields: string[] = [];
    if (privateInherited) fields.push("privateEnvironment");
    if ((directFlags & directEvalInMethod) !== 0) fields.push("home");
    if ((directFlags & directEvalInDerivedConstructor) !== 0) {
      fields.push("derived");
      fields.push("activeFunction");
    }
    for (const field of fields) {
      if (field === undefined) throw "DIRECT_EVAL_CAPABILITY_INVARIANT";
      const name = "$" + field;
      sitePrologue.push({
        ...generated,
        kind: "variable",
        mode: "const",
        exported: false,
        declarations: [
          {
            ...generated,
            name,
            type: undefined,
            initializer: member(id("$site"), field),
          },
        ],
      });
      sitePrologue.push({
        ...generated,
        kind: "if",
        test: {
          ...generated,
          kind: "binary",
          operator: "===",
          left: id(name),
          right: id("undefined"),
        },
        consequent: {
          ...generated,
          kind: "return",
          expression: finish(text("unsupported"), id("undefined"), generated),
        },
        alternate: undefined,
      });
    }
  }
  const caches = globalCacheDeclarations();
  let contextArrowBody = body;
  if (!compactResults && caches.length !== 0) {
    appendStatements(caches, body.statements);
    contextArrowBody = { ...body, statements: caches };
  }
  const contextualStatements: Statement[] = [];
  appendStatements(contextualStatements, htmlDDAExclusion);
  contextualStatements.push({
    ...generated,
    kind: "variable",
    mode: "const",
    exported: false,
    declarations: [
      {
        ...generated,
        name: "$errors",
        type: named("ErrorRealm"),
        initializer: member(id("$script"), "realm", generated),
      },
    ],
  });
  for (const site of sitePrologue) {
    if (site === undefined) throw "SCRIPT_SITE_PROLOGUE_INVARIANT";
    contextualStatements.push(site);
  }
  if (compactResults)
    for (const cache of caches) {
      if (cache === undefined) throw "GLOBAL_CACHE_DECLARATION_INVARIANT";
      contextualStatements.push(cache);
    }
  const scriptContext = object(
    ["realm", "scriptOrModule"],
    [id("$errors"), scriptIdentity()],
    generated,
  );
  if (compactResults) {
    // Runtime-compiled entries run their body inline, between the two halves
    // of runScriptContext. Inside the context arrow every runtime helper and
    // execute-level binding was a guarded closure capture read per use.
    contextualStatements.push(hoistedEntryField(generated, "hooks"));
    contextualStatements.push(hoistedEntryField(generated, "object"));
    contextualStatements.push(hoistedEntryField(generated, "lexical"));
    contextualStatements.push(hoistedEntryField(generated, "thisValue"));
    for (const field of realmEntryFields) {
      if (field === undefined) throw "SCRIPT_ENTRY_FIELD_INVARIANT";
      contextualStatements.push(hoistedEntryField(generated, field, "$errors"));
    }
    contextualStatements.push({
      ...generated,
      kind: "variable",
      mode: "const",
      exported: false,
      declarations: [
        {
          ...generated,
          name: "$context",
          type: undefined,
          initializer: call(
            "enterScriptContext",
            [id("$agent"), scriptContext],
            generated,
          ),
        },
      ],
    });
    contextualStatements.push({
      ...generated,
      kind: "try",
      body: forwardSingleUseTemporaries(localizeEntryFields(body), (name) =>
        immutableTemporaries.has(name),
      ),
      handler: undefined,
      finalizer: {
        ...generated,
        kind: "block",
        statements: [
          {
            ...generated,
            kind: "expression",
            expression: call(
              "leaveScriptContext",
              [id("$agent"), id("$context")],
              generated,
            ),
          },
        ],
      },
    });
  } else
    contextualStatements.push({
      ...generated,
      kind: "return",
      expression: {
        ...generated,
        kind: "call",
        callee: id("runScriptContext"),
        typeArguments: contextArguments,
        arguments: [
          member(id("$errors"), "agent", generated),
          scriptContext,
          {
            ...generated,
            kind: "arrow",
            parameters: [],
            returnType: resultType,
            body: contextArrowBody,
          },
        ],
      },
    });
  const contextualBody: BlockStatement = {
    ...at(script),
    kind: "block",
    statements: contextualStatements,
  };
  output.push({
    ...generated,
    kind: "function",
    name: "execute",
    exported: true,
    parameters: [
      {
        ...generated,
        name: "$global",
        type: {
          ...generated,
          kind: "named",
          name: "GlobalEnvironment",
          arguments: instantiation("GlobalEnvironment"),
        },
      },
      { ...generated, name: "$script", type: named("ScriptRecord") },
    ],
    returnType: resultType,
    body: contextualBody,
  });
  return finishOutput({ ...at(script), imports, statements: output }, "Script");
}
