import { bindJavaScriptModule } from "@tint/typescript/binding";
import {
  describeModuleExports,
  resolveModuleExports,
  type ModuleExportState,
} from "@tint/typescript/modules/exports";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { Span } from "@tint/typescript/syntax";

/** Inspect captured public value contracts, never mutable runtime imports or
 * private filenames. This describes availability; normal compilation still checks
 * signatures and implementation feasibility. No source body is evaluated. */
function capturedModuleExportNames(
  modules: readonly SourceModule[],
  namespace: "value" | "type",
): ReadonlyMap<string, ReadonlySet<string>> {
  const states = new Map<string, ModuleExportState>();
  function fail(module: string, span: Span, message: string): never {
    throw Error(`${module}:${span.start}:${span.end}: ${message}`);
  }
  for (const source of modules) {
    if (states.has(source.id))
      throw Error("duplicate captured module: " + source.id);
    // Module declaration binding is sufficient for exports. Global references
    // inside bodies are deliberately left to the subsequent compiler/checker.
    const bound = bindJavaScriptModule(source.module);
    if (!bound.ok) fail(source.id, bound.error, bound.error.message);
    const values = new Map<string, string>();
    for (const binding of bound.value.bindings) {
      if (binding.scope === 0)
        values.set(binding.name, source.id + ":value:" + binding.id);
    }
    const types = new Map<string, string>();
    for (const statement of source.module.statements) {
      if (statement.kind === "interface" || statement.kind === "type-alias")
        types.set(statement.name, source.id + ":type:" + statement.name);
    }
    states.set(
      source.id,
      describeModuleExports(source, bound.value, { values, types }, fail),
    );
  }
  return new Map(
    [...resolveModuleExports(states, fail)].map(([id, exports]) => [
      id,
      new Set(
        exports
          .filter((item) => item.namespace === namespace)
          .map((item) => item.name),
      ),
    ]),
  );
}

/** Runtime capabilities only consult values; type declarations cannot enable them. */
export function capturedModuleExports(
  modules: readonly SourceModule[],
): ReadonlyMap<string, ReadonlySet<string>> {
  return capturedModuleExportNames(modules, "value");
}
/** Type-only contracts are checked independently once a runtime marker exists. */
export function capturedModuleTypeExports(
  modules: readonly SourceModule[],
): ReadonlyMap<string, ReadonlySet<string>> {
  return capturedModuleExportNames(modules, "type");
}

/** Public role lookup from captured import grants. Missing old contracts remain
 * absent; conflicting providers are setup errors rather than guessed locations. */
export function capturedPublicEntry(
  mappings: readonly { readonly specifier: string; readonly target: string }[],
  specifier: string,
): string | undefined {
  const targets = new Set(
    mappings
      .filter((mapping) => mapping.specifier === specifier)
      .map((mapping) => mapping.target),
  );
  if (targets.size > 1)
    throw Error("ambiguous captured public provider: " + specifier);
  return targets.values().next().value;
}
