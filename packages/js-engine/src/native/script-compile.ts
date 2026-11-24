import {
  rewriteModule,
  syntaxKey,
  syntaxKeyHash,
  syntaxKeyMatches,
  type Module,
  type Statement,
  type Expression,
  type ImportDeclaration,
  type ImportBinding,
  type BlockStatement,
  type VariableBinding,
  type ObjectProperty,
  type ObjectAssignment,
} from "@tint/typescript/syntax";
import {
  prepareManagedSurfaceEntry,
  prepareX64ManagedSurfaceEntry,
  createManagedTypeContractCache,
  declareManagedJitRuntime,
  createManagedCollectionPlanCache,
  createInterfaceResolutionCache,
  linkManagedSurfaceModule,
  linkX64ManagedSurfaceModule,
  type ManagedSurfaceEntryRequest,
  type ManagedPointerResolution,
  type ManagedSurfaceDirectoryRead,
  type ManagedSurfaceLayoutRuntime,
  type ManagedIdentityReader,
} from "@tint/compiler/native";
import { scriptRuntimeSurface } from "../lowering/runtime-imports.ts";
import {
  engineCodeFunctions,
  type EngineCodeStorage,
  type EngineCodeFunction,
} from "./code-storage.ts";
import type {
  ScriptEntryCompilation,
  ScriptEntryShape,
} from "../script-evaluation.ts";

export interface ScriptEntrySurface {
  readonly read: ManagedSurfaceDirectoryRead;
  readonly runtime: ManagedSurfaceLayoutRuntime;
}
export interface ScriptEntryCompilerHost {
  readonly domain: () => number;
  readonly storage: EngineCodeStorage;
  readonly readWord: ManagedIdentityReader;
}
export interface ScriptEntryCompilerLimits {
  readonly maxScriptCodeBytes: number;
  /** Shared entries retained per compiler (least recently used first out);
   * zero disables sharing. Published code itself is never reclaimed. */
  readonly maxSharedEntries?: number;
}
export const scriptEntrySupportsTemplateSites = true;
/** Entries of equal shape and literal-abstracted syntax are shared. */
export const scriptEntrySupportsLiteralTables = true;
export const defaultMaxSharedScriptEntries = 256;

/** A shared entry: shape, syntax digest, canonical key and its address. */
interface SharedScriptEntry {
  readonly digest: number;
  readonly shape: ScriptEntryShape;
  readonly key: string;
  readonly address: number;
}
interface AbstractedScriptLiterals {
  readonly module: Module;
  readonly literals: readonly string[];
}
/** Runtime helper arguments that carry a JavaScript binding name, a function
 * name or retained function source text as a plain `string` (or
 * ScriptPropertyKey) parameter. Their values only reach environment records,
 * function names and [[SourceText]], so reading them from the per-parse
 * literal table changes neither types nor behavior. Operators, completion
 * kinds, caller policies and property keys are deliberately absent. */
function scriptNameArgument(callee: string, index: number): boolean {
  switch (callee) {
    case "resolveBinding":
    case "getIdentifierValue":
    case "getBindingValue":
    case "createMutableBinding":
    case "createImmutableBinding":
    case "initializeBinding":
    case "setMutableBinding":
    case "setGlobalBinding":
    case "retainFunctionSource":
      return index === 1;
    case "createSourceFunction":
      return index === 4;
    case "createSourceGeneratorFunction":
    case "createSourceAsyncFunction":
      return index === 3;
    case "createRetainedSourceFunction":
      return index === 4 || index === 8;
    case "propertyFunctionName":
    case "createBaseClass":
    case "createDerivedClass":
      return index === 0;
    default:
      return false;
  }
}
/** Declaration plans (GlobalDeclarations, FunctionBodyDeclarations,
 * FunctionArgumentsPlan) passed at this argument index list binding names
 * only; -1 when the helper takes none. */
function scriptNamePlanArgument(callee: string): number {
  switch (callee) {
    case "instantiateDirectEvalDeclarations":
    case "instantiateScriptArguments":
      return 3;
    case "instantiateFunctionBody":
      return 1;
    default:
      return -1;
  }
}
/** The property as plain data (a non-computed, non-accessor, non-method
 * key/value pair), or undefined. */
function plainDataProperty(
  property: ObjectProperty,
): ObjectAssignment | undefined {
  if (property.kind === "spread") return undefined;
  const assignment: ObjectAssignment = property;
  if (
    assignment.computed === true ||
    assignment.keyExpression !== undefined ||
    assignment.accessor !== undefined ||
    assignment.method === true ||
    assignment.prototypeSetter === true
  )
    return undefined;
  return assignment;
}
/** The lowerer emits a JavaScript string literal's value as plain data: the
 * untyped initializer of a constant temporary or the value assigned to a
 * local. Those values inside the entry function become ordinals read from
 * its ScriptRecord carrier, as do binding names, function names and retained
 * source text passed to the helpers in scriptNameArgument and declaration
 * plans, so sources differing only in identifiers share an entry. Other
 * helper arguments (property keys, RegExp sources, operators, completion
 * kinds), template strings and directive text keep their values in the
 * shared syntax, and any
 * entry whose carrier name could be shadowed is left unshared: functions,
 * parameters, variables, catch and for-in/of bindings are checked by name,
 * while binding patterns and classes (which the lowerer never emits) always
 * leave the entry unshared. Exported for tests. */
export function abstractScriptLiterals(
  module: Module,
): AbstractedScriptLiterals | undefined {
  const entry = module.statements.find(
    (statement) =>
      statement !== undefined &&
      statement.kind === "function" &&
      statement.name === "execute",
  );
  if (entry?.kind !== "function") return undefined;
  const carrier = entry.parameters[1];
  if (carrier === undefined || carrier.kind === "pattern-parameter")
    return undefined;
  const carrierName = carrier.name,
    objects = module.imports.find(
      (declaration) =>
        declaration !== undefined &&
        declaration.specifier === "@tint/js-runtime/objects",
    );
  if (objects === undefined) return undefined;
  for (const binding of objects.bindings) {
    if (binding === undefined) throw "SCRIPT_LITERAL_INVARIANT";
    if (binding.local === "getScriptLiteral") return undefined;
  }
  const literals: string[] = [];
  let shadowed = false;
  function abstractable(value: Expression | undefined): string | undefined {
    if (
      value === undefined ||
      value.kind !== "string" ||
      value.template === true ||
      value.value === "use strict"
    )
      return undefined;
    return value.value;
  }
  function read(value: string, at: Expression): Expression {
    const index = literals.length;
    literals.push(value);
    return {
      start: at.start,
      end: at.end,
      kind: "call",
      callee: {
        start: at.start,
        end: at.end,
        kind: "identifier",
        name: "getScriptLiteral",
      },
      typeArguments: [],
      arguments: [
        {
          start: at.start,
          end: at.end,
          kind: "identifier",
          name: carrierName,
        },
        {
          start: at.start,
          end: at.end,
          kind: "number",
          value: index,
          raw: String(index),
        },
      ],
    };
  }
  function declares(name: string | undefined): void {
    if (name === carrierName) shadowed = true;
  }
  /** Declaration plans list binding names as string array elements or as the
   * `name` of an element object; every other plan field keeps its value. */
  function abstractPlan(plan: Expression): Expression {
    if (plan.kind !== "object") return plan;
    let changed = false;
    const properties: ObjectProperty[] = [];
    for (const property of plan.properties) {
      if (property === undefined) throw "SCRIPT_LITERAL_INVARIANT";
      const data = plainDataProperty(property);
      const list = data === undefined ? undefined : data.value;
      if (data === undefined || list === undefined || list.kind !== "array") {
        properties.push(property);
        continue;
      }
      let listChanged = false;
      const elements: Expression[] = [];
      for (const element of list.elements) {
        if (element === undefined) throw "SCRIPT_LITERAL_INVARIANT";
        let next: Expression = element;
        const value = abstractable(element);
        if (value !== undefined) next = read(value, element);
        else if (element.kind === "object") next = abstractPlanName(element);
        if (next !== element) listChanged = true;
        elements.push(next);
      }
      if (!listChanged) {
        properties.push(property);
        continue;
      }
      changed = true;
      properties.push({ ...data, value: { ...list, elements } });
    }
    return changed ? { ...plan, properties } : plan;
  }
  function abstractPlanName(element: Expression): Expression {
    if (element.kind !== "object") return element;
    let changed = false;
    const properties: ObjectProperty[] = [];
    for (const property of element.properties) {
      if (property === undefined) throw "SCRIPT_LITERAL_INVARIANT";
      const data = plainDataProperty(property);
      const value =
        data !== undefined && data.name === "name"
          ? abstractable(data.value)
          : undefined;
      if (data === undefined || value === undefined) {
        properties.push(property);
        continue;
      }
      changed = true;
      properties.push({ ...data, value: read(value, data.value) });
    }
    return changed ? { ...element, properties } : element;
  }
  function binds(binding: VariableBinding): void {
    if (binding.kind === "object-binding" || binding.kind === "array-binding")
      shadowed = true;
    else declares(binding.name);
  }
  const scoped = rewriteModule(
    { ...module, imports: [], statements: [entry] },
    {
      statement(mapped, _original) {
        if (mapped.kind === "function") {
          // Loops discard narrowing of mutable bindings; keep constants.
          const nested = mapped.name !== "execute";
          if (nested) declares(mapped.name);
          for (const parameter of mapped.parameters) {
            if (parameter === undefined) throw "SCRIPT_LITERAL_INVARIANT";
            if (parameter.kind === "pattern-parameter") shadowed = true;
            else if (nested) declares(parameter.name);
          }
          return mapped;
        }
        if (mapped.kind === "class") {
          shadowed = true;
          return mapped;
        }
        if (mapped.kind === "try") {
          const handler = mapped.handler;
          const caught = handler === undefined ? undefined : handler.binding;
          if (caught !== undefined) binds(caught);
          return mapped;
        }
        if (mapped.kind === "for-of" || mapped.kind === "for-in") {
          binds(mapped.binding);
          return mapped;
        }
        if (mapped.kind !== "variable") return mapped;
        const variable = mapped,
          constant = variable.mode === "const";
        let changed = false;
        const declarations: VariableBinding[] = [];
        for (const declaration of variable.declarations) {
          if (declaration === undefined) throw "SCRIPT_LITERAL_INVARIANT";
          if (
            declaration.kind === "object-binding" ||
            declaration.kind === "array-binding"
          ) {
            shadowed = true;
            declarations.push(declaration);
            continue;
          }
          declares(declaration.name);
          const value =
            constant && declaration.type === undefined
              ? abstractable(declaration.initializer)
              : undefined;
          const initializer = declaration.initializer;
          if (value === undefined || initializer === undefined) {
            declarations.push(declaration);
            continue;
          }
          changed = true;
          declarations.push({
            ...declaration,
            initializer: read(value, initializer),
          });
        }
        return changed ? { ...variable, declarations } : variable;
      },
      expression(mapped, _original) {
        if (mapped.kind === "class-expression") {
          shadowed = true;
          return mapped;
        }
        if (mapped.kind === "arrow" || mapped.kind === "function-expression") {
          if (mapped.kind === "function-expression") declares(mapped.name);
          const nested = mapped.parameters;
          for (const parameter of nested) {
            if (parameter === undefined) throw "SCRIPT_LITERAL_INVARIANT";
            if (parameter.kind === "pattern-parameter") shadowed = true;
            else declares(parameter.name);
          }
          return mapped;
        }
        // Bind the callee: the native subset narrows locals, not property paths.
        const target = mapped.kind === "call" ? mapped.callee : undefined;
        if (
          mapped.kind === "call" &&
          target !== undefined &&
          target.kind === "identifier"
        ) {
          const callee = target.name,
            plan = scriptNamePlanArgument(callee);
          let changed = false;
          const args: Expression[] = [];
          for (let index = 0; index < mapped.arguments.length; index++) {
            const argument = mapped.arguments[index];
            if (argument === undefined) throw "SCRIPT_LITERAL_INVARIANT";
            let next: Expression = argument;
            if (scriptNameArgument(callee, index)) {
              const value = abstractable(argument);
              if (value !== undefined) next = read(value, argument);
            } else if (plan === index) next = abstractPlan(argument);
            if (next !== argument) changed = true;
            args.push(next);
          }
          return changed ? { ...mapped, arguments: args } : mapped;
        }
        if (mapped.kind !== "assignment" || mapped.target.kind !== "identifier")
          return mapped;
        const value = abstractable(mapped.value);
        return value === undefined
          ? mapped
          : { ...mapped, value: read(value, mapped.value) };
      },
    },
  );
  const rewritten = scoped.statements[0];
  if (shadowed || rewritten?.kind !== "function") return undefined;
  const bindings: ImportBinding[] = [];
  for (const binding of objects.bindings) {
    if (binding === undefined) throw "SCRIPT_LITERAL_INVARIANT";
    bindings.push(binding);
  }
  bindings.push({
    imported: "getScriptLiteral",
    local: "getScriptLiteral",
    namespace: false,
    typeOnly: false,
  });
  const updatedObjects: ImportDeclaration = { ...objects, bindings };
  const statements: Statement[] = [];
  for (const statement of module.statements) {
    if (statement === undefined) throw "SCRIPT_LITERAL_INVARIANT";
    if (statement === entry) statements.push(rewritten);
    else if (statement.kind === "import" && statement.declaration === objects)
      statements.push({
        start: statement.start,
        end: statement.end,
        kind: "import",
        declaration: updatedObjects,
      });
    else statements.push(statement);
  }
  const imports: ImportDeclaration[] = [];
  for (const declaration of module.imports) {
    if (declaration === undefined) throw "SCRIPT_LITERAL_INVARIANT";
    imports.push(declaration === objects ? updatedObjects : declaration);
  }
  return {
    // Unhashed: only a compiled miss needs fresh node hashes.
    module: { ...module, imports, statements },
    literals,
  };
}

/** Only the lowerer's literal site recipes can move into the managed entry.
 * Other module initialization remains outside this execution profile. */
function templateRecipe(value: Expression | undefined): boolean {
  if (value?.kind !== "object" || value.properties.length !== 2) return false;
  let cooked = false,
    raw = false;
  let length: number | undefined;
  for (const property of value.properties) {
    if (
      property === undefined ||
      property.kind === "spread" ||
      property.keyExpression !== undefined ||
      property.computed === true ||
      property.accessor !== undefined ||
      property.method === true ||
      property.prototypeSetter === true ||
      (property.name !== "cooked" && property.name !== "raw")
    )
      return false;
    const array = property.value;
    if (array.kind !== "array") return false;
    const elements = array.elements;
    if (elements.length === 0) return false;
    if (length === undefined) length = elements.length;
    else if (length !== elements.length) return false;
    if (property.name === "cooked") {
      if (cooked) return false;
      cooked = true;
    } else {
      if (raw) return false;
      raw = true;
    }
    for (const part of elements)
      if (
        part === undefined ||
        (part.kind !== "string" &&
          !(
            property.name === "cooked" &&
            part.kind === "identifier" &&
            part.name === "undefined"
          ))
      )
        return false;
  }
  return cooked && raw;
}

function managedTemplateSites(module: Module): Module {
  const sites: Statement[] = [];
  for (const statement of module.statements) {
    if (
      statement?.kind !== "variable" ||
      statement.mode !== "const" ||
      statement.exported ||
      statement.declarations.length !== 1
    )
      continue;
    const declaration = statement.declarations[0];
    if (
      declaration === undefined ||
      declaration.kind === "object-binding" ||
      declaration.kind === "array-binding"
    )
      continue;
    const type = declaration.type;
    if (type === undefined || type.kind !== "named") continue;
    if (type.name === "TemplateSite" && templateRecipe(declaration.initializer))
      sites.push(statement);
  }
  if (sites.length === 0) return module;
  const entry = module.statements.find(
      (statement) =>
        statement !== undefined &&
        statement.kind === "function" &&
        statement.name === "execute",
    ),
    objects = module.imports.find(
      (declaration) =>
        declaration !== undefined &&
        declaration.specifier === "@tint/js-runtime/objects",
    );
  if (entry?.kind !== "function" || objects === undefined) return module;
  const entryBody = entry.body;
  if (entryBody.kind !== "block") return module;
  const carrier = entry.parameters[1];
  if (carrier === undefined || carrier.kind === "pattern-parameter")
    return module;
  const initialized: Statement[] = [];
  for (let index = 0; index < sites.length; index++) {
    const site = sites[index];
    if (site === undefined || site.kind !== "variable")
      throw "SCRIPT_TEMPLATE_SITE_INVARIANT";
    const declaration = site.declarations[0];
    if (
      declaration === undefined ||
      declaration.kind === "object-binding" ||
      declaration.kind === "array-binding"
    )
      throw "SCRIPT_TEMPLATE_SITE_INVARIANT";
    const initializer = declaration.initializer;
    if (initializer === undefined) throw "SCRIPT_TEMPLATE_SITE_INVARIANT";
    initialized.push({
      ...site,
      declarations: [
        {
          ...declaration,
          initializer: {
            start: 0,
            end: 0,
            kind: "call",
            callee: {
              start: 0,
              end: 0,
              kind: "identifier",
              name: "getScriptTemplateSite",
            },
            typeArguments: [],
            arguments: [
              { start: 0, end: 0, kind: "identifier", name: carrier.name },
              {
                start: 0,
                end: 0,
                kind: "number",
                value: index,
                raw: String(index),
              },
              initializer,
            ],
          },
        },
      ],
    });
  }
  const moved = new Set<Statement>();
  for (const site of sites) {
    if (site === undefined) throw "SCRIPT_TEMPLATE_SITE_INVARIANT";
    moved.add(site);
  }
  const bindings: ImportBinding[] = [];
  for (const binding of objects.bindings) {
    if (binding === undefined) throw "SCRIPT_TEMPLATE_SITE_INVARIANT";
    bindings.push(binding);
  }
  bindings.push({
    imported: "getScriptTemplateSite",
    local: "getScriptTemplateSite",
    namespace: false,
    typeOnly: false,
  });
  const updatedObjects: ImportDeclaration = { ...objects, bindings };
  const bodyStatements: Statement[] = [];
  for (const statement of initialized) {
    if (statement === undefined) throw "SCRIPT_TEMPLATE_SITE_INVARIANT";
    bodyStatements.push(statement);
  }
  for (const statement of entryBody.statements) {
    if (statement === undefined) throw "SCRIPT_TEMPLATE_SITE_INVARIANT";
    bodyStatements.push(statement);
  }
  const updatedBody: BlockStatement = {
    ...entryBody,
    statements: bodyStatements,
  };
  const statements: Statement[] = [];
  for (const statement of module.statements) {
    if (statement === undefined) throw "SCRIPT_TEMPLATE_SITE_INVARIANT";
    if (moved.has(statement)) continue;
    if (statement.kind === "import" && statement.declaration === objects)
      statements.push({
        start: statement.start,
        end: statement.end,
        kind: "import",
        declaration: updatedObjects,
      });
    else if (statement === entry)
      statements.push({
        ...entry,
        kind: "function",
        body: updatedBody,
      });
    else statements.push(statement);
  }
  return rewriteModule(
    {
      ...module,
      imports: module.imports.map((declaration) => {
        if (declaration === undefined) throw "SCRIPT_TEMPLATE_SITE_INVARIANT";
        return declaration === objects ? updatedObjects : declaration;
      }),
      statements,
    },
    { hashes: true },
  );
}
/** Compose the shared compiler and linker with the engine's existing permanent
 * arena. Configuration is checked eagerly; source/profile failures return stages.
 * Unexpected invariants remain host faults for the evaluator to classify. */
export function createScriptEntryCompiler(
  surface: ScriptEntrySurface,
  host: ScriptEntryCompilerHost,
  limits: ScriptEntryCompilerLimits,
): (module: Module, shape?: ScriptEntryShape) => ScriptEntryCompilation {
  const maximum = limits.maxScriptCodeBytes,
    sharedLimit = limits.maxSharedEntries ?? defaultMaxSharedScriptEntries,
    read = surface.read,
    issued = read.domain,
    collectionPlans = createManagedCollectionPlanCache(),
    // Every entry repeats the image surface's type declarations; resolve
    // them once per compiler and restore the result for each entry.
    interfaceCache = createInterfaceResolutionCache(),
    // Entries import every provider operation from the image; derive the
    // declaration-only providers once for this compiler's lifetime.
    runtime = declareManagedJitRuntime(surface.runtime);
  if (!Number.isSafeInteger(maximum) || maximum <= 0)
    throw new RangeError("maxScriptCodeBytes must be a positive safe integer");
  if (!Number.isSafeInteger(sharedLimit) || sharedLimit < 0)
    throw new RangeError("maxSharedEntries must be a nonnegative safe integer");
  if (read.directory.frame !== "ScriptEntryFrame")
    throw new RangeError("Script compilation requires ScriptEntryFrame");
  if (!Number.isSafeInteger(issued) || issued <= 0)
    throw new RangeError(
      "Script compilation requires an issued context domain",
    );
  const specifiers = new Set<string>(),
    instantiations = new Map<string, readonly string[]>();
  for (const entry of scriptRuntimeSurface()) {
    if (entry === undefined) throw "SCRIPT_RUNTIME_SURFACE_INVARIANT";
    specifiers.add(entry.specifier);
    instantiations.set(entry.name, entry.typeArguments);
  }
  function live(): boolean {
    return host.domain() === issued && host.storage.domain === issued;
  }
  // Entries are found by shape and syntax digest, then verified against the
  // stored canonical key in place, so a hit builds no key. The order map is
  // least recently used first. A negative address records syntax that did not
  // compile once abstracted, so it is not retried before eviction.
  const buckets = new Map<number, SharedScriptEntry[]>(),
    order = new Map<SharedScriptEntry, number>();
  function find(
    digest: number,
    shape: ScriptEntryShape,
    module: Module,
  ): SharedScriptEntry | undefined {
    const bucket = buckets.get(digest);
    if (bucket === undefined) return undefined;
    for (const entry of bucket) {
      if (entry === undefined) throw "SCRIPT_SHARED_ENTRY_INVARIANT";
      if (entry.shape === shape && syntaxKeyMatches(module, entry.key))
        return entry;
    }
    return undefined;
  }
  function forget(entry: SharedScriptEntry): void {
    order.delete(entry);
    const bucket = buckets.get(entry.digest);
    if (bucket === undefined) throw "SCRIPT_SHARED_ENTRY_INVARIANT";
    const kept: SharedScriptEntry[] = [];
    for (const candidate of bucket) {
      if (candidate === undefined) throw "SCRIPT_SHARED_ENTRY_INVARIANT";
      if (candidate !== entry) kept.push(candidate);
    }
    if (kept.length === 0) buckets.delete(entry.digest);
    else buckets.set(entry.digest, kept);
  }
  function touch(entry: SharedScriptEntry): void {
    order.delete(entry);
    order.set(entry, entry.address);
  }
  function remember(entry: SharedScriptEntry): void {
    const bucket = buckets.get(entry.digest);
    if (bucket === undefined) buckets.set(entry.digest, [entry]);
    else bucket.push(entry);
    touch(entry);
    while (order.size > sharedLimit) {
      let oldest: SharedScriptEntry | undefined;
      for (const [candidate, unused] of order) {
        if (unused === undefined) throw "SCRIPT_SHARED_ENTRY_INVARIANT";
        oldest = candidate;
        break;
      }
      if (oldest === undefined) throw "SCRIPT_SHARED_ENTRY_INVARIANT";
      forget(oldest);
    }
  }
  function compileEntry(source: Module): ScriptEntryCompilation {
    const request: ManagedSurfaceEntryRequest = {
      module: source,
      entry: "execute",
      specifiers,
      instantiations,
      read,
      runtime,
      // Contract indexes describe one checked graph; a compile-scoped cache
      // keeps no previous graph alive between entries (collections otherwise
      // keep moving it).
      typeContracts: createManagedTypeContractCache(),
      collectionPlans,
      interfaceCache,
      // Entries carry the publishing image's barrier policy; the surface
      // linkers reject any other, which upholds trustedExecutableCode.
      generationalBarriers: read.directory.abi.generationalBarriers,
    };
    if (host.storage.architecture === "x86_64") {
      const prepared = prepareX64ManagedSurfaceEntry({
        ...request,
        linearAllocation: true,
      });
      if (!prepared.ok) return { ok: false, stage: prepared.error.stage };
      const entry = prepared.value,
        native = entry.native;
      if (native.code.length > maximum) return { ok: false, stage: "budget" };
      return publishEntry(
        entry.entryOffset,
        engineCodeFunctions(native.functions),
        linkX64ManagedSurfaceModule(read, native, host.readWord, host.domain()),
      );
    }
    const prepared = prepareManagedSurfaceEntry(request);
    if (!prepared.ok) return { ok: false, stage: prepared.error.stage };
    const entry = prepared.value,
      native = entry.native;
    if (native.code.length > maximum) return { ok: false, stage: "budget" };
    const linked = linkManagedSurfaceModule(
      read,
      native,
      host.readWord,
      host.domain(),
    );
    return publishEntry(
      entry.entryOffset,
      engineCodeFunctions(native.functions),
      linked,
    );
  }
  function publishEntry(
    entryOffset: number,
    functions: readonly EngineCodeFunction[],
    linked: ManagedPointerResolution,
  ): ScriptEntryCompilation {
    if (!linked.ok || !live()) return { ok: false, stage: "link" };
    const base = host.storage.publish(linked.value.code, functions);
    if (
      base === undefined ||
      !Number.isSafeInteger(base) ||
      base <= 0 ||
      base % 16 !== 0 ||
      !live()
    )
      return { ok: false, stage: "publish" };
    const address = base + entryOffset;
    if (!Number.isSafeInteger(address)) return { ok: false, stage: "publish" };
    // Template sites moved to the per-parse carrier and no other module
    // initialization is admitted, so published entries are reusable.
    return { ok: true, address, reusable: true };
  }
  return (module: Module, shape?: ScriptEntryShape): ScriptEntryCompilation => {
    if (!live()) return { ok: false, stage: "link" };
    const sited = managedTemplateSites(module);
    if (shape === undefined || sharedLimit === 0) return compileEntry(sited);
    const abstracted = abstractScriptLiterals(sited);
    if (abstracted === undefined) return compileEntry(sited);
    const digest = syntaxKeyHash(abstracted.module),
      known = find(digest, shape, abstracted.module);
    if (known !== undefined) {
      touch(known);
      if (known.address < 0) return compileEntry(sited);
      return {
        ok: true,
        address: known.address,
        literals: abstracted.literals,
        reusable: true,
      };
    }
    const key = syntaxKey(abstracted.module),
      compiled = compileEntry(
        rewriteModule(abstracted.module, { hashes: true }),
      );
    if (compiled.ok) {
      remember({ digest, shape, key, address: compiled.address });
      return {
        ok: true,
        address: compiled.address,
        literals: abstracted.literals,
        reusable: true,
      };
    }
    if (!live()) return compiled;
    remember({ digest, shape, key, address: -1 });
    return compileEntry(sited);
  };
}
