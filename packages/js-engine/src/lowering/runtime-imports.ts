import type {
  ImportBinding,
  ImportDeclaration,
  Span,
} from "@tint/typescript/syntax";

/** Build a named runtime import after checking the source list's dense invariant. */
function runtimeImport(
  name: string | undefined,
  typeOnly: boolean,
): ImportBinding {
  if (name === undefined) throw "SCRIPT_IMPORT_INVARIANT";
  return { imported: name, namespace: false, local: name, typeOnly };
}

function moduleRuntimeImport(
  generated: Span,
  usesImportCall: boolean,
  usesImportMeta: boolean,
  usesAsyncModule: boolean,
): ImportDeclaration {
  const factory = usesAsyncModule
    ? "createLoweredAsyncSourceModule"
    : "createLoweredSourceModule";
  return {
    ...generated,
    specifier: "@tint/js-runtime/modules",
    specifierSpan: generated,
    typeOnly: false,
    bindings: [
      factory,
      "ModuleRecord",
      "SourceModuleShape",
      "SourceModuleDeclarations",
      ...(usesImportCall ? ["evaluateImportCall"] : []),
      ...(usesImportMeta ? ["getActiveImportMeta"] : []),
    ].map((name) =>
      runtimeImport(
        name,
        name !== factory &&
          name !== "evaluateImportCall" &&
          name !== "getActiveImportMeta",
      ),
    ),
  };
}

/** Single import vocabulary for AOT Script lowering and managed runtime surfaces.
 * Return fresh syntax nodes so linking/rewrite passes cannot mutate the vocabulary. */
export function scriptRuntimeImports(
  generated: Span,
  usesDisposal: boolean = false,
  usesAsyncDisposal: boolean = false,
  usesDirectEval: boolean = false,
  declarations:
    | "script"
    | "indirect-eval"
    | "direct-eval"
    | "function"
    | "module"
    | "all" = "script",
  usesAnnexAdmissions: boolean = false,
  usesImportCall: boolean = false,
  usesImportMeta: boolean = false,
  usesTailCalls: boolean = false,
  usesAsyncModule: boolean = false,
  usesTemplateSites: boolean = false,
  usesCompactResults: boolean = false,
  usesAutoAccessors: boolean = false,
  usesDecorators: boolean = false,
  usesLiteralTable: boolean = false,
  usesEngineAborts: boolean = false,
): readonly ImportDeclaration[] {
  if (
    (usesImportMeta && declarations !== "module") ||
    (usesAsyncModule && declarations !== "module")
  )
    throw "SCRIPT_IMPORT_INVARIANT";
  const imports: ImportDeclaration[] = [
    {
      ...generated,
      specifier: "@tint/js-runtime/objects",
      specifierSpan: generated,
      typeOnly: false,
      bindings: [
        ...(usesAsyncDisposal
          ? ["registerAsyncLexicalDisposable", "disposeAsyncLexicalResources"]
          : []),
        ...(usesDisposal
          ? [
              "createLexicalDisposalStack",
              "registerLexicalDisposable",
              "disposeLexicalResources",
            ]
          : []),
        ...(usesDirectEval ? ["callEvalCandidate"] : []),
        ...(usesTailCalls
          ? [
              "createTailSourceFunction",
              "requestSourceTailCall",
              "callEvalTailCandidate",
            ]
          : []),
        "ErrorRealm",
        "ScriptCompletionRecord",
        ...(declarations === "module" ? [] : ["ScriptRecord"]),
        "getScriptIterator",
        "getScriptAsyncIterator",
        "nextScriptAsyncIterator",
        "finishScriptAsyncIteratorStep",
        "beginScriptAsyncIteratorClose",
        "finishScriptAsyncIteratorClose",
        "stepScriptIterator",
        "skipScriptIterator",
        "collectScriptIterator",
        "appendScriptArraySpread",
        "appendScriptArguments",
        "finishScriptArray",
        "closeScriptIterator",
        "ScriptPropertyKey",
        "propertyFunctionName",
        "ClassField",
        "ClassPrivateMethod",
        "DerivedConstruction",
        "OrdinaryObject",
        "getDerivedThis",
        "constructSuper",
        "createPrivateName",
        "getPrivateObjectValue",
        "setPrivateObjectValue",
        "hasPrivateObjectValue",
        "createBaseClass",
        "createDerivedClass",
        "classHeritage",
        "createClassMethod",
        ...(usesAutoAccessors ? ["prepareClassAutoAccessor"] : []),
        ...(usesDecorators
          ? [
              "ClassDecorator",
              "ClassFieldDecoration",
              "ClassElementDecoration",
              "createClassDecorationState",
              "decorateClassElement",
              "decorateClass",
              "runClassInitializers",
            ]
          : []),
        "initializeClassPrivateMethods",
        "defineClassMethod",
        "defineClassMethodValue",
        "defineClassAccessor",
        "initializeClassFields",
        "viewObjectValue",
        "createBigIntLiteral",
        "createRegExpLiteral",
        "scriptBoolean",
        "scriptStrictEqual",
        "binaryObjectValueOperation",
        "objectPropertyKey",
        "updateObjectValue",
        "unaryObjectValueOperation",
        "createSourceFunction",
        "retainFunctionSource",
        "runScriptContext",
        "createSourceAsyncGeneratorFunction",
        "AsyncGeneratorContinuation",
        "AsyncGeneratorStep",
        "AsyncGeneratorStepOutcome",
        "AsyncGeneratorOutcome",
        "runAsyncGeneratorSteps",
        "createSourceGeneratorFunction",
        "createSourceAsyncContinuationFunction",
        "createIteratorResult",
        "createDelegatingContinuation",
        "createAsyncDelegatingContinuation",
        "GeneratorContinuation",
        "GeneratorStep",
        "GeneratorStepOutcome",
        "runGeneratorSteps",
        "GeneratorOutcome",
        "GeneratorResumeKind",
        "constructObjectValue",
        "instanceOfValue",
        "objectValueHasProperty",
        "looselyEqual",
        "createObject",
        "createArrayObject",
        "createArrayFromList",
        "createDataProperty",
        "copyObjectProperties",
        "requireObjectCoercible",
        "createAccessorProperty",
        "rejectUnsupportedExecution",
        ...(usesEngineAborts ? ["rejectEngineAbort"] : []),
        ...(usesCompactResults ? ["throwIfRuntimeError"] : []),
        "finishScriptExecution",
        "createRuntimeError",
        "objectValueTypeof",
        "stringValue",
        "TemplateSite",
        "getTemplateObject",
        ...(usesTemplateSites ? ["getScriptTemplateSite"] : []),
        ...(usesLiteralTable ? ["getScriptLiteral"] : []),
        "callObjectValue",
        "getObjectValueProperty",
        "readObjectValueProperty",
        "readObjectValuePropertyKey",
        "getObjectValuePropertyWithReceiver",
        "setObjectValueProperty",
        "setObjectValuePropertyWithReceiver",
        "sloppyCallReceiver",
        "setObjectLiteralPrototype",
        "deleteObjectValueProperty",
        "enumerateObjectValue",
        "nextEnumerableProperty",
      ].map((name) =>
        runtimeImport(
          name,
          name === "TemplateSite" ||
            name === "ErrorRealm" ||
            name === "ScriptCompletionRecord" ||
            name === "ScriptRecord" ||
            name === "ClassField" ||
            name === "ClassPrivateMethod" ||
            name === "ClassDecorator" ||
            name === "ClassFieldDecoration" ||
            name === "ClassElementDecoration",
        ),
      ),
    },
    {
      ...generated,
      specifier: "@tint/js-runtime/environments/global",
      specifierSpan: generated,
      typeOnly: false,
      bindings: [
        "createGlobalScope",
        "createWithScope",
        "getBindingThisValue",
        "deleteBindingReference",
        "createDeclarativeScope",
        "resolveBinding",
        "getIdentifierValue",
        "getBindingReference",
        "getBindingReferenceForTypeof",
        "putBindingReference",
        ...(declarations === "script" || declarations === "all"
          ? ["instantiateGlobalDeclarations"]
          : []),
        ...(declarations === "indirect-eval" || declarations === "all"
          ? ["instantiateEvalDeclarations"]
          : []),
        ...(declarations === "direct-eval" || declarations === "all"
          ? [
              "instantiateDirectEvalDeclarations",
              "viewDirectEvalSite",
              "resolveDirectEvalPrivateName",
            ]
          : []),
        "setGlobalBinding",
        "instantiateFunctionBody",
        "instantiateScriptArguments",
        "GlobalEnvironment",
        ...(declarations === "module" ? ["EnvironmentScope"] : []),
        ...(usesAnnexAdmissions ? ["AnnexGlobalFunction"] : []),
        ...(usesDirectEval || declarations === "direct-eval"
          ? ["DirectEvalCatch", "DirectEvalSite", "DirectEvalPrivateName"]
          : []),
      ].map((name) =>
        runtimeImport(
          name,
          name === "GlobalEnvironment" ||
            name === "EnvironmentScope" ||
            name === "AnnexGlobalFunction" ||
            name === "DirectEvalCatch" ||
            name === "DirectEvalSite" ||
            name === "DirectEvalPrivateName",
        ),
      ),
    },
    {
      ...generated,
      specifier: "@tint/js-runtime/environments/records",
      specifierSpan: generated,
      typeOnly: false,
      bindings: [
        "initializeBinding",
        "setMutableBinding",
        "getBindingValue",
        "createDeclarativeEnvironment",
        "createMutableBinding",
        "createImmutableBinding",
        ...(declarations === "module" ? ["DeclarativeEnvironment"] : []),
      ].map((name) => runtimeImport(name, name === "DeclarativeEnvironment")),
    },
  ];
  if (declarations === "module")
    imports.push(
      moduleRuntimeImport(
        generated,
        usesImportCall,
        usesImportMeta,
        usesAsyncModule,
      ),
    );
  else if (usesImportCall)
    imports.push({
      ...generated,
      specifier: "@tint/js-runtime/modules",
      specifierSpan: generated,
      typeOnly: false,
      bindings: [runtimeImport("evaluateImportCall", false)],
    });
  return imports;
}

export interface ScriptRuntimeSurfaceEntry {
  readonly specifier: string;
  readonly name: string;
  /** Concrete argument names; resolve imported names through linked type exports.
   * Import spelling/typeOnly does not classify the export's namespace. */
  readonly typeArguments: readonly string[];
}
/** Shared concrete instantiations for helper calls and the managed vocabulary. */
export function scriptRuntimeTypeArguments(name: string): readonly string[] {
  switch (name) {
    case "getDerivedThis":
    case "constructSuper":
    case "createObject":
    case "createArrayObject":
    case "createDataProperty":
    case "createAccessorProperty":
    case "nextEnumerableProperty":
    case "createGlobalScope":
    case "getBindingThisValue":
    case "deleteBindingReference":
    case "createDeclarativeScope":
    case "resolveBinding":
    case "getIdentifierValue":
    case "getBindingReference":
    case "getBindingReferenceForTypeof":
    case "putBindingReference":
    case "instantiateGlobalDeclarations":
    case "instantiateEvalDeclarations":
    case "instantiateDirectEvalDeclarations":
    case "setGlobalBinding":
    case "instantiateFunctionBody":
    case "DerivedConstruction":
    case "OrdinaryObject":
    case "GlobalEnvironment":
    case "EnvironmentScope":
      return ["ScriptPropertyKey", "unknown"];
    case "runAsyncGeneratorSteps":
    case "runGeneratorSteps":
    case "DeclarativeEnvironment":
    case "initializeBinding":
    case "setMutableBinding":
    case "getBindingValue":
    case "createDeclarativeEnvironment":
    case "createMutableBinding":
    case "createImmutableBinding":
    case "AsyncGeneratorContinuation":
    case "AsyncGeneratorStep":
    case "AsyncGeneratorStepOutcome":
    case "AsyncGeneratorOutcome":
    case "GeneratorStep":
    case "GeneratorStepOutcome":
    case "GeneratorOutcome":
    case "DirectEvalCatch":
      return ["unknown"];
    case "runScriptContext":
      return ["ScriptCompletionRecord"];
    default:
      return [];
  }
}
/** Captured tools use this marker before exposing runtime import helpers. */
export const scriptRuntimeSupportsDynamicImport = true;
export const scriptRuntimeSupportsTemplateSites = true;
/** Shared compiled entries read per-parse string literals from their carrier. */
export const scriptRuntimeSupportsLiteralTables = true;
/** Runtime-compiled entries complete results through out-of-line helpers. */
export const scriptRuntimeSupportsCompactResults = true;
/** Lowered catch boundaries call rejectEngineAbort (heap exhaustion is an
 * uncatchable engine abort). Captured runtimes without it keep the old surface. */
export const scriptRuntimeSupportsEngineAborts = true;
/** Complete vocabulary, including optional disposal paths. Values versus types
 * must be classified by the linked export, not by legacy import flags. */
export function scriptRuntimeSurface(
  usesImportCall: boolean = true,
  usesTemplateSites: boolean = true,
  usesCompactResults: boolean = true,
  usesLiteralTable: boolean = true,
  usesEngineAborts: boolean = true,
): readonly ScriptRuntimeSurfaceEntry[] {
  const entries: ScriptRuntimeSurfaceEntry[] = [];
  for (const declaration of scriptRuntimeImports(
    { start: 0, end: 0 },
    true,
    true,
    true,
    "all",
    true,
    usesImportCall,
    false,
    true,
    false,
    usesTemplateSites,
    usesCompactResults,
    true,
    true,
    usesLiteralTable,
    usesEngineAborts,
  )) {
    if (declaration === undefined) throw "SCRIPT_IMPORT_INVARIANT";
    for (const binding of declaration.bindings) {
      if (binding === undefined) throw "SCRIPT_IMPORT_INVARIANT";
      entries.push({
        specifier: declaration.specifier,
        name: binding.imported,
        typeArguments: scriptRuntimeTypeArguments(binding.imported),
      });
    }
  }
  return entries;
}
