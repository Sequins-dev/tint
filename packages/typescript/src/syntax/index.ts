export type * from "./model.ts";
export {
  scan,
  createTokenScanner,
  type TokenScanner,
  type SlashGoal,
} from "./lexer.ts";
export {
  parseModule,
  parseStrictScript,
  parseScript,
  parseEvalScript,
  type EvalScriptContext,
} from "./parser.ts";
export { syntaxHash, rewriteModule, type SyntaxRewrite } from "./rewrite.ts";
export { syntaxKey, syntaxKeyHash, syntaxKeyMatches } from "./key.ts";
export { literalPropertyName } from "./literals.ts";

export { isOptionalChain, isDirectEvalCandidate } from "./chains.ts";
export {
  bindingIdentifiers,
  visitBindingExpressions,
  parameterIdentifiers,
  visitParameterExpressions,
  parameterHasExpressions,
  isSimpleParameter,
  expectedArgumentCount,
} from "./bindings.ts";
export {
  parseDynamicFunction,
  type DynamicFunctionKind,
  type DynamicFunctionSyntax,
} from "./dynamic-functions.ts";
export {
  eraseTypeSyntax,
  typeOnlyDeclarations,
  type TypeErasureOptions,
} from "./erase-types.ts";
