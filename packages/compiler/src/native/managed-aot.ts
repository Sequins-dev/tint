import {
  planManagedSurfaceRuntimes,
  createManagedRuntimeAnchors,
  resolveManagedRuntimeNames,
  prepareManagedRuntimeEntries,
  type ManagedSurfaceRuntimeCensus,
  type ManagedRuntimeAnchorPlan,
  type ManagedRuntimeNamePlan,
  type ManagedRuntimeEntrySlots,
} from "./managed-runtimes.ts";
import type { RuntimeBindingContext } from "@tint/ts-native/runtime";
import {
  rewriteModule,
  type Module,
  type Statement,
  type TypeNode,
  type Expression,
  type IdentifierParameter,
  type BlockStatement,
} from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  specializeModule,
  locateSource,
  type LinkedProgram,
} from "@tint/ts-native/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { RuntimeSource } from "./runtime-contracts.ts";
import {
  resolveManagedSurfaceSelections,
  prepareManagedSurfaceTable,
  type ManagedSurfaceSelection,
} from "./managed-selections.ts";
import {
  createManagedSurfaceAnchors,
  materializeManagedSurfaceTable,
  resolveManagedSurfaceAnchors,
  type ManagedSurfaceAnchorEntry,
} from "./managed-anchors.ts";
import {
  generatedIdentifier,
  createManagedSurfaceReflectors,
  createManagedSurfaceWitnessFactory,
  type ManagedSurfaceTypeDescription,
} from "./managed-surfaces.ts";
import { canonicalizeManagedSurfaceTypes } from "./managed-surface-text.ts";
import { deriveManagedSurfacePhysicalFacts } from "./managed-directory.ts";
import {
  createManagedSurfaceDirectory,
  type SerializedManagedSurfaceDirectory,
} from "./managed-directory-data.ts";
import { materializeManagedSurfaceExport } from "./managed-export-body.ts";
export interface ManagedSurfaceRequest {
  readonly name: string;
  readonly values: readonly ManagedSurfaceSelection[];
  readonly types: readonly ManagedSurfaceSelection[];
  readonly frame?: string;
  readonly bind: { readonly module: string; readonly name: string };
}
export interface ManagedSurfaceAOTPlan {
  readonly directory: SerializedManagedSurfaceDirectory;
  readonly runtimeCensus: ManagedSurfaceRuntimeCensus;
  readonly runtimeAnchors: ManagedRuntimeAnchorPlan;
  readonly surface: ManagedSurfaceTypeDescription;
  readonly anchors: readonly ManagedSurfaceAnchorEntry[];
  readonly bind: string;
  readonly prefix: string;
  readonly table: string;
  readonly records: readonly string[];
  readonly witnesses: readonly string[];
}
export type ManagedSurfaceAOTPreparation =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: {
        readonly module: Module;
        readonly plans: readonly ManagedSurfaceAOTPlan[];
      };
    };
/** Private aliases isolate simultaneous surfaces; serialized metadata always keeps
 * its canonical names. Neither checker IDs nor linked names enter the digest. */
function surfaceAlias(prefix: string, name: string): string {
  return prefix + "_" + name;
}
function namespaceSurface(
  surface: ManagedSurfaceTypeDescription,
  prefix: string,
): ManagedSurfaceTypeDescription {
  const names = new Map<string, string>();
  for (const statement of surface.declarations) {
    if (statement === undefined || statement.kind !== "type-alias")
      throw "canonical surface alias invariant";
    names.set(statement.name, surfaceAlias(prefix, statement.name));
  }
  function reference(type: TypeNode): TypeNode {
    if (type.kind !== "named") throw "canonical surface reference invariant";
    const name = names.get(type.name);
    if (name === undefined) throw "canonical surface alias missing";
    return { ...type, name };
  }
  const module = rewriteModule(
    { start: 0, end: 0, imports: [], statements: surface.declarations },
    {
      type: (node, _original) =>
        node.kind === "named" && names.has(node.name)
          ? { ...node, name: names.get(node.name) ?? node.name }
          : node,
      statement: (node, _original) =>
        node.kind === "type-alias"
          ? { ...node, name: names.get(node.name) ?? node.name }
          : node,
    },
  );
  return {
    ...surface,
    declarations: module.statements,
    table: reference(surface.table),
    entries: surface.entries.map((entry) => ({
      ...entry,
      type: reference(entry.type),
    })),
    types: surface.types.map((entry) => ({
      ...entry,
      type: reference(entry.type),
    })),
  };
}
/** Prepare demand and metadata before the final application specialization. The
 * layout-only program is never emitted and never initializes application state. */
export function prepareManagedSurfaceExports(
  module: Module,
  linked: LinkedProgram,
  requests: readonly ManagedSurfaceRequest[],
  modules: readonly SourceModule[],
  runtimes: readonly RuntimeSource[],
  retainedModules: ReadonlySet<string>,
  globals: readonly string[],
  maxSpecializations: number,
): ManagedSurfaceAOTPreparation {
  // Ordinary builds must not traverse and clone the whole application's types
  // merely to discover that there is no managed-surface work to do.
  if (requests.length === 0) return { ok: true, value: { module, plans: [] } };
  const reject = (error: string): ManagedSurfaceAOTPreparation => ({
    ok: false,
    error,
  });
  let prepared = module;
  const plans: ManagedSurfaceAOTPlan[] = [],
    names = new Set<string>(),
    bindings = new Set<string>(),
    occupied = new Set<string>();
  rewriteModule(module, {
    type: (node, _original) => {
      if (node.kind === "named") occupied.add(node.name);
      return node;
    },
    expression: (node, _original) => {
      if (node.kind === "identifier") occupied.add(node.name);
      return node;
    },
    statement: (node, _original) => {
      if (
        node.kind === "function" ||
        node.kind === "type-alias" ||
        node.kind === "interface" ||
        node.kind === "class"
      )
        occupied.add(node.name);
      return node;
    },
  });
  for (const request of requests) {
    if (request === undefined) throw "managed surface request invariant";
    if (!generatedIdentifier(request.name) || names.has(request.name))
      return reject("surface names must be unique generated identifiers");
    names.add(request.name);
    const binding = request.bind;
    if (retainedModules.has(binding.module))
      return reject(
        "surface bind export must belong to an application instance",
      );
    const exported = linked.exports.find(
      (item) =>
        item !== undefined &&
        item.module === binding.module &&
        item.namespace === "value" &&
        item.name === binding.name,
    );
    if (exported === undefined)
      return reject("surface bind export is missing: " + binding.name);
    const bind = exported.linkedName;
    if (bindings.has(bind)) return reject("duplicate surface bind export");
    bindings.add(bind);
    const declaration = prepared.statements.find(
      (statement) =>
        statement !== undefined &&
        statement.kind === "function" &&
        statement.name === bind,
    );
    if (
      declaration === undefined ||
      declaration.kind !== "function" ||
      declaration.async ||
      declaration.generator ||
      declaration.receiver !== undefined ||
      declaration.parameters.length !== 0 ||
      (declaration.typeParameters?.length ?? 0) !== 0 ||
      declaration.returnType === undefined
    )
      return reject(
        "surface bind requires a concrete annotated zero-argument function",
      );
    const body = declaration.body;
    if (body.kind !== "block" || body.statements.length !== 1)
      return reject("surface bind requires an unbound stub");
    const first = body.statements[0];
    if (first === undefined || first.kind !== "throw")
      return reject("surface bind requires an unbound stub");
    const marker = first.expression;
    if (marker.kind !== "string" || marker.value !== "MANAGED_SURFACE_UNBOUND")
      return reject("surface bind requires an unbound stub");
    if (request.values.length === 0)
      return reject("surface requires at least one helper");
    let prefix = "$tint$surface" + String(plans.length);
    while ([...occupied].some((name) => name.startsWith(prefix))) prefix += "$";
    occupied.add(prefix);
    const bound = bindModule(prepared, globals);
    if (!bound.ok) return reject(bound.error.message);
    const selections = resolveManagedSurfaceSelections(
      linked,
      bound.value,
      request.values,
      request.types,
    );
    if (!selections.ok) return selections;
    const specialized = specializeModule(prepared, bound.value, {
      roots: selections.value.roots,
      maxSpecializations,
    });
    if (!specialized.ok) return reject(specialized.error.message);
    const table = prepareManagedSurfaceTable(
      specialized.value.module,
      selections.value,
      specialized.value.roots,
      prefix + "_raw",
      prefix + "_initial",
    );
    if (!table.ok) {
      // Reification checks the whole application too. Preserve original-source
      // locations when that check, rather than surface generation, failed.
      const check = checkClosureModule(specialized.value.module);
      if (!check.ok) {
        const location = locateSource(linked, check.error);
        return reject(
          (location === undefined
            ? ""
            : location.module +
              ":" +
              String(location.start) +
              ":" +
              String(location.end) +
              ": ") + check.error.message,
        );
      }
      return table;
    }
    const canonical = canonicalizeManagedSurfaceTypes(table.value.surface);
    if (!canonical.ok) return canonical;
    const facts = deriveManagedSurfacePhysicalFacts(canonical.value, {
      modules,
      runtimes,
      globals,
      maxSpecializations,
    });
    if (!facts.ok) return facts;
    const directory = createManagedSurfaceDirectory(
      request.name,
      canonical.value,
      facts.value,
      request.frame,
    );
    if (!directory.ok) return directory;
    const census = planManagedSurfaceRuntimes(directory.value.contracts);
    if (!census.ok) return census;
    const runtimeAnchors = createManagedRuntimeAnchors(
      census.value,
      prefix + "_runtime",
      (alias: string): string => surfaceAlias(prefix, alias),
    );
    if (!runtimeAnchors.ok) return runtimeAnchors;
    const surface = namespaceSurface(canonical.value, prefix);
    const anchors = createManagedSurfaceAnchors(
      prepared,
      selections.value,
      surface,
      prefix,
    );
    if (!anchors.ok) return anchors;
    const reflectors = createManagedSurfaceReflectors(
      surface,
      prefix + "_records",
    );
    if (!reflectors.ok) return reflectors;
    const witnesses = createManagedSurfaceWitnessFactory(
      surface,
      prefix + "_callbacks",
    );
    if (!witnesses.ok) return witnesses;
    const identities: string[] = [],
      callbacks: string[] = [],
      generated: Statement[] = [];
    for (const record of directory.value.directory.records) {
      if (record === undefined) throw "surface directory record invariant";
      const alias = surfaceAlias(prefix, record.alias);
      const identity = reflectors.value.recordIdentities.find(
        (entry) => entry !== undefined && entry.name === alias,
      );
      if (identity === undefined)
        return reject("surface record identity missing: " + record.alias);
      identities.push(identity.function);
    }
    for (const alias of directory.value.witnesses) {
      if (alias === undefined) throw "surface witness class invariant";
      const name = surfaceAlias(prefix, alias);
      const witness = witnesses.value.entries.find(
        (entry) => entry !== undefined && entry.name === name,
      );
      if (witness === undefined)
        return reject("surface callback witness missing: " + alias);
      callbacks.push(witness.function);
    }
    const retained = new Set([...identities, ...callbacks]);
    for (const statement of [
      ...reflectors.value.checked.module.statements,
      ...witnesses.value.checked.module.statements,
    ]) {
      if (
        statement !== undefined &&
        statement.kind === "function" &&
        retained.has(statement.name)
      )
        generated.push(statement);
    }
    const anchoredModule = anchors.value.module;
    const statements: Statement[] = anchoredModule.statements.slice();
    for (const declaration of runtimeAnchors.value.declarations) {
      if (declaration === undefined) throw "surface runtime anchor invariant";
      statements.push(declaration);
    }
    for (const statement of generated) {
      if (statement === undefined)
        throw "surface generated declaration invariant";
      statements.push(statement);
    }
    prepared = { ...anchoredModule, statements };
    plans.push({
      directory: directory.value.directory,
      runtimeCensus: census.value,
      runtimeAnchors: runtimeAnchors.value,
      surface,
      anchors: anchors.value.entries,
      bind,
      prefix,
      table: prefix + "_table",
      records: identities,
      witnesses: callbacks,
    });
  }
  return { ok: true, value: { module: prepared, plans } };
}
export interface ManagedSurfaceRuntimeExports {
  readonly names: ManagedRuntimeNamePlan;
  readonly entries: ManagedRuntimeEntrySlots;
}
export type ManagedSurfaceAOTMaterialization =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: {
        readonly module: Module;
        readonly functions: readonly (readonly string[])[];
        readonly runtimes: readonly ManagedSurfaceRuntimeExports[];
        readonly generated: {
          readonly retain: readonly string[];
          readonly exclude: readonly string[];
        };
      };
    };
/** Rebuilt independently on each collection-runtime pass. No early instance name
 * or table from a previous transform is retained. */
export function materializeManagedSurfaceExports(
  module: Module,
  plans: readonly ManagedSurfaceAOTPlan[],
  context: RuntimeBindingContext,
  retainedValues: ReadonlySet<string> = new Set<string>(),
): ManagedSurfaceAOTMaterialization {
  let prepared = module;
  const functions: string[][] = [],
    runtimes: ManagedSurfaceRuntimeExports[] = [],
    retain: string[] = [],
    exclude: string[] = [];
  for (const plan of plans) {
    if (plan === undefined) throw "surface AOT plan invariant";
    const resolved = resolveManagedSurfaceAnchors(prepared, plan.anchors);
    if (!resolved.ok) return resolved;
    const runtimeNames = resolveManagedRuntimeNames(
      context,
      plan.runtimeCensus,
      plan.runtimeAnchors,
    );
    if (!runtimeNames.ok) return runtimeNames;
    const runtimeEntries = prepareManagedRuntimeEntries(
      runtimeNames.value,
      plan.directory.runtimes,
      plan.prefix + "_runtime",
    );
    if (!runtimeEntries.ok) return runtimeEntries;
    // Retained helpers have no initializer-owned closure. Create a private
    // forwarding declaration once in that instance, preserving identity across
    // bind calls while keeping the compiler-authorized helper itself retained.
    const forwarded = new Map<string, string>(),
      forwarders: Statement[] = [];
    for (const entry of resolved.value) {
      if (entry === undefined) throw "surface forwarding entry invariant";
      if (!retainedValues.has(entry.local) || forwarded.has(entry.local))
        continue;
      const local = entry.local;
      const target = prepared.statements.find(
        (statement) =>
          statement !== undefined &&
          statement.kind === "function" &&
          statement.name === local,
      );
      if (
        target === undefined ||
        target.kind !== "function" ||
        target.async ||
        target.generator ||
        (target.typeParameters?.length ?? 0) !== 0 ||
        target.returnType === undefined
      )
        return {
          ok: false,
          error: "surface forwarding requires a concrete synchronous function",
        };
      let name = plan.prefix + "_forward_" + String(forwarded.size);
      while (
        prepared.statements.some(
          (statement) =>
            statement !== undefined &&
            (statement.kind === "function" ||
              statement.kind === "type-alias" ||
              statement.kind === "interface" ||
              statement.kind === "class") &&
            statement.name === name,
        )
      )
        name += "$";
      const arguments_: Expression[] = [],
        parameters: IdentifierParameter[] = [];
      for (const parameter of target.parameters) {
        if (
          parameter === undefined ||
          parameter.kind === "pattern-parameter" ||
          parameter.rest ||
          parameter.initializer !== undefined ||
          parameter.type === undefined
        )
          return {
            ok: false,
            error: "surface forwarding requires concrete parameters",
          };
        parameters.push({ ...parameter, start: 0, end: 0 });
        arguments_.push({
          kind: "identifier",
          name: parameter.name,
          start: 0,
          end: 0,
        });
      }
      const call: Expression = {
        kind: "call",
        callee: { kind: "identifier", name: local, start: 0, end: 0 },
        arguments: arguments_,
        start: 0,
        end: 0,
      };
      const body: BlockStatement = {
        kind: "block",
        start: 0,
        end: 0,
        statements: [{ kind: "return", expression: call, start: 0, end: 0 }],
      };
      const forwarder: Statement & { readonly kind: "function" } = {
        ...target,
        kind: "function",
        name,
        parameters,
        exported: false,
        start: 0,
        end: 0,
        body,
      };
      forwarders.push(forwarder);
      forwarded.set(local, name);
      exclude.push(name);
    }
    const forwardedStatements: Statement[] = prepared.statements.slice();
    for (const forwarder of forwarders) {
      if (forwarder === undefined) throw "surface forwarder invariant";
      forwardedStatements.push(forwarder);
    }
    const forwardingModule: Module = {
      ...prepared,
      statements: forwardedStatements,
    };
    const table = materializeManagedSurfaceTable(
      forwardingModule,
      plan.anchors,
      plan.surface,
      plan.table,
      forwarded,
    );
    if (!table.ok) return table;
    const statements: Statement[] = [];
    for (const statement of table.value.module.statements) {
      if (statement === undefined) throw "surface table statement invariant";
      statements.push(statement);
    }
    for (const statement of runtimeEntries.value.stubs.declarations) {
      if (statement === undefined) throw "surface stub statement invariant";
      statements.push(statement);
    }
    const withStubs: Module = { ...table.value.module, statements };
    const exported = materializeManagedSurfaceExport(
      withStubs,
      plan.bind,
      plan.directory,
      plan.table,
      plan.witnesses,
      plan.records,
      plan.prefix + "_export",
      runtimeEntries.value.slots,
    );
    if (!exported.ok) return exported;
    prepared = exported.value;
    const values = resolved.value.map(
      (entry) => forwarded.get(entry.local) ?? entry.local,
    );
    for (const witness of plan.witnesses) {
      if (witness === undefined) throw "surface witness value invariant";
      values.push(witness);
    }
    functions.push(values);
    runtimes.push({ names: runtimeNames.value, entries: runtimeEntries.value });
    for (const name of plan.records) {
      if (name === undefined) throw "surface identity invariant";
      retain.push(name);
    }
    for (const anchor of plan.runtimeAnchors.anchors) {
      if (anchor === undefined) throw "surface anchor invariant";
      retain.push(anchor.name);
    }
    for (const declaration of runtimeEntries.value.stubs.declarations) {
      if (declaration === undefined || declaration.kind !== "function")
        throw "surface stub invariant";
      retain.push(declaration.name);
    }
    exclude.push(plan.table);
    for (const name of plan.witnesses) {
      if (name === undefined) throw "surface witness invariant";
      exclude.push(name);
    }
    for (const declaration of plan.surface.declarations) {
      if (declaration === undefined || declaration.kind !== "type-alias")
        throw "surface alias invariant";
      exclude.push(declaration.name);
    }
  }
  return {
    ok: true,
    value: {
      module: prepared,
      functions,
      runtimes,
      generated: { retain, exclude },
    },
  };
}
