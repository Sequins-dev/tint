import {
  rewriteModule,
  type BlockStatement,
  type Expression,
  type Parameter,
  type Statement,
} from "@tint/typescript/syntax";

/** Whether an ordinary function's implicit `arguments` object only feeds
 * `f.apply(thisArg, arguments)` calls, so a native entry can forward its
 * actual operands to such a call without creating the object. Conservative:
 * the body has no nested functions or classes (whose own or inherited
 * `arguments` would need attribution), no direct eval, no declaration
 * named `arguments` and distinct simple parameters. Returns the
 * forwarding call sites (their `arguments` operand's start), or undefined. */
export function argumentsForwardingSites(
  parameters: readonly Parameter[],
  body: BlockStatement,
): ReadonlySet<number> | undefined {
  const names = new Set<string>();
  for (const parameter of parameters) {
    if (parameter === undefined) throw "FORWARDING_PARAMETER_INVARIANT";
    if (
      parameter.rest === true ||
      parameter.initializer !== undefined ||
      parameter.kind === "pattern-parameter" ||
      parameter.name === "arguments" ||
      names.has(parameter.name)
    )
      return undefined;
    names.add(parameter.name);
  }
  const allowed = new Set<number>();
  const references: number[] = [];
  let opaque: boolean = false;
  const expression = (mapped: Expression, original: Expression): Expression => {
    switch (original.kind) {
      case "identifier":
        if (original.name === "arguments") references.push(original.start);
        break;
      case "call": {
        const callee = original.callee;
        const first = original.arguments[0];
        const second = original.arguments[1];
        if (
          original.optional !== true &&
          callee.kind === "member" &&
          callee.optional !== true &&
          callee.property === "apply" &&
          original.arguments.length === 2 &&
          first !== undefined &&
          first.kind !== "spread" &&
          second !== undefined &&
          second.kind === "identifier" &&
          second.name === "arguments"
        )
          allowed.add(second.start);
        // Direct eval may read the binding.
        if (callee.kind === "identifier" && callee.name === "eval")
          opaque = true;
        break;
      }
      case "arrow":
      case "function-expression":
      case "class-expression":
        opaque = true;
        break;
      case "object":
        // Methods and accessors are functions of their own.
        for (const property of original.properties) {
          if (property === undefined) throw "FORWARDING_PROPERTY_INVARIANT";
          if (
            property.kind !== "spread" &&
            (property.method === true || property.accessor !== undefined)
          )
            opaque = true;
        }
        break;
    }
    return mapped;
  };
  const statement = (mapped: Statement, original: Statement): Statement => {
    switch (original.kind) {
      case "function":
      case "class":
        opaque = true;
        break;
      case "variable":
        for (const declaration of original.declarations) {
          if (declaration === undefined) throw "FORWARDING_DECLARATION";
          if (
            declaration.kind === "object-binding" ||
            declaration.kind === "array-binding" ||
            declaration.name === "arguments"
          )
            opaque = true;
        }
        break;
    }
    return mapped;
  };
  rewriteModule(
    {
      start: body.start,
      end: body.end,
      statements: body.statements,
      imports: [],
    },
    { expression, statement },
  );
  if (opaque || references.length === 0) return undefined;
  for (const start of references) if (!allowed.has(start)) return undefined;
  return allowed;
}
