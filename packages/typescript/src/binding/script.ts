import type { Module, Statement, Span, Expression } from "../syntax/index.ts";
import { bindingIdentifiers } from "../syntax/index.ts";
export interface ScriptLexicalDeclaration extends Span {
  readonly name: string;
  readonly constant: boolean;
}
export interface ScriptDeclarations {
  readonly lexical: readonly ScriptLexicalDeclaration[];
  readonly variables: readonly string[];
  readonly functions: readonly (Statement & { readonly kind: "function" })[];
}
export interface ModuleDefaultFunction {
  readonly name: string;
  readonly value: Expression & { readonly kind: "function-expression" };
}
export interface ModuleDeclarations extends ScriptDeclarations {
  readonly defaultFunction: ModuleDefaultFunction | undefined;
}
/** Labels are transparent to top-level var-scoped function declarations. */
export function statementFunctionDeclaration(
  statement: Statement,
): (Statement & { readonly kind: "function" }) | undefined {
  let node = statement;
  while (node.kind === "label") node = node.body;
  return node.kind === "function" ? node : undefined;
}
/** Collect declaration-instantiation inputs from a parsed strict Script.
 * This is not full early-error validation or reference binding. Block functions
 * are lexical in strict code; sloppy Annex B rules require a separate path. */
export function collectStrictScriptDeclarations(
  script: Module,
): ScriptDeclarations {
  if (script.strict === false) throw "SLOPPY_SCRIPT_DECLARATIONS_UNSUPPORTED";
  return collectScriptDeclarations(script);
}
/** Standard Script declarations. Pair this plan with bindScript's optional
 * Annex B var-copy plan when instantiating sloppy code. */
export function collectScriptDeclarations(script: Module): ScriptDeclarations {
  const declarations = collectDeclarations(script, false);
  return {
    lexical: declarations.lexical,
    variables: declarations.variables,
    functions: declarations.functions,
  };
}
/** Module hoisting has a separate default declaration, while sharing the
 * statement walker and declaration order with the Script collector. */
export function collectModuleDeclarations(module: Module): ModuleDeclarations {
  return collectDeclarations(module, true);
}
function collectDeclarations(
  script: Module,
  moduleGoal: boolean,
): ModuleDeclarations {
  let defaultFunction: ModuleDefaultFunction | undefined = undefined;
  const lexical: ScriptLexicalDeclaration[] = [],
    variables: string[] = [],
    functions: (Statement & { readonly kind: "function" })[] = [];
  function visit(node: Statement, topLevel: boolean): void {
    const declaration = topLevel
      ? statementFunctionDeclaration(node)
      : undefined;
    if (declaration !== undefined) {
      functions.push(declaration);
      return;
    }
    switch (node.kind) {
      case "class":
        if (topLevel)
          lexical.push({
            name: node.name,
            constant: false,
            start: node.start,
            end: node.end,
          });
        break;
      case "variable":
        for (const declaration of node.declarations) {
          if (declaration === undefined) throw "DECLARATION_INVARIANT";
          for (const identifier of bindingIdentifiers(declaration)) {
            if (identifier === undefined) throw "BINDING_IDENTIFIER_INVARIANT";
            if (node.mode === "var") variables.push(identifier.name);
            else if (topLevel)
              lexical.push({
                name: identifier.name,
                constant: node.mode === "const",
                start: identifier.start,
                end: identifier.end,
              });
          }
        }
        break;
      case "function":
        break;
      case "block":
        for (const child of node.statements) {
          if (child === undefined) throw "STATEMENT_INVARIANT";
          visit(child, false);
        }
        break;
      case "if":
        visit(node.consequent, false);
        if (node.alternate !== undefined) visit(node.alternate, false);
        break;
      case "with":
      case "label":
      case "while":
      case "do-while":
      case "for-of-assignment":
      case "for-in-assignment":
        visit(node.body, false);
        break;
      case "for":
        if (node.initializer !== undefined) visit(node.initializer, false);
        visit(node.body, false);
        break;
      case "for-in":
      case "for-of": {
        const pattern = node.binding;
        if (node.mode === "var") {
          for (const element of bindingIdentifiers(pattern))
            if (element !== undefined) variables.push(element.name);
        }
        visit(node.body, false);
        break;
      }
      case "try":
        visit(node.body, false);
        if (node.handler !== undefined) visit(node.handler.body, false);
        if (node.finalizer !== undefined) visit(node.finalizer, false);
        break;
      case "switch":
        for (const clause of node.clauses) {
          if (clause === undefined) throw "CLAUSE_INVARIANT";
          for (const child of clause.statements) {
            if (child === undefined) throw "STATEMENT_INVARIANT";
            visit(child, false);
          }
        }
        break;
      case "import":
      case "export":
        if (!moduleGoal) throw "STRICT_SCRIPT_INPUT_INVARIANT";
        break;
      case "export-default": {
        if (!moduleGoal) throw "STRICT_SCRIPT_INPUT_INVARIANT";
        const value = node.value;
        if (node.declaration && value.kind === "function-expression") {
          defaultFunction = { name: value.name ?? "*default*", value };
        } else {
          const name =
            node.declaration && value.kind === "class-expression"
              ? (value.definition.name ?? "*default*")
              : "*default*";
          lexical.push({
            name,
            constant: false,
            start: node.start,
            end: node.end,
          });
        }
        break;
      }
      case "interface":
      case "type-alias":
        throw "STRICT_SCRIPT_INPUT_INVARIANT";
      case "expression":
      case "throw":
      case "return":
      case "break":
      case "continue":
      case "debugger":
      case "empty":
        break;
    }
  }
  for (const statement of script.statements) {
    if (statement === undefined) throw "STATEMENT_INVARIANT";
    visit(statement, true);
  }
  return { lexical, variables, functions, defaultFunction };
}
