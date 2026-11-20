import {
  boundaryNumber,
  type GeneralProgramRequest,
  type TypedBoundaryModule,
} from "@tint/compiler/native";
import { createSourceTextView } from "@tint/source/text";
import { bindJavaScriptModule } from "@tint/typescript/binding";
import {
  eraseTypeSyntax,
  parseModule,
  rewriteModule,
  typeParameterCount,
  type Expression,
  type Module,
  type Parameter,
  type Statement,
  type TypeNode,
} from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { NumericCallSite } from "../lowering/index.ts";

type FunctionDeclaration = Extract<Statement, { kind: "function" }>;

export interface FunctionFallbackPlan {
  readonly general: SourceModule;
  readonly typed: SourceModule;
  readonly boundary: TypedBoundaryModule;
  readonly name: string;
  readonly rest: boolean;
  readonly arity: number;
  readonly numericCalls: readonly NumericCallSite[];
  readonly numericImports: Module | undefined;
  /** A closed primitive body needs the general value ABI but no realm. */
  readonly primitive?: {
    readonly entry: SourceModule;
    readonly host: SourceModule;
  };
  /** Exact source argument count for ordinary entries with parameter effects. */
  readonly ordinaryEntries?: readonly OrdinaryFunctionEntry[];
}

interface OrdinaryFunctionEntry {
  readonly adapter: string;
  readonly parameters: readonly string[];
  readonly result: string;
  readonly rest?: string;
}

function numberType(type: TypeNode | undefined): boolean {
  return (
    type?.kind === "named" &&
    type.name === "number" &&
    (type.arguments?.length ?? 0) === 0
  );
}

function ordinaryNumber(statement: FunctionDeclaration): boolean {
  return ordinaryFunction(statement) && numberType(statement.returnType);
}

function ordinaryFunction(statement: FunctionDeclaration): boolean {
  return (
    statement.receiver === undefined &&
    statement.async !== true &&
    statement.generator !== true &&
    typeParameterCount(statement.typeParameters) === 0
  );
}

function ordinaryEntryType(type: TypeNode | undefined): string | undefined {
  if (type?.kind !== "named" || (type.arguments?.length ?? 0) !== 0)
    return undefined;
  const name = type.name;
  return name === "number" ||
    name === "string" ||
    name === "boolean" ||
    name === "unknown"
    ? name
    : undefined;
}

function fixedNumericParameters(
  statement: FunctionDeclaration,
): readonly string[] | undefined {
  if (statement.parameters.length > 2) return undefined;
  const names: string[] = [];
  for (const parameter of statement.parameters) {
    if (
      parameter.kind === "pattern-parameter" ||
      parameter.rest === true ||
      parameter.optional === true ||
      parameter.initializer !== undefined ||
      !numberType(parameter.type)
    )
      return undefined;
    names.push(parameter.name);
  }
  return names;
}

function numericOperator(operator: string): boolean {
  return (
    operator === "+" ||
    operator === "-" ||
    operator === "*" ||
    operator === "/" ||
    operator === "%"
  );
}

/** With checked numeric inputs, these operations produce a primitive
 * completion and cannot construct an Error object. */
function primitiveCompletion(
  fn: FunctionDeclaration,
  parameters: readonly string[],
): boolean {
  const body = fn.body;
  if (body.kind !== "block" || body.statements.length !== 1) return false;
  const statement = body.statements[0];
  function numeric(value: Expression): boolean {
    switch (value.kind) {
      case "number":
        return true;
      case "identifier":
        return parameters.includes(value.name);
      case "group":
        return numeric(value.expression);
      case "binary":
        return (
          numericOperator(value.operator) &&
          numeric(value.left) &&
          numeric(value.right)
        );
      default:
        return false;
    }
  }
  return (
    (statement?.kind === "return" || statement?.kind === "throw") &&
    statement.expression !== undefined &&
    numeric(statement.expression)
  );
}

/** Prefer the fixed numeric entry for a private, directly called function.
 * Ordinary entries preserve parameter effects and the actual argument list. */
export function planFunctionFallback(
  request: GeneralProgramRequest,
  typedId: string,
  hostId: string,
  primitiveModule: () => string,
): FunctionFallbackPlan | undefined {
  const trigger = request.trigger,
    original = request.modules[0];
  if (
    request.sourceValidated !== true ||
    request.start === "$tintCallUnit" ||
    (trigger?.capability !== "arguments-object" &&
      trigger?.capability !== "regexp-literal") ||
    trigger.owner.kind !== "function" ||
    request.modules.length !== 1 ||
    original?.id !== request.entry ||
    trigger.owner.module !== original.id ||
    request.boundaries.length !== 0 ||
    original.module.imports.length !== 0
  )
    return undefined;
  const declarations: FunctionDeclaration[] = [];
  for (const statement of original.module.statements) {
    if (statement.kind !== "function") return undefined;
    declarations.push(statement);
  }
  const selected = declarations.find(
    (fn) => fn.start === trigger.owner.start && fn.end === trigger.owner.end,
  );
  if (
    selected === undefined ||
    selected.exported ||
    !ordinaryFunction(selected)
  )
    return undefined;
  const entry = declarations.find((fn) => fn.name === request.start);
  if (
    entry === undefined ||
    !entry.exported ||
    entry.parameters.length !== 0 ||
    !ordinaryNumber(entry)
  )
    return undefined;
  return (
    (trigger.capability === "arguments-object"
      ? planFixedArgumentsFallback(
          original,
          declarations,
          selected,
          typedId,
          hostId,
          entry.name,
          primitiveModule,
        )
      : undefined) ??
    planOrdinaryFunctionFallback(
      original,
      declarations,
      selected,
      typedId,
      hostId,
    )
  );
}

function planFixedArgumentsFallback(
  original: SourceModule,
  declarations: readonly FunctionDeclaration[],
  selected: FunctionDeclaration,
  typedId: string,
  hostId: string,
  start: string,
  primitiveModule: () => string,
): FunctionFallbackPlan | undefined {
  if (!ordinaryNumber(selected)) return undefined;
  const fixed = fixedNumericParameters(selected);
  const rest = fixed === undefined;
  const arity = fixed?.length ?? 0;
  if (rest) {
    const parameter = selected.parameters[0];
    if (
      selected.parameters.length !== 1 ||
      parameter?.kind === "pattern-parameter" ||
      parameter?.rest !== true ||
      parameter.type?.kind !== "array" ||
      parameter.type.readonly === true ||
      !numberType(parameter.type.element)
    )
      return undefined;
  }
  const body = selected.body;
  if (body.kind !== "block") return undefined;
  const statement = body.statements[0];
  if (
    body.statements.length !== 1 ||
    statement?.kind !== "return" ||
    statement.expression === undefined
  )
    return undefined;

  const bound = bindJavaScriptModule(eraseTypeSyntax(original.module));
  if (!bound.ok || (bound.value.directEvalOwners?.length ?? 0) !== 0)
    return undefined;
  const rootBinding = bound.value.bindings.find(
    ({ scope, name }) => scope === 0 && name === selected.name,
  );
  if (rootBinding === undefined) return undefined;
  const directCalls = new Set<number>();
  rewriteModule(original.module, {
    expression: (mapped, source) => {
      if (
        source.kind === "call" &&
        source.optional !== true &&
        source.callee.kind === "identifier" &&
        (rest ||
          (source.arguments.length === arity &&
            source.arguments.every((argument) => argument.kind !== "spread")))
      )
        directCalls.add(source.callee.start);
      return mapped;
    },
  });
  for (const reference of bound.value.references)
    if (
      reference.binding === rootBinding.id &&
      (reference.access !== "read" || !directCalls.has(reference.node.start))
    )
      return undefined;

  const callees = new Map<
    string,
    { parameters: readonly string[]; target: string }
  >();
  const numericCalls: NumericCallSite[] = [];
  let observesArguments = false;
  let needsErrorViews = false;
  function supported(expression: Expression): boolean {
    switch (expression.kind) {
      case "number":
        return true;
      case "identifier":
        return fixed?.includes(expression.name) === true;
      case "group":
        return supported(expression.expression);
      case "binary":
        return (
          numericOperator(expression.operator) &&
          supported(expression.left) &&
          supported(expression.right)
        );
      case "conditional": {
        const test = expression.test;
        return (
          test.kind === "binary" &&
          (test.operator === "===" ||
            test.operator === "!==" ||
            test.operator === "<" ||
            test.operator === "<=" ||
            test.operator === ">" ||
            test.operator === ">=") &&
          supported(test.left) &&
          supported(test.right) &&
          supported(expression.consequent) &&
          supported(expression.alternate)
        );
      }
      case "member":
        if (
          expression.optional !== true &&
          expression.private !== true &&
          expression.property === "length" &&
          expression.object.kind === "identifier" &&
          expression.object.name === "arguments"
        ) {
          observesArguments = true;
          return true;
        }
        return false;
      case "call": {
        if (
          expression.optional === true ||
          expression.callee.kind !== "identifier"
        )
          return false;
        const name = expression.callee.name;
        if (fixed?.includes(name) === true) return false;
        const callee = declarations.find((fn) => fn.name === name);
        if (
          callee === undefined ||
          callee === selected ||
          !ordinaryNumber(callee)
        )
          return false;
        const parameters = fixedNumericParameters(callee);
        if (
          parameters === undefined ||
          parameters.length !== expression.arguments.length ||
          !expression.arguments.every(supported)
        )
          return false;
        const target =
          callees.get(name)?.target ?? "$tintNumeric" + callees.size;
        callees.set(name, { parameters, target });
        numericCalls.push({
          target,
          start: expression.start,
          end: expression.end,
        });
        if (!primitiveCompletion(callee, parameters)) needsErrorViews = true;
        return true;
      }
      default:
        return false;
    }
  }
  if (!supported(statement.expression) || !observesArguments) return undefined;
  for (const reference of bound.value.references) {
    const declared =
      reference.binding === undefined
        ? undefined
        : bound.value.bindings[reference.binding];
    if (
      declared?.scope === 0 &&
      callees.has(declared.name) &&
      reference.access !== "read"
    )
      return undefined;
  }

  const typedImport = parseImport(
    "import {$tintCallUnit as " +
      selected.name +
      "} from " +
      JSON.stringify(hostId) +
      ";",
  );
  const generalImport = parseImport(
    callees.size === 0 || !needsErrorViews
      ? ""
      : "import {" +
          [...callees.keys()].join(",") +
          "} from " +
          JSON.stringify(typedId) +
          ";",
  );
  const numericImports =
    callees.size !== 0 && !needsErrorViews
      ? parseImport(
          "import {" +
            [...callees]
              .map(([name, callee]) => name + " as " + callee.target)
              .join(",") +
            "} from " +
            JSON.stringify(typedId) +
            ";",
        )
      : undefined;
  // This path only admits reads of arguments.length. Bind the count before
  // executing code that could re-enter the host adapter.
  let countName = "$tintArgumentCount";
  while (declarations.some((fn) => fn.name === countName)) countName += "$";
  const count: Parameter = {
    name: countName,
    type: undefined,
    start: selected.start,
    end: selected.start,
  };
  const general = rewriteModule(
    {
      ...original.module,
      imports: generalImport.imports,
      statements: [
        ...generalImport.statements,
        {
          ...selected,
          exported: true,
          parameters: rest ? [count] : selected.parameters,
        },
      ],
    },
    {
      expression: (mapped) =>
        mapped.kind === "member" &&
        mapped.property === "length" &&
        mapped.object.kind === "identifier" &&
        mapped.object.name === "arguments"
          ? rest
            ? {
                kind: "identifier",
                name: countName,
                start: mapped.start,
                end: mapped.end,
              }
            : {
                kind: "number",
                value: arity,
                raw: String(arity),
                start: mapped.start,
                end: mapped.end,
              }
          : mapped,
    },
  );
  const primitive =
    fixed === undefined || needsErrorViews
      ? undefined
      : primitiveEntry(
          general,
          fixed,
          callees,
          primitiveModule(),
          typedId,
          hostId,
          start,
        );
  return {
    name: selected.name,
    rest,
    arity,
    numericCalls: numericImports === undefined ? [] : numericCalls,
    numericImports,
    ...(primitive === undefined ? {} : { primitive }),
    general: {
      ...original,
      dependencies:
        generalImport.imports.length === 0
          ? new Map()
          : new Map([[typedId, typedId]]),
      module: general,
    },
    typed: {
      ...original,
      id: typedId,
      dependencies: new Map([[hostId, hostId]]),
      module: {
        ...original.module,
        imports: typedImport.imports,
        statements: [
          ...typedImport.statements,
          ...declarations
            .filter((fn) => fn !== selected)
            .map((fn) =>
              callees.has(fn.name) ? { ...fn, exported: true } : fn,
            ),
        ],
      },
    },
    boundary: {
      id: typedId,
      exports:
        numericImports !== undefined
          ? []
          : [...callees].map(([name, callee]) => ({
              name,
              local: name,
              kind: "function",
              parameters: callee.parameters.map(() => boundaryNumber),
            })),
    },
  };
}

/** Lower the proved primitive subset without creating a realm closure or
 * allocating an argument carrier. The private general entry keeps boxed
 * arguments and results. Its numeric imports use the typed calling ABI. */
function primitiveEntry(
  general: Module,
  parameters: readonly string[],
  callees: ReadonlyMap<string, { readonly target: string }>,
  generalId: string,
  typedId: string,
  hostId: string,
  start: string,
): NonNullable<FunctionFallbackPlan["primitive"]> {
  const args = parameters.map((_, index) => "$arg" + index);
  const generalParameters = args.map((arg) => arg + ":unknown").join(",");
  const typedParameters = args.map((arg) => arg + ":number").join(",");
  const guards = args
    .map(
      (arg) =>
        "if(typeof " +
        arg +
        '!== "number") throw new TypeError("Invalid primitive argument");',
    )
    .join("\n");
  const projected = new Map(parameters.map((name, i) => [name, args[i]!]));
  const selected = general.statements.find(
    (statement) => statement.kind === "function",
  );
  if (selected?.kind !== "function" || selected.body.kind !== "block")
    throw Error("primitive general body invariant");
  const rewritten = rewriteModule(
    { ...general, statements: [selected] },
    {
      expression: (mapped, original) => {
        if (mapped.kind === "identifier") {
          const name = projected.get(mapped.name);
          if (name !== undefined) return { ...mapped, name };
        }
        if (
          mapped.kind === "call" &&
          original.kind === "call" &&
          original.callee.kind === "identifier" &&
          mapped.callee.kind === "identifier"
        ) {
          const target = callees.get(original.callee.name)?.target;
          if (target !== undefined)
            return { ...mapped, callee: { ...mapped.callee, name: target } };
        }
        return mapped;
      },
    },
  ).statements[0];
  if (rewritten?.kind !== "function" || rewritten.body.kind !== "block")
    throw Error("primitive general rewrite invariant");
  const body = rewritten.body.statements;
  const imports =
    callees.size === 0
      ? ""
      : "import {" +
        [...callees]
          .map(([name, callee]) => name + " as " + callee.target)
          .join(",") +
        "} from " +
        JSON.stringify(typedId) +
        ";";
  const declaration = parseImport(
    imports +
      "\nexport function $tintPrimitive(" +
      generalParameters +
      "):unknown {\n" +
      guards +
      "\n}",
  );
  const entry = declaration.statements.map((statement) => {
    if (statement.kind !== "function" || statement.body.kind !== "block")
      return statement;
    return {
      ...statement,
      body: {
        ...statement.body,
        statements: [...statement.body.statements, ...body],
      },
    };
  });
  const typedStart =
    start === "$tintTypedStart" ? "$tintTypedStart$" : "$tintTypedStart";
  const generalStart =
    start === "$tintPrimitive" ? "$tintPrimitive$" : "$tintPrimitive";
  return {
    entry: {
      id: generalId,
      module: {
        ...declaration,
        end: Math.max(declaration.end, general.end),
        statements: entry,
      },
      dependencies:
        callees.size === 0 ? new Map() : new Map([[typedId, typedId]]),
    },
    host: {
      id: hostId,
      module: parseImport(`
import {$tintPrimitive as ${generalStart}} from ${JSON.stringify(generalId)};
import {${start} as ${typedStart}} from ${JSON.stringify(typedId)};
export function $tintCallUnit(${typedParameters}):number {
  const result = ${generalStart}(${args.join(",")});
  if (typeof result !== "number") throw new TypeError("Invalid primitive result");
  return result;
}
export function ${start}():number { return ${typedStart}(); }
`),
      dependencies: new Map([
        [generalId, generalId],
        [typedId, typedId],
      ]),
    },
  };
}

/** A private ordinary declaration keeps its real arguments object and parameter
 * evaluation. Each typed call targets the entry for its supplied arity. */
function planOrdinaryFunctionFallback(
  original: SourceModule,
  siblings: readonly FunctionDeclaration[],
  sourceFunction: FunctionDeclaration,
  typedId: string,
  hostId: string,
): FunctionFallbackPlan | undefined {
  const declarations = new Map<string, FunctionDeclaration>();
  for (const statement of siblings) declarations.set(statement.name, statement);
  const result = ordinaryEntryType(sourceFunction.returnType);
  if (result === undefined) return undefined;
  const parameterKinds: string[] = [];
  let minimum = 0,
    rest: string | undefined;
  for (const parameter of sourceFunction.parameters) {
    if (parameter.kind === "pattern-parameter") return undefined;
    if (parameter.rest) {
      if (parameter.type?.kind !== "array") return undefined;
      rest = ordinaryEntryType(parameter.type.element);
      if (rest === undefined) return undefined;
      continue;
    }
    const type = ordinaryEntryType(parameter.type);
    if (type === undefined) return undefined;
    const optional =
      parameter.optional === true || parameter.initializer !== undefined;
    parameterKinds.push(
      optional && type !== "unknown" ? type + "|undefined" : type,
    );
    if (!optional) minimum = parameterKinds.length;
  }

  const bound = bindJavaScriptModule(eraseTypeSyntax(original.module));
  if (!bound.ok || (bound.value.directEvalOwners?.length ?? 0) !== 0)
    return undefined;
  const calls = new Map<number, number>();
  const spreads = new Map<number, number>();
  rewriteModule(original.module, {
    expression: (mapped, source) => {
      if (
        source.kind === "call" &&
        source.optional !== true &&
        source.callee.kind === "identifier"
      ) {
        calls.set(source.callee.start, source.arguments.length);
        const spread = source.arguments.findIndex(
          (argument) => argument.kind === "spread",
        );
        if (spread >= 0) spreads.set(source.callee.start, spread);
      }
      return mapped;
    },
  });
  const names = new Set(bound.value.bindings.map((binding) => binding.name));
  const usedCallees = new Map<string, readonly string[]>();
  const entryAt = new Map<number, string>();
  const entries = new Map<number, OrdinaryFunctionEntry>();
  function within(node: {
    readonly start: number;
    readonly end: number;
  }): boolean {
    return node.start >= sourceFunction.start && node.end <= sourceFunction.end;
  }
  for (const reference of bound.value.references) {
    const binding =
      reference.binding === undefined
        ? undefined
        : bound.value.bindings[reference.binding];
    if (binding?.scope !== 0) continue;
    const inside = within(reference.node);
    if (binding.name === sourceFunction.name) {
      if (reference.access !== "read") return undefined;
      if (inside) continue;
      const count = calls.get(reference.node.start);
      const spread = spreads.get(reference.node.start);
      if (
        count === undefined ||
        count < minimum ||
        (count > parameterKinds.length && rest === undefined) ||
        (spread !== undefined &&
          (rest === undefined || spread < parameterKinds.length))
      )
        return undefined;
      const shape = spread === undefined ? count : -1;
      let entry = entries.get(shape);
      if (entry === undefined) {
        let adapter =
          "$tintCallUnit" + (spread === undefined ? String(count) : "Rest");
        while (names.has(adapter)) adapter += "$";
        names.add(adapter);
        const parameters: string[] = [];
        const fixedCount = spread === undefined ? count : parameterKinds.length;
        for (let i = 0; i < fixedCount; i++) {
          const type = parameterKinds[i] ?? rest;
          if (type === undefined) throw "ordinary function argument invariant";
          parameters.push(type);
        }
        entry =
          spread === undefined || rest === undefined
            ? { adapter, parameters, result }
            : { adapter, parameters, result, rest };
        entries.set(shape, entry);
      }
      entryAt.set(reference.node.start, entry.adapter);
      continue;
    }
    if (!inside) continue;
    const callee = declarations.get(binding.name);
    if (
      callee === undefined ||
      !ordinaryNumber(callee) ||
      reference.access !== "read"
    )
      return undefined;
    const parameters = fixedNumericParameters(callee);
    if (
      parameters === undefined ||
      calls.get(reference.node.start) !== parameters.length ||
      spreads.has(reference.node.start)
    )
      return undefined;
    usedCallees.set(binding.name, parameters);
  }
  if (entries.size === 0) return undefined;
  for (const reference of bound.value.references) {
    if (reference.access === "read" || reference.binding === undefined)
      continue;
    const binding = bound.value.bindings[reference.binding];
    if (binding?.scope === 0 && usedCallees.has(binding.name)) return undefined;
  }
  const ordinaryEntries = [...entries.values()];
  const imports = parseImport(
    "import {" +
      ordinaryEntries.map((entry) => entry.adapter).join(",") +
      "} from " +
      JSON.stringify(hostId) +
      ";",
  );
  const generalImports = parseImport(
    usedCallees.size === 0
      ? ""
      : "import {" +
          [...usedCallees.keys()].join(",") +
          "} from " +
          JSON.stringify(typedId) +
          ";",
  );
  const typed = rewriteModule(
    {
      ...original.module,
      imports: imports.imports,
      statements: [
        ...imports.statements,
        ...[...declarations.values()]
          .filter((fn) => fn !== sourceFunction)
          .map((fn) =>
            usedCallees.has(fn.name) ? { ...fn, exported: true } : fn,
          ),
      ],
    },
    {
      expression: (mapped, source) => {
        if (mapped.kind !== "identifier") return mapped;
        const adapter = entryAt.get(source.start);
        return adapter === undefined ? mapped : { ...mapped, name: adapter };
      },
    },
  );
  return {
    name: sourceFunction.name,
    arity: 0,
    rest: false,
    numericCalls: [],
    numericImports: undefined,
    ordinaryEntries,
    typed: {
      ...original,
      id: typedId,
      module: typed,
      dependencies: new Map([[hostId, hostId]]),
    },
    general: {
      ...original,
      dependencies:
        usedCallees.size === 0 ? new Map() : new Map([[typedId, typedId]]),
      module: {
        ...original.module,
        imports: generalImports.imports,
        statements: [
          ...generalImports.statements,
          { ...sourceFunction, exported: true },
        ],
      },
    },
    boundary: {
      id: typedId,
      exports: [...usedCallees].map(([name, parameters]) => ({
        name,
        local: name,
        kind: "function",
        parameters: parameters.map(() => boundaryNumber),
      })),
    },
  };
}

function parseImport(text: string): Module {
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok)
    throw "generated function fallback import: " + parsed.error.message;
  return parsed.value;
}

export interface TypedCompanions {
  readonly general: SourceModule;
  readonly typed: SourceModule;
  readonly boundary: TypedBoundaryModule;
  readonly name: string;
  readonly kind: "class" | "function";
}

/** An ordinary private numeric leaf has no capture, initialization effect or
 * escaping function identity. It can keep its native entry when its lexical
 * neighbors require class evaluation or suspension in the realm. */
export function planTypedCompanions(
  request: GeneralProgramRequest,
  typedId: string,
): TypedCompanions | undefined {
  const trigger = request.trigger;
  if (request.sourceValidated !== true || trigger === undefined)
    return undefined;
  const owner = trigger.owner;
  if (
    owner.kind !== "class" &&
    trigger.capability !== "generator-suspension" &&
    trigger.capability !== "async-suspension"
  )
    return undefined;
  const source = request.modules.find((item) => item.id === owner.module);
  if (source === undefined) return undefined;
  const selected = source.module.statements.find(
    (statement) =>
      (statement.kind === "class" || statement.kind === "function") &&
      statement.start === owner.start &&
      statement.end === owner.end,
  );
  if (
    selected === undefined ||
    (selected.kind !== "class" && selected.kind !== "function")
  )
    return undefined;
  const graph = bindJavaScriptModule(eraseTypeSyntax(source.module));
  if (!graph.ok || (graph.value.directEvalOwners?.length ?? 0) !== 0)
    return undefined;
  const candidates = new Map<string, FunctionDeclaration>();
  for (const statement of source.module.statements) {
    if (
      statement.kind === "function" &&
      !statement.exported &&
      ordinaryNumber(statement)
    ) {
      const params = fixedNumericParameters(statement);
      if (params !== undefined && primitiveCompletion(statement, params))
        candidates.set(statement.name, statement);
    }
  }
  for (const statement of source.module.statements) {
    if (
      statement.kind === "export" &&
      statement.declaration.source === undefined
    )
      for (const binding of statement.declaration.bindings ?? [])
        candidates.delete(binding.local);
    if (
      statement.kind === "export-default" &&
      statement.value.kind === "identifier"
    )
      candidates.delete(statement.value.name);
  }
  const direct = new Set<number>();
  rewriteModule(source.module, {
    expression: (mapped, original) => {
      if (
        original.kind === "call" &&
        original.optional !== true &&
        original.callee.kind === "identifier"
      ) {
        const candidate = candidates.get(original.callee.name);
        if (
          candidate !== undefined &&
          candidate.parameters.length === original.arguments.length &&
          original.arguments.every((arg) => arg.kind !== "spread")
        )
          direct.add(original.callee.start);
      }
      return mapped;
    },
  });
  const called = new Set<string>();
  for (const reference of graph.value.references) {
    if (reference.binding === undefined) continue;
    const binding = graph.value.bindings[reference.binding];
    if (binding?.scope !== 0 || !candidates.has(binding.name)) continue;
    if (reference.access === "read" && direct.has(reference.node.start))
      called.add(binding.name);
    else candidates.delete(binding.name);
  }
  const leaves = [...candidates.values()].filter((fn) => called.has(fn.name));
  if (leaves.length === 0) return undefined;
  const leavesByName = new Set(leaves.map((fn) => fn.name));
  const imports = parseImport(
    "import {" +
      leaves.map((fn) => fn.name).join(",") +
      "} from " +
      JSON.stringify(typedId) +
      ";",
  );
  const dependencies = new Map(source.dependencies);
  dependencies.set(typedId, typedId);
  return {
    name: selected.name,
    kind: selected.kind,
    general: {
      ...source,
      dependencies,
      module: {
        ...source.module,
        imports: [...imports.imports, ...source.module.imports],
        statements: [
          ...imports.statements,
          ...source.module.statements.filter(
            (statement) =>
              statement.kind !== "function" ||
              !leavesByName.has(statement.name),
          ),
        ],
      },
    },
    typed: {
      ...source,
      id: typedId,
      dependencies: new Map(),
      module: {
        ...source.module,
        imports: [],
        statements: leaves.map((fn) => ({ ...fn, exported: true })),
      },
    },
    boundary: {
      id: typedId,
      exports: leaves.map((fn) => ({
        kind: "function",
        name: fn.name,
        local: fn.name,
        parameters: fn.parameters.map(() => boundaryNumber),
      })),
    },
  };
}
