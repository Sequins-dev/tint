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
}

function numberType(type: TypeNode | undefined): boolean {
  return (
    type?.kind === "named" &&
    type.name === "number" &&
    (type.arguments?.length ?? 0) === 0
  );
}

function ordinaryNumber(statement: FunctionDeclaration): boolean {
  return (
    statement.receiver === undefined &&
    statement.async !== true &&
    statement.generator !== true &&
    typeParameterCount(statement.typeParameters) === 0 &&
    numberType(statement.returnType)
  );
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

/** Admit a closed, private arguments-observing function whose callers can only
 * make direct calls. Fixed numeric and numeric-rest calls check the result.
 * Other owners still use the enclosing module's original fallback. */
export function planFunctionFallback(
  request: GeneralProgramRequest,
  typedId: string,
  hostId: string,
): FunctionFallbackPlan | undefined {
  const trigger = request.trigger,
    original = request.modules[0];
  if (
    request.sourceValidated !== true ||
    request.start === "$tintCallUnit" ||
    trigger?.capability !== "arguments-object" ||
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
  const entry = declarations.find((fn) => fn.name === request.start);
  if (
    selected === undefined ||
    selected.exported ||
    !ordinaryNumber(selected) ||
    entry === undefined ||
    !entry.exported ||
    entry.parameters.length !== 0 ||
    !ordinaryNumber(entry)
  )
    return undefined;
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
  return {
    name: selected.name,
    rest,
    arity,
    numericCalls: numericImports === undefined ? [] : numericCalls,
    numericImports,
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

function parseImport(text: string): Module {
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok)
    throw "generated function fallback import: " + parsed.error.message;
  return parsed.value;
}
