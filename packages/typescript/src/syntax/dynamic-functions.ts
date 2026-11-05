import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "./parser.ts";
import type { Module, Expression, Result } from "./model.ts";

export type DynamicFunctionKind =
  "normal" | "generator" | "async" | "async-generator";
export interface DynamicFunctionSyntax {
  /** Canonical Function.prototype.toString text, without parsing parentheses. */
  readonly sourceText: string;
  /** AST coordinates refer to this exact string. No encoding round trip occurs. */
  readonly parseText: string;
  /** Unnamed function expression: `anonymous` is not a lexical self binding.
   * Binding validation and creation in the constructor realm's global environment follow
   * parsing; this AST alone neither compiles nor executes source. */
  readonly module: Module;
}
interface Candidate extends DynamicFunctionSyntax {
  readonly expression: Expression & { readonly kind: "function-expression" };
}

/** CreateDynamicFunction parses parameters and body independently, then together.
 * Reuse the ordinary function parser with exact boundary checks, so fragments
 * cannot close their wrapper or complete each other's comments. Binding early
 * errors must subsequently be checked against the returned module. */
export function parseDynamicFunction(
  kind: DynamicFunctionKind,
  parameters: readonly string[],
  body: string,
): Result<DynamicFunctionSyntax> {
  const prefix =
    kind === "normal"
      ? "function"
      : kind === "generator"
        ? "function*"
        : kind === "async"
          ? "async function"
          : "async function*";
  const parameterText = parameters.join(",");
  function candidate(params: string, bodyText: string): Result<Candidate> {
    const head = prefix + " anonymous(" + params + "\n) {",
      sourceText = head + "\n" + bodyText + "\n}",
      parseText = "(" + sourceText + ")",
      source = createSourceTextView(parseText),
      parsed = parseScript(source);
    if (!parsed.ok) return parsed;
    const statement = parsed.value.statements[0];
    let expression: Expression | undefined =
      statement?.kind === "expression" ? statement.expression : undefined;
    while (expression?.kind === "group") expression = expression.expression;
    if (
      parsed.value.statements.length !== 1 ||
      expression?.kind !== "function-expression" ||
      expression.start !== 1 ||
      expression.end !== sourceText.length + 1 ||
      expression.body.start !== head.length ||
      expression.body.end !== sourceText.length + 1
    ) {
      const start = Math.min(head.length, parseText.length),
        position = source.positionAt(start);
      if (!position.ok) throw "DYNAMIC_FUNCTION_POSITION_INVARIANT";
      return {
        ok: false,
        error: {
          code: "SYNTAX_ERROR",
          message: "dynamic function fragment escapes its grammar boundary",
          start,
          end: start,
          position: position.value,
        },
      };
    }
    return {
      ok: true,
      value: { sourceText, parseText, module: parsed.value, expression },
    };
  }
  const params = candidate(parameterText, "");
  if (!params.ok) return params;
  const parsedBody = candidate("", body);
  if (!parsedBody.ok) return parsedBody;
  const combined = candidate(parameterText, body);
  if (!combined.ok) return combined;
  const value = combined.value,
    fn = value.expression;
  const expression: Expression = {
    kind: "function-expression",
    async: kind === "async" || kind === "async-generator",
    generator: kind === "generator" || kind === "async-generator",
    strict: fn.strict ?? false,
    parameters: fn.parameters,
    returnType: undefined,
    body: fn.body,
    start: fn.start,
    end: fn.end,
  };
  return {
    ok: true,
    value: {
      sourceText: value.sourceText,
      parseText: value.parseText,
      module: {
        statements: [
          { kind: "expression", expression, start: fn.start, end: fn.end },
        ],
        imports: [],
        strict: false,
        start: 0,
        end: value.parseText.length,
      },
    },
  };
}
