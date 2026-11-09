export {
  createGlobalEnvironment,
  hasGlobalBinding,
  getGlobalBinding,
  setGlobalBinding,
  deleteGlobalBinding,
  hasRestrictedGlobalProperty,
  canDeclareGlobalVar,
  canDeclareGlobalFunction,
  createGlobalVarBinding,
  createGlobalFunctionBinding,
  type GlobalEnvironment,
} from "./record.ts";
export {
  validateGlobalDeclarations,
  admitGlobalDeclarations,
  instantiateGlobalDeclarations,
  type GlobalDeclarations,
  type GlobalDeclarationNames,
  type AnnexGlobalFunction,
  type GlobalFunctionDeclaration,
  type GlobalLexicalDeclaration,
} from "./declarations.ts";
export {
  createGlobalScope,
  createObjectScope,
  getBindingThisValue,
  createDeclarativeScope,
  resolveBinding,
  getIdentifierValue,
  getBindingReference,
  getBindingReferenceForTypeof,
  putBindingReference,
  getBindingReferenceOrThrow,
  putBindingReferenceOrThrow,
  deleteBindingReference,
  type EnvironmentScope,
  type BindingReference,
} from "./scope.ts";
export {
  instantiateFunctionBody,
  type FunctionBodyDeclarations,
  type BodyFunctionDeclaration,
} from "./function.ts";
export {
  instantiateFunctionArguments,
  instantiateScriptArguments,
  type FunctionArgumentsPlan,
} from "./arguments.ts";
export {
  createObjectEnvironment,
  hasObjectBinding,
  getObjectBinding,
  setObjectBinding,
  deleteObjectBinding,
  type ObjectEnvironment,
  type ObjectEnvironmentHooks,
} from "./object.ts";
export { createWithScope } from "./with.ts";
export {
  instantiateEvalDeclarations,
  instantiateDirectEvalDeclarations,
} from "./eval-declarations.ts";
export {
  viewDirectEvalSite,
  resolveDirectEvalPrivateName,
  type DirectEvalPrivateName,
  type DirectEvalCatch,
  type DirectEvalSite,
} from "./direct-eval.ts";
