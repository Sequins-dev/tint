import {
  rewriteModule,
  type Module,
  type Statement,
  type Expression,
  type ImportDeclaration,
  type ImportBinding,
  type BlockStatement,
} from "@tint/typescript/syntax";
import {
  prepareManagedSurfaceEntry,
  createManagedTypeContractCache,
  declareManagedJitRuntime,
  createManagedCollectionPlanCache,
  linkManagedSurfaceModule,
  type ManagedSurfaceDirectoryRead,
  type ManagedSurfaceLayoutRuntime,
  type ManagedIdentityReader,
} from "@tint/compiler/native";
import { scriptRuntimeSurface } from "../lowering/runtime-imports.ts";
import type { EngineCodeStorage } from "./code-storage.ts";
import type { ScriptEntryCompilation } from "../script-evaluation.ts";

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
}
export const scriptEntrySupportsTemplateSites = true;

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
): (module: Module) => ScriptEntryCompilation {
  const maximum = limits.maxScriptCodeBytes,
    read = surface.read,
    issued = read.domain,
    typeContracts = createManagedTypeContractCache(),
    collectionPlans = createManagedCollectionPlanCache(),
    // Entries import every provider operation from the image; derive the
    // declaration-only providers once for this compiler's lifetime.
    runtime = declareManagedJitRuntime(surface.runtime);
  if (!Number.isSafeInteger(maximum) || maximum <= 0)
    throw new RangeError("maxScriptCodeBytes must be a positive safe integer");
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
  return (module: Module): ScriptEntryCompilation => {
    if (!live()) return { ok: false, stage: "link" };
    const prepared = prepareManagedSurfaceEntry({
      module: managedTemplateSites(module),
      entry: "execute",
      specifiers,
      instantiations,
      read,
      runtime,
      typeContracts,
      collectionPlans,
    });
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
    if (!linked.ok || !live()) return { ok: false, stage: "link" };
    const base = host.storage.publish(linked.value.code);
    if (
      base === undefined ||
      !Number.isSafeInteger(base) ||
      base <= 0 ||
      base % 16 !== 0 ||
      !live()
    )
      return { ok: false, stage: "publish" };
    const address = base + entry.entryOffset;
    if (!Number.isSafeInteger(address)) return { ok: false, stage: "publish" };
    return { ok: true, address };
  };
}
